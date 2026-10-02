"use client";

import { useEffect, useMemo, useState } from "react";
import { formatDA, normalizeSearch, type CategoryDTO, type ProductCardDTO, type SiteConfigDTO } from "@henine/shared";
import { CheckoutForm } from "@/components/checkout/CheckoutForm";
import { CategoryCard } from "@/components/product/CategoryCard";
import { ProductGrid, ProductGridSkeleton } from "@/components/product/ProductCard";
import { SearchIcon } from "@/components/ui/icons";
import { ErrorBox, inputCls, PageTitle, ProductImage } from "@/components/ui/kit";
import { slugFromPath, useApi } from "@/lib/api";
import { useLocale } from "@/lib/locale";
import { cart, cartCount, useCart, useFavorites } from "@/lib/stores";

/* ───────── Cart ───────── */

export function CartView() {
  const { t, href, ar, locale } = useLocale();
  const items = useCart();
  const [ready, setReady] = useState(false);
  useEffect(() => setReady(true), []);
  const subtotal = items.reduce((s, i) => s + i.price * i.qty, 0);
  const site = useApi<SiteConfigDTO>("/site");
  const freeOver = site.data?.checkout.freeShippingOver ?? null;

  if (!ready) return <div className="mx-auto max-w-3xl px-4 py-8"><div className="skeleton h-40 rounded-card" /></div>;
  return (
    <div className="mx-auto max-w-3xl px-4 py-8">
      <PageTitle>{t.cart.title}</PageTitle>
      {items.length === 0 ? (
        <div className="rounded-card border border-line bg-white/60 p-8 text-center">
          <p className="text-ink-soft">{t.cart.empty}</p>
          <a href={href("/")} className="mt-5 inline-flex h-12 items-center rounded-full bg-plum-600 px-6 font-semibold text-ivory">
            {t.cart.continue}
          </a>
        </div>
      ) : (
        <>
          {/* free delivery: how far she is from it */}
          {freeOver != null && freeOver > 0 && (
            <div className="mb-4 rounded-2xl bg-ivory-deep p-4">
              <p className="text-sm font-semibold">
                {subtotal >= freeOver ? t.freeShip.done : t.freeShip.left(formatDA(freeOver - subtotal, locale))}
              </p>
              <span className="mt-2.5 block h-2 overflow-hidden rounded-full bg-white">
                <span
                  className="block h-full rounded-full bg-gradient-to-r from-rose-500 to-plum-600 transition-[width] duration-700 rtl:bg-gradient-to-l"
                  style={{ width: `${Math.min(100, Math.round((subtotal / freeOver) * 100))}%` }}
                />
              </span>
            </div>
          )}
          <ul className="divide-y divide-line rounded-card border border-line bg-white">
            {items.map((i) => (
              <li key={i.variantId} className="flex gap-3 p-3">
                <a href={href(`/produit/${i.slug}`)} className="shrink-0">
                  <ProductImage image={i.image} alt="" color={i.color} className="aspect-[4/5] w-20 rounded-lg" />
                </a>
                <div className="flex min-w-0 flex-1 flex-col">
                  <a href={href(`/produit/${i.slug}`)} className="line-clamp-1 font-medium">{ar ? i.nameAr : i.nameFr}</a>
                  <p className="text-sm text-ink-soft">{ar ? i.optionsAr : i.optionsFr}</p>
                  <p className="mt-auto text-sm font-semibold" dir="ltr">{formatDA(i.price * i.qty, locale)}</p>
                </div>
                <div className="flex flex-col items-end justify-between">
                  <button type="button" onClick={() => cart.remove(i.variantId)} className="text-xs text-ink-soft underline">
                    {t.cart.remove}
                  </button>
                  <div className="flex items-center rounded-full border border-line" aria-label={t.cart.qty}>
                    <button type="button" className="grid size-9 place-items-center text-lg" onClick={() => cart.setQty(i.variantId, i.qty - 1)} aria-label="−">−</button>
                    <span className="w-6 text-center text-sm font-semibold">{i.qty}</span>
                    <button type="button" className="grid size-9 place-items-center text-lg" onClick={() => cart.setQty(i.variantId, i.qty + 1)} aria-label="+">+</button>
                  </div>
                </div>
              </li>
            ))}
          </ul>
          <div className="mt-5 flex items-center justify-between text-lg">
            <span>{t.cart.subtotal} ({cartCount(items)})</span>
            <span className="font-semibold" dir="ltr">{formatDA(subtotal, locale)}</span>
          </div>
          <a href={href("/commande")} className="lift mt-5 grid h-13 place-items-center rounded-full bg-plum-600 font-semibold text-white">
            {t.cart.checkout}
          </a>
          <a href={href("/")} className="mt-3 block text-center text-sm font-semibold text-plum-600">
            {t.cart.continue}
          </a>
        </>
      )}
    </div>
  );
}

/* ───────── Checkout ───────── */

export function CheckoutView() {
  const { t, href } = useLocale();
  const items = useCart();
  const [ready, setReady] = useState(false);
  useEffect(() => setReady(true), []);
  const lines = useMemo(() => items.map((i) => ({ variantId: i.variantId, qty: i.qty })), [items]);
  if (!ready) return <div className="mx-auto max-w-5xl px-4 py-8"><div className="skeleton h-96 rounded-card" /></div>;
  if (!items.length) {
    return (
      <div className="mx-auto max-w-md px-4 py-16 text-center">
        <p className="text-ink-soft">{t.cart.empty}</p>
        <a href={href("/")} className="mt-5 inline-flex h-12 items-center rounded-full bg-plum-600 px-6 font-semibold text-ivory">{t.cart.continue}</a>
      </div>
    );
  }
  return (
    <div className="mx-auto max-w-5xl px-4 py-8">
      <PageTitle>{t.checkout.title}</PageTitle>
      <CheckoutForm lines={lines} channel="web" />
    </div>
  );
}

/* ───────── Categories ───────── */

export function CategoriesView() {
  const { t, href, ar } = useLocale();
  const { data, error, reload } = useApi<CategoryDTO[]>("/categories");
  const catalog = useApi<ProductCardDTO[]>("/catalog");
  return (
    <div className="mx-auto max-w-6xl px-4 py-8">
      <PageTitle>{t.categories.all}</PageTitle>
      {error ? (
        <ErrorBox onRetry={reload} />
      ) : (
        <ul className="grid grid-cols-2 gap-3 md:grid-cols-3">
          {/* empty categories stay hidden (unless every one is empty) */}
          {(data ?? []).filter((c, _, all) => (c.productCount ?? 0) > 0 || all.every((x) => !x.productCount)).map((c) => {
            const sample = catalog.data?.find((p) => p.categorySlug === c.slug);
            return (
              <li key={c.id}>
                <CategoryCard c={c} sample={sample} />
              </li>
            );
          })}
          {!data && [0, 1, 2].map((i) => <li key={i} className="skeleton aspect-[4/6] rounded-3xl" />)}
        </ul>
      )}
    </div>
  );
}

type Sort = "new" | "price_asc" | "price_desc";

export function CategoryView() {
  const { t, ar } = useLocale();
  const [slug, setSlug] = useState<string | null>(null);
  useEffect(() => setSlug(slugFromPath(location.pathname)), []);
  const categories = useApi<CategoryDTO[]>("/categories");
  const catalog = useApi<ProductCardDTO[]>("/catalog");
  const [sort, setSort] = useState<Sort>("new");
  const [inStockOnly, setInStockOnly] = useState(false);
  const category = categories.data?.find((c) => c.slug === slug);
  const products = useMemo(() => {
    let list = (catalog.data ?? []).filter((p) => p.categorySlug === slug);
    if (inStockOnly) list = list.filter((p) => p.inStock);
    return [...list].sort((a, b) => (sort === "price_asc" ? a.price - b.price : sort === "price_desc" ? b.price - a.price : b.createdAt - a.createdAt));
  }, [catalog.data, slug, sort, inStockOnly]);
  useEffect(() => {
    if (category) document.title = `${ar ? category.nameAr : category.nameFr} · Henine Boutique`;
  }, [category, ar]);

  return (
    <div className="mx-auto max-w-6xl px-4 py-8">
      <PageTitle>{category ? (ar ? category.nameAr : category.nameFr) : <span className="skeleton inline-block h-9 w-40" />}</PageTitle>
      <div className="mb-5 flex flex-wrap items-center gap-2">
        {([["new", ar ? "الأحدث" : "Nouveautés"], ["price_asc", ar ? "السعر ↑" : "Prix ↑"], ["price_desc", ar ? "السعر ↓" : "Prix ↓"]] as [Sort, string][]).map(([k, label]) => (
          <button key={k} type="button" onClick={() => setSort(k)} className={`h-9 rounded-full border px-4 text-sm font-medium ${sort === k ? "border-plum-600 bg-plum-600 text-ivory" : "border-line bg-white"}`}>
            {label}
          </button>
        ))}
        <label className="ms-auto flex items-center gap-2 text-sm">
          <input type="checkbox" className="size-4 accent-plum-600" checked={inStockOnly} onChange={(e) => setInStockOnly(e.target.checked)} />
          {t.product.inStock}
        </label>
      </div>
      {catalog.error ? (
        <ErrorBox onRetry={catalog.reload} />
      ) : !catalog.data ? (
        <ProductGridSkeleton count={6} />
      ) : products.length ? (
        <ProductGrid products={products} />
      ) : (
        <p className="rounded-card border border-line bg-white/60 p-8 text-center text-ink-soft">{t.categories.empty}</p>
      )}
    </div>
  );
}

/* ───────── Favourites & search ───────── */

export function FavoritesView() {
  const { t } = useLocale();
  const favorites = useFavorites();
  const catalog = useApi<ProductCardDTO[]>("/catalog");
  const [ready, setReady] = useState(false);
  useEffect(() => setReady(true), []);
  const products = (catalog.data ?? []).filter((p) => favorites.includes(p.slug));
  return (
    <div className="mx-auto max-w-6xl px-4 py-8">
      <PageTitle>{t.favorites.title}</PageTitle>
      {!ready || !catalog.data ? (
        <ProductGridSkeleton count={2} />
      ) : products.length ? (
        <ProductGrid products={products} />
      ) : (
        <p className="rounded-card border border-line bg-white/60 p-8 text-center text-ink-soft">{t.favorites.empty}</p>
      )}
    </div>
  );
}

export function SearchView() {
  const { t } = useLocale();
  const catalog = useApi<ProductCardDTO[]>("/catalog");
  const [q, setQ] = useState("");
  useEffect(() => setQ(new URLSearchParams(location.search).get("q") ?? ""), []);
  const results = useMemo(() => {
    const needle = normalizeSearch(q);
    if (!needle) return catalog.data ?? [];
    const terms = needle.split(/\s+/);
    return (catalog.data ?? []).filter((p) => {
      const hay = normalizeSearch(`${p.nameFr} ${p.nameAr} ${p.categorySlug ?? ""} ${p.tags.join(" ")}`);
      return terms.every((term) => hay.includes(term));
    });
  }, [q, catalog.data]);
  return (
    <div className="mx-auto max-w-6xl px-4 py-8">
      <PageTitle>{t.search.title}</PageTitle>
      <div className="relative mb-6">
        <SearchIcon className="pointer-events-none absolute start-4 top-1/2 -translate-y-1/2 text-ink-soft" />
        <input
          autoFocus
          type="search"
          className={`${inputCls} ps-12`}
          placeholder={t.search.placeholder}
          value={q}
          onChange={(e) => {
            setQ(e.target.value);
            history.replaceState(null, "", e.target.value ? `?q=${encodeURIComponent(e.target.value)}` : location.pathname);
          }}
        />
      </div>
      {!catalog.data ? (
        <ProductGridSkeleton count={4} />
      ) : (
        <>
          <p className="mb-4 text-sm text-ink-soft">{results.length ? t.search.results(results.length) : t.search.none}</p>
          <ProductGrid products={results} />
        </>
      )}
    </div>
  );
}
