import { describe, expect, it } from "vitest";
import { computeTotals, fillTemplate, normalizeSearch, parseMarkdown, pointsFor, slugify } from "./index";

describe("computeTotals", () => {
  const lines = [
    { unitPrice: 4900, qty: 1 },
    { unitPrice: 2800, qty: 2 },
  ];

  it("adds lines and shipping", () => {
    const t = computeTotals({ lines, shippingPrice: 600, coupon: null, freeShippingOver: null });
    expect(t).toMatchObject({ subtotal: 10500, discount: 0, shipping: 600, total: 11100, freeShipping: false });
  });

  it("applies a percent coupon (rounded down)", () => {
    const t = computeTotals({ lines, shippingPrice: 600, coupon: { code: "X", type: "percent", value: 10, minSubtotal: null }, freeShippingOver: null });
    expect(t.discount).toBe(1050);
    expect(t.total).toBe(10500 - 1050 + 600);
  });

  it("caps a fixed coupon at the subtotal", () => {
    const t = computeTotals({ lines: [{ unitPrice: 500, qty: 1 }], shippingPrice: 400, coupon: { code: "X", type: "fixed", value: 2000, minSubtotal: null }, freeShippingOver: null });
    expect(t.discount).toBe(500);
    expect(t.total).toBe(400);
  });

  it("limits a product/category coupon to its lines", () => {
    const mixed = [{ unitPrice: 4900, qty: 1, eligible: true }, { unitPrice: 2800, qty: 2, eligible: false }];
    const pct = computeTotals({ lines: mixed, shippingPrice: 600, coupon: { code: "X", type: "percent", value: 10, minSubtotal: null, restricted: true }, freeShippingOver: null });
    expect(pct.discount).toBe(490);
    const fixed = computeTotals({ lines: mixed, shippingPrice: 600, coupon: { code: "X", type: "fixed", value: 9000, minSubtotal: null, restricted: true }, freeShippingOver: null });
    expect(fixed.discount).toBe(4900);
    const none = computeTotals({ lines: mixed.map((l) => ({ ...l, eligible: false })), shippingPrice: 600, coupon: { code: "X", type: "percent", value: 10, minSubtotal: null, restricted: true }, freeShippingOver: null });
    expect(none.couponApplied).toBe(false);
    expect(none.couponReason).toBe("not_applicable");
  });

  it("rejects a coupon below its minimum", () => {
    const t = computeTotals({ lines, shippingPrice: 600, coupon: { code: "X", type: "percent", value: 10, minSubtotal: 20000 }, freeShippingOver: null });
    expect(t.couponApplied).toBe(false);
    expect(t.couponReason).toBe("min_subtotal");
    expect(t.discount).toBe(0);
  });

  it("handles free shipping from coupon or threshold", () => {
    const viaCoupon = computeTotals({ lines, shippingPrice: 600, coupon: { code: "X", type: "free_shipping", value: 0, minSubtotal: null }, freeShippingOver: null });
    expect(viaCoupon.shipping).toBe(0);
    const viaThreshold = computeTotals({ lines, shippingPrice: 600, coupon: null, freeShippingOver: 10000 });
    expect(viaThreshold.shipping).toBe(0);
    const below = computeTotals({ lines, shippingPrice: 600, coupon: null, freeShippingOver: 20000 });
    expect(below.shipping).toBe(600);
  });

  it("keeps shipping null when delivery is unavailable", () => {
    const t = computeTotals({ lines, shippingPrice: null, coupon: null, freeShippingOver: null });
    expect(t.shipping).toBeNull();
    expect(t.total).toBe(10500);
  });

  it("computes loyalty points", () => {
    expect(pointsFor(10550, 1)).toBe(105);
    expect(pointsFor(99, 5)).toBe(0);
  });
});

describe("text helpers", () => {
  it("slugifies French names", () => {
    expect(slugify("Robe Satin Émeraude – Été 2026")).toBe("robe-satin-emeraude-ete-2026");
    expect(slugify("  L’élégance  ")).toBe("lelegance");
  });

  it("normalises Arabic and French for search", () => {
    expect(normalizeSearch("فُسْتَان")).toBe(normalizeSearch("فستان"));
    expect(normalizeSearch("أناقة")).toBe(normalizeSearch("اناقه"));
    expect(normalizeSearch("Élégante")).toBe("elegante");
  });

  it("fills templates", () => {
    expect(fillTemplate("Bonjour {name}, commande {code}", { name: "Amina", code: "HN-1" })).toBe("Bonjour Amina, commande HN-1");
  });
});

describe("parseMarkdown", () => {
  it("parses headings, paragraphs, lists and inline marks", () => {
    const blocks = parseMarkdown("# Titre\n\nTexte **gras** et *italique*.\n\n- un\n- deux");
    expect(blocks[0]).toEqual({ t: "h", level: 1, content: [{ t: "text", v: "Titre" }] });
    expect(blocks[1]).toMatchObject({ t: "p" });
    expect(blocks[2]).toMatchObject({ t: "ul", items: [[{ t: "text", v: "un" }], [{ t: "text", v: "deux" }]] });
  });

  it("never produces unsafe links", () => {
    const [p] = parseMarkdown("[clique](javascript:alert(1)) [ok](https://henine.dz)");
    expect(p).toMatchObject({ t: "p" });
    const content = (p as { content: unknown[] }).content;
    expect(content).toContainEqual({ t: "text", v: "clique" });
    expect(content).toContainEqual({ t: "a", v: "ok", href: "https://henine.dz" });
  });
});

describe("markdown links stay on safe targets", () => {
  it("drops protocol-relative links", async () => {
    const { parseInline } = await import("./text");
    expect(parseInline("[a](/boutique)")).toEqual([{ t: "a", v: "a", href: "/boutique" }]);
    expect(parseInline("[a](//evil.example)")).toEqual([{ t: "text", v: "a" }]);
    expect(parseInline("[a](/\\evil.example)")).toEqual([{ t: "text", v: "a" }]);
    expect(parseInline("[a](javascript:x)")).toEqual([{ t: "text", v: "a" }]);
  });
});
