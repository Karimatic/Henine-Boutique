"use client";

import { useEffect, useMemo, useState } from "react";
import { dateLocale, normalizeDzPhone, type ProductDetailDTO, type SiteConfigDTO } from "@henine/shared";
import { CheckoutForm } from "@/components/checkout/CheckoutForm";
import { HeartIcon } from "@/components/ui/icons";
import { Markdown } from "@/components/ui/Markdown";
import { ErrorBox, inputCls, Price, ProductImage, Stars } from "@/components/ui/kit";
import { apiPost, slugFromPath, useApi } from "@/lib/api";
import { useLocale } from "@/lib/locale";
import { cart, toggleFavorite, useFavorites } from "@/lib/stores";
import { Turnstile } from "@/lib/turnstile";
import { Badges } from "./Badges";
import { ProductGrid } from "./ProductCard";
import { ReviewForm } from "./ReviewForm";
import { ShareButton } from "./ShareButton";

export function ProductView() {
  const [slug, setSlug] = useState<string | null>(null);
  useEffect(() => setSlug(slugFromPath(location.pathname)), []);
  const { data: p, error, reload } = useApi<ProductDetailDTO>(slug && slug !== "_" ? `/products/${encodeURIComponent(slug)}` : null);
  const { t, href } = useLocale();

  if (error?.status === 404 || slug === "_") {
    return (
      <div className="mx-auto max-w-md px-4 py-20 text-center">
        <p className="text-lg">{t.product.notFound}</p>
        <a href={href("/")} className="mt-6 inline-flex h-12 items-center rounded-full bg-plum-600 px-6 font-semibold text-ivory">
          {t.notFound.cta}
        </a>
      </div>
    );
  }
  if (error) return <div className="mx-auto max-w-6xl px-4 py-10"><ErrorBox onRetry={reload} /></div>;
  if (!p) return <ProductSkeleton />;
  return <ProductDetail p={p} />;
}

function ProductSkeleton() {
  return (
    <div className="mx-auto grid max-w-6xl gap-8 px-4 py-6 md:grid-cols-2" aria-busy="true">
      <div className="skeleton aspect-[4/5] rounded-card" />
      <div className="space-y-4">
        <div className="skeleton h-8 w-3/4" />
        <div className="skeleton h-6 w-1/3" />
        <div className="skeleton h-12 w-full" />
        <div className="skeleton h-12 w-full" />
        <div className="skeleton h-14 w-full rounded-full" />
      </div>
    </div>
  );
}

function ProductDetail({ p }: { p: ProductDetailDTO }) {
  const { t, ar, href, locale } = useLocale();
  const favorites = useFavorites();
  const site = useApi<SiteConfigDTO>("/site");
  const name = ar ? p.nameAr : p.nameFr;
  useEffect(() => {
    document.title = `${name} · Henine Boutique`;
  }, [name]);

  // pre-select the only value of single-value options, and the first in-stock colour
  const [selected, setSelected] = useState<Record<number, number>>(() => {
    const init: Record<number, number> = {};
    for (const o of p.options) {
      if (o.values.length === 1) init[o.id] = o.values[0]!.id;
      else if (o.kind === "couleur") {
        const inStock = o.values.find((v) => p.variants.some((vr) => vr.optionValueIds.includes(v.id) && vr.available > 0));
        if (inStock) init[o.id] = inStock.id;
      }
    }
    return init;
  });

  const variant = useMemo(() => {
    if (p.options.some((o) => selected[o.id] == null)) return null;
    const ids = Object.values(selected);
    return p.variants.find((v) => ids.every((id) => v.optionValueIds.includes(id))) ?? null;
  }, [selected, p]);

  // images: the ones of the selected colour first
  const colorOption = p.options.find((o) => o.kind === "couleur");
  const selectedColor = colorOption ? selected[colorOption.id] : undefined;
  const images = useMemo(() => {
    const own = p.images.filter((i) => i.optionValueId === selectedColor);
    return own.length ? [...own, ...p.images.filter((i) => i.optionValueId !== selectedColor)] : p.images;
  }, [p.images, selectedColor]);
  const [active, setActive] = useState(0);
  useEffect(() => setActive(0), [selectedColor]);
  const colorHex = colorOption?.values.find((v) => v.id === selectedColor)?.hex ?? p.colors[0];

  /** Available quantity if this value were picked (for greying out sold-out sizes). */
  const availableWith = (optionId: number, valueId: number) => {
    const ids = { ...selected, [optionId]: valueId };
    return p.variants.filter((v) => Object.values(ids).every((id) => v.optionValueIds.includes(id))).reduce((s, v) => s + v.available, 0);
  };

  const [added, setAdded] = useState(false);
  const [showExpress, setShowExpress] = useState(false);
  const labels = (lang: "fr" | "ar") =>
    [...p.options]
      .sort((a, b) => (a.kind === "couleur" ? -1 : b.kind === "couleur" ? 1 : 0))
      .map((o) => o.values.find((v) => v.id === selected[o.id]))
      .filter(Boolean)
      .map((v) => (lang === "ar" ? v!.labelAr : v!.labelFr))
      .join(" / ");

  function addToCart() {
    if (!variant) return;
    cart.add({
      variantId: variant.id,
      qty: 1,
      productId: p.id,
      slug: p.slug,
      nameFr: p.nameFr,
      nameAr: p.nameAr,
      optionsFr: labels("fr"),
      optionsAr: labels("ar"),
      price: variant.price,
      image: images[0] ?? null,
      color: colorHex ?? null,
    });
    setAdded(true);
    navigator.vibrate?.(10);
    setTimeout(() => setAdded(false), 2200);
  }

  const fav = favorites.includes(p.slug);
  // computed by the API: hand-picked look → bought together → same category (no catalogue download)
  const related = p.related;
  const expressEnabled = site.data?.checkout.expressOnProduct ?? true;

  return (
    <div className="mx-auto max-w-6xl px-4 pb-10 pt-4 md:pt-8">
      <nav className="mb-4 text-sm text-ink-soft" aria-label="breadcrumb">
        <a href={href("/")} className="hover:text-plum-700">{t.nav.home}</a>
        {p.category && (
          <>
            {" / "}
            <a href={href(`/c/${p.category.slug}`)} className="hover:text-plum-700">{ar ? p.category.nameAr : p.category.nameFr}</a>
          </>
        )}
      </nav>

      <div className="grid gap-8 md:grid-cols-2 md:gap-12">
        {/* Gallery: swipeable on phones, thumbnails on larger screens */}
        <div>
          <div className="relative">
            <ProductImage image={images[active] ?? null} alt={name} category={p.categorySlug} color={colorHex} priority sizes="(min-width: 768px) 50vw, 100vw" className="aspect-[4/5] rounded-card" />
            <Badges p={p} className="pointer-events-none absolute start-3 top-3" />
            <button
              type="button"
              onClick={() => toggleFavorite(p.slug)}
              aria-pressed={fav}
              aria-label={fav ? t.product.favoriteRemove : t.product.favoriteAdd}
              className={`absolute end-3 top-3 grid size-11 place-items-center rounded-full bg-ivory/90 shadow-sm backdrop-blur ${fav ? "text-rose-700" : "text-ink-soft"}`}
            >
              <HeartIcon fill={fav ? "currentColor" : "none"} />
            </button>
          </div>
          {images.length > 1 && (
            <ul className="mt-3 flex gap-2 overflow-x-auto pb-1">
              {images.map((img, i) => (
                <li key={img.src}>
                  <button type="button" onClick={() => setActive(i)} className={`block overflow-hidden rounded-lg ring-2 ${i === active ? "ring-plum-600" : "ring-transparent"}`} aria-label={`${i + 1}/${images.length}`}>
                    <ProductImage image={img} alt="" sizes="80px" className="aspect-[4/5] w-16" />
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div>
          <div className="flex items-start justify-between gap-3">
            <h1 className="heading-display text-3xl leading-tight md:text-4xl">{name}</h1>
            <ShareButton slug={p.slug} name={name} price={variant?.price ?? p.price} className="shrink-0" />
          </div>
          {p.rating && (
            <a href="#avis" className="mt-2 inline-flex items-center gap-2 text-sm text-ink-soft">
              <Stars value={p.rating.avg} /> {p.rating.avg} ({p.rating.count})
            </a>
          )}
          <div className="mt-3 text-xl">
            <Price value={variant?.price ?? p.price} compareAt={p.compareAtPrice} />
          </div>

          <div className="mt-6 space-y-5">
            {p.options.map((o) => (
              <fieldset key={o.id}>
                <legend className="mb-2 text-sm font-medium">
                  {o.kind === "taille" ? t.product.size : o.kind === "couleur" ? t.product.color : ar ? o.nameAr : o.nameFr}
                  {selected[o.id] != null && (
                    <span className="ms-2 text-ink-soft">{(() => { const v = o.values.find((x) => x.id === selected[o.id]); return ar ? v?.labelAr : v?.labelFr; })()}</span>
                  )}
                </legend>
                <div className="flex flex-wrap gap-2">
                  {o.values.map((v) => {
                    const soldOut = availableWith(o.id, v.id) === 0;
                    const on = selected[o.id] === v.id;
                    return o.kind === "couleur" && v.hex ? (
                      <button
                        key={v.id}
                        type="button"
                        onClick={() => setSelected((s) => ({ ...s, [o.id]: v.id }))}
                        aria-pressed={on}
                        aria-label={ar ? v.labelAr : v.labelFr}
                        title={ar ? v.labelAr : v.labelFr}
                        className={`relative size-11 rounded-full border-2 transition ${on ? "border-plum-600 ring-2 ring-plum-600/20" : "border-white shadow"} ${soldOut ? "opacity-40" : ""}`}
                        style={{ background: v.hex }}
                      />
                    ) : (
                      <button
                        key={v.id}
                        type="button"
                        onClick={() => setSelected((s) => ({ ...s, [o.id]: v.id }))}
                        aria-pressed={on}
                        className={`h-11 min-w-12 rounded-xl border px-4 text-sm font-semibold transition ${on ? "border-plum-600 bg-plum-600 text-ivory" : "border-line bg-white"} ${soldOut ? "text-ink-soft line-through opacity-60" : ""}`}
                      >
                        {ar ? v.labelAr : v.labelFr}
                      </button>
                    );
                  })}
                </div>
              </fieldset>
            ))}
          </div>

          <p className="mt-4 min-h-6 text-sm font-medium" aria-live="polite">
            {!variant ? (
              <span className="text-ink-soft">{t.product.selectVariant}</span>
            ) : variant.available === 0 ? (
              <span className="text-danger">{t.product.outOfStock}</span>
            ) : variant.available <= 3 ? (
              <span className="text-rose-700">{t.product.lowStock(variant.available)}</span>
            ) : (
              <span className="text-success">✓ {t.product.inStock}</span>
            )}
          </p>

          {variant && variant.available === 0 ? (
            <NotifyMe variantId={variant.id} siteKey={site.data?.turnstileSiteKey ?? ""} />
          ) : (
            <div className="mt-3 grid gap-3 sm:grid-cols-2">
              <button
                type="button"
                disabled={!variant}
                onClick={addToCart}
                className="h-13 rounded-full border-2 border-plum-600 px-6 font-semibold text-plum-700 transition active:scale-[0.98] disabled:opacity-40"
              >
                {added ? t.product.added : t.product.addToCart}
              </button>
              {expressEnabled ? (
                <button
                  type="button"
                  disabled={!variant}
                  onClick={() => {
                    setShowExpress(true);
                    setTimeout(() => document.getElementById("express")?.scrollIntoView({ behavior: "smooth", block: "start" }), 50);
                  }}
                  className="h-13 rounded-full bg-plum-600 px-6 font-semibold text-ivory shadow-soft transition hover:bg-plum-700 active:scale-[0.98] disabled:opacity-40"
                >
                  {t.product.buyNow}
                </button>
              ) : (
                <a href={href("/panier")} onClick={addToCart} className="grid h-13 place-items-center rounded-full bg-plum-600 px-6 font-semibold text-ivory">
                  {t.product.buyNow}
                </a>
              )}
            </div>
          )}

          {showExpress && variant && variant.available > 0 && (
            <section id="express" className="mt-6 scroll-mt-24 rounded-card border border-plum-600/30 bg-white/70 p-4">
              <h2 className="text-lg font-semibold">{t.product.express}</h2>
              <p className="mb-4 text-sm text-ink-soft">{t.product.expressHint}</p>
              <CheckoutForm key={variant.id} lines={[{ variantId: variant.id, qty: 1 }]} channel="express" compact />
            </section>
          )}

          <div className="mt-8 space-y-6 border-t border-line pt-6">
            {(ar ? p.descriptionAr : p.descriptionFr) && (
              <section>
                <h2 className="mb-2 font-semibold">{t.product.description}</h2>
                <Markdown source={(ar ? p.descriptionAr : p.descriptionFr) ?? ""} />
              </section>
            )}
            <section>
              <h2 className="mb-2 font-semibold">{t.product.delivery}</h2>
              <p className="text-sm leading-relaxed text-ink-soft">{t.product.deliveryText}</p>
            </section>
          </div>
        </div>
      </div>

      {related.length > 0 && (
        <section className="mt-12">
          <h2 className="heading-display mb-5 text-3xl">{p.relatedKind === "look" ? t.look.title : t.look.similar}</h2>
          <ProductGrid products={related} />
        </section>
      )}

      <Reviews p={p} />

      {/* sticky mobile CTA */}
      {variant && variant.available > 0 && !showExpress && (
        <div className="fixed inset-x-0 bottom-[calc(4rem+env(safe-area-inset-bottom))] z-30 border-t border-line bg-ivory/95 p-3 backdrop-blur md:hidden">
          <button type="button" onClick={addToCart} className="h-12 w-full rounded-full bg-plum-600 font-semibold text-ivory shadow-soft active:scale-[0.99]">
            {added ? t.product.added : t.product.addToCart}
          </button>
        </div>
      )}
    </div>
  );
}

function NotifyMe({ variantId, siteKey }: { variantId: number; siteKey: string }) {
  const { t, locale } = useLocale();
  const [phone, setPhone] = useState("");
  const [token, setToken] = useState("");
  const [state, setState] = useState<"idle" | "sending" | "done" | "error">("idle");
  return state === "done" ? (
    <p className="mt-3 rounded-xl bg-rose-100 p-4 text-sm font-medium text-plum-700">{t.product.notifyDone}</p>
  ) : (
    <form
      className="mt-3 space-y-2"
      onSubmit={async (e) => {
        e.preventDefault();
        const p = normalizeDzPhone(phone);
        if (!p) return setState("error");
        setState("sending");
        try {
          await apiPost("/stock-alert", { variantId, phone: p, turnstileToken: token || "pending" });
          setState("done");
        } catch {
          setState("error");
        }
      }}
    >
      <p className="text-sm font-medium">{t.product.notifyMe}</p>
      <div className="flex gap-2">
        <input className={inputCls} type="tel" inputMode="tel" dir="ltr" placeholder="05 55 12 34 56" value={phone} onChange={(e) => setPhone(e.target.value)} />
        <button type="submit" disabled={state === "sending"} className="shrink-0 rounded-xl bg-plum-600 px-5 font-semibold text-ivory">
          OK
        </button>
      </div>
      {state === "error" && <p className="text-sm text-danger">{t.checkout.errors.phone_invalid}</p>}
      <Turnstile siteKey={siteKey} onToken={setToken} locale={locale} />
    </form>
  );
}

function Reviews({ p }: { p: ProductDetailDTO }) {
  const { t, locale } = useLocale();
  const R = t.reviewsPlus;
  const [open, setOpen] = useState(false);
  const [done, setDone] = useState<string | null>(null);
  return (
    <section id="avis" className="mt-12 scroll-mt-24">
      <div className="mb-2 flex flex-wrap items-center justify-between gap-3">
        <h2 className="heading-display text-3xl">
          {t.product.reviews}
          {p.rating && (
            <span className="ms-3 inline-flex items-center gap-1.5 align-middle font-sans text-base text-ink-soft">
              <Stars value={p.rating.avg} /> <span dir="ltr">{p.rating.avg}/5 ({p.rating.count})</span>
            </span>
          )}
        </h2>
        {!open && !done && (
          <button type="button" onClick={() => setOpen(true)} className="rounded-full border border-ink/15 px-4 py-2 text-sm font-semibold">
            {R.cta}
          </button>
        )}
      </div>
      <p className="mb-4 text-sm text-ink-soft">✓ {R.onlyBuyers}</p>
      {done && <p className="mb-4 rounded-xl bg-rose-100 p-4 text-sm font-medium text-plum-700">{done === "approved" ? R.thanksPublished : R.thanksPending}</p>}
      {open && !done && (
        <div className="mb-6 rounded-card border border-line bg-white/70 p-4">
          <ReviewForm
            productId={p.id}
            onDone={(status) => {
              setDone(status);
              setOpen(false);
            }}
          />
        </div>
      )}
      {p.reviews.length === 0 ? (
        <p className="text-sm text-ink-soft">{t.product.noReviews}</p>
      ) : (

        <ul className="grid gap-3 md:grid-cols-2">
          {p.reviews.map((r) => (
            <li key={r.id} className="rounded-card border border-line bg-white/60 p-4">
              <div className="flex items-center justify-between">
                <span className="font-semibold">{r.name}</span>
                <Stars value={r.rating} />
              </div>
              {r.verified && <p className="mt-0.5 text-xs text-success">✓ {t.product.verified}</p>}
              {r.text && <p className="mt-2 text-sm leading-relaxed text-ink-soft">{r.text}</p>}
              {r.reply && <p className="mt-2 border-s-2 border-rose-300 ps-3 text-sm text-ink">🌸 {r.reply}</p>}
              <p className="mt-2 text-xs text-ink-soft">{new Date(r.createdAt).toLocaleDateString(dateLocale(locale))}</p>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
