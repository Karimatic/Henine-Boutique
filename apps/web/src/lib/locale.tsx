"use client";

import { createContext, useContext } from "react";
import { localePath, type Locale } from "@henine/shared";
import type { Dictionary } from "./i18n/fr";

const LocaleContext = createContext<{ locale: Locale; t: Dictionary } | null>(null);

/** Set once per language by its layout (see locale-ar.tsx / locale-fr.tsx). */
export function LocaleProvider({ locale, t, children }: { locale: Locale; t: Dictionary; children: React.ReactNode }) {
  return <LocaleContext.Provider value={{ locale, t }}>{children}</LocaleContext.Provider>;
}

export function useLocale(): { locale: Locale; t: Dictionary; href: (path: string) => string; ar: boolean } {
  const ctx = useContext(LocaleContext);
  if (!ctx) throw new Error("useLocale outside a LocaleProvider");
  const { locale, t } = ctx;
  return { locale, t, href: (p) => localePath(locale, p), ar: locale === "ar" };
}

/** Picks the Arabic or French variant of a bilingual field. */
export function useL() {
  const { ar } = useLocale();
  return (fr: string | null | undefined, arText: string | null | undefined) => (ar ? arText || fr : fr || arText) ?? "";
}
