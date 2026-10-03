/**
 * Pure order-total arithmetic, shared by the Worker (authoritative) and tests.
 * The Worker loads prices/stock/coupon from D1 and calls this; the client never computes totals.
 */

export interface CouponRule {
  code: string;
  type: "percent" | "fixed" | "free_shipping";
  value: number;
  minSubtotal: number | null;
  /** limited to some products / categories: the discount only counts the lines marked `eligible` */
  restricted?: boolean;
}

export interface TotalsInput {
  lines: { unitPrice: number; qty: number; eligible?: boolean }[];
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
  couponReason: "min_subtotal" | "not_applicable" | null;
}

export function computeTotals({ lines, shippingPrice, coupon, freeShippingOver }: TotalsInput): Totals {
  const subtotal = lines.reduce((s, l) => s + l.unitPrice * l.qty, 0);

  let discount = 0;
  let couponFreeShipping = false;
  let couponApplied = false;
  let couponReason: Totals["couponReason"] = null;
  if (coupon) {
    // a coupon for some products / categories only takes off from those lines
    const base = coupon.restricted ? lines.filter((l) => l.eligible).reduce((s, l) => s + l.unitPrice * l.qty, 0) : subtotal;
    if (coupon.minSubtotal != null && subtotal < coupon.minSubtotal) {
      couponReason = "min_subtotal";
    } else if (coupon.restricted && base === 0) {
      couponReason = "not_applicable";
    } else {
      couponApplied = true;
      if (coupon.type === "percent") discount = Math.floor((base * Math.min(Math.max(coupon.value, 0), 100)) / 100);
      else if (coupon.type === "fixed") discount = Math.min(Math.max(coupon.value, 0), base);
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
