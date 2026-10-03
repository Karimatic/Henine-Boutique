"use client";

import { isNewArrival, type ProductCardDTO } from "@henine/shared";
import { useLocale } from "@/lib/locale";

const TONE: Record<string, string> = {
  bestseller: "bg-plum-700 text-white",
  trending: "bg-rose-700 text-white",
  popular: "bg-ivory/90 text-plum-700",
  new: "bg-ivory/90 text-plum-700",
  pick: "bg-gold/90 text-white",
};

/**
 * At most two badges, all backed by data: sales badges come from real orders (see
 * BADGE_RULES), "new" from the publication date, "coup de cœur" is the team's own pick.
 */
export function productBadges(p: Pick<ProductCardDTO, "badge" | "createdAt" | "tags">): string[] {
  const out: string[] = [];
  if (p.badge) out.push(p.badge);
  if (isNewArrival(p.createdAt) || p.tags.includes("nouveaute")) out.push("new");
  if (p.tags.includes("best-seller")) out.push("pick");
  return out.slice(0, 2);
}

export function Badges({ p, className = "" }: { p: Pick<ProductCardDTO, "badge" | "createdAt" | "tags">; className?: string }) {
  const { t } = useLocale();
  const list = productBadges(p);
  if (!list.length) return null;
  return (
    <span className={`flex flex-wrap gap-1 ${className}`}>
      {list.map((b) => (
        <span key={b} className={`rounded-full px-2 py-0.5 text-[11px] font-semibold shadow-sm backdrop-blur ${TONE[b]}`}>
          {t.badges[b]}
        </span>
      ))}
    </span>
  );
}
