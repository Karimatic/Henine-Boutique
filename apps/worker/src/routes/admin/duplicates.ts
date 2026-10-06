/**
 * Admin → possible duplicate orders: why two orders were flagged and the team's decision.
 * Cancelling goes through the normal order lifecycle ("doublon", stock released); merging puts
 * everything in the older order (same item-edit rules as Commandes → Modifier) and cancels the
 * newer one. Every decision is in both orders' history and the audit log.
 */
import { Hono } from "hono";
import { z } from "zod";
import { cleanText, DUPLICATE_ACTIONS, hasPermission, isEditable, type DuplicateAction, type DuplicateStatus, type OrderStatus } from "@henine/shared";
import type { AppEnv } from "../../env";
import { resolveAlertStmt } from "../../lib/alerts";
import { auditStmt } from "../../lib/audit";
import { body, HttpError, intParam } from "../../lib/http";
import { replaceOrderItems } from "../../lib/order-items";
import { applyStatusChange } from "../../lib/orders";
import { permissionFor, syncOrderMessage } from "../../lib/telegram";
import { actorOf, requirePermission } from "../../middleware/access";

export const duplicateRoutes = new Hono<AppEnv>();

const ORDER_COLS = "o.id, o.public_code, o.status, o.name, o.phone, o.total, o.created_at, o.delivery_type, o.address, w.name_fr AS wilaya";

duplicateRoutes.get("/duplicates", requirePermission("orders.view"), async (c) => {
  const status = c.req.query("status") === "all" ? null : "open";
  const { results } = await c.env.DB.prepare(
    `SELECT d.id, d.order_id, d.other_order_id, d.score, d.reasons, d.minutes_apart, d.status, d.decided_by, d.decided_at, d.created_at,
            a.public_code AS code, a.name, a.status AS order_status, a.total, b.public_code AS other_code, b.status AS other_status, b.total AS other_total
       FROM order_duplicates d JOIN orders a ON a.id = d.order_id JOIN orders b ON b.id = d.other_order_id
      ${status ? "WHERE d.status = 'open'" : ""} ORDER BY d.created_at DESC LIMIT 100`,
  ).all<Record<string, unknown> & { reasons: string }>();
  return c.json(results.map((r) => ({ ...r, reasons: JSON.parse(r.reasons) as string[] })));
});

/** The warnings about one order, with the other order of each pair and its items. */
duplicateRoutes.get("/orders/:id/duplicates", requirePermission("orders.view"), async (c) => {
  const id = intParam(c, "id");
  const { results: pairs } = await c.env.DB.prepare(
    `SELECT d.id, d.order_id, d.other_order_id, d.score, d.reasons, d.minutes_apart, d.status, d.decided_by, d.decided_at, d.created_at
       FROM order_duplicates d WHERE d.order_id = ?1 OR d.other_order_id = ?1 ORDER BY d.status = 'open' DESC, d.created_at DESC LIMIT 20`,
  )
    .bind(id)
    .all<{ id: number; order_id: number; other_order_id: number; reasons: string } & Record<string, unknown>>();
  if (!pairs.length) return c.json([]);
  const otherIds = [...new Set(pairs.map((p) => (p.order_id === id ? p.other_order_id : p.order_id)))];
  const ph = otherIds.map(() => "?").join(",");
  const [orders, items] = await c.env.DB.batch([
    c.env.DB.prepare(`SELECT ${ORDER_COLS} FROM orders o LEFT JOIN wilayas w ON w.code = o.wilaya_code WHERE o.id IN (${ph})`).bind(...otherIds),
    c.env.DB.prepare(`SELECT order_id, name_fr, options_label, qty FROM order_items WHERE order_id IN (${ph}) ORDER BY id`).bind(...otherIds),
  ]);
  const byId = new Map((orders!.results as { id: number }[]).map((o) => [o.id, o]));
  const lines = items!.results as { order_id: number }[];
  return c.json(
    pairs.map((p) => {
      const otherId = p.order_id === id ? p.other_order_id : p.order_id;
      return { ...p, reasons: JSON.parse(p.reasons) as string[], thisIsNewer: p.order_id === id, other: { ...byId.get(otherId), items: lines.filter((l) => l.order_id === otherId) } };
    }),
  );
});

const RESULT: Record<DuplicateAction, DuplicateStatus> = { keep: "kept", merge: "merged", cancel: "cancelled", reviewed: "reviewed", ignore: "ignored" };
const NOTE: Record<DuplicateAction, string> = {
  keep: "Doublon possible vérifié : les deux commandes sont gardées",
  merge: "Doublon possible : commandes fusionnées",
  cancel: "Doublon possible : la commande la plus récente est annulée",
  reviewed: "Doublon possible marqué comme vérifié",
  ignore: "Avertissement de doublon ignoré",
};

duplicateRoutes.post("/duplicates/:id", requirePermission("orders.edit"), async (c) => {
  const id = intParam(c, "id");
  const { action, note } = await body(c, z.object({ action: z.enum(DUPLICATE_ACTIONS), note: cleanText(300).optional() }));
  const perms = c.get("member").permissions;
  const d = await c.env.DB.prepare("SELECT id, order_id, other_order_id, status FROM order_duplicates WHERE id = ?")
    .bind(id)
    .first<{ id: number; order_id: number; other_order_id: number; status: DuplicateStatus }>();
  if (!d) throw new HttpError(404, "not_found");
  if (d.status !== "open") throw new HttpError(409, "already_decided");
  const [newer, older] = await Promise.all(
    [d.order_id, d.other_order_id].map((oid) =>
      c.env.DB.prepare("SELECT id, public_code, status FROM orders WHERE id = ?").bind(oid).first<{ id: number; public_code: string; status: OrderStatus }>(),
    ),
  );
  if (!newer || !older) throw new HttpError(404, "not_found");
  const actor = actorOf(c.get("member"));

  if (action === "cancel" || action === "merge") {
    // cancelling an order needs the confirmation permission, as anywhere else
    if (!hasPermission(perms, permissionFor("doublon"))) throw new HttpError(403, "forbidden");
    if (!["nouvelle", "injoignable"].includes(newer.status)) throw new HttpError(409, "order_not_cancellable", { code: newer.public_code });
  }
  if (action === "merge") {
    if (!isEditable(older.status)) throw new HttpError(409, "order_locked", { code: older.public_code });
    // everything in the older order; items in both are not doubled (the larger quantity is kept)
    type Item = { id: number; variant_id: number; qty: number };
    const itemsOf = async (oid: number) =>
      (await c.env.DB.prepare("SELECT id, variant_id, qty FROM order_items WHERE order_id = ? AND variant_id IS NOT NULL").bind(oid).all<Item>()).results;
    const [keep, add] = await Promise.all([itemsOf(older.id), itemsOf(newer.id)]);
    const lines = keep.map((i) => ({ itemId: i.id, variantId: i.variant_id, qty: i.qty }));
    const extra = new Map<number, number>();
    for (const n of add) {
      const same = lines.find((l) => l.variantId === n.variant_id);
      if (same) {
        if (n.qty > same.qty) {
          extra.set(n.variant_id, n.qty - same.qty);
          same.qty = Math.min(20, n.qty);
        }
      } else {
        extra.set(n.variant_id, n.qty);
        lines.push({ itemId: 0, variantId: n.variant_id, qty: Math.min(20, n.qty) });
      }
    }
    // the pieces the newer order holds are released when it is cancelled: check before touching anything
    const ids = [...extra.keys()];
    if (ids.length) {
      const { results } = await c.env.DB.prepare(`SELECT id, stock_on_hand - stock_reserved AS free FROM variants WHERE id IN (${ids.map(() => "?").join(",")})`)
        .bind(...ids)
        .all<{ id: number; free: number }>();
      const heldByNewer = new Map(add.map((n) => [n.variant_id, n.qty]));
      const short = results.filter((v) => v.free + (heldByNewer.get(v.id) ?? 0) < (extra.get(v.id) ?? 0));
      if (short.length) throw new HttpError(409, "stock_insufficient", { variantIds: short.map((v) => v.id) });
    }
    await applyStatusChange(c.env, newer.id, "doublon", actor, "admin", `Fusionnée dans ${older.public_code}`, "duplicate");
    await replaceOrderItems(
      c.env,
      older.id,
      lines.map((l) => (l.itemId ? l : { variantId: l.variantId, qty: l.qty })),
      actor,
      `Fusion avec ${newer.public_code} (doublon)`,
    );
  } else if (action === "cancel") {
    await applyStatusChange(c.env, newer.id, "doublon", actor, "admin", `Doublon de ${older.public_code}${note ? ` · ${note}` : ""}`, "duplicate");
  }

  const now = Date.now();
  const text = [NOTE[action], note].filter(Boolean).join(" · ");
  await c.env.DB.batch([
    c.env.DB.prepare("UPDATE order_duplicates SET status = ?, decided_by = ?, decided_at = ? WHERE id = ? AND status = 'open'").bind(RESULT[action], actor, now, id),
    ...[newer, older].map((o) =>
      c.env.DB.prepare("INSERT INTO order_events (order_id, kind, actor, source, note, created_at) VALUES (?, 'note', ?, 'admin', ?, ?)").bind(
        o.id, actor, `${text} (${o.id === newer.id ? older.public_code : newer.public_code})`, now,
      ),
    ),
    resolveAlertStmt(c.env, `duplicate:${id}`, actor),
    auditStmt(c.env, actor, action, "order_duplicate", id, { newer: newer.public_code, older: older.public_code, note }),
  ]);
  for (const o of [newer, older]) c.executionCtx.waitUntil(syncOrderMessage(c.env, o.id).catch(() => undefined));
  return c.json({ ok: true, status: RESULT[action] });
});
