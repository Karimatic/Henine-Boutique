import { describe, expect, it } from "vitest";
import { DEFAULT_SLA, isEditable, manualDiscountAmount, orderProfit, salePrice, slaLateMinutes, slaStage } from "./operations";
import { artKey, categorySlugs, currentSeason, subCategories } from "./catalog-tree";

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

describe("salePrice", () => {
  it("takes the percentage off and rounds to 50 DA", () => {
    expect(salePrice(4900, 30)).toBe(3450);
    expect(salePrice(2500, 20)).toBe(2000);
  });
  it("always stays below the usual price, never free", () => {
    expect(salePrice(100, 1)).toBe(50);
    expect(salePrice(3000, 99)).toBe(300);
  });
});

describe("catalog tree", () => {
  const cats = [
    { id: 1, parentId: null, slug: "pyjamas", nameFr: "Pyjamas", nameAr: "", image: null },
    { id: 2, parentId: 1, slug: "pyjamas-ete", nameFr: "Été", nameAr: "", image: null, season: "summer" as const },
    { id: 3, parentId: 1, slug: "pyjamas-hiver", nameFr: "Hiver", nameAr: "", image: null, season: "winter" as const },
  ];
  it("knows the season (April–September = summer) unless forced", () => {
    expect(currentSeason("auto", Date.parse("2026-07-10T10:00:00Z"))).toBe("summer");
    expect(currentSeason("auto", Date.parse("2026-12-10T10:00:00Z"))).toBe("winter");
    expect(currentSeason("winter", Date.parse("2026-07-10T10:00:00Z"))).toBe("winter");
  });
  it("puts the current season's sub-category first", () => {
    expect(subCategories(cats, 1, "winter").map((c) => c.slug)).toEqual(["pyjamas-hiver", "pyjamas-ete"]);
  });
  it("a main category includes its sub-categories", () => {
    expect([...categorySlugs(cats, "pyjamas")]).toEqual(["pyjamas", "pyjamas-ete", "pyjamas-hiver"]);
    expect([...categorySlugs(cats, "pyjamas-ete")]).toEqual(["pyjamas-ete"]);
  });
  it("draws a fitting silhouette per category", () => {
    expect(artKey("survetements")).toBe("sport");
    expect(artKey("soutiens-gorge-culottes")).toBe("set");
    expect(artKey("gandouras-djebbas-robes")).toBe("djebba");
  });
});
