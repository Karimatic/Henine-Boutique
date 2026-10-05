/**
 * Daily manager report (Admin → Statistiques → Rapport du jour, and the evening Telegram
 * summary): what came in, what moved forward, what it earned, what's waiting.
 */
import { orderProfit } from "@henine/shared";
import type { Env } from "../env";
import { lateOrdersSql } from "./alerts";
import { algiersDayStart, CANCELLED_SQL } from "./orders";
import { getSettings } from "./settings";

export interface DailyReport {
  /** YYYY-MM-DD (Algiers) */
  day: string;
  /** orders placed that day (not cancelled) and what they're worth */
  orders: number;
  revenue: number;
  /** what happened that day, whatever the order's date */
  confirmed: number;
  cancelled: number;
  shipped: number;
  delivered: number;
  returned: number;
  /** placed that day: estimated profit (null when product costs are unknown for all) */
  profit: number | null;
  profitMissingCost: boolean;
  confirmRate: number | null;
  /** average minutes between an order and its confirmation (orders confirmed that day) */
  avgConfirmMinutes: number | null;
  topProduct: { id: number; name: string; units: number } | null;
  topWilaya: { code: number; name: string; orders: number } | null;
  /** now: still to confirm, and late against the SLA */
  pending: number;
  late: number;
  /** the day before, to compare */
  previous: { orders: number; revenue: number };
}

const DAY = 86400_000;

/** Algiers midnight of a YYYY-MM-DD day (Algeria is UTC+1 all year). */
export function dayStartOf(day: string): number {
  return Date.parse(`${day}T00:00:00Z`) - 3600_000;
}

export function dayOf(ts: number): string {
  return new Date(algiersDayStart(ts) + 3600_000).toISOString().slice(0, 10);
}

export async function dailyReport(env: Env, since: number): Promise<DailyReport> {
  const until = since + DAY;
  const now = Date.now();
  const { operations } = await getSettings(env, ["operations"]);
  const [placed, items, moves, topP, topW, pending, late, prev, speed] = await env.DB.batch([
    env.DB.prepare(
      `SELECT o.id, o.total, o.subtotal, o.discount_total, o.shipping_price, o.delivery_type, o.channel, w.home_price, w.desk_price
         FROM orders o LEFT JOIN wilayas w ON w.code = o.wilaya_code
        WHERE o.created_at >= ? AND o.created_at < ? AND o.status NOT IN ${CANCELLED_SQL}`,
    ).bind(since, until),
    env.DB.prepare(
      `SELECT oi.order_id, oi.unit_price, oi.qty, oi.line_discount, p.cost_price
         FROM order_items oi JOIN orders o ON o.id = oi.order_id LEFT JOIN products p ON p.id = oi.product_id
        WHERE o.created_at >= ? AND o.created_at < ? AND o.status NOT IN ${CANCELLED_SQL}`,
    ).bind(since, until),
    env.DB.prepare(
      `SELECT to_status, COUNT(DISTINCT order_id) AS n FROM order_events
        WHERE kind = 'status' AND created_at >= ? AND created_at < ? GROUP BY to_status`,
    ).bind(since, until),
    env.DB.prepare(
      `SELECT oi.product_id AS id, COALESCE(p.name_fr, oi.name_fr) AS name, SUM(oi.qty) AS units
         FROM order_items oi JOIN orders o ON o.id = oi.order_id LEFT JOIN products p ON p.id = oi.product_id
        WHERE o.created_at >= ? AND o.created_at < ? AND o.status NOT IN ${CANCELLED_SQL} AND oi.product_id IS NOT NULL
        GROUP BY oi.product_id ORDER BY units DESC LIMIT 1`,
    ).bind(since, until),
    env.DB.prepare(
      `SELECT o.wilaya_code AS code, w.name_fr AS name, COUNT(*) AS orders FROM orders o LEFT JOIN wilayas w ON w.code = o.wilaya_code
        WHERE o.created_at >= ? AND o.created_at < ? AND o.status NOT IN ${CANCELLED_SQL} AND o.channel != 'boutique'
        GROUP BY o.wilaya_code ORDER BY orders DESC LIMIT 1`,
    ).bind(since, until),
    env.DB.prepare("SELECT COUNT(*) AS n FROM orders WHERE status IN ('nouvelle','injoignable')"),
    env.DB.prepare(`SELECT COUNT(*) AS n FROM orders o WHERE ${lateOrdersSql(now, operations.sla)}`),
    env.DB.prepare(
      `SELECT COUNT(*) AS orders, COALESCE(SUM(total), 0) AS revenue FROM orders WHERE created_at >= ? AND created_at < ? AND status NOT IN ${CANCELLED_SQL}`,
    ).bind(since - DAY, since),
    env.DB.prepare(
      `SELECT AVG(confirmed_at - created_at) AS ms FROM orders WHERE confirmed_at >= ? AND confirmed_at < ? AND channel NOT IN ('boutique')`,
    ).bind(since, until),
  ]);

  type Placed = { id: number; total: number; subtotal: number; discount_total: number; shipping_price: number; delivery_type: string; channel: string; home_price: number | null; desk_price: number | null };
  type Item = { order_id: number; unit_price: number; qty: number; line_discount: number; cost_price: number | null };
  const orders = placed!.results as Placed[];
  const lines = items!.results as Item[];
  let profit = 0;
  let missing = false;
  let known = false;
  for (const o of orders) {
    const its = lines.filter((l) => l.order_id === o.id);
    const r = orderProfit({
      items: its.map((l) => ({ unitPrice: l.unit_price - l.line_discount, qty: l.qty, unitCost: l.cost_price })),
      discount: o.discount_total,
      shippingCharged: o.shipping_price,
      shippingCost: o.channel === "boutique" ? 0 : ((o.delivery_type === "bureau" ? o.desk_price : o.home_price) ?? 0),
      packagingCost: o.channel === "boutique" ? 0 : operations.packaging_cost,
      returned: false,
    });
    profit += r.profit;
    if (r.missingCost) missing = true;
    if (its.some((l) => l.cost_price != null)) known = true;
  }

  const move = new Map((moves!.results as { to_status: string; n: number }[]).map((m) => [m.to_status, m.n]));
  const count = (...s: string[]) => s.reduce((t, k) => t + (move.get(k) ?? 0), 0);
  const confirmed = count("confirmee");
  const cancelled = count("annulee", "fausse", "doublon");
  const p = topP!.results[0] as { id: number; name: string; units: number } | undefined;
  const w = topW!.results[0] as { code: number; name: string | null; orders: number } | undefined;
  const pv = prev!.results[0] as { orders: number; revenue: number };
  const ms = (speed!.results[0] as { ms: number | null }).ms;
  return {
    day: dayOf(since),
    orders: orders.length,
    revenue: orders.reduce((s, o) => s + o.total, 0),
    confirmed,
    cancelled,
    shipped: count("expediee"),
    delivered: count("livree"),
    returned: count("retour"),
    profit: orders.length && known ? profit : null,
    profitMissingCost: missing,
    confirmRate: confirmed + cancelled ? Math.round((confirmed / (confirmed + cancelled)) * 100) : null,
    avgConfirmMinutes: ms != null ? Math.round(ms / 60_000) : null,
    topProduct: p ? { id: p.id, name: p.name, units: p.units } : null,
    topWilaya: w ? { code: w.code, name: w.name ?? `Wilaya ${w.code}`, orders: w.orders } : null,
    pending: (pending!.results[0] as { n: number }).n,
    late: (late!.results[0] as { n: number }).n,
    previous: { orders: pv.orders, revenue: pv.revenue },
  };
}
