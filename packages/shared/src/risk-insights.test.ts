import { describe, expect, it } from "vitest";
import { BADGE_RULES, isNewArrival, productBadge } from "./insights";
import { assessRisk, customerRiskSql, customerSegment, RISK_LEVELS, RISK_WEIGHTS, segmentSql } from "./risk";

const clean = { deliveredCount: 0, returnedCount: 0, cancelledCount: 0, fakeCount: 0, isBlacklisted: false };

describe("risk score", () => {
  it("a brand-new customer is low risk with no reasons", () => {
    expect(assessRisk(clean)).toEqual({ score: 0, level: "low", reasons: [] });
  });

  it("explains every point and caps repeated signals", () => {
    const r = assessRisk({ ...clean, returnedCount: 5, cancelledCount: 1 });
    expect(r.reasons.find((x) => x.code === "returned")).toEqual({ code: "returned", count: 3, points: 3 * RISK_WEIGHTS.returned });
    expect(r.score).toBe(3 * RISK_WEIGHTS.returned + RISK_WEIGHTS.cancelled);
    expect(r.level).toBe("high");
  });

  it("does not count fake orders twice (they are also cancellations)", () => {
    const r = assessRisk({ ...clean, cancelledCount: 2, fakeCount: 2 });
    expect(r.reasons.map((x) => x.code)).toEqual(["fake"]);
    expect(r.score).toBe(2 * RISK_WEIGHTS.fake);
  });

  it("delivered orders build trust but the score never goes below 0", () => {
    expect(assessRisk({ ...clean, deliveredCount: 3, returnedCount: 1 }).score).toBe(0);
    expect(assessRisk({ ...clean, deliveredCount: 1, returnedCount: 1 }).level).toBe("low");
  });

  it("adds order-level flags and ignores unknown ones", () => {
    const r = assessRisk(clean, ["repeat_24h", "ip_burst", "nonsense", "repeat_24h"]);
    expect(r.score).toBe(RISK_WEIGHTS.repeat_24h + RISK_WEIGHTS.ip_burst);
    expect(r.level).toBe("medium");
  });

  it("blacklisted customers are always high risk", () => {
    expect(assessRisk({ ...clean, isBlacklisted: true, deliveredCount: 3 }).level).toBe("high");
  });

  it("thresholds are ordered", () => {
    expect(RISK_LEVELS.medium).toBeLessThan(RISK_LEVELS.high);
  });
});

describe("customer segments", () => {
  it("follows the order history", () => {
    expect(customerSegment({ ...clean, totalSpent: 0 })).toBe("new");
    expect(customerSegment({ ...clean, deliveredCount: 1, totalSpent: 5000 })).toBe("returning");
    expect(customerSegment({ ...clean, deliveredCount: 3, totalSpent: 9000 })).toBe("vip");
    expect(customerSegment({ ...clean, deliveredCount: 1, totalSpent: 30_000 })).toBe("vip");
    expect(customerSegment({ ...clean, deliveredCount: 4, totalSpent: 50_000, isBlacklisted: true })).toBe("high_risk");
  });

  it("produces SQL from the same weights (no user input inside)", () => {
    const sql = customerRiskSql("c");
    expect(sql).toContain(`* ${RISK_WEIGHTS.returned}`);
    expect(sql).not.toMatch(/\?/);
    expect(segmentSql("high_risk")).toContain(`>= ${RISK_LEVELS.high}`);
  });
});

describe("product badges", () => {
  it("never shows a badge without sales", () => {
    expect(productBadge({ units30: 0, units7: 0, unitsPrev7: 0 }, 0)).toBeNull();
  });

  it("best-seller needs both a top rank and enough units", () => {
    expect(productBadge({ units30: BADGE_RULES.bestsellerMinUnits30, units7: 1, unitsPrev7: 1 }, 0)).toBe("bestseller");
    expect(productBadge({ units30: BADGE_RULES.bestsellerMinUnits30, units7: 1, unitsPrev7: 1 }, BADGE_RULES.bestsellerTop)).toBe("popular");
    expect(productBadge({ units30: 2, units7: 1, unitsPrev7: 1 }, 0)).toBeNull();
  });

  it("trending = recent growth", () => {
    expect(productBadge({ units30: 4, units7: 4, unitsPrev7: 1 }, 5)).toBe("trending");
    expect(productBadge({ units30: 8, units7: 3, unitsPrev7: 3 }, 5)).toBe("popular");
  });

  it("new arrivals expire", () => {
    const now = Date.UTC(2026, 9, 1);
    expect(isNewArrival(now - 86400_000, now)).toBe(true);
    expect(isNewArrival(now - (BADGE_RULES.newDays + 1) * 86400_000, now)).toBe(false);
  });
});
