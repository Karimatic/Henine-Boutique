import { useEffect, useState } from "react";
import type { Locale } from "@henine/shared";
import { GlobeIcon } from "@/components/ui/icons";
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

/**
 * One small button with a globe and the other language ("FR" on the Arabic site, "عربي" on the
 * French one), like the header's other icons: one tap opens the same page in that language.
 */
export function LanguageSwitch({ className = "", tone = "light" }: { className?: string; tone?: "light" | "dark" }) {
  const { locale } = useLocale();
  const other = locale === "ar" ? "fr" : "ar";
  const href = useLocaleHref(other);
  const look =
    tone === "dark"
      ? "border-white/25 text-white hover:border-white/60 hover:bg-white/10"
      : "border-line text-ink hover:border-plum-600/50 hover:bg-rose-100/60";
  return (
    <a
      href={href}
      hrefLang={other}
      lang={other}
      aria-label={other === "ar" ? "العربية" : "Français"}
      className={`inline-flex h-9 items-center gap-1.5 rounded-full border px-3 text-[13px] font-semibold leading-none transition ${look} ${className}`}
    >
      <GlobeIcon size={16} />
      {other === "ar" ? (
        <span className="-translate-y-px" style={{ fontFamily: "system-ui, 'Segoe UI', Tahoma, sans-serif" }}>
          عربي
        </span>
      ) : (
        <span className="tracking-wider">FR</span>
      )}
    </a>
  );
}
