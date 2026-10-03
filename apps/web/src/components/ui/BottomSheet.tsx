"use client";

import { useEffect, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { useLocale } from "@/lib/locale";

/** Panel from the bottom on phones, centred on computers; Esc / tap outside closes it. */
export function BottomSheet({ title, onClose, children, wide = false }: { title: ReactNode; onClose: () => void; children: ReactNode; wide?: boolean }) {
  const { t, ar } = useLocale();
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
  return createPortal(
    <div className="fixed inset-0 z-[60] flex items-end justify-center bg-noir/45 md:items-center" onClick={onClose}>
      <div
        role="dialog"
        aria-modal="true"
        dir={ar ? "rtl" : "ltr"}
        onClick={(e) => e.stopPropagation()}
        className={`toast-in flex max-h-[90dvh] w-full flex-col overflow-hidden rounded-t-[1.75rem] bg-ivory shadow-2xl md:rounded-[1.75rem] ${wide ? "max-w-3xl" : "max-w-lg"}`}
      >
        <header className="flex items-center justify-between gap-3 border-b border-line px-5 py-4">
          <h2 className="heading-display text-xl">{title}</h2>
          <button type="button" onClick={onClose} className="grid size-10 place-items-center rounded-full bg-ivory-deep text-lg" aria-label={t.common.close}>
            ✕
          </button>
        </header>
        <div className="overflow-y-auto p-5 pb-[calc(1.25rem+env(safe-area-inset-bottom))]">{children}</div>
      </div>
    </div>,
    document.body,
  );
}
