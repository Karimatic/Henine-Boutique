import type { Permission } from "@henine/shared";
import { Link, useRouterState } from "@tanstack/react-router";
import { tr } from "../i18n";
import { useCan } from "../Shell";

/** The pages that open from inside one tab (Commandes → Préparation, Expéditions…). */
const SUB_PAGES: Record<string, { to: string; label: string; perm: Permission }[]> = {
  orders: [
    { to: "/commandes", label: tr("🛍️ Commandes"), perm: "orders.view" },
    { to: "/preparation", label: tr("📦 Préparation"), perm: "orders.ship" },
    { to: "/expeditions", label: tr("🚚 Expéditions"), perm: "orders.view" },
  ],
  analysis: [
    { to: "/statistiques", label: tr("📊 Statistiques"), perm: "stats.view" },
    { to: "/finance", label: tr("💰 Finance"), perm: "finance.view" },
  ],
  promos: [
    { to: "/promos", label: tr("🏷️ Codes promo"), perm: "promos.edit" },
    { to: "/collections", label: tr("✨ Collections"), perm: "marketing.edit" },
  ],
};

export function SubNav({ of }: { of: keyof typeof SUB_PAGES }) {
  const can = useCan();
  const path = useRouterState({ select: (s) => s.location.pathname }).replace(/^\/admin(?=\/|$)/, "");
  const items = SUB_PAGES[of]!.filter((i) => can(i.perm));
  if (items.length < 2) return null;
  return (
    <nav className="-mx-4 mb-4 overflow-x-auto px-4 md:mx-0 md:px-0" aria-label={tr("Pages")}>
      <div className="flex w-max gap-1.5 rounded-xl bg-ivory-deep p-1">
        {items.map((i) => {
          const on = path === i.to || path.startsWith(`${i.to}/`);
          return (
            <Link
              key={i.to}
              to={i.to}
              aria-current={on ? "page" : undefined}
              className={`flex h-9 items-center rounded-lg px-3.5 text-sm font-semibold whitespace-nowrap transition ${on ? "bg-surface text-plum-700 shadow-sm" : "text-ink-soft hover:text-ink"}`}
            >
              {i.label}
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
