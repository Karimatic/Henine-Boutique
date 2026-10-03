"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { formatDA, normalizeSearch, type CategoryDTO, type ProductCardDTO } from "@henine/shared";
import { openAssistant } from "@/components/layout/FloatingHelp";
import { ProductGrid, ProductGridSkeleton } from "@/components/product/ProductCard";
import { SearchIcon } from "@/components/ui/icons";
import { inputCls, PageTitle, ProductImage } from "@/components/ui/kit";
import { useApi } from "@/lib/api";
import { useLocale } from "@/lib/locale";
import { rememberSearch, searchesStore, useSearches } from "@/lib/stores";

/** Edit distance, capped (typo tolerance: "pyjma" → "pyjama"). */
function distance(a: string, b: string, max = 2): number {
  if (Math.abs(a.length - b.length) > max) return max + 1;
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    for (let j = 1; j <= b.length; j++) cur[j] = Math.min(prev[j]! + 1, cur[j - 1]! + 1, prev[j - 1]! + (a[i - 1] === b[j - 1] ? 0 : 1));
    prev = cur;
  }
  return prev[b.length]!;
}

/**
 * Instant search over the whole catalogue (already on the phone, nothing to wait for):
 * names in both languages, category, colour and size names, tags. Suggestions while typing,
 * recent searches, typo tolerance, and a helpful page when nothing matches.
 */
export function SearchView() {
  const { t, ar, href, locale } = useLocale();
  const S = t.plus.search;
  const catalog = useApi<ProductCardDTO[]>("/catalog");
  const categories = useApi<CategoryDTO[]>("/categories");
  const recent = useSearches();
  const [q, setQ] = useState("");
  const [focused, setFocused] = useState(false);
  const [ready, setReady] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    setQ(new URLSearchParams(location.search).get("q") ?? "");
    setReady(true);
  }, []);

  // the text each product is found by
  const index = useMemo(() => {
    const cat = new Map((categories.data ?? []).map((c) => [c.slug, `${c.nameFr} ${c.nameAr}`]));
    return (catalog.data ?? []).map((p) => ({
      p,
      hay: normalizeSearch(`${p.nameFr} ${p.nameAr} ${p.categorySlug ?? ""} ${cat.get(p.categorySlug ?? "") ?? ""} ${p.tags.join(" ")} ${p.labels.join(" ")}`),
    }));
  }, [catalog.data, categories.data]);
  const words = useMemo(() => [...new Set(index.flatMap((x) => x.hay.split(/\s+/)).filter((w) => w.length > 2))], [index]);

  const needle = normalizeSearch(q);
  const terms = needle.split(/\s+/).filter(Boolean);
  const results = useMemo(() => (terms.length ? index.filter((x) => terms.every((term) => x.hay.includes(term))).map((x) => x.p) : (catalog.data ?? [])), [index, needle]); // eslint-disable-line react-hooks/exhaustive-deps

  // typo: the closest real words ("pyjma" → "pyjama")
  const corrected = useMemo(() => {
    if (!terms.length || results.length) return null;
    const fixed = terms.map((term) => {
      if (words.some((w) => w.includes(term))) return term;
      const best = words.map((w) => [w, distance(term, w, term.length > 5 ? 2 : 1)] as const).filter(([, d]) => d <= (term.length > 5 ? 2 : 1)).sort((a, b) => a[1] - b[1])[0];
      return best?.[0] ?? null;
    });
    return fixed.every(Boolean) && fixed.join(" ") !== terms.join(" ") ? fixed.join(" ") : null;
  }, [needle, results.length, words]); // eslint-disable-line react-hooks/exhaustive-deps

  const matchingCategories = (categories.data ?? []).filter((c) => terms.length && terms.every((term) => normalizeSearch(`${c.nameFr} ${c.nameAr} ${c.slug}`).includes(term)));

  function update(value: string, remember = false) {
    setQ(value);
    history.replaceState(null, "", value ? `?q=${encodeURIComponent(value)}` : location.pathname);
    if (remember) rememberSearch(value);
  }
  // remember what she searched once she stops typing on something that found products
  useEffect(() => {
    if (needle.length < 2 || !results.length) return;
    const id = setTimeout(() => rememberSearch(q), 1500);
    return () => clearTimeout(id);
  }, [needle, results.length]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const out = (e: PointerEvent) => !box.current?.contains(e.target as Node) && setFocused(false);
    document.addEventListener("pointerdown", out);
    return () => document.removeEventListener("pointerdown", out);
  }, []);

  const showSuggest = focused && terms.length > 0 && (results.length > 0 || matchingCategories.length > 0);
  const newest = [...(catalog.data ?? [])].sort((a, b) => b.createdAt - a.createdAt).slice(0, 4);

  return (
    <div className="mx-auto max-w-6xl px-4 py-8">
      <PageTitle>{t.search.title}</PageTitle>
      <div ref={box} className="relative mb-4">
        <SearchIcon className="pointer-events-none absolute start-4 top-1/2 -translate-y-1/2 text-ink-soft" />
        <input
          autoFocus
          type="search"
          enterKeyHint="search"
          className={`${inputCls} h-13 ps-12 text-[16px]`}
          placeholder={t.search.placeholder}
          value={q}
          onFocus={() => setFocused(true)}
          onChange={(e) => update(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              rememberSearch(q);
              setFocused(false);
              (e.target as HTMLInputElement).blur();
            }
          }}
          role="combobox"
          aria-expanded={showSuggest}
          aria-controls="search-suggest"
          aria-autocomplete="list"
        />
        {showSuggest && (
          <div id="search-suggest" role="listbox" className="absolute inset-x-0 top-full z-20 mt-2 overflow-hidden rounded-2xl border border-line bg-white shadow-[0_18px_40px_-16px_rgb(23_10_16/0.35)]">
            <p className="px-4 pb-1 pt-3 text-xs font-semibold uppercase tracking-[0.12em] text-ink-soft">{S.suggestions}</p>
            <ul>
              {matchingCategories.slice(0, 2).map((c) => (
                <li key={c.id}>
                  <a href={href(`/c/${c.slug}`)} className="flex items-center gap-3 px-4 py-2.5 hover:bg-rose-100/50" role="option" aria-selected={false}>
                    <span className="grid size-10 place-items-center rounded-xl bg-rose-100 text-lg" aria-hidden="true">🗂️</span>
                    <span className="font-medium">{ar ? c.nameAr : c.nameFr}</span>
                    <span className="ms-auto text-xs text-ink-soft">{S.categories}</span>
                  </a>
                </li>
              ))}
              {results.slice(0, 5).map((p) => (
                <li key={p.id}>
                  <a href={href(`/produit/${p.slug}`)} onClick={() => rememberSearch(q)} className="flex items-center gap-3 px-4 py-2 hover:bg-rose-100/50" role="option" aria-selected={false}>
                    <ProductImage image={p.image} alt="" category={p.categorySlug} color={p.colors[0]} sizes="48px" className="aspect-[4/5] w-10 shrink-0 rounded-lg" />
                    <span className="min-w-0 flex-1 truncate">{ar ? p.nameAr : p.nameFr}</span>
                    <span className="shrink-0 text-sm font-semibold" dir="ltr">{formatDA(p.price, locale)}</span>
                  </a>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>

      {/* nothing typed yet: her last searches and the categories */}
      {ready && !terms.length && (
        <div className="mb-6 space-y-4">
          {recent.length > 0 && (
            <div>
              <div className="mb-2 flex items-center justify-between">
                <p className="text-sm font-semibold">{S.recent}</p>
                <button type="button" onClick={() => searchesStore.set([])} className="text-xs font-semibold text-ink-soft underline">
                  {S.clear}
                </button>
              </div>
              <div className="flex flex-wrap gap-2">
                {recent.map((r) => (
                  <button key={r} type="button" onClick={() => update(r)} className="inline-flex h-9 items-center gap-1.5 rounded-full border border-line bg-white px-3.5 text-sm">
                    <span aria-hidden="true" className="text-ink-soft">↺</span> {r}
                  </button>
                ))}
              </div>
            </div>
          )}
          {(categories.data ?? []).length > 0 && (
            <div className="flex flex-wrap gap-2">
              {(categories.data ?? []).filter((c) => (c.productCount ?? 0) > 0).map((c) => (
                <a key={c.id} href={href(`/c/${c.slug}`)} className="inline-flex h-9 items-center rounded-full bg-rose-100 px-4 text-sm font-semibold text-plum-700">
                  {ar ? c.nameAr : c.nameFr}
                </a>
              ))}
            </div>
          )}
        </div>
      )}

      {!catalog.data ? (
        <ProductGridSkeleton count={4} />
      ) : results.length ? (
        <>
          <p className="mb-4 text-sm text-ink-soft">{t.search.results(results.length)}</p>
          <ProductGrid products={results} />
        </>
      ) : (
        <div className="space-y-8">
          <div className="rounded-card border border-line bg-white p-6 text-center">
            <p className="text-3xl" aria-hidden="true">🔎</p>
            <p className="mt-2 text-lg font-semibold">{S.noneTitle(q.trim())}</p>
            <p className="mx-auto mt-1 max-w-md text-sm text-ink-soft">{S.noneText}</p>
            {corrected && (
              <p className="mt-4 text-sm">
                {S.didYouMean}{" "}
                <button type="button" onClick={() => update(corrected, true)} className="font-semibold text-plum-700 underline underline-offset-4">
                  {corrected}
                </button>{" "}
                ?
              </p>
            )}
            <div className="mt-5 flex flex-wrap justify-center gap-2">
              <button type="button" onClick={openAssistant} className="inline-flex h-11 items-center rounded-full bg-plum-600 px-5 text-sm font-semibold text-white">
                {S.askAssistant}
              </button>
              {(categories.data ?? []).filter((c) => (c.productCount ?? 0) > 0).map((c) => (
                <a key={c.id} href={href(`/c/${c.slug}`)} className="inline-flex h-11 items-center rounded-full border border-line px-4 text-sm font-semibold">
                  {ar ? c.nameAr : c.nameFr}
                </a>
              ))}
            </div>
          </div>
          {newest.length > 0 && (
            <section>
              <h2 className="heading-display mb-4 text-2xl">{S.popular}</h2>
              <ProductGrid products={newest} />
            </section>
          )}
        </div>
      )}
    </div>
  );
}
