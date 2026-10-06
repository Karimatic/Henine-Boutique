import { describe, expect, it } from "vitest";
import { classifySource, sourceOfChannel } from "./attribution";
import { DEFAULT_DUPLICATE_SETTINGS, duplicateScore, normalizeAddress, type OrderForDuplicate } from "./duplicates";
import { businessPnl, codTotals, reconcileCodOrder } from "./finance";
import { canFollowupTransition, canManifestTransition, manifestEditable } from "./logistics";
import { orderProfit } from "./operations";
import { canCountTransition, countDifference, countSummary, stockAfterCount } from "./stock-count";

describe("COD reconciliation", () => {
  const base = { outcome: "delivered" as const, total: 10_000, rate: 500, collected: null, carrierFee: null, returnFee: null, remitted: 0, disputed: false };

  it("brief example: expected 10000, collected 10000, fees 500, remitted 9500 → nothing outstanding", () => {
    const r = reconcileCodOrder({ ...base, collected: 10_000, carrierFee: 500, remitted: 9_500 });
    expect(r).toMatchObject({ expected: 10_000, collected: 10_000, carrierFee: 500, netExpected: 9_500, remitted: 9_500, outstanding: 0, status: "reconciled", estimated: false });
  });

  it("nothing paid yet: pending, with the wilaya rate as an estimated fee", () => {
    const r = reconcileCodOrder(base);
    expect(r).toMatchObject({ collected: 10_000, carrierFee: 500, netExpected: 9_500, outstanding: 9_500, status: "pending", estimated: true });
  });

  it("partial payment, over payment, dispute", () => {
    expect(reconcileCodOrder({ ...base, remitted: 5_000 })).toMatchObject({ outstanding: 4_500, status: "partial" });
    expect(reconcileCodOrder({ ...base, remitted: 9_600 })).toMatchObject({ outstanding: -100, status: "overpaid" });
    expect(reconcileCodOrder({ ...base, remitted: 9_500, disputed: true }).status).toBe("disputed");
  });

  it("the courier collected less than the order total: a discrepancy", () => {
    const r = reconcileCodOrder({ ...base, collected: 9_000, carrierFee: 500, remitted: 8_500 });
    expect(r).toMatchObject({ discrepancy: -1_000, netExpected: 8_500, outstanding: 0, status: "reconciled" });
  });

  it("a returned parcel: nothing collected, the return fee is owed to the courier", () => {
    const r = reconcileCodOrder({ ...base, outcome: "returned", returnFee: 400 });
    expect(r).toMatchObject({ expected: 0, collected: 0, carrierFee: 0, returnFee: 400, netExpected: -400, outstanding: -400 });
    // deducted from a payout: reconciled
    expect(reconcileCodOrder({ ...base, outcome: "returned", returnFee: 400, remitted: -400 }).status).toBe("reconciled");
  });

  it("totals add up the orders", () => {
    const t = codTotals([
      reconcileCodOrder({ ...base, collected: 10_000, carrierFee: 500, remitted: 9_500 }),
      reconcileCodOrder({ ...base, total: 4_000, rate: 400 }),
      reconcileCodOrder({ ...base, outcome: "returned", total: 3_000, rate: 400 }),
    ]);
    expect(t).toMatchObject({ orders: 3, expected: 14_000, collected: 14_000, carrierFees: 900, returnFees: 400, netExpected: 12_700, remitted: 9_500, outstanding: 3_200 });
    expect(t.byStatus).toMatchObject({ reconciled: 1, pending: 2 });
  });
});

describe("business profit", () => {
  it("brief example: revenue 100000, COGS 40000, delivery/returns 10000, expenses 15000 → net 35000", () => {
    const r = businessPnl({ revenue: 100_000, discounts: 0, cogs: 40_000, deliveryCosts: 6_000, returnCosts: 4_000, packaging: 0, expenses: { advertising: 10_000, rent: 5_000 } });
    expect(r).toMatchObject({ grossProfit: 60_000, orderProfit: 50_000, operatingExpenses: 15_000, netProfit: 35_000, netMargin: 0.35 });
  });

  it("order-level profit is the sum of the per-order profits (one model)", () => {
    const delivered = orderProfit({ items: [{ unitPrice: 3_000, qty: 2, unitCost: 1_200 }], discount: 500, shippingCharged: 300, shippingCost: 600, packagingCost: 50, returned: false });
    const returned = orderProfit({ items: [{ unitPrice: 2_500, qty: 1, unitCost: 900 }], discount: 0, shippingCharged: 600, shippingCost: 600, packagingCost: 50, returned: true });
    const pnl = businessPnl({ revenue: 6_000, discounts: 500, cogs: 2_400, deliveryCosts: 300, returnCosts: 600, packaging: 100, expenses: {} });
    expect(pnl.orderProfit).toBe(delivered.profit + returned.profit);
  });

  it("no revenue: no margin instead of a division by zero", () => {
    expect(businessPnl({ revenue: 0, discounts: 0, cogs: 0, deliveryCosts: 0, returnCosts: 0, packaging: 0, expenses: { rent: 5_000 } })).toMatchObject({ netProfit: -5_000, netMargin: null });
  });
});

describe("stock count", () => {
  it("brief example: system 20, counted 17 → −3", () => {
    expect(countDifference({ systemQty: 20, countedQty: 17 })).toBe(-3);
  });

  it("the difference is applied to today's stock, never below zero, and reports orders it would break", () => {
    // 20 when counting started, 2 sold since → 18 now; 3 missing → 15
    expect(stockAfterCount(18, 4, { systemQty: 20, countedQty: 17 })).toEqual({ target: 15, delta: -3, belowReserved: false });
    expect(stockAfterCount(2, 0, { systemQty: 5, countedQty: 0 })).toEqual({ target: 0, delta: -2, belowReserved: false });
    expect(stockAfterCount(5, 4, { systemQty: 5, countedQty: 2 }).belowReserved).toBe(true);
  });

  it("summary of a count", () => {
    expect(countSummary([{ systemQty: 20, countedQty: 17 }, { systemQty: 3, countedQty: 5 }, { systemQty: 4, countedQty: 4 }, { systemQty: 9, countedQty: null }])).toEqual({
      lines: 4, counted: 3, discrepancies: 2, missingPieces: 3, foundPieces: 2,
    });
  });

  it("approval only after submission; an approved count is final", () => {
    expect(canCountTransition("counting", "approved")).toBe(false);
    expect(canCountTransition("submitted", "approved")).toBe(true);
    expect(canCountTransition("approved", "counting")).toBe(false);
  });
});

describe("duplicate orders", () => {
  const t0 = Date.UTC(2026, 9, 6, 10);
  const order = (o: Partial<OrderForDuplicate> = {}): OrderForDuplicate => ({
    phone: "0554650718", customerId: 1, wilaya: 35, communeId: 12, address: "Cité 200 logements, bt 4", deliveryType: "domicile", total: 5_800, createdAt: t0,
    items: [{ variantId: 2, qty: 1 }], ...o,
  });

  it("same phone, same items, same address, 4 minutes apart → flagged with every reason", () => {
    const m = duplicateScore(order({ createdAt: t0 + 4 * 60_000 }), order());
    expect(m?.reasons).toEqual(["same_phone", "same_address", "same_items", "similar_total", "minutes_apart"]);
    expect(m?.minutesApart).toBe(4);
    expect(m!.score).toBeGreaterThanOrEqual(DEFAULT_DUPLICATE_SETTINGS.threshold);
  });

  it("a different person is never a duplicate, however similar the cart", () => {
    expect(duplicateScore(order({ phone: "0661223344", customerId: 2, createdAt: t0 + 60_000 }), order())).toBeNull();
  });

  it("a repeat customer buying something else days later is not flagged", () => {
    expect(duplicateScore(order({ createdAt: t0 + 3 * 86_400_000 }), order())).toBeNull(); // outside the window
    expect(duplicateScore(order({ createdAt: t0 + 20 * 3_600_000, items: [{ variantId: 9, qty: 1 }], total: 12_000 }), order())).toBeNull();
  });

  it("the threshold is configurable", () => {
    const a = order({ createdAt: t0 + 5 * 3_600_000, items: [{ variantId: 9, qty: 1 }], total: 5_700 });
    expect(duplicateScore(a, order())).toBeNull();
    expect(duplicateScore(a, order(), { ...DEFAULT_DUPLICATE_SETTINGS, threshold: 40 })).toMatchObject({ score: 55, reasons: ["same_phone", "same_address", "hours_apart"] });
    // same person, same address, an item in common, a few hours apart: flagged by default
    expect(duplicateScore(order({ createdAt: t0 + 5 * 3_600_000, items: [{ variantId: 2, qty: 1 }, { variantId: 9, qty: 1 }], total: 6_200 }), order())?.reasons).toEqual([
      "same_phone", "same_address", "some_items", "similar_total", "hours_apart",
    ]);
  });

  it("addresses are compared without accents, punctuation or spaces", () => {
    expect(normalizeAddress("Cité 200 Logements, BT 4")).toBe(normalizeAddress("cite 200 logements bt4"));
  });
});

describe("order source attribution", () => {
  it("campaign links, ad clicks and referrers", () => {
    expect(classifySource({ utmSource: "instagram", utmMedium: "bio" })).toBe("instagram");
    expect(classifySource({ utmSource: "IG" })).toBe("instagram");
    expect(classifySource({ utmSource: "fb", utmCampaign: "ramadan" })).toBe("facebook");
    expect(classifySource({ utmSource: "influenceuse_lina" })).toBe("campaign");
    expect(classifySource({ utmSource: "push" })).toBe("push");
    expect(classifySource({ clickId: "fb" })).toBe("facebook");
    expect(classifySource({ clickId: "tiktok" })).toBe("tiktok");
    expect(classifySource({ referrer: "l.instagram.com" })).toBe("instagram");
    expect(classifySource({ referrer: "www.google.com" })).toBe("google");
    expect(classifySource({ referrer: "lm.facebook.com" })).toBe("facebook");
    expect(classifySource({ referrer: "web.whatsapp.com" })).toBe("whatsapp");
    expect(classifySource({ referrer: "t.me" })).toBe("telegram");
    expect(classifySource({ referrer: "blog-mode.dz" })).toBe("referral");
    expect(classifySource({})).toBe("direct");
  });

  it("the team's orders take the source of their channel", () => {
    expect(sourceOfChannel("boutique")).toBe("boutique");
    expect(sourceOfChannel("instagram")).toBe("instagram");
    expect(sourceOfChannel("web")).toBeNull();
  });
});

describe("manifests and failed deliveries", () => {
  it("manifest lifecycle", () => {
    expect(canManifestTransition("draft", "handed_over")).toBe(false);
    expect(canManifestTransition("ready", "handed_over")).toBe(true);
    expect(canManifestTransition("handed_over", "cancelled")).toBe(false);
    expect(canManifestTransition("handed_over", "confirmed")).toBe(true);
    expect(manifestEditable("ready")).toBe(false);
  });

  it("follow-up lifecycle", () => {
    expect(canFollowupTransition("needs_contact", "callback")).toBe(true);
    expect(canFollowupTransition("resolved", "contacted")).toBe(false);
    expect(canFollowupTransition("resolved", "needs_contact")).toBe(true);
  });
});
