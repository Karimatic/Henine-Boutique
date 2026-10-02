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

/** The Arabic letter sits low in its line box: nudge it up so it looks centred in the pill. */
function LangLabel({ code, label }: { code: "ar" | "fr"; label: string }) {
  return code === "ar" ? <span className="-translate-y-[2px] text-[15px]" style={{ fontFamily: "system-ui, 'Segoe UI', Tahoma, sans-serif" }}>{label}</span> : <span>{label}</span>;
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
    <span dir="ltr" className={`relative inline-grid h-9 grid-cols-2 items-center rounded-full border border-rose-300 bg-rose-100/60 p-0.5 text-sm font-bold ${className}`}>
      {/* sliding pill under the current language */}
      <span
        aria-hidden="true"
        className={`absolute inset-y-0.5 left-0 w-[calc(50%-2px)] rounded-full bg-gradient-to-br from-rose-500 to-plum-600 shadow-[0_2px_8px_-2px_rgb(224_72_127/0.6)] transition-transform duration-300 ${locale === "ar" ? "translate-x-0.5" : "translate-x-[calc(100%+2px)]"}`}
      />
      {options.map((o) =>
        o.code === locale ? (
          <span key={o.code} aria-current="true" className="relative z-10 flex h-8 min-w-8 items-center justify-center px-2 leading-none text-white">
            <LangLabel code={o.code} label={o.label} />
          </span>
        ) : (
          <a key={o.code} href={href} hrefLang={o.code} lang={o.code} aria-label={o.name} className="relative z-10 flex h-8 min-w-8 items-center justify-center px-2 leading-none text-plum-700 transition hover:text-rose-700">
            <LangLabel code={o.code} label={o.label} />
          </a>
        ),
      )}
    </span>
  );
}
