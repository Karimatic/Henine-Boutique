"use client";

import { useState } from "react";
import { normalizeDzPhone } from "@henine/shared";
import { inputCls, Spinner } from "@/components/ui/kit";
import { ApiError, apiPost, useApi } from "@/lib/api";
import { useLocale } from "@/lib/locale";
import { useSavedOrders } from "@/lib/stores";
import { Turnstile } from "@/lib/turnstile";
import type { SiteConfigDTO } from "@henine/shared";

/**
 * Verified review: tied to a delivered order. From the tracking page the private link's
 * token is the proof; from the product page the customer gives her order number + phone
 * (or picks an order saved on this device, which carries its token).
 */
export function ReviewForm({ productId, code: fixedCode, token: fixedToken, onDone }: { productId: number; code?: string; token?: string; onDone?: (status: string) => void }) {
  const { t, locale } = useLocale();
  const R = t.reviewsPlus;
  const site = useApi<SiteConfigDTO>("/site");
  const saved = useSavedOrders();
  const [code, setCode] = useState(fixedCode ?? saved[0]?.code ?? "");
  const [phone, setPhone] = useState("");
  const [rating, setRating] = useState(5);
  const [text, setText] = useState("");
  const [turnstile, setTurnstile] = useState("");
  const [state, setState] = useState<"idle" | "sending" | "error">("idle");
  const [error, setError] = useState<string | null>(null);

  const normalizedCode = code.trim().toUpperCase();
  const token = fixedToken ?? saved.find((o) => o.code === normalizedCode)?.token;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    const p = token ? null : normalizeDzPhone(phone);
    if (!/^HN-[0-9A-Z]{4,10}$/.test(normalizedCode)) return setError(R.errors.order_not_found!);
    if (!token && !p) return setError(t.checkout.errors.phone_invalid!);
    setState("sending");
    try {
      const res = await apiPost<{ status: string }>("/reviews", {
        code: normalizedCode,
        token,
        phone: p ?? undefined,
        productId,
        rating,
        text: text.trim() || undefined,
        turnstileToken: turnstile || "pending",
      });
      setState("idle");
      onDone?.(res.status);
    } catch (err) {
      const c = err instanceof ApiError ? err.code : "generic";
      setError(R.errors[c] ?? t.checkout.errors[c] ?? t.checkout.errors.generic!);
      setState("error");
    }
  }

  return (
    <form onSubmit={submit} className="space-y-3">
      <fieldset>
        <legend className="mb-1 text-sm font-medium">{R.rate}</legend>
        <div className="flex gap-1" role="radiogroup" aria-label={R.rate} dir="ltr">
          {[1, 2, 3, 4, 5].map((n) => (
            <button key={n} type="button" role="radio" aria-checked={rating === n} aria-label={`${n}/5`} onClick={() => setRating(n)} className={`text-3xl leading-none ${n <= rating ? "text-gold" : "text-line"}`}>
              ★
            </button>
          ))}
        </div>
      </fieldset>
      {!fixedCode && (
        <div className="grid gap-3 sm:grid-cols-2">
          <input className={`${inputCls} uppercase`} dir="ltr" placeholder={R.code} aria-label={R.code} value={code} onChange={(e) => setCode(e.target.value)} maxLength={12} />
          {!token && (
            <input className={inputCls} type="tel" inputMode="tel" dir="ltr" placeholder={R.phone} aria-label={R.phone} value={phone} onChange={(e) => setPhone(e.target.value)} maxLength={20} />
          )}
        </div>
      )}
      <textarea className={`${inputCls} h-24 py-3`} placeholder={R.text} aria-label={R.text} value={text} onChange={(e) => setText(e.target.value)} maxLength={1000} />
      <Turnstile siteKey={site.data?.turnstileSiteKey ?? ""} onToken={setTurnstile} locale={locale} />
      {error && <p role="alert" className="text-sm text-danger">{error}</p>}
      <button type="submit" disabled={state === "sending"} className="flex h-11 items-center gap-2 rounded-full bg-plum-600 px-6 font-semibold text-ivory disabled:opacity-60">
        {state === "sending" && <Spinner className="size-4" />}
        {R.send}
      </button>
    </form>
  );
}
