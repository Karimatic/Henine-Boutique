"use client";

import { useEffect, useState } from "react";
import type { Locale } from "@henine/shared";
import { useLocale } from "@/lib/locale";

/** URL of the current page in the given language (/produit/x ↔ /fr/produit/x), query string kept. */
export function useLocaleHref(target: Locale): string {
  const [href, setHref] = useState(target === "fr" ? "/fr" : "/");
  useEffect(() => {
    const path = location.pathname.replace(/^\/fr(?=\/|$)/, "") || "/";
    setHref((target === "fr" ? (path === "/" ? "/fr" : `/fr${path}`) : path) + location.search);
  }, [target]);
  return href;
}

/** Compact switch to the other language: "Fr" on Arabic pages, "ع" on French pages. */
export function LanguageSwitch({ className = "" }: { className?: string }) {
  const { locale } = useLocale();
  const other = locale === "ar" ? "fr" : "ar";
  const href = useLocaleHref(other);
  return (
    <a
      href={href}
      hrefLang={other}
      lang={other}
      aria-label={other === "ar" ? "العربية" : "Français"}
      className={`grid h-9 min-w-9 place-items-center rounded-full border border-line bg-white/70 px-2.5 text-sm font-bold text-plum-700 transition hover:border-plum-600 hover:bg-rose-100 ${className}`}
    >
      {other === "ar" ? "ع" : "Fr"}
    </a>
  );
}
