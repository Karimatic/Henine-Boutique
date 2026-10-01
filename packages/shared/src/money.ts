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
