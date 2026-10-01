/**
 * Pure order-total arithmetic, shared by the Worker (authoritative) and tests.
 * The Worker loads prices/stock/coupon from D1 and calls this; the client never computes totals.
 */

export interface CouponRule {
  code: string;
  type: "percent" | "fixed" | "free_shipping";
  value: number;
  minSubtotal: number | null;
}

export interface TotalsInput {
  lines: { unitPrice: number; qty: number }[];
  shippingPrice: number | null; // null = delivery unavailable for this wilaya/type
  coupon: CouponRule | null;
  freeShippingOver: number | null;
}

export interface Totals {
  subtotal: number;
  discount: number;
  shipping: number | null;
  total: number;
  freeShipping: boolean;
  couponApplied: boolean;
  couponReason: "min_subtotal" | null;
}

export function computeTotals({ lines, shippingPrice, coupon, freeShippingOver }: TotalsInput): Totals {
  const subtotal = lines.reduce((s, l) => s + l.unitPrice * l.qty, 0);

  let discount = 0;
  let couponFreeShipping = false;
  let couponApplied = false;
  let couponReason: Totals["couponReason"] = null;
  if (coupon) {
    if (coupon.minSubtotal != null && subtotal < coupon.minSubtotal) {
      couponReason = "min_subtotal";
    } else {
      couponApplied = true;
      if (coupon.type === "percent") discount = Math.floor((subtotal * Math.min(Math.max(coupon.value, 0), 100)) / 100);
      else if (coupon.type === "fixed") discount = Math.min(Math.max(coupon.value, 0), subtotal);
      else couponFreeShipping = true;
    }
  }

  const freeShipping = couponFreeShipping || (freeShippingOver != null && subtotal - discount >= freeShippingOver);
  const shipping = shippingPrice == null ? null : freeShipping ? 0 : shippingPrice;
  const total = subtotal - discount + (shipping ?? 0);
  return { subtotal, discount, shipping, total, freeShipping, couponApplied, couponReason };
}

/** Loyalty: points earned for a delivered order. */
export function pointsFor(total: number, pointsPer100: number): number {
  return Math.floor(total / 100) * Math.max(0, Math.floor(pointsPer100));
}
