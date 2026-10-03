/**
 * Customer / order risk indicator for cash-on-delivery orders.
 *
 * Decision support only: nothing in the system rejects an order because of this score.
 * Every point comes from a rule below, and the admin shows the reasons next to the level,
 * so the team can always see why an order is flagged. To tune it, change RISK_WEIGHTS or
 * RISK_LEVELS: the TypeScript scoring and the SQL used for the "high risk" customer
 * segment are both generated from them.
 */

/** Points per signal. Positive = more risk, negative = more trust. */
export const RISK_WEIGHTS = {
  /** customer on the blacklist */
  blacklisted: 100,
  /** per order marked "fausse commande" (max 2 counted) */
  fake: 40,
  /** per parcel returned / refused at the door (max 3 counted) */
  returned: 25,
  /** per other cancellation (max 4 counted) */
  cancelled: 8,
  /** per delivered order (max 3 counted): proven customer */
  delivered: -15,
  /* order-level signals, captured when the order is placed (orders.risk_flags) */
  /** a cancellation by the same phone in the last 7 days */
  recent_cancel: 15,
  /** another order from the same phone in the last 24 h */
  repeat_24h: 15,
  /** 3+ other phone numbers ordered from the same connection within 2 h (weak: mobile networks share IPs) */
  ip_burst: 15,
  /** commune typed by hand instead of picked from the list */
  commune_text: 5,
  /** unusually large basket for COD (see HIGH_VALUE_DA) */
  high_value: 10,
} as const;

export const RISK_CAPS = { fake: 2, returned: 3, cancelled: 4, delivered: 3 } as const;

/** Score thresholds: ≥ high → 🔴, ≥ medium → 🟡, otherwise 🟢. */
export const RISK_LEVELS = { medium: 20, high: 50 } as const;

/** Total (DA) above which an order gets the high_value flag. */
export const HIGH_VALUE_DA = 20_000;

export const RISK_FLAGS = ["recent_cancel", "repeat_24h", "ip_burst", "commune_text", "high_value"] as const;
export type RiskFlag = (typeof RISK_FLAGS)[number];
export type RiskLevel = "low" | "medium" | "high";
export type RiskReasonCode = keyof typeof RISK_WEIGHTS;

export interface RiskHistory {
  deliveredCount: number;
  returnedCount: number;
  /** all cancellations, including fake orders */
  cancelledCount: number;
  fakeCount: number;
  isBlacklisted: boolean;
}

export interface RiskReason {
  code: RiskReasonCode;
  points: number;
  /** how many times the signal was counted (orders), 1 for flags */
  count: number;
}

export interface RiskAssessment {
  score: number;
  level: RiskLevel;
  reasons: RiskReason[];
}

export function riskLevel(score: number): RiskLevel {
  return score >= RISK_LEVELS.high ? "high" : score >= RISK_LEVELS.medium ? "medium" : "low";
}

export function assessRisk(h: RiskHistory, flags: readonly string[] = []): RiskAssessment {
  const reasons: RiskReason[] = [];
  const add = (code: RiskReasonCode, count: number) => {
    if (count > 0) reasons.push({ code, count, points: RISK_WEIGHTS[code] * count });
  };
  if (h.isBlacklisted) add("blacklisted", 1);
  add("fake", Math.min(h.fakeCount, RISK_CAPS.fake));
  add("returned", Math.min(h.returnedCount, RISK_CAPS.returned));
  add("cancelled", Math.min(Math.max(h.cancelledCount - h.fakeCount, 0), RISK_CAPS.cancelled));
  add("delivered", Math.min(h.deliveredCount, RISK_CAPS.delivered));
  for (const f of new Set(flags)) if ((RISK_FLAGS as readonly string[]).includes(f)) add(f as RiskFlag, 1);
  const score = Math.max(0, reasons.reduce((s, r) => s + r.points, 0));
  return { score, level: riskLevel(score), reasons };
}

/**
 * The customer-history part of the score as an SQL expression over a `customers` row
 * (used to filter the "high risk" segment with exactly the same weights).
 */
export function customerRiskSql(alias = "c"): string {
  const w = RISK_WEIGHTS;
  const k = RISK_CAPS;
  return `MAX(0, (CASE WHEN ${alias}.is_blacklisted = 1 THEN ${w.blacklisted} ELSE 0 END)
    + MIN(${alias}.fake_count, ${k.fake}) * ${w.fake}
    + MIN(${alias}.returned_count, ${k.returned}) * ${w.returned}
    + MIN(MAX(${alias}.cancelled_count - ${alias}.fake_count, 0), ${k.cancelled}) * ${w.cancelled}
    + MIN(${alias}.delivered_count, ${k.delivered}) * ${w.delivered})`;
}

export const RISK_LEVEL_LABEL: Record<RiskLevel, { fr: string; emoji: string }> = {
  low: { fr: "Risque faible", emoji: "🟢" },
  medium: { fr: "Risque moyen", emoji: "🟡" },
  high: { fr: "Risque élevé", emoji: "🔴" },
};

export const RISK_REASON_LABEL: Record<RiskReasonCode, string> = {
  blacklisted: "sur liste noire",
  fake: "fausse(s) commande(s)",
  returned: "colis retourné(s) / refusé(s)",
  cancelled: "commande(s) annulée(s)",
  delivered: "commande(s) livrée(s)",
  recent_cancel: "annulation dans les 7 derniers jours",
  repeat_24h: "autre commande dans les 24 h",
  ip_burst: "plusieurs numéros depuis la même connexion",
  commune_text: "commune saisie à la main",
  high_value: "panier inhabituellement élevé",
};

/** "🟡 Risque moyen (25) : 1 colis retourné(s) / refusé(s) +25 …" */
export function describeRisk(r: RiskAssessment): string {
  const parts = r.reasons.map((x) => `${x.count > 1 ? `${x.count} ` : ""}${RISK_REASON_LABEL[x.code]} ${x.points > 0 ? "+" : ""}${x.points}`);
  return `${RISK_LEVEL_LABEL[r.level].emoji} ${RISK_LEVEL_LABEL[r.level].fr} (${r.score})${parts.length ? ` : ${parts.join(" · ")}` : ""}`;
}

/* ───────────── Customer segments (phone-number identity) ───────────── */

export type CustomerSegment = "new" | "returning" | "vip" | "high_risk";

/** VIP = at least this many delivered orders, or this much spent on delivered orders. */
export const VIP_RULE = { delivered: 3, spentDa: 25_000 } as const;

/** "Gros panier": average delivered order at least this much (any number of orders). */
export const HIGH_SPENDER_AVG_DA = 6_000;

/** Extra lists of the Clients page (a customer can be in several). */
export const EXTRA_SEGMENTS = ["high_spender", "abandoned", "inactives", "blacklist"] as const;

/** SQL for the extra lists. `now` is generated by the Worker, never user input. */
export function extraSegmentSql(segment: (typeof EXTRA_SEGMENTS)[number], alias: string, now: number): string {
  switch (segment) {
    case "high_spender":
      return `${alias}.delivered_count > 0 AND ${alias}.total_spent >= ${HIGH_SPENDER_AVG_DA} * ${alias}.delivered_count`;
    case "abandoned":
      // started a checkout in the last 30 days without sending it (Paniers)
      return `EXISTS (SELECT 1 FROM carts k WHERE k.phone = ${alias}.phone AND k.recovered_order_id IS NULL
                AND k.updated_at < ${Math.floor(now) - 30 * 60_000} AND k.updated_at > ${Math.floor(now) - 30 * 86400_000})`;
    case "inactives":
      return `${alias}.last_order_at < ${Math.floor(now) - 60 * 86400_000}`;
    case "blacklist":
      return `${alias}.is_blacklisted = 1`;
  }
}

export function customerSegment(h: RiskHistory & { totalSpent: number }): CustomerSegment {
  if (assessRisk(h).level === "high") return "high_risk";
  if (h.deliveredCount >= VIP_RULE.delivered || h.totalSpent >= VIP_RULE.spentDa) return "vip";
  if (h.deliveredCount >= 1) return "returning";
  return "new";
}

/** SQL conditions for each segment, consistent with customerSegment(). */
export function segmentSql(segment: CustomerSegment, alias = "c"): string {
  const risky = `${customerRiskSql(alias)} >= ${RISK_LEVELS.high}`;
  const vip = `(${alias}.delivered_count >= ${VIP_RULE.delivered} OR ${alias}.total_spent >= ${VIP_RULE.spentDa})`;
  switch (segment) {
    case "high_risk":
      return risky;
    case "vip":
      return `NOT (${risky}) AND ${vip}`;
    case "returning":
      return `NOT (${risky}) AND NOT ${vip} AND ${alias}.delivered_count >= 1`;
    case "new":
      return `NOT (${risky}) AND ${alias}.delivered_count = 0`;
  }
}

export const SEGMENT_LABEL: Record<CustomerSegment, string> = {
  new: "Nouvelle cliente",
  returning: "Cliente fidèle",
  vip: "VIP",
  high_risk: "Risque élevé",
};
