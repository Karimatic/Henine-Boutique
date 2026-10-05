import type { StockProduct, StockVariant } from "../pages/Stock";

/** "Rose poudré / M" for a variant, from the product's options. */
export function variantLabel(p: StockProduct, v: StockVariant): string {
  return p.options
    .map((o) => o.values.find((val) => v.valueIds.includes(val.id))?.label)
    .filter(Boolean)
    .join(" / ");
}
