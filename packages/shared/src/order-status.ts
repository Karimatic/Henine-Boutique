/**
 * Order lifecycle. The only place transitions are defined: the API, admin UI,
 * Telegram buttons and carrier sync all go through `canTransition`.
 */

export const ORDER_STATUSES = [
  "nouvelle",
  "injoignable",
  "confirmee",
  "en_preparation",
  "expediee",
  "en_livraison",
  "livree",
  "retour",
  "retour_recu",
  "annulee",
  "doublon",
  "fausse",
] as const;

export type OrderStatus = (typeof ORDER_STATUSES)[number];

const TRANSITIONS: Record<OrderStatus, readonly OrderStatus[]> = {
  nouvelle: ["confirmee", "injoignable", "annulee", "doublon", "fausse"],
  injoignable: ["confirmee", "injoignable", "annulee", "fausse"],
  confirmee: ["en_preparation", "annulee"],
  en_preparation: ["expediee", "confirmee", "annulee"],
  expediee: ["en_livraison", "livree", "retour"],
  en_livraison: ["livree", "retour"],
  livree: ["retour"],
  retour: ["retour_recu"],
  retour_recu: [],
  annulee: ["nouvelle"],
  doublon: [],
  fausse: [],
};

export function canTransition(from: OrderStatus, to: OrderStatus): boolean {
  return TRANSITIONS[from].includes(to);
}

export function nextStatuses(from: OrderStatus): readonly OrderStatus[] {
  return TRANSITIONS[from];
}

/** Statuses an order never passes through on its way somewhere else. */
const DEAD_ENDS: readonly OrderStatus[] = ["injoignable", "annulee", "doublon", "fausse", "retour"];

/**
 * The steps from one status to another, following the allowed transitions (so stock is
 * reserved, taken and given back exactly as if each step had been done by hand):
 * nouvelle → livree = confirmee, en_preparation, expediee, livree. Null when it can't get there.
 */
export function statusPath(from: OrderStatus, to: OrderStatus): OrderStatus[] | null {
  if (from === to) return [];
  const prev = new Map<OrderStatus, OrderStatus>();
  const queue: OrderStatus[] = [from];
  while (queue.length) {
    const s = queue.shift()!;
    for (const n of TRANSITIONS[s]) {
      if (n === from || prev.has(n)) continue;
      prev.set(n, s);
      if (n === to) {
        const path: OrderStatus[] = [n];
        for (let x = s; x !== from; x = prev.get(x)!) path.unshift(x);
        return path;
      }
      if (!DEAD_ENDS.includes(n)) queue.push(n);
    }
  }
  return null;
}

/**
 * Stock bookkeeping per transition:
 * - reserve   : stock_reserved += qty            (order placed / reopened)
 * - release   : stock_reserved -= qty            (cancelled before shipping)
 * - commit    : stock_reserved -= qty, on_hand -= qty   (parcel leaves the shop)
 * - restock   : on_hand += qty                   (returned parcel checked in)
 */
export type StockEffect = "reserve" | "release" | "commit" | "restock" | null;

const RELEASING: readonly OrderStatus[] = ["annulee", "doublon", "fausse"];

export function stockEffect(from: OrderStatus, to: OrderStatus): StockEffect {
  if (from === "annulee" && to === "nouvelle") return "reserve";
  if (RELEASING.includes(to)) return "release";
  if (to === "expediee") return "commit";
  if (to === "retour_recu") return "restock";
  return null;
}

/** Customer-facing tracking steps (what the /suivi timeline shows). */
export const TRACKING_STEPS = ["nouvelle", "confirmee", "en_preparation", "expediee", "en_livraison", "livree"] as const;

export function trackingStepIndex(status: OrderStatus): number {
  if (status === "injoignable") return 0;
  const i = (TRACKING_STEPS as readonly string[]).indexOf(status);
  return i;
}

export const STATUS_LABELS: Record<OrderStatus, { fr: string; ar: string }> = {
  nouvelle: { fr: "Reçue", ar: "تم الاستلام" },
  injoignable: { fr: "En attente de confirmation", ar: "في انتظار التأكيد" },
  confirmee: { fr: "Confirmée", ar: "مؤكدة" },
  en_preparation: { fr: "En préparation", ar: "قيد التحضير" },
  expediee: { fr: "Expédiée", ar: "تم الشحن" },
  en_livraison: { fr: "En cours de livraison", ar: "قيد التوصيل" },
  livree: { fr: "Livrée", ar: "تم التوصيل" },
  retour: { fr: "Retour en cours", ar: "قيد الإرجاع" },
  retour_recu: { fr: "Retournée", ar: "مُرجعة" },
  annulee: { fr: "Annulée", ar: "ملغاة" },
  doublon: { fr: "Annulée (doublon)", ar: "ملغاة (مكررة)" },
  fausse: { fr: "Annulée", ar: "ملغاة" },
};
