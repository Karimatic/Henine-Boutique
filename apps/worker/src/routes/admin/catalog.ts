/**
 * Admin → Catalogue: products (with option/variant matrix), photos, categories, stock.
 */
import { Hono } from "hono";
import { z } from "zod";
import { salePrice, slugify } from "@henine/shared";
import type { AppEnv } from "../../env";
import { auditStmt } from "../../lib/audit";
import { imageRef, mediaUrl, variantLabels, type ImageRow } from "../../lib/catalog";
import { randomToken } from "../../lib/crypto";
import { body, HttpError, intParam } from "../../lib/http";
import { putVideo } from "../../lib/media";
import { bumpCatalogStmt } from "../../lib/settings";
import { notifyRestocked } from "../../lib/telegram";
import { sendRestockPushes } from "../../lib/webpush";
import { actorOf, requirePermission } from "../../middleware/access";

export const catalogRoutes = new Hono<AppEnv>();

const text = (max: number) => z.string().trim().max(max);
const optText = (max: number) => z.string().trim().max(max).nullable().optional();
const money = z.number().int().min(0).max(10_000_000);

/* ───────────── Products ───────────── */

catalogRoutes.get("/products", requirePermission("products.view"), async (c) => {
  const q = (c.req.query("q") ?? "").trim();
  const status = c.req.query("status");
  const category = c.req.query("category");
  const where: string[] = [];
  const binds: unknown[] = [];
  if (q) {
    where.push("(p.name_fr LIKE ? OR p.name_ar LIKE ? OR p.slug LIKE ? OR EXISTS (SELECT 1 FROM variants v WHERE v.product_id = p.id AND v.sku LIKE ?))");
    binds.push(`%${q}%`, `%${q}%`, `%${q}%`, `%${q}%`);
  }
  if (status && status !== "all") {
    where.push("p.status = ?");
    binds.push(status);
  } else where.push("p.status != 'archived'");
  if (category) {
    // a main category also lists its sub-categories' products
    where.push("(p.category_id = ? OR p.category_id IN (SELECT id FROM categories WHERE parent_id = ?))");
    binds.push(Number(category), Number(category));
  }
  const stock = c.req.query("stock");
  if (stock === "out") where.push("NOT EXISTS (SELECT 1 FROM variants v WHERE v.product_id = p.id AND v.is_active = 1 AND v.stock_on_hand - v.stock_reserved > 0)");
  if (stock === "low") where.push("EXISTS (SELECT 1 FROM variants v WHERE v.product_id = p.id AND v.is_active = 1 AND v.stock_on_hand - v.stock_reserved <= v.low_stock_threshold)");
  const { results } = await c.env.DB.prepare(
    `SELECT p.id, p.slug, p.name_fr, p.name_ar, p.status, p.price, p.compare_at_price, p.updated_at, c.name_fr AS category, p.category_id, c.sort AS category_sort,
            (SELECT base_key FROM product_images i WHERE i.product_id = p.id ORDER BY sort, id LIMIT 1) AS image_key,
            (SELECT COUNT(*) FROM variants v WHERE v.product_id = p.id AND v.is_active = 1) AS variant_count,
            (SELECT COALESCE(SUM(v.stock_on_hand - v.stock_reserved), 0) FROM variants v WHERE v.product_id = p.id AND v.is_active = 1) AS available,
            (SELECT COALESCE(SUM(oi.qty), 0) FROM order_items oi JOIN orders o ON o.id = oi.order_id
              WHERE oi.product_id = p.id AND o.status NOT IN ('annulee','doublon','fausse')) AS sold
       FROM products p LEFT JOIN categories c ON c.id = p.category_id
      ${where.length ? `WHERE ${where.join(" AND ")}` : ""}
      ORDER BY p.updated_at DESC LIMIT 200`,
  )
    .bind(...binds)
    .all<Record<string, unknown> & { id: number; image_key: string | null }>();
  // which sizes / colours are sold out (shown on each product line)
  const ids = results.map((r) => r.id);
  const out = ids.length
    ? (
        await c.env.DB.prepare(
          `SELECT id, product_id FROM variants WHERE is_active = 1 AND stock_on_hand - stock_reserved <= 0 AND product_id IN (${ids.map(() => "?").join(",")})`,
        )
          .bind(...ids)
          .all<{ id: number; product_id: number }>()
      ).results
    : [];
  const outLabels = await variantLabels(c.env, out.map((v) => v.id));
  return c.json(
    results.map((r) => ({
      ...r,
      image: r.image_key ? mediaUrl(c.env, r.image_key).replace("{w}", "480") : null,
      sold_out: out.filter((v) => v.product_id === r.id).map((v) => outLabels.get(v.id)?.fr ?? "").filter(Boolean),
    })),
  );
});

async function loadProduct(c: { env: AppEnv["Bindings"] }, id: number) {
  const p = await c.env.DB.prepare("SELECT * FROM products WHERE id = ?").bind(id).first<Record<string, unknown>>();
  if (!p) throw new HttpError(404, "not_found");
  const [options, values, variants, images] = await c.env.DB.batch([
    c.env.DB.prepare("SELECT * FROM product_options WHERE product_id = ? ORDER BY sort, id").bind(id),
    c.env.DB.prepare("SELECT v.* FROM option_values v JOIN product_options o ON o.id = v.option_id WHERE o.product_id = ? ORDER BY v.sort, v.id").bind(id),
    c.env.DB.prepare("SELECT * FROM variants WHERE product_id = ? ORDER BY id").bind(id),
    c.env.DB.prepare("SELECT * FROM product_images WHERE product_id = ? ORDER BY sort, id").bind(id),
  ]);
  const vals = values!.results as { id: number; option_id: number; label_fr: string; label_ar: string; hex: string | null; sort: number }[];
  return {
    id: p.id,
    slug: p.slug,
    nameFr: p.name_fr,
    nameAr: p.name_ar,
    descriptionFr: p.description_fr ?? "",
    descriptionAr: p.description_ar ?? "",
    status: p.status,
    categoryId: p.category_id,
    tags: JSON.parse((p.tags as string) || "[]"),
    price: p.price,
    compareAtPrice: p.compare_at_price,
    costPrice: p.cost_price,
    seoTitle: p.seo_title,
    seoDescription: p.seo_description,
    instagramUrl: p.instagram_url,
    relatedIds: JSON.parse((p.related_ids as string) || "[]") as number[],
    sizeGuideId: (p.size_guide_id as number | null) ?? null,
    publishedAt: p.published_at as number | null,
    video: p.video_key ? mediaUrl(c.env, p.video_key as string) : null,
    options: (options!.results as { id: number; kind: string; name_fr: string; name_ar: string }[]).map((o) => ({
      id: o.id,
      kind: o.kind,
      nameFr: o.name_fr,
      nameAr: o.name_ar,
      values: vals.filter((v) => v.option_id === o.id).map((v) => ({ ref: `v:${v.id}`, id: v.id, labelFr: v.label_fr, labelAr: v.label_ar, hex: v.hex })),
    })),
    variants: (
      variants!.results as {
        id: number; sku: string; barcode: string | null; option_value_ids: string; price_override: number | null;
        stock_on_hand: number; stock_reserved: number; low_stock_threshold: number; is_active: number;
      }[]
    ).map((v) => ({
      id: v.id,
      sku: v.sku,
      barcode: v.barcode,
      refs: (JSON.parse(v.option_value_ids) as number[]).map((x) => `v:${x}`),
      priceOverride: v.price_override,
      stockOnHand: v.stock_on_hand,
      stockReserved: v.stock_reserved,
      lowStockThreshold: v.low_stock_threshold,
      isActive: !!v.is_active,
    })),
    images: (images!.results as unknown as ImageRow[]).map((r) => ({ id: r.id, ...imageRef(c.env, r) })),
  };
}

catalogRoutes.get("/products/:id", requirePermission("products.view"), async (c) => c.json(await loadProduct(c, intParam(c, "id"))));

const productInput = z.object({
  nameFr: text(120).min(2),
  nameAr: text(120),
  slug: text(90).optional(),
  descriptionFr: text(5000).default(""),
  descriptionAr: text(5000).default(""),
  status: z.enum(["draft", "published", "archived"]),
  categoryId: z.number().int().positive().nullable(),
  tags: z.array(text(30)).max(10).default([]),
  price: money,
  compareAtPrice: money.nullable().optional(),
  costPrice: money.nullable().optional(),
  seoTitle: optText(120),
  seoDescription: optText(300),
  instagramUrl: optText(300),
  /** hand-picked "Complétez le look" products */
  relatedIds: z.array(z.number().int().positive()).max(12).default([]),
  /** size chart shown on the product page */
  sizeGuideId: z.number().int().positive().nullable().default(null),
  options: z
    .array(
      z.object({
        id: z.number().int().positive().optional(),
        kind: z.enum(["taille", "couleur", "autre"]),
        nameFr: text(40).min(1),
        nameAr: text(40),
        values: z
          .array(
            z.object({
              ref: text(40).min(1),
              labelFr: text(40).min(1),
              labelAr: text(40),
              hex: z.string().regex(/^#[0-9a-fA-F]{6}$/).nullable().optional(),
            }),
          )
          .min(1)
          .max(30),
      }),
    )
    .max(3),
  variants: z
    .array(
      z.object({
        id: z.number().int().positive().optional(),
        refs: z.array(text(40)).max(3),
        sku: text(60).optional(),
        barcode: optText(60),
        priceOverride: money.nullable().optional(),
        stockOnHand: z.number().int().min(0).max(100_000),
        lowStockThreshold: z.number().int().min(0).max(1000).default(2),
        isActive: z.boolean().default(true),
      }),
    )
    .min(1)
    .max(200),
});
type ProductInput = z.infer<typeof productInput>;

async function nextIds(env: AppEnv["Bindings"]) {
  const r = await env.DB.prepare(
    `SELECT (SELECT COALESCE(MAX(id), 0) FROM products) AS p, (SELECT COALESCE(MAX(id), 0) FROM product_options) AS o,
            (SELECT COALESCE(MAX(id), 0) FROM option_values) AS v, (SELECT COALESCE(MAX(id), 0) FROM variants) AS var`,
  ).first<{ p: number; o: number; v: number; var: number }>();
  return { product: r!.p + 1, option: r!.o + 1, value: r!.v + 1, variant: r!.var + 1 };
}

async function saveProduct(c: Parameters<typeof body>[0], existingId: number | null, input: ProductInput) {
  const env = c.env;
  const actor = actorOf(c.get("member"));
  const now = Date.now();
  const ids = await nextIds(env);
  const productId = existingId ?? ids.product;
  const slug = slugify(input.slug || input.nameFr) || `produit-${productId}`;

  const dup = await env.DB.prepare("SELECT id FROM products WHERE slug = ? AND id != ?").bind(slug, productId).first();
  if (dup) throw new HttpError(409, "slug_taken");

  const current = existingId ? await loadProduct(c, existingId) : null;
  const stmts: D1PreparedStatement[] = [];

  if (existingId) {
    stmts.push(
      env.DB.prepare(
        `UPDATE products SET slug = ?, name_fr = ?, name_ar = ?, description_fr = ?, description_ar = ?, status = ?, category_id = ?, tags = ?,
           price = ?, compare_at_price = ?, cost_price = ?, seo_title = ?, seo_description = ?, instagram_url = ?, related_ids = ?, size_guide_id = ?,
           published_at = COALESCE(published_at, CASE WHEN ? = 'published' THEN ? END), updated_at = ? WHERE id = ?`,
      ).bind(
        slug, input.nameFr, input.nameAr || input.nameFr, input.descriptionFr, input.descriptionAr, input.status, input.categoryId,
        JSON.stringify(input.tags), input.price, input.compareAtPrice ?? null, input.costPrice ?? null, input.seoTitle ?? null,
        input.seoDescription ?? null, input.instagramUrl ?? null, JSON.stringify(input.relatedIds.filter((x) => x !== productId)), input.sizeGuideId,
        input.status, now, now, productId,
      ),
    );
  } else {
    stmts.push(
      env.DB.prepare(
        `INSERT INTO products (id, slug, name_fr, name_ar, description_fr, description_ar, status, category_id, tags, price, compare_at_price,
           cost_price, seo_title, seo_description, instagram_url, related_ids, size_guide_id, published_at, created_by, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ).bind(
        productId, slug, input.nameFr, input.nameAr || input.nameFr, input.descriptionFr, input.descriptionAr, input.status, input.categoryId,
        JSON.stringify(input.tags), input.price, input.compareAtPrice ?? null, input.costPrice ?? null, input.seoTitle ?? null,
        input.seoDescription ?? null, input.instagramUrl ?? null, JSON.stringify(input.relatedIds), input.sizeGuideId, input.status === "published" ? now : null,
        c.get("member").id, now, now,
      ),
    );
  }

  // ── options & values: upsert with explicit ids, delete what disappeared
  const refToId = new Map<string, number>();
  const keptOptionIds = new Set<number>();
  const keptValueIds = new Set<number>();
  const existingOptionIds = new Set(current?.options.map((o) => o.id) ?? []);
  const existingValueIds = new Set(current?.options.flatMap((o) => o.values.map((v) => v.id)) ?? []);
  let nextOption = ids.option;
  let nextValue = ids.value;
  input.options.forEach((o, oi) => {
    const optionId = o.id && existingOptionIds.has(o.id) ? o.id : nextOption++;
    keptOptionIds.add(optionId);
    stmts.push(
      env.DB.prepare(
        `INSERT INTO product_options (id, product_id, kind, name_fr, name_ar, sort) VALUES (?, ?, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET kind = excluded.kind, name_fr = excluded.name_fr, name_ar = excluded.name_ar, sort = excluded.sort`,
      ).bind(optionId, productId, o.kind, o.nameFr, o.nameAr || o.nameFr, oi),
    );
    o.values.forEach((v, vi) => {
      const m = /^v:(\d+)$/.exec(v.ref);
      const existing = m && existingValueIds.has(Number(m[1])) ? Number(m[1]) : null;
      const valueId = existing ?? nextValue++;
      refToId.set(v.ref, valueId);
      keptValueIds.add(valueId);
      stmts.push(
        env.DB.prepare(
          `INSERT INTO option_values (id, option_id, label_fr, label_ar, hex, sort) VALUES (?, ?, ?, ?, ?, ?)
           ON CONFLICT(id) DO UPDATE SET option_id = excluded.option_id, label_fr = excluded.label_fr, label_ar = excluded.label_ar, hex = excluded.hex, sort = excluded.sort`,
        ).bind(valueId, optionId, v.labelFr, v.labelAr || v.labelFr, v.hex ?? null, vi),
      );
    });
  });
  for (const id of existingValueIds) {
    if (!keptValueIds.has(id)) {
      stmts.push(env.DB.prepare("UPDATE product_images SET option_value_id = NULL WHERE option_value_id = ?").bind(id));
      stmts.push(env.DB.prepare("DELETE FROM option_values WHERE id = ?").bind(id));
    }
  }
  for (const id of existingOptionIds) if (!keptOptionIds.has(id)) stmts.push(env.DB.prepare("DELETE FROM product_options WHERE id = ?").bind(id));

  // ── variants
  const currentVariants = new Map(current?.variants.map((v) => [v.id, v]) ?? []);
  const restocked: number[] = [];
  const keptVariantIds = new Set<number>();
  let nextVariant = ids.variant;
  const labelPrefix = slug.split("-").slice(0, 2).join("-").toUpperCase().slice(0, 12) || `P${productId}`;
  const seenSku = new Set<string>();
  for (const v of input.variants) {
    const valueIds = v.refs.map((r) => {
      const id = refToId.get(r);
      if (!id) throw new HttpError(422, "variant_unknown_value", { ref: r });
      return id;
    });
    const isExisting = v.id != null && currentVariants.has(v.id);
    const variantId = isExisting ? v.id! : nextVariant++;
    keptVariantIds.add(variantId);
    const valueLabels = v.refs.map((r) => input.options.flatMap((o) => o.values).find((x) => x.ref === r)?.labelFr ?? "");
    let sku = (v.sku || `${labelPrefix}-${valueLabels.map((l) => slugify(l).toUpperCase()).join("-")}` || `${labelPrefix}-${variantId}`).toUpperCase();
    if (seenSku.has(sku)) sku = `${sku}-${variantId}`;
    seenSku.add(sku);
    if (isExisting) {
      const before = currentVariants.get(v.id!)!;
      stmts.push(
        env.DB.prepare(
          `UPDATE variants SET sku = ?, barcode = ?, option_value_ids = ?, price_override = ?, stock_on_hand = ?, low_stock_threshold = ?, is_active = ?, updated_at = ? WHERE id = ?`,
        ).bind(sku, v.barcode ?? null, JSON.stringify(valueIds), v.priceOverride ?? null, v.stockOnHand, v.lowStockThreshold, v.isActive ? 1 : 0, now, variantId),
      );
      if (before.stockOnHand - before.stockReserved <= 0 && v.stockOnHand - before.stockReserved > 0) restocked.push(variantId);
      if (before.stockOnHand !== v.stockOnHand) {
        stmts.push(
          env.DB.prepare("INSERT INTO stock_movements (variant_id, delta, reason, note, actor, created_at) VALUES (?, ?, 'ajustement', 'Fiche produit', ?, ?)").bind(
            variantId, v.stockOnHand - before.stockOnHand, actor, now,
          ),
        );
      }
    } else {
      stmts.push(
        env.DB.prepare(
          `INSERT INTO variants (id, product_id, sku, barcode, option_value_ids, price_override, stock_on_hand, stock_reserved, low_stock_threshold, is_active, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, 0, ?, ?, ?)`,
        ).bind(variantId, productId, sku, v.barcode ?? null, JSON.stringify(valueIds), v.priceOverride ?? null, v.stockOnHand, v.lowStockThreshold, v.isActive ? 1 : 0, now),
      );
      if (v.stockOnHand > 0) {
        stmts.push(
          env.DB.prepare("INSERT INTO stock_movements (variant_id, delta, reason, note, actor, created_at) VALUES (?, ?, 'reception', 'Création', ?, ?)").bind(
            variantId, v.stockOnHand, actor, now,
          ),
        );
      }
    }
  }
  // removed variants: delete if never ordered, otherwise deactivate (order history keeps its link)
  const removed = [...currentVariants.keys()].filter((id) => !keptVariantIds.has(id));
  if (removed.length) {
    const ph = removed.map(() => "?").join(",");
    const { results: used } = await env.DB.prepare(`SELECT DISTINCT variant_id FROM order_items WHERE variant_id IN (${ph})`).bind(...removed).all<{ variant_id: number }>();
    const usedSet = new Set(used.map((u) => u.variant_id));
    for (const id of removed) {
      if (usedSet.has(id)) stmts.push(env.DB.prepare("UPDATE variants SET is_active = 0, updated_at = ? WHERE id = ?").bind(now, id));
      else {
        stmts.push(env.DB.prepare("DELETE FROM stock_movements WHERE variant_id = ?").bind(id));
        stmts.push(env.DB.prepare("DELETE FROM stock_alerts WHERE variant_id = ?").bind(id));
        stmts.push(env.DB.prepare("DELETE FROM variants WHERE id = ?").bind(id));
      }
    }
  }

  stmts.push(bumpCatalogStmt(env), auditStmt(env, actor, existingId ? "update" : "create", "product", productId, { name: input.nameFr, status: input.status }));

  try {
    await env.DB.batch(stmts);
  } catch (err) {
    const msg = String((err as Error).message);
    if (msg.includes("variants_stock_ok")) throw new HttpError(409, "stock_below_reserved");
    if (msg.includes("variants.sku")) throw new HttpError(409, "sku_taken");
    if (msg.includes("UNIQUE") || msg.includes("PRIMARY KEY")) throw new HttpError(409, "conflict_retry");
    throw err;
  }
  if (restocked.length) {
    c.executionCtx.waitUntil(notifyRestocked(env, restocked).catch(() => undefined));
    c.executionCtx.waitUntil(sendRestockPushes(env, restocked).catch(() => undefined));
  }
  return productId;
}

catalogRoutes.post("/products", requirePermission("products.edit"), async (c) => {
  const id = await saveProduct(c, null, await body(c, productInput));
  return c.json(await loadProduct(c, id), 201);
});

catalogRoutes.put("/products/:id", requirePermission("products.edit"), async (c) => {
  const id = intParam(c, "id");
  await saveProduct(c, id, await body(c, productInput));
  return c.json(await loadProduct(c, id));
});

catalogRoutes.post("/products/:id/duplicate", requirePermission("products.edit"), async (c) => {
  const src = await loadProduct(c, intParam(c, "id"));
  const copy: ProductInput = {
    nameFr: `${src.nameFr} (copie)`,
    nameAr: String(src.nameAr),
    slug: `${src.slug}-copie-${Date.now().toString(36).slice(-4)}`,
    descriptionFr: String(src.descriptionFr),
    descriptionAr: String(src.descriptionAr),
    status: "draft",
    categoryId: (src.categoryId as number | null) ?? null,
    tags: src.tags as string[],
    price: src.price as number,
    compareAtPrice: src.compareAtPrice as number | null,
    costPrice: src.costPrice as number | null,
    seoTitle: null,
    seoDescription: null,
    instagramUrl: null,
    relatedIds: src.relatedIds,
    sizeGuideId: src.sizeGuideId,
    options: src.options.map((o) => ({ kind: o.kind as "taille" | "couleur" | "autre", nameFr: o.nameFr, nameAr: o.nameAr, values: o.values.map((v) => ({ ref: `n:${v.id}`, labelFr: v.labelFr, labelAr: v.labelAr, hex: v.hex })) })),
    variants: src.variants.map((v) => ({ refs: v.refs.map((r) => r.replace("v:", "n:")), priceOverride: v.priceOverride, stockOnHand: 0, lowStockThreshold: v.lowStockThreshold, isActive: v.isActive })),
  };
  const id = await saveProduct(c, null, copy);

  // photos are shared with the original (same files in R2, never deleted while still used);
  // colour-specific photos follow the copied colour (options and values keep their order)
  if (src.images.length) {
    const dst = await loadProduct(c, id);
    const valueMap = new Map<number, number>();
    src.options.forEach((o, oi) => o.values.forEach((v, vi) => {
      const target = dst.options[oi]?.values[vi];
      if (target) valueMap.set(v.id, target.id);
    }));
    const { results: rows } = await c.env.DB.prepare("SELECT * FROM product_images WHERE product_id = ? ORDER BY sort, id").bind(src.id).all<ImageRow>();
    await c.env.DB.batch([
      ...rows.map((r) =>
        c.env.DB.prepare(
          "INSERT INTO product_images (product_id, option_value_id, base_key, widths, width, height, lqip, alt_fr, alt_ar, sort) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
        ).bind(id, r.option_value_id != null ? (valueMap.get(r.option_value_id) ?? null) : null, r.base_key, r.widths, r.width, r.height, r.lqip, r.alt_fr, r.alt_ar, r.sort),
      ),
      bumpCatalogStmt(c.env),
    ]);
  }
  return c.json({ id }, 201);
});

/** R2 files of these images that no other product still uses (photos can be shared by duplicates). */
async function unusedImageKeys(env: AppEnv["Bindings"], imgs: { base_key: string; widths: string }[]): Promise<string[]> {
  if (!imgs.length) return [];
  const { results } = await env.DB.prepare(`SELECT DISTINCT base_key FROM product_images WHERE base_key IN (${imgs.map(() => "?").join(",")})`)
    .bind(...imgs.map((i) => i.base_key))
    .all<{ base_key: string }>();
  const stillUsed = new Set(results.map((r) => r.base_key));
  return imgs.filter((i) => !stillUsed.has(i.base_key)).flatMap((i) => (JSON.parse(i.widths) as number[]).map((w) => i.base_key.replace("{w}", String(w))));
}

catalogRoutes.delete("/products/:id", requirePermission("products.edit"), async (c) => {
  const id = intParam(c, "id");
  const actor = actorOf(c.get("member"));
  const ordered = await c.env.DB.prepare("SELECT 1 FROM order_items WHERE product_id = ? LIMIT 1").bind(id).first();
  if (ordered) {
    await c.env.DB.batch([
      c.env.DB.prepare("UPDATE products SET status = 'archived', updated_at = ? WHERE id = ?").bind(Date.now(), id),
      bumpCatalogStmt(c.env),
      auditStmt(c.env, actor, "archive", "product", id),
    ]);
    return c.json({ archived: true });
  }
  const { results: imgs } = await c.env.DB.prepare("SELECT base_key, widths FROM product_images WHERE product_id = ?").bind(id).all<{ base_key: string; widths: string }>();
  await c.env.DB.batch([
    c.env.DB.prepare("DELETE FROM stock_movements WHERE variant_id IN (SELECT id FROM variants WHERE product_id = ?)").bind(id),
    c.env.DB.prepare("DELETE FROM stock_alerts WHERE variant_id IN (SELECT id FROM variants WHERE product_id = ?)").bind(id),
    c.env.DB.prepare("DELETE FROM products WHERE id = ?").bind(id),
    bumpCatalogStmt(c.env),
    auditStmt(c.env, actor, "delete", "product", id),
  ]);
  const keys = await unusedImageKeys(c.env, imgs);
  if (keys.length) c.executionCtx.waitUntil(c.env.MEDIA.delete(keys));
  return c.json({ deleted: true });
});

/* ───────────── Photos (R2) ─────────────
 * The admin browser resizes and encodes each photo (480/960/1440 px, WebP or JPEG) and strips
 * EXIF/GPS by re-drawing it on a canvas. The Worker only validates and stores the files.
 */

const MAX_FILE = 1_500_000;
const SIGNATURES: [string, (b: Uint8Array) => boolean][] = [
  ["webp", (b) => b[0] === 0x52 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x46 && b[8] === 0x57 && b[9] === 0x45 && b[10] === 0x42 && b[11] === 0x50],
  ["jpg", (b) => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff],
];

catalogRoutes.post("/products/:id/images", requirePermission("products.edit"), async (c) => {
  const productId = intParam(c, "id");
  const exists = await c.env.DB.prepare("SELECT id FROM products WHERE id = ?").bind(productId).first();
  if (!exists) throw new HttpError(404, "not_found");
  const form = await c.req.formData();
  const width = Number(form.get("width"));
  const height = Number(form.get("height"));
  const lqip = String(form.get("lqip") ?? "");
  const optionValueId = form.get("optionValueId") ? Number(form.get("optionValueId")) : null;
  if (!width || !height || width > 10000 || height > 10000) throw new HttpError(422, "invalid_dimensions");
  if (lqip && (!lqip.startsWith("data:image/") || lqip.length > 3000)) throw new HttpError(422, "invalid_lqip");

  const files: { w: number; data: Uint8Array; ext: string }[] = [];
  for (const w of [480, 960, 1440]) {
    const f = form.get(`w${w}`);
    if (!(f instanceof File)) continue;
    if (f.size > MAX_FILE) throw new HttpError(413, "file_too_large");
    const data = new Uint8Array(await f.arrayBuffer());
    const ext = SIGNATURES.find(([, test]) => test(data))?.[0];
    if (!ext) throw new HttpError(415, "unsupported_image"); // magic bytes, not the declared type
    files.push({ w, data, ext });
  }
  if (!files.length) throw new HttpError(422, "no_files");
  const ext = files[0]!.ext;
  if (files.some((f) => f.ext !== ext)) throw new HttpError(422, "mixed_formats");

  const baseKey = `p/${productId}/${randomToken(9)}-{w}.${ext}`;
  await Promise.all(
    files.map((f) =>
      c.env.MEDIA.put(baseKey.replace("{w}", String(f.w)), f.data, {
        httpMetadata: { contentType: ext === "webp" ? "image/webp" : "image/jpeg", cacheControl: "public, max-age=31536000, immutable" },
      }),
    ),
  );
  const sort = await c.env.DB.prepare("SELECT COALESCE(MAX(sort), -1) + 1 AS s FROM product_images WHERE product_id = ?").bind(productId).first<{ s: number }>();
  const row = await c.env.DB.prepare(
    "INSERT INTO product_images (product_id, option_value_id, base_key, widths, width, height, lqip, sort) VALUES (?, ?, ?, ?, ?, ?, ?, ?) RETURNING *",
  )
    .bind(productId, optionValueId, baseKey, JSON.stringify(files.map((f) => f.w)), width, height, lqip || null, sort?.s ?? 0)
    .first<ImageRow>();
  await c.env.DB.batch([bumpCatalogStmt(c.env), auditStmt(c.env, actorOf(c.get("member")), "upload", "product_image", row!.id, { productId })]);
  return c.json({ id: row!.id, ...imageRef(c.env, row!) }, 201);
});

catalogRoutes.put("/products/:id/images", requirePermission("products.edit"), async (c) => {
  const productId = intParam(c, "id");
  const input = await body(
    c,
    z.array(z.object({ id: z.number().int().positive(), optionValueId: z.number().int().positive().nullable(), altFr: optText(160), altAr: optText(160) })).max(40),
  );
  await c.env.DB.batch([
    ...input.map((img, i) =>
      c.env.DB.prepare("UPDATE product_images SET sort = ?, option_value_id = ?, alt_fr = ?, alt_ar = ? WHERE id = ? AND product_id = ?").bind(
        i, img.optionValueId, img.altFr ?? null, img.altAr ?? null, img.id, productId,
      ),
    ),
    bumpCatalogStmt(c.env),
  ]);
  return c.json({ ok: true });
});

catalogRoutes.delete("/images/:id", requirePermission("products.edit"), async (c) => {
  const id = intParam(c, "id");
  const img = await c.env.DB.prepare("SELECT base_key, widths FROM product_images WHERE id = ?").bind(id).first<{ base_key: string; widths: string }>();
  if (!img) throw new HttpError(404, "not_found");
  await c.env.DB.batch([
    c.env.DB.prepare("DELETE FROM product_images WHERE id = ?").bind(id),
    bumpCatalogStmt(c.env),
    auditStmt(c.env, actorOf(c.get("member")), "delete", "product_image", id),
  ]);
  const keys = await unusedImageKeys(c.env, [img]);
  if (keys.length) c.executionCtx.waitUntil(c.env.MEDIA.delete(keys));
  return c.json({ ok: true });
});

/* ───────────── Size guides ───────────── */

interface SizeGuideRow {
  id: number;
  name: string;
  table: string;
  tips_fr: string | null;
  tips_ar: string | null;
}

const sizeGuideOut = (r: SizeGuideRow & { product_count?: number }) => {
  const t = JSON.parse(r.table) as { headers: string[]; headersAr?: string[]; rows: string[][] };
  return { id: r.id, name: r.name, headersFr: t.headers, headersAr: t.headersAr ?? t.headers, rows: t.rows, tipsFr: r.tips_fr, tipsAr: r.tips_ar, productCount: r.product_count ?? 0 };
};

catalogRoutes.get("/size-guides", requirePermission("products.view"), async (c) => {
  const { results } = await c.env.DB.prepare(
    "SELECT g.*, (SELECT COUNT(*) FROM products p WHERE p.size_guide_id = g.id) AS product_count FROM size_guides g ORDER BY g.name",
  ).all<SizeGuideRow & { product_count: number }>();
  return c.json(results.map(sizeGuideOut));
});

const cell = z.string().trim().max(40);
const sizeGuideInput = z
  .object({
    name: text(60).min(2),
    headersFr: z.array(cell.min(1)).min(2).max(8),
    headersAr: z.array(cell).max(8),
    rows: z.array(z.array(cell)).min(1).max(30),
    tipsFr: optText(600),
    tipsAr: optText(600),
  })
  .refine((g) => g.rows.every((r) => r.length === g.headersFr.length) && g.headersAr.length === g.headersFr.length, "columns_mismatch");

function sizeGuideStmt(env: AppEnv["Bindings"], id: number | null, g: z.infer<typeof sizeGuideInput>) {
  const table = JSON.stringify({ headers: g.headersFr, headersAr: g.headersAr.map((h, i) => h || g.headersFr[i]!), rows: g.rows });
  return id
    ? env.DB.prepare("UPDATE size_guides SET name = ?, \"table\" = ?, tips_fr = ?, tips_ar = ? WHERE id = ?").bind(g.name, table, g.tipsFr ?? null, g.tipsAr ?? null, id)
    : env.DB.prepare("INSERT INTO size_guides (name, \"table\", tips_fr, tips_ar) VALUES (?, ?, ?, ?) RETURNING id").bind(g.name, table, g.tipsFr ?? null, g.tipsAr ?? null);
}

catalogRoutes.post("/size-guides", requirePermission("products.edit"), async (c) => {
  const input = await body(c, sizeGuideInput);
  const row = await sizeGuideStmt(c.env, null, input).first<{ id: number }>();
  await auditStmt(c.env, actorOf(c.get("member")), "create", "size_guide", row!.id).run();
  return c.json({ id: row!.id }, 201);
});

catalogRoutes.put("/size-guides/:id", requirePermission("products.edit"), async (c) => {
  const id = intParam(c, "id");
  const input = await body(c, sizeGuideInput);
  await c.env.DB.batch([sizeGuideStmt(c.env, id, input), bumpCatalogStmt(c.env), auditStmt(c.env, actorOf(c.get("member")), "update", "size_guide", id)]);
  return c.json({ ok: true });
});

catalogRoutes.delete("/size-guides/:id", requirePermission("products.edit"), async (c) => {
  const id = intParam(c, "id");
  await c.env.DB.batch([
    c.env.DB.prepare("UPDATE products SET size_guide_id = NULL WHERE size_guide_id = ?").bind(id),
    c.env.DB.prepare("DELETE FROM size_guides WHERE id = ?").bind(id),
    bumpCatalogStmt(c.env),
    auditStmt(c.env, actorOf(c.get("member")), "delete", "size_guide", id),
  ]);
  return c.json({ ok: true });
});

/* ───────────── Clearance sale: several products at once ───────────── */

/**
 * "Mettre en promo −X %": the usual price becomes the crossed-out price and the sale price
 * applies (rounded to 50 DA). "Retirer la promo" puts the usual price back.
 */
catalogRoutes.post("/products/sale", requirePermission("products.edit"), async (c) => {
  const input = await body(
    c,
    z.union([
      z.object({ ids: z.array(z.number().int().positive()).min(1).max(200), percent: z.number().int().min(1).max(90) }),
      z.object({ ids: z.array(z.number().int().positive()).min(1).max(200), restore: z.literal(true) }),
    ]),
  );
  const ph = input.ids.map(() => "?").join(",");
  const { results } = await c.env.DB.prepare(`SELECT id, price, compare_at_price FROM products WHERE id IN (${ph})`)
    .bind(...input.ids)
    .all<{ id: number; price: number; compare_at_price: number | null }>();
  const now = Date.now();
  const stmts: D1PreparedStatement[] = [];
  for (const p of results) {
    if ("percent" in input) {
      const usual = p.compare_at_price && p.compare_at_price > p.price ? p.compare_at_price : p.price;
      stmts.push(c.env.DB.prepare("UPDATE products SET compare_at_price = ?, price = ?, updated_at = ? WHERE id = ?").bind(usual, salePrice(usual, input.percent), now, p.id));
    } else if (p.compare_at_price && p.compare_at_price > p.price) {
      stmts.push(c.env.DB.prepare("UPDATE products SET price = compare_at_price, compare_at_price = NULL, updated_at = ? WHERE id = ?").bind(now, p.id));
    }
  }
  if (!stmts.length) return c.json({ ok: true, changed: 0 });
  await c.env.DB.batch([
    ...stmts,
    bumpCatalogStmt(c.env),
    auditStmt(c.env, actorOf(c.get("member")), "percent" in input ? "sale" : "sale_end", "product", input.ids.join(","), "percent" in input ? { percent: input.percent } : undefined),
  ]);
  return c.json({ ok: true, changed: stmts.length });
});

/* ───────────── Categories ───────────── */

catalogRoutes.get("/categories", requirePermission("products.view"), async (c) => {
  const { results } = await c.env.DB.prepare(
    `SELECT c.*, (SELECT COUNT(*) FROM products p WHERE p.category_id = c.id AND p.status != 'archived') AS product_count
       FROM categories c ORDER BY c.sort, c.id`,
  ).all();
  return c.json(results);
});

const categoryInput = z.object({
  nameFr: text(60).min(2),
  nameAr: text(60),
  slug: text(60).optional(),
  descriptionFr: optText(500),
  descriptionAr: optText(500),
  sort: z.number().int().min(0).max(1000).default(0),
  isActive: z.boolean().default(true),
  /** sub-category of a main category (two levels only) */
  parentId: z.number().int().positive().nullable().default(null),
  season: z.enum(["summer", "winter"]).nullable().default(null),
});

/** A parent must be a main category (not itself, not a sub-category); a category with sub-categories stays main. */
async function checkParent(env: AppEnv["Bindings"], id: number | null, parentId: number | null) {
  if (parentId == null) return;
  if (parentId === id) throw new HttpError(422, "validation_failed", { parentId: "self" });
  const p = await env.DB.prepare("SELECT parent_id FROM categories WHERE id = ?").bind(parentId).first<{ parent_id: number | null }>();
  if (!p) throw new HttpError(422, "validation_failed", { parentId: "unknown" });
  if (p.parent_id != null) throw new HttpError(422, "validation_failed", { parentId: "two_levels" });
  if (id != null) {
    const kids = await env.DB.prepare("SELECT COUNT(*) AS n FROM categories WHERE parent_id = ?").bind(id).first<{ n: number }>();
    if (kids?.n) throw new HttpError(422, "validation_failed", { parentId: "has_subcategories" });
  }
}

catalogRoutes.post("/categories", requirePermission("content.edit"), async (c) => {
  const input = await body(c, categoryInput);
  const slug = slugify(input.slug || input.nameFr);
  await checkParent(c.env, null, input.parentId);
  try {
    const row = await c.env.DB.prepare(
      "INSERT INTO categories (slug, name_fr, name_ar, description_fr, description_ar, sort, is_active, parent_id, season, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?) RETURNING id",
    )
      .bind(
        slug, input.nameFr, input.nameAr || input.nameFr, input.descriptionFr ?? null, input.descriptionAr ?? null, input.sort, input.isActive ? 1 : 0,
        input.parentId, input.season, Date.now(),
      )
      .first<{ id: number }>();
    await c.env.DB.batch([bumpCatalogStmt(c.env), auditStmt(c.env, actorOf(c.get("member")), "create", "category", row!.id, { slug })]);
    return c.json({ id: row!.id }, 201);
  } catch (err) {
    if (String((err as Error).message).includes("UNIQUE")) throw new HttpError(409, "slug_taken");
    throw err;
  }
});

catalogRoutes.put("/categories/:id", requirePermission("content.edit"), async (c) => {
  const id = intParam(c, "id");
  const input = await body(c, categoryInput);
  await checkParent(c.env, id, input.parentId);
  try {
    await c.env.DB.batch([
      c.env.DB.prepare(
        "UPDATE categories SET slug = ?, name_fr = ?, name_ar = ?, description_fr = ?, description_ar = ?, sort = ?, is_active = ?, parent_id = ?, season = ?, updated_at = ? WHERE id = ?",
      ).bind(
        slugify(input.slug || input.nameFr), input.nameFr, input.nameAr || input.nameFr, input.descriptionFr ?? null, input.descriptionAr ?? null, input.sort,
        input.isActive ? 1 : 0, input.parentId, input.season, Date.now(), id,
      ),
      bumpCatalogStmt(c.env),
      auditStmt(c.env, actorOf(c.get("member")), "update", "category", id),
    ]);
  } catch (err) {
    if (String((err as Error).message).includes("UNIQUE")) throw new HttpError(409, "slug_taken");
    throw err;
  }
  return c.json({ ok: true });
});

catalogRoutes.delete("/categories/:id", requirePermission("content.edit"), async (c) => {
  const id = intParam(c, "id");
  const used = await c.env.DB.prepare("SELECT COUNT(*) AS n FROM products WHERE category_id = ?").bind(id).first<{ n: number }>();
  if (used?.n) throw new HttpError(409, "category_not_empty", { products: used.n });
  const kids = await c.env.DB.prepare("SELECT COUNT(*) AS n FROM categories WHERE parent_id = ?").bind(id).first<{ n: number }>();
  if (kids?.n) throw new HttpError(409, "category_not_empty", { subcategories: kids.n });
  await c.env.DB.batch([
    c.env.DB.prepare("DELETE FROM categories WHERE id = ?").bind(id),
    bumpCatalogStmt(c.env),
    auditStmt(c.env, actorOf(c.get("member")), "delete", "category", id),
  ]);
  return c.json({ ok: true });
});

/* ───────────── Stock ───────────── */

catalogRoutes.get("/stock", requirePermission("stock.view"), async (c) => {
  const q = (c.req.query("q") ?? "").trim();
  const filter = c.req.query("filter") ?? "all";
  const where = ["v.is_active = 1", "p.status != 'archived'"];
  const binds: unknown[] = [];
  if (q) {
    where.push("(p.name_fr LIKE ? OR v.sku LIKE ? OR v.barcode = ?)");
    binds.push(`%${q}%`, `%${q}%`, q);
  }
  if (filter === "low") where.push("v.stock_on_hand - v.stock_reserved <= v.low_stock_threshold AND v.stock_on_hand - v.stock_reserved > 0");
  if (filter === "out") where.push("v.stock_on_hand - v.stock_reserved <= 0");
  if (filter === "waiting") where.push("EXISTS (SELECT 1 FROM stock_alerts a WHERE a.variant_id = v.id AND a.notified_at IS NULL)");
  const { results } = await c.env.DB.prepare(
    `SELECT v.id, v.sku, v.barcode, v.stock_on_hand, v.stock_reserved, v.low_stock_threshold, v.updated_at,
            p.id AS product_id, p.name_fr, p.cost_price, COALESCE(v.price_override, p.price) AS price,
            (SELECT COUNT(*) FROM stock_alerts a WHERE a.variant_id = v.id AND a.notified_at IS NULL) AS waiting
       FROM variants v JOIN products p ON p.id = v.product_id
      WHERE ${where.join(" AND ")}
      ORDER BY (v.stock_on_hand - v.stock_reserved) ASC, p.name_fr LIMIT 500`,
  )
    .bind(...binds)
    .all<{ id: number } & Record<string, unknown>>();
  const labels = await variantLabels(c.env, results.map((r) => r.id));
  const totals = await c.env.DB.prepare(
    `SELECT COALESCE(SUM(v.stock_on_hand), 0) AS units, COALESCE(SUM(v.stock_on_hand * COALESCE(p.cost_price, 0)), 0) AS cost_value,
            COALESCE(SUM(v.stock_on_hand * COALESCE(v.price_override, p.price)), 0) AS retail_value,
            SUM(CASE WHEN v.stock_on_hand - v.stock_reserved <= 0 THEN 1 ELSE 0 END) AS out_count,
            SUM(CASE WHEN v.stock_on_hand - v.stock_reserved > 0 AND v.stock_on_hand - v.stock_reserved <= v.low_stock_threshold THEN 1 ELSE 0 END) AS low_count
       FROM variants v JOIN products p ON p.id = v.product_id WHERE v.is_active = 1 AND p.status != 'archived'`,
  ).first();
  const canSeeCost = c.get("member").permissions.includes("*") || c.get("member").permissions.includes("cost.view");
  return c.json({
    totals: canSeeCost ? totals : { ...totals, cost_value: null },
    rows: results.map((r) => ({ ...r, cost_price: canSeeCost ? r.cost_price : null, options: labels.get(r.id)?.fr ?? "" })),
  });
});

/**
 * Stock by product: each product with its photo and its size × colour table (one cell per
 * variant). Filters keep a product when at least one of its variants matches.
 */
catalogRoutes.get("/stock/products", requirePermission("stock.view"), async (c) => {
  const q = (c.req.query("q") ?? "").trim();
  const filter = c.req.query("filter") ?? "all";
  const category = Number(c.req.query("category") ?? 0) || null;
  const where = ["p.status != 'archived'"];
  const binds: unknown[] = [];
  if (q) {
    where.push("(p.name_fr LIKE ? OR p.name_ar LIKE ? OR EXISTS (SELECT 1 FROM variants v WHERE v.product_id = p.id AND (v.sku LIKE ? OR v.barcode = ?)))");
    binds.push(`%${q}%`, `%${q}%`, `%${q}%`, q);
  }
  if (category) {
    where.push("p.category_id = ?");
    binds.push(category);
  }
  const has = (cond: string) => `EXISTS (SELECT 1 FROM variants v WHERE v.product_id = p.id AND v.is_active = 1 AND ${cond})`;
  if (filter === "low") where.push(has("v.stock_on_hand - v.stock_reserved > 0 AND v.stock_on_hand - v.stock_reserved <= v.low_stock_threshold"));
  if (filter === "out") where.push(has("v.stock_on_hand - v.stock_reserved <= 0"));
  if (filter === "waiting") where.push(has("EXISTS (SELECT 1 FROM stock_alerts a WHERE a.variant_id = v.id AND a.notified_at IS NULL)"));
  const products = await c.env.DB.prepare(
    `SELECT p.id, p.name_fr, p.name_ar, p.status, p.price, c.name_fr AS category,
            (SELECT base_key FROM product_images i WHERE i.product_id = p.id ORDER BY sort, id LIMIT 1) AS image_key
       FROM products p LEFT JOIN categories c ON c.id = p.category_id
      WHERE ${where.join(" AND ")}
      ORDER BY COALESCE(c.sort, 999), p.name_fr LIMIT 150`,
  )
    .bind(...binds)
    .all<{ id: number; name_fr: string; name_ar: string; status: string; price: number; category: string | null; image_key: string | null }>();
  const ids = products.results.map((p) => p.id);
  if (!ids.length) return c.json({ products: [] });
  const ph = ids.map(() => "?").join(",");
  const [options, values, variants] = await c.env.DB.batch([
    c.env.DB.prepare(`SELECT id, product_id, kind, name_fr FROM product_options WHERE product_id IN (${ph}) ORDER BY product_id, sort, id`).bind(...ids),
    c.env.DB.prepare(
      `SELECT v.id, v.option_id, v.label_fr, v.hex FROM option_values v JOIN product_options o ON o.id = v.option_id WHERE o.product_id IN (${ph}) ORDER BY v.sort, v.id`,
    ).bind(...ids),
    c.env.DB.prepare(
      `SELECT v.id, v.product_id, v.sku, v.option_value_ids, v.stock_on_hand, v.stock_reserved, v.low_stock_threshold, v.is_active,
              (SELECT COUNT(*) FROM stock_alerts a WHERE a.variant_id = v.id AND a.notified_at IS NULL) AS waiting
         FROM variants v WHERE v.product_id IN (${ph}) ORDER BY v.id`,
    ).bind(...ids),
  ]);
  const opts = options!.results as { id: number; product_id: number; kind: string; name_fr: string }[];
  const vals = values!.results as { id: number; option_id: number; label_fr: string; hex: string | null }[];
  const vars = variants!.results as { id: number; product_id: number; sku: string; option_value_ids: string; stock_on_hand: number; stock_reserved: number; low_stock_threshold: number; is_active: number; waiting: number }[];
  return c.json({
    products: products.results.map((p) => ({
      id: p.id,
      name: p.name_fr,
      nameAr: p.name_ar,
      status: p.status,
      price: p.price,
      category: p.category,
      image: p.image_key ? mediaUrl(c.env, p.image_key).replace("{w}", "480") : null,
      options: opts
        .filter((o) => o.product_id === p.id)
        .map((o) => ({ id: o.id, kind: o.kind, name: o.name_fr, values: vals.filter((v) => v.option_id === o.id).map((v) => ({ id: v.id, label: v.label_fr, hex: v.hex })) })),
      variants: vars
        .filter((v) => v.product_id === p.id)
        .map((v) => ({
          id: v.id, sku: v.sku, valueIds: JSON.parse(v.option_value_ids) as number[], onHand: v.stock_on_hand, reserved: v.stock_reserved,
          low: v.low_stock_threshold, active: !!v.is_active, waiting: v.waiting,
        })),
    })),
  });
});

/**
 * Several stock changes at once: the size × colour table ("set" = counted quantity) or a
 * delivery ("add"). One database batch; each line keeps its history and back-in-stock alerts.
 */
catalogRoutes.post("/stock/batch", requirePermission("stock.edit"), async (c) => {
  const input = await body(
    c,
    z.object({
      reason: z.enum(["reception", "ajustement", "casse", "retour", "inventaire"]),
      note: optText(200),
      lines: z
        .array(z.object({ variantId: z.number().int().positive(), mode: z.enum(["add", "set"]), qty: z.number().int().min(0).max(100_000) }))
        .min(1)
        .max(300),
    }),
  );
  const ids = [...new Set(input.lines.map((l) => l.variantId))];
  const { results } = await c.env.DB.prepare(`SELECT id, stock_on_hand, stock_reserved FROM variants WHERE id IN (${ids.map(() => "?").join(",")})`)
    .bind(...ids)
    .all<{ id: number; stock_on_hand: number; stock_reserved: number }>();
  const current = new Map(results.map((v) => [v.id, v]));
  const actor = actorOf(c.get("member"));
  const now = Date.now();
  const stmts: D1PreparedStatement[] = [];
  const restocked: number[] = [];
  let pieces = 0;
  const planned = new Map<number, number>(); // several lines on one variant add up
  for (const l of input.lines) {
    const v = current.get(l.variantId);
    if (!v) throw new HttpError(404, "not_found", { variantId: l.variantId });
    const before = planned.get(v.id) ?? v.stock_on_hand;
    const target = l.mode === "set" ? l.qty : before + l.qty;
    if (target < v.stock_reserved) throw new HttpError(409, "stock_below_reserved", { variantId: v.id, reserved: v.stock_reserved });
    planned.set(v.id, target);
  }
  for (const [id, target] of planned) {
    const v = current.get(id)!;
    const delta = target - v.stock_on_hand;
    if (!delta) continue;
    pieces += Math.max(0, delta);
    if (v.stock_on_hand - v.stock_reserved <= 0 && target - v.stock_reserved > 0) restocked.push(id);
    stmts.push(
      c.env.DB.prepare("UPDATE variants SET stock_on_hand = ?, updated_at = ? WHERE id = ? AND stock_on_hand = ?").bind(target, now, id, v.stock_on_hand),
      c.env.DB.prepare("INSERT INTO stock_movements (variant_id, delta, reason, note, actor, created_at) VALUES (?, ?, ?, ?, ?, ?)").bind(
        id, delta, input.reason, input.note ?? null, actor, now,
      ),
    );
  }
  if (!stmts.length) return c.json({ changed: 0, pieces: 0 });
  await c.env.DB.batch([...stmts, bumpCatalogStmt(c.env)]);
  if (restocked.length) {
    c.executionCtx.waitUntil(notifyRestocked(c.env, restocked).catch(() => undefined));
    c.executionCtx.waitUntil(sendRestockPushes(c.env, restocked).catch(() => undefined));
  }
  return c.json({ changed: stmts.length / 2, pieces });
});

catalogRoutes.post("/stock/:variantId/adjust", requirePermission("stock.edit"), async (c) => {
  const variantId = intParam(c, "variantId");
  const input = await body(
    c,
    z.object({
      mode: z.enum(["add", "remove", "set"]),
      qty: z.number().int().min(0).max(100_000),
      reason: z.enum(["reception", "ajustement", "casse", "retour", "inventaire"]),
      note: optText(200),
    }),
  );
  const v = await c.env.DB.prepare("SELECT stock_on_hand, stock_reserved FROM variants WHERE id = ?").bind(variantId).first<{ stock_on_hand: number; stock_reserved: number }>();
  if (!v) throw new HttpError(404, "not_found");
  const target = input.mode === "set" ? input.qty : input.mode === "add" ? v.stock_on_hand + input.qty : v.stock_on_hand - input.qty;
  if (target < v.stock_reserved) throw new HttpError(409, "stock_below_reserved", { reserved: v.stock_reserved });
  const delta = target - v.stock_on_hand;
  if (delta === 0) return c.json({ stockOnHand: target });
  const backInStock = v.stock_on_hand - v.stock_reserved <= 0 && target - v.stock_reserved > 0;
  if (backInStock) c.executionCtx.waitUntil(notifyRestocked(c.env, [variantId]).catch(() => undefined));

  const actor = actorOf(c.get("member"));
  await c.env.DB.batch([
    c.env.DB.prepare("UPDATE variants SET stock_on_hand = ?, updated_at = ? WHERE id = ? AND stock_on_hand = ?").bind(target, Date.now(), variantId, v.stock_on_hand),
    c.env.DB.prepare("INSERT INTO stock_movements (variant_id, delta, reason, note, actor, created_at) VALUES (?, ?, ?, ?, ?, ?)").bind(
      variantId, delta, input.reason, input.note ?? null, actor, Date.now(),
    ),
    bumpCatalogStmt(c.env),
  ]);
  // after the update: the push only goes out once the stock is really there
  if (backInStock) c.executionCtx.waitUntil(sendRestockPushes(c.env, [variantId]).catch(() => undefined));
  return c.json({ stockOnHand: target });
});

catalogRoutes.get("/stock/movements", requirePermission("stock.view"), async (c) => {
  const variantId = c.req.query("variant");
  const { results } = await c.env.DB.prepare(
    `SELECT m.id, m.variant_id, m.delta, m.reason, m.note, m.actor, m.created_at, v.sku, p.name_fr, o.public_code
       FROM stock_movements m JOIN variants v ON v.id = m.variant_id JOIN products p ON p.id = v.product_id
       LEFT JOIN orders o ON o.id = m.order_id
      ${variantId ? "WHERE m.variant_id = ?" : ""} ORDER BY m.id DESC LIMIT 100`,
  )
    .bind(...(variantId ? [Number(variantId)] : []))
    .all();
  return c.json(results);
});

/* ───────────── Product video (one short clip, shown in the gallery) ───────────── */

catalogRoutes.post("/products/:id/video", requirePermission("products.edit"), async (c) => {
  const id = intParam(c, "id");
  const old = await c.env.DB.prepare("SELECT video_key FROM products WHERE id = ?").bind(id).first<{ video_key: string | null }>();
  if (!old) throw new HttpError(404, "not_found");
  const form = await c.req.formData().catch(() => null);
  const file = form?.get("video");
  if (!file || typeof file === "string") throw new HttpError(400, "video_required");
  const key = await putVideo(c.env, `products/${id}/video`, file);
  await c.env.DB.batch([
    c.env.DB.prepare("UPDATE products SET video_key = ?, updated_at = ? WHERE id = ?").bind(key, Date.now(), id),
    bumpCatalogStmt(c.env),
    auditStmt(c.env, actorOf(c.get("member")), "update", "product_video", id),
  ]);
  if (old.video_key) c.executionCtx.waitUntil(c.env.MEDIA.delete(old.video_key).catch(() => undefined));
  return c.json({ video: mediaUrl(c.env, key) });
});

catalogRoutes.delete("/products/:id/video", requirePermission("products.edit"), async (c) => {
  const id = intParam(c, "id");
  const old = await c.env.DB.prepare("SELECT video_key FROM products WHERE id = ?").bind(id).first<{ video_key: string | null }>();
  if (!old) throw new HttpError(404, "not_found");
  await c.env.DB.batch([
    c.env.DB.prepare("UPDATE products SET video_key = NULL, updated_at = ? WHERE id = ?").bind(Date.now(), id),
    bumpCatalogStmt(c.env),
    auditStmt(c.env, actorOf(c.get("member")), "delete", "product_video", id),
  ]);
  if (old.video_key) c.executionCtx.waitUntil(c.env.MEDIA.delete(old.video_key).catch(() => undefined));
  return c.json({ ok: true });
});
