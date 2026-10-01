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

export const cleanText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    // strip control chars; React escapes the rest on output
    .transform((v) => v.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, ""));

export const wilayaCode = z.number().int().min(1).max(69);

export const deliveryType = z.enum(["domicile", "bureau"]);

export const orderLine = z.object({
  variantId: z.number().int().positive(),
  qty: z.number().int().min(1).max(20),
});

/** What the storefront sends. Prices are NEVER accepted from the client. */
export const createOrderInput = z
  .object({
    idempotencyKey: z.string().uuid(),
    name: cleanText(80).pipe(z.string().min(2, "name_required")),
    phone: dzPhone,
    wilaya: wilayaCode,
    communeId: z.number().int().positive().nullable(),
    communeText: cleanText(80).optional(),
    deliveryType,
    stopDeskId: z.number().int().positive().nullable().optional(),
    address: cleanText(200).optional(),
    note: cleanText(500).optional(),
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
      })
      .optional(),
  })
  .superRefine((o, ctx) => {
    if (o.deliveryType === "domicile" && (!o.address || o.address.length < 4)) {
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
  deliveryType: deliveryType.optional(),
  coupon: couponCode.optional(),
});
export type QuoteInput = z.infer<typeof quoteInput>;

/** Checkout in progress, saved only with the customer's consent (abandoned-cart follow-up). */
export const cartSaveInput = z.object({
  id: z.string().uuid(),
  lines: z.array(orderLine).min(1).max(30),
  phone: dzPhone,
  name: cleanText(80).optional(),
  wilaya: wilayaCode.nullable().optional(),
  consent: z.literal(true),
});

export const reviewInput = z.object({
  productId: z.number().int().positive(),
  name: cleanText(60).pipe(z.string().min(2)),
  rating: z.number().int().min(1).max(5),
  text: cleanText(1000).optional(),
  turnstileToken: z.string().min(1).max(4096),
});

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

export const clientErrorInput = z.object({
  message: z.string().max(500),
  stack: z.string().max(4000).optional(),
  url: z.string().max(500).optional(),
});
