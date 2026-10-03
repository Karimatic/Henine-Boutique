/**
 * A/B test verdict: conversion of each version (orders / visitors who saw it) and how sure
 * we can be that the difference is real (two-proportion z-test, two-sided).
 */

export interface ArmCounts {
  seen: number;
  converted: number;
}

export interface AbVerdict {
  rateA: number;
  rateB: number;
  /** B compared with A, e.g. 0.18 = +18 % */
  lift: number | null;
  /** 0–1: probability the difference isn't chance */
  confidence: number;
  /** "a" / "b" once confidence ≥ 95 % with enough visitors, else null */
  winner: "a" | "b" | null;
  /** fewer than `minSeen` visitors on a version */
  needMoreData: boolean;
}

/** Standard normal CDF (Abramowitz–Stegun erf approximation, |error| < 1.5e-7). */
function phi(z: number): number {
  const t = 1 / (1 + 0.3275911 * (Math.abs(z) / Math.SQRT2));
  const erf = 1 - ((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-(z * z) / 2);
  return z >= 0 ? (1 + erf) / 2 : (1 - erf) / 2;
}

export function abVerdict(a: ArmCounts, b: ArmCounts, minSeen = 100): AbVerdict {
  const rateA = a.seen ? a.converted / a.seen : 0;
  const rateB = b.seen ? b.converted / b.seen : 0;
  const lift = rateA > 0 ? rateB / rateA - 1 : null;
  const needMoreData = a.seen < minSeen || b.seen < minSeen;
  const pooled = a.seen + b.seen ? (a.converted + b.converted) / (a.seen + b.seen) : 0;
  const se = Math.sqrt(pooled * (1 - pooled) * (1 / Math.max(a.seen, 1) + 1 / Math.max(b.seen, 1)));
  const z = se > 0 ? (rateB - rateA) / se : 0;
  const confidence = se > 0 ? 1 - 2 * (1 - phi(Math.abs(z))) : 0;
  const winner = !needMoreData && confidence >= 0.95 && rateA !== rateB ? (rateB > rateA ? "b" : "a") : null;
  return { rateA, rateB, lift, confidence, winner, needMoreData };
}
