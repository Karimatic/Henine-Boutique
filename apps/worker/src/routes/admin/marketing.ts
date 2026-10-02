/**
 * Admin → Marketing (+ Promos): coupons, home page, reviews, notifications, links, contact.
 */
import { Hono } from "hono";
import { z } from "zod";
import { cleanText, slugify } from "@henine/shared";
import type { AppEnv } from "../../env";
import { auditStmt } from "../../lib/audit";
import { variantLabels } from "../../lib/catalog";
import { body, HttpError, intParam } from "../../lib/http";
import { bumpCatalogStmt, getSettings, setSettingStmt } from "../../lib/settings";
import { actorOf, requirePermission } from "../../middleware/access";

export const marketingRoutes = new Hono<AppEnv>();

/* ───────────── Promos: coupons ───────────── */

const couponInput = z.object({
  code: z.string().trim().toUpperCase().regex(/^[A-Z0-9_-]{3,32}$/, "code_format"),
  type: z.enum(["percent", "fixed", "free_shipping"]),
  value: z.number().int().min(0).max(1_000_000),
  minSubtotal: z.number().int().min(0).nullable().optional(),
  usageLimit: z.number().int().min(1).nullable().optional(),
  perCustomerLimit: z.number().int().min(1).nullable().optional(),
  firstOrderOnly: z.boolean().default(false),
  startsAt: z.number().int().nullable().optional(),
  endsAt: z.number().int().nullable().optional(),
  isActive: z.boolean().default(true),
  influencerName: cleanText(60).nullable().optional(),
  commissionPct: z.number().int().min(0).max(100).nullable().optional(),
});

marketingRoutes.get("/coupons", requirePermission("promos.edit"), async (c) => {
  const { results } = await c.env.DB.prepare(
    `SELECT cp.*,
            (SELECT COUNT(*) FROM orders o WHERE o.coupon_code = cp.code AND o.status NOT IN ('annulee','doublon','fausse')) AS orders,
            (SELECT COALESCE(SUM(o.total), 0) FROM orders o WHERE o.coupon_code = cp.code AND o.status NOT IN ('annulee','doublon','fausse')) AS revenue,
            (SELECT COALESCE(SUM(o.discount_total), 0) FROM orders o WHERE o.coupon_code = cp.code AND o.status NOT IN ('annulee','doublon','fausse')) AS discounted
       FROM coupons cp ORDER BY cp.is_active DESC, cp.created_at DESC`,
  ).all();
  const { checkout } = await getSettings(c.env, ["checkout"]);
  return c.json({ coupons: results, freeShippingOver: checkout.free_shipping_over });
});

/**
 * Influencer report for a period: what each one's codes brought. The commission is due on
 * delivered orders only, on the items (after discount, delivery excluded).
 */
marketingRoutes.get("/influencers", requirePermission("promos.edit"), async (c) => {
  const from = Number(c.req.query("from") ?? 0) || 0;
  const to = Number(c.req.query("to") ?? 0) || Date.now() + 1;
  const { results } = await c.env.DB.prepare(
    `SELECT cp.influencer_name AS name, cp.code, COALESCE(cp.commission_pct, 0) AS pct,
            COUNT(o.id) AS orders,
            SUM(CASE WHEN o.status = 'livree' THEN 1 ELSE 0 END) AS delivered,
            SUM(CASE WHEN o.status IN ('retour','retour_recu') THEN 1 ELSE 0 END) AS returned,
            SUM(CASE WHEN o.status IN ('nouvelle','injoignable','confirmee','en_preparation','expediee','en_livraison') THEN 1 ELSE 0 END) AS pending,
            COALESCE(SUM(CASE WHEN o.status = 'livree' THEN o.subtotal - o.discount_total ELSE 0 END), 0) AS delivered_sales,
            COALESCE(SUM(CASE WHEN o.status IN ('nouvelle','injoignable','confirmee','en_preparation','expediee','en_livraison') THEN o.subtotal - o.discount_total ELSE 0 END), 0) AS pending_sales,
            SUM(CASE WHEN o.id = (SELECT MIN(o2.id) FROM orders o2 WHERE o2.customer_id = o.customer_id) THEN 1 ELSE 0 END) AS new_customers
       FROM coupons cp
       LEFT JOIN orders o ON o.coupon_code = cp.code AND o.status NOT IN ('annulee','doublon','fausse') AND o.created_at >= ? AND o.created_at < ?
      WHERE cp.influencer_name IS NOT NULL AND cp.influencer_name != ''
      GROUP BY cp.id
      ORDER BY cp.influencer_name, cp.code`,
  )
    .bind(from, to)
    .all<{
      name: string; code: string; pct: number; orders: number; delivered: number | null; returned: number | null; pending: number | null;
      delivered_sales: number; pending_sales: number; new_customers: number | null;
    }>();
  const people = new Map<string, {
    name: string; codes: string[]; orders: number; delivered: number; returned: number; pending: number; newCustomers: number;
    deliveredSales: number; pendingSales: number; commission: number; pendingCommission: number;
  }>();
  for (const r of results) {
    const key = r.name.trim().toLowerCase();
    const p = people.get(key) ?? {
      name: r.name.trim(), codes: [], orders: 0, delivered: 0, returned: 0, pending: 0, newCustomers: 0, deliveredSales: 0, pendingSales: 0, commission: 0, pendingCommission: 0,
    };
    p.codes.push(r.pct ? `${r.code} (${r.pct} %)` : r.code);
    p.orders += r.orders;
    p.delivered += r.delivered ?? 0;
    p.returned += r.returned ?? 0;
    p.pending += r.pending ?? 0;
    p.newCustomers += r.new_customers ?? 0;
    p.deliveredSales += r.delivered_sales;
    p.pendingSales += r.pending_sales;
    p.commission += Math.round((r.delivered_sales * r.pct) / 100);
    p.pendingCommission += Math.round((r.pending_sales * r.pct) / 100);
    people.set(key, p);
  }
  return c.json([...people.values()].sort((a, b) => b.deliveredSales - a.deliveredSales));
});

async function saveCoupon(c: Parameters<typeof body>[0], id: number | null) {
  const input = await body(c, couponInput);
  if (input.type === "percent" && input.value > 100) throw new HttpError(422, "percent_over_100");
  const vals = [
    input.code, input.type, input.value, input.minSubtotal ?? null, input.usageLimit ?? null, input.perCustomerLimit ?? null,
    input.firstOrderOnly ? 1 : 0, input.startsAt ?? null, input.endsAt ?? null, input.isActive ? 1 : 0, input.influencerName ?? null, input.commissionPct ?? null,
  ];
  try {
    if (id) {
      await c.env.DB.prepare(
        `UPDATE coupons SET code = ?, type = ?, value = ?, min_subtotal = ?, usage_limit = ?, per_customer_limit = ?, first_order_only = ?,
           starts_at = ?, ends_at = ?, is_active = ?, influencer_name = ?, commission_pct = ? WHERE id = ?`,
      )
        .bind(...vals, id)
        .run();
    } else {
      const row = await c.env.DB.prepare(
        `INSERT INTO coupons (code, type, value, min_subtotal, usage_limit, per_customer_limit, first_order_only, starts_at, ends_at, is_active,
           influencer_name, commission_pct, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) RETURNING id`,
      )
        .bind(...vals, Date.now())
        .first<{ id: number }>();
      id = row!.id;
    }
  } catch (err) {
    const msg = String((err as Error).message);
    if (msg.includes("UNIQUE")) throw new HttpError(409, "code_taken");
    if (msg.includes("coupons_usage_ok")) throw new HttpError(409, "limit_below_used");
    throw err;
  }
  await c.env.DB.batch([auditStmt(c.env, actorOf(c.get("member")), "save", "coupon", id, { code: input.code })]);
  return c.json({ id });
}

marketingRoutes.post("/coupons", requirePermission("promos.edit"), (c) => saveCoupon(c, null));
marketingRoutes.put("/coupons/:id", requirePermission("promos.edit"), (c) => saveCoupon(c, intParam(c, "id")));
marketingRoutes.delete("/coupons/:id", requirePermission("promos.edit"), async (c) => {
  const id = intParam(c, "id");
  await c.env.DB.batch([c.env.DB.prepare("DELETE FROM coupons WHERE id = ?").bind(id), auditStmt(c.env, actorOf(c.get("member")), "delete", "coupon", id)]);
  return c.json({ ok: true });
});

/* ───────────── Page d'accueil + checkout options ───────────── */

marketingRoutes.get("/home", requirePermission("marketing.edit"), async (c) => {
  return c.json(await getSettings(c.env, ["announcement", "checkout", "contact", "maintenance", "store", "texts"]));
});

/**
 * Home page switches. The texts themselves (hero, announcement messages, FAQ, pause message)
 * are built into the store and shown in the visitor's language, so only on/off switches and
 * checkout options are saved here.
 */
marketingRoutes.put("/home", requirePermission("marketing.edit"), async (c) => {
  const input = await body(
    c,
    z.object({
      announcement: z.object({ active: z.boolean() }),
      checkout: z.object({
        express_on_product: z.boolean(), desk_enabled: z.boolean(), free_shipping_over: z.number().int().min(0).nullable(),
        max_orders_per_phone_per_hour: z.number().int().min(1).max(20),
      }),
      maintenance: z.object({ active: z.boolean() }),
    }),
  );
  const current = await getSettings(c.env, ["checkout", "announcement", "maintenance"]);
  await c.env.DB.batch([
    setSettingStmt(c.env, "announcement", { ...current.announcement, ...input.announcement }),
    setSettingStmt(c.env, "checkout", { ...current.checkout, ...input.checkout }),
    setSettingStmt(c.env, "maintenance", { ...current.maintenance, ...input.maintenance }),
    bumpCatalogStmt(c.env),
    auditStmt(c.env, actorOf(c.get("member")), "update", "settings", "home"),
  ]);
  return c.json({ ok: true });
});

/**
 * Store texts, one language at a time: only what the team changed is stored, everything
 * else keeps the built-in text of that language (STORE_TEXTS in @henine/shared).
 */
const textsInput = z
  .object({
    eyebrow: cleanText(60),
    title: cleanText(90),
    subtitle: cleanText(240),
    announcement: z.array(cleanText(120)).max(8),
    faq: z.array(z.object({ q: cleanText(200), a: cleanText(1000) })).max(20),
    pause: cleanText(240),
  })
  .partial();

marketingRoutes.put("/home/texts", requirePermission("marketing.edit"), async (c) => {
  const input = await body(c, z.object({ locale: z.enum(["ar", "fr"]), texts: textsInput }));
  const { texts } = await getSettings(c.env, ["texts"]);
  const next = { ...texts, [input.locale]: input.texts };
  await c.env.DB.batch([
    setSettingStmt(c.env, "texts", next),
    bumpCatalogStmt(c.env),
    auditStmt(c.env, actorOf(c.get("member")), "update", "settings", `texts.${input.locale}`, Object.keys(input.texts)),
  ]);
  return c.json(next);
});

/* ───────────── Avis ───────────── */

marketingRoutes.get("/reviews", requirePermission("reviews.moderate"), async (c) => {
  const status = c.req.query("status") ?? "pending";
  const [rows, counts] = await c.env.DB.batch([
    c.env.DB.prepare(
      `SELECT r.*, p.name_fr AS product, p.slug FROM reviews r JOIN products p ON p.id = r.product_id
        ${status === "all" ? "" : "WHERE r.status = ?"} ORDER BY r.created_at DESC LIMIT 100`,
    ).bind(...(status === "all" ? [] : [status])),
    c.env.DB.prepare("SELECT status, COUNT(*) AS n, AVG(rating) AS avg FROM reviews GROUP BY status"),
  ]);
  return c.json({ rows: rows!.results, counts: counts!.results });
});

marketingRoutes.patch("/reviews/:id", requirePermission("reviews.moderate"), async (c) => {
  const id = intParam(c, "id");
  const input = await body(
    c,
    z.object({ status: z.enum(["pending", "approved", "rejected"]).optional(), reply: cleanText(1000).nullable().optional(), isFeatured: z.boolean().optional() }),
  );
  await c.env.DB.batch([
    c.env.DB.prepare(
      "UPDATE reviews SET status = COALESCE(?, status), reply = CASE WHEN ? THEN ? ELSE reply END, is_featured = COALESCE(?, is_featured) WHERE id = ?",
    ).bind(input.status ?? null, "reply" in input ? 1 : 0, input.reply ?? null, input.isFeatured == null ? null : input.isFeatured ? 1 : 0, id),
    bumpCatalogStmt(c.env),
    auditStmt(c.env, actorOf(c.get("member")), "moderate", "review", id, input),
  ]);
  return c.json({ ok: true });
});

marketingRoutes.delete("/reviews/:id", requirePermission("reviews.moderate"), async (c) => {
  const id = intParam(c, "id");
  await c.env.DB.batch([c.env.DB.prepare("DELETE FROM reviews WHERE id = ?").bind(id), bumpCatalogStmt(c.env), auditStmt(c.env, actorOf(c.get("member")), "delete", "review", id)]);
  return c.json({ ok: true });
});

/* ───────────── Notifier: team notifications + back-in-stock waitlists ───────────── */

marketingRoutes.get("/notifier", requirePermission("marketing.edit"), async (c) => {
  const { notifications } = await getSettings(c.env, ["notifications"]);
  const { results } = await c.env.DB.prepare(
    `SELECT a.variant_id, v.sku, p.name_fr, p.id AS product_id, v.stock_on_hand - v.stock_reserved AS available,
            COUNT(*) AS waiting, GROUP_CONCAT(a.phone, ', ') AS phones, MAX(a.created_at) AS last_at
       FROM stock_alerts a JOIN variants v ON v.id = a.variant_id JOIN products p ON p.id = v.product_id
      WHERE a.notified_at IS NULL GROUP BY a.variant_id ORDER BY waiting DESC LIMIT 100`,
  ).all<{ variant_id: number } & Record<string, unknown>>();
  const labels = await variantLabels(c.env, results.map((r) => r.variant_id));
  return c.json({ notifications, waitlists: results.map((r) => ({ ...r, options: labels.get(r.variant_id)?.fr ?? "" })) });
});

marketingRoutes.put("/notifier/settings", requirePermission("marketing.edit"), async (c) => {
  const input = await body(
    c,
    z.object({
      telegram_new_order: z.boolean(), telegram_status_change: z.boolean(), telegram_low_stock: z.boolean(),
      telegram_review: z.boolean(), telegram_contact: z.boolean(), trust_group_members: z.boolean(),
    }),
  );
  await c.env.DB.batch([setSettingStmt(c.env, "notifications", input), auditStmt(c.env, actorOf(c.get("member")), "update", "settings", "notifications", input)]);
  return c.json(input);
});

marketingRoutes.post("/notifier/waitlist/:variantId/notified", requirePermission("marketing.edit"), async (c) => {
  const variantId = intParam(c, "variantId");
  const res = await c.env.DB.prepare("UPDATE stock_alerts SET notified_at = ? WHERE variant_id = ? AND notified_at IS NULL").bind(Date.now(), variantId).run();
  return c.json({ notified: res.meta.changes });
});

/* ───────────── Liens: link in bio + short links ───────────── */

marketingRoutes.get("/links", requirePermission("marketing.edit"), async (c) => {
  const { results } = await c.env.DB.prepare("SELECT * FROM links ORDER BY kind, sort, id").all();
  return c.json(results);
});

const linkInput = z.object({
  kind: z.enum(["bio", "short"]),
  slug: z.string().trim().max(40).nullable().optional(),
  labelFr: cleanText(80).nullable().optional(),
  labelAr: cleanText(80).nullable().optional(),
  target: z
    .string()
    .trim()
    .max(500)
    .refine((t) => t.startsWith("/") || /^https:\/\//.test(t) || /^https:\/\/wa\.me\//.test(t), "target_invalid"),
  icon: z.string().trim().max(20).nullable().optional(),
  sort: z.number().int().min(0).max(1000).default(0),
  isActive: z.boolean().default(true),
});

async function saveLink(c: Parameters<typeof body>[0], id: number | null) {
  const input = await body(c, linkInput);
  const slug = input.kind === "short" ? slugify(input.slug || "") : null;
  if (input.kind === "short" && !slug) throw new HttpError(422, "slug_required");
  const vals = [input.kind, slug, input.labelFr ?? null, input.labelAr ?? null, input.target, input.icon ?? null, input.sort, input.isActive ? 1 : 0];
  try {
    if (id) await c.env.DB.prepare("UPDATE links SET kind = ?, slug = ?, label_fr = ?, label_ar = ?, target = ?, icon = ?, sort = ?, is_active = ? WHERE id = ?").bind(...vals, id).run();
    else {
      const row = await c.env.DB.prepare("INSERT INTO links (kind, slug, label_fr, label_ar, target, icon, sort, is_active, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?) RETURNING id")
        .bind(...vals, Date.now())
        .first<{ id: number }>();
      id = row!.id;
    }
  } catch (err) {
    if (String((err as Error).message).includes("UNIQUE")) throw new HttpError(409, "slug_taken");
    throw err;
  }
  await c.env.DB.batch([bumpCatalogStmt(c.env), auditStmt(c.env, actorOf(c.get("member")), "save", "link", id)]);
  return c.json({ id });
}

marketingRoutes.post("/links", requirePermission("marketing.edit"), (c) => saveLink(c, null));
marketingRoutes.put("/links/:id", requirePermission("marketing.edit"), (c) => saveLink(c, intParam(c, "id")));
marketingRoutes.delete("/links/:id", requirePermission("marketing.edit"), async (c) => {
  const id = intParam(c, "id");
  await c.env.DB.batch([c.env.DB.prepare("DELETE FROM links WHERE id = ?").bind(id), bumpCatalogStmt(c.env), auditStmt(c.env, actorOf(c.get("member")), "delete", "link", id)]);
  return c.json({ ok: true });
});

/* ───────────── Contact: inbox + store contact details ───────────── */

marketingRoutes.get("/contact", requirePermission("contact.view"), async (c) => {
  const status = c.req.query("status") ?? "open";
  const where = status === "open" ? "WHERE status IN ('new','in_progress')" : status === "all" ? "" : "WHERE status = ?";
  const [rows, s] = await Promise.all([
    c.env.DB.prepare(`SELECT * FROM contact_messages ${where} ORDER BY created_at DESC LIMIT 100`)
      .bind(...(where.includes("?") ? [status] : []))
      .all(),
    getSettings(c.env, ["contact", "store"]),
  ]);
  return c.json({ rows: rows.results, contact: s.contact, store: s.store });
});

marketingRoutes.patch("/contact/:id", requirePermission("contact.view"), async (c) => {
  const id = intParam(c, "id");
  const input = await body(c, z.object({ status: z.enum(["new", "in_progress", "done", "spam"]) }));
  await c.env.DB.prepare("UPDATE contact_messages SET status = ?, handled_by = ? WHERE id = ?").bind(input.status, c.get("member").id, id).run();
  return c.json({ ok: true });
});

const optUrl = z.string().trim().max(300).nullable().refine((v) => !v || /^https:\/\//.test(v), "https_required");
marketingRoutes.put("/contact/settings", requirePermission("marketing.edit"), async (c) => {
  const input = await body(
    c,
    z.object({
      contact: z.object({
        phone: cleanText(20).nullable(), whatsapp: cleanText(20).nullable(), instagram: optUrl, tiktok: optUrl, facebook: optUrl, maps: optUrl,
      }),
    }),
  );
  const { contact } = await getSettings(c.env, ["contact"]);
  await c.env.DB.batch([
    setSettingStmt(c.env, "contact", { ...contact, ...input.contact }),
    bumpCatalogStmt(c.env),
    auditStmt(c.env, actorOf(c.get("member")), "update", "settings", "contact"),
  ]);
  return c.json({ ok: true });
});

/* ───────────── Avis: settings ───────────── */

marketingRoutes.get("/reviews/settings", requirePermission("reviews.moderate"), async (c) => c.json((await getSettings(c.env, ["reviews"])).reviews));

marketingRoutes.put("/reviews/settings", requirePermission("reviews.moderate"), async (c) => {
  const input = await body(c, z.object({ auto_approve_verified: z.boolean() }));
  await c.env.DB.batch([setSettingStmt(c.env, "reviews", input), auditStmt(c.env, actorOf(c.get("member")), "update", "settings", "reviews", input)]);
  return c.json(input);
});

/* ───────────── Collections & drops ───────────── */

const collectionInput = z.object({
  slug: z.string().trim().max(80).optional(),
  nameFr: cleanText(80).pipe(z.string().min(2)),
  nameAr: cleanText(80),
  descriptionFr: cleanText(1000).nullable().optional(),
  descriptionAr: cleanText(1000).nullable().optional(),
  startsAt: z.number().int().positive().nullable(),
  endsAt: z.number().int().positive().nullable(),
  showCountdown: z.boolean().default(true),
  lockProducts: z.boolean().default(false),
  isActive: z.boolean(),
  productIds: z.array(z.number().int().positive()).max(100),
});

/**
 * Public caches are keyed on how many of these instants have passed, so a drop's products
 * appear (and the countdown turns into the collection) the moment it starts, with no cron.
 */
async function dropTimesStmt(env: AppEnv["Bindings"]) {
  const { results } = await env.DB.prepare(
    "SELECT starts_at, ends_at FROM collections WHERE is_active = 1 AND (starts_at IS NOT NULL OR ends_at IS NOT NULL)",
  ).all<{ starts_at: number | null; ends_at: number | null }>();
  const times = results.flatMap((r) => [r.starts_at, r.ends_at]).filter((t): t is number => t != null).sort((a, b) => a - b);
  return setSettingStmt(env, "drop_times", times);
}

marketingRoutes.get("/collections", requirePermission("marketing.edit"), async (c) => {
  const [cols, items] = await c.env.DB.batch([
    c.env.DB.prepare("SELECT * FROM collections ORDER BY is_active DESC, COALESCE(starts_at, created_at) DESC, id DESC"),
    c.env.DB.prepare("SELECT collection_id, product_id FROM collection_products ORDER BY collection_id, sort"),
  ]);
  const byCol = new Map<number, number[]>();
  for (const r of items!.results as { collection_id: number; product_id: number }[]) byCol.set(r.collection_id, [...(byCol.get(r.collection_id) ?? []), r.product_id]);
  return c.json((cols!.results as { id: number }[]).map((r) => ({ ...r, product_ids: byCol.get(r.id) ?? [] })));
});

async function saveCollection(c: Parameters<typeof body>[0], id: number | null) {
  const input = await body(c, collectionInput);
  if (input.startsAt && input.endsAt && input.endsAt <= input.startsAt) throw new HttpError(422, "ends_before_start");
  const slug = slugify(input.slug || input.nameFr);
  if (!slug) throw new HttpError(422, "slug_required");
  const taken = await c.env.DB.prepare("SELECT id FROM collections WHERE slug = ? AND id != ?").bind(slug, id ?? 0).first();
  if (taken) throw new HttpError(409, "slug_taken");
  const cols = [slug, input.nameFr, input.nameAr || input.nameFr, input.descriptionFr ?? null, input.descriptionAr ?? null, input.startsAt, input.endsAt,
    input.showCountdown ? 1 : 0, input.lockProducts ? 1 : 0, input.isActive ? 1 : 0];
  let collectionId = id;
  if (id) {
    const res = await c.env.DB.prepare(
      `UPDATE collections SET slug = ?, name_fr = ?, name_ar = ?, description_fr = ?, description_ar = ?, starts_at = ?, ends_at = ?,
         show_countdown = ?, lock_products = ?, is_active = ? WHERE id = ?`,
    )
      .bind(...cols, id)
      .run();
    if (!res.meta.changes) throw new HttpError(404, "not_found");
  } else {
    const row = await c.env.DB.prepare(
      `INSERT INTO collections (slug, name_fr, name_ar, description_fr, description_ar, starts_at, ends_at, show_countdown, lock_products, is_active, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) RETURNING id`,
    )
      .bind(...cols, Date.now())
      .first<{ id: number }>();
    collectionId = row!.id;
  }
  const productIds = [...new Set(input.productIds)];
  await c.env.DB.batch([
    c.env.DB.prepare("DELETE FROM collection_products WHERE collection_id = ?").bind(collectionId),
    ...productIds.map((pid, i) =>
      c.env.DB.prepare("INSERT INTO collection_products (collection_id, product_id, sort) SELECT ?, id, ? FROM products WHERE id = ?").bind(collectionId, i, pid),
    ),
    await dropTimesStmt(c.env),
    bumpCatalogStmt(c.env),
    auditStmt(c.env, actorOf(c.get("member")), id ? "update" : "create", "collection", collectionId, { name: input.nameFr, products: productIds.length }),
  ]);
  return c.json({ id: collectionId, slug }, id ? 200 : 201);
}

marketingRoutes.post("/collections", requirePermission("marketing.edit"), (c) => saveCollection(c, null));
marketingRoutes.put("/collections/:id", requirePermission("marketing.edit"), (c) => saveCollection(c, intParam(c, "id")));

marketingRoutes.delete("/collections/:id", requirePermission("marketing.edit"), async (c) => {
  const id = intParam(c, "id");
  await c.env.DB.batch([
    c.env.DB.prepare("DELETE FROM collection_products WHERE collection_id = ?").bind(id),
    c.env.DB.prepare("DELETE FROM collections WHERE id = ?").bind(id),
  ]);
  await c.env.DB.batch([await dropTimesStmt(c.env), bumpCatalogStmt(c.env), auditStmt(c.env, actorOf(c.get("member")), "delete", "collection", id)]);
  return c.json({ ok: true });
});
