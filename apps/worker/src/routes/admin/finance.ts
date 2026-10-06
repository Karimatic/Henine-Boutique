/**
 * Admin → Finance: cash on delivery (what the courier owes the shop, its payments), expenses
 * and the business result. Viewing needs finance.view, recording needs finance.edit; every
 * change is in the audit log. Never exposed to customers.
 */
import { Hono } from "hono";
import { z } from "zod";
import { cleanText, codTotals, EXPENSE_CATEGORIES, PAYMENT_METHODS, RECONCILIATION_STATUSES } from "@henine/shared";
import type { AppEnv } from "../../env";
import { auditStmt } from "../../lib/audit";
import { codInTransit, codRows, profitAndLoss } from "../../lib/finance";
import { body, HttpError, intParam } from "../../lib/http";
import { putImage } from "../../lib/media";
import { actorOf, requireOwner, requirePermission } from "../../middleware/access";
import { statsRange } from "./system";

export const financeRoutes = new Hono<AppEnv>();

const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const amount = z.number().int().min(0).max(100_000_000);
const PAGE = 50;

/* ───────────── Overview: the period's result + cash on delivery ───────────── */

financeRoutes.get("/finance/summary", requirePermission("finance.view"), async (c) => {
  const range = statsRange((k) => c.req.query(k));
  const [pnl, period, all, transit] = await Promise.all([
    profitAndLoss(c.env, range.since, range.until),
    codRows(c.env, { since: range.since, until: range.until }),
    codRows(c.env, { status: "open" }),
    codInTransit(c.env),
  ]);
  return c.json({
    range,
    pnl,
    cod: codTotals(period),
    // whatever the period: still owed by the courier today
    outstandingAll: codTotals(all),
    inTransit: transit,
  });
});

/* ───────────── Cash on delivery, order by order ───────────── */

financeRoutes.get("/finance/cod", requirePermission("finance.view"), async (c) => {
  const range = c.req.query("range") || c.req.query("from") ? statsRange((k) => c.req.query(k)) : null;
  const status = c.req.query("status");
  const outcome = c.req.query("outcome");
  const rows = await codRows(c.env, {
    since: range?.since,
    until: range?.until,
    status: status === "open" || (RECONCILIATION_STATUSES as readonly string[]).includes(status ?? "") ? (status as "open") : undefined,
    outcome: outcome === "delivered" || outcome === "returned" ? outcome : undefined,
    q: (c.req.query("q") ?? "").trim().slice(0, 60) || undefined,
  });
  const page = Math.max(0, Number(c.req.query("page") ?? 0) || 0);
  return c.json({ totals: codTotals(rows), rows: rows.slice(page * PAGE, (page + 1) * PAGE), page, pages: Math.max(1, Math.ceil(rows.length / PAGE)) });
});

/** What the courier's statement says about one parcel (collected, its fees), or a dispute. */
financeRoutes.put("/finance/cod/:orderId", requirePermission("finance.edit"), async (c) => {
  const orderId = intParam(c, "orderId");
  const input = await body(
    c,
    z.object({
      collected: amount.nullable(),
      carrierFee: amount.nullable(),
      returnFee: amount.nullable(),
      disputed: z.boolean(),
      note: cleanText(500).optional(),
    }),
  );
  const o = await c.env.DB.prepare("SELECT id, status, channel FROM orders WHERE id = ?").bind(orderId).first<{ id: number; status: string; channel: string }>();
  if (!o) throw new HttpError(404, "not_found");
  if (o.channel === "boutique" || !["expediee", "en_livraison", "livree", "retour", "retour_recu"].includes(o.status)) throw new HttpError(409, "not_a_courier_parcel");
  if (input.disputed && !input.note) throw new HttpError(422, "dispute_needs_note");
  const before = await c.env.DB.prepare("SELECT collected, carrier_fee, return_fee, disputed, note FROM order_finance WHERE order_id = ?").bind(orderId).first();
  const actor = actorOf(c.get("member"));
  await c.env.DB.batch([
    c.env.DB.prepare(
      `INSERT INTO order_finance (order_id, collected, carrier_fee, return_fee, disputed, note, updated_by, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(order_id) DO UPDATE SET collected = excluded.collected, carrier_fee = excluded.carrier_fee, return_fee = excluded.return_fee,
         disputed = excluded.disputed, note = excluded.note, updated_by = excluded.updated_by, updated_at = excluded.updated_at`,
    ).bind(orderId, input.collected, input.carrierFee, input.returnFee, input.disputed ? 1 : 0, input.note ?? null, actor, Date.now()),
    auditStmt(c.env, actor, "update", "order_finance", orderId, { before, after: input }),
  ]);
  const [row] = await codRows(c.env, { q: undefined }).then((rows) => rows.filter((r) => r.id === orderId));
  return c.json(row ?? { ok: true });
});

/* ───────────── Payments from the courier ───────────── */

financeRoutes.get("/finance/remittances", requirePermission("finance.view"), async (c) => {
  const { results } = await c.env.DB.prepare(
    `SELECT r.id, r.received_on, r.reference, r.amount, r.note, r.created_by, r.created_at, r.voided_at, r.voided_by, r.void_reason,
            (SELECT COUNT(*) FROM cod_allocations a WHERE a.remittance_id = r.id) AS orders
       FROM cod_remittances r ORDER BY r.received_on DESC, r.id DESC LIMIT 200`,
  ).all();
  return c.json(results);
});

financeRoutes.get("/finance/remittances/:id", requirePermission("finance.view"), async (c) => {
  const id = intParam(c, "id");
  const [r, lines] = await c.env.DB.batch([
    c.env.DB.prepare("SELECT * FROM cod_remittances WHERE id = ?").bind(id),
    c.env.DB.prepare(
      `SELECT a.order_id, a.amount, o.public_code, o.name, o.status, o.total FROM cod_allocations a JOIN orders o ON o.id = a.order_id WHERE a.remittance_id = ? ORDER BY o.public_code`,
    ).bind(id),
  ]);
  if (!r!.results.length) throw new HttpError(404, "not_found");
  return c.json({ ...(r!.results[0] as object), lines: lines!.results });
});

/** One payment, split over the parcels it covers (negative: a return fee deducted). */
financeRoutes.post("/finance/remittances", requirePermission("finance.edit"), async (c) => {
  const input = await body(
    c,
    z.object({
      receivedOn: day,
      reference: cleanText(80).optional(),
      note: cleanText(500).optional(),
      allocations: z
        .array(z.object({ orderId: z.number().int().positive(), amount: z.number().int().min(-1_000_000).max(100_000_000) }))
        .min(1)
        .max(500),
    }),
  );
  const ids = [...new Set(input.allocations.map((a) => a.orderId))];
  if (ids.length !== input.allocations.length) throw new HttpError(422, "order_twice");
  if (input.allocations.some((a) => a.amount === 0)) throw new HttpError(422, "zero_amount");
  const { results } = await c.env.DB.prepare(`SELECT id, status, channel FROM orders WHERE id IN (${ids.map(() => "?").join(",")})`)
    .bind(...ids)
    .all<{ id: number; status: string; channel: string }>();
  const ok = new Set(results.filter((o) => o.channel !== "boutique" && ["livree", "retour", "retour_recu"].includes(o.status)).map((o) => o.id));
  const bad = ids.filter((id) => !ok.has(id));
  if (bad.length) throw new HttpError(409, "not_settled", { orderIds: bad });
  const total = input.allocations.reduce((s, a) => s + a.amount, 0);
  const actor = actorOf(c.get("member"));
  const now = Date.now();
  // the payment and its lines in one transaction: all or nothing (the lines point at the row just added)
  const NEW_ID = "(SELECT MAX(id) FROM cod_remittances)";
  const res = await c.env.DB.batch([
    c.env.DB.prepare(
      "INSERT INTO cod_remittances (id, received_on, reference, amount, note, created_by, created_at) VALUES ((SELECT COALESCE(MAX(id), 0) + 1 FROM cod_remittances), ?, ?, ?, ?, ?, ?)",
    ).bind(input.receivedOn, input.reference ?? null, total, input.note ?? null, actor, now),
    ...input.allocations.map((a) => c.env.DB.prepare(`INSERT INTO cod_allocations (remittance_id, order_id, amount) VALUES (${NEW_ID}, ?, ?)`).bind(a.orderId, a.amount)),
    c.env.DB.prepare(
      `INSERT INTO audit_log (actor, action, entity, entity_id, diff, created_at) VALUES (?, 'create', 'cod_remittance', CAST(${NEW_ID} AS TEXT), ?, ?)`,
    ).bind(actor, JSON.stringify({ receivedOn: input.receivedOn, reference: input.reference, amount: total, orders: ids.length }), now),
    c.env.DB.prepare(`SELECT ${NEW_ID} AS id`),
  ]);
  const rid = (res.at(-1)!.results[0] as { id: number }).id;
  return c.json({ id: rid, amount: total }, 201);
});

/** A payment recorded by mistake: voided (kept for the history), its orders are owed again. */
financeRoutes.post("/finance/remittances/:id/void", requirePermission("finance.edit"), async (c) => {
  const id = intParam(c, "id");
  const { reason } = await body(c, z.object({ reason: cleanText(300).pipe(z.string().min(3)) }));
  const actor = actorOf(c.get("member"));
  const r = await c.env.DB.prepare("UPDATE cod_remittances SET voided_at = ?, voided_by = ?, void_reason = ? WHERE id = ? AND voided_at IS NULL RETURNING amount")
    .bind(Date.now(), actor, reason, id)
    .first<{ amount: number }>();
  if (!r) throw new HttpError(409, "not_voidable");
  await auditStmt(c.env, actor, "void", "cod_remittance", id, { reason, amount: r.amount }).run();
  return c.json({ ok: true });
});

/* ───────────── Expenses ───────────── */

const expenseInput = z.object({
  spentOn: day,
  amount: amount.min(1),
  category: z.enum(EXPENSE_CATEGORIES),
  description: cleanText(200).pipe(z.string().min(2)),
  paymentMethod: z.enum(PAYMENT_METHODS).nullable().optional(),
  reference: cleanText(80).optional(),
  notes: cleanText(1000).optional(),
});

financeRoutes.get("/expenses", requirePermission("finance.view"), async (c) => {
  const where: string[] = [];
  const binds: unknown[] = [];
  const from = c.req.query("from");
  const to = c.req.query("to");
  if (from && /^\d{4}-\d{2}-\d{2}$/.test(from)) {
    where.push("spent_on >= ?");
    binds.push(from);
  }
  if (to && /^\d{4}-\d{2}-\d{2}$/.test(to)) {
    where.push("spent_on <= ?");
    binds.push(to);
  }
  const category = c.req.query("category");
  if (category && (EXPENSE_CATEGORIES as readonly string[]).includes(category)) {
    where.push("category = ?");
    binds.push(category);
  }
  if (c.req.query("voided") !== "1") where.push("voided_at IS NULL");
  const q = (c.req.query("q") ?? "").trim().slice(0, 60);
  if (q) {
    where.push("(description LIKE ? OR reference LIKE ? OR notes LIKE ?)");
    binds.push(`%${q}%`, `%${q}%`, `%${q}%`);
  }
  const page = Math.max(0, Number(c.req.query("page") ?? 0) || 0);
  const w = where.length ? `WHERE ${where.join(" AND ")}` : "";
  const [rows, totals] = await c.env.DB.batch([
    c.env.DB.prepare(
      `SELECT id, spent_on, amount, currency, category, description, payment_method, reference, receipt_key IS NOT NULL AS has_receipt, notes,
              created_by, created_at, updated_by, updated_at, voided_at, voided_by, void_reason
         FROM expenses ${w} ORDER BY spent_on DESC, id DESC LIMIT ${PAGE} OFFSET ${page * PAGE}`,
    ).bind(...binds),
    c.env.DB.prepare(`SELECT COUNT(*) AS n, COALESCE(SUM(CASE WHEN voided_at IS NULL THEN amount ELSE 0 END), 0) AS total FROM expenses ${w}`).bind(...binds),
  ]);
  const t = totals!.results[0] as { n: number; total: number };
  return c.json({ rows: rows!.results, total: t.total, count: t.n, page, pages: Math.max(1, Math.ceil(t.n / PAGE)) });
});

financeRoutes.post("/expenses", requirePermission("finance.edit"), async (c) => {
  const input = await body(c, expenseInput);
  const actor = actorOf(c.get("member"));
  const r = await c.env.DB.prepare(
    `INSERT INTO expenses (spent_on, amount, category, description, payment_method, reference, notes, created_by, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?) RETURNING id`,
  )
    .bind(input.spentOn, input.amount, input.category, input.description, input.paymentMethod ?? null, input.reference ?? null, input.notes ?? null, actor, Date.now())
    .first<{ id: number }>();
  await auditStmt(c.env, actor, "create", "expense", r!.id, input).run();
  return c.json({ id: r!.id }, 201);
});

financeRoutes.patch("/expenses/:id", requirePermission("finance.edit"), async (c) => {
  const id = intParam(c, "id");
  const input = await body(c, expenseInput);
  const before = await c.env.DB.prepare("SELECT spent_on, amount, category, description, payment_method, reference, notes, voided_at FROM expenses WHERE id = ?")
    .bind(id)
    .first<{ voided_at: number | null }>();
  if (!before) throw new HttpError(404, "not_found");
  if (before.voided_at) throw new HttpError(409, "expense_voided");
  const actor = actorOf(c.get("member"));
  await c.env.DB.batch([
    c.env.DB.prepare(
      `UPDATE expenses SET spent_on = ?, amount = ?, category = ?, description = ?, payment_method = ?, reference = ?, notes = ?, updated_by = ?, updated_at = ?
        WHERE id = ? AND voided_at IS NULL`,
    ).bind(input.spentOn, input.amount, input.category, input.description, input.paymentMethod ?? null, input.reference ?? null, input.notes ?? null, actor, Date.now(), id),
    auditStmt(c.env, actor, "update", "expense", id, { before, after: input }),
  ]);
  return c.json({ ok: true });
});

/** Cancelled but kept in the history (the normal way to remove an expense). */
financeRoutes.post("/expenses/:id/void", requirePermission("finance.edit"), async (c) => {
  const id = intParam(c, "id");
  const { reason } = await body(c, z.object({ reason: cleanText(300).pipe(z.string().min(3)) }));
  const actor = actorOf(c.get("member"));
  const r = await c.env.DB.prepare("UPDATE expenses SET voided_at = ?, voided_by = ?, void_reason = ? WHERE id = ? AND voided_at IS NULL RETURNING amount")
    .bind(Date.now(), actor, reason, id)
    .first<{ amount: number }>();
  if (!r) throw new HttpError(409, "not_voidable");
  await auditStmt(c.env, actor, "void", "expense", id, { reason, amount: r.amount }).run();
  return c.json({ ok: true });
});

/** Erased for good: the owner only (a mistake with personal data, a test). */
financeRoutes.delete("/expenses/:id", requireOwner, async (c) => {
  const id = intParam(c, "id");
  const r = await c.env.DB.prepare("DELETE FROM expenses WHERE id = ? RETURNING receipt_key, amount, description").bind(id).first<{ receipt_key: string | null; amount: number; description: string }>();
  if (!r) throw new HttpError(404, "not_found");
  await auditStmt(c.env, actorOf(c.get("member")), "delete", "expense", id, { amount: r.amount, description: r.description }).run();
  if (r.receipt_key) c.executionCtx.waitUntil(c.env.MEDIA.delete(r.receipt_key).catch(() => undefined));
  return c.json({ ok: true });
});

/** Receipt photo: stored privately (never on the public /media address), shown through the admin API only. */
financeRoutes.post("/expenses/:id/receipt", requirePermission("finance.edit"), async (c) => {
  const id = intParam(c, "id");
  const e = await c.env.DB.prepare("SELECT receipt_key, voided_at FROM expenses WHERE id = ?").bind(id).first<{ receipt_key: string | null; voided_at: number | null }>();
  if (!e) throw new HttpError(404, "not_found");
  const form = await c.req.formData().catch(() => null);
  const file = form?.get("file");
  if (!(file instanceof File)) throw new HttpError(400, "file_required");
  const key = await putImage(c.env, `private/receipts/${id}`, file, 3_000_000);
  await c.env.DB.batch([
    c.env.DB.prepare("UPDATE expenses SET receipt_key = ?, updated_by = ?, updated_at = ? WHERE id = ?").bind(key, actorOf(c.get("member")), Date.now(), id),
    auditStmt(c.env, actorOf(c.get("member")), "update", "expense_receipt", id),
  ]);
  if (e.receipt_key) c.executionCtx.waitUntil(c.env.MEDIA.delete(e.receipt_key).catch(() => undefined));
  return c.json({ ok: true });
});

financeRoutes.get("/expenses/:id/receipt", requirePermission("finance.view"), async (c) => {
  const id = intParam(c, "id");
  const e = await c.env.DB.prepare("SELECT receipt_key FROM expenses WHERE id = ?").bind(id).first<{ receipt_key: string | null }>();
  if (!e?.receipt_key) throw new HttpError(404, "not_found");
  const obj = await c.env.MEDIA.get(e.receipt_key);
  if (!obj) throw new HttpError(404, "not_found");
  return new Response(obj.body, {
    headers: { "Content-Type": obj.httpMetadata?.contentType ?? "image/jpeg", "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff" },
  });
});
