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

/** Both languages side by side ("ع | Fr"): the current one filled, the other a link. */
export function LanguageSwitch({ className = "" }: { className?: string }) {
  const { locale } = useLocale();
  const other = locale === "ar" ? "fr" : "ar";
  const href = useLocaleHref(other);
  const options = [
    { code: "ar" as const, label: "ع", name: "العربية" },
    { code: "fr" as const, label: "Fr", name: "Français" },
  ];
  return (
    <span dir="ltr" className={`relative inline-grid h-9 grid-cols-2 items-center rounded-full border border-line bg-white p-0.5 text-sm font-bold ${className}`}>
      {/* sliding pill under the current language */}
      <span
        aria-hidden="true"
        className={`absolute inset-y-0.5 w-[calc(50%-2px)] rounded-full bg-ink transition-transform duration-300 ${locale === "ar" ? "translate-x-0.5" : "translate-x-[calc(100%+2px)]"}`}
      />
      {options.map((o) =>
        o.code === locale ? (
          <span key={o.code} aria-current="true" className="relative z-10 grid h-8 min-w-8 place-items-center px-2 text-white">
            {o.label}
          </span>
        ) : (
          <a key={o.code} href={href} hrefLang={o.code} lang={o.code} aria-label={o.name} className="relative z-10 grid h-8 min-w-8 place-items-center px-2 text-ink-soft transition hover:text-ink">
            {o.label}
          </a>
        ),
      )}
    </span>
  );
}
