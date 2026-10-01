"use client";

import { useEffect, useState } from "react";
import { BagIcon, GridIcon, HeartIcon, HomeIcon, PackageIcon } from "@/components/ui/icons";
import { useLocale } from "@/lib/locale";
import { cartCount, useCart } from "@/lib/stores";

/** Mobile thumb-zone navigation. Hidden from md up. */
export function BottomNav() {
  const { t, href } = useLocale();
  const count = cartCount(useCart());
  const [path, setPath] = useState("");
  useEffect(() => setPath(location.pathname.replace(/^\/fr(?=\/|$)/, "") || "/"), []);

  const items = [
    { to: "/", label: t.nav.home, Icon: HomeIcon, match: (p: string) => p === "/" },
    { to: "/categories", label: t.nav.categories, Icon: GridIcon, match: (p: string) => p.startsWith("/categories") || p.startsWith("/c/") },
    { to: "/suivi", label: t.nav.track, Icon: PackageIcon, match: (p: string) => p.startsWith("/suivi") },
    { to: "/favoris", label: t.nav.favorites, Icon: HeartIcon, match: (p: string) => p.startsWith("/favoris") },
    { to: "/panier", label: t.nav.cart, Icon: BagIcon, match: (p: string) => p.startsWith("/panier") || p.startsWith("/commande") },
  ];
  return (
    <nav aria-label="Navigation" className="fixed inset-x-0 bottom-0 z-40 border-t border-line bg-ivory/95 pb-[env(safe-area-inset-bottom)] backdrop-blur md:hidden">
      <ul className="grid grid-cols-5">
        {items.map(({ to, label, Icon, match }) => {
          const active = path !== "" && match(path);
          return (
            <li key={to}>
              <a
                href={href(to)}
                aria-current={active ? "page" : undefined}
                className={`relative flex h-16 flex-col items-center justify-center gap-1 text-[11px] font-medium ${active ? "text-plum-600" : "text-ink-soft"}`}
              >
                <Icon size={22} />
                {label}
                {to === "/panier" && count > 0 && (
                  <span className="absolute top-2 grid min-w-5 place-items-center rounded-full bg-plum-600 px-1 text-[10px] font-bold leading-5 text-ivory ms-6">
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
