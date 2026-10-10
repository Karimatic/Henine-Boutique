/**
 * Marketing / Analyse: each section has a tab of its own, first in its group. It opens this
 * page, a shortcut card per other tab of the section (with what it is for), plus the pages that open from
 * inside them (Finance and Sources under Statistiques).
 */
import { hasPermission, type Permission } from "@henine/shared";
import { Link, useRouterState } from "@tanstack/react-router";
import { ChevronRight, MapPin, Wallet, type LucideIcon } from "lucide-react";
import { tr } from "../i18n";
import { INNER_PAGES, NAV, TAB_HINTS } from "../nav";
import { useMe } from "../Shell";
import { PageHeader } from "../ui";

/** pages opened from inside a tab that also get a card here */
const EXTRA: Record<string, { icon: LucideIcon; permission: Permission }> = {
  "/finance": { icon: Wallet, permission: "finance.view" },
  "/sources": { icon: MapPin, permission: "stats.view" },
};

export function SectionHub() {
  const me = useMe();
  const path = useRouterState({ select: (s) => s.location.pathname }).replace(/^\/admin/, "") || "/";
  // the section whose own tab this is (its first item)
  const group = NAV.find((g) => g.items[0]?.path === path);
  if (!group || !me.data) return null;
  const perms = me.data.permissions;
  const tabs = group.items
    .slice(1)
    .filter((i) => hasPermission(perms, i.permission))
    .map((i) => ({ path: i.path, label: i.label, icon: i.icon }));
  const inner = INNER_PAGES.filter((p) => EXTRA[p.path] && group.items.some((i) => i.path === p.parent) && hasPermission(perms, EXTRA[p.path]!.permission)).map((p) => ({
    path: p.path,
    label: p.label,
    icon: EXTRA[p.path]!.icon,
  }));
  return (
    <div>
      <PageHeader title={group.label} subtitle={tr("Tout ce qui se trouve dans cette rubrique, en un coup d'œil.")} />
      <ul className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
        {[...tabs, ...inner].map((t) => (
          <li key={t.path}>
            <Link
              to={t.path}
              className="flex h-full items-center gap-3 rounded-xl border border-line bg-surface p-4 transition hover:border-plum-600/50 hover:shadow-[0_8px_24px_-16px_rgb(106_12_54/0.5)]"
            >
              <span className="grid size-11 shrink-0 place-items-center rounded-xl bg-plum-600/10 text-plum-600">
                <t.icon className="size-5" />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block font-semibold">{t.label}</span>
                {TAB_HINTS[t.path] && <span className="mt-0.5 block text-sm text-ink-soft">{TAB_HINTS[t.path]}</span>}
              </span>
              <ChevronRight className="size-4 shrink-0 text-ink-soft rtl:rotate-180" />
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}
