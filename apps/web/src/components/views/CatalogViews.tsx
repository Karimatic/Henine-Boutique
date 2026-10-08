/**
 * The catalogue, organised: main categories with their sub-categories (current season first),
 * a category page with simple filters, and the Promotions page.
 */
import { useEffect, useMemo, useState } from "react";
import {
  categorySlugs,
  formatDA,
  mainCategories,
  parentOf,
  subCategories,
  type CategoryDTO,
  type ProductCardDTO,
} from "@henine/shared";
import { ProductGrid, ProductGridSkeleton } from "@/components/product/ProductCard";
import { ErrorBox, PageTitle, ProductImage } from "@/components/ui/kit";
import { slugFromPath, useApi } from "@/lib/api";
import { useLocale } from "@/lib/locale";
import { useSite } from "@/lib/site";

const onSale = (p: ProductCardDTO) => p.compareAtPrice != null && p.compareAtPrice > p.price;
const percentOff = (p: ProductCardDTO) => (onSale(p) ? Math.round((1 - p.price / p.compareAtPrice!) * 100) : 0);

/** A sub-category chip: its name, ☀️ / ❄️ for a seasonal one. */
function chipLabel(c: CategoryDTO, ar: boolean) {
  const name = ar ? c.nameAr : c.nameFr;
  return c.season ? `${c.season === "summer" ? "☀️" : "❄️"} ${name}` : name;
}

/* ───────── /categories: every main category, its sub-categories right under it ───────── */

export function CategoriesView() {
  const { t, ar, href } = useLocale();
  const { data, error, reload } = useApi<CategoryDTO[]>("/categories");
  const catalog = useApi<ProductCardDTO[]>("/catalog");
  const season = useSite().data?.season;
  const all = data ?? [];
  // empty categories stay hidden (unless every one is empty)
  const visible = (c: CategoryDTO) => (c.productCount ?? 0) > 0 || all.every((x) => !x.productCount);
  return (
    <div className="mx-auto max-w-6xl px-4 py-8">
      <PageTitle>{t.categories.all}</PageTitle>
      {error ? (
        <ErrorBox onRetry={reload} />
      ) : (
        <ul className="grid gap-3 md:grid-cols-2">
          {mainCategories(all)
            .filter(visible)
            .map((c) => {
              const subs = subCategories(all, c.id, season).filter(visible);
              const slugs = categorySlugs(all, c.slug);
              const sample = catalog.data?.find((p) => p.categorySlug && slugs.has(p.categorySlug));
              return (
                <li key={c.id} className="rounded-3xl border border-line bg-surface p-3">
                  {/* compact row: the picture and the name */}
                  <a href={href(`/c/${c.slug}`)} className="group flex items-center gap-3">
                    <ProductImage image={sample?.image ?? null} alt="" category={c.slug} color={sample?.colors[0]} sizes="96px" className="aspect-[4/5] w-20 shrink-0 rounded-2xl" />
                    <span className="min-w-0 flex-1">
                      <span className="heading-display block text-xl leading-snug">{ar ? c.nameAr : c.nameFr}</span>
                    </span>
                    <span aria-hidden="true" className="grid size-9 shrink-0 place-items-center rounded-full bg-ink text-on-ink transition group-hover:bg-plum-600 rtl:rotate-180">→</span>
                  </a>
                  {subs.length > 0 && (
                    <ul className="mt-3 flex flex-wrap gap-1.5 border-t border-line pt-3">
                      {subs.map((s) => (
                        <li key={s.id}>
                          <a
                            href={href(`/c/${s.slug}`)}
                            className={`inline-flex h-9 items-center gap-1.5 rounded-full border px-3 text-sm font-medium transition hover:border-plum-600/50 ${
                              s.season && s.season === season ? "border-plum-600/40 bg-rose-100 text-plum-700" : "border-line bg-surface"
                            }`}
                          >
                            {chipLabel(s, ar)}
                          </a>
                        </li>
                      ))}
                    </ul>
                  )}
                </li>
              );
            })}
          {!data && [0, 1, 2].map((i) => <li key={i} className="skeleton h-28 rounded-3xl" />)}
        </ul>
      )}
    </div>
  );
}

/* ───────── /c/<slug>: a category (with its sub-categories) and two filters: on sale, price ───────── */

type Price = "any" | "low" | "mid" | "high";
const LOW = 2000;
const HIGH = 4000;

export function CategoryView() {
  const { t, ar, href, locale } = useLocale();
  const F = t.categories.filters;
  const [slug, setSlug] = useState<string | null>(null);
  useEffect(() => setSlug(slugFromPath(location.pathname)), []);
  const categories = useApi<CategoryDTO[]>("/categories");
  const catalog = useApi<ProductCardDTO[]>("/catalog");
  const season = useSite().data?.season;
  const [price, setPrice] = useState<Price>("any");
  const [saleOnly, setSaleOnly] = useState(false);

  const all = categories.data ?? [];
  const category = all.find((c) => c.slug === slug);
  const parent = parentOf(all, category);
  const seasonal = new Set(all.filter((c) => c.season && c.season === season).map((c) => c.slug));

  const products = useMemo(() => {
    if (!slug) return [];
    const slugs = categorySlugs(all, slug);
    let list = (catalog.data ?? []).filter((p) => p.categorySlug && slugs.has(p.categorySlug));
    if (saleOnly) list = list.filter(onSale);
    if (price === "low") list = list.filter((p) => p.price < LOW);
    if (price === "mid") list = list.filter((p) => p.price >= LOW && p.price <= HIGH);
    if (price === "high") list = list.filter((p) => p.price > HIGH);
    // newest first, this season's pieces before the other season's
    const inSeason = (p: ProductCardDTO) => Number(seasonal.has(p.categorySlug ?? ""));
    return [...list].sort((a, b) => inSeason(b) - inSeason(a) || b.createdAt - a.createdAt);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [catalog.data, categories.data, slug, price, saleOnly, season]);

  useEffect(() => {
    if (category) document.title = `${ar ? category.nameAr : category.nameFr} · Henine Boutique`;
  }, [category, ar]);

  const money = (n: number) => formatDA(n, locale);
  const chip = (on: boolean) => `h-10 shrink-0 rounded-full border px-4 text-sm font-medium transition ${on ? "border-plum-600 bg-plum-600 text-white" : "border-line bg-surface hover:border-plum-600/40"}`;

  return (
    <div className="mx-auto max-w-6xl px-4 py-8">
      {/* where she is: Catégories › Lingerie › Ensembles */}
      <nav aria-label={t.categories.all} className="mb-2 text-sm text-ink-soft">
        <a href={href("/categories")} className="hover:text-plum-700">{t.categories.all}</a>
        {parent && (
          <>
            <span className="mx-1.5 rtl:rotate-180 inline-block" aria-hidden="true">›</span>
            <a href={href(`/c/${parent.slug}`)} className="hover:text-plum-700">{ar ? parent.nameAr : parent.nameFr}</a>
          </>
        )}
      </nav>
      <PageTitle>{category ? (ar ? category.nameAr : category.nameFr) : <span className="skeleton inline-block h-9 w-40" />}</PageTitle>

      {/* filters: on sale, price */}
      <div className="swipe-row -mx-4 mb-5 flex gap-2 overflow-x-auto px-4 pb-1" role="group" aria-label={F.price}>
        <button type="button" aria-pressed={saleOnly} onClick={() => setSaleOnly((v) => !v)} className={chip(saleOnly)}>
          🏷️ {F.onSale}
        </button>
        <span className="mx-1 w-px shrink-0 bg-line" aria-hidden="true" />
        {(
          [
            ["any", F.any],
            ["low", F.under(money(LOW))],
            ["mid", F.between(money(LOW), money(HIGH))],
            ["high", F.over(money(HIGH))],
          ] as [Price, string][]
        ).map(([k, label]) => (
          <button key={k} type="button" aria-pressed={price === k} onClick={() => setPrice(k)} className={chip(price === k)}>
            <span dir={k === "any" ? undefined : "auto"}>{label}</span>
          </button>
        ))}
      </div>

      {catalog.error ? (
        <ErrorBox onRetry={catalog.reload} />
      ) : !catalog.data ? (
        <ProductGridSkeleton count={6} />
      ) : products.length ? (
        <ProductGrid products={products} level={2} />
      ) : (
        <div className="rounded-card border border-line bg-surface p-8 text-center">
          <p className="text-ink-soft">{t.categories.empty}</p>
          <div className="mt-5 flex flex-wrap justify-center gap-2">
            <a href={href("/nouveautes")} className="inline-flex h-11 items-center rounded-full bg-ink px-5 text-sm font-semibold text-on-ink">
              {t.home.newArrivals}
            </a>
            <a href={href("/promotions")} className="inline-flex h-11 items-center rounded-full border border-line px-5 text-sm font-semibold">
              {t.promos.title}
            </a>
          </div>
        </div>
      )}
    </div>
  );
}

/* ───────── /promotions: everything on sale, biggest discount first ───────── */

export function PromotionsView() {
  const { t, ar, href } = useLocale();
  const P = t.promos;
  const catalog = useApi<ProductCardDTO[]>("/catalog");
  const categories = useApi<CategoryDTO[]>("/categories");
  const [main, setMain] = useState<string>("all");
  const all = categories.data ?? [];
  const sale = useMemo(() => (catalog.data ?? []).filter(onSale).sort((a, b) => percentOff(b) - percentOff(a)), [catalog.data]);
  // the main categories that have something on sale, to narrow down
  const groups = mainCategories(all).filter((c) => {
    const slugs = categorySlugs(all, c.slug);
    return sale.some((p) => p.categorySlug && slugs.has(p.categorySlug));
  });
  const shown = main === "all" ? sale : sale.filter((p) => p.categorySlug && categorySlugs(all, main).has(p.categorySlug));
  const best = sale[0] ? percentOff(sale[0]) : 0;
  const chip = (on: boolean) => `h-10 shrink-0 rounded-full border px-4 text-sm font-medium transition ${on ? "border-plum-600 bg-plum-600 text-white" : "border-line bg-surface"}`;

  return (
    <div className="mx-auto max-w-6xl px-4 py-8">
      <header className="mb-6 flex items-center gap-4 overflow-hidden rounded-[1.75rem] bg-gradient-to-br from-plum-700 via-plum-600 to-rose-500 p-6 text-white md:p-10">
        <div className="min-w-0 flex-1">
          <p className="text-xs font-semibold uppercase tracking-[0.2em] text-white/80">Henine Boutique</p>
          <h1 className="heading-display mt-1 text-4xl md:text-5xl">{P.title}</h1>
          <p className="mt-2 max-w-xl text-white/90">{P.text}</p>
        </div>
        {best > 0 && (
          <span className="grid size-20 shrink-0 place-items-center rounded-full bg-white text-xl font-black text-plum-700 shadow-lg md:size-28 md:text-3xl" dir="ltr">
            −{best}%
          </span>
        )}
      </header>
      {groups.length > 1 && (
        <div className="swipe-row -mx-4 mb-5 flex gap-2 overflow-x-auto px-4 pb-1">
          <button type="button" aria-pressed={main === "all"} onClick={() => setMain("all")} className={chip(main === "all")}>
            {t.categories.everything}
          </button>
          {groups.map((c) => (
            <button key={c.id} type="button" aria-pressed={main === c.slug} onClick={() => setMain(c.slug)} className={chip(main === c.slug)}>
              {ar ? c.nameAr : c.nameFr}
            </button>
          ))}
        </div>
      )}
      {catalog.error ? (
        <ErrorBox onRetry={catalog.reload} />
      ) : !catalog.data ? (
        <ProductGridSkeleton count={6} />
      ) : shown.length ? (
        <ProductGrid products={shown} level={2} />
      ) : (
        <div className="rounded-card border border-line bg-surface p-8 text-center">
          <p className="text-ink-soft">{P.empty}</p>
          <a href={href("/nouveautes")} className="mt-5 inline-flex h-11 items-center rounded-full bg-ink px-5 text-sm font-semibold text-on-ink">
            {t.home.newArrivals}
          </a>
        </div>
      )}
    </div>
  );
}
