"use client";

import type { CategoryDTO, ProductCardDTO, SiteConfigDTO } from "@henine/shared";
import { ProductGrid, ProductGridSkeleton } from "@/components/product/ProductCard";
import { Blossom } from "@/components/ui/icons";
import { ErrorBox, ProductImage } from "@/components/ui/kit";
import { useApi } from "@/lib/api";
import { useLocale } from "@/lib/locale";
import { useStoreTexts } from "@/lib/storeTexts";
import { DropBanner } from "@/components/views/DropViews";
import { AnimatedTagline } from "./AnimatedTagline";
import { CategoryChips, Faq, InstagramCard, SectionHead, TrustStrip } from "./Sections";

/**
 * Home, phone first: a big photo with the promise on it, the categories one swipe away and
 * the products right under; everything else (promises, Instagram, questions) comes after.
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
  // the hero shows a real photo as soon as one product has one (best-seller first)
  const heroProduct = products.find((p) => p.image && p.tags.includes("best-seller")) ?? products.find((p) => p.image);

  return (
    <>
      {/* Hero: full-width photo, the promise written on it */}
      <section className="px-3 pt-3 md:px-4 md:pt-5">
        <div className="relative mx-auto flex min-h-[56svh] max-w-6xl flex-col justify-end overflow-hidden rounded-[1.75rem] bg-ink md:min-h-[34rem] md:rounded-[2.25rem]">
          {heroProduct ? (
            <ProductImage
              image={heroProduct.image}
              alt=""
              priority
              sizes="(min-width: 1152px) 1152px, 100vw"
              className="hero-zoom absolute inset-0"
            />
          ) : (
            <div aria-hidden="true" className="hero-art hero-zoom absolute inset-0 overflow-hidden">
              <Blossom size={240} className="hero-petal absolute -end-20 -top-16 opacity-20" />
              <Blossom size={110} className="hero-petal absolute -start-8 top-16 opacity-20 [animation-delay:-5s]" />
              <Blossom size={56} className="hero-petal absolute end-28 top-8 opacity-25 [animation-delay:-9s]" />
            </div>
          )}
          <div aria-hidden="true" className="absolute inset-0 bg-gradient-to-t from-ink/90 via-ink/35 to-ink/0" />
          <div className="relative p-6 pb-7 text-white md:max-w-2xl md:p-12">
            <p className="mb-3 inline-flex items-center gap-2 rounded-full bg-white/15 px-3 py-1 text-xs font-semibold uppercase tracking-[0.16em] backdrop-blur">
              <span className="size-1.5 rounded-full bg-rose-300" aria-hidden="true" />
              {eyebrow}
            </p>
            <AnimatedTagline key={title} text={title} tone="light" className="text-[2.3rem] leading-[1.1] md:text-6xl" />
            <p className="mt-3 max-w-md text-base leading-relaxed text-white/80 md:text-lg">{subtitle}</p>
            <div className="mt-6 flex flex-wrap items-center gap-3">
              <a href="#nouveautes" className="lift inline-flex h-12 items-center justify-center rounded-full bg-white px-7 font-semibold text-ink">
                {t.hero.cta}
              </a>
              {heroProduct && (
                <a href={href(`/produit/${heroProduct.slug}`)} className="inline-flex h-12 items-center gap-2 rounded-full px-2 text-sm font-semibold text-white/90 underline-offset-4 hover:underline">
                  {ar ? heroProduct.nameAr : heroProduct.nameFr}
                  <span aria-hidden="true" className="rtl:rotate-180">→</span>
                </a>
              )}
            </div>
          </div>
        </div>
      </section>

      <div className="space-y-4 py-4">
        <CategoryChips categories={categories.data} products={products} />
        <TrustStrip />
      </div>

      {site.data?.drop && <DropBanner drop={site.data.drop} />}

      {/* New arrivals: the products, right away */}
      <section id="nouveautes" className="mx-auto max-w-6xl scroll-mt-24 px-4 py-6">
        <SectionHead title={t.home.newArrivals} href={href("/nouveautes")} link={t.home.seeAll} />
        {catalog.error ? <ErrorBox onRetry={catalog.reload} /> : catalog.data ? <ProductGrid products={newest} /> : <ProductGridSkeleton count={4} />}
      </section>

      {favorites.length > 0 && (
        <section className="mx-auto max-w-6xl px-4 py-6">
          <SectionHead title={(selling.length ? t.home.bestSellers : t.badges.pick) ?? t.home.bestSellers} />
          <ProductGrid products={favorites} />
        </section>
      )}

      <InstagramCard />

      <Faq />
    </>
  );
}
