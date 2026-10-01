export const LOCALES = ["fr", "ar"] as const;
export type Locale = (typeof LOCALES)[number];
/** Arabic is the main language (served at /); French lives under /fr. */
export const DEFAULT_LOCALE: Locale = "ar";

export function dirOf(locale: Locale): "ltr" | "rtl" {
  return locale === "ar" ? "rtl" : "ltr";
}

/**
 * Date formatting locale. Numbers always use Western digits (0-9), as on Algerian
 * receipts and phones, also in Arabic.
 */
export function dateLocale(locale: Locale): string {
  return locale === "ar" ? "ar-DZ-u-nu-latn" : "fr-DZ";
}

/** Arabic lives at the root, French under /fr. `path` must start with "/". */
export function localePath(locale: Locale, path: string): string {
  if (locale === DEFAULT_LOCALE) return path;
  return path === "/" ? `/${locale}` : `/${locale}${path}`;
}

export function isLocale(value: string): value is Locale {
  return (LOCALES as readonly string[]).includes(value);
}

/** Pick the right translation from a bilingual record, falling back to French. */
export function pick<T extends Record<string, unknown>>(
  row: T,
  field: string,
  locale: Locale,
): string {
  const v = row[`${field}_${locale}`] ?? row[`${field}_fr`];
  return typeof v === "string" ? v : "";
}
