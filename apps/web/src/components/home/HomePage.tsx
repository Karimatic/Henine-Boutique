"use client";

import type { CategoryDTO, ProductCardDTO, SiteConfigDTO } from "@henine/shared";
import { CategoryCard } from "@/components/product/CategoryCard";
import { ProductGrid, ProductGridSkeleton } from "@/components/product/ProductCard";
import { Blossom, PackageIcon } from "@/components/ui/icons";
import { ErrorBox, ProductImage } from "@/components/ui/kit";
import { useApi } from "@/lib/api";
import { useLocale } from "@/lib/locale";
import { useStoreTexts } from "@/lib/storeTexts";
import { DropBanner } from "@/components/views/DropViews";
import { AnimatedTagline } from "./AnimatedTagline";
import { Faq, HowToOrder, InstagramCard, Reveal } from "./Sections";

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
  const heroProduct = products.find((p) => p.image) ?? products.find((p) => p.tags.includes("best-seller")) ?? products[0];

  return (
    <>
      {/* Hero: the brand promise, animated, at the very top. Centred on phones. */}
      <section className="relative overflow-hidden">
        <div aria-hidden="true" className="pointer-events-none absolute -end-24 -top-24 size-[28rem] rounded-full bg-rose-100/70 blur-3xl md:size-[40rem]" />
        <div className="relative mx-auto grid max-w-6xl gap-8 px-4 pb-10 pt-8 md:grid-cols-[1.15fr_1fr] md:items-center md:pb-16 md:pt-14">
          <div className="flex flex-col items-center text-center md:items-start md:text-start">
            <p className="mb-3 text-sm font-semibold uppercase tracking-[0.18em] text-rose-700">{eyebrow}</p>
            <AnimatedTagline key={title} text={title} className="text-[2.35rem] leading-[1.12] text-ink md:text-6xl" />
            <p className="mt-4 max-w-md text-lg leading-relaxed text-ink-soft">{subtitle}</p>
            <div className="mt-7 flex w-full flex-col items-center gap-3 sm:w-auto sm:flex-row md:items-start">
              <a href="#nouveautes" className="inline-flex h-12 w-full max-w-xs items-center justify-center rounded-full bg-plum-600 px-7 font-semibold text-ivory shadow-soft transition hover:bg-plum-700 active:scale-[0.98] sm:w-auto">
                {t.hero.cta}
              </a>
              <a href={href("/suivi")} className="inline-flex h-12 w-full max-w-xs items-center justify-center rounded-full border border-ink/15 bg-ivory/60 px-6 font-semibold hover:border-plum-600 sm:w-auto">
                {t.hero.secondary}
              </a>
            </div>
          </div>
          <a
            href={heroProduct ? href(`/produit/${heroProduct.slug}`) : "#nouveautes"}
            className="relative mx-auto block aspect-[4/5] w-full max-w-[20rem] overflow-hidden rounded-[2rem] shadow-soft ring-1 ring-line md:max-w-sm"
          >
            {heroProduct ? (
              <ProductImage
                image={heroProduct.image}
                alt={ar ? heroProduct.nameAr : heroProduct.nameFr}
                category={heroProduct.categorySlug}
                color={heroProduct.colors[0]}
                priority
                sizes="(min-width: 768px) 24rem, 80vw"
                className="absolute inset-0"
              />
            ) : (
              <div className="absolute inset-0 grid place-items-center bg-gradient-to-br from-rose-300/60 via-rose-100 to-ivory-deep">
                <Blossom size={110} className="opacity-80" />
              </div>
            )}
            {heroProduct && (
              <span className="absolute inset-x-3 bottom-3 rounded-2xl bg-ivory/90 px-4 py-3 text-center text-sm font-semibold text-ink backdrop-blur">
                {ar ? heroProduct.nameAr : heroProduct.nameFr}
              </span>
            )}
          </a>
        </div>
      </section>

      {site.data?.drop && <DropBanner drop={site.data.drop} />}

      {/* Categories */}
      <section id="univers" className="mx-auto max-w-6xl scroll-mt-24 px-4 py-8">
        <div className="mb-5 flex items-end justify-between">
          <h2 className="heading-display text-3xl md:text-4xl">{t.categories.title}</h2>
          <a href={href("/categories")} className="text-sm font-semibold text-plum-600">{t.home.seeAll}</a>
        </div>
        <ul className="grid grid-cols-2 gap-3 md:grid-cols-3 md:gap-5">
          {categories.data
            ? categories.data.slice(0, 3).map((c, i) => (
                <li key={c.id} className={i === 0 ? "col-span-2 md:col-span-1" : ""}>
                  <Reveal delay={i * 90}>
                    <CategoryCard c={c} wide={i === 0} sample={products.find((p) => p.categorySlug === c.slug)} />
                  </Reveal>
                </li>
              ))
            : [0, 1, 2].map((i) => <li key={i} className={`skeleton rounded-3xl ${i === 0 ? "col-span-2 aspect-[16/11] md:col-span-1 md:aspect-[4/6]" : "aspect-[4/6]"}`} />)}
        </ul>
      </section>

      {/* New arrivals */}
      <section id="nouveautes" className="mx-auto max-w-6xl scroll-mt-24 px-4 py-8">
        <div className="mb-5 flex items-end justify-between">
          <h2 className="heading-display text-3xl md:text-4xl">{t.home.newArrivals}</h2>
          <a href={href("/nouveautes")} className="text-sm font-semibold text-plum-600">{t.home.seeAll}</a>
        </div>
        {catalog.error ? <ErrorBox onRetry={catalog.reload} /> : catalog.data ? <ProductGrid products={newest} /> : <ProductGridSkeleton count={4} />}
      </section>

      <HowToOrder />

      {favorites.length > 0 && (
        <section className="mx-auto max-w-6xl px-4 py-8">
          <h2 className="heading-display mb-5 text-3xl md:text-4xl">{selling.length ? t.home.bestSellers : t.badges.pick}</h2>

          <ProductGrid products={favorites} />
        </section>
      )}

      <InstagramCard />

      <Faq />

      {/* Order tracking teaser */}
      <section className="mx-auto max-w-6xl px-4 pb-14 pt-2">
        <Reveal>
          <div className="flex flex-col items-center gap-4 rounded-[1.5rem] bg-plum-700 p-6 text-center text-ivory md:flex-row md:justify-between md:p-10 md:text-start">
            <div className="flex flex-col items-center gap-4 md:flex-row md:items-start">
              <PackageIcon size={36} className="shrink-0 text-rose-300" />
              <div>
                <h2 className="heading-display text-2xl md:text-3xl">{t.track.title}</h2>
                <p className="mt-1 max-w-lg text-sm text-ivory/80">{t.track.text}</p>
              </div>
            </div>
            <a href={href("/suivi")} className="inline-flex h-12 items-center rounded-full bg-ivory px-6 font-semibold text-plum-700">
              {t.track.cta}
            </a>
          </div>
        </Reveal>
      </section>
    </>
  );
}
