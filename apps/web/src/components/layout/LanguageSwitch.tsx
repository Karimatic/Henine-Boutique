"use client";

import { useEffect, useState } from "react";
import { useLocale } from "@/lib/locale";

/** Switches language while staying on the same page (/produit/x ↔ /fr/produit/x). */
export function LanguageSwitch({ className = "" }: { className?: string }) {
  const { locale } = useLocale();
  const other = locale === "ar" ? "fr" : "ar";
  const [target, setTarget] = useState(other === "fr" ? "/fr" : "/");
  useEffect(() => {
    const path = location.pathname.replace(/^\/fr(?=\/|$)/, "") || "/";
    setTarget((other === "fr" ? (path === "/" ? "/fr" : `/fr${path}`) : path) + location.search);
  }, [other]);
  return (
    <a
      href={target}
      hrefLang={other}
      lang={other}
      className={`items-center rounded-full border border-line px-3 py-1.5 text-sm font-medium hover:border-plum-600 ${className}`}
    >
      {other === "ar" ? "العربية" : "Français"}
    </a>
  );
}
