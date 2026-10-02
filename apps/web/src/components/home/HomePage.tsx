"use client";

import type { CategoryDTO, ProductCardDTO, SiteConfigDTO } from "@henine/shared";
import { ProductGrid, ProductGridSkeleton } from "@/components/product/ProductCard";
import { ErrorBox } from "@/components/ui/kit";
import { useApi } from "@/lib/api";
import { useLocale } from "@/lib/locale";
import { useStoreTexts } from "@/lib/storeTexts";
import { DropBanner } from "@/components/views/DropViews";
import { AnimatedTagline } from "./AnimatedTagline";
import { Faq, SectionHead } from "./Sections";
import { ContestCard, Lookbook, PromiseBand, RecentlyViewed, ReviewWall, Stories } from "./Showcase";

/**
 * Home, phone first: the shop's stories, a big photo with the promise on it, the promises,
 * then the products; the Instagram lookbook, real reviews and the questions come after.
 */
export function HomePage() {
  const { t, href, ar } = useLocale();
  const site = useApi<SiteConfigDTO>("/site");
  const catalog = useApi<ProductCardDTO[]>("/catalog");
  const categories = useApi<CategoryDTO[]>("/categories");

  // built-in texts or the team's edits, always in the language of the page
  const { eyebrow, title, subtitle } = useStoreTexts();

  const products = catalog.data ?? [];
  const newest = [...products].sort((a, b) => b.createdAt - a.createdAt).slice(0, 8);
  // "Les plus demandées" only when real sales back it; otherwise the team's own picks
  const RANK = { bestseller: 0, trending: 1, popular: 2 } as const;
  const selling = products.filter((p) => p.badge).sort((a, b) => RANK[a.badge!] - RANK[b.badge!]).slice(0, 4);
  const picks = products.filter((p) => p.tags.includes("best-seller")).slice(0, 4);
  const favorites = selling.length ? selling : picks;
  const onSale = products.filter((p) => p.compareAtPrice != null && p.compareAtPrice > p.price).slice(0, 8);
  const heroProduct = products.find((p) => p.image && p.tags.includes("best-seller")) ?? products.find((p) => p.image);

  return (
    <>
      <div className="pt-3">
        <Stories categories={categories.data} products={products} />
      </div>

      {/* Hero: the shop's photo, the promise centred on it */}
      <section className="px-3 pt-3 md:px-4">
        <div className="relative mx-auto flex min-h-[58svh] max-w-6xl flex-col items-center justify-end overflow-hidden rounded-[1.75rem] bg-ink text-center md:min-h-[34rem] md:justify-center md:rounded-[2.25rem]">
          <img src="/ig/pyjamas-rayures.jpg" alt="" fetchPriority="high" className="hero-zoom-img absolute inset-0 size-full object-cover" />
          <div aria-hidden="true" className="absolute inset-0 bg-gradient-to-t from-ink/95 via-ink/45 to-ink/10 md:bg-ink/45" />
          <div className="relative flex w-full max-w-2xl flex-col items-center p-6 pb-8 text-white md:p-12">
            <p className="mb-4 inline-flex items-center gap-2 rounded-full border border-white/25 bg-white/10 px-3.5 py-1 text-xs font-semibold uppercase tracking-[0.16em] backdrop-blur">
              <span className="size-1.5 animate-pulse rounded-full bg-rose-300" aria-hidden="true" />
              {eyebrow}
            </p>
            <AnimatedTagline key={title} text={title} tone="light" className="text-[2.35rem] leading-[1.1] md:text-6xl" />
            <p className="mt-3 max-w-md text-base leading-relaxed text-white/85 md:text-lg">{subtitle}</p>
            <div className="mt-6 flex flex-col items-center gap-2">
              <a href="#nouveautes" className="lift inline-flex h-12 items-center justify-center rounded-full bg-white px-8 font-semibold text-ink">
                {t.hero.cta}
              </a>
              {heroProduct && (
                <a href={href(`/produit/${heroProduct.slug}`)} className="inline-flex h-10 items-center gap-1.5 text-sm font-semibold text-white/85 underline-offset-4 hover:underline">
                  {ar ? heroProduct.nameAr : heroProduct.nameFr}
                  <span aria-hidden="true" className="rtl:rotate-180">→</span>
                </a>
              )}
            </div>
          </div>
        </div>
      </section>

      <div className="py-4">
        <PromiseBand />
      </div>

      {site.data?.drop && <DropBanner drop={site.data.drop} />}

      {/* New arrivals: the products, right away */}
      <section id="nouveautes" className="mx-auto max-w-6xl scroll-mt-24 px-4 py-6">
        <SectionHead title={t.home.newArrivals} href={href("/nouveautes")} link={t.home.seeAll} />
        {catalog.error ? <ErrorBox onRetry={catalog.reload} /> : catalog.data ? <ProductGrid products={newest} /> : <ProductGridSkeleton count={4} />}
      </section>

      {onSale.length > 0 && (
        <section id="promos" className="mx-auto max-w-6xl scroll-mt-24 px-4 py-6">
          <SectionHead title={t.home.promos} />
          <ProductGrid products={onSale} />
        </section>
      )}

      {favorites.length > 0 && (
        <section className="mx-auto max-w-6xl px-4 py-6">
          <SectionHead title={(selling.length ? t.home.bestSellers : t.badges.pick) ?? t.home.bestSellers} />
          <ProductGrid products={favorites} />
        </section>
      )}

      <Lookbook />

      <ContestCard />

      <ReviewWall />

      <RecentlyViewed products={products} />

      <Faq />
    </>
  );
}
