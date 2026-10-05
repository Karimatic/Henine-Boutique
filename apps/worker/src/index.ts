import { Hono, type Context } from "hono";
import { formatDA, imageUrl, isSafeLink, type ImageRef } from "@henine/shared";
import type { AppEnv } from "./env";
import { recordError } from "./lib/audit";
import { getCollection, getProductDetail } from "./lib/catalog";
import { cached } from "./lib/edge-cache";
import { metaFeedCsv, productJsonLd, robotsTxt, sitemapXml } from "./lib/seo";
import { getSettings } from "./lib/settings";
import { HttpError } from "./lib/http";
import { handleUpdate, verifyWebhookSecret } from "./lib/telegram";
import { adminDocumentHeaders, apiHeaders, httpsOnly, sameOriginWrites } from "./middleware/security";
import { adminRoutes } from "./routes/admin/index";
import { authRoutes } from "./routes/auth";
import { publicRoutes } from "./routes/public";
import { scheduled } from "./scheduled";

export { AdminHub } from "./hub";

const app = new Hono<AppEnv>();
app.use("*", httpsOnly);

/* ─── API ─── */
const api = new Hono<AppEnv>();
api.use("*", apiHeaders, sameOriginWrites);

// Telegram webhook (production). Authenticated by the secret token header, not by Origin.
api.post("/tg/webhook", async (c) => {
  if (!(await verifyWebhookSecret(c.env, c.req.header("X-Telegram-Bot-Api-Secret-Token")))) return c.json({ error: "forbidden" }, 403);
  const update = await c.req.json().catch(() => null);
  if (update) c.executionCtx.waitUntil(handleUpdate(c.env, update).catch((err: Error) => recordError(c.env, "telegram", err.message)));
  return c.json({ ok: true });
});

api.route("/auth", authRoutes);
api.route("/admin", adminRoutes);
api.route("/", publicRoutes);
api.notFound((c) => c.json({ error: "not_found" }, 404));
api.onError((err, c) => {
  if (err instanceof HttpError) return c.json({ error: err.code, details: err.details }, err.status);
  const path = new URL(c.req.url).pathname;
  console.error("api_error", c.req.method, path, err.message);
  c.executionCtx.waitUntil(recordError(c.env, "api", `${c.req.method} ${path}: ${err.message}`, { stack: err.stack, url: path }));
  return c.json({ error: "internal_error" }, 500);
});
app.route("/api", api);

/* ─── Product photos from R2 (edge cached, immutable keys) ─── */
app.get("/media/*", async (c) => {
  const key = decodeURIComponent(new URL(c.req.url).pathname.slice("/media/".length));
  // product videos: streamed with byte ranges (phones seek and buffer, Safari requires it)
  if (/^[a-z0-9/_-]+\.(mp4|webm)$/i.test(key)) {
    const range = c.req.header("Range");
    const obj = await c.env.MEDIA.get(key, range ? { range: c.req.raw.headers } : undefined);
    if (!obj || !("body" in obj)) return c.notFound();
    const headers = new Headers({
      "Content-Type": obj.httpMetadata?.contentType ?? "video/mp4",
      "Cache-Control": "public, max-age=31536000, immutable",
      "Accept-Ranges": "bytes",
      "X-Content-Type-Options": "nosniff",
      ETag: obj.httpEtag,
    });
    const r = obj.range as { offset?: number; length?: number } | undefined;
    if (range && r && r.offset != null) {
      const length = r.length ?? obj.size - r.offset;
      headers.set("Content-Range", `bytes ${r.offset}-${r.offset + length - 1}/${obj.size}`);
      headers.set("Content-Length", String(length));
      return new Response(obj.body, { status: 206, headers });
    }
    headers.set("Content-Length", String(obj.size));
    return new Response(obj.body, { headers });
  }
  if (!/^[a-z0-9/_-]+\.(webp|jpg|mp3|ogg|wav|m4a)$/i.test(key)) return c.notFound();
  const cache = caches.default;
  const hit = await cache.match(c.req.raw);
  if (hit) return hit;
  const obj = await c.env.MEDIA.get(key);
  if (!obj) return c.notFound();
  const res = new Response(obj.body, {
    headers: {
      "Content-Type": obj.httpMetadata?.contentType ?? "application/octet-stream",
      "Cache-Control": "public, max-age=31536000, immutable",
      "X-Content-Type-Options": "nosniff",
      "Content-Security-Policy": "default-src 'none'; sandbox",
      ETag: obj.httpEtag,
    },
  });
  c.executionCtx.waitUntil(cache.put(c.req.raw, res.clone()));
  return res;
});

/* ─── Search engines & ad catalogues (edge cached, refreshed on every catalogue change) ─── */
async function catalogCached(c: Context<AppEnv>, ttl: number, type: string, produce: () => Promise<string>) {
  const { catalog_version: v } = await getSettings(c.env, ["catalog_version"]);
  const url = new URL(c.req.url);
  url.searchParams.set("__v", String(v));
  return cached(new Request(url), c.executionCtx, ttl, async () => new Response(await produce(), { headers: { "Content-Type": type } }));
}
app.get("/robots.txt", (c) => c.text(robotsTxt(c.env), 200, { "Cache-Control": "public, max-age=3600" }));
app.get("/sitemap.xml", (c) => catalogCached(c, 3600, "application/xml; charset=utf-8", () => sitemapXml(c.env)));
/** Meta (Facebook/Instagram) catalogue, also fine for Google Merchant Center. ?lang=fr for French. */
app.get("/feeds/meta.csv", (c) => {
  const lang = c.req.query("lang") === "fr" ? "fr" : "ar";
  return catalogCached(c, 3600, "text/csv; charset=utf-8", () => metaFeedCsv(c.env, lang));
});

/* ─── Short links: /l/<slug> ─── */
app.get("/l/:slug", async (c) => {
  const row = await c.env.DB.prepare("SELECT id, target FROM links WHERE kind = 'short' AND slug = ? AND is_active = 1")
    .bind(c.req.param("slug").toLowerCase())
    .first<{ id: number; target: string }>();
  if (!row || !isSafeLink(row.target)) return c.redirect("/", 302);
  c.executionCtx.waitUntil(c.env.DB.prepare("UPDATE links SET clicks = clicks + 1 WHERE id = ?").bind(row.id).run());
  return c.redirect(row.target, 302);
});

/* ─── Dynamic pages served from a pre-built "_" shell ───
 * /produit/<slug>, /c/<slug>, /p/<slug> (and /fr/…) exist as one static shell each; the page
 * reads the slug from the URL and loads its data from /api. New products are therefore live
 * instantly without a rebuild. Product pages also get their <title>/OpenGraph tags injected
 * here so WhatsApp/Instagram/Google previews show the real product.
 */
const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

interface PreviewMeta {
  title: string;
  description: string;
  type: "product" | "website";
  image: ImageRef | null;
  imageAlt: string;
  price?: number;
}

/**
 * Link-preview tags (WhatsApp, Instagram DMs, Facebook, Google). The image is the 960 px
 * rendition: sharp in previews without making every share download a full-size photo.
 */
function previewHead(c: Context<AppEnv>, path: string, ar: boolean, m: PreviewMeta): string {
  const canonical = new URL(path, c.env.PUBLIC_ORIGIN).toString();
  const tags: [string, string][] = [
    ["og:site_name", "Henine Boutique"],
    ["og:locale", ar ? "ar_DZ" : "fr_DZ"],
    ["og:type", m.type],
    ["og:url", canonical],
    ["og:title", m.title],
    ["og:description", m.description],
  ];
  if (m.image) {
    const src = imageUrl(m.image, 960);
    const w = Number(/-(\d+)\.\w+$/.exec(src)?.[1] ?? m.image.width);
    tags.push(
      ["og:image", new URL(src, c.env.PUBLIC_ORIGIN).toString()],
      ["og:image:width", String(w)],
      ["og:image:height", String(Math.round((w * m.image.height) / m.image.width))],
      ["og:image:alt", m.imageAlt],
    );
  }
  if (m.price != null) tags.push(["product:price:amount", String(m.price)], ["product:price:currency", "DZD"]);
  return [
    ...tags.map(([k, v]) => `<meta property="${k}" content="${esc(v)}">`),
    `<meta name="twitter:card" content="${m.image ? "summary_large_image" : "summary"}">`,
    linkTags(c, path),
  ].join("");
}

/** Canonical address + the Arabic / French versions of the same page (hreflang). */
function linkTags(c: Context<AppEnv>, path: string): string {
  const bare = path.replace(/^\/fr(?=\/)/, "");
  const abs = (p: string) => esc(new URL(p, c.env.PUBLIC_ORIGIN).toString());
  return [
    `<link rel="canonical" href="${abs(path)}">`,
    `<link rel="alternate" hreflang="ar" href="${abs(bare)}">`,
    `<link rel="alternate" hreflang="fr" href="${abs(`/fr${bare}`)}">`,
    `<link rel="alternate" hreflang="x-default" href="${abs(bare)}">`,
  ].join("");
}

async function shell(c: Context<AppEnv>, prefix: string, section: string, slug: string) {
  const url = new URL(c.req.url);
  const direct = await c.env.ASSETS.fetch(new Request(url, c.req.raw));
  if (direct.status !== 404 || slug === "_") return direct;
  const res = await c.env.ASSETS.fetch(new Request(new URL(`${prefix}/${section}/_`, url), { headers: c.req.raw.headers }));
  if (!res.ok) return new Response(res.body, res);
  if (section !== "produit" && section !== "collection") {
    // categories and info pages: their own canonical (the shell is shared by every slug)
    return new HTMLRewriter()
      .on('link[rel="canonical"], link[rel="alternate"][hreflang]', { element: (el) => void el.remove() })
      .on("head", { element: (el) => void el.append(linkTags(c, url.pathname), { html: true }) })
      .transform(new Response(res.body, res));
  }

  // The finished page is kept at the edge: one product query per version of the catalogue and
  // of the page itself (a deploy changes the shell's ETag), instead of one per visit.
  const { catalog_version: v, drop_times: drops } = await getSettings(c.env, ["catalog_version", "drop_times"]);
  const key = new URL(url.pathname, url);
  const build = (res.headers.get("ETag") ?? "").replace(/[^\w-]/g, "");
  key.searchParams.set("__v", `${v}.${drops.filter((t) => t <= Date.now()).length}.${build}`);
  return cached(new Request(key), c.executionCtx, 300, () => previewPage(c, res, prefix, section, slug, url));
}

/** Product / collection page: the shell with the item's title, link previews and structured data. */
async function previewPage(c: Context<AppEnv>, res: Response, prefix: string, section: string, slug: string, url: URL): Promise<Response> {
  const ar = prefix === ""; // Arabic is served at the root, French under /fr
  let meta: PreviewMeta | null = null;
  let structured = "";
  if (section === "produit") {
    const product = await getProductDetail(c.env, slug).catch(() => null);
    if (product) {
      structured = productJsonLd(c.env, product, ar, url.pathname);
      const name = ar ? product.nameAr : product.nameFr;
      const text = (product.seoDescription ?? (ar ? product.descriptionAr : product.descriptionFr) ?? "").replace(/[*#\n]+/g, " ").trim();
      const price = formatDA(product.price);
      meta = {
        title: `${name} · ${price}`,
        description: (text || (ar ? "الدفع عند الاستلام · التوصيل إلى 69 ولاية" : "Paiement à la livraison · Livraison 69 wilayas")).slice(0, 180),
        type: "product",
        image: product.images[0] ?? null,
        imageAlt: name,
        price: product.price,
      };
    }
  } else {
    const col = await getCollection(c.env, slug).catch(() => null);
    if (col) {
      const name = ar ? col.nameAr : col.nameFr;
      meta = {
        title: `${name} · Henine Boutique`,
        description: ((ar ? col.descriptionAr : col.descriptionFr) ?? (ar ? "تشكيلة جديدة من Henine Boutique" : "Nouvelle collection Henine Boutique")).slice(0, 180),
        type: "website",
        image: col.image,
        imageAlt: name,
      };
    }
  }
  if (!meta) return new Response(res.body, { status: 404, headers: res.headers });
  const head = previewHead(c, url.pathname, ar, meta) + structured;
  const title = section === "produit" ? `${meta.imageAlt} · Henine Boutique` : meta.title;
  return new HTMLRewriter()
    .on("title", { element: (el) => void el.setInnerContent(title) })
    .on('meta[name="description"]', { element: (el) => void el.setAttribute("content", meta.description) })
    .on('meta[property^="og:"], meta[name^="twitter:"], link[rel="canonical"], link[rel="alternate"][hreflang]', { element: (el) => void el.remove() })
    .on("head", { element: (el) => void el.append(head, { html: true }) })
    .transform(new Response(res.body, res));
}

for (const prefix of ["", "/fr"]) {
  for (const section of ["produit", "c", "p", "collection"]) {

    app.get(`${prefix}/${section}/:slug`, (c) => shell(c, prefix, section, c.req.param("slug")));
  }
}

/* ─── Admin SPA ─── */
app.get("/admin/*", async (c) => {
  const url = new URL(c.req.url);
  const isFile = /\.[a-z0-9]+$/i.test(url.pathname);
  let res = await c.env.ASSETS.fetch(new Request(url, c.req.raw));
  if (!isFile && res.status === 404) {
    // client-side route → serve the SPA shell (asset handling redirects /admin/index.html → /admin/)
    res = await c.env.ASSETS.fetch(new Request(new URL("/admin/", url), c.req.raw));
  }
  const out = new Response(res.body, res);
  if (!isFile) adminDocumentHeaders(out.headers, c.env.MEDIA_ORIGIN);
  return out;
});
app.get("/admin", (c) => c.redirect("/admin/", 308));

export default {
  fetch: app.fetch,
  scheduled,
} satisfies ExportedHandler<AppEnv["Bindings"]>;
