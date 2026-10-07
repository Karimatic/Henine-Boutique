import { useEffect, useMemo, useState } from "react";
import { buzz } from "@/lib/haptics";
import { createPortal } from "react-dom";
import type { ProductCardDTO, ProductDetailDTO } from "@henine/shared";
import { Price, ProductImage, Spinner } from "@/components/ui/kit";
import { apiGet } from "@/lib/api";
import { useLocale } from "@/lib/locale";
import { cart } from "@/lib/stores";

/**
 * "+" on a product card: pick size / colour in a sheet and add to the cart without leaving
 * the page (like the big fashion apps). The full product loads only when the sheet opens.
 */
export function QuickAddButton({ p }: { p: ProductCardDTO }) {
  const { t } = useLocale();
  const [open, setOpen] = useState(false);
  if (!p.inStock) return null;
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label={t.quickAdd.open}
        className="absolute bottom-2 end-2 grid size-10 place-items-center rounded-full bg-surface/95 text-xl font-light text-ink shadow-md backdrop-blur transition hover:bg-ink hover:text-on-ink active:scale-90"
      >
        +
      </button>
      {open && <QuickAddSheet slug={p.slug} onClose={() => setOpen(false)} />}
    </>
  );
}

function QuickAddSheet({ slug, onClose }: { slug: string; onClose: () => void }) {
  const { t, ar, href, locale } = useLocale();
  const [p, setP] = useState<ProductDetailDTO | null>(null);
  const [failed, setFailed] = useState(false);
  const [selected, setSelected] = useState<Record<number, number>>({});
  const [added, setAdded] = useState(false);

  useEffect(() => {
    apiGet<ProductDetailDTO>(`/products/${encodeURIComponent(slug)}`).then((d) => {
      setP(d);
      // single-value options are chosen already
      const init: Record<number, number> = {};
      for (const o of d.options) if (o.values.length === 1) init[o.id] = o.values[0]!.id;
      setSelected(init);
    }, () => setFailed(true));
  }, [slug]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    document.addEventListener("keydown", onKey);
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = overflow;
    };
  }, [onClose]);

  const variant = useMemo(() => {
    if (!p || p.options.some((o) => selected[o.id] == null)) return null;
    const ids = Object.values(selected);
    return p.variants.find((v) => ids.every((id) => v.optionValueIds.includes(id))) ?? null;
  }, [p, selected]);
  const availableWith = (optionId: number, valueId: number) => {
    if (!p) return 0;
    const ids = { ...selected, [optionId]: valueId };
    return p.variants.filter((v) => Object.values(ids).every((id) => v.optionValueIds.includes(id))).reduce((s, v) => s + v.available, 0);
  };
  const colorOption = p?.options.find((o) => o.kind === "couleur");
  const colorId = colorOption ? selected[colorOption.id] : undefined;
  const image = p ? (p.images.find((i) => i.optionValueId === colorId) ?? p.images[0] ?? null) : null;
  const label = (lang: "fr" | "ar") =>
    p
      ? [...p.options]
          .sort((a, b) => (a.kind === "couleur" ? -1 : b.kind === "couleur" ? 1 : 0))
          .map((o) => o.values.find((v) => v.id === selected[o.id]))
          .filter(Boolean)
          .map((v) => (lang === "ar" ? v!.labelAr : v!.labelFr))
          .join(" / ")
      : "";

  function add() {
    if (!p || !variant || variant.available === 0) return;
    cart.add({
      variantId: variant.id, qty: 1, productId: p.id, slug: p.slug, nameFr: p.nameFr, nameAr: p.nameAr,
      optionsFr: label("fr"), optionsAr: label("ar"), price: variant.price, image,
      color: colorOption?.values.find((v) => v.id === colorId)?.hex ?? p.colors[0] ?? null,
    });
    buzz(10);
    setAdded(true);
  }

  return createPortal(
    <div className="fixed inset-0 z-[60] flex items-end justify-center bg-noir/45 md:items-center" onClick={onClose}>
      <div
        role="dialog"
        aria-modal="true"
        aria-label={t.quickAdd.open}
        dir={ar ? "rtl" : "ltr"}
        lang={locale}
        onClick={(e) => e.stopPropagation()}
        className="animate-sheet max-h-[88vh] w-full overflow-y-auto rounded-t-[1.75rem] bg-surface p-5 pb-[max(1.25rem,env(safe-area-inset-bottom))] md:max-w-md md:rounded-[1.75rem]"
      >
        <span aria-hidden="true" className="mx-auto mb-4 block h-1 w-10 rounded-full bg-line md:hidden" />
        {!p ? (
          <div className="grid h-40 place-items-center">{failed ? <p className="text-sm text-danger">{t.common.error}</p> : <Spinner />}</div>
        ) : (
          <>
            <div className="flex gap-4">
              <ProductImage image={image} alt="" category={p.categorySlug} color={p.colors[0]} sizes="96px" className="aspect-[4/5] w-24 shrink-0 rounded-2xl" />
              <div className="min-w-0 flex-1">
                <p className="heading-display text-xl leading-snug">{ar ? p.nameAr : p.nameFr}</p>
                <p className="mt-1 text-lg font-semibold">
                  <Price value={variant?.price ?? p.price} compareAt={p.compareAtPrice} />
                </p>
                <a href={href(`/produit/${p.slug}`)} className="mt-1 inline-block text-sm font-semibold text-plum-600 underline-offset-4 hover:underline">
                  {t.quickAdd.details} →
                </a>
              </div>
            </div>

            <div className="mt-5 space-y-4">
              {p.options.map((o) => (
                <fieldset key={o.id}>
                  <legend className="mb-2 text-sm font-medium">
                    {o.kind === "taille" ? t.product.size : o.kind === "couleur" ? t.product.color : ar ? o.nameAr : o.nameFr}
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
                          className={`size-10 rounded-full border-[3px] transition ${on ? "border-white ring-2 ring-ink" : "border-white shadow ring-1 ring-line"} ${soldOut ? "opacity-40" : ""}`}
                          style={{ background: v.hex }}
                        />
                      ) : (
                        <button
                          key={v.id}
                          type="button"
                          disabled={soldOut}
                          onClick={() => setSelected((s) => ({ ...s, [o.id]: v.id }))}
                          aria-pressed={on}
                          className={`h-11 min-w-12 rounded-2xl border px-4 text-sm font-semibold transition active:scale-95 ${on ? "border-ink bg-ink text-on-ink" : "border-line bg-surface"} ${soldOut ? "text-ink-soft line-through opacity-50" : ""}`}
                        >
                          {ar ? v.labelAr : v.labelFr}
                        </button>
                      );
                    })}
                  </div>
                </fieldset>
              ))}
            </div>

            {added ? (
              <div className="mt-6 grid gap-2">
                <p className="text-center text-sm font-semibold text-success">{t.quickAdd.added}</p>
                <a href={href("/panier")} className="grid h-12 place-items-center rounded-full bg-ink font-semibold text-on-ink">
                  {t.quickAdd.viewCart}
                </a>
                <button type="button" onClick={onClose} className="h-11 rounded-full text-sm font-semibold text-ink-soft">
                  {t.cart.continue}
                </button>
              </div>
            ) : (
              <button
                type="button"
                disabled={!variant || variant.available === 0}
                onClick={add}
                className="mt-6 h-12 w-full rounded-full bg-plum-600 font-semibold text-white transition active:scale-[0.98] disabled:opacity-45"
              >
                {variant ? (variant.available === 0 ? t.product.outOfStock : t.quickAdd.add) : t.product.selectVariant}
              </button>
            )}
          </>
        )}
      </div>
    </div>,
    document.body,
  );
}
