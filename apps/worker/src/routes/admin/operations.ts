/**
 * Admin → order operations: live connection (new orders, alerts), the "new orders" counter,
 * alerts, editing an order's items before shipping, manual discounts, exchange requests,
 * the daily report and the operations settings (SLA, packaging cost).
 */
import { Hono } from "hono";
import { z } from "zod";
import {
  cleanText,
  CONTACT_KIND_LABEL,
  CONTACT_KINDS,
  hasPermission,
  isEditable,
  manualDiscountAmount,
  type OrderStatus,
} from "@henine/shared";
import type { AppEnv } from "../../env";
import { auditStmt } from "../../lib/audit";
import { resolveAlertStmt } from "../../lib/alerts";
import { mediaUrl, variantLabels } from "../../lib/catalog";
import { body, HttpError, intParam } from "../../lib/http";
import { LIVE_TAG, liveConnect } from "../../lib/live";
import { putAudio } from "../../lib/media";
import { quote } from "../../lib/orders";
import { dailyReport, dayOf, dayStartOf } from "../../lib/reports";
import { getSettings, setSettingStmt } from "../../lib/settings";
import { syncOrderMessage } from "../../lib/telegram";
import { actorOf, requirePermission } from "../../middleware/access";

export const operationRoutes = new Hono<AppEnv>();

/* ───────────── Live: WebSocket to the AdminHub ───────────── */

operationRoutes.get("/live", requirePermission("orders.view"), async (c) => {
  if (c.req.header("Upgrade") !== "websocket") throw new HttpError(400, "expected_websocket");
  // cross-site WebSocket hijacking: only the admin's own pages may connect
  const origin = c.req.header("Origin");
  if (origin && origin !== new URL(c.req.url).origin && origin !== c.env.PUBLIC_ORIGIN) throw new HttpError(403, "forbidden_origin");
  const m = c.get("member");
  const res = await liveConnect(c.env, m.id, [LIVE_TAG]);
  // a fresh response: the hub's headers are immutable and the API middleware adds its own
  return new Response(null, { status: res.status, webSocket: res.webSocket });
});

/* ───────────── "New orders" counter (sidebar) ───────────── */

/** Storefront orders this member hasn't seen yet (boutique sales are made by the team itself). */
operationRoutes.get("/orders/unseen", requirePermission("orders.view"), async (c) => {
  const m = c.get("member");
  const row = await c.env.DB.prepare(
    `SELECT COUNT(*) AS n, MAX(o.created_at) AS last FROM orders o, team_members t
      WHERE t.id = ? AND o.channel != 'boutique' AND o.created_at > COALESCE(t.orders_seen_at, t.created_at)`,
  )
    .bind(m.id)
    .first<{ n: number; last: number | null }>();
  return c.json({ count: row?.n ?? 0, last: row?.last ?? null });
});

operationRoutes.post("/orders/seen", requirePermission("orders.view"), async (c) => {
  await c.env.DB.prepare("UPDATE team_members SET orders_seen_at = ? WHERE id = ?").bind(Date.now(), c.get("member").id).run();
  return c.json({ ok: true });
});

/* ───────────── Alerts ───────────── */

operationRoutes.get("/alerts", requirePermission("orders.view"), async (c) => {
  const show = c.req.query("show") === "resolved" ? "resolved" : "open";
  const [rows, counts] = await c.env.DB.batch([
    c.env.DB.prepare(
      `SELECT * FROM alerts WHERE ${show === "open" ? "resolved_at IS NULL" : "resolved_at IS NOT NULL"}
        ORDER BY ${show === "open" ? "CASE priority WHEN 'high' THEN 0 WHEN 'medium' THEN 1 ELSE 2 END, created_at DESC" : "resolved_at DESC"} LIMIT 100`,
    ),
    c.env.DB.prepare("SELECT COUNT(*) AS open, SUM(CASE WHEN read_at IS NULL THEN 1 ELSE 0 END) AS unread FROM alerts WHERE resolved_at IS NULL"),
  ]);
  const n = counts!.results[0] as { open: number; unread: number | null };
  return c.json({ rows: rows!.results, open: n.open, unread: n.unread ?? 0 });
});

operationRoutes.post("/alerts/read-all", requirePermission("orders.view"), async (c) => {
  await c.env.DB.prepare("UPDATE alerts SET read_at = ? WHERE read_at IS NULL AND resolved_at IS NULL").bind(Date.now()).run();
  return c.json({ ok: true });
});

operationRoutes.post("/alerts/:id/read", requirePermission("orders.view"), async (c) => {
  await c.env.DB.prepare("UPDATE alerts SET read_at = COALESCE(read_at, ?) WHERE id = ?").bind(Date.now(), intParam(c, "id")).run();
  return c.json({ ok: true });
});

operationRoutes.post("/alerts/:id/resolve", requirePermission("orders.view"), async (c) => {
  const id = intParam(c, "id");
  const m = c.get("member");
  await c.env.DB.batch([
    c.env.DB.prepare("UPDATE alerts SET resolved_at = ?, resolved_by = ?, read_at = COALESCE(read_at, ?) WHERE id = ? AND resolved_at IS NULL").bind(
      Date.now(), actorOf(m), Date.now(), id,
    ),
    auditStmt(c.env, actorOf(m), "resolve", "alert", id),
  ]);
  return c.json({ ok: true });
});

/* ───────────── Contact log (call, WhatsApp, SMS, note, other) ───────────── */

operationRoutes.post("/orders/:id/contact", requirePermission("orders.view"), async (c) => {
  const id = intParam(c, "id");
  const input = await body(c, z.object({ kind: z.enum(CONTACT_KINDS), note: cleanText(1000).optional() }));
  const exists = await c.env.DB.prepare("SELECT id FROM orders WHERE id = ?").bind(id).first();
  if (!exists) throw new HttpError(404, "not_found");
  const note = input.note || CONTACT_KIND_LABEL[input.kind].fr;
  await c.env.DB.prepare("INSERT INTO order_events (order_id, kind, actor, source, note, created_at) VALUES (?, ?, ?, 'admin', ?, ?)")
    .bind(id, input.kind, actorOf(c.get("member")), note, Date.now())
    .run();
  return c.json({ ok: true }, 201);
});

/* ───────────── Edit items before shipping ───────────── */

interface ItemRow {
  id: number;
  variant_id: number | null;
  product_id: number | null;
  name_fr: string;
  sku: string;
  options_label: string | null;
  unit_price: number;
  qty: number;
  line_discount: number;
}

operationRoutes.put("/orders/:id/items", requirePermission("orders.edit"), async (c) => {
  const id = intParam(c, "id");
  const input = await body(
    c,
    z.object({
      lines: z
        .array(z.object({ itemId: z.number().int().positive().optional(), variantId: z.number().int().positive(), qty: z.number().int().min(1).max(20) }))
        .min(1)
        .max(30),
      reason: cleanText(300).pipe(z.string().min(2)),
    }),
  );
  const m = c.get("member");
  const actor = actorOf(m);
  const o = await c.env.DB.prepare(
    "SELECT id, status, wilaya_code, commune_id, delivery_type, subtotal, discount_total, shipping_price, manual_discount FROM orders WHERE id = ?",
  )
    .bind(id)
    .first<{ id: number; status: OrderStatus; wilaya_code: number; commune_id: number | null; delivery_type: "domicile" | "bureau"; subtotal: number; discount_total: number; shipping_price: number; manual_discount: number }>();
  if (!o) throw new HttpError(404, "not_found");
  if (!isEditable(o.status)) throw new HttpError(409, "order_locked");
  const { results: current } = await c.env.DB.prepare(
    "SELECT id, variant_id, product_id, name_fr, sku, options_label, unit_price, qty, line_discount FROM order_items WHERE order_id = ?",
  )
    .bind(id)
    .all<ItemRow>();
  const byId = new Map(current.map((i) => [i.id, i]));
  for (const l of input.lines) if (l.itemId != null && !byId.has(l.itemId)) throw new HttpError(422, "unknown_item");

  // prices and names of the variants (the team may also pick archived-but-active products)
  const priced = await quote(c.env, {
    lines: input.lines.map((l) => ({ variantId: l.variantId, qty: l.qty })),
    wilaya: o.wilaya_code, communeId: o.commune_id, deliveryType: o.delivery_type, admin: true,
  });
  const info = new Map(priced.lines.map((l) => [l.variantId, l]));
  for (const l of input.lines) if (!info.has(l.variantId)) throw new HttpError(422, "unknown_variant");

  const now = Date.now();
  const stmts: D1PreparedStatement[] = [];
  const changes: [string, string | null, string | null][] = [];
  // stock: reserve what is added, release what is removed (the CHECK on variants refuses overselling)
  const reserved = new Map<number, number>();
  const bump = (variantId: number | null, delta: number) => {
    if (variantId == null || delta === 0) return;
    reserved.set(variantId, (reserved.get(variantId) ?? 0) + delta);
  };
  const kept = new Set<number>();
  let subtotal = 0;
  for (const l of input.lines) {
    const q = info.get(l.variantId)!;
    const old = l.itemId != null ? byId.get(l.itemId)! : null;
    if (old) {
      kept.add(old.id);
      const sameVariant = old.variant_id === l.variantId;
      // the price agreed at order time stays for the same variant
      const unit = sameVariant ? old.unit_price : q.unitPrice;
      subtotal += unit * l.qty - (sameVariant ? old.line_discount : 0);
      if (!sameVariant) {
        changes.push(["variant", `${old.name_fr} ${old.options_label ?? ""}`.trim(), `${q.nameFr} ${q.optionsFr}`.trim()]);
        bump(old.variant_id, -old.qty);
        bump(l.variantId, l.qty);
        stmts.push(
          c.env.DB.prepare(
            `UPDATE order_items SET variant_id = ?, product_id = ?, name_fr = ?, name_ar = ?, sku = (SELECT sku FROM variants WHERE id = ?),
               options_label = ?, unit_price = ?, qty = ?, line_discount = 0 WHERE id = ?`,
          ).bind(l.variantId, q.productId, q.nameFr, q.nameAr, l.variantId, q.optionsFr || null, unit, l.qty, old.id),
        );
        if (old.qty !== l.qty) changes.push(["qty", `${old.qty}`, `${l.qty}`]);
      } else if (old.qty !== l.qty) {
        changes.push(["qty", `${old.name_fr} ${old.options_label ?? ""} · ${old.qty}`.trim(), `${l.qty}`]);
        bump(l.variantId, l.qty - old.qty);
        stmts.push(c.env.DB.prepare("UPDATE order_items SET qty = ? WHERE id = ?").bind(l.qty, old.id));
      }
    } else {
      subtotal += q.unitPrice * l.qty;
      changes.push(["item_added", null, `${q.nameFr} ${q.optionsFr} × ${l.qty}`.trim()]);
      bump(l.variantId, l.qty);
      stmts.push(
        c.env.DB.prepare(
          `INSERT INTO order_items (order_id, variant_id, product_id, name_fr, name_ar, sku, options_label, unit_price, qty)
           VALUES (?, ?, ?, ?, ?, (SELECT sku FROM variants WHERE id = ?), ?, ?, ?)`,
        ).bind(id, l.variantId, q.productId, q.nameFr, q.nameAr, l.variantId, q.optionsFr || null, q.unitPrice, l.qty),
      );
    }
  }
  for (const old of current) {
    if (kept.has(old.id)) continue;
    changes.push(["item_removed", `${old.name_fr} ${old.options_label ?? ""} × ${old.qty}`.trim(), null]);
    bump(old.variant_id, -old.qty);
    stmts.push(c.env.DB.prepare("DELETE FROM order_items WHERE id = ?").bind(old.id));
  }
  if (!changes.length) return c.json({ ok: true, changed: 0 });

  for (const [variantId, delta] of reserved) {
    if (delta === 0) continue;
    stmts.push(
      c.env.DB.prepare("UPDATE variants SET stock_reserved = MAX(stock_reserved + ?, 0), updated_at = ? WHERE id = ?").bind(delta, now, variantId),
      c.env.DB.prepare("INSERT INTO stock_movements (variant_id, delta, reason, order_id, actor, note, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)").bind(
        variantId, -delta, delta > 0 ? "reservation" : "liberation", id, actor, "Commande modifiée", now,
      ),
    );
  }
  // discounts stay as they were, but never more than the items
  const discount = Math.min(o.discount_total, subtotal);
  stmts.push(
    c.env.DB.prepare("UPDATE orders SET subtotal = ?, discount_total = ?, manual_discount = MIN(manual_discount, ?), total = ? + shipping_price, updated_at = ? WHERE id = ?").bind(
      subtotal, discount, discount, subtotal - discount, now, id,
    ),
  );
  if (subtotal !== o.subtotal) changes.push(["subtotal", `${o.subtotal}`, `${subtotal}`]);
  for (const [field, oldV, newV] of changes) {
    stmts.push(
      c.env.DB.prepare("INSERT INTO order_changes (order_id, field, old_value, new_value, reason, actor, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)").bind(
        id, field, oldV, newV, input.reason, actor, now,
      ),
    );
  }
  stmts.push(
    c.env.DB.prepare("INSERT INTO order_events (order_id, kind, actor, source, note, created_at) VALUES (?, 'edit', ?, 'admin', ?, ?)").bind(
      id, actor, `Articles modifiés · ${input.reason}`, now,
    ),
    auditStmt(c.env, actor, "update_items", "order", id, { changes, reason: input.reason }),
  );
  try {
    await c.env.DB.batch(stmts);
  } catch (err) {
    if (/CHECK constraint/i.test(String((err as Error).message))) throw new HttpError(409, "stock_insufficient");
    throw err;
  }
  c.executionCtx.waitUntil(syncOrderMessage(c.env, id).catch(() => undefined));
  return c.json({ ok: true, changed: changes.length });
});

/* ───────────── Manual discount ───────────── */

operationRoutes.post("/orders/:id/discount", requirePermission("orders.discount"), async (c) => {
  const id = intParam(c, "id");
  const input = await body(
    c,
    z.object({ kind: z.enum(["fixed", "percent"]), value: z.number().min(0).max(1_000_000), reason: cleanText(300).pipe(z.string().min(2)) }),
  );
  const o = await c.env.DB.prepare("SELECT status, subtotal, discount_total, shipping_price, manual_discount, public_code FROM orders WHERE id = ?")
    .bind(id)
    .first<{ status: OrderStatus; subtotal: number; discount_total: number; shipping_price: number; manual_discount: number; public_code: string }>();
  if (!o) throw new HttpError(404, "not_found");
  if (!isEditable(o.status)) throw new HttpError(409, "order_locked");
  const other = o.discount_total - o.manual_discount; // coupon + loyalty points
  // never more than what's left of the items: the total can't go negative
  const amount = Math.min(manualDiscountAmount(o.subtotal, input.kind, input.value), Math.max(o.subtotal - other, 0));
  const discountTotal = other + amount;
  const actor = actorOf(c.get("member"));
  const now = Date.now();
  await c.env.DB.batch([
    c.env.DB.prepare("UPDATE orders SET manual_discount = ?, manual_discount_reason = ?, discount_total = ?, total = subtotal - ? + shipping_price, updated_at = ? WHERE id = ?").bind(
      amount, amount ? input.reason : null, discountTotal, discountTotal, now, id,
    ),
    c.env.DB.prepare("INSERT INTO order_changes (order_id, field, old_value, new_value, reason, actor, created_at) VALUES (?, 'discount', ?, ?, ?, ?, ?)").bind(
      id, `${o.manual_discount}`, `${amount}`, input.reason, actor, now,
    ),
    c.env.DB.prepare("INSERT INTO order_events (order_id, kind, actor, source, note, created_at) VALUES (?, 'edit', ?, 'admin', ?, ?)").bind(
      id, actor, amount ? `Remise ${amount} DA${input.kind === "percent" ? ` (${input.value} %)` : ""} · ${input.reason}` : `Remise retirée · ${input.reason}`, now,
    ),
    auditStmt(c.env, actor, "discount", "order", id, { from: o.manual_discount, to: amount, kind: input.kind, value: input.value, reason: input.reason }),
  ]);
  c.executionCtx.waitUntil(syncOrderMessage(c.env, id).catch(() => undefined));
  return c.json({ ok: true, amount, total: o.subtotal - discountTotal + o.shipping_price });
});

/* ───────────── Exchange requests ───────────── */

operationRoutes.get("/exchanges", requirePermission("orders.view"), async (c) => {
  const status = c.req.query("status") ?? "open";
  const where = status === "open" ? "x.status IN ('pending','approved')" : status === "all" ? "1 = 1" : "x.status = ?";
  const stmt = c.env.DB.prepare(
    `SELECT x.*, o.public_code, o.name AS customer, o.phone, oi.name_fr AS product, oi.options_label AS from_label, oi.qty,
            v.stock_on_hand - v.stock_reserved AS available
       FROM exchange_requests x JOIN orders o ON o.id = x.order_id JOIN order_items oi ON oi.id = x.order_item_id
       LEFT JOIN variants v ON v.id = x.to_variant_id
      WHERE ${where} ORDER BY x.created_at DESC LIMIT 100`,
  );
  const { results } = await (status !== "open" && status !== "all" ? stmt.bind(status) : stmt).all<{ to_variant_id: number } & Record<string, unknown>>();
  const labels = await variantLabels(c.env, [...new Set(results.map((r) => r.to_variant_id))]);
  return c.json(results.map((r) => ({ ...r, to_label: labels.get(r.to_variant_id)?.fr ?? null })));
});

/** Accept / refuse (pending), cancel an accepted one (approved → rejected), or mark it done (approved → completed). */
operationRoutes.post("/exchanges/:id", requirePermission("orders.edit"), async (c) => {
  const xid = intParam(c, "id");
  const input = await body(c, z.object({ action: z.enum(["approve", "reject", "complete"]), note: cleanText(300).optional() }));
  const x = await c.env.DB.prepare(
    `SELECT x.*, o.public_code FROM exchange_requests x JOIN orders o ON o.id = x.order_id WHERE x.id = ?`,
  )
    .bind(xid)
    .first<{ id: number; order_id: number; order_item_id: number; from_variant_id: number | null; to_variant_id: number; status: string; public_code: string }>();
  if (!x) throw new HttpError(404, "not_found");
  const allowed: Record<string, string[]> = { approve: ["pending"], reject: ["pending", "approved"], complete: ["approved"] };
  if (!allowed[input.action]!.includes(x.status)) throw new HttpError(409, "invalid_transition", { from: x.status });
  const actor = actorOf(c.get("member"));
  const now = Date.now();
  const labels = await variantLabels(c.env, [x.to_variant_id, ...(x.from_variant_id ? [x.from_variant_id] : [])]);
  const toLabel = labels.get(x.to_variant_id)?.fr ?? `#${x.to_variant_id}`;
  const fromLabel = x.from_variant_id ? (labels.get(x.from_variant_id)?.fr ?? `#${x.from_variant_id}`) : "?";
  const next = input.action === "approve" ? "approved" : input.action === "reject" ? "rejected" : "completed";
  const stmts: D1PreparedStatement[] = [
    c.env.DB.prepare(
      `UPDATE exchange_requests SET status = ?, decided_by = COALESCE(?, decided_by), decision_note = COALESCE(?, decision_note),
         decided_at = COALESCE(decided_at, ?), completed_at = ? WHERE id = ? AND status = ?`,
    ).bind(next, input.action === "complete" ? null : actor, input.note ?? null, now, next === "completed" ? now : null, xid, x.status),
  ];
  // stock: `col` changes by `delta`; a movement line is written when `reason` is given
  const move = (variantId: number, delta: number, col: "stock_reserved" | "stock_on_hand", reason?: "reservation" | "liberation" | "vente" | "retour") => {
    stmts.push(c.env.DB.prepare(`UPDATE variants SET ${col} = MAX(${col} + ?, 0), updated_at = ? WHERE id = ?`).bind(delta, now, variantId));
    if (reason) {
      stmts.push(
        c.env.DB.prepare("INSERT INTO stock_movements (variant_id, delta, reason, order_id, actor, note, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)").bind(
          variantId, col === "stock_reserved" ? -delta : delta, reason, x.order_id, actor, `Échange #${xid}`, now,
        ),
      );
    }
  };
  if (input.action === "approve") move(x.to_variant_id, 1, "stock_reserved", "reservation"); // the new size is set aside
  if (input.action === "reject" && x.status === "approved") move(x.to_variant_id, -1, "stock_reserved", "liberation");
  if (input.action === "complete") {
    // the new size leaves the shop, the returned piece comes back into stock
    move(x.to_variant_id, -1, "stock_reserved");
    move(x.to_variant_id, -1, "stock_on_hand", "vente");
    if (x.from_variant_id) move(x.from_variant_id, 1, "stock_on_hand", "retour");
    stmts.push(
      c.env.DB.prepare("INSERT INTO order_changes (order_id, field, old_value, new_value, reason, actor, created_at) VALUES (?, 'exchange', ?, ?, ?, ?, ?)").bind(
        x.order_id, fromLabel, toLabel, input.note ?? "Échange effectué", actor, now,
      ),
    );
  }
  const verb = { approve: "acceptée", reject: "refusée", complete: "effectuée" }[input.action];
  stmts.push(
    c.env.DB.prepare("INSERT INTO order_events (order_id, kind, actor, source, note, created_at) VALUES (?, 'exchange', ?, 'admin', ?, ?)").bind(
      x.order_id, actor, `Échange ${fromLabel} → ${toLabel} ${verb}${input.note ? ` · ${input.note}` : ""}`, now,
    ),
    auditStmt(c.env, actor, `exchange_${input.action}`, "exchange_request", xid, { order: x.public_code, note: input.note }),
  );
  if (next !== "approved") stmts.push(resolveAlertStmt(c.env, `exchange:${xid}`, actor));
  try {
    await c.env.DB.batch(stmts);
  } catch (err) {
    if (/CHECK constraint/i.test(String((err as Error).message))) throw new HttpError(409, "stock_insufficient");
    throw err;
  }
  return c.json({ ok: true, status: next });
});

/* ───────────── Daily report ───────────── */

operationRoutes.get("/reports/daily", requirePermission("stats.view"), async (c) => {
  const q = c.req.query("day") ?? "";
  const day = /^\d{4}-\d{2}-\d{2}$/.test(q) ? q : dayOf(Date.now());
  const r = await dailyReport(c.env, dayStartOf(day));
  // profit only for those allowed to see costs
  const perms = c.get("member").permissions;
  if (!hasPermission(perms, "cost.view")) Object.assign(r, { profit: null, profitMissingCost: false });
  return c.json(r);
});

/* ───────────── Settings: SLA + packaging cost ───────────── */

operationRoutes.get("/operations/settings", requirePermission("orders.view"), async (c) => {
  const { operations } = await getSettings(c.env, ["operations"]);
  return c.json({
    ...operations,
    soundUrl: operations.sound ? mediaUrl(c.env, operations.sound) : null,
    soundSeconds: operations.sound_seconds === undefined ? 1.5 : operations.sound_seconds,
  });
});

/** How long the shop's sound plays: 0.5 – 30 s, or null for the whole file. */
operationRoutes.put("/operations/sound/duration", requirePermission("orders.edit"), async (c) => {
  const { seconds } = await body(c, z.object({ seconds: z.number().min(0.5).max(30).multipleOf(0.5).nullable() }));
  const { operations } = await getSettings(c.env, ["operations"]);
  const next = { ...operations, sound_seconds: seconds };
  await c.env.DB.batch([setSettingStmt(c.env, "operations", next), auditStmt(c.env, actorOf(c.get("member")), "update", "settings", "operations.sound_seconds", { seconds })]);
  return c.json({ soundSeconds: seconds });
});

/** The shop's own new-order sound: one file for the whole team (replaces the built-in chime). */
operationRoutes.post("/operations/sound", requirePermission("orders.edit"), async (c) => {
  const form = await c.req.formData().catch(() => null);
  const file = form?.get("file");
  if (!(file instanceof File)) throw new HttpError(400, "file_required");
  const key = await putAudio(c.env, "sounds/order", file);
  const { operations } = await getSettings(c.env, ["operations"]);
  const next = { ...operations, sound: key };
  await c.env.DB.batch([setSettingStmt(c.env, "operations", next), auditStmt(c.env, actorOf(c.get("member")), "update", "settings", "operations.sound", { sound: key })]);
  if (operations.sound) c.executionCtx.waitUntil(c.env.MEDIA.delete(operations.sound).catch(() => undefined));
  return c.json({ soundUrl: mediaUrl(c.env, key) });
});

operationRoutes.delete("/operations/sound", requirePermission("orders.edit"), async (c) => {
  const { operations } = await getSettings(c.env, ["operations"]);
  if (!operations.sound) return c.json({ soundUrl: null });
  await c.env.DB.batch([setSettingStmt(c.env, "operations", { ...operations, sound: null }), auditStmt(c.env, actorOf(c.get("member")), "delete", "settings", "operations.sound", null)]);
  c.executionCtx.waitUntil(c.env.MEDIA.delete(operations.sound).catch(() => undefined));
  return c.json({ soundUrl: null });
});

operationRoutes.put("/operations/settings", requirePermission("orders.edit"), async (c) => {
  const minutes = z.number().int().min(5).max(30 * 24 * 60);
  const input = await body(
    c,
    z.object({
      sla: z.object({ confirmMinutes: minutes, prepareMinutes: minutes, shipMinutes: minutes }),
      packagingCost: z.number().int().min(0).max(10_000).optional(),
    }),
  );
  const { operations } = await getSettings(c.env, ["operations"]);
  // the packaging cost feeds the profit: only for those who see costs
  const canCost = hasPermission(c.get("member").permissions, "cost.view");
  const next = { ...operations, sla: input.sla, packaging_cost: canCost && input.packagingCost != null ? input.packagingCost : operations.packaging_cost };
  await c.env.DB.batch([setSettingStmt(c.env, "operations", next), auditStmt(c.env, actorOf(c.get("member")), "update", "settings", "operations", next)]);
  return c.json(next);
});
