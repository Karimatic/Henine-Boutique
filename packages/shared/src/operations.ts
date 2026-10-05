/**
 * Day-to-day order operations: contact preferences, the team's contact log, order edits
 * before shipping, exchange requests, delivery confirmation, real profit and order SLAs.
 */
import type { OrderStatus } from "./order-status";

/* ── Best time to call the customer (chosen at checkout) ── */

export const CONTACT_TIMES = ["morning", "afternoon", "evening", "any"] as const;
export type ContactTime = (typeof CONTACT_TIMES)[number];

export const CONTACT_TIME_LABEL: Record<ContactTime, { fr: string; ar: string; emoji: string }> = {
  morning: { fr: "Le matin", ar: "صباحًا", emoji: "🌅" },
  afternoon: { fr: "L'après-midi", ar: "بعد الظهر", emoji: "☀️" },
  evening: { fr: "Le soir", ar: "مساءً", emoji: "🌙" },
  any: { fr: "N'importe quand", ar: "في أي وقت", emoji: "🕐" },
};

/* ── The team's contact log (stored as order events, so it follows the order and the customer) ── */

export const CONTACT_KINDS = ["call", "whatsapp", "sms", "note", "other"] as const;
export type ContactKind = (typeof CONTACT_KINDS)[number];

export const CONTACT_KIND_LABEL: Record<ContactKind, { fr: string; emoji: string }> = {
  call: { fr: "Appel", emoji: "📞" },
  whatsapp: { fr: "WhatsApp", emoji: "💬" },
  sms: { fr: "SMS", emoji: "✉️" },
  note: { fr: "Note", emoji: "📝" },
  other: { fr: "Autre", emoji: "🔸" },
};

/* ── Editing an order: only before the parcel leaves the shop ── */

/** Statuses in which the team may still change items, quantities, address, delivery and discount. */
export const EDITABLE_STATUSES: readonly OrderStatus[] = ["nouvelle", "injoignable", "confirmee", "en_preparation"];

export function isEditable(status: OrderStatus): boolean {
  return EDITABLE_STATUSES.includes(status);
}

/** A manual discount, as typed by the team: a fixed amount or a percentage of the items. */
export function manualDiscountAmount(subtotal: number, kind: "fixed" | "percent", value: number): number {
  const raw = kind === "percent" ? Math.round((subtotal * Math.min(Math.max(value, 0), 100)) / 100) : Math.round(Math.max(value, 0));
  return Math.min(raw, subtotal); // never more than the items: the total can't go negative
}

/* ── Exchange requests (customer, from her private tracking link, after delivery) ── */

export const EXCHANGE_REASONS = ["too_small", "too_large", "wrong_product", "defective", "other"] as const;
export type ExchangeReason = (typeof EXCHANGE_REASONS)[number];

export const EXCHANGE_REASON_LABEL: Record<ExchangeReason, { fr: string; ar: string }> = {
  too_small: { fr: "Trop petit", ar: "صغير جدًا" },
  too_large: { fr: "Trop grand", ar: "كبير جدًا" },
  wrong_product: { fr: "Mauvais article reçu", ar: "وصلتني قطعة خاطئة" },
  defective: { fr: "Article défectueux", ar: "القطعة معيبة" },
  other: { fr: "Autre", ar: "سبب آخر" },
};

export const EXCHANGE_STATUSES = ["pending", "approved", "rejected", "completed"] as const;
export type ExchangeStatus = (typeof EXCHANGE_STATUSES)[number];

export const EXCHANGE_STATUS_LABEL: Record<ExchangeStatus, { fr: string; ar: string }> = {
  pending: { fr: "En attente", ar: "قيد المراجعة" },
  approved: { fr: "Accepté", ar: "مقبول" },
  rejected: { fr: "Refusé", ar: "مرفوض" },
  completed: { fr: "Échangé", ar: "تم التبديل" },
};

/** Exchanges are asked within this many days of delivery (the shop's policy says 48 h; a little slack). */
export const EXCHANGE_WINDOW_DAYS = 3;

/* ── Delivery confirmation by the customer ── */

export const RECEIPT_ISSUES = ["not_received", "damaged", "wrong_item", "missing_item", "other"] as const;
export type ReceiptIssue = (typeof RECEIPT_ISSUES)[number];

export const RECEIPT_ISSUE_LABEL: Record<ReceiptIssue, { fr: string; ar: string }> = {
  not_received: { fr: "Je n'ai pas reçu le colis", ar: "لم أستلم الطرد" },
  damaged: { fr: "Article abîmé", ar: "القطعة متضررة" },
  wrong_item: { fr: "Ce n'est pas ce que j'ai commandé", ar: "ليست القطعة التي طلبتها" },
  missing_item: { fr: "Il manque un article", ar: "تنقص قطعة" },
  other: { fr: "Autre problème", ar: "مشكلة أخرى" },
};

/* ── Real profit of an order ── */

export interface ProfitInput {
  /** items: selling price (after any line discount) and unit cost (null = unknown) */
  items: { unitPrice: number; qty: number; unitCost: number | null }[];
  /** coupon + points + manual discount */
  discount: number;
  /** what the customer pays for delivery */
  shippingCharged: number;
  /** what the carrier charges the shop (the wilaya's rate), 0 for a boutique sale */
  shippingCost: number;
  packagingCost: number;
  /** the parcel came back: delivery paid for nothing, nothing sold */
  returned: boolean;
}

export interface ProfitResult {
  revenue: number;
  productCost: number;
  shippingCost: number;
  packaging: number;
  discount: number;
  profit: number;
  /** profit / revenue (0–1), null when there's no revenue */
  margin: number | null;
  /** some items have no cost price: the profit is overestimated */
  missingCost: boolean;
}

/**
 * Estimated profit: what the shop keeps once products, delivery, packaging and discounts are
 * paid. Delivery charged to the customer is passed through to the carrier, so only the part
 * the shop pays itself counts (free or cheaper delivery). A returned parcel sold nothing and
 * costs the delivery.
 */
export function orderProfit(i: ProfitInput): ProfitResult {
  const missingCost = i.items.some((x) => x.unitCost == null);
  if (i.returned) {
    const loss = i.shippingCost + i.packagingCost;
    return { revenue: 0, productCost: 0, shippingCost: i.shippingCost, packaging: i.packagingCost, discount: 0, profit: -loss, margin: null, missingCost };
  }
  const revenue = i.items.reduce((s, x) => s + x.unitPrice * x.qty, 0);
  const productCost = i.items.reduce((s, x) => s + (x.unitCost ?? 0) * x.qty, 0);
  const shippingCost = Math.max(i.shippingCost - i.shippingCharged, 0);
  const profit = revenue - productCost - shippingCost - i.packagingCost - i.discount;
  return { revenue, productCost, shippingCost, packaging: i.packagingCost, discount: i.discount, profit, margin: revenue > 0 ? profit / revenue : null, missingCost };
}

/* ── Order SLA: how long each step may take before the order is late ── */

export interface SlaSettings {
  /** new order → confirmed (or "no answer") */
  confirmMinutes: number;
  /** confirmed → in preparation */
  prepareMinutes: number;
  /** in preparation → shipped */
  shipMinutes: number;
}

export const DEFAULT_SLA: SlaSettings = { confirmMinutes: 30, prepareMinutes: 120, shipMinutes: 24 * 60 };

export type SlaStage = "confirm" | "prepare" | "ship";

/** The step an order is waiting on (null: no SLA applies to this status). */
export function slaStage(status: OrderStatus): SlaStage | null {
  return status === "nouvelle" ? "confirm" : status === "confirmee" ? "prepare" : status === "en_preparation" ? "ship" : null;
}

export function slaLimitMinutes(stage: SlaStage, sla: SlaSettings): number {
  return stage === "confirm" ? sla.confirmMinutes : stage === "prepare" ? sla.prepareMinutes : sla.shipMinutes;
}

/**
 * Minutes past the step's limit (0 = on time). `since` = when the order entered its current
 * status (its last status event; the creation time for a new order).
 */
export function slaLateMinutes(status: OrderStatus, since: number, sla: SlaSettings, now = Date.now()): number {
  const stage = slaStage(status);
  if (!stage) return 0;
  return Math.max(0, Math.floor((now - since) / 60_000) - slaLimitMinutes(stage, sla));
}
