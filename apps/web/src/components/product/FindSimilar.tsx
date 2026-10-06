import { useMemo, useState } from "react";
import type { ProductCardDTO } from "@henine/shared";
import { BottomSheet } from "@/components/ui/BottomSheet";
import { useApi } from "@/lib/api";
import { useLocale } from "@/lib/locale";
import { similarProducts } from "@/lib/similar";
import { ProductGrid } from "./ProductCard";

/** "🔍 Voir des modèles similaires" on the product photo. */
export function FindSimilarButton({ product, className = "" }: { product: ProductCardDTO; className?: string }) {
  const { t } = useLocale();
  const S = t.plus.similar;
  const [open, setOpen] = useState(false);
  const catalog = useApi<ProductCardDTO[]>(open ? "/catalog" : null);
  const list = useMemo(() => (catalog.data ? similarProducts(product, catalog.data) : null), [catalog.data, product]);
  return (
    <>
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          setOpen(true);
        }}
        className={`inline-flex h-9 items-center gap-1 rounded-full bg-ivory/90 px-3.5 text-xs font-semibold text-ink shadow-sm backdrop-blur ${className}`}
      >
        {S.open}
      </button>
      {open && (
        <BottomSheet title={S.title} onClose={() => setOpen(false)} wide>
          {!list ? (
            <div className="skeleton h-48 rounded-card" />
          ) : list.length === 0 ? (
            <p className="text-sm text-ink-soft">{S.none}</p>
          ) : (
            <>
              <p className="mb-4 flex flex-wrap gap-1.5 text-xs">
                {[...new Set(list.flatMap((p) => p.reasons))].map((r) => (
                  <span key={r} className="rounded-full bg-rose-100 px-2.5 py-1 font-semibold text-plum-700">
                    {S.why[r]}
                  </span>
                ))}
              </p>
              <ProductGrid products={list} />
            </>
          )}
        </BottomSheet>
      )}
    </>
  );
}
