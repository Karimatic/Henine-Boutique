import { imageUrl, type ProductDetailDTO } from "@henine/shared";
import type { Env } from "../env";
import { imageRef, visibleSql, type ImageRow } from "./catalog";

/**
 * Search engines and ad catalogues:
 *  - /robots.txt and /sitemap.xml (Arabic + French address of every page, with hreflang)
 *  - /feeds/meta.csv: product catalogue for Meta (Facebook / Instagram catalogue ads),
 *    also accepted as-is by Google Merchant Center. One line per size/colour.
 *  - JSON-LD for product pages (price, stock, stars in Google results)
 */

const xmlEsc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const abs = (env: Env, path: string) => new URL(path, env.PUBLIC_ORIGIN).toString();

export function robotsTxt(env: Env): string {
  return ["User-agent: *", "Allow: /", "Disallow: /admin", "Disallow: /api", "Disallow: /panier", "Disallow: /commande", "Disallow: /merci", "Disallow: /fr/panier", "Disallow: /fr/commande", "Disallow: /fr/merci", "", `Sitemap: ${abs(env, "/sitemap.xml")}`, ""].join("\n");
}

export async function sitemapXml(env: Env): Promise<string> {
  const now = Date.now();
  const [products, categories, collections, pages] = await env.DB.batch([
    env.DB.prepare(`SELECT p.slug, p.updated_at FROM products p WHERE ${visibleSql("p", now)} ORDER BY p.sort, p.id`),
    env.DB.prepare("SELECT slug FROM categories WHERE is_active = 1 ORDER BY sort, id"),
    env.DB.prepare("SELECT slug, starts_at FROM collections WHERE is_active = 1 ORDER BY id"),
    env.DB.prepare("SELECT slug FROM pages WHERE is_active = 1 ORDER BY id"),
  ]);
  const day = (t: number | null | undefined) => (t ? new Date(t).toISOString().slice(0, 10) : null);
  const entries: { path: string; lastmod?: string | null; priority: string }[] = [
    { path: "/", priority: "1.0" },
    { path: "/nouveautes", priority: "0.9" },
    { path: "/categories", priority: "0.7" },
    { path: "/contact", priority: "0.4" },
    { path: "/suivi", priority: "0.3" },
    ...(products!.results as { slug: string; updated_at: number }[]).map((p) => ({ path: `/produit/${p.slug}`, lastmod: day(p.updated_at), priority: "0.8" })),
    ...(categories!.results as { slug: string }[]).map((c) => ({ path: `/c/${c.slug}`, priority: "0.7" })),
    ...(collections!.results as { slug: string }[]).map((c) => ({ path: `/collection/${c.slug}`, priority: "0.6" })),
    ...(pages!.results as { slug: string }[]).map((p) => ({ path: `/p/${p.slug}`, priority: "0.3" })),
  ];
  // Arabic lives at the root, French under /fr: each page is listed once per language
  const urls = entries.flatMap((e) => {
    const ar = abs(env, e.path);
    const fr = abs(env, e.path === "/" ? "/fr" : `/fr${e.path}`);
    const alt = `<xhtml:link rel="alternate" hreflang="ar-DZ" href="${xmlEsc(ar)}"/><xhtml:link rel="alternate" hreflang="fr-DZ" href="${xmlEsc(fr)}"/><xhtml:link rel="alternate" hreflang="x-default" href="${xmlEsc(ar)}"/>`;
    const mod = e.lastmod ? `<lastmod>${e.lastmod}</lastmod>` : "";
    return [ar, fr].map((loc) => `<url><loc>${xmlEsc(loc)}</loc>${mod}<priority>${e.priority}</priority>${alt}</url>`);
  });
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:xhtml="http://www.w3.org/1999/xhtml">\n${urls.join("\n")}\n</urlset>\n`;
}

/* ───────────── Meta / Google product feed ───────────── */

const FEED_COLUMNS = [
  "id", "item_group_id", "title", "description", "availability", "condition", "price", "sale_price", "link", "image_link",
  "additional_image_link", "brand", "size", "color", "product_type", "quantity_to_sell_on_facebook",
] as const;

const csvCell = (v: string | number | null | undefined) => `"${String(v ?? "").replace(/"/g, '""')}"`;
/** Markdown description → one plain line. */
const plain = (s: string | null) => (s ?? "").replace(/[*#_>`]+/g, "").replace(/\s+/g, " ").trim();

export async function metaFeedCsv(env: Env, lang: "ar" | "fr"): Promise<string> {
  const now = Date.now();
  const ar = lang === "ar";
  const [products, images, variants, values] = await env.DB.batch([
    env.DB.prepare(
      `SELECT p.id, p.slug, p.name_fr, p.name_ar, p.description_fr, p.description_ar, p.price, p.compare_at_price, c.name_fr AS cat_fr, c.name_ar AS cat_ar
         FROM products p LEFT JOIN categories c ON c.id = p.category_id WHERE ${visibleSql("p", now)} ORDER BY p.sort, p.id`,
    ),
    env.DB.prepare("SELECT * FROM product_images ORDER BY product_id, sort, id"),
    env.DB.prepare("SELECT id, product_id, sku, option_value_ids, price_override, stock_on_hand, stock_reserved FROM variants WHERE is_active = 1 ORDER BY product_id, id"),
    env.DB.prepare("SELECT v.id, v.label_fr, v.label_ar, o.kind FROM option_values v JOIN product_options o ON o.id = v.option_id"),
  ]);
  const imgs = new Map<number, ImageRow[]>();
  for (const r of images!.results as unknown as ImageRow[]) imgs.set(r.product_id, [...(imgs.get(r.product_id) ?? []), r]);
  const valueById = new Map((values!.results as { id: number; label_fr: string; label_ar: string; kind: string }[]).map((v) => [v.id, v]));
  const vars = variants!.results as { id: number; product_id: number; sku: string; option_value_ids: string; price_override: number | null; stock_on_hand: number; stock_reserved: number }[];
  const utm = "utm_source=meta&utm_medium=catalog";

  const lines = [FEED_COLUMNS.join(",")];
  for (const p of products!.results as {
    id: number; slug: string; name_fr: string; name_ar: string; description_fr: string | null; description_ar: string | null;
    price: number; compare_at_price: number | null; cat_fr: string | null; cat_ar: string | null;
  }[]) {
    const pics = (imgs.get(p.id) ?? []).map((r) => imageRef(env, r));
    if (!pics.length) continue; // Meta refuses items without a photo
    const name = ar ? p.name_ar : p.name_fr;
    const desc = plain(ar ? p.description_ar : p.description_fr) || (ar ? `${name} · الدفع عند الاستلام · التوصيل إلى 69 ولاية` : `${name} · Paiement à la livraison · Livraison 69 wilayas`);
    const link = abs(env, `${ar ? "" : "/fr"}/produit/${p.slug}?${utm}`);
    const productVariants = vars.filter((v) => v.product_id === p.id);
    for (const v of productVariants.length ? productVariants : [null]) {
      const labels = v ? (JSON.parse(v.option_value_ids) as number[]).map((id) => valueById.get(id)).filter((x) => !!x) : [];
      const label = (kind: string) => labels.filter((l) => l!.kind === kind).map((l) => (ar ? l!.label_ar : l!.label_fr)).join(" / ");
      const colorIds = new Set(labels.filter((l) => l!.kind === "couleur").map((l) => l!.id));
      // the colour's own photo first when there is one
      const mine = pics.filter((img) => img.optionValueId != null && colorIds.has(img.optionValueId));
      const ordered = [...mine, ...pics.filter((img) => !mine.includes(img))];
      const available = v ? Math.max(0, v.stock_on_hand - v.stock_reserved) : 0;
      const price = v?.price_override ?? p.price;
      const onSale = p.compare_at_price != null && p.compare_at_price > price;
      const size = label("taille");
      const color = label("couleur");
      lines.push(
        [
          v ? v.sku || `HN-${v.id}` : `HN-P${p.id}`,
          `HN-P${p.id}`,
          [name, color, size].filter(Boolean).join(" - ").slice(0, 150),
          desc.slice(0, 5000),
          available > 0 ? "in stock" : "out of stock",
          "new",
          `${onSale ? p.compare_at_price : price}.00 DZD`,
          onSale ? `${price}.00 DZD` : "",
          link,
          abs(env, imageUrl(ordered[0]!, 1200)),
          ordered.slice(1, 11).map((img) => abs(env, imageUrl(img, 1200))).join(","),
          "Henine Boutique",
          size,
          color,
          (ar ? p.cat_ar : p.cat_fr) ?? "",
          available,
        ]
          .map(csvCell)
          .join(","),
      );
    }
  }
  return lines.join("\n") + "\n";
}

/* ───────────── Product structured data (Google rich results) ───────────── */

export function productJsonLd(env: Env, p: ProductDetailDTO, ar: boolean, path: string): string {
  const name = ar ? p.nameAr : p.nameFr;
  const url = abs(env, path);
  const prices = p.variants.length ? p.variants.map((v) => v.price) : [p.price];
  const low = Math.min(...prices);
  const high = Math.max(...prices);
  const inStock = p.variants.some((v) => v.available > 0);
  const availability = `https://schema.org/${inStock ? "InStock" : "OutOfStock"}`;
  const data: Record<string, unknown> = {
    "@context": "https://schema.org",
    "@type": "Product",
    name,
    url,
    image: p.images.slice(0, 6).map((img) => abs(env, imageUrl(img, 1200))),
    description: plain(ar ? p.descriptionAr : p.descriptionFr) || name,
    sku: `HN-P${p.id}`,
    brand: { "@type": "Brand", name: "Henine Boutique" },
    ...(p.category ? { category: ar ? p.category.nameAr : p.category.nameFr } : {}),
    offers:
      low === high
        ? { "@type": "Offer", price: low, priceCurrency: "DZD", availability, url, itemCondition: "https://schema.org/NewCondition" }
        : { "@type": "AggregateOffer", lowPrice: low, highPrice: high, priceCurrency: "DZD", offerCount: p.variants.length, availability, url },
  };
  if (p.rating) {
    data.aggregateRating = { "@type": "AggregateRating", ratingValue: p.rating.avg, reviewCount: p.rating.count, bestRating: 5, worstRating: 1 };
    data.review = p.reviews.slice(0, 5).map((r) => ({
      "@type": "Review",
      author: { "@type": "Person", name: r.name },
      datePublished: new Date(r.createdAt).toISOString().slice(0, 10),
      reviewRating: { "@type": "Rating", ratingValue: r.rating, bestRating: 5 },
      ...(r.text ? { reviewBody: r.text } : {}),
    }));
  }
  // "<" escaped so the JSON can never close the <script> tag
  return `<script type="application/ld+json">${JSON.stringify(data).replace(/</g, "\\u003c")}</script>`;
}
