import type { CategoryDTO, ImageRef, OptionDTO, ProductCardDTO, ProductDetailDTO, ReviewDTO, VariantDTO } from "@henine/shared";
import type { Env } from "../env";

interface ProductRow {
  id: number;
  slug: string;
  name_fr: string;
  name_ar: string;
  description_fr: string | null;
  description_ar: string | null;
  status: string;
  category_id: number | null;
  category_slug: string | null;
  tags: string;
  price: number;
  compare_at_price: number | null;
  seo_title: string | null;
  seo_description: string | null;
  created_at: number;
}

export interface ImageRow {
  id: number;
  product_id: number;
  base_key: string;
  widths: string;
  width: number;
  height: number;
  lqip: string | null;
  alt_fr: string | null;
  alt_ar: string | null;
  option_value_id: number | null;
  sort: number;
}

export function mediaUrl(env: Env, key: string): string {
  return `${env.MEDIA_ORIGIN || ""}/media/${key}`;
}

export function imageRef(env: Env, r: ImageRow): ImageRef {
  return {
    src: mediaUrl(env, r.base_key),
    widths: JSON.parse(r.widths) as number[],
    width: r.width,
    height: r.height,
    lqip: r.lqip,
    altFr: r.alt_fr,
    altAr: r.alt_ar,
    optionValueId: r.option_value_id,
  };
}

const PRODUCT_COLS = `p.id, p.slug, p.name_fr, p.name_ar, p.description_fr, p.description_ar, p.status, p.category_id,
  c.slug AS category_slug, p.tags, p.price, p.compare_at_price, p.seo_title, p.seo_description, p.created_at`;

function toCard(
  p: ProductRow,
  image: ImageRow | undefined,
  colors: string[],
  available: number,
  rating: { avg: number; count: number } | undefined,
  env: Env,
): ProductCardDTO {
  return {
    id: p.id,
    slug: p.slug,
    nameFr: p.name_fr,
    nameAr: p.name_ar,
    price: p.price,
    compareAtPrice: p.compare_at_price,
    categorySlug: p.category_slug,
    tags: JSON.parse(p.tags || "[]") as string[],
    image: image ? imageRef(env, image) : null,
    colors,
    inStock: available > 0,
    createdAt: p.created_at,
    rating: rating && rating.count > 0 ? { avg: Math.round(rating.avg * 10) / 10, count: rating.count } : null,
  };
}

/** All published products as cards. One D1 round trip (batch of 5 reads). */
export async function listProductCards(env: Env): Promise<ProductCardDTO[]> {
  const [products, images, colors, stock, ratings] = await env.DB.batch([
    env.DB.prepare(
      `SELECT ${PRODUCT_COLS} FROM products p LEFT JOIN categories c ON c.id = p.category_id
        WHERE p.status = 'published' OR (p.status = 'scheduled' AND p.publish_at <= ?)
        ORDER BY p.sort, p.created_at DESC`,
    ).bind(Date.now()),
    env.DB.prepare("SELECT * FROM product_images ORDER BY product_id, sort, id"),
    env.DB.prepare(
      `SELECT o.product_id, v.hex FROM option_values v JOIN product_options o ON o.id = v.option_id
        WHERE o.kind = 'couleur' AND v.hex IS NOT NULL ORDER BY o.product_id, v.sort`,
    ),
    env.DB.prepare(
      "SELECT product_id, SUM(MAX(stock_on_hand - stock_reserved, 0)) AS available FROM variants WHERE is_active = 1 GROUP BY product_id",
    ),
    env.DB.prepare("SELECT product_id, AVG(rating) AS avg, COUNT(*) AS count FROM reviews WHERE status = 'approved' GROUP BY product_id"),
  ]);

  const firstImage = new Map<number, ImageRow>();
  for (const r of images!.results as unknown as ImageRow[]) if (!firstImage.has(r.product_id)) firstImage.set(r.product_id, r);
  const colorMap = new Map<number, string[]>();
  for (const r of colors!.results as { product_id: number; hex: string }[]) {
    const list = colorMap.get(r.product_id) ?? [];
    list.push(r.hex);
    colorMap.set(r.product_id, list);
  }
  const stockMap = new Map((stock!.results as { product_id: number; available: number }[]).map((r) => [r.product_id, r.available]));
  const ratingMap = new Map((ratings!.results as { product_id: number; avg: number; count: number }[]).map((r) => [r.product_id, r]));

  return (products!.results as unknown as ProductRow[]).map((p) =>
    toCard(p, firstImage.get(p.id), colorMap.get(p.id) ?? [], stockMap.get(p.id) ?? 0, ratingMap.get(p.id), env),
  );
}

export async function getProductDetail(env: Env, slug: string): Promise<ProductDetailDTO | null> {
  const p = await env.DB.prepare(
    `SELECT ${PRODUCT_COLS} FROM products p LEFT JOIN categories c ON c.id = p.category_id
      WHERE p.slug = ? AND (p.status = 'published' OR (p.status = 'scheduled' AND p.publish_at <= ?))`,
  )
    .bind(slug, Date.now())
    .first<ProductRow>();
  if (!p) return null;

  const [images, options, values, variants, reviews, category] = await env.DB.batch([
    env.DB.prepare("SELECT * FROM product_images WHERE product_id = ? ORDER BY sort, id").bind(p.id),
    env.DB.prepare("SELECT id, kind, name_fr, name_ar FROM product_options WHERE product_id = ? ORDER BY sort, id").bind(p.id),
    env.DB.prepare(
      `SELECT v.id, v.option_id, v.label_fr, v.label_ar, v.hex FROM option_values v
         JOIN product_options o ON o.id = v.option_id WHERE o.product_id = ? ORDER BY v.sort, v.id`,
    ).bind(p.id),
    env.DB.prepare(
      "SELECT id, sku, option_value_ids, price_override, stock_on_hand, stock_reserved FROM variants WHERE product_id = ? AND is_active = 1 ORDER BY id",
    ).bind(p.id),
    env.DB.prepare(
      "SELECT id, name, rating, text, verified, reply, created_at FROM reviews WHERE product_id = ? AND status = 'approved' ORDER BY is_featured DESC, created_at DESC LIMIT 30",
    ).bind(p.id),
    env.DB.prepare("SELECT id, slug, name_fr, name_ar, image FROM categories WHERE id = ?").bind(p.category_id ?? 0),
  ]);

  const imageRows = images!.results as unknown as ImageRow[];
  const valueRows = values!.results as { id: number; option_id: number; label_fr: string; label_ar: string; hex: string | null }[];
  const opts: OptionDTO[] = (options!.results as { id: number; kind: OptionDTO["kind"]; name_fr: string; name_ar: string }[]).map((o) => ({
    id: o.id,
    kind: o.kind,
    nameFr: o.name_fr,
    nameAr: o.name_ar,
    values: valueRows.filter((v) => v.option_id === o.id).map((v) => ({ id: v.id, labelFr: v.label_fr, labelAr: v.label_ar, hex: v.hex })),
  }));
  const vars: VariantDTO[] = (
    variants!.results as { id: number; sku: string; option_value_ids: string; price_override: number | null; stock_on_hand: number; stock_reserved: number }[]
  ).map((v) => ({
    id: v.id,
    sku: v.sku,
    optionValueIds: JSON.parse(v.option_value_ids) as number[],
    price: v.price_override ?? p.price,
    available: Math.max(0, v.stock_on_hand - v.stock_reserved),
  }));
  const revs: ReviewDTO[] = (
    reviews!.results as { id: number; name: string; rating: number; text: string | null; verified: number; reply: string | null; created_at: number }[]
  ).map((r) => ({ id: r.id, name: r.name, rating: r.rating, text: r.text, verified: !!r.verified, reply: r.reply, createdAt: r.created_at }));
  const cat = (category!.results as { id: number; slug: string; name_fr: string; name_ar: string; image: string | null }[])[0];
  const colorHexes = opts.filter((o) => o.kind === "couleur").flatMap((o) => o.values.map((v) => v.hex).filter((h): h is string => !!h));
  const available = vars.reduce((s, v) => s + v.available, 0);
  const rating = revs.length ? { avg: revs.reduce((s, r) => s + r.rating, 0) / revs.length, count: revs.length } : undefined;

  return {
    ...toCard(p, imageRows[0], colorHexes, available, rating, env),
    descriptionFr: p.description_fr,
    descriptionAr: p.description_ar,
    category: cat ? { id: cat.id, slug: cat.slug, nameFr: cat.name_fr, nameAr: cat.name_ar, image: cat.image } : null,
    images: imageRows.map((r) => imageRef(env, r)),
    options: opts,
    variants: vars,
    reviews: revs,
    seoTitle: p.seo_title,
    seoDescription: p.seo_description,
  };
}

export async function listCategories(env: Env): Promise<CategoryDTO[]> {
  const { results } = await env.DB.prepare(
    `SELECT c.id, c.slug, c.name_fr, c.name_ar, c.image,
            (SELECT COUNT(*) FROM products p WHERE p.category_id = c.id AND p.status = 'published') AS product_count
       FROM categories c WHERE c.is_active = 1 ORDER BY c.sort, c.id`,
  ).all<{ id: number; slug: string; name_fr: string; name_ar: string; image: string | null; product_count: number }>();
  return results.map((c) => ({ id: c.id, slug: c.slug, nameFr: c.name_fr, nameAr: c.name_ar, image: c.image, productCount: c.product_count }));
}

/** "Rose poudré / M" for a variant, in both languages. */
export async function variantLabels(env: Env, variantIds: number[]): Promise<Map<number, { fr: string; ar: string }>> {
  if (!variantIds.length) return new Map();
  const ph = variantIds.map(() => "?").join(",");
  const { results } = await env.DB.prepare(
    `SELECT var.id AS variant_id, ov.label_fr, ov.label_ar, po.sort AS osort
       FROM variants var, json_each(var.option_value_ids) je
       JOIN option_values ov ON ov.id = je.value
       JOIN product_options po ON po.id = ov.option_id
      WHERE var.id IN (${ph})
      ORDER BY var.id, po.sort DESC`,
  )
    .bind(...variantIds)
    .all<{ variant_id: number; label_fr: string; label_ar: string }>();
  const out = new Map<number, { fr: string[]; ar: string[] }>();
  for (const r of results) {
    const e = out.get(r.variant_id) ?? { fr: [], ar: [] };
    e.fr.push(r.label_fr);
    e.ar.push(r.label_ar);
    out.set(r.variant_id, e);
  }
  return new Map([...out].map(([k, v]) => [k, { fr: v.fr.join(" / "), ar: v.ar.join(" / ") }]));
}
