/**
 * Admin → Commandes: orders, manual sales (Ventes), customers, abandoned carts, loyalty.
 */
import { Hono } from "hono";
import { z } from "zod";
import {
  assessRisk,
  cleanText,
  customerRiskSql,
  customerSegment,
  dzPhone,
  nextStatuses,
  ORDER_STATUSES,
  orderLine,
  OUTCOME_REASON_LABEL,
  OUTCOME_REASONS,
  RISK_LEVELS,
  segmentSql,
  EXTRA_SEGMENTS,
  extraSegmentSql,
  STATUS_LABELS,
  type CustomerSegment,
  type OrderStatus,
} from "@henine/shared";
import type { AppEnv } from "../../env";
import { auditStmt } from "../../lib/audit";
import { variantLabels } from "../../lib/catalog";
import { body, HttpError, intParam } from "../../lib/http";
import { applyStatusChange, CANCELLED_SQL, createOrder } from "../../lib/orders";
import { getSetting, getSettings, setSetting } from "../../lib/settings";
import { permissionFor, syncOrderMessage } from "../../lib/telegram";
import { actorOf, requirePermission } from "../../middleware/access";
import { hasPermission } from "@henine/shared";

export const orderRoutes = new Hono<AppEnv>();

/* ───────────── Orders ───────────── */

type RiskCounters = {
  delivered_count: number | null; returned_count: number | null; cancelled_count: number | null; fake_count: number | null;
  is_blacklisted: number | null; risk_flags: string | null;
};
const riskOf = (r: RiskCounters) =>
  assessRisk(
    {
      deliveredCount: r.delivered_count ?? 0, returnedCount: r.returned_count ?? 0, cancelledCount: r.cancelled_count ?? 0,
      fakeCount: r.fake_count ?? 0, isBlacklisted: !!r.is_blacklisted,
    },
    r.risk_flags ? (JSON.parse(r.risk_flags) as string[]) : [],
  );

/**
 * "Needs attention" filters, shared by the orders list and the dashboard command center.
 * Each is a condition on `orders o` (+ `customers c`); `now` is generated server-side.
 */
export function attentionSql(now: number): Record<string, string> {
  const h = 3600_000;
  return {
    to_confirm: "o.status IN ('nouvelle','injoignable')",
    callbacks: `o.status = 'injoignable' AND o.next_callback_at <= ${now}`,
    high_risk: `o.status IN ('nouvelle','injoignable') AND (o.risk_score >= ${RISK_LEVELS.high} OR ${customerRiskSql("c")} >= ${RISK_LEVELS.high})`,
    stale_confirmed: `o.status = 'confirmee' AND COALESCE(o.confirmed_at, o.updated_at) < ${now - 24 * h}`,
    stale_preparing: `o.status = 'en_preparation' AND o.updated_at < ${now - 48 * h}`,
    stale_shipped: `o.status IN ('expediee','en_livraison') AND COALESCE(o.shipped_at, o.updated_at) < ${now - 7 * 24 * h}`,
    returns: "o.status = 'retour'",
  };
}

orderRoutes.get("/orders", requirePermission("orders.view"), async (c) => {
  const status = c.req.query("status") ?? "active";
  const attention = c.req.query("attention");
  const q = (c.req.query("q") ?? "").trim();
  const page = Math.max(0, Number(c.req.query("page") ?? 0));
  const where: string[] = [];
  const binds: unknown[] = [];
  const groups: Record<string, string[]> = {
    active: ["nouvelle", "injoignable", "confirmee", "en_preparation"],
    a_confirmer: ["nouvelle", "injoignable"],
    en_cours: ["confirmee", "en_preparation", "expediee", "en_livraison"],
    termine: ["livree"],
    annule: ["annulee", "doublon", "fausse"],
    retours: ["retour", "retour_recu"],
  };
  const attn = attention ? attentionSql(Date.now())[attention] : undefined;
  if (attn) where.push(attn);
  else if (groups[status]) {
    where.push(`o.status IN (${groups[status]!.map(() => "?").join(",")})`);
    binds.push(...groups[status]!);
  } else if ((ORDER_STATUSES as readonly string[]).includes(status)) {
    where.push("o.status = ?");
    binds.push(status);
  }
  if (q) {
    const digits = q.replace(/\D/g, "");
    where.push("(o.public_code LIKE ? OR o.name LIKE ? OR o.phone LIKE ? OR o.tracking_number = ?)");
    binds.push(`%${q.toUpperCase()}%`, `%${q}%`, `%${digits || q}%`, q);
  }
  const wilaya = Number(c.req.query("wilaya") ?? 0);
  if (Number.isInteger(wilaya) && wilaya >= 1 && wilaya <= 69) {
    where.push("o.wilaya_code = ?");
    binds.push(wilaya);
  }
  const from = Number(c.req.query("from") ?? 0);
  const to = Number(c.req.query("to") ?? 0);
  if (from > 0) {
    where.push("o.created_at >= ?");
    binds.push(from);
  }
  if (to > 0) {
    where.push("o.created_at < ?");
    binds.push(to);
  }
  const whereSql = where.length ? `WHERE ${where.join(" AND ")}` : "";
  const [rows, counts] = await c.env.DB.batch([
    c.env.DB.prepare(
      `SELECT o.id, o.public_code, o.status, o.channel, o.name, o.phone, o.total, o.wilaya_code, w.name_fr AS wilaya, o.delivery_type,
              o.created_at, o.risk_score, o.risk_flags, o.confirm_attempts, o.next_callback_at, o.tracking_number, o.outcome_reason,
              (SELECT SUM(qty) FROM order_items WHERE order_id = o.id) AS items,
              c.returned_count, c.delivered_count, c.cancelled_count, c.fake_count, c.is_blacklisted
         FROM orders o LEFT JOIN wilayas w ON w.code = o.wilaya_code LEFT JOIN customers c ON c.id = o.customer_id
         ${whereSql} ORDER BY o.created_at DESC LIMIT 50 OFFSET ?`,
    ).bind(...binds, page * 50),
    c.env.DB.prepare("SELECT status, COUNT(*) AS n FROM orders GROUP BY status"),
  ]);
  return c.json({
    rows: (rows!.results as (Record<string, unknown> & RiskCounters)[]).map(({ risk_flags, ...r }) => {
      const risk = riskOf({ ...r, risk_flags });
      return { ...r, risk: { level: risk.level, score: risk.score } };
    }),
    counts: Object.fromEntries((counts!.results as { status: string; n: number }[]).map((r) => [r.status, r.n])),
  });
});

/**
 * Several orders at once (selection in the orders list). Only the steps that need nothing
 * else: cancelling / returning still asks for a reason, "Expédiée" for the tracking number,
 * so those stay one by one. Each order goes through the same checks as a single change.
 */
const BULK_TARGETS = ["confirmee", "injoignable", "en_preparation", "en_livraison", "livree"] as const;

orderRoutes.post("/orders/bulk-status", requirePermission("orders.view"), async (c) => {
  const input = await body(c, z.object({ ids: z.array(z.number().int().positive()).min(1).max(50), to: z.enum(BULK_TARGETS) }));
  if (!hasPermission(c.get("member").permissions, permissionFor(input.to))) throw new HttpError(403, "forbidden");
  const actor = actorOf(c.get("member"));
  const done: string[] = [];
  const failed: { id: number; error: string }[] = [];
  for (const id of new Set(input.ids)) {
    try {
      const r = await applyStatusChange(c.env, id, input.to, actor, "admin", "action groupée");
      done.push(r.code);
      c.executionCtx.waitUntil(syncOrderMessage(c.env, id).catch(() => undefined));
    } catch (err) {
      failed.push({ id, error: err instanceof HttpError ? err.code : "error" });
    }
  }
  return c.json({ done, failed });
});

/** Packing slips: everything the parcel needs, for up to 50 orders. */
orderRoutes.get("/order-slips", requirePermission("orders.view"), async (c) => {
  const ids = [...new Set((c.req.query("ids") ?? "").split(",").map(Number).filter((n) => Number.isInteger(n) && n > 0))].slice(0, 50);
  if (!ids.length) throw new HttpError(400, "no_orders");
  const ph = ids.map(() => "?").join(",");
  const [orders, items] = await c.env.DB.batch([
    c.env.DB.prepare(
      `SELECT o.id, o.public_code, o.status, o.created_at, o.name, o.phone, o.wilaya_code, w.name_fr AS wilaya_fr, w.name_ar AS wilaya_ar,
              COALESCE(cm.name_fr, o.commune_text) AS commune_fr, COALESCE(cm.name_ar, o.commune_text) AS commune_ar, o.address, o.delivery_type,
              o.subtotal, o.discount_total, o.shipping_price, o.total, o.customer_note, o.tracking_number, o.locale, o.coupon_code
         FROM orders o LEFT JOIN wilayas w ON w.code = o.wilaya_code LEFT JOIN communes cm ON cm.id = o.commune_id
        WHERE o.id IN (${ph})`,
    ).bind(...ids),
    c.env.DB.prepare(`SELECT order_id, name_fr, name_ar, options_label, sku, qty, unit_price FROM order_items WHERE order_id IN (${ph}) ORDER BY id`).bind(...ids),
  ]);
  const { contact, store } = await getSettings(c.env, ["contact", "store"]);
  const byId = new Map((orders!.results as { id: number }[]).map((o) => [o.id, o]));
  const lines = items!.results as { order_id: number }[];
  return c.json({
    store: { name: store.name, phone: contact.phone ?? contact.whatsapp, address: contact.address_fr },
    slips: ids.filter((id) => byId.has(id)).map((id) => ({ ...byId.get(id)!, items: lines.filter((l) => l.order_id === id) })),
  });
});

orderRoutes.get("/orders/:id", requirePermission("orders.view"), async (c) => {
  const id = intParam(c, "id");
  const o = await c.env.DB.prepare(
    `SELECT o.*, w.name_fr AS wilaya_fr, cm.name_fr AS commune_fr, c.orders_count, c.delivered_count, c.returned_count,
            c.cancelled_count, c.fake_count, c.is_blacklisted, c.total_spent, c.points_balance, m.name AS assigned_name
       FROM orders o LEFT JOIN wilayas w ON w.code = o.wilaya_code LEFT JOIN communes cm ON cm.id = o.commune_id
       LEFT JOIN customers c ON c.id = o.customer_id LEFT JOIN team_members m ON m.id = o.assigned_to
      WHERE o.id = ?`,
  )
    .bind(id)
    .first<Record<string, unknown> & RiskCounters & { status: OrderStatus; total_spent: number | null; track_token_hash?: string; ip_hash?: string; op_nonce?: string }>();
  if (!o) throw new HttpError(404, "not_found");
  const risk = riskOf(o);
  const segment = customerSegment({
    deliveredCount: o.delivered_count ?? 0, returnedCount: o.returned_count ?? 0, cancelledCount: o.cancelled_count ?? 0,
    fakeCount: o.fake_count ?? 0, isBlacklisted: !!o.is_blacklisted, totalSpent: o.total_spent ?? 0,
  });
  delete o.track_token_hash;
  delete o.ip_hash;
  delete o.op_nonce;
  const [items, events] = await c.env.DB.batch([
    c.env.DB.prepare(
      `SELECT oi.*, v.stock_on_hand - v.stock_reserved AS available FROM order_items oi LEFT JOIN variants v ON v.id = oi.variant_id WHERE oi.order_id = ?`,
    ).bind(id),
    c.env.DB.prepare("SELECT * FROM order_events WHERE order_id = ? ORDER BY id").bind(id),
  ]);
  const perms = c.get("member").permissions;
  return c.json({
    order: o,
    items: items!.results,
    events: events!.results,
    next: nextStatuses(o.status).filter((s) => hasPermission(perms, permissionFor(s))),
    risk,
    segment,
  });
});

orderRoutes.post("/orders/:id/status", requirePermission("orders.view"), async (c) => {
  const id = intParam(c, "id");
  const input = await body(
    c,
    z.object({
      to: z.enum(ORDER_STATUSES),
      note: cleanText(300).optional(),
      reason: z.enum(OUTCOME_REASONS).optional(),
      /** "Expédiée": the ZR Express tracking number, saved in the same step */
      trackingNumber: cleanText(60).optional(),
    }),
  );
  if (!hasPermission(c.get("member").permissions, permissionFor(input.to))) throw new HttpError(403, "forbidden");
  if (input.trackingNumber) {
    await c.env.DB.prepare("UPDATE orders SET tracking_number = ?, updated_at = ? WHERE id = ?").bind(input.trackingNumber, Date.now(), id).run();
  }
  const note = [input.reason ? OUTCOME_REASON_LABEL[input.reason] : null, input.note].filter(Boolean).join(" · ") || undefined;
  const res = await applyStatusChange(c.env, id, input.to, actorOf(c.get("member")), "admin", note, input.reason);
  c.executionCtx.waitUntil(syncOrderMessage(c.env, id).catch(() => undefined));
  return c.json(res);
});

orderRoutes.patch("/orders/:id", requirePermission("orders.edit"), async (c) => {
  const id = intParam(c, "id");
  const input = await body(
    c,
    z.object({
      name: cleanText(80).pipe(z.string().min(2)).optional(),
      phone: dzPhone.optional(),
      wilayaCode: z.number().int().min(1).max(69).optional(),
      communeId: z.number().int().positive().nullable().optional(),
      address: cleanText(200).nullable().optional(),
      deliveryType: z.enum(["domicile", "bureau"]).optional(),
      shippingPrice: z.number().int().min(0).max(10000).optional(),
      internalNote: cleanText(1000).nullable().optional(),
      trackingNumber: cleanText(60).nullable().optional(),
      assignedTo: z.number().int().positive().nullable().optional(),
      outcomeReason: z.enum(OUTCOME_REASONS).nullable().optional(),
    }),
  );
  const cols: string[] = [];
  const vals: unknown[] = [];
  const map: Record<string, string> = {
    name: "name", phone: "phone", wilayaCode: "wilaya_code", communeId: "commune_id", address: "address", deliveryType: "delivery_type",
    shippingPrice: "shipping_price", internalNote: "internal_note", trackingNumber: "tracking_number", assignedTo: "assigned_to",
    outcomeReason: "outcome_reason",
  };
  for (const [k, col] of Object.entries(map)) {
    if (k in input) {
      cols.push(`${col} = ?`);
      vals.push((input as Record<string, unknown>)[k] ?? null);
    }
  }
  if (!cols.length) return c.json({ ok: true });
  const stmts = [
    c.env.DB.prepare(`UPDATE orders SET ${cols.join(", ")}, updated_at = ? WHERE id = ?`).bind(...vals, Date.now(), id),
    c.env.DB.prepare("INSERT INTO order_events (order_id, kind, actor, source, note, created_at) VALUES (?, 'edit', ?, 'admin', ?, ?)").bind(
      id, actorOf(c.get("member")), `Modifié : ${Object.keys(input).join(", ")}`, Date.now(),
    ),
    auditStmt(c.env, actorOf(c.get("member")), "update", "order", id, Object.keys(input)),
  ];
  if ("shippingPrice" in input) stmts.splice(1, 0, c.env.DB.prepare("UPDATE orders SET total = subtotal - discount_total + shipping_price WHERE id = ?").bind(id));
  await c.env.DB.batch(stmts);
  c.executionCtx.waitUntil(syncOrderMessage(c.env, id).catch(() => undefined));
  return c.json({ ok: true });
});

orderRoutes.post("/orders/:id/note", requirePermission("orders.view"), async (c) => {
  const id = intParam(c, "id");
  const input = await body(c, z.object({ note: cleanText(1000).pipe(z.string().min(1)), kind: z.enum(["note", "call", "whatsapp"]).default("note") }));
  await c.env.DB.prepare("INSERT INTO order_events (order_id, kind, actor, source, note, created_at) VALUES (?, ?, ?, 'admin', ?, ?)")
    .bind(id, input.kind, actorOf(c.get("member")), input.note, Date.now())
    .run();
  return c.json({ ok: true }, 201);
});

orderRoutes.get("/orders.csv", requirePermission("orders.export"), async (c) => {
  const days = Math.min(365, Number(c.req.query("days") ?? 30));
  const { results } = await c.env.DB.prepare(
    `SELECT o.public_code, o.created_at, o.status, o.channel, o.name, o.phone, w.name_fr AS wilaya, cm.name_fr AS commune, o.address,
            o.delivery_type, o.subtotal, o.discount_total, o.shipping_price, o.total, o.coupon_code, o.tracking_number,
            (SELECT GROUP_CONCAT(name_fr || COALESCE(' ' || options_label, '') || ' x' || qty, ' | ') FROM order_items WHERE order_id = o.id) AS articles
       FROM orders o LEFT JOIN wilayas w ON w.code = o.wilaya_code LEFT JOIN communes cm ON cm.id = o.commune_id
      WHERE o.created_at > ? ORDER BY o.created_at DESC`,
  )
    .bind(Date.now() - days * 86400_000)
    .all<Record<string, unknown>>();
  const cols = ["public_code", "created_at", "status", "channel", "name", "phone", "wilaya", "commune", "address", "delivery_type", "subtotal", "discount_total", "shipping_price", "total", "coupon_code", "tracking_number", "articles"];
  const cell = (v: unknown) => {
    let s = v == null ? "" : String(v);
    if (/^[=+\-@]/.test(s)) s = `'${s}`; // spreadsheet formula injection
    return `"${s.replace(/"/g, '""')}"`;
  };
  const csv = [cols.join(";"), ...results.map((r) => cols.map((k) => (k === "created_at" ? cell(new Date(Number(r[k]) + 3600_000).toISOString().slice(0, 16).replace("T", " ")) : k === "status" ? cell(STATUS_LABELS[r[k] as OrderStatus]?.fr ?? r[k]) : cell(r[k]))).join(";"))].join("\r\n");
  await c.env.DB.batch([auditStmt(c.env, actorOf(c.get("member")), "export", "orders", null, { days, rows: results.length })]);
  return new Response(`﻿${csv}`, {
    headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="commandes-${new Date().toISOString().slice(0, 10)}.csv"` },
  });
});

/* ───────────── Ventes: manual sales + performance ───────────── */

orderRoutes.post("/sales/manual", requirePermission("sales.create"), async (c) => {
  const input = await body(
    c,
    z.object({
      channel: z.enum(["boutique", "instagram", "whatsapp", "telephone"]),
      name: cleanText(80).pipe(z.string().min(2)),
      phone: dzPhone,
      lines: z.array(orderLine).min(1).max(30),
      status: z.enum(["livree", "confirmee", "nouvelle"]),
      wilaya: z.number().int().min(1).max(69).default(35),
      communeId: z.number().int().positive().nullable().default(null),
      deliveryType: z.enum(["domicile", "bureau"]).default("bureau"),
      address: cleanText(200).optional(),
      shipping: z.number().int().min(0).max(10000).optional(),
      coupon: z.string().trim().toUpperCase().max(32).optional(),
      note: cleanText(500).optional(),
    }),
  );
  const order = await createOrder(c.env, {
    idempotencyKey: crypto.randomUUID(),
    name: input.name,
    phone: input.phone,
    wilaya: input.wilaya,
    communeId: input.communeId,
    communeText: input.channel === "boutique" ? "Boutique" : undefined,
    deliveryType: input.deliveryType,
    address: input.address,
    coupon: input.coupon || undefined,
    lines: input.lines,
    channel: input.channel,
    locale: "fr",
    initialStatus: input.status,
    actor: actorOf(c.get("member")),
    internalNote: input.note,
    shippingOverride: input.channel === "boutique" ? 0 : input.shipping,
  });
  await c.env.DB.batch([auditStmt(c.env, actorOf(c.get("member")), "manual_sale", "order", order.id, { channel: input.channel, total: order.total })]);
  return c.json(order, 201);
});

orderRoutes.get("/sales", requirePermission("sales.view"), async (c) => {
  const days = Math.min(365, Math.max(1, Number(c.req.query("days") ?? 30)));
  const since = Date.now() - days * 86400_000;
  const valid = "o.status NOT IN ('nouvelle','injoignable','annulee','doublon','fausse')";
  const canSeeCost = c.get("member").permissions.includes("*") || c.get("member").permissions.includes("cost.view");
  const [byProduct, byChannel, totals, recent] = await c.env.DB.batch([
    c.env.DB.prepare(
      `SELECT oi.product_id, oi.name_fr, SUM(oi.qty) AS units, SUM(oi.unit_price * oi.qty) AS revenue,
              SUM(oi.qty * COALESCE(p.cost_price, 0)) AS cost,
              SUM(CASE WHEN o.status IN ('retour','retour_recu') THEN oi.qty ELSE 0 END) AS returned
         FROM order_items oi JOIN orders o ON o.id = oi.order_id LEFT JOIN products p ON p.id = oi.product_id
        WHERE o.created_at > ? AND ${valid}
        GROUP BY oi.product_id, oi.name_fr ORDER BY revenue DESC LIMIT 50`,
    ).bind(since),
    c.env.DB.prepare(`SELECT o.channel, COUNT(*) AS orders, SUM(o.total) AS revenue FROM orders o WHERE o.created_at > ? AND ${valid} GROUP BY o.channel ORDER BY revenue DESC`).bind(since),
    c.env.DB.prepare(`SELECT COUNT(*) AS orders, COALESCE(SUM(o.total), 0) AS revenue, COALESCE(SUM(o.subtotal - o.discount_total), 0) AS merch FROM orders o WHERE o.created_at > ? AND ${valid}`).bind(since),
    c.env.DB.prepare(
      `SELECT o.id, o.public_code, o.channel, o.name, o.total, o.status, o.created_at FROM orders o WHERE o.channel IN ('boutique','instagram','whatsapp','telephone') ORDER BY o.id DESC LIMIT 15`,
    ),
  ]);
  return c.json({
    days,
    totals: totals!.results[0],
    byProduct: (byProduct!.results as Record<string, unknown>[]).map((r) => (canSeeCost ? r : { ...r, cost: null })),
    byChannel: byChannel!.results,
    recentManual: recent!.results,
  });
});

/* ───────────── Customers ───────────── */

/**
 * Customers (identified by phone). Segments come from real order history with the same
 * rules as the risk score (see @henine/shared risk.ts), so filters and badges always agree.
 */
orderRoutes.get("/customers", requirePermission("customers.view"), async (c) => {
  const q = (c.req.query("q") ?? "").trim();
  const segment = c.req.query("segment") ?? "all";
  const where: string[] = [];
  const binds: unknown[] = [];
  if (q) {
    where.push("(c.name LIKE ? OR c.phone LIKE ?)");
    binds.push(`%${q}%`, `%${q.replace(/\s/g, "")}%`);
  }
  const now = Date.now();
  if (["new", "returning", "vip", "high_risk"].includes(segment)) where.push(segmentSql(segment as CustomerSegment, "c"));
  else if ((EXTRA_SEGMENTS as readonly string[]).includes(segment)) where.push(extraSegmentSql(segment as (typeof EXTRA_SEGMENTS)[number], "c", now));
  const segCounts = [
    ...(["new", "returning", "vip", "high_risk"] as const).map((s) => `SUM(CASE WHEN ${segmentSql(s, "c")} THEN 1 ELSE 0 END) AS "${s}"`),
    ...EXTRA_SEGMENTS.map((s) => `SUM(CASE WHEN ${extraSegmentSql(s, "c", now)} THEN 1 ELSE 0 END) AS "${s}"`),
  ].join(", ");
  const [rows, counts] = await c.env.DB.batch([
    c.env.DB.prepare(
      `SELECT c.id, c.name, c.phone, c.wilaya_code, w.name_fr AS wilaya, c.orders_count, c.delivered_count, c.returned_count, c.cancelled_count,
              c.fake_count, c.total_spent, c.points_balance, c.is_blacklisted, c.tags, c.last_order_at
         FROM customers c LEFT JOIN wilayas w ON w.code = c.wilaya_code
         ${where.length ? `WHERE ${where.join(" AND ")}` : ""} ORDER BY c.last_order_at DESC LIMIT 200`,
    ).bind(...binds),
    c.env.DB.prepare(`SELECT COUNT(*) AS all_count, ${segCounts} FROM customers c`),
  ]);
  type Row = RiskCounters & { total_spent: number };
  return c.json({
    counts: counts!.results[0],
    rows: (rows!.results as (Record<string, unknown> & Row)[]).map((r) => {
      const h = {
        deliveredCount: r.delivered_count ?? 0, returnedCount: r.returned_count ?? 0, cancelledCount: r.cancelled_count ?? 0,
        fakeCount: r.fake_count ?? 0, isBlacklisted: !!r.is_blacklisted,
      };
      const risk = assessRisk(h);
      return { ...r, segment: customerSegment({ ...h, totalSpent: r.total_spent ?? 0 }), risk: { level: risk.level, score: risk.score } };
    }),
  });
});

orderRoutes.get("/customers/:id", requirePermission("customers.view"), async (c) => {
  const id = intParam(c, "id");
  const cust = await c.env.DB.prepare("SELECT c.*, w.name_fr AS wilaya FROM customers c LEFT JOIN wilayas w ON w.code = c.wilaya_code WHERE c.id = ?")
    .bind(id)
    .first<Record<string, unknown> & RiskCounters & { total_spent: number }>();
  if (!cust) throw new HttpError(404, "not_found");
  const [orders, ledger] = await c.env.DB.batch([
    c.env.DB.prepare("SELECT id, public_code, status, total, channel, created_at, outcome_reason FROM orders WHERE customer_id = ? ORDER BY id DESC LIMIT 50").bind(id),
    c.env.DB.prepare("SELECT * FROM loyalty_ledger WHERE customer_id = ? ORDER BY id DESC LIMIT 50").bind(id),
  ]);
  const h = {
    deliveredCount: cust.delivered_count ?? 0, returnedCount: cust.returned_count ?? 0, cancelledCount: cust.cancelled_count ?? 0,
    fakeCount: cust.fake_count ?? 0, isBlacklisted: !!cust.is_blacklisted,
  };
  return c.json({
    customer: cust,
    orders: orders!.results,
    ledger: ledger!.results,
    risk: assessRisk(h),
    segment: customerSegment({ ...h, totalSpent: cust.total_spent ?? 0 }),
  });
});

orderRoutes.patch("/customers/:id", requirePermission("customers.edit"), async (c) => {
  const id = intParam(c, "id");
  const input = await body(
    c,
    z.object({
      name: cleanText(80).pipe(z.string().min(2)).optional(),
      notes: cleanText(2000).nullable().optional(),
      tags: z.array(cleanText(30)).max(10).optional(),
      isBlacklisted: z.boolean().optional(),
      blacklistReason: cleanText(200).nullable().optional(),
    }),
  );
  await c.env.DB.batch([
    c.env.DB.prepare(
      `UPDATE customers SET name = COALESCE(?, name), notes = CASE WHEN ? THEN ? ELSE notes END, tags = COALESCE(?, tags),
         is_blacklisted = COALESCE(?, is_blacklisted), blacklist_reason = CASE WHEN ? THEN ? ELSE blacklist_reason END WHERE id = ?`,
    ).bind(
      input.name ?? null, "notes" in input ? 1 : 0, input.notes ?? null, input.tags ? JSON.stringify(input.tags) : null,
      input.isBlacklisted == null ? null : input.isBlacklisted ? 1 : 0, "blacklistReason" in input ? 1 : 0, input.blacklistReason ?? null, id,
    ),
    auditStmt(c.env, actorOf(c.get("member")), "update", "customer", id, Object.keys(input)),
  ]);
  return c.json({ ok: true });
});

orderRoutes.post("/customers/:id/points", requirePermission("loyalty.edit"), async (c) => {
  const id = intParam(c, "id");
  const input = await body(c, z.object({ delta: z.number().int().min(-100_000).max(100_000), note: cleanText(200).pipe(z.string().min(2)) }));
  const cur = await c.env.DB.prepare("SELECT points_balance FROM customers WHERE id = ?").bind(id).first<{ points_balance: number }>();
  if (!cur) throw new HttpError(404, "not_found");
  if (cur.points_balance + input.delta < 0) throw new HttpError(409, "points_negative");
  await c.env.DB.batch([
    c.env.DB.prepare("UPDATE customers SET points_balance = points_balance + ? WHERE id = ?").bind(input.delta, id),
    c.env.DB.prepare("INSERT INTO loyalty_ledger (customer_id, delta, reason, actor, note, created_at) VALUES (?, ?, 'manual', ?, ?, ?)").bind(
      id, input.delta, actorOf(c.get("member")), input.note, Date.now(),
    ),
  ]);
  return c.json({ balance: cur.points_balance + input.delta });
});

/* ───────────── Paniers (abandoned checkouts) ───────────── */

/** A checkout counts as abandoned after 30 minutes without activity and without an order. */
export const ABANDONED_AFTER = 30 * 60_000;

orderRoutes.get("/carts", requirePermission("carts.view"), async (c) => {
  const filter = c.req.query("filter") ?? "abandoned";
  const now = Date.now();
  const where =
    filter === "recovered"
      ? "ca.recovered_order_id IS NOT NULL"
      : filter === "all"
        ? "1=1"
        : filter === "active"
          ? `ca.recovered_order_id IS NULL AND ca.updated_at >= ${now - ABANDONED_AFTER}`
          : `ca.recovered_order_id IS NULL AND ca.updated_at < ${now - ABANDONED_AFTER}`;
  // a cart counts as recovered when the same phone ordered after the cart was saved
  await c.env.DB.prepare(
    `UPDATE carts SET recovered_order_id = (SELECT o.id FROM orders o WHERE o.phone = carts.phone AND o.created_at >= carts.created_at ORDER BY o.id LIMIT 1)
      WHERE recovered_order_id IS NULL AND phone IS NOT NULL
        AND EXISTS (SELECT 1 FROM orders o WHERE o.phone = carts.phone AND o.created_at >= carts.created_at)`,
  ).run();
  const [rows, stats] = await c.env.DB.batch([
    c.env.DB.prepare(
      `SELECT ca.*, w.name_fr AS wilaya, cm.name_fr AS commune, o.public_code AS recovered_code,
              (SELECT COUNT(*) FROM orders x WHERE x.phone = ca.phone AND x.status NOT IN ${CANCELLED_SQL}) AS customer_orders
         FROM carts ca LEFT JOIN wilayas w ON w.code = ca.wilaya_code LEFT JOIN communes cm ON cm.id = ca.commune_id
         LEFT JOIN orders o ON o.id = ca.recovered_order_id
        WHERE ${where} ORDER BY ca.updated_at DESC LIMIT 100`,
    ),
    c.env.DB.prepare(
      `SELECT COUNT(*) AS total, SUM(CASE WHEN recovered_order_id IS NOT NULL THEN 1 ELSE 0 END) AS recovered,
              COALESCE(SUM(CASE WHEN recovered_order_id IS NULL THEN value ELSE 0 END), 0) AS lost_value FROM carts WHERE created_at > ?`,
    ).bind(Date.now() - 30 * 86400_000),
  ]);
  const carts = rows!.results as { items: string }[];
  const variantIds = [...new Set(carts.flatMap((ca) => (JSON.parse(ca.items) as { variantId: number }[]).map((i) => i.variantId)))];
  const names = new Map<number, string>();
  if (variantIds.length) {
    const [{ results }, labels] = await Promise.all([
      c.env.DB.prepare(`SELECT v.id, p.name_fr FROM variants v JOIN products p ON p.id = v.product_id WHERE v.id IN (${variantIds.map(() => "?").join(",")})`)
        .bind(...variantIds)
        .all<{ id: number; name_fr: string }>(),
      variantLabels(c.env, variantIds),
    ]);
    for (const r of results) names.set(r.id, `${r.name_fr}${labels.get(r.id)?.fr ? ` (${labels.get(r.id)!.fr})` : ""}`);
  }
  return c.json({
    stats: stats!.results[0],
    rows: carts.map((ca) => ({
      ...ca,
      items: (JSON.parse(ca.items) as { variantId: number; qty: number }[]).map((i) => ({ ...i, name: names.get(i.variantId) ?? "?" })),
    })),
  });

});

orderRoutes.post("/carts/:id/contacted", requirePermission("carts.view"), async (c) => {
  await c.env.DB.prepare("UPDATE carts SET last_contacted_at = ? WHERE id = ?").bind(Date.now(), c.req.param("id")).run();
  return c.json({ ok: true });
});

/* ───────────── Fidélité ───────────── */

orderRoutes.get("/loyalty", requirePermission("loyalty.edit"), async (c) => {
  const [settings, top, stats] = await Promise.all([
    getSetting(c.env, "loyalty"),
    c.env.DB.prepare("SELECT id, name, phone, points_balance, delivered_count, total_spent FROM customers WHERE points_balance > 0 ORDER BY points_balance DESC LIMIT 20").all(),
    c.env.DB.prepare(
      "SELECT COALESCE(SUM(points_balance), 0) AS outstanding, COUNT(CASE WHEN points_balance > 0 THEN 1 END) AS members FROM customers",
    ).first<{ outstanding: number; members: number }>(),
  ]);
  // redeem_value_da = value of ONE point in DA
  return c.json({ settings, top: top.results, stats: { ...stats, liabilityDa: (stats?.outstanding ?? 0) * settings.redeem_value_da } });
});

orderRoutes.put("/loyalty", requirePermission("loyalty.edit"), async (c) => {
  const input = await body(
    c,
    z.object({
      enabled: z.boolean(),
      points_per_100da: z.number().int().min(0).max(100),
      redeem_value_da: z.number().int().min(0).max(10000),
      min_redeem: z.number().int().min(0).max(100000),
      expiry_days: z.number().int().min(0).max(3650),
    }),
  );
  await setSetting(c.env, "loyalty", input);
  await c.env.DB.batch([auditStmt(c.env, actorOf(c.get("member")), "update", "settings", "loyalty", input)]);
  return c.json(input);
});
