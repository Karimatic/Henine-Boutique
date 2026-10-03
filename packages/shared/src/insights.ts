/**
 * Data-driven product badges and order outcome reasons.
 * Badges are computed from real sales of non-cancelled orders only: no badge is ever
 * shown without the numbers behind it. Thresholds live here so they are easy to change.
 */

export type ProductBadge = "bestseller" | "trending" | "popular";

export const BADGE_RULES = {
  /** Best-seller: among the top N products by units sold in the last 30 days… */
  bestsellerTop: 3,
  /** …with at least this many units sold. */
  bestsellerMinUnits30: 5,
  /** Trending: at least this many units in the last 7 days… */
  trendingMinUnits7: 3,
  /** …and at least this ratio versus the 7 days before (or nothing sold before). */
  trendingGrowth: 1.5,
  /** Popular: at least this many units in the last 30 days. */
  popularMinUnits30: 3,
  /** A product counts as "new" for this many days after publication. */
  newDays: 21,
} as const;

export interface SalesSignal {
  units30: number;
  units7: number;
  unitsPrev7: number;
}

/** `rank30` is the 0-based position of the product when sorted by units30 (descending). */
export function productBadge(s: SalesSignal, rank30: number): ProductBadge | null {
  const r = BADGE_RULES;
  if (rank30 < r.bestsellerTop && s.units30 >= r.bestsellerMinUnits30) return "bestseller";
  if (s.units7 >= r.trendingMinUnits7 && (s.unitsPrev7 === 0 || s.units7 >= s.unitsPrev7 * r.trendingGrowth)) return "trending";
  if (s.units30 >= r.popularMinUnits30) return "popular";
  return null;
}

export const BADGE_LABEL: Record<ProductBadge, { fr: string; ar: string }> = {
  bestseller: { fr: "Best-seller", ar: "الأكثر مبيعًا" },
  trending: { fr: "Tendance", ar: "رائج" },
  popular: { fr: "Populaire", ar: "مطلوب" },
};

export function isNewArrival(publishedAt: number, now = Date.now()): boolean {
  return now - publishedAt < BADGE_RULES.newDays * 86400_000;
}

/* ───────────── Why an order was cancelled / returned ───────────── */

export const OUTCOME_REASONS = [
  "refused",
  "wrong_phone",
  "wrong_address",
  "unreachable",
  "changed_mind",
  "size_issue",
  "too_small",
  "too_large",
  "product_issue",
  "defect",
  "delivery_problem",
  "duplicate",
  "other",
] as const;

export type OutcomeReason = (typeof OUTCOME_REASONS)[number];

export const OUTCOME_REASON_LABEL: Record<OutcomeReason, string> = {
  refused: "Cliente a refusé le colis",
  wrong_phone: "Mauvais numéro",
  wrong_address: "Mauvaise adresse",
  unreachable: "Cliente injoignable / absente",
  changed_mind: "Cliente a changé d'avis",
  size_issue: "Problème de taille",
  too_small: "Trop petit",
  too_large: "Trop grand",
  product_issue: "Problème de produit",
  defect: "Défaut / abîmé",
  delivery_problem: "Problème de livraison",
  duplicate: "Commande en double",
  other: "Autre",
};
