import { describe, expect, it } from "vitest";
import { DEFAULT_SLA, isEditable, manualDiscountAmount, orderProfit, slaLateMinutes, slaStage } from "./operations";

describe("manualDiscountAmount", () => {
  it("takes a fixed amount or a percentage of the items", () => {
    expect(manualDiscountAmount(7500, "fixed", 500)).toBe(500);
    expect(manualDiscountAmount(7500, "percent", 10)).toBe(750);
  });
  it("never goes below zero nor above the items", () => {
    expect(manualDiscountAmount(3000, "fixed", 5000)).toBe(3000);
    expect(manualDiscountAmount(3000, "percent", 150)).toBe(3000);
    expect(manualDiscountAmount(3000, "fixed", -200)).toBe(0);
  });
});

describe("orderProfit", () => {
  it("subtracts product cost, the delivery the shop pays, packaging and discounts", () => {
    const r = orderProfit({
      items: [{ unitPrice: 4250, qty: 2, unitCost: 2000 }],
      discount: 300,
      shippingCharged: 0, // free delivery: the shop pays the carrier
      shippingCost: 450,
      packagingCost: 100,
      returned: false,
    });
    expect(r).toMatchObject({ revenue: 8500, productCost: 4000, shippingCost: 450, packaging: 100, discount: 300, profit: 3650, missingCost: false });
    expect(r.margin).toBeCloseTo(3650 / 8500);
  });
  it("delivery paid by the customer costs the shop nothing", () => {
    expect(orderProfit({ items: [{ unitPrice: 3000, qty: 1, unitCost: 1500 }], discount: 0, shippingCharged: 500, shippingCost: 450, packagingCost: 0, returned: false }).profit).toBe(1500);
  });
  it("a returned parcel only costs delivery and packaging", () => {
    expect(orderProfit({ items: [{ unitPrice: 3000, qty: 1, unitCost: 1500 }], discount: 0, shippingCharged: 500, shippingCost: 450, packagingCost: 100, returned: true }).profit).toBe(-550);
  });
  it("flags unknown costs", () => {
    expect(orderProfit({ items: [{ unitPrice: 3000, qty: 1, unitCost: null }], discount: 0, shippingCharged: 0, shippingCost: 0, packagingCost: 0, returned: false }).missingCost).toBe(true);
  });
});

describe("order SLA", () => {
  const now = Date.parse("2026-10-04T12:00:00Z");
  it("knows which step each status waits on", () => {
    expect(slaStage("nouvelle")).toBe("confirm");
    expect(slaStage("confirmee")).toBe("prepare");
    expect(slaStage("en_preparation")).toBe("ship");
    expect(slaStage("expediee")).toBeNull();
  });
  it("counts the minutes past the limit", () => {
    expect(slaLateMinutes("nouvelle", now - 20 * 60_000, DEFAULT_SLA, now)).toBe(0);
    expect(slaLateMinutes("nouvelle", now - 50 * 60_000, DEFAULT_SLA, now)).toBe(20);
    expect(slaLateMinutes("livree", now - 9e9, DEFAULT_SLA, now)).toBe(0);
  });
  it("orders can be edited only before shipping", () => {
    expect(isEditable("confirmee")).toBe(true);
    expect(isEditable("expediee")).toBe(false);
  });
});
