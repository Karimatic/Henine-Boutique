"use client";

import { useEffect, useMemo, useState } from "react";
import { formatDA, type ProductCardDTO, type QuoteDTO, type SiteConfigDTO } from "@henine/shared";
import { CheckoutForm } from "@/components/checkout/CheckoutForm";
import { ProductGrid, ProductGridSkeleton } from "@/components/product/ProductCard";
import { PageTitle, ProductImage } from "@/components/ui/kit";
import { apiGet, apiPost, useApi } from "@/lib/api";
import { useLocale } from "@/lib/locale";
import { pushSupported, subscribeProduct } from "@/lib/push";
import { cart, cartCount, favoritesStore, pendingCoupon, useCart, useFavorites } from "@/lib/stores";

export { SearchView } from "./SearchView";
export { CategoriesView, CategoryView, PromotionsView } from "./CatalogViews";

/**
 * Reminder link from the team ("نسيت شيئًا في سلتك 🛒"): /panier?r=<cart id>&code=<promo>.
 * Puts the items back in the cart on this phone and keeps the code for the checkout.
 */
function useCartRestore() {
  const { locale } = useLocale();
  const [note, setNote] = useState<{ ok: boolean; text: string } | null>(null);
  const { t } = useLocale();
  useEffect(() => {
    const params = new URLSearchParams(location.search);
    const id = params.get("r");
    const code = params.get("code")?.trim().toUpperCase().replace(/[^A-Z0-9_-]/g, "").slice(0, 32);
    if (!id && !code) return;
    history.replaceState(null, "", location.pathname);
    const notes: string[] = [];
    if (code) {
      pendingCoupon.set({ code, at: Date.now() });
      notes.push(t.plus.restore.code(code));
    }
    if (!id) return setNote({ ok: true, text: notes.join(" · ") });
    apiGet<{ lines: { variantId: number; qty: number }[]; ordered: boolean }>(`/carts/${encodeURIComponent(id)}`)
      .then(async (saved) => {
        if (saved.ordered) return setNote({ ok: true, text: t.plus.restore.ordered });
        const q = await apiPost<QuoteDTO>("/quote", { lines: saved.lines });
        const ok = q.lines.filter((l) => l.problem !== "unavailable" && l.problem !== "out_of_stock");
        const inCart = new Set(cart.items().map((i) => i.variantId));
        for (const l of ok) {
          if (inCart.has(l.variantId)) continue;
          cart.add({
            variantId: l.variantId, qty: Math.min(l.qty, Math.max(1, l.available)), productId: l.productId, slug: l.slug, nameFr: l.nameFr, nameAr: l.nameAr,
            optionsFr: l.optionsFr, optionsAr: l.optionsAr, price: l.unitPrice, image: l.image, color: null,
          });
        }
        setNote(ok.length ? { ok: true, text: [t.plus.restore.restored(ok.length), ...notes].join(" · ") } : { ok: false, text: t.plus.restore.gone });
      })
      .catch(() => setNote({ ok: false, text: t.plus.restore.gone }));
  }, [locale]); // eslint-disable-line react-hooks/exhaustive-deps
  return note;
}

/* ───────── Cart ───────── */

export function CartView() {
  const { t, href, ar, locale } = useLocale();
  const items = useCart();
  const restored = useCartRestore();
  const [ready, setReady] = useState(false);
  useEffect(() => setReady(true), []);
  const subtotal = items.reduce((s, i) => s + i.price * i.qty, 0);
  const site = useApi<SiteConfigDTO>("/site");
  const freeOver = site.data?.checkout.freeShippingOver ?? null;

  if (!ready) return <div className="mx-auto max-w-3xl px-4 py-8"><div className="skeleton h-40 rounded-card" /></div>;
  return (
    <div className="mx-auto max-w-3xl px-4 py-8">
      <PageTitle>{t.cart.title}</PageTitle>
      {restored && (
        <p role="status" className={`mb-4 rounded-2xl p-4 text-sm font-semibold ${restored.ok ? "bg-rose-100 text-plum-700" : "bg-ivory-deep text-ink-soft"}`}>
          {restored.text}
        </p>
      )}
      {items.length === 0 ? (
        <div className="rounded-card border border-line bg-surface/60 p-8 text-center">
          <p className="text-ink-soft">{t.cart.empty}</p>
          <a href={href("/")} className="mt-5 inline-flex h-12 items-center rounded-full bg-plum-600 px-6 font-semibold text-white">
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
              <span className="mt-2.5 block h-2 overflow-hidden rounded-full bg-surface">
                <span
                  className="block h-full rounded-full bg-gradient-to-r from-rose-500 to-plum-600 transition-[width] duration-700 rtl:bg-gradient-to-l"
                  style={{ width: `${Math.min(100, Math.round((subtotal / freeOver) * 100))}%` }}
                />
              </span>
            </div>
          )}
          <ul className="divide-y divide-line rounded-card border border-line bg-surface">
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
        <a href={href("/")} className="mt-5 inline-flex h-12 items-center rounded-full bg-plum-600 px-6 font-semibold text-white">{t.cart.continue}</a>
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

/* ───────── Favourites ───────── */

/**
 * Favourites live on the phone. They can be shared as a link (/favoris?l=slug,slug), and a
 * sold-out favourite can send a notification when it is back.
 */
export function FavoritesView() {
  const { t, locale } = useLocale();
  const F = t.plus.favorites;
  const favorites = useFavorites();
  const catalog = useApi<ProductCardDTO[]>("/catalog");
  const [ready, setReady] = useState(false);
  const [shared, setShared] = useState<string[] | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  useEffect(() => {
    const l = new URLSearchParams(location.search).get("l");
    if (l) setShared(l.split(",").map((s) => s.trim()).filter((s) => /^[a-z0-9-]{1,90}$/.test(s)).slice(0, 50));
    setReady(true);
  }, []);
  const bySlug = (list: string[]) => list.map((slug) => catalog.data?.find((p) => p.slug === slug)).filter((p): p is ProductCardDTO => !!p);
  const products = bySlug(favorites);
  const soldOut = products.filter((p) => !p.inStock);

  async function share() {
    const url = `${location.origin}${location.pathname}?l=${favorites.join(",")}`;
    try {
      if (navigator.share) await navigator.share({ title: "Henine Boutique", text: F.shareText, url });
      else {
        await navigator.clipboard.writeText(url);
        setMsg(F.copied);
      }
    } catch {
      /* closed */
    }
  }

  if (!ready || !catalog.data) {
    return (
      <div className="mx-auto max-w-6xl px-4 py-8">
        <PageTitle>{t.favorites.title}</PageTitle>
        <ProductGridSkeleton count={2} />
      </div>
    );
  }
  return (
    <div className="mx-auto max-w-6xl px-4 py-8">
      {shared && shared.length > 0 && (
        <section className="mb-10 rounded-[1.5rem] bg-rose-100 p-4 md:p-6">
          <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
            <h1 className="heading-display text-2xl md:text-3xl">{F.shared}</h1>
            <button
              type="button"
              onClick={() => {
                favoritesStore.set((list) => [...new Set([...shared, ...list])].slice(0, 100));
                setMsg(F.added);
              }}
              className="h-11 rounded-full bg-plum-600 px-5 text-sm font-semibold text-white"
            >
              ♡ {F.addAll}
            </button>
          </div>
          <ProductGrid products={bySlug(shared)} />
        </section>
      )}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <PageTitle>{t.favorites.title}</PageTitle>
        {products.length > 0 && (
          <button type="button" onClick={share} className="mb-6 inline-flex h-10 items-center gap-2 rounded-full border border-line bg-surface px-4 text-sm font-semibold">
            ↗ {F.share}
          </button>
        )}
      </div>
      {msg && <p role="status" className="mb-4 rounded-xl bg-rose-100 p-3 text-sm font-semibold text-plum-700">{msg}</p>}
      {products.length ? (
        <>
          <ProductGrid products={products} />
          {soldOut.length > 0 && (
            <ul className="mt-8 space-y-2">
              {soldOut.map((p) => (
                <SoldOutFavorite key={p.id} p={p} locale={locale} />
              ))}
            </ul>
          )}
        </>
      ) : (
        <p className="rounded-card border border-line bg-surface/60 p-8 text-center text-ink-soft">{t.favorites.empty}</p>
      )}
    </div>
  );
}

function SoldOutFavorite({ p, locale }: { p: ProductCardDTO; locale: "fr" | "ar" }) {
  const { t, ar } = useLocale();
  const F = t.plus.favorites;
  const [state, setState] = useState<"idle" | "busy" | "done" | "denied" | "error">("idle");
  const [can, setCan] = useState(false);
  useEffect(() => setCan(pushSupported()), []);
  return (
    <li className="flex items-center gap-3 rounded-2xl border border-line bg-surface p-3">
      <ProductImage image={p.image} alt="" category={p.categorySlug} color={p.colors[0]} sizes="64px" className="aspect-[4/5] w-12 shrink-0 rounded-lg opacity-70" />
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-semibold">{ar ? p.nameAr : p.nameFr}</p>
        <p className="text-xs text-ink-soft">{F.soldOut}</p>
      </div>
      {state === "done" ? (
        <span className="text-xs font-semibold text-plum-700">{F.notifyDone}</span>
      ) : can ? (
        <button
          type="button"
          disabled={state === "busy"}
          onClick={async () => {
            setState("busy");
            const r = await subscribeProduct(p.id, locale);
            setState(r === "ok" ? "done" : r);
          }}
          className="h-10 shrink-0 rounded-full bg-plum-600 px-4 text-xs font-semibold text-white disabled:opacity-60"
        >
          {F.notify}
        </button>
      ) : null}
      {state === "denied" && <span className="text-xs text-danger">{F.denied}</span>}
    </li>
  );
}
