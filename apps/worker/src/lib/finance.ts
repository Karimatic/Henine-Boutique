/**
 * Finance: cash on delivery per order, and the business result of a period. One model with the
 * rest of the admin: the per-order profit (orderProfit in @henine/shared) is reused as is; the
 * courier's real fee, once recorded from its statement, replaces the wilaya-rate estimate here
 * and everywhere the profit is shown.
 */
import {
  businessPnl,
  codTotals,
  EXPENSE_CATEGORIES,
  orderProfit,
  reconcileCodOrder,
  type CodOrderResult,
  type PnlResult,
  type ReconciliationStatus,
} from "@henine/shared";
import type { Env } from "../env";
import { algiersDate } from "./orders";
import { getSettings } from "./settings";

/** The courier's fee for an order: the recorded one, else the wilaya's rate (0 in the shop). */
export const FEE_SQL = (o = "o", w = "w", f = "f") =>
  `CASE WHEN ${o}.channel = 'boutique' THEN 0 ELSE COALESCE(CASE WHEN ${o}.status IN ('retour','retour_recu') THEN ${f}.return_fee ELSE ${f}.carrier_fee END, CASE WHEN ${o}.delivery_type = 'bureau' THEN ${w}.desk_price ELSE ${w}.home_price END, 0) END`;

/** When the parcel's fate became known (delivered or back), for date filters. */
const SETTLED_AT = "COALESCE(o.delivered_at, o.returned_at, o.updated_at)";

export interface CodRow extends CodOrderResult {
  id: number;
  code: string;
  name: string;
  phone: string;
  orderStatus: string;
  outcome: "delivered" | "returned";
  wilaya: string | null;
  wilayaAr: string | null;
  tracking: string | null;
  settledAt: number;
  disputed: boolean;
  note: string | null;
  recorded: boolean;
}

export interface CodFilter {
  since?: number;
  until?: number;
  outcome?: "delivered" | "returned";
  status?: ReconciliationStatus | "open";
  q?: string;
}

/** Every delivered / returned courier parcel of the period with its reconciliation. */
export async function codRows(env: Env, f: CodFilter = {}): Promise<CodRow[]> {
  const where = ["o.channel != 'boutique'", "o.status IN ('livree','retour','retour_recu')"];
  const binds: unknown[] = [];
  if (f.since != null) {
    where.push(`${SETTLED_AT} >= ?`);
    binds.push(f.since);
  }
  if (f.until != null) {
    where.push(`${SETTLED_AT} < ?`);
    binds.push(f.until);
  }
  if (f.outcome) where.push(f.outcome === "delivered" ? "o.status = 'livree'" : "o.status IN ('retour','retour_recu')");
  if (f.q) {
    const digits = f.q.replace(/\D/g, "");
    where.push("(o.public_code LIKE ? OR o.name LIKE ? OR o.tracking_number = ?" + (digits.length >= 3 ? " OR o.phone LIKE ?" : "") + ")");
    binds.push(`%${f.q.toUpperCase()}%`, `%${f.q}%`, f.q, ...(digits.length >= 3 ? [`%${digits}%`] : []));
  }
  const { results } = await env.DB.prepare(
    `SELECT o.id, o.public_code, o.name, o.phone, o.status, o.total, o.tracking_number, ${SETTLED_AT} AS settled_at,
            w.name_fr AS wilaya_fr, w.name_ar AS wilaya_ar,
            CASE WHEN o.delivery_type = 'bureau' THEN w.desk_price ELSE w.home_price END AS rate,
            f.order_id AS recorded, f.collected, f.carrier_fee, f.return_fee, COALESCE(f.disputed, 0) AS disputed, f.note,
            COALESCE((SELECT SUM(a.amount) FROM cod_allocations a JOIN cod_remittances r ON r.id = a.remittance_id
                       WHERE a.order_id = o.id AND r.voided_at IS NULL), 0) AS remitted
       FROM orders o LEFT JOIN wilayas w ON w.code = o.wilaya_code LEFT JOIN order_finance f ON f.order_id = o.id
      WHERE ${where.join(" AND ")}
      ORDER BY settled_at DESC LIMIT 20000`,
  )
    .bind(...binds)
    .all<{
      id: number; public_code: string; name: string; phone: string; status: string; total: number; tracking_number: string | null; settled_at: number;
      wilaya_fr: string | null; wilaya_ar: string | null; rate: number | null; recorded: number | null; collected: number | null; carrier_fee: number | null;
      return_fee: number | null; disputed: number; note: string | null; remitted: number;
    }>();
  const rows = results.map((r): CodRow => {
    const outcome = r.status === "livree" ? "delivered" : "returned";
    const rec = reconcileCodOrder({
      outcome, total: r.total, rate: r.rate ?? 0, collected: r.collected, carrierFee: r.carrier_fee, returnFee: r.return_fee, remitted: r.remitted, disputed: !!r.disputed,
    });
    return {
      ...rec, id: r.id, code: r.public_code, name: r.name, phone: r.phone, orderStatus: r.status, outcome, wilaya: r.wilaya_fr, wilayaAr: r.wilaya_ar,
      tracking: r.tracking_number, settledAt: r.settled_at, disputed: !!r.disputed, note: r.note, recorded: r.recorded != null,
    };
  });
  if (f.status === "open") return rows.filter((r) => r.status !== "reconciled");
  return f.status ? rows.filter((r) => r.status === f.status) : rows;
}

/** Parcels still with the courier (shipped, not delivered yet): cash it will collect. */
export async function codInTransit(env: Env): Promise<{ orders: number; amount: number }> {
  const r = await env.DB.prepare("SELECT COUNT(*) AS n, COALESCE(SUM(total), 0) AS amount FROM orders WHERE channel != 'boutique' AND status IN ('expediee','en_livraison')").first<{ n: number; amount: number }>();
  return { orders: r?.n ?? 0, amount: r?.amount ?? 0 };
}

export interface PnlReport extends PnlResult {
  discounts: number;
  cogs: number;
  deliveryCosts: number;
  returnCosts: number;
  packaging: number;
  /** preset categories (0 when unused) and the shop's own ones */
  expensesByCategory: Record<string, number>;
  /** delivered orders / returned parcels counted */
  delivered: number;
  returned: number;
  /** delivered items without a purchase cost: their profit is overstated */
  missingCost: number;
  /** fees taken from the wilaya rates (not recorded from the courier's statement) */
  estimatedFees: number;
}

/**
 * The business result of a period: orders by the day their fate was known (delivered / back),
 * expenses by the day they were paid. Same costs as the per-order profit.
 */
export async function profitAndLoss(env: Env, since: number, until: number): Promise<PnlReport> {
  const { operations } = await getSettings(env, ["operations"]);
  const [orders, items, spent] = await env.DB.batch([
    env.DB.prepare(
      `SELECT o.id, o.status, o.channel, o.discount_total, o.shipping_price, ${FEE_SQL()} AS fee,
              CASE WHEN o.status IN ('retour','retour_recu') THEN f.return_fee ELSE f.carrier_fee END AS recorded_fee
         FROM orders o LEFT JOIN wilayas w ON w.code = o.wilaya_code LEFT JOIN order_finance f ON f.order_id = o.id
        WHERE o.status IN ('livree','retour','retour_recu') AND ${SETTLED_AT} >= ?1 AND ${SETTLED_AT} < ?2 LIMIT 50000`,
    ).bind(since, until),
    env.DB.prepare(
      `SELECT oi.order_id, oi.unit_price, oi.line_discount, oi.qty, p.cost_price
         FROM order_items oi JOIN orders o ON o.id = oi.order_id LEFT JOIN products p ON p.id = oi.product_id
        WHERE o.status IN ('livree','retour','retour_recu') AND ${SETTLED_AT} >= ?1 AND ${SETTLED_AT} < ?2 LIMIT 200000`,
    ).bind(since, until),
    env.DB.prepare("SELECT category, SUM(amount) AS amount FROM expenses WHERE voided_at IS NULL AND spent_on >= ? AND spent_on <= ? GROUP BY category").bind(
      algiersDate(since),
      algiersDate(until - 1),
    ),
  ]);
  type Item = { order_id: number; unit_price: number; line_discount: number; qty: number; cost_price: number | null };
  const byOrder = new Map<number, Item[]>();
  for (const i of items!.results as Item[]) byOrder.set(i.order_id, [...(byOrder.get(i.order_id) ?? []), i]);

  let revenue = 0, discounts = 0, cogs = 0, deliveryCosts = 0, returnCosts = 0, packaging = 0, delivered = 0, returned = 0, missingCost = 0, estimatedFees = 0;
  for (const o of orders!.results as { id: number; status: string; channel: string; discount_total: number; shipping_price: number; fee: number; recorded_fee: number | null }[]) {
    const isReturn = o.status !== "livree";
    const boutique = o.channel === "boutique";
    const its = byOrder.get(o.id) ?? [];
    const r = orderProfit({
      items: its.map((i) => ({ unitPrice: i.unit_price - i.line_discount, qty: i.qty, unitCost: i.cost_price })),
      discount: o.discount_total,
      shippingCharged: o.shipping_price,
      shippingCost: o.fee,
      packagingCost: boutique ? 0 : operations.packaging_cost,
      returned: isReturn,
    });
    if (!boutique && o.recorded_fee == null) estimatedFees++;
    packaging += r.packaging;
    if (isReturn) {
      returned++;
      returnCosts += r.shippingCost;
    } else {
      delivered++;
      revenue += r.revenue;
      discounts += r.discount;
      cogs += r.productCost;
      deliveryCosts += r.shippingCost;
      if (r.missingCost) missingCost++;
    }
  }
  const expensesByCategory: Record<string, number> = Object.fromEntries(EXPENSE_CATEGORIES.map((k) => [k, 0]));
  for (const e of spent!.results as { category: string; amount: number }[]) expensesByCategory[e.category] = e.amount;
  const pnl = businessPnl({ revenue, discounts, cogs, deliveryCosts, returnCosts, packaging, expenses: expensesByCategory });
  return { ...pnl, discounts, cogs, deliveryCosts, returnCosts, packaging, expensesByCategory, delivered, returned, missingCost, estimatedFees };
}

export { codTotals };
