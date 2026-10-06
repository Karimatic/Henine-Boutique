/**
 * After the parcel leaves: the courier hand-over sheet (manifest) and the follow-up of failed
 * deliveries. Both are layers on top of the order lifecycle (order-status.ts): a manifest's
 * hand-over marks its orders "expédiée" through the normal transition.
 */

/* ── Courier manifest ── */

export const MANIFEST_STATUSES = ["draft", "ready", "handed_over", "confirmed", "cancelled"] as const;
export type ManifestStatus = (typeof MANIFEST_STATUSES)[number];

export const MANIFEST_STATUS_LABEL: Record<ManifestStatus, string> = {
  draft: "Brouillon",
  ready: "Prêt",
  handed_over: "Remis au livreur",
  confirmed: "Confirmé par le livreur",
  cancelled: "Annulé",
};

const MANIFEST_TRANSITIONS: Record<ManifestStatus, readonly ManifestStatus[]> = {
  draft: ["ready", "cancelled"],
  ready: ["draft", "handed_over", "cancelled"],
  handed_over: ["confirmed"],
  confirmed: [],
  cancelled: [],
};
export const canManifestTransition = (from: ManifestStatus, to: ManifestStatus) => MANIFEST_TRANSITIONS[from].includes(to);
/** its list of parcels can still change */
export const manifestEditable = (s: ManifestStatus) => s === "draft";
/** order statuses that can go on a manifest (ready to leave the shop) */
export const MANIFEST_ORDER_STATUSES = ["confirmee", "en_preparation"] as const;

/* ── Failed deliveries ── */

export const FAILED_DELIVERY_REASONS = ["no_answer", "unreachable", "unavailable", "address_issue", "retry_requested", "refused_at_door", "other"] as const;
export type FailedDeliveryReason = (typeof FAILED_DELIVERY_REASONS)[number];
export const FAILED_DELIVERY_REASON_LABEL: Record<FailedDeliveryReason, string> = {
  no_answer: "La cliente ne répond pas",
  unreachable: "Téléphone injoignable / éteint",
  unavailable: "Cliente absente",
  address_issue: "Problème d'adresse",
  retry_requested: "La cliente demande un nouveau passage",
  refused_at_door: "Refusé à la porte",
  other: "Autre",
};

export const FOLLOWUP_STATUSES = ["needs_contact", "contacted", "callback", "retry_requested", "unreachable", "resolved", "cancelled"] as const;
export type FollowupStatus = (typeof FOLLOWUP_STATUSES)[number];
export const FOLLOWUP_STATUS_LABEL: Record<FollowupStatus, string> = {
  needs_contact: "À contacter",
  contacted: "Contactée",
  callback: "Rappel programmé",
  retry_requested: "Nouveau passage demandé",
  unreachable: "Injoignable",
  resolved: "Résolu",
  cancelled: "Annulé",
};
export const FOLLOWUP_OPEN: readonly FollowupStatus[] = ["needs_contact", "contacted", "callback", "retry_requested", "unreachable"];
export const followupClosed = (s: FollowupStatus) => s === "resolved" || s === "cancelled";

const FOLLOWUP_TRANSITIONS: Record<FollowupStatus, readonly FollowupStatus[]> = {
  needs_contact: ["contacted", "callback", "retry_requested", "unreachable", "resolved", "cancelled"],
  contacted: ["callback", "retry_requested", "unreachable", "resolved", "cancelled", "needs_contact"],
  callback: ["contacted", "retry_requested", "unreachable", "resolved", "cancelled", "needs_contact"],
  retry_requested: ["needs_contact", "contacted", "resolved", "cancelled"],
  unreachable: ["contacted", "callback", "retry_requested", "resolved", "cancelled", "needs_contact"],
  resolved: ["needs_contact"],
  cancelled: ["needs_contact"],
};
export const canFollowupTransition = (from: FollowupStatus, to: FollowupStatus) => from === to || FOLLOWUP_TRANSITIONS[from].includes(to);
/** the order statuses where a delivery can fail */
export const FAILABLE_ORDER_STATUSES = ["expediee", "en_livraison"] as const;
