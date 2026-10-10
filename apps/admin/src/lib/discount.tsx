/**
 * "This product is on sale": a switch instead of a bare "crossed-out price" box. On: the price
 * before the sale and the discount in % (or the selling price) fill each other; off: the
 * product goes back to its price before the sale.
 */
import { useEffect, useState } from "react";
import { tr } from "../i18n";
import { da } from "./format";
import { NumberField, Toggle } from "../ui";

/** the sale price for a discount, rounded to 10 DA like shop prices */
const salePrice = (before: number, pct: number) => Math.max(10, Math.round((before * (1 - pct / 100)) / 10) * 10);
const pctOf = (before: number | null, price: number | null) => (before && price && before > price ? Math.round((1 - price / before) * 100) : 0);

export function DiscountFields({
  price,
  compareAt,
  onChange,
}: {
  price: number | null;
  compareAt: number | null;
  /** both prices at once: the selling price and the price before the sale (null = no sale) */
  onChange: (next: { price: number | null; compareAt: number | null }) => void;
}) {
  const on = compareAt != null && compareAt > 0;
  const [pct, setPct] = useState<number | null>(() => pctOf(compareAt, price) || null);
  // the selling price typed above: the % follows (a 1-point gap is only the 10 DA rounding)
  useEffect(() => {
    const real = pctOf(compareAt, price);
    setPct((p) => (Math.abs((p ?? 0) - real) > 1 ? real || null : p));
  }, [price, compareAt]);
  return (
    <div className="space-y-3 rounded-xl border border-line p-3 sm:col-span-full">
      <Toggle
        checked={on}
        onChange={(v) => {
          if (v) {
            // the current price becomes the price before the sale; choose the discount next
            onChange({ price, compareAt: price ?? null });
            setPct(null);
          } else onChange({ price: on ? compareAt : price, compareAt: null });
        }}
        label={tr("🏷️ Ce produit est en promotion")}
        hint={tr("La boutique affiche l'ancien prix barré et le pourcentage de réduction.")}
      />
      {on && (
        <div className="grid grid-cols-2 gap-3">
          <NumberField
            label={tr("Prix avant la promo")}
            suffix={tr("DA")}
            value={compareAt}
            onChange={(v) => {
              onChange({ price: v && pct ? salePrice(v, pct) : price, compareAt: v });
            }}
          />
          <NumberField
            label={tr("Réduction")}
            suffix="%"
            value={pct}
            onChange={(v) => {
              const p = v == null ? null : Math.min(90, v);
              setPct(p);
              if (compareAt && p) onChange({ price: salePrice(compareAt, p), compareAt });
            }}
          />
          {compareAt && price && compareAt > price ? (
            <p className="text-sm col-span-2">
              <s className="text-ink-soft">{da(compareAt)}</s> → <b>{da(price)}</b>{" "}
              <span className="rounded-md bg-red-100 px-1.5 py-0.5 text-xs font-semibold text-red-800">−{pctOf(compareAt, price)} %</span>
            </p>
          ) : (
            <p className="text-xs text-amber-800 col-span-2">{tr("Le prix en promo doit être plus bas que le prix avant la promo.")}</p>
          )}
        </div>
      )}
    </div>
  );
}
