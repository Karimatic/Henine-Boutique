import { describe, expect, it } from "vitest";
import { abVerdict } from "./index";

describe("A/B verdict", () => {
  it("declares a winner on a clear, large difference", () => {
    const v = abVerdict({ seen: 2000, converted: 40 }, { seen: 2000, converted: 80 });
    expect(v.winner).toBe("b");
    expect(v.confidence).toBeGreaterThan(0.99);
    expect(v.lift).toBeCloseTo(1, 5);
  });
  it("waits when the difference could be chance", () => {
    const v = abVerdict({ seen: 300, converted: 9 }, { seen: 300, converted: 11 });
    expect(v.winner).toBeNull();
    expect(v.confidence).toBeLessThan(0.95);
  });
  it("needs enough visitors on both versions", () => {
    const v = abVerdict({ seen: 40, converted: 1 }, { seen: 40, converted: 10 });
    expect(v.needMoreData).toBe(true);
    expect(v.winner).toBeNull();
  });
});
