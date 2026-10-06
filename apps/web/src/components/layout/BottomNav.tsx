import { useEffect, useState } from "react";
import { BagIcon, GridIcon, HeartIcon, HomeIcon, PackageIcon } from "@/components/ui/icons";
import { useLocale } from "@/lib/locale";
import { useActiveOrder } from "@/lib/activeOrder";
import { cartCount, useCart } from "@/lib/stores";

/** Mobile thumb-zone navigation. Hidden from md up. */
export function BottomNav() {
  const { t, href } = useLocale();
  const count = cartCount(useCart());
  const order = useActiveOrder();
  const [path, setPath] = useState("");
  const [hidden, setHidden] = useState(false);
  useEffect(() => setPath(location.pathname.replace(/^\/fr(?=\/|$)/, "") || "/"), []);
  // tucked away while scrolling down (more room for the page), back when scrolling up,
  // near the top or at the end of the page
  useEffect(() => {
    let last = window.scrollY;
    const onScroll = () => {
      const y = window.scrollY;
      const atEnd = y + window.innerHeight >= document.documentElement.scrollHeight - 40;
      if (y < 80 || atEnd || y < last - 8) setHidden(false);
      else if (y > last + 8) setHidden(true);
      if (Math.abs(y - last) > 8) last = y;
    };
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);
  useEffect(() => {
    if (hidden) document.documentElement.dataset.nav = "hidden";
    else delete document.documentElement.dataset.nav;
  }, [hidden]);

  const items = [
    { to: "/", label: t.nav.home, Icon: HomeIcon, match: (p: string) => p === "/" },
    { to: "/categories", label: t.nav.categories, Icon: GridIcon, match: (p: string) => p.startsWith("/categories") || p.startsWith("/c/") },
    // an order on its way: the tab opens it directly and shows a dot
    { to: order ? order.link : "/suivi", label: t.nav.track, Icon: PackageIcon, match: (p: string) => p.startsWith("/suivi") },
    { to: "/favoris", label: t.nav.favorites, Icon: HeartIcon, match: (p: string) => p.startsWith("/favoris") },
    { to: "/panier", label: t.nav.cart, Icon: BagIcon, match: (p: string) => p.startsWith("/panier") || p.startsWith("/commande") },
  ];
  return (
    <nav
      aria-label="Navigation"
      className={`fixed inset-x-0 bottom-0 z-40 border-t border-line/80 bg-surface/95 pb-[env(safe-area-inset-bottom)] shadow-[0_-6px_24px_rgb(23_10_16/0.06)] backdrop-blur transition-transform duration-300 md:hidden ${hidden ? "translate-y-full" : ""}`}
    >
      <ul className="grid grid-cols-5">
        {items.map(({ to, label, Icon, match }) => {
          const active = path !== "" && match(path);
          return (
            <li key={to}>
              <a
                href={href(to)}
                aria-current={active ? "page" : undefined}
                className={`relative flex h-16 flex-col items-center justify-center gap-1 text-[11px] font-medium transition ${active ? "text-ink" : "text-ink-soft"}`}
              >
                <span className={`grid h-7 w-12 place-items-center rounded-full transition ${active ? "bg-ink text-on-ink" : ""}`}>
                  <Icon size={20} />
                </span>
                {label}
                {label === t.nav.track && order && (
                  <span className="absolute top-1.5 size-2.5 rounded-full bg-rose-500 ring-2 ring-white ms-7" aria-label={t.status[order.status]} />
                )}
                {to === "/panier" && count > 0 && (
                  <span className="absolute top-1 grid min-w-5 place-items-center rounded-full bg-rose-500 px-1 text-[10px] font-bold leading-5 text-white ring-2 ring-white ms-8">
                    {count}
                  </span>
                )}
              </a>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
