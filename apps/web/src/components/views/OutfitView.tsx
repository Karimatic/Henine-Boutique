import { useEffect, useMemo, useState } from "react";
import { formatDA, type CategoryDTO, type ProductCardDTO, type ProductDetailDTO } from "@henine/shared";
import { ErrorBox, PageTitle, ProductImage } from "@/components/ui/kit";
import { useApi } from "@/lib/api";
import { useLocale } from "@/lib/locale";
import { cart } from "@/lib/stores";

type Chosen = { slug: string; variantId: number | null };

/**
 * "Composez votre tenue": one piece per category, its size and colour, a running total,
 * and the whole outfit into the cart in one tap. /tenue?p=<slug> starts from a product.
 */
export function OutfitView() {
  const { t, ar, href, locale } = useLocale();
  const O = t.plus.outfit;
  const catalog = useApi<ProductCardDTO[]>("/catalog");
  const categories = useApi<CategoryDTO[]>("/categories");
  const [picked, setPicked] = useState<Record<string, Chosen>>({});
  const [prices, setPrices] = useState<Record<string, number>>({});
  const [added, setAdded] = useState(false);

  // start from the product the customer came from
  useEffect(() => {
    const slug = new URLSearchParams(location.search).get("p");
    const p = slug && catalog.data?.find((x) => x.slug === slug);
    if (p) setPicked((cur) => (Object.keys(cur).length ? cur : { [p.categorySlug ?? "other"]: { slug: p.slug, variantId: null } }));
  }, [catalog.data]);

  const rows = useMemo(() => {
    const list = (catalog.data ?? []).filter((p) => p.inStock);
    return (categories.data ?? [])
      .map((c) => ({ c, products: list.filter((p) => p.categorySlug === c.slug) }))
      .filter((r) => r.products.length > 0);
  }, [catalog.data, categories.data]);

  const chosen = Object.entries(picked);
  const total = chosen.reduce((s, [, ch]) => s + (prices[ch.slug] ?? catalog.data?.find((p) => p.slug === ch.slug)?.price ?? 0), 0);
  const ready = chosen.length > 0 && chosen.every(([, ch]) => ch.variantId != null);

  return (
    <div className="mx-auto max-w-6xl px-4 py-8 pb-40">
      <PageTitle>{O.title}</PageTitle>
      <p className="-mt-3 mb-6 max-w-xl text-sm text-ink-soft">{O.intro}</p>
      {catalog.error ? (
        <ErrorBox onRetry={catalog.reload} />
      ) : !catalog.data ? (
        <div className="skeleton h-64 rounded-card" />
      ) : (
        <div className="space-y-8">
          {rows.map(({ c, products }) => {
            const cur = picked[c.slug];
            return (
              <section key={c.id}>
                <div className="mb-3 flex items-center justify-between">
                  <h2 className="heading-display text-2xl">{ar ? c.nameAr : c.nameFr}</h2>
                  {cur && (
                    <button
                      type="button"
                      onClick={() => setPicked(({ [c.slug]: _, ...rest }) => rest)}
                      className="text-sm font-semibold text-ink-soft underline"
                    >
                      {O.none}
                    </button>
                  )}
                </div>
                <ul className="swipe-row -mx-4 flex snap-x gap-3 overflow-x-auto px-4 pb-2">
                  {products.map((p) => {
                    const on = cur?.slug === p.slug;
                    return (
                      <li key={p.id} className="w-36 shrink-0 snap-start md:w-44">
                        <button
                          type="button"
                          aria-pressed={on}
                          onClick={() => setPicked((s) => ({ ...s, [c.slug]: { slug: p.slug, variantId: null } }))}
                          className={`block w-full overflow-hidden rounded-2xl border-2 bg-surface text-start transition ${on ? "border-plum-600 shadow-lift" : "border-transparent"}`}
                        >
                          <span className="relative block">
                            <ProductImage image={p.image} alt="" category={p.categorySlug} color={p.colors[0]} sizes="180px" className="aspect-[4/5] w-full" />
                            {on && <span className="absolute end-2 top-2 grid size-7 place-items-center rounded-full bg-plum-600 text-sm text-white">✓</span>}
                          </span>
                          <span className="block p-2">
                            <span className="line-clamp-1 text-sm font-medium">{ar ? p.nameAr : p.nameFr}</span>
                            <span className="text-sm font-semibold" dir="ltr">{formatDA(p.price, locale)}</span>
                          </span>
                        </button>
                      </li>
                    );
                  })}
                </ul>
              </section>
            );
          })}

          <section className="rounded-card border border-line bg-surface p-4 md:p-6">
            <h2 className="heading-display mb-3 text-2xl">{O.yourOutfit}</h2>
            {chosen.length === 0 ? (
              <p className="text-sm text-ink-soft">{O.empty}</p>
            ) : (
              <ul className="space-y-3">
                {chosen.map(([cat, ch]) => (
                  <OutfitLine
                    key={cat}
                    slug={ch.slug}
                    variantId={ch.variantId}
                    onVariant={(variantId, price) => {
                      setPicked((s) => ({ ...s, [cat]: { ...ch, variantId } }));
                      if (price != null) setPrices((pr) => ({ ...pr, [ch.slug]: price }));
                    }}
                    onRemove={() => setPicked(({ [cat]: _, ...rest }) => rest)}
                  />
                ))}
              </ul>
            )}
          </section>
        </div>
      )}

      {/* the total and the button stay at hand */}
      {chosen.length > 0 && (
        <div className="follow-nav fixed inset-x-0 bottom-[calc(var(--nav-h)+env(safe-area-inset-bottom))] z-30 border-t border-line bg-surface/95 px-4 py-3 backdrop-blur md:bottom-0">
          <div className="mx-auto flex max-w-6xl items-center gap-3">
            <div className="min-w-0 flex-1 leading-tight">
              <p className="text-xs text-ink-soft">{O.total} · {chosen.length}</p>
              <p className="text-lg font-bold" dir="ltr">{formatDA(total, locale)}</p>
              {!ready && <p className="text-xs text-danger">{O.chooseAll}</p>}
            </div>
            {added ? (
              <a href={href("/panier")} className="h-12 shrink-0 rounded-full bg-success px-5 font-semibold leading-[3rem] text-white">
                {O.added}
              </a>
            ) : (
              <button
                type="button"
                disabled={!ready}
                onClick={() => {
                  window.dispatchEvent(new CustomEvent("henine:outfit-add"));
                  setAdded(true);
                }}
                className="h-12 shrink-0 rounded-full bg-plum-600 px-5 font-semibold text-white disabled:opacity-50"
              >
                {O.add}
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

/** One piece of the outfit: its colour / size, then added to the cart with the others. */
function OutfitLine({ slug, variantId, onVariant, onRemove }: { slug: string; variantId: number | null; onVariant: (id: number | null, price: number | null) => void; onRemove: () => void }) {
  const { t, ar, locale } = useLocale();
  const O = t.plus.outfit;
  const { data: p } = useApi<ProductDetailDTO>(`/products/${encodeURIComponent(slug)}`);
  const [sel, setSel] = useState<Record<number, number>>({});
  // one-value options are already chosen
  useEffect(() => {
    if (!p) return;
    const init: Record<number, number> = {};
    for (const o of p.options) if (o.values.length === 1) init[o.id] = o.values[0]!.id;
    setSel(init);
  }, [p]);
  const variant = useMemo(() => {
    if (!p || p.options.some((o) => sel[o.id] == null)) return null;
    return p.variants.find((v) => Object.values(sel).every((id) => v.optionValueIds.includes(id))) ?? null;
  }, [p, sel]);
  useEffect(() => {
    const ok = variant && variant.available > 0 ? variant : null;
    if ((ok?.id ?? null) !== variantId) onVariant(ok?.id ?? null, ok?.price ?? null);
  }, [variant]); // eslint-disable-line react-hooks/exhaustive-deps

  // "Ajouter la tenue au panier": each line adds itself
  useEffect(() => {
    const add = () => {
      if (!p || !variant || variant.available <= 0) return;
      const labels = (lang: "fr" | "ar") =>
        p.options.map((o) => o.values.find((v) => v.id === sel[o.id])).filter(Boolean).map((v) => (lang === "ar" ? v!.labelAr : v!.labelFr)).join(" / ");
      cart.add({
        variantId: variant.id, qty: 1, productId: p.id, slug: p.slug, nameFr: p.nameFr, nameAr: p.nameAr,
        optionsFr: labels("fr"), optionsAr: labels("ar"), price: variant.price, image: p.images[0] ?? null, color: p.colors[0] ?? null,
      });
    };
    window.addEventListener("henine:outfit-add", add);
    return () => window.removeEventListener("henine:outfit-add", add);
  }, [p, variant, sel]);

  if (!p) return <li className="skeleton h-24 rounded-2xl" />;
  return (
    <li className="flex gap-3 rounded-2xl border border-line p-3">
      <ProductImage image={p.images[0] ?? null} alt="" category={p.categorySlug} color={p.colors[0]} sizes="96px" className="aspect-[4/5] w-20 shrink-0 rounded-xl" />
      <div className="min-w-0 flex-1">
        <div className="flex items-start justify-between gap-2">
          <p className="font-semibold">{ar ? p.nameAr : p.nameFr}</p>
          <button type="button" onClick={onRemove} className="text-xs text-ink-soft underline">{O.remove}</button>
        </div>
        <p className="text-sm font-semibold" dir="ltr">{formatDA(variant?.price ?? p.price, locale)}</p>
        <div className="mt-2 flex flex-wrap gap-2">
          {p.options.filter((o) => o.values.length > 1).map((o) => (
            <select
              key={o.id}
              aria-label={ar ? o.nameAr : o.nameFr}
              value={sel[o.id] ?? ""}
              onChange={(e) => setSel((s) => ({ ...s, [o.id]: Number(e.target.value) }))}
              className="h-10 rounded-xl border border-line bg-ivory px-3 text-sm"
            >
              <option value="">{o.kind === "taille" ? t.product.size : o.kind === "couleur" ? t.product.color : ar ? o.nameAr : o.nameFr}</option>
              {o.values.map((v) => {
                const left = p.variants.filter((vr) => vr.optionValueIds.includes(v.id)).reduce((s, vr) => s + vr.available, 0);
                return (
                  <option key={v.id} value={v.id} disabled={left === 0}>
                    {ar ? v.labelAr : v.labelFr}{left === 0 ? ` · ${t.product.outOfStock}` : ""}
                  </option>
                );
              })}
            </select>
          ))}
        </div>
        {variant && variant.available === 0 && <p className="mt-1 text-xs text-danger">{t.product.outOfStock}</p>}
      </div>
    </li>
  );
}
