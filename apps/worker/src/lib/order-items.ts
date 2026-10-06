/**
 * Replaces an order's items (Commandes → Modifier les articles, and merging two duplicate
 * orders): prices kept for unchanged variants, stock reserved / released, every change written
 * to the order's history and the audit log. Refused once the parcel has left.
 */
import type { OrderStatus } from "@henine/shared";
import type { Env } from "../env";
import { auditStmt } from "./audit";
import { HttpError } from "./http";
import { isEditable } from "@henine/shared";
import { quote } from "./orders";

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

export interface ItemLine {
  /** an existing line of the order (kept, its quantity or variant changed) */
  itemId?: number;
  variantId: number;
  qty: number;
}

export async function replaceOrderItems(env: Env, id: number, lines: ItemLine[], actor: string, reason: string): Promise<{ changed: number }> {
  const o = await env.DB.prepare(
    "SELECT id, status, wilaya_code, commune_id, delivery_type, subtotal, discount_total, shipping_price, manual_discount FROM orders WHERE id = ?",
  )
    .bind(id)
    .first<{ id: number; status: OrderStatus; wilaya_code: number; commune_id: number | null; delivery_type: "domicile" | "bureau"; subtotal: number; discount_total: number; shipping_price: number; manual_discount: number }>();
  if (!o) throw new HttpError(404, "not_found");
  if (!isEditable(o.status)) throw new HttpError(409, "order_locked");
  const { results: current } = await env.DB.prepare(
    "SELECT id, variant_id, product_id, name_fr, sku, options_label, unit_price, qty, line_discount FROM order_items WHERE order_id = ?",
  )
    .bind(id)
    .all<ItemRow>();
  const byId = new Map(current.map((i) => [i.id, i]));
  for (const l of lines) if (l.itemId != null && !byId.has(l.itemId)) throw new HttpError(422, "unknown_item");

  // prices and names of the variants (the team may also pick archived-but-active products)
  const priced = await quote(env, {
    lines: lines.map((l) => ({ variantId: l.variantId, qty: l.qty })),
    wilaya: o.wilaya_code, communeId: o.commune_id, deliveryType: o.delivery_type, admin: true,
  });
  const info = new Map(priced.lines.map((l) => [l.variantId, l]));
  for (const l of lines) if (!info.has(l.variantId)) throw new HttpError(422, "unknown_variant");

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
  for (const l of lines) {
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
          env.DB.prepare(
            `UPDATE order_items SET variant_id = ?, product_id = ?, name_fr = ?, name_ar = ?, sku = (SELECT sku FROM variants WHERE id = ?),
               options_label = ?, unit_price = ?, qty = ?, line_discount = 0 WHERE id = ?`,
          ).bind(l.variantId, q.productId, q.nameFr, q.nameAr, l.variantId, q.optionsFr || null, unit, l.qty, old.id),
        );
        if (old.qty !== l.qty) changes.push(["qty", `${old.qty}`, `${l.qty}`]);
      } else if (old.qty !== l.qty) {
        changes.push(["qty", `${old.name_fr} ${old.options_label ?? ""} · ${old.qty}`.trim(), `${l.qty}`]);
        bump(l.variantId, l.qty - old.qty);
        stmts.push(env.DB.prepare("UPDATE order_items SET qty = ? WHERE id = ?").bind(l.qty, old.id));
      }
    } else {
      subtotal += q.unitPrice * l.qty;
      changes.push(["item_added", null, `${q.nameFr} ${q.optionsFr} × ${l.qty}`.trim()]);
      bump(l.variantId, l.qty);
      stmts.push(
        env.DB.prepare(
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
    stmts.push(env.DB.prepare("DELETE FROM order_items WHERE id = ?").bind(old.id));
  }
  if (!changes.length) return { changed: 0 };

  for (const [variantId, delta] of reserved) {
    if (delta === 0) continue;
    stmts.push(
      env.DB.prepare("UPDATE variants SET stock_reserved = MAX(stock_reserved + ?, 0), updated_at = ? WHERE id = ?").bind(delta, now, variantId),
      env.DB.prepare("INSERT INTO stock_movements (variant_id, delta, reason, order_id, actor, note, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)").bind(
        variantId, -delta, delta > 0 ? "reservation" : "liberation", id, actor, "Commande modifiée", now,
      ),
    );
  }
  // discounts stay as they were, but never more than the items
  const discount = Math.min(o.discount_total, subtotal);
  stmts.push(
    env.DB.prepare("UPDATE orders SET subtotal = ?, discount_total = ?, manual_discount = MIN(manual_discount, ?), total = ? + shipping_price, updated_at = ? WHERE id = ?").bind(
      subtotal, discount, discount, subtotal - discount, now, id,
    ),
  );
  if (subtotal !== o.subtotal) changes.push(["subtotal", `${o.subtotal}`, `${subtotal}`]);
  for (const [field, oldV, newV] of changes) {
    stmts.push(
      env.DB.prepare("INSERT INTO order_changes (order_id, field, old_value, new_value, reason, actor, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)").bind(
        id, field, oldV, newV, reason, actor, now,
      ),
    );
  }
  stmts.push(
    env.DB.prepare("INSERT INTO order_events (order_id, kind, actor, source, note, created_at) VALUES (?, 'edit', ?, 'admin', ?, ?)").bind(
      id, actor, `Articles modifiés · ${reason}`, now,
    ),
    auditStmt(env, actor, "update_items", "order", id, { changes, reason: reason }),
  );
  try {
    await env.DB.batch(stmts);
  } catch (err) {
    if (/CHECK constraint/i.test(String((err as Error).message))) throw new HttpError(409, "stock_insufficient");
    throw err;
  }
  return { changed: changes.length };
}
