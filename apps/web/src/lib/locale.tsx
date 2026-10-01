"use client";

import { createContext, useContext } from "react";
import { localePath, type Locale } from "@henine/shared";
import { getDictionary, type Dictionary } from "./dictionary";

const LocaleContext = createContext<Locale>("fr");

export function LocaleProvider({ locale, children }: { locale: Locale; children: React.ReactNode }) {
  return <LocaleContext.Provider value={locale}>{children}</LocaleContext.Provider>;
}

export function useLocale(): { locale: Locale; t: Dictionary; href: (path: string) => string; ar: boolean } {
  const locale = useContext(LocaleContext);
  return { locale, t: getDictionary(locale), href: (p) => localePath(locale, p), ar: locale === "ar" };
}

/** Picks the Arabic or French variant of a bilingual field. */
export function useL() {
  const { ar } = useLocale();
  return (fr: string | null | undefined, arText: string | null | undefined) => (ar ? arText || fr : fr || arText) ?? "";
}
