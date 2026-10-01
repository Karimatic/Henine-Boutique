"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { normalizeSearch } from "@henine/shared";
import { inputCls, Spinner } from "@/components/ui/kit";
import { useLocale } from "@/lib/locale";

export interface PickerOption<V> {
  value: V;
  label: string;
  /** shown at the end of the row (a price, a note) */
  hint?: string;
  /** extra searchable text (the other language, the wilaya number…) */
  keywords?: string;
  disabled?: boolean;
}

/**
 * Searchable list in a bottom sheet: on a phone, typing "35" or "boum" beats scrolling a
 * 69-entry <select>. Falls back gracefully (it is a plain button + list, no library).
 */
export function Picker<V extends string | number>({
  id,
  title,
  placeholder,
  searchPlaceholder,
  value,
  options,
  onChange,
  disabled = false,
  invalid = false,
  loading = false,
}: {
  id: string;
  title: string;
  placeholder: string;
  searchPlaceholder: string;
  value: V | null;
  options: PickerOption<V>[];
  onChange: (v: V) => void;
  disabled?: boolean;
  invalid?: boolean;
  loading?: boolean;
}) {
  const { t } = useLocale();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const searchRef = useRef<HTMLInputElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const selected = options.find((o) => o.value === value);

  const indexed = useMemo(() => options.map((o) => ({ o, text: normalizeSearch(`${o.label} ${o.keywords ?? ""}`) })), [options]);
  const q = normalizeSearch(query);
  const shown = q ? indexed.filter((x) => x.text.split(/[\s\-–,()]+/).some((w) => w.startsWith(q)) || x.text.includes(q)).map((x) => x.o) : options;

  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    // focus the search field without the keyboard jumping the page on iOS
    const id = setTimeout(() => searchRef.current?.focus({ preventScroll: true }), 30);
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && close();
    window.addEventListener("keydown", onKey);
    return () => {
      document.body.style.overflow = prev;
      clearTimeout(id);
      window.removeEventListener("keydown", onKey);
    };
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps

  function close() {
    setOpen(false);
    setQuery("");
    triggerRef.current?.focus();
  }

  function pick(o: PickerOption<V>) {
    if (o.disabled) return;
    onChange(o.value);
    close();
  }

  return (
    <>
      <button
        ref={triggerRef}
        id={id}
        type="button"
        disabled={disabled}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-invalid={invalid || undefined}
        onClick={() => setOpen(true)}
        className={`${inputCls} flex items-center justify-between gap-2 text-start disabled:cursor-not-allowed disabled:opacity-60 ${invalid ? "border-danger focus:border-danger" : ""}`}
      >
        <span className={`truncate ${selected ? "text-ink" : "text-ink-soft/70"}`}>{selected?.label ?? placeholder}</span>
        {loading ? <Spinner className="size-4 shrink-0 text-ink-soft" /> : <span aria-hidden="true" className="shrink-0 text-ink-soft">▾</span>}
      </button>

      {open && (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-ink/40 md:items-center" onClick={close}>
          <div
            role="dialog"
            aria-modal="true"
            aria-label={title}
            onClick={(e) => e.stopPropagation()}
            className="flex max-h-[85dvh] w-full flex-col rounded-t-3xl bg-ivory shadow-soft md:max-h-[70vh] md:max-w-md md:rounded-3xl"
          >
            <div className="flex items-center justify-between gap-3 px-4 pb-2 pt-4">
              <p className="font-semibold">{title}</p>
              <button type="button" onClick={close} className="grid size-10 place-items-center rounded-full text-xl text-ink-soft hover:bg-rose-100" aria-label={t.common.close}>
                ×
              </button>
            </div>
            <div className="px-4 pb-3">
              <input
                ref={searchRef}
                type="search"
                inputMode="search"
                enterKeyHint="search"
                autoComplete="off"
                className={inputCls}
                placeholder={searchPlaceholder}
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && shown.length) {
                    e.preventDefault();
                    const first = shown.find((o) => !o.disabled);
                    if (first) pick(first);
                  }
                }}
              />
            </div>
            <ul className="flex-1 overflow-y-auto overscroll-contain px-2 pb-[max(1rem,env(safe-area-inset-bottom))]" role="listbox" aria-label={title}>
              {shown.length === 0 && <li className="px-3 py-6 text-center text-sm text-ink-soft">{t.picker.none}</li>}
              {shown.map((o) => (
                <li key={String(o.value)} role="option" aria-selected={o.value === value} aria-disabled={o.disabled || undefined}>
                  <button
                    type="button"
                    disabled={o.disabled}
                    onClick={() => pick(o)}
                    className={`flex min-h-12 w-full items-center justify-between gap-3 rounded-xl px-3 py-2.5 text-start transition hover:bg-rose-100/60 disabled:opacity-40 ${o.value === value ? "bg-rose-100 font-semibold text-plum-700" : ""}`}
                  >
                    <span>{o.label}</span>
                    {o.hint && <span className="shrink-0 text-sm text-ink-soft" dir="ltr">{o.hint}</span>}
                  </button>
                </li>
              ))}
            </ul>
          </div>
        </div>
      )}
    </>
  );
}
