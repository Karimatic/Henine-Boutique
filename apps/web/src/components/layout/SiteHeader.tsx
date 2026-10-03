"use client";

import { useEffect, useState } from "react";
import type { CategoryDTO } from "@henine/shared";
import { BagIcon, Blossom, HeartIcon, PackageIcon, SearchIcon } from "@/components/ui/icons";
import { useApi } from "@/lib/api";
import { useActiveOrder } from "@/lib/activeOrder";
import { useLocale } from "@/lib/locale";
import { useDesign } from "@/lib/site";
import { cartCount, useCart, useFavorites } from "@/lib/stores";
import { LanguageSwitch } from "./LanguageSwitch";
import { SiteMenu } from "./SiteMenu";

/** "📦 Ma commande : Expédiée" (computers; on phones the "Suivi" tab of the bottom bar shows it). */
function OrderPill() {
  const { t, href } = useLocale();
  const order = useActiveOrder();
  if (!order) return null;
  return (
    <a href={href(order.link)} className="hidden items-center gap-1.5 rounded-full bg-rose-100 px-3 py-1.5 text-xs font-semibold text-plum-700 md:flex">
      <PackageIcon size={15} />
      {t.status[order.status]}
    </a>
  );
}

export function SiteHeader() {
  const { t, href, ar } = useLocale();
  const items = useCart();
  const favs = useFavorites();
  const count = cartCount(items);
  const { data: categories } = useApi<CategoryDTO[]>("/categories");
  const logo = useDesign().logo;

  return (
    <header className="sticky top-0 z-40 border-b border-line/70 bg-ivory/90 backdrop-blur supports-[backdrop-filter]:bg-ivory/75">
      <div className="mx-auto flex h-14 max-w-6xl items-center justify-between gap-2 px-3 md:h-16 md:gap-3 md:px-4">
        <div className="flex min-w-0 items-center">
          <a href={href("/")} className="flex min-w-0 items-center gap-1.5 overflow-hidden" aria-label="Henine Boutique">
            {logo ? (
              // the shop's own logo (Admin → Page d'accueil → Apparence)
              <img src={logo} alt="Henine Boutique" className="h-9 w-auto max-w-[11rem] object-contain md:h-11" />
            ) : (
              <>
                <Blossom size={22} className="animate-bloom shrink-0" />
                <span className="brand-mark heading-display whitespace-nowrap text-[1.08rem] italic leading-none tracking-wide min-[400px]:text-xl sm:text-2xl" dir="ltr">
                  Henine Boutique
                </span>
              </>
            )}
          </a>
        </div>

        <nav aria-label={t.nav.categories} className="hidden items-center gap-7 text-sm font-medium md:flex">
          {(categories ?? []).map((c) => (
            <a key={c.id} href={href(`/c/${c.slug}`)} className="text-ink-soft transition hover:text-plum-700">
              {ar ? c.nameAr : c.nameFr}
            </a>
          ))}
        </nav>

        <div className="flex shrink-0 items-center gap-0.5">
          <OrderPill />
          <LanguageSwitch className="me-0.5" />
          {/* phones: search lives in the ☰ menu */}
          <a href={href("/recherche")} className="hidden size-11 place-items-center rounded-full hover:bg-rose-100 md:grid" aria-label={t.nav.search}>
            <SearchIcon />
          </a>
          <a href={href("/favoris")} className="relative hidden size-11 place-items-center rounded-full hover:bg-rose-100 md:grid" aria-label={t.nav.favorites}>
            <HeartIcon />
            {favs.length > 0 && <span className="absolute end-1.5 top-1.5 size-2 rounded-full bg-rose-500" />}
          </a>
          <a href={href("/panier")} className="relative grid size-11 place-items-center rounded-full hover:bg-rose-100" aria-label={`${t.nav.cart} (${count})`}>
            <BagIcon />
            {count > 0 && (
              <span className="absolute end-0.5 top-0.5 grid min-w-5 place-items-center rounded-full bg-plum-600 px-1 text-[11px] font-bold leading-5 text-white">
                {count}
              </span>
            )}
          </a>
          {/* ☰ in the very corner: far left in Arabic, far right in French */}
          <SiteMenu />
        </div>
      </div>
      <TopNav />
    </header>
  );
}

/** The text menu under the header: shop, new arrivals, order tracking, the shop in Dellys. */
function TopNav() {
  const { t, href } = useLocale();
  const N = t.plus.topNav;
  const [path, setPath] = useState("");
  useEffect(() => setPath(location.pathname.replace(/^\/fr(?=\/|$)/, "") || "/"), []);
  const items: [string, string, (p: string) => boolean][] = [
    ["/categories", N.shop, (p) => p.startsWith("/categories") || p.startsWith("/c/") || p.startsWith("/produit/")],
    ["/nouveautes", N.new, (p) => p.startsWith("/nouveautes")],
    ["/suivi", N.orders, (p) => p.startsWith("/suivi")],
    ["/boutique", N.store, (p) => p.startsWith("/boutique")],
  ];
  return (
    <nav aria-label={t.nav.shop} className="border-t border-line/60">
      <ul className="swipe-row mx-auto flex max-w-6xl gap-6 overflow-x-auto px-4 text-[13.5px] font-medium md:gap-8">
        {items.map(([to, label, active]) => {
          const on = path !== "" && active(path);
          return (
            <li key={to} className="shrink-0">
              <a
                href={href(to)}
                aria-current={on ? "page" : undefined}
                className={`relative block py-2.5 transition ${on ? "text-plum-700" : "text-ink-soft hover:text-ink"}`}
              >
                {label}
                {on && <span className="absolute inset-x-0 bottom-0 h-0.5 rounded-full bg-plum-600" aria-hidden="true" />}
              </a>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
