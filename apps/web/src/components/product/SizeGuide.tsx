"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import type { SizeGuideDTO } from "@henine/shared";
import { useLocale } from "@/lib/locale";

/** "📏 Guide des tailles" link next to the size choice, opening the product's size chart. */
export function SizeGuideButton({ guide, selectedSize }: { guide: SizeGuideDTO; selectedSize?: string | null }) {
  const { t, locale } = useLocale();
  const ar = locale === "ar";
  const [open, setOpen] = useState(false);
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("keydown", onKey);
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = overflow;
    };
  }, [open]);
  const headers = ar ? guide.headersAr : guide.headersFr;
  const tips = ar ? guide.tipsAr : guide.tipsFr;

  return (
    <>
      <button type="button" onClick={() => setOpen(true)} className="ms-auto text-sm font-semibold text-plum-600 underline-offset-4 hover:underline">
        📏 {t.product.sizeGuide}
      </button>
      {open &&
        createPortal(
          <div className="fixed inset-0 z-[60] flex items-end justify-center bg-ink/40 md:items-center" onClick={() => setOpen(false)}>
            <div
              role="dialog"
              aria-modal="true"
              aria-label={t.product.sizeGuide}
              dir={ar ? "rtl" : "ltr"}
              onClick={(e) => e.stopPropagation()}
              className="animate-sheet max-h-[85vh] w-full overflow-y-auto rounded-t-3xl bg-ivory p-5 pb-[max(1.25rem,env(safe-area-inset-bottom))] shadow-soft md:max-w-lg md:rounded-3xl"
            >
              <div className="mb-4 flex items-center justify-between">
                <p className="heading-display text-lg font-semibold">📏 {t.product.sizeGuide}</p>
                <button type="button" onClick={() => setOpen(false)} aria-label={t.common.close} className="grid size-10 place-items-center rounded-full text-xl text-ink-soft hover:bg-rose-100">
                  ×
                </button>
              </div>
              <div className="overflow-x-auto rounded-2xl border border-line bg-white">
                <table className="w-full text-center text-sm">
                  <thead>
                    <tr className="bg-rose-100/60">
                      {headers.map((h, i) => (
                        <th key={i} scope="col" className="px-3 py-2.5 font-semibold">
                          {h}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {guide.rows.map((row, i) => {
                      const mine = !!selectedSize && row[0]?.trim().toLowerCase() === selectedSize.trim().toLowerCase();
                      return (
                        <tr key={i} className={`border-t border-line/70 ${mine ? "bg-plum-600/10 font-semibold" : ""}`}>
                          {row.map((cell, j) =>
                            j === 0 ? (
                              <th key={j} scope="row" className="px-3 py-2.5 font-semibold">
                                {cell}
                              </th>
                            ) : (
                              <td key={j} className="px-3 py-2.5 tabular-nums" dir="ltr">
                                {cell}
                              </td>
                            ),
                          )}
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
              {tips && <p className="mt-4 rounded-2xl bg-rose-100/50 p-3 text-sm leading-relaxed text-ink-soft">💡 {tips}</p>}
            </div>
          </div>,
          document.body,
        )}
    </>
  );
}
