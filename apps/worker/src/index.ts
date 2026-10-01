import { Hono, type Context } from "hono";
import { imageUrl } from "@henine/shared";
import type { AppEnv } from "./env";
import { recordError } from "./lib/audit";
import { getProductDetail } from "./lib/catalog";
import { HttpError } from "./lib/http";
import { handleUpdate, verifyWebhookSecret } from "./lib/telegram";
import { adminDocumentHeaders, apiHeaders, sameOriginWrites } from "./middleware/security";
import { adminRoutes } from "./routes/admin/index";
import { authRoutes } from "./routes/auth";
import { publicRoutes } from "./routes/public";
import { scheduled } from "./scheduled";

const app = new Hono<AppEnv>();

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
  if (!/^[a-z0-9/_-]+\.(webp|jpg)$/i.test(key)) return c.notFound();
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

/* ─── Short links: /l/<slug> ─── */
app.get("/l/:slug", async (c) => {
  const row = await c.env.DB.prepare("SELECT id, target FROM links WHERE kind = 'short' AND slug = ? AND is_active = 1")
    .bind(c.req.param("slug").toLowerCase())
    .first<{ id: number; target: string }>();
  if (!row) return c.redirect("/", 302);
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

async function shell(c: Context<AppEnv>, prefix: string, section: string, slug: string) {
  const url = new URL(c.req.url);
  const direct = await c.env.ASSETS.fetch(new Request(url, c.req.raw));
  if (direct.status !== 404 || slug === "_") return direct;
  const res = await c.env.ASSETS.fetch(new Request(new URL(`${prefix}/${section}/_`, url), { headers: c.req.raw.headers }));
  if (section !== "produit" || !res.ok) return new Response(res.body, res);

  const product = await getProductDetail(c.env, slug).catch(() => null);
  if (!product) return new Response(res.body, { status: 404, headers: res.headers });
  const ar = prefix === ""; // Arabic is served at the root, French under /fr
  const title = `${ar ? product.nameAr : product.nameFr} · Henine Boutique`;
  const description = (product.seoDescription ?? (ar ? product.descriptionAr : product.descriptionFr) ?? "").replace(/[*#\n]+/g, " ").trim().slice(0, 180);
  const image = product.images[0] ? new URL(imageUrl(product.images[0], 1440), c.env.PUBLIC_ORIGIN).toString() : null;
  const head = [
    `<meta property="og:title" content="${esc(title)}">`,
    `<meta property="og:description" content="${esc(description)}">`,
    `<meta property="og:type" content="product">`,
    `<link rel="canonical" href="${esc(new URL(url.pathname, c.env.PUBLIC_ORIGIN).toString())}">`,
    image ? `<meta property="og:image" content="${esc(image)}">` : "",
  ].join("");
  return new HTMLRewriter()
    .on("title", { element: (el) => void el.setInnerContent(title) })
    .on('meta[name="description"]', { element: (el) => void el.setAttribute("content", description) })
    .on('meta[property^="og:"], link[rel="canonical"]', { element: (el) => void el.remove() })
    .on("head", { element: (el) => void el.append(head, { html: true }) })
    .transform(new Response(res.body, res));
}

for (const prefix of ["", "/fr"]) {
  for (const section of ["produit", "c", "p"]) {
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
