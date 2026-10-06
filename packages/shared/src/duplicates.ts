/**
 * Possible duplicate orders: the same customer ordering the same thing twice by mistake (two
 * taps, a retry after a slow network, an order by phone and on the site…). The team decides:
 * nothing is cancelled automatically. Each signal adds points; a pair is flagged above the
 * threshold (Paramètres → Alertes), with the reasons shown in plain words.
 */

export interface DuplicateSettings {
  enabled: boolean;
  /** only orders placed this close together are compared */
  windowHours: number;
  /** points needed to flag a pair (higher = fewer, surer warnings) */
  threshold: number;
}

export const DEFAULT_DUPLICATE_SETTINGS: DuplicateSettings = { enabled: true, windowHours: 48, threshold: 70 };

export const DUPLICATE_REASONS = ["same_phone", "same_customer", "same_address", "same_items", "some_items", "similar_total", "minutes_apart", "hours_apart"] as const;
export type DuplicateReason = (typeof DUPLICATE_REASONS)[number];

export const DUPLICATE_REASON_LABEL: Record<DuplicateReason, string> = {
  same_phone: "Même téléphone",
  same_customer: "Même cliente",
  same_address: "Même adresse de livraison",
  same_items: "Mêmes articles",
  some_items: "Des articles en commun",
  similar_total: "Montant proche",
  minutes_apart: "Passées à quelques minutes d'écart",
  hours_apart: "Passées à quelques heures d'écart",
};

export const DUPLICATE_STATUSES = ["open", "kept", "merged", "cancelled", "reviewed", "ignored"] as const;
export type DuplicateStatus = (typeof DUPLICATE_STATUSES)[number];
export const DUPLICATE_ACTIONS = ["keep", "merge", "cancel", "reviewed", "ignore"] as const;
export type DuplicateAction = (typeof DUPLICATE_ACTIONS)[number];

export interface OrderForDuplicate {
  phone: string;
  customerId: number;
  wilaya: number;
  communeId: number | null;
  address: string | null;
  deliveryType: string;
  total: number;
  createdAt: number;
  /** variant ids (with quantities) */
  items: { variantId: number | null; qty: number }[];
}

/** "Cité 200 logts, bt 4" ≈ "cite 200 logements bt4": lower case, no accents, no punctuation or spaces */
export const normalizeAddress = (s: string | null | undefined) =>
  (s ?? "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[أإآ]/g, "ا")
    .replace(/ة/g, "ه")
    .replace(/[^\p{L}\p{N}]/gu, "");

export interface DuplicateMatch {
  score: number;
  reasons: DuplicateReason[];
  minutesApart: number;
}

/** How much two orders look like one order placed twice (a newer `a` against an older `b`). */
export function duplicateScore(a: OrderForDuplicate, b: OrderForDuplicate, settings: DuplicateSettings = DEFAULT_DUPLICATE_SETTINGS): DuplicateMatch | null {
  const minutesApart = Math.abs(a.createdAt - b.createdAt) / 60_000;
  if (minutesApart > settings.windowHours * 60) return null;
  const reasons: DuplicateReason[] = [];
  let score = 0;
  if (a.phone === b.phone) {
    score += 35;
    reasons.push("same_phone");
  } else if (a.customerId === b.customerId) {
    score += 25;
    reasons.push("same_customer");
  }
  const addrA = normalizeAddress(a.address);
  if (a.wilaya === b.wilaya && a.deliveryType === b.deliveryType && (a.communeId ?? 0) === (b.communeId ?? 0) && (a.deliveryType === "bureau" || (addrA.length >= 4 && addrA === normalizeAddress(b.address)))) {
    score += 15;
    reasons.push("same_address");
  }
  const key = (items: OrderForDuplicate["items"]) => items.filter((i) => i.variantId != null).map((i) => `${i.variantId}x${i.qty}`).sort().join(",");
  const setA = new Set(a.items.map((i) => i.variantId).filter((v) => v != null));
  const common = b.items.filter((i) => i.variantId != null && setA.has(i.variantId)).length;
  if (key(a.items) && key(a.items) === key(b.items)) {
    score += 30;
    reasons.push("same_items");
  } else if (common > 0) {
    score += 15;
    reasons.push("some_items");
  }
  // a close amount only means something when the carts overlap (a loyal customer often spends alike)
  const hi = Math.max(a.total, b.total);
  if (common > 0 && hi > 0 && Math.abs(a.total - b.total) / hi <= 0.1) {
    score += 10;
    reasons.push("similar_total");
  }
  if (minutesApart <= 60) {
    score += 15;
    reasons.push("minutes_apart");
  } else if (minutesApart <= 12 * 60) {
    score += 5;
    reasons.push("hours_apart");
  }
  // without the same person (phone / customer) it is never a duplicate, however similar the cart
  if (!reasons.includes("same_phone") && !reasons.includes("same_customer")) return null;
  return score >= settings.threshold ? { score, reasons, minutesApart: Math.round(minutesApart) } : null;
}
