"use client";

import type { ProductCardDTO } from "@henine/shared";
import { HeartIcon } from "@/components/ui/icons";
import { Price, ProductImage, Stars } from "@/components/ui/kit";
import { useLocale } from "@/lib/locale";
import { FlashStock } from "@/components/home/HomeExtras";
import { Badges } from "./Badges";
import { QuickAddButton } from "./QuickAdd";
import { toggleFavorite, useFavorites } from "@/lib/stores";

export function ProductCard({ p, priority = false }: { p: ProductCardDTO; priority?: boolean }) {
  const { t, href, ar } = useLocale();
  const favorites = useFavorites();
  const fav = favorites.includes(p.slug);
  const name = ar ? p.nameAr : p.nameFr;

  return (
    <article className="group relative">
      {/* plain <a>: product pages are separate static shells (full navigation, cached at the edge) */}
      <a href={href(`/produit/${p.slug}`)} className="block">
        <div className="relative">
          <ProductImage image={p.image} alt={name} category={p.categorySlug} color={p.colors[0]} priority={priority} className="aspect-[4/5] rounded-card transition duration-300 group-hover:shadow-soft" />
          <div className="pointer-events-none absolute start-2 top-2 flex flex-col items-start gap-1">
            {p.flash && p.inStock && (
              <span className="rounded-full bg-gradient-to-r from-plum-600 to-rose-500 px-2 py-0.5 text-[11px] font-bold text-white shadow-sm" dir="ltr">
                ⚡ -{p.flash.percent}%
              </span>
            )}
            {p.inStock ? <Badges p={p} className="flex-col items-start" /> : <span className="rounded-full bg-noir/80 px-2 py-0.5 text-[11px] font-semibold text-white">{t.product.outOfStock}</span>}
          </div>
        </div>
        <div className="mt-2 space-y-1 px-0.5">
          <h3 className="line-clamp-1 text-[13.5px] font-medium text-ink">{name}</h3>
          <Price value={p.price} compareAt={p.compareAtPrice} className="text-sm" />
          {p.flash?.limit != null && p.inStock && <FlashStock flash={p.flash} compact />}
          <div className="flex items-center gap-2">
            {p.colors.length > 0 && (
              <span className="flex -space-x-1 rtl:space-x-reverse" aria-hidden="true">
                {p.colors.slice(0, 4).map((c) => (
                  <span key={c} className="size-3.5 rounded-full border border-white shadow-sm" style={{ background: c }} />
                ))}
              </span>
            )}
            {p.rating && (
              <span className="flex items-center gap-1 text-[11px] text-ink-soft">
                <Stars value={p.rating.avg} size={11} />({p.rating.count})
              </span>
            )}
          </div>
        </div>
      </a>
      <button
        type="button"
        onClick={() => toggleFavorite(p.slug)}
        aria-pressed={fav}
        aria-label={fav ? t.product.favoriteRemove : t.product.favoriteAdd}
        className={`absolute end-2 top-2 grid size-9 place-items-center rounded-full bg-ivory/90 shadow-sm backdrop-blur transition active:scale-90 ${fav ? "text-rose-700" : "text-ink-soft"}`}
      >
        <HeartIcon size={18} fill={fav ? "currentColor" : "none"} />
      </button>
      <div className="absolute inset-x-0 top-0 aspect-[4/5]" style={{ pointerEvents: "none" }}>
        <div style={{ pointerEvents: "auto" }}>
          <QuickAddButton p={p} />
        </div>
      </div>
    </article>
  );
}

export function ProductGridSkeleton({ count = 4 }: { count?: number }) {
  return (
    <ul className="grid grid-cols-2 gap-x-3 gap-y-6 md:grid-cols-3 lg:grid-cols-4" aria-busy="true">
      {Array.from({ length: count }, (_, i) => (
        <li key={i}>
          <div className="skeleton aspect-[4/5] rounded-card" />
          <div className="skeleton mt-2 h-4 w-3/4" />
          <div className="skeleton mt-1.5 h-4 w-1/3" />
        </li>
      ))}
    </ul>
  );
}

export function ProductGrid({ products }: { products: ProductCardDTO[] }) {
  return (
    <ul className="grid grid-cols-2 gap-x-3 gap-y-6 md:grid-cols-3 lg:grid-cols-4">
      {products.map((p, i) => (
        <li key={p.id}>
          <ProductCard p={p} priority={i < 2} />
        </li>
      ))}
    </ul>
  );
}
