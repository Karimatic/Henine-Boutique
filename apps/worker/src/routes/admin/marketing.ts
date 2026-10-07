/**
 * Admin → Marketing (+ Promos): coupons, home page, reviews, notifications, links, contact.
 */
import { Hono } from "hono";
import { z } from "zod";
import { cleanText, DEFAULT_DESIGN, HOME_SECTIONS, isHexColor, isSafeLink, slugify, type DesignDTO } from "@henine/shared";
import type { AppEnv } from "../../env";
import { auditStmt } from "../../lib/audit";
import { mediaUrl, parseFlashConfig, reviewPhotos, variantLabels } from "../../lib/catalog";
import { body, HttpError, intParam } from "../../lib/http";
import { putImage, putVideo } from "../../lib/media";
import { bumpCatalogStmt, getSetting, getSettings, setSettingStmt } from "../../lib/settings";
import { sendCampaignBatch } from "../../lib/webpush";
import { translate } from "./translate";
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
  /** only these products / categories get the discount (empty = the whole cart) */
  appliesTo: z
    .object({ productIds: z.array(z.number().int().positive()).max(200).default([]), categoryIds: z.array(z.number().int().positive()).max(50).default([]) })
    .nullable()
    .optional(),
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
  const scope = input.appliesTo && (input.appliesTo.productIds.length || input.appliesTo.categoryIds.length) ? JSON.stringify(input.appliesTo) : null;
  const vals = [
    input.code, input.type, input.value, input.minSubtotal ?? null, input.usageLimit ?? null, input.perCustomerLimit ?? null,
    input.firstOrderOnly ? 1 : 0, input.startsAt ?? null, input.endsAt ?? null, input.isActive ? 1 : 0, input.influencerName ?? null, input.commissionPct ?? null,
    scope,
  ];
  try {
    if (id) {
      await c.env.DB.prepare(
        `UPDATE coupons SET code = ?, type = ?, value = ?, min_subtotal = ?, usage_limit = ?, per_customer_limit = ?, first_order_only = ?,
           starts_at = ?, ends_at = ?, is_active = ?, influencer_name = ?, commission_pct = ?, applies_to = ? WHERE id = ?`,
      )
        .bind(...vals, id)
        .run();
    } else {
      const row = await c.env.DB.prepare(
        `INSERT INTO coupons (code, type, value, min_subtotal, usage_limit, per_customer_limit, first_order_only, starts_at, ends_at, is_active,
           influencer_name, commission_pct, applies_to, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) RETURNING id`,
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

type TextOverrides = z.infer<typeof textsInput>;

/**
 * The texts changed in one language, translated into the other (French ↔ Arabic); a text put
 * back to its original wording goes back to the original in the other language too. A text that
 * can't be translated right now (no AI quota) leaves the other language as it was.
 */
async function mirrorTexts(env: AppEnv["Bindings"], before: TextOverrides, after: TextOverrides, other: TextOverrides, to: "fr" | "ar"): Promise<TextOverrides> {
  const out: TextOverrides = { ...other };
  const tr = (t: string) => translate(env, t, to);
  const jobs: Promise<void>[] = [];
  for (const k of ["eyebrow", "title", "subtitle", "pause"] as const) {
    if (after[k] === before[k]) continue;
    if (after[k] == null) delete out[k];
    else jobs.push(tr(after[k]!).then((v) => void (out[k] = v.slice(0, k === "eyebrow" ? 60 : k === "title" ? 90 : 240))));
  }
  if (JSON.stringify(after.announcement) !== JSON.stringify(before.announcement)) {
    if (!after.announcement) delete out.announcement;
    else jobs.push(Promise.all(after.announcement.map(tr)).then((list) => void (out.announcement = list.map((m) => m.slice(0, 120)))));
  }
  if (JSON.stringify(after.faq) !== JSON.stringify(before.faq)) {
    if (!after.faq) delete out.faq;
    else
      jobs.push(
        Promise.all(after.faq.map(async (f) => ({ q: (await tr(f.q)).slice(0, 200), a: (await tr(f.a)).slice(0, 1000) }))).then((faq) => void (out.faq = faq)),
      );
  }
  await Promise.allSettled(jobs);
  return out;
}

marketingRoutes.put("/home/texts", requirePermission("marketing.edit"), async (c) => {
  const input = await body(c, z.object({ locale: z.enum(["ar", "fr"]), texts: textsInput }));
  const { texts } = await getSettings(c.env, ["texts"]);
  const otherLocale = input.locale === "fr" ? "ar" : "fr";
  const before = (texts[input.locale] ?? {}) as TextOverrides;
  const mirrored = await mirrorTexts(c.env, before, input.texts, (texts[otherLocale] ?? {}) as TextOverrides, otherLocale);
  const next = { ...texts, [input.locale]: input.texts, [otherLocale]: mirrored };
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
  return c.json({
    rows: (rows!.results as (Record<string, unknown> & { photos: string | null })[]).map((r) => ({ ...r, photo_urls: reviewPhotos(c.env, r.photos) })),
    counts: counts!.results,
  });
});

/**
 * A review received elsewhere (Instagram, WhatsApp, in the shop), typed in by the team.
 * It is never marked "verified purchase": that badge stays for customers with a delivered order.
 */
marketingRoutes.post("/reviews", requirePermission("reviews.moderate"), async (c) => {
  const input = await body(
    c,
    z.object({
      productId: z.number().int().positive(),
      name: cleanText(60).pipe(z.string().min(2)),
      rating: z.number().int().min(1).max(5),
      text: cleanText(1000).nullable().optional(),
      createdAt: z.number().int().positive().max(Date.now() + 60_000).optional(),
      status: z.enum(["approved", "pending"]).default("approved"),
    }),
  );
  const product = await c.env.DB.prepare("SELECT id FROM products WHERE id = ?").bind(input.productId).first();
  if (!product) throw new HttpError(404, "not_found");
  const row = await c.env.DB.prepare(
    "INSERT INTO reviews (product_id, order_id, name, rating, text, verified, status, created_at) VALUES (?, NULL, ?, ?, ?, 0, ?, ?) RETURNING id",
  )
    .bind(input.productId, input.name, input.rating, input.text || null, input.status, input.createdAt ?? Date.now())
    .first<{ id: number }>();
  await c.env.DB.batch([bumpCatalogStmt(c.env), auditStmt(c.env, actorOf(c.get("member")), "create", "review", row!.id, { productId: input.productId })]);
  return c.json({ id: row!.id }, 201);
});

marketingRoutes.patch("/reviews/:id", requirePermission("reviews.moderate"), async (c) => {
  const id = intParam(c, "id");
  const input = await body(
    c,
    z.object({
      status: z.enum(["pending", "approved", "rejected"]).optional(),
      reply: cleanText(1000).nullable().optional(),
      isFeatured: z.boolean().optional(),
      // wording: only for reviews added by the team (a customer's verified review is never rewritten)
      name: cleanText(60).pipe(z.string().min(2)).optional(),
      rating: z.number().int().min(1).max(5).optional(),
      text: cleanText(1000).nullable().optional(),
      productId: z.number().int().positive().optional(),
    }),
  );
  const wording = input.name != null || input.rating != null || "text" in input || input.productId != null;
  if (wording) {
    const r = await c.env.DB.prepare("SELECT verified FROM reviews WHERE id = ?").bind(id).first<{ verified: number }>();
    if (!r) throw new HttpError(404, "not_found");
    if (r.verified) throw new HttpError(409, "verified_review_locked");
    await c.env.DB.prepare(
      "UPDATE reviews SET name = COALESCE(?, name), rating = COALESCE(?, rating), text = CASE WHEN ? THEN ? ELSE text END, product_id = COALESCE(?, product_id) WHERE id = ? AND verified = 0",
    )
      .bind(input.name ?? null, input.rating ?? null, "text" in input ? 1 : 0, input.text || null, input.productId ?? null, id)
      .run();
  }
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
  const row = await c.env.DB.prepare("SELECT photos FROM reviews WHERE id = ?").bind(id).first<{ photos: string | null }>();
  const keys = (JSON.parse(row?.photos ?? "[]") as string[]).filter((k) => typeof k === "string");
  if (keys.length) c.executionCtx.waitUntil(c.env.MEDIA.delete(keys).catch(() => undefined));
  await c.env.DB.batch([c.env.DB.prepare("DELETE FROM reviews WHERE id = ?").bind(id), bumpCatalogStmt(c.env), auditStmt(c.env, actorOf(c.get("member")), "delete", "review", id)]);
  return c.json({ ok: true });
});

/* ───────────── Notifier: team notifications + back-in-stock waitlists ───────────── */

marketingRoutes.get("/notifier", requirePermission("marketing.edit"), async (c) => {
  const { notifications } = await getSettings(c.env, ["notifications"]);
  const [subs, campaigns] = await c.env.DB.batch([
    c.env.DB.prepare("SELECT COUNT(*) AS n FROM push_subscriptions s WHERE EXISTS (SELECT 1 FROM json_each(s.tags) WHERE value = 'news')"),
    c.env.DB.prepare("SELECT id, title, status, stats, created_at FROM campaigns WHERE kind = 'push' ORDER BY id DESC LIMIT 10"),
  ]);
  const { results } = await c.env.DB.prepare(
    `SELECT a.variant_id, v.sku, p.name_fr, p.id AS product_id, v.stock_on_hand - v.stock_reserved AS available,
            COUNT(*) AS waiting, SUM(CASE WHEN a.push_subscription_id IS NOT NULL THEN 1 ELSE 0 END) AS push_waiting,
            GROUP_CONCAT(a.phone, ', ') AS phones, MAX(a.created_at) AS last_at
       FROM stock_alerts a JOIN variants v ON v.id = a.variant_id JOIN products p ON p.id = v.product_id
      WHERE a.notified_at IS NULL GROUP BY a.variant_id ORDER BY waiting DESC LIMIT 100`,
  ).all<{ variant_id: number } & Record<string, unknown>>();
  const labels = await variantLabels(c.env, results.map((r) => r.variant_id));
  return c.json({
    notifications,
    waitlists: results.map((r) => ({ ...r, options: labels.get(r.variant_id)?.fr ?? "" })),
    newsSubscribers: (subs!.results[0] as { n: number }).n,
    campaigns: (campaigns!.results as { stats: string | null }[]).map((r) => ({ ...r, stats: JSON.parse(r.stats ?? "{}") })),
  });
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
    .refine(isSafeLink, "target_invalid"),
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
        followers: cleanText(12).nullable().optional(),
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
/** Start/end times of drops and flash sales: public cache keys change as each one passes. */
async function dropTimesStmt(env: AppEnv["Bindings"]) {
  const { results } = await env.DB.prepare(
    `SELECT starts_at, ends_at FROM collections WHERE is_active = 1 AND (starts_at IS NOT NULL OR ends_at IS NOT NULL)
     UNION ALL SELECT starts_at, ends_at FROM promotions WHERE kind = 'flash_sale' AND is_active = 1`,
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

/* ───────────── Notifications to subscribers ("Recevoir les nouveautés") ───────────── */

marketingRoutes.post("/notifier/broadcast", requirePermission("marketing.edit"), async (c) => {
  const input = await body(
    c,
    z.object({
      titleFr: cleanText(60).pipe(z.string().min(2)),
      titleAr: cleanText(60).pipe(z.string().min(2)),
      bodyFr: cleanText(160).pipe(z.string().min(2)),
      bodyAr: cleanText(160).pipe(z.string().min(2)),
      /** page of the store it opens ("/c/robes", "/produit/…") */
      path: z.string().trim().max(200).regex(/^\/[^\s]*$/).default("/"),
    }),
  );
  const running = await c.env.DB.prepare("SELECT id FROM campaigns WHERE kind = 'push' AND status = 'sending'").first();
  if (running) throw new HttpError(409, "campaign_running");
  const total = await c.env.DB.prepare("SELECT COUNT(*) AS n FROM push_subscriptions s WHERE EXISTS (SELECT 1 FROM json_each(s.tags) WHERE value = 'news')").first<{ n: number }>();
  if (!total?.n) throw new HttpError(409, "no_subscribers");
  const row = await c.env.DB.prepare(
    "INSERT INTO campaigns (kind, title, config, status, stats, created_at) VALUES ('push', ?, ?, 'sending', ?, ?) RETURNING id",
  )
    .bind(input.titleFr, JSON.stringify(input), JSON.stringify({ total: total.n, sent: 0, failed: 0, cursor: 0 }), Date.now())
    .first<{ id: number }>();
  await auditStmt(c.env, actorOf(c.get("member")), "create", "campaign", row!.id, { title: input.titleFr }).run();
  // first batch now, the rest every 5 minutes (cron) — free plan: ≤ 50 sub-requests per run
  c.executionCtx.waitUntil(sendCampaignBatch(c.env, 35).catch(() => undefined));
  return c.json({ id: row!.id, total: total.n }, 201);
});

/* ───────────── Ventes flash ───────────── */

const flashInput = z
  .object({
    nameFr: cleanText(60).pipe(z.string().min(2)),
    nameAr: cleanText(60).pipe(z.string().min(2)),
    percent: z.number().int().min(1).max(90),
    productIds: z.array(z.number().int().positive()).min(1).max(100),
    limit: z.number().int().min(1).max(10_000).nullable().default(null),
    startsAt: z.number().int(),
    endsAt: z.number().int(),
    isActive: z.boolean().default(true),
  })
  .refine((f) => f.endsAt > f.startsAt, { message: "ends_before_start", path: ["endsAt"] });

marketingRoutes.get("/flash-sales", requirePermission("promos.edit"), async (c) => {
  const { results } = await c.env.DB.prepare("SELECT * FROM promotions WHERE kind = 'flash_sale' ORDER BY is_active DESC, ends_at DESC").all<{
    id: number; name: string; config: string; starts_at: number; ends_at: number; is_active: number;
  }>();
  // pieces sold during each sale, at its products
  const sold = results.length
    ? await c.env.DB.batch(
        results.map((r) => {
          const ids = parseFlashConfig(r.config).productIds;
          return c.env.DB.prepare(
            `SELECT COALESCE(SUM(oi.qty), 0) AS units, COALESCE(SUM(oi.qty * oi.unit_price), 0) AS sales FROM order_items oi JOIN orders o ON o.id = oi.order_id
              WHERE o.created_at >= ? AND o.created_at < ? AND o.status NOT IN ('annulee','doublon','fausse') AND oi.product_id IN (${ids.length ? ids.join(",") : "0"})`,
          ).bind(r.starts_at, r.ends_at);
        }),
      )
    : [];
  return c.json(
    results.map((r, i) => {
      const [nameFr, nameAr] = r.name.split(" | ");
      const cfg = parseFlashConfig(r.config);
      const s = (sold[i]?.results[0] ?? { units: 0, sales: 0 }) as { units: number; sales: number };
      return { id: r.id, nameFr, nameAr: nameAr ?? nameFr, ...cfg, startsAt: r.starts_at, endsAt: r.ends_at, isActive: !!r.is_active, units: s.units, sales: s.sales };
    }),
  );
});

async function saveFlash(c: Parameters<typeof body>[0], id: number | null) {
  const f = await body(c, flashInput);
  const name = `${f.nameFr.replace(/\|/g, "/")} | ${f.nameAr.replace(/\|/g, "/")}`;
  const config = JSON.stringify({ productIds: [...new Set(f.productIds)], percent: f.percent, limit: f.limit });
  if (id) {
    const res = await c.env.DB.prepare("UPDATE promotions SET name = ?, config = ?, starts_at = ?, ends_at = ?, is_active = ? WHERE id = ? AND kind = 'flash_sale'")
      .bind(name, config, f.startsAt, f.endsAt, f.isActive ? 1 : 0, id)
      .run();
    if (!res.meta.changes) throw new HttpError(404, "not_found");
  } else {
    const row = await c.env.DB.prepare(
      "INSERT INTO promotions (name, kind, config, priority, stackable, starts_at, ends_at, is_active) VALUES (?, 'flash_sale', ?, 0, 0, ?, ?, ?) RETURNING id",
    )
      .bind(name, config, f.startsAt, f.endsAt, f.isActive ? 1 : 0)
      .first<{ id: number }>();
    id = row!.id;
  }
  await c.env.DB.batch([await dropTimesStmt(c.env), bumpCatalogStmt(c.env), auditStmt(c.env, actorOf(c.get("member")), "save", "flash_sale", id, { name: f.nameFr, percent: f.percent })]);
  return c.json({ id });
}

marketingRoutes.post("/flash-sales", requirePermission("promos.edit"), (c) => saveFlash(c, null));
marketingRoutes.put("/flash-sales/:id", requirePermission("promos.edit"), (c) => saveFlash(c, intParam(c, "id")));
marketingRoutes.delete("/flash-sales/:id", requirePermission("promos.edit"), async (c) => {
  const id = intParam(c, "id");
  await c.env.DB.prepare("DELETE FROM promotions WHERE id = ? AND kind = 'flash_sale'").bind(id).run();
  await c.env.DB.batch([await dropTimesStmt(c.env), bumpCatalogStmt(c.env), auditStmt(c.env, actorOf(c.get("member")), "delete", "flash_sale", id)]);
  return c.json({ ok: true });
});

/* ───────────── Apparence: logo, colours, fonts, banners, home sections ───────────── */

const mediaKey = z.string().trim().max(200).regex(/^design\/[a-z0-9_-]+\.(webp|jpg)$/i);
const designInput = z.object({
  logo: mediaKey.nullable(),
  colors: z.object({ accent: z.string().refine(isHexColor, "color"), soft: z.string().refine(isHexColor, "color") }),
  font: z.enum(["classic", "elegant", "modern", "soft"]),
  heroImage: mediaKey.nullable(),
  heroVideo: z.string().trim().max(200).regex(/^design\/[a-z0-9_-]+\.(mp4|webm)$/i).nullable().default(null),
  banners: z
    .array(
      z.object({
        id: z.string().trim().min(1).max(40),
        image: mediaKey,
        titleFr: cleanText(80).default(""),
        titleAr: cleanText(80).default(""),
        subtitleFr: cleanText(140).default(""),
        subtitleAr: cleanText(140).default(""),
        link: z.string().trim().max(300).refine((l) => l === "" || isSafeLink(l), "link"),
      }),
    )
    .max(6),
  featured: z.object({ titleFr: cleanText(60), titleAr: cleanText(60), productIds: z.array(z.number().int().positive()).max(24) }),
  footerFr: cleanText(300).default(""),
  footerAr: cleanText(300).default(""),
  sections: z.array(z.object({ key: z.enum(HOME_SECTIONS), on: z.boolean() })).max(HOME_SECTIONS.length),
});

marketingRoutes.get("/design", requirePermission("marketing.edit"), async (c) => {
  const design = await getSetting(c.env, "design");
  return c.json({ design: { ...DEFAULT_DESIGN, ...design }, mediaBase: mediaUrl(c.env, "") });
});

marketingRoutes.put("/design", requirePermission("marketing.edit"), async (c) => {
  const input = (await body(c, designInput)) as DesignDTO;
  const before = (await getSetting(c.env, "design")) as Partial<DesignDTO>;
  await c.env.DB.batch([setSettingStmt(c.env, "design", input), bumpCatalogStmt(c.env), auditStmt(c.env, actorOf(c.get("member")), "update", "settings", "design")]);
  // a replaced or removed home video is deleted from storage (videos are heavy)
  if (before.heroVideo && before.heroVideo !== input.heroVideo && /^design\//.test(before.heroVideo)) {
    c.executionCtx.waitUntil(c.env.MEDIA.delete(before.heroVideo).catch(() => undefined));
  }
  return c.json(input);
});

/** The big home page video (MP4 / WebM, ≤ 40 MB): stored now, used once the design is saved. */
marketingRoutes.post("/design/video", requirePermission("marketing.edit"), async (c) => {
  const form = await c.req.formData().catch(() => null);
  const file = form?.get("video");
  if (!file || typeof file === "string") throw new HttpError(400, "video_required");
  const key = await putVideo(c.env, "design/video", file);
  return c.json({ key, url: mediaUrl(c.env, key) }, 201);
});

/** Logo / hero / banner picture (WebP or JPEG made in the browser). */
marketingRoutes.post("/design/image", requirePermission("marketing.edit"), async (c) => {
  const form = await c.req.formData().catch(() => null);
  const file = form?.get("image");
  if (!file || typeof file === "string") throw new HttpError(400, "image_required");
  const key = await putImage(c.env, "design/img", file, 3_000_000);
  return c.json({ key, url: mediaUrl(c.env, key) }, 201);
});
