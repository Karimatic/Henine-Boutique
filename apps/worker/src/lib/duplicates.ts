/**
 * Possible duplicate orders, checked right after an order is placed (website, express form or
 * the team's manual orders; never shop sales). Only flags: the team decides in the order sheet.
 */
import { DEFAULT_DUPLICATE_SETTINGS, DUPLICATE_REASON_LABEL, duplicateScore, type DuplicateReason, type DuplicateSettings, type OrderForDuplicate } from "@henine/shared";
import type { Env } from "../env";
import { raiseAlert } from "./alerts";
import { CANCELLED_SQL } from "./orders";
import { getSettings } from "./settings";

interface Row {
  id: number;
  public_code: string;
  phone: string;
  customer_id: number;
  wilaya_code: number;
  commune_id: number | null;
  address: string | null;
  delivery_type: string;
  total: number;
  created_at: number;
  channel: string;
}

export async function duplicateSettings(env: Env): Promise<DuplicateSettings> {
  const { operations } = await getSettings(env, ["operations"]);
  return { ...DEFAULT_DUPLICATE_SETTINGS, ...(operations.duplicates ?? {}) };
}

/** Compares a new order with the same customer's recent orders; returns the pairs flagged. */
export async function detectDuplicates(env: Env, orderId: number): Promise<number> {
  const cfg = await duplicateSettings(env);
  if (!cfg.enabled) return 0;
  const cols = "id, public_code, phone, customer_id, wilaya_code, commune_id, address, delivery_type, total, created_at, channel";
  const o = await env.DB.prepare(`SELECT ${cols} FROM orders WHERE id = ?`).bind(orderId).first<Row>();
  if (!o || o.channel === "boutique") return 0;
  const window = cfg.windowHours * 3600_000;
  const { results: others } = await env.DB.prepare(
    `SELECT ${cols} FROM orders
      WHERE id != ?1 AND (phone = ?2 OR customer_id = ?3) AND created_at >= ?4 AND created_at <= ?5
        AND status NOT IN ${CANCELLED_SQL} AND channel != 'boutique'
      ORDER BY created_at DESC LIMIT 20`,
  )
    .bind(o.id, o.phone, o.customer_id, o.created_at - window, o.created_at + window)
    .all<Row>();
  if (!others.length) return 0;
  const ids = [o.id, ...others.map((x) => x.id)];
  const { results: items } = await env.DB.prepare(`SELECT order_id, variant_id, qty FROM order_items WHERE order_id IN (${ids.map(() => "?").join(",")})`)
    .bind(...ids)
    .all<{ order_id: number; variant_id: number | null; qty: number }>();
  const shape = (r: Row): OrderForDuplicate => ({
    phone: r.phone, customerId: r.customer_id, wilaya: r.wilaya_code, communeId: r.commune_id, address: r.address, deliveryType: r.delivery_type, total: r.total,
    createdAt: r.created_at, items: items.filter((i) => i.order_id === r.id).map((i) => ({ variantId: i.variant_id, qty: i.qty })),
  });
  let flagged = 0;
  for (const other of others) {
    // the pair is stored newer → older
    const [newer, older] = other.created_at > o.created_at ? [other, o] : [o, other];
    const m = duplicateScore(shape(newer), shape(older), cfg);
    if (!m) continue;
    const r = await env.DB.prepare(
      `INSERT INTO order_duplicates (order_id, other_order_id, score, reasons, minutes_apart, status, created_at) VALUES (?, ?, ?, ?, ?, 'open', ?)
       ON CONFLICT(order_id, other_order_id) DO NOTHING RETURNING id`,
    )
      .bind(newer.id, older.id, m.score, JSON.stringify(m.reasons), m.minutesApart, Date.now())
      .first<{ id: number }>();
    if (!r) continue;
    flagged++;
    const why = m.reasons.map((k) => DUPLICATE_REASON_LABEL[k as DuplicateReason].toLowerCase()).join(", ");
    await raiseAlert(env, {
      kind: "duplicate_order",
      priority: "medium",
      entity: "order",
      entityId: newer.id,
      message: `Doublon possible : ${newer.public_code} ressemble à ${older.public_code} (${why}).`,
      dedupeKey: `duplicate:${r.id}`,
    });
  }
  return flagged;
}

/** "This order has an open duplicate warning" (orders list badge, attention filter). */
export const OPEN_DUPLICATE_SQL = (o = "o") =>
  `EXISTS (SELECT 1 FROM order_duplicates d WHERE (d.order_id = ${o}.id OR d.other_order_id = ${o}.id) AND d.status = 'open')`;
