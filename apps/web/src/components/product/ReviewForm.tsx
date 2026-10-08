import { useState } from "react";
import { normalizeDzPhone } from "@henine/shared";
import { inputCls, Spinner } from "@/components/ui/kit";
import { ApiError, apiForm, useApi } from "@/lib/api";
import { useLocale } from "@/lib/locale";
import { useSavedOrders } from "@/lib/stores";
import { Turnstile, useTurnstileToken } from "@/lib/turnstile";
import type { SiteConfigDTO } from "@henine/shared";

/** A phone photo made light for upload: WebP, 1600 px at most (EXIF orientation applied by the browser). */
async function shrink(file: File): Promise<Blob> {
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, 1600 / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  canvas.getContext("2d")!.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close();
  const blob = await new Promise<Blob | null>((ok) => canvas.toBlob(ok, "image/webp", 0.82));
  // old Safari has no WebP encoder: JPEG then
  return blob && blob.type === "image/webp" ? blob : new Promise<Blob>((ok, ko) => canvas.toBlob((b) => (b ? ok(b) : ko(new Error("encode"))), "image/jpeg", 0.85));
}

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
  const turnstile = useTurnstileToken();
  const [state, setState] = useState<"idle" | "sending" | "error">("idle");
  const [photos, setPhotos] = useState<{ blob: Blob; url: string }[]>([]);
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
      const form = new FormData();
      form.set(
        "data",
        JSON.stringify({ code: normalizedCode, token, phone: p ?? undefined, productId, rating, text: text.trim() || undefined, turnstileToken: await turnstile.take() }),
      );
      for (const ph of photos) form.append("photo", ph.blob, ph.blob.type === "image/webp" ? "photo.webp" : "photo.jpg");
      const res = await apiForm<{ status: string }>("/reviews", form);
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
      <div>
        <div className="flex flex-wrap items-center gap-2">
          {photos.map((ph, i) => (
            <span key={ph.url} className="relative">
              <img src={ph.url} alt="" className="size-16 rounded-xl object-cover ring-1 ring-line" />
              <button
                type="button"
                onClick={() => setPhotos((list) => list.filter((_, j) => j !== i))}
                className="absolute -end-1.5 -top-1.5 grid size-6 place-items-center rounded-full bg-ink text-xs text-on-ink"
                aria-label={t.plus.reviews.remove}
              >
                ✕
              </button>
            </span>
          ))}
          {photos.length < 3 && (
            <label className="inline-flex h-11 cursor-pointer items-center rounded-full border border-dashed border-ink/25 px-4 text-sm font-semibold">
              {t.plus.reviews.photos}
              <input
                type="file"
                accept="image/*"
                multiple
                className="sr-only"
                onChange={async (e) => {
                  const files = [...(e.target.files ?? [])].slice(0, 3 - photos.length);
                  e.target.value = "";
                  for (const f of files) {
                    try {
                      const blob = await shrink(f);
                      setPhotos((list) => (list.length < 3 ? [...list, { blob, url: URL.createObjectURL(blob) }] : list));
                    } catch {
                      /* not an image */
                    }
                  }
                }}
              />
            </label>
          )}
        </div>
        {photos.length > 0 && <p className="mt-1 text-xs text-ink-soft">{t.plus.reviews.photosHint}</p>}
      </div>
      <Turnstile siteKey={site.data?.turnstileSiteKey ?? ""} onToken={turnstile.onToken} onReady={turnstile.onReady} locale={locale} />
      {error && <p role="alert" className="text-sm text-danger">{error}</p>}
      <button type="submit" disabled={state === "sending"} className="flex h-11 items-center gap-2 rounded-full bg-plum-600 px-6 font-semibold text-white disabled:opacity-60">
        {state === "sending" && <Spinner className="size-4" />}
        {R.send}
      </button>
    </form>
  );
}
