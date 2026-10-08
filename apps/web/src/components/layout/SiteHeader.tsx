import { useEffect, useState } from "react";
import { BagIcon, Blossom, GridIcon, HeartIcon, PackageIcon, PinIcon, SearchIcon, SparkleIcon, TagIcon } from "@/components/ui/icons";
import { useLocale } from "@/lib/locale";
import { useDesign } from "@/lib/site";
import { cartCount, useCart, useFavorites } from "@/lib/stores";
import { LanguageSwitch } from "./LanguageSwitch";
import { SiteMenu } from "./SiteMenu";

export function SiteHeader() {
  const { t, href } = useLocale();
  const items = useCart();
  const favs = useFavorites();
  const count = cartCount(items);
  const logo = useDesign().logo;

  return (
    <header className="sticky top-0 z-40 border-b border-line/70 bg-ivory/90 backdrop-blur supports-[backdrop-filter]:bg-ivory/75">
      <div className="mx-auto flex h-14 max-w-6xl items-center justify-between gap-2 px-3 md:h-16 md:gap-3 md:px-4">
        <div className="flex min-w-0 items-center xl:shrink-0">
          <a href={href("/")} className="-my-2 flex min-w-0 items-center gap-1.5 overflow-hidden py-2" aria-label="Henine Boutique">
            {logo ? (
              // the shop's own logo (Admin → Page d'accueil → Apparence)
              <img src={logo} alt="Henine Boutique" className="h-9 w-auto max-w-[11rem] object-contain md:h-11" />
            ) : (
              <>
                {/* the smallest phones (< 360 px): no flower and a slightly smaller name, so it is never cut */}
                <Blossom size={22} className="animate-bloom shrink-0 max-[359px]:hidden" />
                <span className="brand-mark heading-display whitespace-nowrap text-[1.08rem] italic max-[359px]:text-[0.94rem] leading-none tracking-wide min-[400px]:text-xl sm:text-2xl" dir="ltr">
                  Henine Boutique
                </span>
              </>
            )}
          </a>
        </div>

        {/* computers: the menu sits in the header itself */}
        <TopNav inline />

        <div className="flex shrink-0 items-center gap-0.5">
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
      {/* phones, tablets and small laptops: the same menu, as a row under the header */}
      <TopNav />
    </header>
  );
}

/**
 * The quick menu under the header: shop, new arrivals, promotions, order tracking, the shop
 * in Dellys. Icon pills in a soft rail; the page you are on is a filled pill.
 */
function TopNav({ inline = false }: { inline?: boolean }) {
  const { t, href } = useLocale();
  const N = t.plus.topNav;
  const [path, setPath] = useState("");
  useEffect(() => setPath(location.pathname.replace(/^\/fr(?=\/|$)/, "") || "/"), []);
  const items: [string, string, typeof GridIcon, (p: string) => boolean][] = [
    ["/categories", N.shop, GridIcon, (p) => p.startsWith("/categories") || p.startsWith("/c/") || p.startsWith("/produit/")],
    ["/nouveautes", N.new, SparkleIcon, (p) => p.startsWith("/nouveautes")],
    ["/promotions", N.promos, TagIcon, (p) => p.startsWith("/promotions")],
    ["/suivi", N.orders, PackageIcon, (p) => p.startsWith("/suivi")],
    ["/boutique", N.store, PinIcon, (p) => p.startsWith("/boutique")],
  ];
  return (
    <nav aria-label={t.nav.shop} className={inline ? "hidden xl:block" : "border-t border-line/50 bg-ivory/60 xl:hidden"}>
      <ul className={inline ? "flex items-center gap-1 rounded-full bg-ivory-deep/70 p-1 ring-1 ring-line/70" : "swipe-row mx-auto flex max-w-6xl gap-2 overflow-x-auto px-3 py-2"}>
        {items.map(([to, label, Icon, active]) => {
          const on = path !== "" && active(path);
          const promo = to === "/promotions";
          return (
            <li key={to} className="shrink-0">
              <a
                href={href(to)}
                aria-current={on ? "page" : undefined}
                className={`flex h-9 items-center gap-1.5 rounded-full px-3.5 text-[13px] font-semibold transition ${
                  on
                    ? "bg-gradient-to-br from-plum-600 to-rose-500 text-white shadow-[0_6px_16px_-6px_rgb(142_16_72/0.7)]"
                    : inline
                      ? "text-ink-soft hover:bg-surface hover:text-ink"
                      : `bg-surface text-ink ring-1 ring-line hover:ring-plum-600/40 ${promo ? "text-rose-700" : ""}`
                }`}
              >
                {/* in the header line the words alone: the header keeps its width on big screens, and the French labels are long */}
                {!inline && <Icon size={16} className={on ? "text-white" : promo ? "text-rose-600" : "text-plum-600"} />}
                {label}
              </a>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
