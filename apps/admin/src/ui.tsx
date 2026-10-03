/**
 * Admin UI kit: shapes and spacing follow the shadcn "admincn" template (rounded-xl cards,
 * rounded-lg controls, quiet borders), colours and fonts follow the storefront. Phone-first
 * (40 px+ targets, 16 px inputs, bottom sheets). Deliberately small: no component library.
 */
import { createContext, useCallback, useContext, useEffect, useId, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { STATUS_TONE, statusLabel } from "./lib/format";
import { tr } from "./i18n";

/* ── Buttons ── */

type Variant = "primary" | "secondary" | "ghost" | "danger";
const VARIANT: Record<Variant, string> = {
  primary: "bg-plum-600 text-white shadow-[0_1px_2px_rgb(157_23_77/0.25)] hover:bg-plum-700",
  secondary: "border border-line bg-surface text-ink shadow-[0_1px_2px_rgb(43_22_32/0.04)] hover:border-plum-600/60 hover:bg-rose-100/40",
  ghost: "text-ink-soft hover:bg-rose-100/70 hover:text-ink",
  danger: "border border-red-200 bg-surface text-red-700 hover:bg-red-50",
};

export function Button({
  variant = "secondary",
  size = "md",
  loading = false,
  className = "",
  children,
  ...rest
}: React.ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant; size?: "sm" | "md"; loading?: boolean }) {
  return (
    <button
      type="button"
      {...rest}
      disabled={rest.disabled || loading}
      className={`inline-flex items-center justify-center gap-2 rounded-lg font-semibold transition active:scale-[0.98] disabled:opacity-50 ${size === "sm" ? "h-9 px-3 text-sm" : "h-10 px-4 text-sm"} ${VARIANT[variant]} ${className}`}
    >
      {loading && <Spinner />}
      {children}
    </button>
  );
}

export function Spinner({ className = "size-4" }: { className?: string }) {
  return <span aria-hidden="true" className={`inline-block animate-spin rounded-full border-2 border-current border-t-transparent ${className}`} />;
}

/* ── Form fields ── */

export const inputCls =
  "h-10 w-full rounded-lg border border-line bg-surface px-3 text-ink shadow-[0_1px_2px_rgb(43_22_32/0.04)] outline-none transition placeholder:text-ink-soft/60 focus:border-plum-600 focus:ring-3 focus:ring-plum-600/15 disabled:bg-ivory-deep";

export function Field({ label, hint, error, children, className = "" }: { label: string; hint?: ReactNode; error?: string | null; children: (id: string) => ReactNode; className?: string }) {
  const id = useId();
  return (
    <div className={className}>
      <label htmlFor={id} className="mb-1 flex items-baseline justify-between gap-2 text-sm font-medium">
        {label}
        {hint && <span className="text-xs font-normal text-ink-soft">{hint}</span>}
      </label>
      {children(id)}
      {error && <p className="mt-1 text-sm text-red-700">{error}</p>}
    </div>
  );
}

export function TextField({ label, hint, error, className, ...rest }: React.InputHTMLAttributes<HTMLInputElement> & { label: string; hint?: ReactNode; error?: string | null }) {
  return <Field label={label} hint={hint} error={error} className={className}>{(id) => <input id={id} className={inputCls} {...rest} />}</Field>;
}

/** Arabic keyboards type ٠-٩ (or ۰-۹): read them as 0-9. */
const latinDigits = (s: string) => s.replace(/[٠-٩]/g, (d) => String(d.charCodeAt(0) - 0x660)).replace(/[۰-۹]/g, (d) => String(d.charCodeAt(0) - 0x6f0));

function parseWhole(text: string, min: number): number | null {
  const raw = latinDigits(text);
  const negative = min < 0 && /^\s*[-−]/.test(raw);
  const digits = raw.replace(/[^0-9]/g, "");
  return digits === "" ? null : Math.max(min, (negative ? -1 : 1) * Number(digits));
}

export function NumberField({ label, value, onChange, hint, min = 0, suffix, className }: { label: string; value: number | null; onChange: (v: number | null) => void; hint?: ReactNode; min?: number; suffix?: string; className?: string }) {
  // what's being typed ("-", "1٢"…) stays on screen; the parent gets the number
  const [text, setText] = useState(value == null ? "" : String(value));
  useEffect(() => {
    if (parseWhole(text, min) !== value) setText(value == null ? "" : String(value));
  }, [value]); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <Field label={label} hint={hint} className={className}>
      {/* number and its unit (DA / دج) laid out left-to-right together, also in Arabic */}
      {(id) => (
        <div className="relative" dir="ltr">
          <input
            id={id}
            className={`${inputCls} ${suffix ? "pe-12" : ""}`}
            type="text"
            inputMode={min < 0 ? "text" : "numeric"}
            dir="ltr"
            value={text}
            onChange={(e) => {
              const next = latinDigits(e.target.value).replace(min < 0 ? /[^0-9\-−]/g : /[^0-9]/g, "");
              setText(next);
              onChange(parseWhole(next, min));
            }}
          />
          {suffix && <span className="pointer-events-none absolute end-3.5 top-1/2 -translate-y-1/2 text-sm text-ink-soft">{suffix}</span>}
        </div>
      )}
    </Field>
  );
}

export function TextArea({ label, hint, className, rows = 4, ...rest }: React.TextareaHTMLAttributes<HTMLTextAreaElement> & { label: string; hint?: ReactNode }) {
  return <Field label={label} hint={hint} className={className}>{(id) => <textarea id={id} rows={rows} className={`${inputCls} h-auto py-2.5`} {...rest} />}</Field>;
}

export function Select({ label, className, children, ...rest }: React.SelectHTMLAttributes<HTMLSelectElement> & { label: string }) {
  return <Field label={label} className={className}>{(id) => <select id={id} className={inputCls} {...rest}>{children}</select>}</Field>;
}

export function Toggle({ checked, onChange, label, hint }: { checked: boolean; onChange: (v: boolean) => void; label: string; hint?: string }) {
  return (
    <label className="flex cursor-pointer items-start justify-between gap-4 py-2">
      <span>
        <span className="block text-sm font-medium">{label}</span>
        {hint && <span className="block text-xs text-ink-soft">{hint}</span>}
      </span>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        onClick={() => onChange(!checked)}
        className={`relative mt-0.5 h-6 w-11 shrink-0 rounded-full transition ${checked ? "bg-plum-600" : "bg-stone-300"}`}
      >
        <span className={`absolute top-0.5 size-5 rounded-full bg-surface shadow-sm transition-all ${checked ? "start-[1.4rem]" : "start-0.5"}`} />
      </button>
    </label>
  );
}

/* ── Layout ── */

export function PageHeader({ title, subtitle, actions, group }: { title: string; subtitle?: ReactNode; actions?: ReactNode; group?: string }) {
  return (
    <div className="mb-6 flex flex-wrap items-end justify-between gap-3">
      <div className="min-w-0">
        {group && <p className="text-xs font-medium text-ink-soft">{group}</p>}
        <h1 className="text-2xl font-semibold tracking-tight text-ink">{title}</h1>
        {subtitle && <p className="mt-1 text-sm text-ink-soft">{subtitle}</p>}
      </div>
      {actions && <div className="flex flex-wrap gap-2">{actions}</div>}
    </div>
  );
}

export function Card({ title, actions, children, className = "", padded = true }: { title?: ReactNode; actions?: ReactNode; children: ReactNode; className?: string; padded?: boolean }) {
  return (
    <section className={`rounded-xl border border-line bg-surface shadow-[0_1px_2px_rgb(43_22_32/0.04)] ${padded ? "p-4 md:p-6" : ""} ${className}`}>
      {(title || actions) && (
        <div className={`mb-4 flex items-center justify-between gap-2 ${padded ? "" : "px-4 pt-4 md:px-6 md:pt-6"}`}>
          {title && <h2 className="text-lg font-semibold">{title}</h2>}
          {actions}
        </div>
      )}
      {children}
    </section>
  );
}

export function Stat({ label, value, hint, tone }: { label: string; value: ReactNode; hint?: ReactNode; tone?: "good" | "warn" }) {
  return (
    <div className="rounded-xl border border-line bg-surface p-4 shadow-[0_1px_2px_rgb(43_22_32/0.04)] md:p-5">
      <p className="text-sm text-ink-soft">{label}</p>
      <p className={`mt-1.5 text-2xl font-semibold tabular-nums ${tone === "warn" ? "text-amber-700" : tone === "good" ? "text-emerald-700" : "text-ink"}`}>{value}</p>
      {hint && <p className="mt-0.5 text-xs text-ink-soft">{hint}</p>}
    </div>
  );
}

export function Badge({ children, tone = "bg-rose-100 text-plum-700" }: { children: ReactNode; tone?: string }) {
  return <span className={`inline-flex items-center whitespace-nowrap rounded-md px-2 py-0.5 text-xs font-semibold ${tone}`}>{children}</span>;
}

export function StatusBadge({ status }: { status: string }) {
  return <Badge tone={STATUS_TONE[status] ?? "bg-stone-100 text-stone-700"}>{statusLabel(status)}</Badge>;
}

export function Pills<T extends string>({ value, onChange, options }: { value: T; onChange: (v: T) => void; options: { value: T; label: ReactNode }[] }) {
  return (
    <div className="-mx-4 mb-4 flex gap-1 overflow-x-auto px-4 pb-1 [scrollbar-width:none] md:mx-0 md:w-fit md:max-w-full md:flex-wrap md:rounded-lg md:bg-ivory-deep/70 md:p-1">
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          onClick={() => onChange(o.value)}
          aria-pressed={value === o.value}
          className={`h-8 shrink-0 rounded-md border px-3 text-sm font-medium transition md:border-transparent ${value === o.value ? "border-plum-600 bg-plum-600 text-white shadow-sm md:bg-surface md:text-plum-700" : "border-line bg-surface text-ink-soft hover:text-ink md:bg-transparent"}`}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function SearchBox({ value, onChange, placeholder = "Rechercher…" }: { value: string; onChange: (v: string) => void; placeholder?: string }) {
  return (
    <input
      type="search"
      className={`${inputCls} mb-4`}
      placeholder={placeholder}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      aria-label={placeholder}
    />
  );
}

export function Empty({ icon = "🌸", title, children }: { icon?: string; title: string; children?: ReactNode }) {
  return (
    <div className="rounded-xl border border-dashed border-line bg-surface/60 px-6 py-12 text-center">
      <p className="mx-auto grid size-12 place-items-center rounded-full bg-rose-100 text-2xl">{icon}</p>
      <p className="mt-2 font-semibold">{title}</p>
      {children && <div className="mt-1 text-sm text-ink-soft">{children}</div>}
    </div>
  );
}

export function ListSkeleton({ rows = 5 }: { rows?: number }) {
  return (
    <div className="space-y-2" aria-busy="true">
      {Array.from({ length: rows }, (_, i) => (
        <div key={i} className="skeleton h-16 rounded-xl" />
      ))}
    </div>
  );
}

export function ErrorState({ error, onRetry }: { error: unknown; onRetry?: () => void }) {
  const msg = error instanceof Error ? error.message : "";
  return (
    <div className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-800">
      {tr("Impossible de charger (")}{msg}).
      {onRetry && (
        <button type="button" onClick={onRetry} className="ms-2 font-semibold underline">
          {tr("Réessayer")}
        </button>
      )}
    </div>
  );
}

/* ── Sheet: bottom sheet on phones, side panel on desktop ── */

export function Sheet({ open, onClose, title, children, footer, wide = false }: { open: boolean; onClose: () => void; title: ReactNode; children: ReactNode; footer?: ReactNode; wide?: boolean }) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    document.addEventListener("keydown", onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = prev;
    };
  }, [open, onClose]);
  if (!open) return null;
  return createPortal(
    <div className="fixed inset-0 z-50 flex items-end justify-center md:items-stretch md:justify-end" role="dialog" aria-modal="true">
      <button type="button" aria-label={tr("Fermer")} onClick={onClose} className="animate-fade absolute inset-0 bg-noir/40" />
      <div className={`animate-sheet relative flex max-h-[92dvh] w-full flex-col rounded-t-2xl bg-ivory shadow-2xl md:max-h-none md:rounded-none md:rounded-s-2xl ${wide ? "md:w-[44rem]" : "md:w-[32rem]"}`}>
        <div className="flex items-center justify-between gap-3 rounded-t-2xl border-b border-line/70 bg-surface px-4 py-3 md:rounded-none md:rounded-ss-2xl">
          <div className="min-w-0 font-semibold">{title}</div>
          <button type="button" onClick={onClose} className="grid size-9 shrink-0 place-items-center rounded-lg text-xl hover:bg-rose-100" aria-label={tr("Fermer")}>
            {tr("×")}
          </button>
        </div>
        <div className="flex-1 overflow-y-auto overscroll-contain p-4">{children}</div>
        {footer && <div className="border-t border-line/70 bg-surface p-3 pb-[calc(0.75rem+env(safe-area-inset-bottom))]">{footer}</div>}
      </div>
    </div>,
    document.body,
  );
}

/* ── Toasts ── */

interface Toast {
  id: number;
  text: string;
  tone: "ok" | "error";
}
const ToastCtx = createContext<(text: string, tone?: "ok" | "error") => void>(() => undefined);

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const push = useCallback((text: string, tone: "ok" | "error" = "ok") => {
    const id = Date.now() + Math.random();
    setToasts((t) => [...t, { id, text, tone }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), tone === "error" ? 5000 : 2800);
  }, []);
  return (
    <ToastCtx.Provider value={push}>
      {children}
      <div className="pointer-events-none fixed inset-x-0 bottom-[calc(5rem+env(safe-area-inset-bottom))] z-[60] flex flex-col items-center gap-2 px-4 md:bottom-6" aria-live="polite">
        {toasts.map((t) => (
          <div key={t.id} className={`animate-pop pointer-events-auto max-w-sm rounded-lg px-4 py-3 text-sm font-medium shadow-lg ${t.tone === "error" ? "bg-[#b3261e] text-white" : "bg-ink text-on-ink"}`}>

            {t.text}
          </div>
        ))}
      </div>
    </ToastCtx.Provider>
  );
}

export const useToast = () => useContext(ToastCtx);

export function confirmAction(message: string): boolean {
  return window.confirm(message);
}
