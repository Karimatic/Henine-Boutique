/**
 * Admin → Tableau de bord, Analyse, Système (Équipe, Comptes, Contenu, Erreurs) + /me.
 */
import { Hono } from "hono";
import { z } from "zod";
import { cleanText, ROLE_PRESETS } from "@henine/shared";
import type { AppEnv } from "../../env";
import { isDev } from "../../env";
import { auditStmt } from "../../lib/audit";
import { checkPassword, devEcho, hashPassword, passwordKeyValid } from "../../lib/auth";
import { decryptSecret, encryptSecret, maskSecret, randomToken } from "../../lib/crypto";
import { body, HttpError, intParam } from "../../lib/http";
import { mailLayout, mailProvider, sendMail } from "../../lib/mail";
import { mediaUrl, variantLabels } from "../../lib/catalog";
import { algiersDayStart, CANCELLED_SQL, periodStats } from "../../lib/orders";
import { bumpCatalogStmt, getSetting, getSettings, patchSetting, setSettingStmt } from "../../lib/settings";
import { pollUpdates, processOutbox, sendTelegramText, telegramConfig, tgCall } from "../../lib/telegram";
import { actorOf, requirePermission } from "../../middleware/access";
import { createInvite } from "../auth";
import { ABANDONED_AFTER, attentionSql } from "./orders";

const ACTIVE = "'nouvelle','injoignable','confirmee','en_preparation','expediee','en_livraison','retour'";

export const systemRoutes = new Hono<AppEnv>();

/* ───────────── Me ───────────── */

systemRoutes.get("/me", async (c) => {
  const m = c.get("member");
  const tg = await getSetting(c.env, "telegram");
  return c.json({
    id: m.id, email: m.email, name: m.name, role: m.role, roleName: m.roleName, permissions: m.permissions,
    dev: isDev(c.env), telegramConfigured: !!(tg.token_enc && tg.chat_id),
  });
});

/** Development only: the admin panel calls this every few seconds to receive Telegram button presses. */
systemRoutes.post("/dev/telegram-poll", async (c) => {
  if (!isDev(c.env)) throw new HttpError(404, "not_found");
  const updates = await pollUpdates(c.env);
  const sent = await processOutbox(c.env, 5);
  return c.json({ updates, sent });
});

/* ───────────── Dashboard: the team's command center ───────────── */

systemRoutes.get("/dashboard", requirePermission("dashboard.view"), async (c) => {
  const now = Date.now();
  const dayStart = algiersDayStart(now);
  const day = 86400_000;
  const [today, week, prevWeek, month, prevMonth] = await Promise.all([
    periodStats(c.env, dayStart),
    periodStats(c.env, dayStart - 6 * day),
    periodStats(c.env, dayStart - 13 * day, dayStart - 6 * day),
    periodStats(c.env, dayStart - 29 * day),
    periodStats(c.env, dayStart - 59 * day, dayStart - 29 * day),
  ]);
  const since30 = dayStart - 29 * day;
  // widgets: best product of the month (with weekly units), revenue by channel, returning customers
  const [topProduct, channels, loyalty] = await c.env.DB.batch([
    c.env.DB.prepare(
      `SELECT oi.product_id, p.name_fr, COALESCE(p.published_at, p.created_at) AS published_at,
              (SELECT base_key FROM product_images i WHERE i.product_id = oi.product_id ORDER BY sort, id LIMIT 1) AS image_key,
              SUM(oi.qty) AS units, COUNT(DISTINCT oi.order_id) AS orders, SUM(oi.qty * oi.unit_price) AS revenue,
              SUM(CASE WHEN o.created_at >= ?2 THEN oi.qty ELSE 0 END) AS w4,
              SUM(CASE WHEN o.created_at >= ?3 AND o.created_at < ?2 THEN oi.qty ELSE 0 END) AS w3,
              SUM(CASE WHEN o.created_at >= ?4 AND o.created_at < ?3 THEN oi.qty ELSE 0 END) AS w2,
              SUM(CASE WHEN o.created_at < ?4 THEN oi.qty ELSE 0 END) AS w1
         FROM order_items oi JOIN orders o ON o.id = oi.order_id LEFT JOIN products p ON p.id = oi.product_id
        WHERE o.created_at >= ?1 AND o.status NOT IN ${CANCELLED_SQL} AND oi.product_id IS NOT NULL
        GROUP BY oi.product_id ORDER BY units DESC LIMIT 1`,
    ).bind(since30, now - 7 * day, now - 14 * day, now - 21 * day),
    c.env.DB.prepare(
      `SELECT channel, COUNT(*) AS orders, COALESCE(SUM(total), 0) AS revenue FROM orders
        WHERE created_at >= ? AND status NOT IN ${CANCELLED_SQL} GROUP BY channel ORDER BY revenue DESC`,
    ).bind(since30),
    c.env.DB.prepare(
      `SELECT COUNT(*) AS orders, SUM(CASE WHEN c.delivered_count > 0 OR c.orders_count > 1 THEN 1 ELSE 0 END) AS returning_orders
         FROM orders o JOIN customers c ON c.id = o.customer_id WHERE o.created_at >= ? AND o.status NOT IN ${CANCELLED_SQL}`,
    ).bind(since30),
  ]);
  const attn = attentionSql(now);
  const attnCols = Object.entries(attn).map(([k, cond]) => `SUM(CASE WHEN ${cond} THEN 1 ELSE 0 END) AS ${k}`).join(", ");
  const [pipeline, attention, carts, lowStock, stockCounts, restocked, recent, reviews, messages, outbox] = await c.env.DB.batch([
    c.env.DB.prepare(`SELECT status, COUNT(*) AS n FROM orders WHERE status IN (${ACTIVE}) GROUP BY status`),
    // one pass over the active orders (status index) for every "needs attention" counter
    c.env.DB.prepare(`SELECT ${attnCols} FROM orders o LEFT JOIN customers c ON c.id = o.customer_id WHERE o.status IN (${ACTIVE})`),
    c.env.DB.prepare(
      `SELECT COUNT(*) AS n, COALESCE(SUM(value), 0) AS value FROM carts
        WHERE recovered_order_id IS NULL AND last_contacted_at IS NULL AND updated_at < ? AND updated_at > ?`,
    ).bind(now - ABANDONED_AFTER, now - 86400_000),
    c.env.DB.prepare(
      `SELECT v.id, p.id AS product_id, p.name_fr, v.stock_on_hand - v.stock_reserved AS available,
              (SELECT COUNT(*) FROM stock_alerts a WHERE a.variant_id = v.id AND a.notified_at IS NULL) AS waiting
         FROM variants v JOIN products p ON p.id = v.product_id
        WHERE v.is_active = 1 AND p.status = 'published' AND v.stock_on_hand - v.stock_reserved <= v.low_stock_threshold
        ORDER BY available ASC, waiting DESC LIMIT 10`,
    ),
    c.env.DB.prepare(
      `SELECT SUM(CASE WHEN v.stock_on_hand - v.stock_reserved <= 0 THEN 1 ELSE 0 END) AS out_count,
              SUM(CASE WHEN v.stock_on_hand - v.stock_reserved > 0 AND v.stock_on_hand - v.stock_reserved <= v.low_stock_threshold THEN 1 ELSE 0 END) AS low_count
         FROM variants v JOIN products p ON p.id = v.product_id WHERE v.is_active = 1 AND p.status = 'published'`,
    ),
    // back in stock while customers are still waiting to be told
    c.env.DB.prepare(
      `SELECT a.variant_id AS id, p.id AS product_id, p.name_fr, v.stock_on_hand - v.stock_reserved AS available, COUNT(*) AS waiting
         FROM stock_alerts a JOIN variants v ON v.id = a.variant_id JOIN products p ON p.id = v.product_id
        WHERE a.notified_at IS NULL AND v.stock_on_hand - v.stock_reserved > 0
        GROUP BY a.variant_id ORDER BY waiting DESC LIMIT 10`,
    ),
    c.env.DB.prepare(
      `SELECT o.id, o.public_code, o.status, o.name, o.total, o.created_at, w.name_fr AS wilaya FROM orders o LEFT JOIN wilayas w ON w.code = o.wilaya_code
        ORDER BY o.id DESC LIMIT 8`,
    ),
    c.env.DB.prepare("SELECT COUNT(*) AS n FROM reviews WHERE status = 'pending'"),
    c.env.DB.prepare("SELECT COUNT(*) AS n FROM contact_messages WHERE status = 'new'"),
    c.env.DB.prepare("SELECT COUNT(*) AS n FROM outbox WHERE done_at IS NULL AND attempts > 0"),
  ]);
  const low = lowStock!.results as { id: number; product_id: number; name_fr: string; available: number; waiting: number }[];
  const back = restocked!.results as { id: number; product_id: number; name_fr: string; available: number; waiting: number }[];
  const labels = await variantLabels(c.env, [...low, ...back].map((v) => v.id));
  const withLabel = <T extends { id: number }>(v: T) => ({ ...v, options: labels.get(v.id)?.fr ?? "" });
  const a = (attention!.results[0] ?? {}) as Record<string, number | null>;
  const cartRow = carts!.results[0] as { n: number; value: number };
  const sc = stockCounts!.results[0] as { out_count: number | null; low_count: number | null };
  // cancelled orders (annulée / doublon / fausse) are never counted as orders or revenue
  return c.json({
    kpis: {
      ordersToday: today.orders,
      revenueToday: today.revenue,
      revenue7: week.revenue,
      revenue30: month.revenue,
      orders7: week.orders,
      cancelledToday: today.cancelled,
      confirmRate7: week.confirmRate,
      avgBasket30: month.orders ? Math.round(month.revenue / month.orders) : null,
    },
    pipeline: Object.fromEntries((pipeline!.results as { status: string; n: number }[]).map((r) => [r.status, r.n])),
    attention: {
      ...Object.fromEntries(Object.keys(attn).map((k) => [k, a[k] ?? 0])),
      abandoned: cartRow.n,
      abandonedValue: cartRow.value,
      restocked: back.length,
      outOfStock: sc.out_count ?? 0,
      lowStock: sc.low_count ?? 0,
      pendingReviews: (reviews!.results[0] as { n: number }).n,
      newMessages: (messages!.results[0] as { n: number }).n,
      telegramBacklog: (outbox!.results[0] as { n: number }).n,
    },
    lowStock: low.map(withLabel),
    restocked: back.map(withLabel),
    recent: recent!.results,
    week,
    prevWeek,
    month,
    prevMonth,
    topProduct: ((r) =>
      r
        ? {
            id: r.product_id, name: r.name_fr, publishedAt: r.published_at, units: r.units, orders: r.orders, revenue: r.revenue,
            weeks: [r.w1, r.w2, r.w3, r.w4].map((v) => v ?? 0),
            image: r.image_key ? mediaUrl(c.env, r.image_key).replace("{w}", "480") : null,
          }
        : null)(topProduct!.results[0] as
      | { product_id: number; name_fr: string; published_at: number; image_key: string | null; units: number; orders: number; revenue: number; w1: number; w2: number; w3: number; w4: number }
      | undefined),
    channels: channels!.results,
    returningShare: ((l) => (l?.orders ? Math.round(((l.returning_orders ?? 0) / l.orders) * 100) : null))(loyalty!.results[0] as { orders: number; returning_orders: number | null } | undefined),
  });
});

/* ───────────── Statistiques ───────────── */

/** "today" | "7" | "30" | "90" | "365" | custom from/to (YYYY-MM-DD, Africa/Algiers days). */
function statsRange(q: (k: string) => string | undefined): { since: number; until: number; label: string; days: number } {
  const now = Date.now();
  const today = algiersDayStart(now);
  const from = q("from");
  const to = q("to");
  const day = (d: string) => Date.parse(`${d}T00:00:00+01:00`);
  if (from && to && /^\d{4}-\d{2}-\d{2}$/.test(from) && /^\d{4}-\d{2}-\d{2}$/.test(to) && day(from) <= day(to)) {
    const since = day(from);
    const until = Math.min(day(to) + 86400_000, now + 1);
    if (until - since > 366 * 86400_000) throw new HttpError(422, "range_too_long");
    return { since, until, label: `${from} → ${to}`, days: Math.max(1, Math.round((until - since) / 86400_000)) };
  }
  const r = q("range") ?? q("days") ?? "30";
  if (r === "today") return { since: today, until: now + 1, label: "today", days: 1 };
  const days = Math.min(365, Math.max(1, Number(r) || 30));
  return { since: today - (days - 1) * 86400_000, until: now + 1, label: `${days}`, days };
}

const MIN_SAMPLE = 5;

systemRoutes.get("/stats", requirePermission("stats.view"), async (c) => {
  const { since, until, label, days } = statsRange((k) => c.req.query(k));
  const inRange = "o.created_at >= ?1 AND o.created_at < ?2";
  const valid = `o.status NOT IN ${CANCELLED_SQL}`;
  const [totals, daily, statusRows, wilayas, channels, hours, top, reasons, durations, byType] = await c.env.DB.batch([
    c.env.DB.prepare(
      `SELECT COUNT(*) AS placed,
              SUM(CASE WHEN ${valid} THEN 1 ELSE 0 END) AS orders,
              COALESCE(SUM(CASE WHEN ${valid} THEN o.total ELSE 0 END), 0) AS revenue,
              COALESCE(SUM(CASE WHEN o.status = 'livree' THEN o.total ELSE 0 END), 0) AS delivered_revenue,
              SUM(CASE WHEN o.status = 'livree' THEN 1 ELSE 0 END) AS delivered,
              SUM(CASE WHEN o.status IN ${CANCELLED_SQL} THEN 1 ELSE 0 END) AS cancelled,
              SUM(CASE WHEN o.status IN ('retour','retour_recu') THEN 1 ELSE 0 END) AS returned,
              SUM(CASE WHEN o.status IN ('nouvelle','injoignable') THEN 1 ELSE 0 END) AS pending,
              SUM(CASE WHEN o.status IN ('confirmee','en_preparation','expediee','en_livraison') THEN 1 ELSE 0 END) AS in_progress,
              COUNT(DISTINCT CASE WHEN ${valid} THEN o.customer_id END) AS customers,
              SUM(CASE WHEN ${valid} AND c.delivered_count > 1 THEN 1 ELSE 0 END) AS repeat_orders
         FROM orders o LEFT JOIN customers c ON c.id = o.customer_id WHERE ${inRange}`,
    ).bind(since, until),
    c.env.DB.prepare(
      `SELECT strftime('%Y-%m-%d', (o.created_at + 3600000) / 1000, 'unixepoch') AS date, COUNT(*) AS orders, COALESCE(SUM(o.total), 0) AS revenue
         FROM orders o WHERE ${inRange} AND ${valid} GROUP BY date ORDER BY date`,
    ).bind(since, until),
    c.env.DB.prepare(`SELECT o.status, COUNT(*) AS n FROM orders o WHERE ${inRange} GROUP BY o.status`).bind(since, until),
    c.env.DB.prepare(
      `SELECT o.wilaya_code AS code, w.name_fr AS name, COUNT(*) AS placed,
              SUM(CASE WHEN ${valid} THEN 1 ELSE 0 END) AS orders,
              COALESCE(SUM(CASE WHEN ${valid} THEN o.total ELSE 0 END), 0) AS revenue,
              SUM(CASE WHEN o.status = 'livree' THEN 1 ELSE 0 END) AS delivered,
              SUM(CASE WHEN o.status IN ${CANCELLED_SQL} THEN 1 ELSE 0 END) AS cancelled,
              SUM(CASE WHEN o.status IN ('retour','retour_recu') THEN 1 ELSE 0 END) AS returned,
              AVG(CASE WHEN o.status = 'livree' AND o.shipped_at IS NOT NULL AND o.delivered_at > o.shipped_at THEN (o.delivered_at - o.shipped_at) / 86400000.0 END) AS avg_days,
              SUM(CASE WHEN o.status = 'livree' AND o.shipped_at IS NOT NULL AND o.delivered_at > o.shipped_at THEN 1 ELSE 0 END) AS timed
         FROM orders o LEFT JOIN wilayas w ON w.code = o.wilaya_code WHERE ${inRange}
        GROUP BY o.wilaya_code ORDER BY orders DESC`,
    ).bind(since, until),
    c.env.DB.prepare(`SELECT o.channel, COUNT(*) AS orders, COALESCE(SUM(o.total), 0) AS revenue FROM orders o WHERE ${inRange} AND ${valid} GROUP BY o.channel`).bind(since, until),
    c.env.DB.prepare(
      `SELECT CAST(strftime('%H', (o.created_at + 3600000) / 1000, 'unixepoch') AS INTEGER) AS hour, COUNT(*) AS orders
         FROM orders o WHERE ${inRange} AND ${valid} GROUP BY hour`,
    ).bind(since, until),
    c.env.DB.prepare(
      `SELECT oi.product_id, oi.name_fr, SUM(oi.qty) AS units, SUM(oi.unit_price * oi.qty) AS revenue FROM order_items oi JOIN orders o ON o.id = oi.order_id
        WHERE ${inRange} AND ${valid} GROUP BY oi.product_id, oi.name_fr ORDER BY units DESC LIMIT 10`,
    ).bind(since, until),
    c.env.DB.prepare(
      `SELECT CASE WHEN o.status IN ('retour','retour_recu') THEN 'return' ELSE 'cancel' END AS kind, COALESCE(o.outcome_reason, 'unknown') AS reason, COUNT(*) AS n
         FROM orders o WHERE ${inRange} AND o.status IN ('annulee','doublon','fausse','retour','retour_recu')
        GROUP BY kind, reason ORDER BY n DESC`,
    ).bind(since, until),
    // durations in hours for orders that reached each step (capped at 2,000 rows)
    c.env.DB.prepare(
      `SELECT (o.shipped_at - o.confirmed_at) / 3600000.0 AS prep_h,
              CASE WHEN o.status = 'livree' THEN (o.delivered_at - o.shipped_at) / 3600000.0 END AS ship_h
         FROM orders o WHERE ${inRange} AND o.shipped_at IS NOT NULL AND o.confirmed_at IS NOT NULL AND o.shipped_at >= o.confirmed_at LIMIT 2000`,
    ).bind(since, until),
    c.env.DB.prepare(
      `SELECT o.delivery_type AS type,
              SUM(CASE WHEN o.shipped_at IS NOT NULL THEN 1 ELSE 0 END) AS shipped,
              SUM(CASE WHEN o.status = 'livree' THEN 1 ELSE 0 END) AS delivered,
              SUM(CASE WHEN o.status IN ('retour','retour_recu') THEN 1 ELSE 0 END) AS returned,
              AVG(CASE WHEN o.status = 'livree' AND o.shipped_at IS NOT NULL AND o.delivered_at > o.shipped_at THEN (o.delivered_at - o.shipped_at) / 86400000.0 END) AS avg_days,
              SUM(CASE WHEN o.status = 'livree' AND o.shipped_at IS NOT NULL AND o.delivered_at > o.shipped_at THEN 1 ELSE 0 END) AS timed
         FROM orders o WHERE ${inRange} GROUP BY o.delivery_type`,
    ).bind(since, until),
  ]);

  const t = totals!.results[0] as Record<string, number | null>;
  const n = (k: string) => t[k] ?? 0;
  const byStatus = Object.fromEntries((statusRows!.results as { status: string; n: number }[]).map((r) => [r.status, r.n]));
  const reached = (list: string[]) => list.reduce((s, k) => s + (byStatus[k] ?? 0), 0);
  const confirmed = reached(["confirmee", "en_preparation", "expediee", "en_livraison", "livree", "retour", "retour_recu"]);
  const shipped = reached(["expediee", "en_livraison", "livree", "retour", "retour_recu"]);
  const resolved = n("delivered") + n("returned"); // parcels whose fate is known
  const pct = (a: number, b: number) => (b ? Math.round((a / b) * 100) : null);

  const median = (xs: number[]) => {
    if (xs.length < MIN_SAMPLE) return null;
    const s = [...xs].sort((a, b) => a - b);
    const m = Math.floor(s.length / 2);
    return Math.round((s.length % 2 ? s[m]! : (s[m - 1]! + s[m]!) / 2) * 10) / 10;
  };
  const d = durations!.results as { prep_h: number | null; ship_h: number | null }[];
  const prep = d.map((r) => r.prep_h).filter((x): x is number => x != null && x >= 0);
  const ship = d.map((r) => r.ship_h).filter((x): x is number => x != null && x > 0);
  const roundDays = (v: number | null, timed: number) => (v == null || timed < MIN_SAMPLE ? null : Math.round(v * 10) / 10);

  return c.json({
    range: { since, until, label, days },
    totals: {
      placed: n("placed"),
      orders: n("orders"),
      revenue: n("revenue"),
      deliveredRevenue: n("delivered_revenue"),
      avgBasket: n("orders") ? Math.round(n("revenue") / n("orders")) : null,
      delivered: n("delivered"),
      cancelled: n("cancelled"),
      returned: n("returned"),
      pending: n("pending"),
      inProgress: n("in_progress"),
      customers: n("customers"),
      repeatRate: pct(n("repeat_orders"), n("orders")),
      confirmRate: pct(confirmed, confirmed + n("cancelled")),
      deliveryRate: pct(n("delivered"), resolved),
      returnRate: pct(n("returned"), resolved),
    },
    funnel: { placed: n("placed"), confirmed, shipped, delivered: n("delivered"), returned: n("returned"), cancelled: n("cancelled") },
    daily: daily!.results,
    byStatus,
    wilayas: (wilayas!.results as Record<string, number | string | null>[]).map((w) => {
      const delivered = Number(w.delivered ?? 0);
      const returned = Number(w.returned ?? 0);
      return { ...w, deliveryRate: pct(delivered, delivered + returned), avg_days: roundDays(w.avg_days as number | null, Number(w.timed ?? 0)) };
    }),
    channels: channels!.results,
    hours: hours!.results,
    topProducts: top!.results,
    reasons: reasons!.results,
    delivery: {
      minSample: MIN_SAMPLE,
      prepHoursMedian: median(prep),
      prepSample: prep.length,
      shipDaysMedian: median(ship) == null ? null : Math.round((median(ship)! / 24) * 10) / 10,
      shipSample: ship.length,
      byType: (byType!.results as Record<string, number | string | null>[]).map((r) => {
        const delivered = Number(r.delivered ?? 0);
        const returned = Number(r.returned ?? 0);
        return { ...r, deliveryRate: pct(delivered, delivered + returned), avg_days: roundDays(r.avg_days as number | null, Number(r.timed ?? 0)) };
      }),
    },
  });
});

/* ───────────── Équipe ───────────── */

systemRoutes.get("/team", requirePermission("team.manage"), async (c) => {
  const [members, roles] = await c.env.DB.batch([
    c.env.DB.prepare(
      `SELECT m.id, m.email, m.name, m.phone, m.telegram_user_id, m.is_active, m.last_seen_at, m.created_at, m.email_verified_at,
              (m.password_hash IS NOT NULL) AS has_password, r.key AS role, r.name AS role_name,
              (SELECT COUNT(*) FROM admin_sessions s WHERE s.member_id = m.id AND s.expires_at > ?) AS sessions
         FROM team_members m JOIN roles r ON r.id = m.role_id ORDER BY m.is_active DESC, m.created_at`,
    ).bind(Date.now()),
    c.env.DB.prepare("SELECT key, name, permissions FROM roles ORDER BY id"),
  ]);
  return c.json({ members: members!.results, roles: (roles!.results as { key: string; name: string; permissions: string }[]).map((r) => ({ ...r, permissions: JSON.parse(r.permissions) })) });
});

async function sendInvite(c: Parameters<typeof body>[0], memberId: number, email: string, name: string) {
  const token = await createInvite(c.env, memberId);
  const origin = new URL(c.req.url).origin;
  const url = `${origin}/admin/invitation?token=${token}`;
  const mail = await sendMail(c.env, {
    to: email,
    subject: "Invitation à l'équipe Henine Boutique",
    text: `Bonjour ${name},\n\nVous êtes invitée à rejoindre l'administration de Henine Boutique.\nChoisissez votre mot de passe ici (lien valable 7 jours) :\n${url}`,
    html: mailLayout("Invitation à l'équipe Henine Boutique", [`Bonjour ${name},`, "Vous êtes invitée à rejoindre l'administration de Henine Boutique.", "Ce lien est valable 7 jours."], undefined, { label: "Choisir mon mot de passe", url }),
  });
  return { inviteUrl: url, emailed: mail.delivered && mailProvider(c.env) !== "console", provider: mail.provider };
}

systemRoutes.post("/team", requirePermission("team.manage"), async (c) => {
  const input = await body(c, z.object({ email: z.string().trim().toLowerCase().email().max(120), name: cleanText(60).pipe(z.string().min(2)), role: z.enum(Object.keys(ROLE_PRESETS) as [string, ...string[]]) }));
  const role = await c.env.DB.prepare("SELECT id FROM roles WHERE key = ?").bind(input.role).first<{ id: number }>();
  if (!role) throw new HttpError(422, "unknown_role");
  let member: { id: number } | null;
  try {
    member = await c.env.DB.prepare("INSERT INTO team_members (email, name, role_id, is_active, created_at) VALUES (?, ?, ?, 1, ?) RETURNING id")
      .bind(input.email, input.name, role.id, Date.now())
      .first<{ id: number }>();
  } catch (err) {
    if (String((err as Error).message).includes("UNIQUE")) throw new HttpError(409, "email_taken");
    throw err;
  }
  await c.env.DB.batch([auditStmt(c.env, actorOf(c.get("member")), "invite", "team_member", member!.id, { email: input.email, role: input.role })]);
  return c.json({ id: member!.id, ...(await sendInvite(c, member!.id, input.email, input.name)) }, 201);
});

systemRoutes.post("/team/:id/invite", requirePermission("team.manage"), async (c) => {
  const id = intParam(c, "id");
  const m = await c.env.DB.prepare("SELECT email, name FROM team_members WHERE id = ?").bind(id).first<{ email: string; name: string }>();
  if (!m) throw new HttpError(404, "not_found");
  return c.json(await sendInvite(c, id, m.email, m.name));
});

systemRoutes.patch("/team/:id", requirePermission("team.manage"), async (c) => {
  const id = intParam(c, "id");
  const input = await body(
    c,
    z.object({
      name: cleanText(60).pipe(z.string().min(2)).optional(),
      role: z.enum(Object.keys(ROLE_PRESETS) as [string, ...string[]]).optional(),
      isActive: z.boolean().optional(),
      telegramUserId: z.number().int().positive().nullable().optional(),
      phone: cleanText(20).nullable().optional(),
    }),
  );
  const me = c.get("member");
  if (id === me.id && (input.isActive === false || (input.role && input.role !== me.role))) throw new HttpError(409, "cannot_demote_self");
  if (input.isActive === false || (input.role && input.role !== "owner")) {
    // never leave the shop without an active owner
    const owners = await c.env.DB.prepare(
      "SELECT COUNT(*) AS n FROM team_members m JOIN roles r ON r.id = m.role_id WHERE r.key = 'owner' AND m.is_active = 1 AND m.id != ?",
    )
      .bind(id)
      .first<{ n: number }>();
    const target = await c.env.DB.prepare("SELECT r.key FROM team_members m JOIN roles r ON r.id = m.role_id WHERE m.id = ?").bind(id).first<{ key: string }>();
    if (target?.key === "owner" && !owners?.n) throw new HttpError(409, "last_owner");
  }
  const stmts = [
    c.env.DB.prepare(
      `UPDATE team_members SET name = COALESCE(?, name), role_id = COALESCE((SELECT id FROM roles WHERE key = ?), role_id),
         is_active = COALESCE(?, is_active), telegram_user_id = CASE WHEN ? THEN ? ELSE telegram_user_id END,
         phone = CASE WHEN ? THEN ? ELSE phone END WHERE id = ?`,
    ).bind(
      input.name ?? null, input.role ?? null, input.isActive == null ? null : input.isActive ? 1 : 0,
      "telegramUserId" in input ? 1 : 0, input.telegramUserId ?? null, "phone" in input ? 1 : 0, input.phone ?? null, id,
    ),
    auditStmt(c.env, actorOf(me), "update", "team_member", id, input),
  ];
  if (input.isActive === false) stmts.push(c.env.DB.prepare("DELETE FROM admin_sessions WHERE member_id = ?").bind(id));
  try {
    await c.env.DB.batch(stmts);
  } catch (err) {
    if (String((err as Error).message).includes("telegram_user_id")) throw new HttpError(409, "telegram_id_taken");
    throw err;
  }
  return c.json({ ok: true });
});

systemRoutes.delete("/team/:id/sessions", requirePermission("team.manage"), async (c) => {
  const id = intParam(c, "id");
  await c.env.DB.batch([c.env.DB.prepare("DELETE FROM admin_sessions WHERE member_id = ?").bind(id), auditStmt(c.env, actorOf(c.get("member")), "revoke_sessions", "team_member", id)]);
  return c.json({ ok: true });
});

/* ───────────── Comptes: my account + integrations ───────────── */

systemRoutes.get("/account", async (c) => {
  const m = c.get("member");
  const { results } = await c.env.DB.prepare(
    "SELECT id, user_agent, created_at, last_seen_at, expires_at FROM admin_sessions WHERE member_id = ? AND expires_at > ? ORDER BY last_seen_at DESC",
  )
    .bind(m.id, Date.now())
    .all<{ id: number }>();
  return c.json({ member: { id: m.id, email: m.email, name: m.name, roleName: m.roleName }, sessions: results.map((s) => ({ ...s, current: s.id === m.sessionId })) });
});

systemRoutes.post("/account/password", async (c) => {
  const m = c.get("member");
  const input = await body(c, z.object({ currentKey: z.string().refine(passwordKeyValid), newKey: z.string().refine(passwordKeyValid) }));
  const row = await c.env.DB.prepare("SELECT password_hash, password_salt FROM team_members WHERE id = ?").bind(m.id).first<{ password_hash: string | null; password_salt: string | null }>();
  if (!(await checkPassword(c.env, input.currentKey, row?.password_hash ?? null, row?.password_salt ?? null))) throw new HttpError(403, "wrong_password");
  const { hash, salt } = await hashPassword(c.env, input.newKey);
  await c.env.DB.batch([
    c.env.DB.prepare("UPDATE team_members SET password_hash = ?, password_salt = ? WHERE id = ?").bind(hash, salt, m.id),
    // sign out every other device
    c.env.DB.prepare("DELETE FROM admin_sessions WHERE member_id = ? AND id != ?").bind(m.id, m.sessionId),
    auditStmt(c.env, actorOf(m), "password_change", "team_member", m.id),
  ]);
  return c.json({ ok: true });
});

systemRoutes.delete("/account/sessions/:id", async (c) => {
  await c.env.DB.prepare("DELETE FROM admin_sessions WHERE id = ? AND member_id = ?").bind(intParam(c, "id"), c.get("member").id).run();
  return c.json({ ok: true });
});

systemRoutes.get("/integrations", requirePermission("integrations.manage"), async (c) => {
  const tg = await telegramConfig(c.env);
  const s = await getSettings(c.env, ["integrations", "notifications"]);
  const zrId = await decryptSecret(c.env.SETTINGS_KEY, s.integrations.zr_id_enc);
  return c.json({
    telegram: {
      tokenMasked: maskSecret(tg.token), botUsername: tg.bot_username, chatId: tg.chat_id, chatTitle: tg.chat_title,
      webhookUrl: tg.webhook_url, mode: isDev(c.env) ? "poll" : tg.webhook_url ? "webhook" : "none", trustGroup: s.notifications.trust_group_members,
    },
    mail: { provider: mailProvider(c.env), from: c.env.MAIL_FROM ?? null },
    zr: { configured: !!zrId, idMasked: maskSecret(zrId) },
    pixels: { metaPixelId: s.integrations.meta_pixel_id, tiktokPixelId: s.integrations.tiktok_pixel_id },
    turnstile: { siteKey: c.env.TURNSTILE_SITE_KEY, testKeys: c.env.TURNSTILE_SITE_KEY.startsWith("1x000") },
    publicOrigin: c.env.PUBLIC_ORIGIN,
  });
});

systemRoutes.post("/integrations/telegram/token", requirePermission("integrations.manage"), async (c) => {
  const { token } = await body(c, z.object({ token: z.string().trim().regex(/^\d{5,12}:[A-Za-z0-9_-]{30,50}$/, "token_format") }));
  const me = await tgCall<{ username: string }>(token, "getMe");
  if (!me.ok) throw new HttpError(422, "telegram_token_rejected", { description: me.description });
  await patchSetting(c.env, "telegram", { token_enc: await encryptSecret(c.env.SETTINGS_KEY, token), bot_username: me.result!.username, last_update_id: 0 });
  await c.env.DB.batch([auditStmt(c.env, actorOf(c.get("member")), "update", "integration", "telegram_token")]);
  return c.json({ botUsername: me.result!.username });
});

systemRoutes.post("/integrations/telegram/detect", requirePermission("integrations.manage"), async (c) => {
  const cfg = await telegramConfig(c.env);
  if (!cfg.token) throw new HttpError(409, "telegram_token_missing");
  const res = await tgCall<{ message?: { chat: { id: number; title?: string; type: string; first_name?: string } }; my_chat_member?: { chat: { id: number; title?: string; type: string } } }[]>(
    cfg.token,
    "getUpdates",
    { limit: 100, timeout: 0 },
  );
  if (!res.ok) throw new HttpError(409, "telegram_error", { description: res.description });
  const chats = new Map<number, { id: number; title: string; type: string }>();
  for (const u of res.result ?? []) {
    const chat = u.message?.chat ?? u.my_chat_member?.chat;
    if (chat) chats.set(chat.id, { id: chat.id, title: chat.title ?? (u.message?.chat.first_name ?? "Discussion privée"), type: chat.type });
  }
  return c.json([...chats.values()]);
});

systemRoutes.post("/integrations/telegram/chat", requirePermission("integrations.manage"), async (c) => {
  const input = await body(c, z.object({ chatId: z.string().trim().regex(/^-?\d{3,20}$/), chatTitle: cleanText(80).optional() }));
  await patchSetting(c.env, "telegram", { chat_id: input.chatId, chat_title: input.chatTitle ?? null });
  await c.env.DB.batch([auditStmt(c.env, actorOf(c.get("member")), "update", "integration", "telegram_chat")]);
  return c.json({ ok: true });
});

systemRoutes.post("/integrations/telegram/test", requirePermission("integrations.manage"), async (c) => {
  const ok = await sendTelegramText(c.env, `🌸 Test Henine Boutique : les commandes arriveront ici.\nEnvoyé par ${c.get("member").name.replace(/[<>&]/g, "")}.`);
  if (!ok) throw new HttpError(409, "telegram_test_failed");
  return c.json({ ok: true });
});

systemRoutes.post("/integrations/telegram/webhook", requirePermission("integrations.manage"), async (c) => {
  const cfg = await telegramConfig(c.env);
  if (!cfg.token) throw new HttpError(409, "telegram_token_missing");
  if (!c.env.PUBLIC_ORIGIN.startsWith("https://")) throw new HttpError(409, "https_required");
  const secret = randomToken(24);
  const url = `${c.env.PUBLIC_ORIGIN}/api/tg/webhook`;
  const res = await tgCall(cfg.token, "setWebhook", { url, secret_token: secret, allowed_updates: ["message", "callback_query"], drop_pending_updates: false });
  if (!res.ok) throw new HttpError(409, "telegram_error", { description: res.description });
  await patchSetting(c.env, "telegram", { webhook_secret_enc: await encryptSecret(c.env.SETTINGS_KEY, secret), webhook_url: url });
  return c.json({ webhookUrl: url });
});

systemRoutes.delete("/integrations/telegram", requirePermission("integrations.manage"), async (c) => {
  const cfg = await telegramConfig(c.env);
  if (cfg.token && cfg.webhook_url) await tgCall(cfg.token, "deleteWebhook");
  await patchSetting(c.env, "telegram", { token_enc: null, chat_id: null, chat_title: null, bot_username: null, webhook_secret_enc: null, webhook_url: null, last_update_id: 0 });
  await c.env.DB.batch([auditStmt(c.env, actorOf(c.get("member")), "delete", "integration", "telegram")]);
  return c.json({ ok: true });
});

systemRoutes.put("/integrations/zr", requirePermission("integrations.manage"), async (c) => {
  const input = await body(c, z.object({ id: z.string().trim().min(3).max(120), token: z.string().trim().min(8).max(300) }));
  await patchSetting(c.env, "integrations", {
    zr_id_enc: await encryptSecret(c.env.SETTINGS_KEY, input.id),
    zr_token_enc: await encryptSecret(c.env.SETTINGS_KEY, input.token),
  });
  await c.env.DB.batch([auditStmt(c.env, actorOf(c.get("member")), "update", "integration", "zr_express")]);
  return c.json({ ok: true });
});

systemRoutes.put("/integrations/pixels", requirePermission("integrations.manage"), async (c) => {
  const input = await body(c, z.object({ metaPixelId: z.string().regex(/^\d{5,20}$/).nullable(), tiktokPixelId: z.string().regex(/^[A-Z0-9]{5,30}$/).nullable() }));
  await patchSetting(c.env, "integrations", { meta_pixel_id: input.metaPixelId, tiktok_pixel_id: input.tiktokPixelId });
  return c.json({ ok: true });
});

systemRoutes.post("/integrations/mail/test", requirePermission("integrations.manage"), async (c) => {
  const m = c.get("member");
  const res = await sendMail(c.env, {
    to: m.email,
    subject: "Test d'envoi Henine Boutique",
    text: "Si vous lisez ceci, l'envoi d'emails fonctionne.",
    html: mailLayout("Test d'envoi", ["Si vous lisez ceci, l'envoi d'emails fonctionne. 🌸"]),
  });
  return c.json({ ...res, devNote: devEcho(c, "Mode développement : aucun email réel n'est envoyé (voir la console du serveur).") });
});

/* ───────────── Contenu: delivery prices, pages, store identity ───────────── */

systemRoutes.get("/content/wilayas", requirePermission("delivery.edit"), async (c) => {
  const [rows, verified] = await Promise.all([
    c.env.DB.prepare(
      "SELECT w.*, (SELECT COUNT(*) FROM communes cm WHERE cm.wilaya_code = w.code) AS communes, (SELECT COUNT(*) FROM orders o WHERE o.wilaya_code = w.code) AS orders FROM wilayas w ORDER BY w.code",
    ).all(),
    getSetting(c.env, "shipping.prices_verified"),
  ]);
  return c.json({ rows: rows.results, verified });
});

const priceField = z.number().int().min(0).max(20000).nullable();
systemRoutes.put("/content/wilayas", requirePermission("delivery.edit"), async (c) => {
  const input = await body(
    c,
    z.object({
      codes: z.array(z.number().int().min(1).max(69)).min(1).max(69),
      homePrice: priceField.optional(),
      deskPrice: priceField.optional(),
      delayDays: z.string().trim().max(10).nullable().optional(),
      isActive: z.boolean().optional(),
      markVerified: z.boolean().optional(),
    }),
  );
  const sets: string[] = [];
  const vals: unknown[] = [];
  if ("homePrice" in input) (sets.push("home_price = ?"), vals.push(input.homePrice));
  if ("deskPrice" in input) (sets.push("desk_price = ?"), vals.push(input.deskPrice));
  if ("delayDays" in input) (sets.push("delay_days = ?"), vals.push(input.delayDays));
  if ("isActive" in input) (sets.push("is_active = ?"), vals.push(input.isActive ? 1 : 0));
  const stmts: D1PreparedStatement[] = [];
  if (sets.length) {
    stmts.push(c.env.DB.prepare(`UPDATE wilayas SET ${sets.join(", ")}, updated_at = ? WHERE code IN (${input.codes.map(() => "?").join(",")})`).bind(...vals, Date.now(), ...input.codes));
  }
  if (input.markVerified) stmts.push(setSettingStmt(c.env, "shipping.prices_verified", true));
  stmts.push(bumpCatalogStmt(c.env), auditStmt(c.env, actorOf(c.get("member")), "update", "wilayas", input.codes.join(","), { ...input, codes: undefined }));
  await c.env.DB.batch(stmts);
  return c.json({ ok: true });
});

systemRoutes.get("/content/pages", requirePermission("content.edit"), async (c) => {
  const { results } = await c.env.DB.prepare("SELECT * FROM pages ORDER BY id").all();
  return c.json(results);
});

const pageInput = z.object({
  slug: z.string().trim().regex(/^[a-z0-9-]{2,60}$/),
  titleFr: cleanText(120).pipe(z.string().min(2)),
  titleAr: cleanText(120),
  bodyFr: z.string().max(20000),
  bodyAr: z.string().max(20000),
  isActive: z.boolean().default(true),
});

systemRoutes.post("/content/pages", requirePermission("content.edit"), async (c) => {
  const p = await body(c, pageInput);
  try {
    const row = await c.env.DB.prepare("INSERT INTO pages (slug, title_fr, title_ar, body_fr, body_ar, is_active, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?) RETURNING id")
      .bind(p.slug, p.titleFr, p.titleAr || p.titleFr, p.bodyFr, p.bodyAr, p.isActive ? 1 : 0, Date.now())
      .first<{ id: number }>();
    await c.env.DB.batch([bumpCatalogStmt(c.env), auditStmt(c.env, actorOf(c.get("member")), "create", "page", row!.id)]);
    return c.json({ id: row!.id }, 201);
  } catch (err) {
    if (String((err as Error).message).includes("UNIQUE")) throw new HttpError(409, "slug_taken");
    throw err;
  }
});

systemRoutes.put("/content/pages/:id", requirePermission("content.edit"), async (c) => {
  const id = intParam(c, "id");
  const p = await body(c, pageInput);
  await c.env.DB.batch([
    c.env.DB.prepare("UPDATE pages SET slug = ?, title_fr = ?, title_ar = ?, body_fr = ?, body_ar = ?, is_active = ?, updated_at = ? WHERE id = ?").bind(
      p.slug, p.titleFr, p.titleAr || p.titleFr, p.bodyFr, p.bodyAr, p.isActive ? 1 : 0, Date.now(), id,
    ),
    bumpCatalogStmt(c.env),
    auditStmt(c.env, actorOf(c.get("member")), "update", "page", id),
  ]);
  return c.json({ ok: true });
});

systemRoutes.delete("/content/pages/:id", requirePermission("content.edit"), async (c) => {
  const id = intParam(c, "id");
  await c.env.DB.batch([c.env.DB.prepare("DELETE FROM pages WHERE id = ?").bind(id), bumpCatalogStmt(c.env), auditStmt(c.env, actorOf(c.get("member")), "delete", "page", id)]);
  return c.json({ ok: true });
});

systemRoutes.put("/content/store", requirePermission("content.edit"), async (c) => {
  const input = await body(
    c,
    z.object({ name: cleanText(60).pipe(z.string().min(2)) }),
  );
  const store = await getSetting(c.env, "store");
  await c.env.DB.batch([setSettingStmt(c.env, "store", { ...store, ...input }), bumpCatalogStmt(c.env), auditStmt(c.env, actorOf(c.get("member")), "update", "settings", "store")]);
  return c.json({ ok: true });
});

/* ───────────── Erreurs, journal, outbox ───────────── */

systemRoutes.get("/errors", requirePermission("errors.view"), async (c) => {
  const status = c.req.query("status") ?? "open";
  const [errors, outbox, audit] = await c.env.DB.batch([
    c.env.DB.prepare(`SELECT * FROM error_events ${status === "all" ? "" : "WHERE status = ?"} ORDER BY last_seen DESC LIMIT 100`).bind(...(status === "all" ? [] : [status])),
    c.env.DB.prepare("SELECT id, kind, payload, attempts, last_error, next_attempt_at, created_at FROM outbox WHERE done_at IS NULL ORDER BY id DESC LIMIT 50"),
    c.env.DB.prepare("SELECT * FROM audit_log ORDER BY id DESC LIMIT 100"),
  ]);
  return c.json({ errors: errors!.results, outbox: outbox!.results, audit: audit!.results });
});

systemRoutes.patch("/errors/:id", requirePermission("errors.view"), async (c) => {
  const input = await body(c, z.object({ status: z.enum(["open", "resolved", "ignored"]) }));
  await c.env.DB.prepare("UPDATE error_events SET status = ? WHERE id = ?").bind(input.status, intParam(c, "id")).run();
  return c.json({ ok: true });
});

systemRoutes.post("/outbox/:id/retry", requirePermission("errors.view"), async (c) => {
  await c.env.DB.prepare("UPDATE outbox SET next_attempt_at = 0, attempts = MIN(attempts, 7) WHERE id = ? AND done_at IS NULL").bind(intParam(c, "id")).run();
  const sent = await processOutbox(c.env, 5);
  return c.json({ sent });
});
