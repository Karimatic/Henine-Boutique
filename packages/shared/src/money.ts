import type { Locale } from "./i18n";

/** All amounts are integer Algerian dinars (DA). No decimals anywhere. */
export type DA = number;

const NBSP = " "; // narrow no-break space, used as thousands separator

// eslint-disable-next-line @typescript-eslint/no-unused-vars
export function formatDA(amount: DA, _locale: Locale = "ar"): string {
  const n = Math.round(amount);
  const sign = n < 0 ? "-" : "";
  const grouped = Math.abs(n)
    .toString()
    .replace(/\B(?=(\d{3})+(?!\d))/g, NBSP);
  // Same format in both languages (Western digits + "DA"), as on Algerian price tags and carrier receipts.
  return `${sign}${grouped} DA`;
}

export function percentOff(price: DA, compareAt: DA | null | undefined): number | null {
  if (!compareAt || compareAt <= price) return null;
  return Math.round(((compareAt - price) / compareAt) * 100);
}

/**
 * A follower count as shown on the home page: 89 345 → "+89K", 1 250 000 → "+1.2M",
 * 640 → "640" (rounded down: "+" means "at least").
 */
export function formatFollowers(n: number): string {
  if (n >= 1_000_000) return `+${(Math.floor(n / 100_000) / 10).toString()}M`;
  if (n >= 1_000) return `+${Math.floor(n / 1_000)}K`;
  return String(Math.max(0, Math.floor(n)));
}
