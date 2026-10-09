/**
 * Money that comes back from the courier (cash on delivery) and the business result.
 *
 * One model, used by the API and shown as is by the admin (no sums in the UI):
 * - per order: what the courier should collect, what it says it collected, its fees, what it has
 *   paid back to the shop (remittances) and what is still owed;
 * - per period: revenue → gross profit → order-level profit (the same costs as the per-order
 *   profit: products, delivery paid by the shop, returns, discounts, packaging) → net profit
 *   after the operating expenses.
 * Amounts are whole dinars (DA).
 */

/* ── COD reconciliation ── */

export const RECONCILIATION_STATUSES = ["pending", "partial", "reconciled", "disputed", "overpaid"] as const;
export type ReconciliationStatus = (typeof RECONCILIATION_STATUSES)[number];

export const RECONCILIATION_LABEL: Record<ReconciliationStatus, string> = {
  pending: "En attente",
  partial: "Partiellement versé",
  reconciled: "Rapproché",
  disputed: "Litige",
  overpaid: "Trop versé",
};

export interface CodOrderInput {
  /** the parcel's fate: delivered (the courier collected the cash) or returned (nothing collected) */
  outcome: "delivered" | "returned";
  /** what the customer had to pay (order total) */
  total: number;
  /** the wilaya's delivery rate (estimate of the courier's fee when it isn't recorded) */
  rate: number;
  /** recorded from the courier's statement (null = not recorded yet) */
  collected: number | null;
  carrierFee: number | null;
  returnFee: number | null;
  /** sum of the remittances allocated to this order */
  remitted: number;
  disputed: boolean;
}

export interface CodOrderResult {
  expected: number;
  collected: number;
  carrierFee: number;
  returnFee: number;
  /** collected − fees: what the courier should pay the shop for this parcel (negative: the shop owes it) */
  netExpected: number;
  remitted: number;
  /** netExpected − remitted (negative: paid too much) */
  outstanding: number;
  /** collected differs from what the customer had to pay */
  discrepancy: number;
  /** the fees are estimates (not from the courier's statement) */
  estimated: boolean;
  status: ReconciliationStatus;
}

export function reconcileCodOrder(i: CodOrderInput): CodOrderResult {
  const delivered = i.outcome === "delivered";
  const expected = delivered ? i.total : 0;
  const collected = i.collected ?? expected;
  const carrierFee = delivered ? (i.carrierFee ?? i.rate) : 0;
  // a returned parcel: the courier charges the return (by default the same rate as a delivery)
  const returnFee = delivered ? 0 : (i.returnFee ?? i.rate);
  const netExpected = collected - carrierFee - returnFee;
  const outstanding = netExpected - i.remitted;
  const estimated = delivered ? i.carrierFee == null : i.returnFee == null;
  // compared with what is due, in either direction (a returned parcel's fee is deducted: negative)
  const status: ReconciliationStatus = i.disputed
    ? "disputed"
    : i.remitted === netExpected
      ? "reconciled"
      : i.remitted === 0
        ? "pending"
        : Math.sign(i.remitted) !== Math.sign(netExpected) || Math.abs(i.remitted) > Math.abs(netExpected)
          ? "overpaid"
          : "partial";
  return { expected, collected, carrierFee, returnFee, netExpected, remitted: i.remitted, outstanding, discrepancy: collected - expected, estimated, status };
}

export interface CodTotals {
  orders: number;
  expected: number;
  collected: number;
  carrierFees: number;
  returnFees: number;
  netExpected: number;
  remitted: number;
  outstanding: number;
  discrepancies: number;
  byStatus: Record<ReconciliationStatus, number>;
}

export function codTotals(rows: CodOrderResult[]): CodTotals {
  const byStatus = Object.fromEntries(RECONCILIATION_STATUSES.map((s) => [s, 0])) as Record<ReconciliationStatus, number>;
  const t: CodTotals = { orders: rows.length, expected: 0, collected: 0, carrierFees: 0, returnFees: 0, netExpected: 0, remitted: 0, outstanding: 0, discrepancies: 0, byStatus };
  for (const r of rows) {
    t.expected += r.expected;
    t.collected += r.collected;
    t.carrierFees += r.carrierFee;
    t.returnFees += r.returnFee;
    t.netExpected += r.netExpected;
    t.remitted += r.remitted;
    t.outstanding += r.outstanding;
    if (r.discrepancy !== 0) t.discrepancies++;
    byStatus[r.status]++;
  }
  return t;
}

/* ── Expenses ── */

export const EXPENSE_CATEGORIES = [
  "advertising",
  "packaging",
  "salaries",
  "rent",
  "utilities",
  "delivery",
  "returns",
  "software",
  "equipment",
  "maintenance",
  "other",
] as const;
export type ExpenseCategory = (typeof EXPENSE_CATEGORIES)[number];

export const EXPENSE_CATEGORY_LABEL: Record<ExpenseCategory, { fr: string; emoji: string }> = {
  advertising: { fr: "Publicité", emoji: "📣" },
  packaging: { fr: "Emballage (achats)", emoji: "📦" },
  salaries: { fr: "Salaires", emoji: "👩‍💼" },
  rent: { fr: "Loyer", emoji: "🏠" },
  utilities: { fr: "Électricité, eau, internet", emoji: "💡" },
  delivery: { fr: "Livraison (hors commandes)", emoji: "🚚" },
  returns: { fr: "Retours (hors commandes)", emoji: "↩️" },
  software: { fr: "Logiciels et services", emoji: "💻" },
  equipment: { fr: "Matériel", emoji: "🧰" },
  maintenance: { fr: "Entretien", emoji: "🔧" },
  other: { fr: "Autre", emoji: "🧾" },
};

/**
 * A category is one of the presets above or any name the shop types (« Cadeaux clientes »,
 * « Shooting photo »…): those custom ones get a tag emoji and are shown as typed.
 */
export function expenseCategoryLabel(category: string): { fr: string; emoji: string; custom: boolean } {
  const preset = (EXPENSE_CATEGORY_LABEL as Record<string, { fr: string; emoji: string }>)[category];
  return preset ? { ...preset, custom: false } : { fr: category, emoji: "🏷️", custom: true };
}

export const PAYMENT_METHODS = ["cash", "ccp", "baridimob", "card", "transfer", "other"] as const;
export type PaymentMethod = (typeof PAYMENT_METHODS)[number];
export const PAYMENT_METHOD_LABEL: Record<PaymentMethod, string> = {
  cash: "Espèces",
  ccp: "CCP",
  baridimob: "BaridiMob",
  card: "Carte (CIB / Edahabia)",
  transfer: "Virement",
  other: "Autre",
};

/* ── Business result (profit & loss) ── */

export interface PnlInput {
  /** delivered orders: selling price of the items */
  revenue: number;
  /** coupons, points and manual discounts on those orders */
  discounts: number;
  /** purchase cost of the items sold (unknown costs counted as 0, see missingCost) */
  cogs: number;
  /** delivery paid by the shop on delivered orders (free / cheaper delivery, recorded or estimated fees) */
  deliveryCosts: number;
  /** courier fees for returned parcels */
  returnCosts: number;
  /** packaging per parcel (Paramètres → Alertes) */
  packaging: number;
  /** operating expenses of the period, by category */
  expenses: Record<string, number>;
}

export interface PnlResult {
  revenue: number;
  /** revenue − discounts − cost of goods */
  grossProfit: number;
  /** gross profit − delivery − returns − packaging: the sum of the per-order profits */
  orderProfit: number;
  operatingExpenses: number;
  /** order profit − operating expenses */
  netProfit: number;
  /** net profit / revenue (null without revenue) */
  netMargin: number | null;
}

export function businessPnl(i: PnlInput): PnlResult {
  const grossProfit = i.revenue - i.discounts - i.cogs;
  const orderProfit = grossProfit - i.deliveryCosts - i.returnCosts - i.packaging;
  const operatingExpenses = Object.values(i.expenses).reduce((s, v) => s + (v ?? 0), 0);
  const netProfit = orderProfit - operatingExpenses;
  return { revenue: i.revenue, grossProfit, orderProfit, operatingExpenses, netProfit, netMargin: i.revenue > 0 ? netProfit / i.revenue : null };
}
