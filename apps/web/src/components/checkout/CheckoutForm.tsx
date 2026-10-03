"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { formatDA, normalizeDzPhone, type CommuneDTO, type CreatedOrderDTO, type QuoteDTO, type SiteConfigDTO, type WilayaDTO } from "@henine/shared";
import { inputCls, ProductImage, Spinner } from "@/components/ui/kit";
import { ApiError, apiGet, apiPost, useApi } from "@/lib/api";
import { useLocale } from "@/lib/locale";
import { useStoreTexts } from "@/lib/storeTexts";
import { cart, checkoutMemory, pendingCoupon, saveOrder, takePendingCoupon } from "@/lib/stores";
import { newIdempotencyKey, Turnstile } from "@/lib/turnstile";
import { Picker } from "./Picker";

interface Props {
  lines: { variantId: number; qty: number }[];
  channel: "web" | "express";
  compact?: boolean;
}

/** One autosaved checkout per tab and per checkout kind (cart page vs. express on a product). */
const CART_KEY = (channel: string) => `henine.cartId.${channel}`;
function cartId(channel: string): string {
  try {
    let id = sessionStorage.getItem(CART_KEY(channel));
    if (!id) sessionStorage.setItem(CART_KEY(channel), (id = crypto.randomUUID()));
    return id;
  } catch {
    return crypto.randomUUID();
  }
}

export function CheckoutForm({ lines, channel, compact = false }: Props) {
  const { t, href, ar, locale } = useLocale();
  const L = t.checkout;
  const site = useApi<SiteConfigDTO>("/site");
  const texts = useStoreTexts();
  const wilayas = useApi<WilayaDTO[]>("/geo/wilayas");

  const memory = useMemo(() => checkoutMemory.get(), []);
  const [name, setName] = useState(memory?.name ?? "");
  const [phone, setPhone] = useState(memory?.phone ?? "");
  const [wilaya, setWilaya] = useState<number | null>(memory?.wilaya ?? null);
  const [communeId, setCommuneId] = useState<number | "other" | null>(memory?.communeId ?? null);
  const [communeText, setCommuneText] = useState("");
  const [deliveryType, setDeliveryType] = useState<"domicile" | "bureau">(memory?.deliveryType ?? "domicile");
  const [address, setAddress] = useState(memory?.address ?? "");
  const [note, setNote] = useState("");
  // a code brought by a link (cart reminder, campaign) is already filled in
  const linkedCoupon = useMemo(() => takePendingCoupon(), []);
  const [couponInput, setCouponInput] = useState(linkedCoupon ?? "");
  const [coupon, setCoupon] = useState(linkedCoupon ?? "");
  const [showCoupon, setShowCoupon] = useState(!!linkedCoupon);
  const [usePoints, setUsePoints] = useState(false);
  const [token, setToken] = useState("");
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const idem = useRef(newIdempotencyKey());

  const [communes, setCommunes] = useState<CommuneDTO[] | null>(null);
  useEffect(() => {
    setCommunes(null);
    if (!wilaya) return;
    apiGet<CommuneDTO[]>(`/geo/wilayas/${wilaya}/communes`).then(setCommunes, () => setCommunes([]));
  }, [wilaya]);

  const selectedWilaya = wilayas.data?.find((w) => w.code === wilaya);
  const selectedCommune = typeof communeId === "number" ? communes?.find((c) => c.id === communeId) : undefined;
  const deskAllowed = (site.data?.checkout.deskEnabled ?? true) && selectedWilaya?.desk != null;
  // home delivery: the commune may cost more than its wilaya, or be stop-desk only
  const homePrice = selectedCommune ? (selectedCommune.homeOk ? (selectedCommune.home ?? selectedWilaya?.home ?? null) : null) : (selectedWilaya?.home ?? null);
  useEffect(() => {
    if (selectedWilaya && deliveryType === "bureau" && !deskAllowed) setDeliveryType("domicile");
    if (selectedWilaya && deliveryType === "domicile" && homePrice == null && deskAllowed) setDeliveryType("bureau");
  }, [selectedWilaya, deskAllowed, deliveryType, homePrice]);

  // live authoritative price
  const [quote, setQuote] = useState<QuoteDTO | null>(null);
  const [quoting, setQuoting] = useState(false);
  const linesKey = JSON.stringify(lines);
  const quotePhone = normalizeDzPhone(phone) ?? undefined; // a full number shows her loyalty points
  const quoteBody = () => ({
    lines, wilaya, communeId: typeof communeId === "number" ? communeId : null, deliveryType, coupon: coupon || undefined, phone: quotePhone, usePoints,
  });
  useEffect(() => {
    if (!lines.length) return;
    setQuoting(true);
    const id = setTimeout(() => {
      apiPost<QuoteDTO>("/quote", quoteBody())
        .then(setQuote, () => undefined)
        .finally(() => setQuoting(false));
    }, 250);
    return () => clearTimeout(id);
  }, [linesKey, wilaya, communeId, deliveryType, coupon, quotePhone, usePoints]); // eslint-disable-line react-hooks/exhaustive-deps

  /*
   * Checkout autosave (abandoned checkouts): once the phone number is valid, the progress is
   * saved (debounced, only when something changed) so the team can call back. The notice
   * under the phone field tells the customer what the number is used for.
   */
  const normalizedPhone = normalizeDzPhone(phone);
  const step = !wilaya ? "details" : !communeId ? "address" : deliveryType === "domicile" && address.trim().length < 4 ? "delivery" : name.trim().length >= 2 ? "ready" : "delivery";
  const lastSaved = useRef("");
  useEffect(() => {
    if (!normalizedPhone || !lines.length) return;
    const payload = {
      id: cartId(channel),
      lines,
      phone: normalizedPhone,
      name: name.trim() || undefined,
      wilaya,
      communeId: typeof communeId === "number" ? communeId : null,
      deliveryType,
      step,
      channel,
      locale,
    };
    const key = JSON.stringify(payload);
    if (key === lastSaved.current) return;
    const id = setTimeout(() => {
      lastSaved.current = key;
      apiPost("/carts", payload).catch(() => undefined);
    }, 2000);
    return () => clearTimeout(id);
  }, [normalizedPhone, linesKey, name, wilaya, communeId, deliveryType, step, channel, locale]); // eslint-disable-line react-hooks/exhaustive-deps

  const problems = quote?.lines.filter((l) => l.problem) ?? [];

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const errs: Record<string, string> = {};
    if (name.trim().length < 2) errs.name = L.errors.name_required!;
    if (!normalizedPhone) errs.phone = L.errors.phone_invalid!;
    if (!wilaya) errs.wilaya = L.shippingPick;
    if (!communeId || (communeId === "other" && communeText.trim().length < 2)) errs.communeId = L.errors.commune_required!;
    if (deliveryType === "domicile" && address.trim().length < 4) errs.address = L.errors.address_required!;
    setFieldErrors(errs);
    setFormError(null);
    if (Object.keys(errs).length) {
      document.getElementById(`f-${Object.keys(errs)[0]}`)?.focus();
      return;
    }
    setSubmitting(true);
    try {
      const params = new URLSearchParams(location.search);
      const order = await apiPost<CreatedOrderDTO>("/orders", {
        idempotencyKey: idem.current,
        cartId: normalizedPhone ? cartId(channel) : undefined,
        name: name.trim(),
        phone: normalizedPhone,
        wilaya,
        communeId: communeId === "other" ? null : communeId,
        communeText: communeId === "other" ? communeText.trim() : undefined,
        deliveryType,
        address: deliveryType === "domicile" ? address.trim() : undefined,
        note: note.trim() || undefined,
        coupon: coupon || undefined,
        usePoints: !!quote?.points?.applied,
        lines,
        channel,
        locale,
        turnstileToken: token || "pending",
        utm: {
          source: params.get("utm_source") ?? undefined,
          medium: params.get("utm_medium") ?? undefined,
          campaign: params.get("utm_campaign") ?? undefined,
        },
      });
      saveOrder({ code: order.code, token: order.token, total: order.total, createdAt: Date.now() });
      if (coupon) pendingCoupon.set(null); // used: not offered again
      try {
        sessionStorage.removeItem(CART_KEY(channel)); // the next checkout is a new one
      } catch {
        /* private mode */
      }
      checkoutMemory.set({ name: name.trim(), phone: normalizedPhone!, wilaya, communeId: communeId === "other" ? null : communeId, address, deliveryType });
      if (channel === "web") cart.clear();
      location.href = href(`/merci?c=${order.code}&t=${encodeURIComponent(order.token)}`);
    } catch (err) {
      const e = err instanceof ApiError ? err : new ApiError(0, "generic");
      if (e.code === "validation_failed" && e.details && typeof e.details === "object") {
        const d = e.details as Record<string, string>;
        setFieldErrors(Object.fromEntries(Object.entries(d).map(([k, v]) => [k, L.errors[v] ?? L.errors.generic!])));
      } else if (e.code === "duplicate_order") {
        location.href = href("/suivi");
      } else {
        setFormError(e.code === "maintenance" ? texts.pause : (L.errors[e.code] ?? L.errors.generic!));
        if (e.code === "stock_problem" || e.code === "coupon_invalid") {
          apiPost<QuoteDTO>("/quote", quoteBody()).then(
            setQuote,
            () => undefined,
          );
        }
      }
      idem.current = newIdempotencyKey();
    } finally {
      setSubmitting(false);
    }
  }

  const label = (text: string, id: string, extra?: React.ReactNode) => (
    <label htmlFor={`f-${id}`} className="mb-1.5 flex items-baseline justify-between text-sm font-medium text-ink">
      {text}
      {extra}
    </label>
  );
  const err = (k: string) => fieldErrors[k] && <p className="mt-1 text-sm text-danger">{fieldErrors[k]}</p>;
  const invalid = (k: string) => (fieldErrors[k] ? "border-danger focus:border-danger" : "");

  return (
    <form onSubmit={submit} noValidate className={compact ? "space-y-4" : "grid gap-8 pb-20 md:pb-0 lg:grid-cols-[1fr_22rem]"}>
      <div className="space-y-4">
        <div>
          {label(L.name, "name")}
          <input id="f-name" className={`${inputCls} ${invalid("name")}`} autoComplete="name" value={name} onChange={(e) => setName(e.target.value)} maxLength={80} />
          {err("name")}
        </div>
        <div>
          {label(L.phone, "phone", <span className="text-xs font-normal text-ink-soft">{L.phoneHint}</span>)}
          <input
            id="f-phone"
            className={`${inputCls} ${invalid("phone")}`}
            type="tel"
            inputMode="tel"
            autoComplete="tel"
            dir="ltr"
            placeholder="05 55 12 34 56"
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            maxLength={20}
          />
          {err("phone")}
          <p className="mt-1.5 text-xs leading-relaxed text-ink-soft">{t.checkoutPlus.notice}</p>
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            {label(L.wilaya, "wilaya")}
            <Picker
              id="f-wilaya"
              title={t.picker.wilayaTitle}
              placeholder={L.shippingPick}
              searchPlaceholder={t.picker.searchWilaya}
              value={wilaya}
              invalid={!!fieldErrors.wilaya}
              loading={!wilayas.data}
              options={(wilayas.data ?? []).map((w) => ({
                value: w.code,
                label: `${w.code} - ${ar ? w.ar : w.fr}`,
                keywords: `${w.code} ${w.fr} ${w.ar}`,
                hint: w.home != null ? formatDA(w.home, locale) : w.desk != null ? formatDA(w.desk, locale) : undefined,
              }))}
              onChange={(code) => {
                setWilaya(code);
                setCommuneId(null);
              }}
            />
            {err("wilaya")}
          </div>
          <div>
            {label(L.commune, "communeId")}
            <Picker<number | "other">
              id="f-communeId"
              title={t.picker.communeTitle}
              placeholder={wilaya ? "—" : t.picker.pickWilayaFirst}
              searchPlaceholder={t.picker.searchCommune}
              value={communeId}
              disabled={!wilaya}
              invalid={!!fieldErrors.communeId}
              loading={!!wilaya && !communes}
              options={[
                ...(communes ?? []).map((c) => ({
                  value: c.id as number | "other",
                  label: ar ? c.ar : c.fr,
                  keywords: `${c.fr} ${c.ar}`,
                  hint: !c.homeOk ? L.desk : c.home != null ? formatDA(c.home, locale) : undefined,
                })),
                { value: "other" as const, label: L.communeOther },
              ]}
              onChange={setCommuneId}
            />
            {communeId === "other" && (
              <input className={`${inputCls} mt-2`} value={communeText} onChange={(e) => setCommuneText(e.target.value)} maxLength={80} aria-label={L.communeOther} />
            )}
            {err("communeId")}
          </div>
        </div>

        <fieldset>
          <legend className="mb-1.5 text-sm font-medium">{L.delivery}</legend>
          <div className="grid grid-cols-2 gap-3">
            {(["domicile", "bureau"] as const).map((type) => {
              const price = type === "domicile" ? homePrice : selectedWilaya?.desk;
              const disabled = !!selectedWilaya && (type === "bureau" ? !deskAllowed : price == null);
              return (
                <label
                  key={type}
                  className={`flex cursor-pointer flex-col rounded-2xl border-2 p-3 transition ${deliveryType === type ? "border-ink bg-surface" : "border-line bg-surface"} ${disabled ? "cursor-not-allowed opacity-50" : ""}`}
                >
                  <input type="radio" name="delivery" value={type} className="sr-only" checked={deliveryType === type} disabled={disabled} onChange={() => setDeliveryType(type)} />
                  <span className="text-sm font-semibold">{type === "domicile" ? L.home : L.desk}</span>
                  <span className="text-sm text-ink-soft" dir="ltr">
                    {selectedWilaya ? (price != null ? formatDA(price, locale) : "—") : "…"}
                  </span>
                </label>
              );
            })}
          </div>
          {selectedCommune && !selectedCommune.homeOk && <p className="mt-1.5 text-xs text-ink-soft">{t.checkoutPlus.homeUnavailable}</p>}
          {deliveryType === "bureau" && <p className="mt-1.5 text-xs text-ink-soft">{L.deskHint}</p>}
          {quote?.delay && wilaya && <p className="mt-1.5 text-xs font-medium text-plum-700">🚚 {t.checkoutPlus.delay(quote.delay)}</p>}
        </fieldset>

        {deliveryType === "domicile" && (
          <div>
            {label(L.address, "address")}
            <input id="f-address" className={`${inputCls} ${invalid("address")}`} autoComplete="street-address" value={address} onChange={(e) => setAddress(e.target.value)} maxLength={200} />
            {err("address")}
          </div>
        )}

        {!compact && (
          <div>
            {label(L.note, "note")}
            <textarea id="f-note" className={`${inputCls} h-20 py-3`} value={note} onChange={(e) => setNote(e.target.value)} maxLength={500} />
          </div>
        )}

      </div>


      {/* Summary */}
      <aside className={compact ? "space-y-3" : "h-fit space-y-4 rounded-card border border-line bg-surface/70 p-5 lg:sticky lg:top-24"}>
        {!compact && <h2 className="text-lg font-semibold">{L.summary}</h2>}
        {!compact && quote && (
          <ul className="space-y-3">
            {quote.lines.map((l) => (
              <li key={l.variantId} className="flex gap-3">
                <ProductImage image={l.image} alt="" className="aspect-[4/5] w-14 shrink-0 rounded-lg" />
                <div className="min-w-0 flex-1 text-sm">
                  <p className="line-clamp-1 font-medium">{ar ? l.nameAr : l.nameFr}</p>
                  <p className="text-ink-soft">
                    {ar ? l.optionsAr : l.optionsFr} × {l.qty}
                  </p>
                  {l.problem && <p className="text-danger">{l.problem === "insufficient_stock" ? t.cart.onlyLeft(l.available) : t.cart.unavailable}</p>}
                </div>
                <span className="text-sm font-medium" dir="ltr">
                  {formatDA(l.lineTotal, locale)}
                </span>
              </li>
            ))}
          </ul>
        )}

        {showCoupon ? (
          <div className="flex gap-2">
            <input className={`${inputCls} h-11 uppercase`} placeholder={L.coupon} value={couponInput} onChange={(e) => setCouponInput(e.target.value)} maxLength={32} dir="ltr" />
            <button type="button" onClick={() => setCoupon(couponInput.trim().toUpperCase())} className="h-11 shrink-0 rounded-xl border border-ink/15 px-4 text-sm font-semibold">
              {L.apply}
            </button>
          </div>
        ) : (
          <button type="button" onClick={() => setShowCoupon(true)} className="text-sm font-semibold text-plum-600 underline-offset-4 hover:underline">
            + {L.coupon}
          </button>
        )}
        {quote?.points && quote.points.usable > 0 && (
          <label className={`flex cursor-pointer items-start gap-3 rounded-2xl border p-3 text-sm transition ${usePoints ? "border-plum-600 bg-rose-100/60" : "border-line bg-surface"}`}>
            <input type="checkbox" className="mt-0.5 size-5 shrink-0 accent-plum-600" checked={usePoints} onChange={(e) => setUsePoints(e.target.checked)} />
            <span>
              <span className="block font-semibold">
                🎁 {L.points.use} <span dir="ltr">−{formatDA(quote.points.value, locale)}</span>
              </span>
              <span className="block text-ink-soft">{L.points.balance(quote.points.balance)}</span>
            </span>
          </label>
        )}
        {quote?.coupon && (
          <p className={`text-sm ${quote.coupon.valid ? "text-success" : "text-danger"}`}>
            {quote.coupon.valid ? `${L.couponOk} (${quote.coupon.label})` : L.couponBad[quote.coupon.reason ?? "unknown"] ?? L.couponBad.unknown}
          </p>
        )}

        <dl className="space-y-1.5 border-t border-line pt-3 text-sm">
          <div className="flex justify-between">
            <dt className="text-ink-soft">{t.cart.subtotal}</dt>
            <dd dir="ltr">{quote ? formatDA(quote.subtotal, locale) : "…"}</dd>
          </div>
          {quote && quote.discount > 0 && (
            <div className="flex justify-between text-success">
              <dt>{L.discount}</dt>
              <dd dir="ltr">−{formatDA(quote.discount, locale)}</dd>
            </div>
          )}
          <div className="flex justify-between">
            <dt className="text-ink-soft">{L.shipping}</dt>
            <dd dir="ltr">{!wilaya ? <span className="text-ink-soft">{L.shippingPick}</span> : quote?.shipping === 0 ? L.free : quote?.shipping != null ? formatDA(quote.shipping, locale) : "—"}</dd>
          </div>
          <div className="flex items-center justify-between border-t border-line pt-2 text-base font-semibold">
            <dt>{L.total}</dt>
            <dd dir="ltr" className="flex items-center gap-2">
              {quoting && <Spinner className="size-3.5 text-ink-soft" />}
              {quote ? formatDA(quote.total, locale) : "…"}
            </dd>
          </div>
        </dl>
        <p className="text-sm font-medium text-ink-soft">{L.cod}</p>

        <Turnstile siteKey={site.data?.turnstileSiteKey ?? ""} onToken={setToken} locale={locale} />
        {formError && (
          <p role="alert" className="rounded-xl bg-rose-100 p-3 text-sm text-rose-700">
            {formError}
          </p>
        )}
        <button
          type="submit"
          disabled={submitting || problems.length > 0 || !lines.length}
          className={`lift h-13 w-full items-center justify-center gap-2 rounded-full bg-plum-600 px-6 py-3.5 text-base font-semibold text-white disabled:opacity-50 ${compact ? "flex" : "hidden md:flex"}`}
        >
          {submitting && <Spinner className="size-4" />}
          {submitting ? L.submitting : L.submit}
        </button>
      </aside>

      {/* phones: the total and the confirm button stay in reach while filling the form */}
      {!compact && (
        <div className="fixed inset-x-0 bottom-[calc(4rem+env(safe-area-inset-bottom))] z-30 border-t border-line/80 bg-surface/95 px-3 py-2.5 shadow-[0_-8px_24px_rgb(23_10_16/0.08)] backdrop-blur md:hidden">
          <div className="flex items-center gap-3">
            <div className="min-w-0 flex-1 leading-tight">
              <p className="text-xs text-ink-soft">{L.total} · {L.cod}</p>
              <p className="flex items-center gap-1.5 text-lg font-bold" dir="ltr" style={{ justifyContent: ar ? "flex-end" : "flex-start" }}>
                {quoting && <Spinner className="size-3.5 text-ink-soft" />}
                {quote ? formatDA(quote.total, locale) : "…"}
              </p>
            </div>
            <button
              type="submit"
              disabled={submitting || problems.length > 0 || !lines.length}
              className="flex h-12 shrink-0 items-center gap-2 rounded-full bg-plum-600 px-6 font-semibold text-white shadow-[0_8px_20px_-6px_rgb(142_16_72/0.6)] transition active:scale-[0.97] disabled:opacity-50"
            >
              {submitting && <Spinner className="size-4" />}
              {submitting ? L.submitting : L.submit}
            </button>
          </div>
        </div>
      )}
    </form>
  );
}
