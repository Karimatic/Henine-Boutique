import {
  productBadge,
  type CategoryDTO,
  type CollectionDTO,
  type DropTeaserDTO,
  type FlashInfoDTO,
  type FlashSaleDTO,
  type ImageRef,
  type OptionDTO,
  type ProductBadge,
  type ProductCardDTO,
  type ProductDetailDTO,
  type ReviewDTO,
  type SizeGuideDTO,
  type VariantDTO,
} from "@henine/shared";
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
  related_ids: string;
  size_guide_id: number | null;
  video_key: string | null;
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
  c.slug AS category_slug, p.tags, p.price, p.compare_at_price, p.seo_title, p.seo_description,
  -- "arrived": published, or new stock received since (Nouveautés = the latest goods in)
  MAX(COALESCE(p.published_at, p.created_at), COALESCE((SELECT MAX(m.created_at) FROM stock_movements m JOIN variants mv ON mv.id = m.variant_id
    WHERE mv.product_id = p.id AND m.reason = 'reception'), 0)) AS created_at, p.related_ids, p.size_guide_id, p.video_key`;

const CANCELLED = "('annulee','doublon','fausse')";

/**
 * SQL (0/1) telling whether product `alias` belongs to a published drop that locks its
 * products and hasn't launched yet. `now` is a number we generate, never user input.
 */
export function lockedSql(alias: string, now: number): string {
  return `EXISTS (SELECT 1 FROM collection_products lcp JOIN collections lco ON lco.id = lcp.collection_id
    WHERE lcp.product_id = ${alias}.id AND lco.is_active = 1 AND lco.lock_products = 1 AND lco.starts_at > ${Math.floor(now)})`;
}

/** Visible on the storefront right now. */
export function visibleSql(alias: string, now: number): string {
  return `(${alias}.status = 'published' OR (${alias}.status = 'scheduled' AND ${alias}.publish_at <= ${Math.floor(now)})) AND NOT ${lockedSql(alias, now)}`;
}

function toCard(
  p: ProductRow,
  image: ImageRow | undefined,
  colors: string[],
  available: number,
  rating: { avg: number; count: number } | undefined,
  badge: ProductBadge | null,
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
    badge,
    labels: [],
    flash: null,
  };
}

/* ───────────── Flash sales ───────────── */

/** promotions.config of a "flash_sale": which products, how much off, how many pieces at that price. */
export interface FlashConfig {
  productIds: number[];
  percent: number;
  /** pieces per product at the sale price (null = until the end) */
  limit: number | null;
}

export function parseFlashConfig(raw: string | null): FlashConfig {
  try {
    const c = JSON.parse(raw ?? "{}") as Partial<FlashConfig>;
    return {
      productIds: (c.productIds ?? []).filter((id) => Number.isInteger(id) && id > 0),
      percent: Math.min(90, Math.max(1, Math.round(Number(c.percent) || 0))),
      limit: c.limit != null && Number(c.limit) > 0 ? Math.round(Number(c.limit)) : null,
    };
  } catch {
    return { productIds: [], percent: 1, limit: null };
  }
}

/** Sale price, rounded to 10 DA. */
export function flashPrice(price: number, percent: number): number {
  return Math.max(10, Math.round((price * (100 - percent)) / 1000) * 10);
}

/**
 * Flash sales running now. A product leaves its sale once `limit` pieces were ordered
 * since the sale started (cancelled orders don't count); the earliest-ending sale wins.
 * Sale names are stored "Nom FR | الاسم".
 */
export async function activeFlash(env: Env, now = Date.now()): Promise<{ byProduct: Map<number, FlashInfoDTO>; sales: FlashSaleDTO[] }> {
  const byProduct = new Map<number, FlashInfoDTO>();
  const { results } = await env.DB.prepare(
    "SELECT id, name, config, starts_at, ends_at FROM promotions WHERE kind = 'flash_sale' AND is_active = 1 AND starts_at <= ? AND ends_at > ? ORDER BY ends_at, id",
  )
    .bind(now, now)
    .all<{ id: number; name: string; config: string; starts_at: number; ends_at: number }>();
  const sales = results.map((r) => ({ ...r, cfg: parseFlashConfig(r.config) })).filter((r) => r.cfg.productIds.length);
  if (!sales.length) return { byProduct, sales: [] };
  const soldRes = await env.DB.batch(
    sales.map((r) =>
      env.DB.prepare(
        `SELECT oi.product_id, SUM(oi.qty) AS n FROM order_items oi JOIN orders o ON o.id = oi.order_id
          WHERE o.created_at >= ? AND o.status NOT IN ${CANCELLED} AND oi.product_id IN (${r.cfg.productIds.join(",")})
          GROUP BY oi.product_id`,
      ).bind(r.starts_at),
    ),
  );
  const out: FlashSaleDTO[] = [];
  sales.forEach((r, i) => {
    const sold = new Map((soldRes[i]!.results as { product_id: number; n: number }[]).map((x) => [x.product_id, x.n]));
    const live: number[] = [];
    for (const pid of r.cfg.productIds) {
      if (byProduct.has(pid)) continue;
      const n = sold.get(pid) ?? 0;
      if (r.cfg.limit != null && n >= r.cfg.limit) continue;
      byProduct.set(pid, { saleId: r.id, percent: r.cfg.percent, endsAt: r.ends_at, limit: r.cfg.limit, sold: n });
      live.push(pid);
    }
    if (live.length) {
      const [nameFr, nameAr] = r.name.split(" | ");
      out.push({ id: r.id, nameFr: nameFr!, nameAr: nameAr || nameFr!, percent: r.cfg.percent, endsAt: r.ends_at, productIds: live });
    }
  });
  return { byProduct, sales: out };
}

/** The card with its flash sale applied (sale price, usual price struck through). */
function withFlash<T extends ProductCardDTO>(card: T, flash: FlashInfoDTO | undefined): T {
  if (!flash) return card;
  return { ...card, price: flashPrice(card.price, flash.percent), compareAtPrice: Math.max(card.compareAtPrice ?? 0, card.price), flash };
}

/**
 * Real sales of the last 30 days (non-cancelled orders) → badge per product.
 * Uses orders_created_idx + order_items_order_idx; one small aggregate.
 */
function salesStmt(env: Env, now: number) {
  return env.DB.prepare(
    `SELECT oi.product_id,
            SUM(oi.qty) AS u30,
            SUM(CASE WHEN o.created_at > ?2 THEN oi.qty ELSE 0 END) AS u7,
            SUM(CASE WHEN o.created_at > ?3 AND o.created_at <= ?2 THEN oi.qty ELSE 0 END) AS prev7
       FROM orders o JOIN order_items oi ON oi.order_id = o.id
      WHERE o.created_at > ?1 AND o.status NOT IN ${CANCELLED} AND oi.product_id IS NOT NULL
      GROUP BY oi.product_id`,
  ).bind(now - 30 * 86400_000, now - 7 * 86400_000, now - 14 * 86400_000);
}

function badgeMap(rows: { product_id: number; u30: number; u7: number; prev7: number }[]): Map<number, { badge: ProductBadge | null; units30: number }> {
  const ranked = [...rows].sort((a, b) => b.u30 - a.u30);
  return new Map(ranked.map((r, i) => [r.product_id, { badge: productBadge({ units30: r.u30, units7: r.u7, unitsPrev7: r.prev7 }, i), units30: r.u30 }]));
}

/** All published products as cards. */
export async function listProductCards(env: Env): Promise<ProductCardDTO[]> {
  return productCards(env);
}

/**
 * Product cards, optionally only for some ids (kept in the order given).
 * One D1 round trip (batch of 6 reads).
 */
export async function productCards(env: Env, ids?: number[]): Promise<ProductCardDTO[]> {
  if (ids && !ids.length) return [];
  const now = Date.now();
  const only = (col: string) => (ids ? ` AND ${col} IN (${ids.map(Number).join(",")})` : ""); // ids are integers
  const flashP = activeFlash(env, now);
  const [products, images, colors, stock, ratings, sales, labels] = await env.DB.batch([
    env.DB.prepare(
      `SELECT ${PRODUCT_COLS} FROM products p LEFT JOIN categories c ON c.id = p.category_id
        WHERE ${visibleSql("p", now)}${only("p.id")}
        ORDER BY p.sort, COALESCE(p.published_at, p.created_at) DESC`,
    ),
    env.DB.prepare(`SELECT * FROM product_images WHERE 1 = 1${only("product_id")} ORDER BY product_id, sort, id`),
    env.DB.prepare(
      `SELECT o.product_id, v.hex FROM option_values v JOIN product_options o ON o.id = v.option_id
        WHERE o.kind = 'couleur' AND v.hex IS NOT NULL${only("o.product_id")} ORDER BY o.product_id, v.sort`,
    ),
    env.DB.prepare(
      `SELECT product_id, SUM(MAX(stock_on_hand - stock_reserved, 0)) AS available FROM variants WHERE is_active = 1${only("product_id")} GROUP BY product_id`,
    ),
    env.DB.prepare(`SELECT product_id, AVG(rating) AS avg, COUNT(*) AS count FROM reviews WHERE status = 'approved'${only("product_id")} GROUP BY product_id`),
    salesStmt(env, now),
    env.DB.prepare(
      `SELECT o.product_id, v.label_fr, v.label_ar FROM option_values v JOIN product_options o ON o.id = v.option_id
        WHERE 1 = 1${only("o.product_id")} ORDER BY o.product_id, o.sort, v.sort`,
    ),
  ]);
  const { byProduct: flash } = await flashP;
  const labelMap = new Map<number, string[]>();
  for (const r of labels!.results as { product_id: number; label_fr: string; label_ar: string }[]) {
    const list = labelMap.get(r.product_id) ?? [];
    for (const l of [r.label_fr, r.label_ar]) if (l && !list.includes(l)) list.push(l);
    labelMap.set(r.product_id, list);
  }

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
  const badges = badgeMap(sales!.results as { product_id: number; u30: number; u7: number; prev7: number }[]);

  const cards = (products!.results as unknown as ProductRow[]).map((p) =>
    withFlash(
      { ...toCard(p, firstImage.get(p.id), colorMap.get(p.id) ?? [], stockMap.get(p.id) ?? 0, ratingMap.get(p.id), badges.get(p.id)?.badge ?? null, env), labels: labelMap.get(p.id) ?? [] },
      flash.get(p.id),
    ),
  );
  if (!ids) return cards;
  const byId = new Map(cards.map((c) => [c.id, c]));
  return ids.map((id) => byId.get(id)).filter((c): c is ProductCardDTO => !!c);
}

/**
 * "Complétez le look": hand-picked products first, then products really bought together
 * (same non-cancelled orders), then the best sellers of the same category.
 */
async function relatedProducts(env: Env, p: ProductRow): Promise<{ cards: ProductCardDTO[]; kind: "look" | "similar" }> {
  const manual = (JSON.parse(p.related_ids || "[]") as number[]).filter((id) => Number.isInteger(id) && id !== p.id);
  const [together, sameCategory] = await env.DB.batch([
    env.DB.prepare(
      `SELECT oi2.product_id, COUNT(DISTINCT oi2.order_id) AS n
         FROM order_items oi1 JOIN order_items oi2 ON oi2.order_id = oi1.order_id AND oi2.product_id != oi1.product_id
         JOIN orders o ON o.id = oi1.order_id
        WHERE oi1.product_id = ? AND o.status NOT IN ${CANCELLED} AND oi2.product_id IS NOT NULL
        GROUP BY oi2.product_id ORDER BY n DESC LIMIT 8`,
    ).bind(p.id),
    env.DB.prepare(
      `SELECT p.id, (SELECT COALESCE(SUM(oi.qty), 0) FROM order_items oi JOIN orders o ON o.id = oi.order_id
                      WHERE oi.product_id = p.id AND o.status NOT IN ${CANCELLED} AND o.created_at > ?) AS units
         FROM products p WHERE p.category_id = ? AND p.id != ? AND p.status = 'published'
        ORDER BY units DESC, COALESCE(p.published_at, p.created_at) DESC LIMIT 8`,
    ).bind(Date.now() - 60 * 86400_000, p.category_id ?? 0, p.id),
  ]);
  const look = [...manual, ...(together!.results as { product_id: number }[]).map((r) => r.product_id)];
  const ids = [...new Set([...look, ...(sameCategory!.results as { id: number }[]).map((r) => r.id)])].slice(0, 12);
  const cards = (await productCards(env, ids)).slice(0, 4);
  return { cards, kind: cards.length && look.includes(cards[0]!.id) ? "look" : "similar" };
}

export async function getProductDetail(env: Env, slug: string): Promise<ProductDetailDTO | null> {
  const p = await env.DB.prepare(
    `SELECT ${PRODUCT_COLS} FROM products p LEFT JOIN categories c ON c.id = p.category_id
      WHERE p.slug = ? AND ${visibleSql("p", Date.now())}`,
  )
    .bind(slug)
    .first<ProductRow>();
  if (!p) return null;

  const detail = env.DB.batch([
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
      "SELECT id, name, rating, text, verified, reply, photos, created_at FROM reviews WHERE product_id = ? AND status = 'approved' ORDER BY is_featured DESC, created_at DESC LIMIT 30",
    ).bind(p.id),
    env.DB.prepare("SELECT id, slug, name_fr, name_ar, image FROM categories WHERE id = ?").bind(p.category_id ?? 0),
    salesStmt(env, Date.now()),
    env.DB.prepare('SELECT "table", tips_fr, tips_ar FROM size_guides WHERE id = ?').bind(p.size_guide_id ?? 0),
  ]);
  const [[images, options, values, variants, reviews, category, sales, guide], related, { byProduct: flashMap }] = await Promise.all([
    detail,
    relatedProducts(env, p),
    activeFlash(env),
  ]);
  const flash = flashMap.get(p.id);

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
    price: flash ? flashPrice(v.price_override ?? p.price, flash.percent) : (v.price_override ?? p.price),
    available: Math.max(0, v.stock_on_hand - v.stock_reserved),
  }));
  const revs: ReviewDTO[] = (
    reviews!.results as { id: number; name: string; rating: number; text: string | null; verified: number; reply: string | null; photos: string | null; created_at: number }[]
  ).map((r) => ({
    id: r.id, name: r.name, rating: r.rating, text: r.text, verified: !!r.verified, reply: r.reply, createdAt: r.created_at,
    photos: reviewPhotos(env, r.photos),
  }));
  const cat = (category!.results as { id: number; slug: string; name_fr: string; name_ar: string; image: string | null }[])[0];
  const colorHexes = opts.filter((o) => o.kind === "couleur").flatMap((o) => o.values.map((v) => v.hex).filter((h): h is string => !!h));
  const available = vars.reduce((s, v) => s + v.available, 0);
  const rating = revs.length ? { avg: revs.reduce((s, r) => s + r.rating, 0) / revs.length, count: revs.length } : undefined;

  const badge = badgeMap(sales!.results as { product_id: number; u30: number; u7: number; prev7: number }[]).get(p.id)?.badge ?? null;

  const labels = [...new Set(valueRows.flatMap((v) => [v.label_fr, v.label_ar]))];
  return {
    ...withFlash({ ...toCard(p, imageRows[0], colorHexes, available, rating, badge, env), labels }, flash),
    descriptionFr: p.description_fr,
    descriptionAr: p.description_ar,
    category: cat ? { id: cat.id, slug: cat.slug, nameFr: cat.name_fr, nameAr: cat.name_ar, image: cat.image } : null,
    images: imageRows.map((r) => imageRef(env, r)),
    options: opts,
    variants: vars,
    reviews: revs,
    seoTitle: p.seo_title,
    seoDescription: p.seo_description,
    related: related.cards,
    relatedKind: related.kind,
    sizeGuide: sizeGuideDto((guide!.results as { table: string; tips_fr: string | null; tips_ar: string | null }[])[0]),
    video: p.video_key ? mediaUrl(env, p.video_key) : null,
  };
}

/** reviews.photos (R2 keys, JSON) → media URLs. */
export function reviewPhotos(env: Env, raw: string | null): string[] {
  try {
    const keys = JSON.parse(raw ?? "[]") as unknown;
    return Array.isArray(keys) ? keys.filter((k): k is string => typeof k === "string").map((k) => mediaUrl(env, k)) : [];
  } catch {
    return [];
  }
}

function sizeGuideDto(r: { table: string; tips_fr: string | null; tips_ar: string | null } | undefined): SizeGuideDTO | null {
  if (!r) return null;
  const t = JSON.parse(r.table) as { headers: string[]; headersAr?: string[]; rows: string[][] };
  return { headersFr: t.headers, headersAr: t.headersAr ?? t.headers, rows: t.rows, tipsFr: r.tips_fr, tipsAr: r.tips_ar };
}

/* ───────────── Collections / drops ───────────── */

interface CollectionRow {
  id: number;
  slug: string;
  name_fr: string;
  name_ar: string;
  description_fr: string | null;
  description_ar: string | null;
  starts_at: number | null;
  ends_at: number | null;
  show_countdown: number;
  lock_products: number;
}

const teaser = (r: CollectionRow): DropTeaserDTO => ({
  slug: r.slug,
  nameFr: r.name_fr,
  nameAr: r.name_ar,
  startsAt: r.starts_at,
  endsAt: r.ends_at,
  showCountdown: !!r.show_countdown,
});

export async function getCollection(env: Env, slug: string): Promise<CollectionDTO | null> {
  const now = Date.now();
  const r = await env.DB.prepare("SELECT * FROM collections WHERE slug = ? AND is_active = 1").bind(slug).first<CollectionRow>();
  if (!r) return null;
  const launched = !r.starts_at || r.starts_at <= now;
  const { results } = await env.DB.prepare("SELECT product_id FROM collection_products WHERE collection_id = ? ORDER BY sort, product_id")
    .bind(r.id)
    .all<{ product_id: number }>();
  // a locked drop shows nothing but its countdown until launch
  const products = !launched && r.lock_products ? [] : await productCards(env, results.map((x) => x.product_id));
  return {
    ...teaser(r),
    descriptionFr: r.description_fr,
    descriptionAr: r.description_ar,
    launched,
    now,
    image: products.find((p) => p.image)?.image ?? null,
    products,
  };
}

/** Upcoming drop, or one launched in the last 3 days, for the home page banner. */
export async function featuredDrop(env: Env): Promise<DropTeaserDTO | null> {
  const now = Date.now();
  const r = await env.DB.prepare(
    `SELECT * FROM collections WHERE is_active = 1 AND starts_at IS NOT NULL AND starts_at > ? AND (ends_at IS NULL OR ends_at > ?)
      ORDER BY (starts_at <= ?) ASC, ABS(starts_at - ?) ASC LIMIT 1`,
  )
    .bind(now - 3 * 86400_000, now, now, now)
    .first<CollectionRow>();
  return r ? teaser(r) : null;
}


export async function listCategories(env: Env): Promise<CategoryDTO[]> {
  const { results } = await env.DB.prepare(
    `SELECT c.id, c.parent_id, c.slug, c.name_fr, c.name_ar, c.image, c.season,
            (SELECT COUNT(*) FROM products p WHERE p.status = 'published'
                AND (p.category_id = c.id OR p.category_id IN (SELECT s.id FROM categories s WHERE s.parent_id = c.id AND s.is_active = 1))) AS product_count
       FROM categories c WHERE c.is_active = 1 ORDER BY c.sort, c.id`,
  ).all<{ id: number; parent_id: number | null; slug: string; name_fr: string; name_ar: string; image: string | null; season: "summer" | "winter" | null; product_count: number }>();
  return results.map((c) => ({
    id: c.id, parentId: c.parent_id, slug: c.slug, nameFr: c.name_fr, nameAr: c.name_ar, image: c.image, season: c.season, productCount: c.product_count,
  }));
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
