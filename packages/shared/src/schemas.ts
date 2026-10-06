import { CONTACT_TIMES } from "./operations";
import { z } from "zod";
import { normalizeDzPhone } from "./phone";

export const dzPhone = z
  .string()
  .trim()
  .max(24)
  .transform((v, ctx) => {
    const p = normalizeDzPhone(v);
    if (!p) {
      ctx.addIssue({ code: "custom", message: "phone_invalid" });
      return z.NEVER;
    }
    return p;
  });

/**
 * A link the shop may send visitors to: a page of the site ("/…") or an https address.
 * Never "//other-site" or "/\other-site" (browsers read those as another website).
 */
export const isSafeLink = (t: string): boolean => /^https:\/\/[^\s]+$/i.test(t) || /^\/(?![/\\])\S*$/.test(t);

export const cleanText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    // strip control chars; React escapes the rest on output
    .transform((v) => v.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, ""));

export const wilayaCode = z.number().int().min(1).max(69);

/** At least two letters (any alphabet): rejects "11", "..", "a" while accepting "Lina" or "لينا". */
const hasLetters = (min: number) => (v: string) => (v.match(/\p{L}/gu)?.length ?? 0) >= min;

export const deliveryType = z.enum(["domicile", "bureau"]);

export const orderLine = z.object({
  variantId: z.number().int().positive(),
  qty: z.number().int().min(1).max(20),
});

/** What the storefront sends. Prices are NEVER accepted from the client. */
export const createOrderInput = z
  .object({
    idempotencyKey: z.string().uuid(),
    /** checkout autosave id: the saved abandoned checkout is marked recovered */
    cartId: z.string().uuid().optional(),
    name: cleanText(80).pipe(z.string().min(2, "name_required").refine(hasLetters(2), "name_required")),
    phone: dzPhone,
    wilaya: wilayaCode,
    communeId: z.number().int().positive().nullable(),
    communeText: cleanText(80).optional(),
    deliveryType,
    stopDeskId: z.number().int().positive().nullable().optional(),
    address: cleanText(200).optional(),
    note: cleanText(500).optional(),
    /** best time to call her for the confirmation */
    contactTime: z.enum(CONTACT_TIMES).optional(),
    coupon: z
      .string()
      .trim()
      .toUpperCase()
      .max(32)
      .regex(/^[A-Z0-9_-]*$/)
      .optional(),
    usePoints: z.boolean().default(false),
    lines: z.array(orderLine).min(1).max(30),
    channel: z.enum(["web", "express"]).default("web"),
    locale: z.enum(["fr", "ar"]).default("fr"),
    turnstileToken: z.string().min(1).max(4096),
    utm: z
      .object({
        source: cleanText(64).optional(),
        medium: cleanText(64).optional(),
        campaign: cleanText(64).optional(),
        /** host of the site the visit came from ("l.instagram.com") */
        referrer: cleanText(120).optional(),
        /** the store page where the visit started */
        landing: cleanText(200).optional(),
        /** an ad click id was in the address */
        clickId: z.enum(["fb", "google", "tiktok"]).optional(),
      })
      .optional(),
  })
  .superRefine((o, ctx) => {
    if (o.deliveryType === "domicile" && (!o.address || o.address.length < 4 || !hasLetters(2)(o.address))) {
      ctx.addIssue({ code: "custom", path: ["address"], message: "address_required" });
    }
    if (o.communeId == null && !o.communeText) {
      ctx.addIssue({ code: "custom", path: ["communeId"], message: "commune_required" });
    }
  });

export type CreateOrderInput = z.infer<typeof createOrderInput>;

export const trackLookupInput = z.object({
  phone: dzPhone,
  code: z.string().trim().toUpperCase().max(12).optional(),
  turnstileToken: z.string().min(1).max(4096),
});

const couponCode = z
  .string()
  .trim()
  .toUpperCase()
  .max(32)
  .regex(/^[A-Z0-9_-]*$/);

/** Live price check while the customer fills the checkout form. */
export const quoteInput = z.object({
  lines: z.array(orderLine).min(1).max(30),
  wilaya: wilayaCode.nullable().optional(),
  communeId: z.number().int().positive().nullable().optional(),
  deliveryType: deliveryType.optional(),
  coupon: couponCode.optional(),
  /** loyalty: the customer's number (her points) and whether she spends them */
  phone: dzPhone.optional(),
  usePoints: z.boolean().optional(),
});
export type QuoteInput = z.infer<typeof quoteInput>;

/** Checkout in progress (autosaved once the phone number is valid; see the notice in the form). */
export const CHECKOUT_STEPS = ["details", "address", "delivery", "ready"] as const;
export const cartSaveInput = z.object({
  id: z.string().uuid(),
  lines: z.array(orderLine).min(1).max(30),
  phone: dzPhone,
  name: cleanText(80).optional(),
  wilaya: wilayaCode.nullable().optional(),
  communeId: z.number().int().positive().nullable().optional(),
  deliveryType: deliveryType.optional(),
  step: z.enum(CHECKOUT_STEPS).default("details"),
  channel: z.enum(["web", "express"]).default("web"),
  locale: z.enum(["fr", "ar"]).default("ar"),
});

const orderCode = z.string().trim().toUpperCase().regex(/^HN-[0-9A-Z]{4,10}$/);

/**
 * Verified review: proves a delivered order either with the private tracking token
 * or with the phone number used for the order.
 */
export const reviewInput = z
  .object({
    code: orderCode,
    token: z.string().min(16).max(128).optional(),
    phone: dzPhone.optional(),
    productId: z.number().int().positive(),
    rating: z.number().int().min(1).max(5),
    text: cleanText(1000).optional(),
    turnstileToken: z.string().min(1).max(4096),
  })
  .refine((r) => !!r.token || !!r.phone, { message: "proof_required", path: ["phone"] });

export const contactInput = z.object({
  name: cleanText(80).pipe(z.string().min(2)),
  phone: dzPhone.optional(),
  subject: cleanText(120).optional(),
  message: cleanText(2000).pipe(z.string().min(5)),
  turnstileToken: z.string().min(1).max(4096),
});

export const stockAlertInput = z.object({
  variantId: z.number().int().positive(),
  phone: dzPhone,
  turnstileToken: z.string().min(1).max(4096),
});

/** "Prévenez-moi" by notification: the browser's push subscription for one variant. */
export const pushSubscribeInput = z.object({
  /** one size of a product (restock), every sold-out size of a product (wishlist), or none: store news */
  variantId: z.number().int().positive().optional(),
  productId: z.number().int().positive().optional(),
  topic: z.enum(["restock", "news"]).default("restock"),
  locale: z.enum(["fr", "ar"]).default("ar"),
  subscription: z.object({
    endpoint: z.string().url().max(800),
    keys: z.object({
      p256dh: z.string().regex(/^[A-Za-z0-9_-]{80,100}$/),
      auth: z.string().regex(/^[A-Za-z0-9_-]{16,30}$/),
    }),
  }),
});

export const clientErrorInput = z.object({
  message: z.string().max(500),
  stack: z.string().max(4000).optional(),
  url: z.string().max(500).optional(),
});

/** Shopping assistant: a free-text wish ("robe noire pour un mariage, moins de 8000 DA"). */
export const assistantInput = z.object({
  q: z.string().trim().min(1).max(300),
  locale: z.enum(["fr", "ar"]).default("ar"),
  /** what the phone knows (never stored): last products seen, favourites, cart, her orders, the previous search */
  context: z
    .object({
      recent: z.array(z.string().max(90)).max(12).default([]),
      favorites: z.array(z.string().max(90)).max(50).default([]),
      cart: z.array(z.object({ slug: z.string().max(90), qty: z.number().int().min(1).max(20), price: z.number().int().min(0) })).max(30).default([]),
      orders: z.array(z.object({ code: z.string().max(20), token: z.string().max(200) })).max(3).default([]),
      previous: z.string().max(300).optional(),
      /** the last exchanges of this conversation, so she can say "and in red?" or "the second one" */
      history: z.array(z.object({ q: z.string().max(300), a: z.string().max(600) })).max(6).default([]),
    })
    .default({ recent: [], favorites: [], cart: [], orders: [], history: [] }),
});
