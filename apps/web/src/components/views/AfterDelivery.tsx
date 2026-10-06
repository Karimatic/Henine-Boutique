/**
 * After delivery, from the customer's private tracking link: "did you get it?" (yes, or what
 * went wrong) and asking for an exchange (another size / colour of the same piece).
 */
import { useState } from "react";
import {
  EXCHANGE_REASON_LABEL,
  EXCHANGE_REASONS,
  EXCHANGE_STATUS_LABEL,
  RECEIPT_ISSUE_LABEL,
  RECEIPT_ISSUES,
  type ExchangeReason,
  type ExchangeStatus,
  type ProductDetailDTO,
  type ReceiptIssue,
  type TrackedItemDTO,
  type TrackedOrderDTO,
} from "@henine/shared";
import { inputCls, Spinner } from "@/components/ui/kit";
import { ApiError, apiGet, apiPost } from "@/lib/api";
import { useLocale } from "@/lib/locale";

export function ReceiptPrompt({ o, token, onChanged }: { o: TrackedOrderDTO; token: string; onChanged: (msg: string) => void }) {
  const { t, ar } = useLocale();
  const A = t.afterDelivery;
  const [mode, setMode] = useState<"ask" | "problem">("ask");
  const [issue, setIssue] = useState<ReceiptIssue>("damaged");
  const [details, setDetails] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  if (!o.receipt) return null;
  if (o.receipt.confirmedAt) return <p className="rounded-2xl bg-emerald-50 p-3 text-sm font-medium text-emerald-800">{A.confirmed}</p>;
  if (o.receipt.issue) return <p className="rounded-2xl bg-amber-50 p-3 text-sm font-medium text-amber-900">{A.reported}</p>;

  async function send(ok: boolean) {
    setBusy(true);
    setError(null);
    try {
      await apiPost(`/track/${o.code}/receipt`, { t: token, ok, ...(ok ? {} : { issue, details: details.trim() || undefined }) });
      onChanged(ok ? A.thanks : A.problemSent);
    } catch {
      setError(t.common.error);
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="rounded-2xl border border-plum-600/20 bg-rose-100/40 p-4">
      <p className="font-semibold">{A.receiptTitle}</p>
      {mode === "ask" ? (
        <div className="mt-3 grid gap-2 sm:grid-cols-2">
          <button type="button" disabled={busy} onClick={() => void send(true)} className="flex h-12 items-center justify-center gap-2 rounded-full bg-plum-600 px-5 text-sm font-semibold text-white disabled:opacity-50">
            {busy && <Spinner className="size-4" />}
            {A.yes}
          </button>
          <button type="button" onClick={() => setMode("problem")} className="h-12 rounded-full border border-ink/15 bg-surface px-5 text-sm font-semibold">
            {A.problem}
          </button>
        </div>
      ) : (
        <div className="mt-3 space-y-3">
          <fieldset>
            <legend className="text-sm font-medium">{A.whatProblem}</legend>
            <div className="mt-2 grid gap-2">
              {RECEIPT_ISSUES.map((k) => (
                <label key={k} className={`flex min-h-11 cursor-pointer items-center gap-3 rounded-xl border px-3 text-sm ${issue === k ? "border-plum-600 bg-surface" : "border-line bg-surface/60"}`}>
                  <input type="radio" name={`issue-${o.code}`} checked={issue === k} onChange={() => setIssue(k)} className="accent-plum-600" />
                  {ar ? RECEIPT_ISSUE_LABEL[k].ar : RECEIPT_ISSUE_LABEL[k].fr}
                </label>
              ))}
            </div>
          </fieldset>
          <label className="block text-sm font-medium">
            {A.details}
            <textarea className={`${inputCls} mt-1 h-auto py-2.5`} rows={2} maxLength={500} value={details} onChange={(e) => setDetails(e.target.value)} />
          </label>
          <div className="flex flex-wrap gap-2">
            <button type="button" disabled={busy} onClick={() => void send(false)} className="flex h-11 items-center gap-2 rounded-full bg-plum-600 px-5 text-sm font-semibold text-white disabled:opacity-50">
              {busy && <Spinner className="size-4" />}
              {A.send}
            </button>
            <button type="button" onClick={() => setMode("ask")} className="h-11 rounded-full px-4 text-sm font-semibold text-ink-soft">
              {A.back}
            </button>
          </div>
        </div>
      )}
      {error && <p className="mt-2 text-sm text-danger">{error}</p>}
    </section>
  );
}

/** Under an item: its exchange requests, and the button to ask for one. */
export function ExchangeAction({ o, item, token, onChanged }: { o: TrackedOrderDTO; item: TrackedItemDTO; token: string; onChanged: (msg: string) => void }) {
  const { t, ar } = useLocale();
  const A = t.afterDelivery;
  const mine = o.exchanges.filter((x) => x.orderItemId === item.orderItemId);
  const open = mine.some((x) => x.status === "pending" || x.status === "approved");
  const [form, setForm] = useState(false);
  const [product, setProduct] = useState<ProductDetailDTO | null>(null);
  const [variant, setVariant] = useState<number | null>(null);
  const [reason, setReason] = useState<ExchangeReason>("too_small");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function start() {
    setForm(true);
    if (!product && item.slug) setProduct(await apiGet<ProductDetailDTO>(`/products/${item.slug}`).catch(() => null));
  }
  async function send() {
    if (!variant || item.orderItemId == null) return;
    setBusy(true);
    setError(null);
    try {
      await apiPost(`/track/${o.code}/exchange`, { t: token, orderItemId: item.orderItemId, toVariantId: variant, reason, note: note.trim() || undefined });
      setForm(false);
      onChanged(A.requestSent);
    } catch (err) {
      setError(err instanceof ApiError && err.code === "exchange_pending" ? A.pending : err instanceof ApiError && err.code === "exchange_closed" ? A.closed : t.common.error);
    } finally {
      setBusy(false);
    }
  }
  const label = (ids: number[]) =>
    (product?.options ?? [])
      .map((op) => op.values.find((v) => ids.includes(v.id)))
      .filter(Boolean)
      .map((v) => (ar ? v!.labelAr : v!.labelFr))
      .join(" / ");

  return (
    <div className="mt-2 space-y-1.5">
      {mine.map((x) => (
        <p key={x.id} className="text-sm">
          🔄 {A.exchangeLabel} : {ar ? x.fromAr : x.fromFr} → <b>{ar ? x.toAr : x.toFr}</b> ·{" "}
          <span className="font-semibold text-plum-700">{ar ? EXCHANGE_STATUS_LABEL[x.status as ExchangeStatus]?.ar : EXCHANGE_STATUS_LABEL[x.status as ExchangeStatus]?.fr}</span>
        </p>
      ))}
      {o.canExchange && !open && !form && (
        <button type="button" onClick={() => void start()} className="text-sm font-semibold text-plum-600">
          {A.exchange}
        </button>
      )}
      {form && (
        <div className="mt-2 space-y-3 rounded-2xl border border-line bg-ivory p-3">
          <p className="text-sm text-ink-soft">{A.exchangeText}</p>
          {!product ? (
            <Spinner className="size-5" />
          ) : (
            <fieldset>
              <legend className="text-sm font-medium">{A.newVariant}</legend>
              <div className="mt-2 flex flex-wrap gap-2">
                {product.variants
                  .filter((v) => v.id !== item.variantId)
                  .map((v) => (
                    <button
                      key={v.id}
                      type="button"
                      disabled={v.available <= 0}
                      aria-pressed={variant === v.id}
                      onClick={() => setVariant(v.id)}
                      className={`min-h-11 rounded-full border px-4 text-sm ${variant === v.id ? "border-plum-600 bg-plum-600 text-white" : "border-line bg-surface"} disabled:opacity-40`}
                    >
                      {label(v.optionValueIds) || v.sku}
                      {v.available <= 0 ? ` · ${A.soldOut}` : ""}
                    </button>
                  ))}
              </div>
            </fieldset>
          )}
          <label className="block text-sm font-medium">
            {A.reason}
            <select className={`${inputCls} mt-1`} value={reason} onChange={(e) => setReason(e.target.value as ExchangeReason)}>
              {EXCHANGE_REASONS.map((r) => (
                <option key={r} value={r}>
                  {ar ? EXCHANGE_REASON_LABEL[r].ar : EXCHANGE_REASON_LABEL[r].fr}
                </option>
              ))}
            </select>
          </label>
          <label className="block text-sm font-medium">
            {A.note}
            <input className={`${inputCls} mt-1`} maxLength={500} value={note} onChange={(e) => setNote(e.target.value)} />
          </label>
          <div className="flex flex-wrap gap-2">
            <button type="button" disabled={busy || !variant} onClick={() => void send()} className="flex h-11 items-center gap-2 rounded-full bg-plum-600 px-5 text-sm font-semibold text-white disabled:opacity-50">
              {busy && <Spinner className="size-4" />}
              {A.sendRequest}
            </button>
            <button type="button" onClick={() => setForm(false)} className="h-11 rounded-full px-4 text-sm font-semibold text-ink-soft">
              {A.back}
            </button>
          </div>
          {error && <p className="text-sm text-danger">{error}</p>}
        </div>
      )}
    </div>
  );
}
