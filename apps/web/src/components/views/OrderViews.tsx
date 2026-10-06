import { useEffect, useState } from "react";
import { CUSTOMER_CANCEL_REASONS, dateLocale, formatDA, normalizeDzPhone, toE164, TRACKING_STEPS, trackingStepIndex, type SiteConfigDTO, type TrackedOrderDTO } from "@henine/shared";
import { ReviewForm } from "@/components/product/ReviewForm";
import { ExchangeAction, ReceiptPrompt } from "@/components/views/AfterDelivery";
import { ErrorBox, inputCls, PageTitle, ProductImage, Spinner } from "@/components/ui/kit";
import { ApiError, apiGet, apiPost, useApi } from "@/lib/api";
import { useLocale } from "@/lib/locale";
import { useSavedOrders } from "@/lib/stores";
import { Turnstile } from "@/lib/turnstile";

/* ───────── Thank you ───────── */

export function ThankYouView() {
  const { t, href, locale } = useLocale();
  const [params, setParams] = useState<{ code: string; token: string } | null>(null);
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    const p = new URLSearchParams(location.search);
    setParams({ code: p.get("c") ?? "", token: p.get("t") ?? "" });
  }, []);
  const { data: order } = useApi<TrackedOrderDTO>(params?.code ? `/track/${params.code}?t=${encodeURIComponent(params.token)}` : null);
  if (!params) return null;
  const link = `${location.origin}${href(`/suivi?c=${params.code}&t=${encodeURIComponent(params.token)}`)}`;
  const wa = `https://wa.me/?text=${encodeURIComponent(`🌸 Henine Boutique · ${params.code}\n${link}`)}`;

  return (
    <div className="mx-auto max-w-lg px-4 py-10 text-center">
      <div className="mx-auto mb-5 grid size-16 place-items-center rounded-full bg-rose-100 text-3xl">🌸</div>
      <h1 className="heading-display text-3xl">{t.thanks.title}</h1>
      <p className="mt-3 text-ink-soft">{t.thanks.text}</p>
      <div className="mt-6 rounded-card border border-line bg-surface/70 p-5">
        <p className="text-sm text-ink-soft">{t.thanks.code}</p>
        <p className="mt-1 font-mono text-2xl font-bold tracking-wider text-plum-700" dir="ltr">{params.code}</p>
        {order && (
          <p className="mt-2 text-sm text-ink-soft" dir="ltr">
            {formatDA(order.total, locale)}
          </p>
        )}
      </div>
      <div className="mt-6 grid gap-3">
        <a href={href(`/suivi?c=${params.code}&t=${encodeURIComponent(params.token)}`)} className="grid h-12 place-items-center rounded-full bg-plum-600 font-semibold text-white">
          {t.thanks.trackLink}
        </a>
        <a href={wa} target="_blank" rel="noopener noreferrer" className="grid h-12 place-items-center rounded-full bg-[#25D366] font-semibold text-white">
          {t.thanks.whatsapp}
        </a>
        <button
          type="button"
          onClick={() => navigator.clipboard?.writeText(link).then(() => setCopied(true))}
          className="h-12 rounded-full border border-ink/15 font-semibold"
        >
          {copied ? t.thanks.copied : t.thanks.copy}
        </button>
        <a href={href("/")} className="text-sm font-semibold text-plum-600">{t.thanks.back}</a>
      </div>
    </div>
  );
}

/* ───────── Tracking ───────── */

const CANCELLED = ["annulee", "doublon", "fausse"];
const RETURNED = ["retour", "retour_recu"];

function Timeline({ o }: { o: TrackedOrderDTO }) {
  const { t, locale } = useLocale();
  const T = t.trackPlus;
  const current = trackingStepIndex(o.status);
  const when = (status: string) => o.events.find((e) => e.status === status)?.at;
  const fmt = (ts: number) => new Date(ts).toLocaleString(dateLocale(locale), { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });

  if (CANCELLED.includes(o.status) || RETURNED.includes(o.status)) {
    return (
      <div className="rounded-2xl bg-ink/5 p-4">
        <p className="font-semibold">{t.status[o.status]}</p>
        <p className="mt-1 text-sm text-ink-soft">{CANCELLED.includes(o.status) ? T.cancelled : T.returned}</p>
      </div>
    );
  }
  return (
    <div>
      {o.status === "injoignable" && <p className="mb-4 rounded-2xl bg-amber-50 p-3 text-sm font-medium text-amber-900">📞 {T.waiting}</p>}
      <ol className="relative space-y-5 ps-9">
        <span aria-hidden="true" className="absolute bottom-3 start-[0.85rem] top-3 w-0.5 rounded bg-line" />
        {TRACKING_STEPS.map((s, i) => {
          const done = i <= current;
          const active = i === current;
          const ts = when(s) ?? (i === 0 ? o.createdAt : undefined);
          return (
            <li key={s} className="relative" aria-current={active ? "step" : undefined}>
              <span
                aria-hidden="true"
                className={`absolute -start-9 top-0 grid size-7 place-items-center rounded-full border-2 text-xs font-bold ${done ? "border-plum-600 bg-plum-600 text-white" : "border-line bg-ivory text-ink-soft"} ${active ? "ring-4 ring-plum-600/15" : ""}`}
              >
                {done ? "✓" : i + 1}
              </span>
              <p className={`text-sm ${done ? "font-semibold text-ink" : "text-ink-soft"}`}>{T.steps[s]}</p>
              {ts && done && (
                <p className="text-xs text-ink-soft">{fmt(ts)}</p>
              )}
              {active && <p className="mt-0.5 text-xs text-plum-700">{T.stepHint[s]}</p>}
            </li>
          );
        })}
      </ol>
    </div>
  );
}

/** Before confirmation: fix the address or cancel, from the private link. */
function SelfService({ o, token, onChanged }: { o: TrackedOrderDTO; token: string; onChanged: (msg: string) => void }) {
  const { t } = useLocale();
  const C = t.trackPlus.change;
  const [mode, setMode] = useState<"idle" | "edit" | "cancel">("idle");
  const [address, setAddress] = useState(o.details?.address ?? "");
  const [note, setNote] = useState("");
  const [reason, setReason] = useState<(typeof CUSTOMER_CANCEL_REASONS)[number]>("changed_mind");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function run(path: "edit" | "cancel", payload: Record<string, unknown>, ok: string) {
    setBusy(true);
    setError(null);
    try {
      await apiPost(`/track/${o.code}/${path}`, { t: token, ...payload });
      setMode("idle");
      onChanged(ok);
    } catch (err) {
      setError(err instanceof ApiError && err.code === "already_confirmed" ? C.tooLate : t.common.error);
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="rounded-2xl border border-plum-600/20 bg-rose-100/40 p-4">
      <p className="font-semibold">{C.title}</p>
      <p className="mt-1 text-sm text-ink-soft">{C.text}</p>
      {mode === "idle" && (
        <div className="mt-3 flex flex-wrap gap-2">
          <button type="button" onClick={() => setMode("edit")} className="h-11 rounded-full bg-plum-600 px-5 text-sm font-semibold text-white">
            {C.edit}
          </button>
          <button type="button" onClick={() => setMode("cancel")} className="h-11 rounded-full border border-ink/15 bg-surface px-5 text-sm font-semibold text-danger">
            {C.cancel}
          </button>
        </div>
      )}
      {mode === "edit" && (
        <form
          className="mt-3 space-y-3"
          onSubmit={(e) => {
            e.preventDefault();
            void run("edit", { address: address.trim(), note: note.trim() || undefined }, C.saved);
          }}
        >
          <label className="block text-sm font-medium">
            {C.address}
            <textarea className={`${inputCls} mt-1 h-auto py-2.5`} rows={2} value={address} maxLength={300} required minLength={3} onChange={(e) => setAddress(e.target.value)} />
          </label>
          <label className="block text-sm font-medium">
            {C.note}
            <input className={`${inputCls} mt-1`} value={note} maxLength={300} onChange={(e) => setNote(e.target.value)} />
          </label>
          <div className="flex flex-wrap gap-2">
            <button type="submit" disabled={busy || address.trim().length < 3} className="flex h-11 items-center gap-2 rounded-full bg-plum-600 px-5 text-sm font-semibold text-white disabled:opacity-50">
              {busy && <Spinner className="size-4" />}
              {C.save}
            </button>
            <button type="button" onClick={() => setMode("idle")} className="h-11 rounded-full px-4 text-sm font-semibold text-ink-soft">
              {t.common.back}
            </button>
          </div>
        </form>
      )}
      {mode === "cancel" && (
        <div className="mt-3 space-y-3 rounded-2xl bg-surface p-3">
          <p className="font-semibold">{C.cancelTitle}</p>
          <label className="block text-sm font-medium">
            {C.reason}
            <select className={`${inputCls} mt-1`} value={reason} onChange={(e) => setReason(e.target.value as typeof reason)}>
              {CUSTOMER_CANCEL_REASONS.map((r) => (
                <option key={r} value={r}>
                  {C.reasons[r]}
                </option>
              ))}
            </select>
          </label>
          <div className="flex flex-wrap gap-2">
            <button type="button" disabled={busy} onClick={() => void run("cancel", { reason }, C.cancelled)} className="flex h-11 items-center gap-2 rounded-full bg-danger px-5 text-sm font-semibold text-white disabled:opacity-50">
              {busy && <Spinner className="size-4" />}
              {C.confirmCancel}
            </button>
            <button type="button" onClick={() => setMode("idle")} className="h-11 rounded-full border border-ink/15 bg-surface px-5 text-sm font-semibold">
              {C.keep}
            </button>
          </div>
        </div>
      )}
      {error && <p className="mt-2 text-sm text-danger">{error}</p>}
    </section>
  );
}

function OrderCard({ o: initial, token }: { o: TrackedOrderDTO; token?: string }) {
  const { t, ar, locale, href } = useLocale();
  const T = t.trackPlus;
  const [o, setO] = useState(initial);
  const [notice, setNotice] = useState<string | null>(null);
  useEffect(() => setO(initial), [initial]);
  const changed = (msg: string) => {
    setNotice(msg);
    if (token) apiGet<TrackedOrderDTO>(`/track/${o.code}?t=${encodeURIComponent(token)}`).then(setO, () => undefined);
  };
  const site = useApi<SiteConfigDTO>("/site");
  const [reviewing, setReviewing] = useState<number | null>(null);
  const [reviewed, setReviewed] = useState<number[]>([]);
  const wa = site.data?.contact.whatsapp ? toE164(site.data.contact.whatsapp)?.replace("+", "") : null;
  const money = (n: number) => <span dir="ltr">{formatDA(n, locale)}</span>;
  const closed = CANCELLED.includes(o.status) || RETURNED.includes(o.status);
  const settled = o.status === "livree" || closed;

  return (
    <article className="overflow-hidden rounded-card border border-line bg-surface/70">
      <header className="flex flex-wrap items-center justify-between gap-2 border-b border-line bg-ivory-deep/60 px-5 py-4">
        <div>
          <p className="font-mono text-lg font-bold tracking-wide text-plum-700" dir="ltr">
            {o.code}
          </p>
          <p className="text-xs text-ink-soft">
            {t.track.placedOn} {new Date(o.createdAt).toLocaleDateString(dateLocale(locale), { day: "numeric", month: "long", year: "numeric" })}
          </p>
        </div>
        <span className={`rounded-full px-3 py-1 text-xs font-semibold ${closed ? "bg-ink/10 text-ink" : o.status === "livree" ? "bg-emerald-100 text-emerald-800" : "bg-rose-100 text-plum-700"}`}>
          {t.status[o.status]}
        </span>
      </header>

      <div className="grid gap-6 p-5 md:grid-cols-2">
        <div className="space-y-4">
          {notice && <p className="rounded-2xl bg-emerald-50 p-3 text-sm font-medium text-emerald-800">{notice}</p>}
          <Timeline o={o} />
          {token && o.canChange && <SelfService o={o} token={token} onChanged={changed} />}
          {token && o.receipt && <ReceiptPrompt o={o} token={token} onChanged={changed} />}
          {o.trackingNumber && (
            <p className="rounded-2xl bg-rose-100 p-3 text-sm">
              {t.track.trackingNumber} :{" "}
              <b dir="ltr" className="font-mono">
                {o.trackingNumber}
              </b>
            </p>
          )}
        </div>

        <div className="space-y-4">
          <section>
            <h3 className="mb-2 text-sm font-semibold">{T.items}</h3>
            <ul className="divide-y divide-line">
              {o.items.map((i, k) => (
                <li key={k} className="py-2.5">
                  <div className="flex items-center gap-3 text-sm">
                    <ProductImage image={i.image} alt="" className="aspect-[4/5] w-12 shrink-0 rounded-lg" />
                    <div className="min-w-0 flex-1">
                      {i.slug ? (
                        <a href={href(`/produit/${i.slug}`)} className="line-clamp-1 font-medium hover:text-plum-700">
                          {ar ? i.nameAr : i.nameFr}
                        </a>
                      ) : (
                        <p className="line-clamp-1 font-medium">{ar ? i.nameAr : i.nameFr}</p>
                      )}
                      {(ar ? i.optionsAr : i.options) && <p className="text-ink-soft">{ar ? i.optionsAr : i.options}</p>}
                      <p className="text-ink-soft" dir="ltr" style={{ textAlign: ar ? "right" : "left" }}>
                        {i.qty} × {formatDA(i.unitPrice, locale)}
                      </p>
                    </div>
                    <span className="shrink-0 font-medium">{money(i.unitPrice * i.qty)}</span>
                  </div>
                  {token && i.canReview && i.productId != null && !reviewed.includes(i.productId) ? (
                    reviewing === i.productId ? (
                      <div className="mt-3 rounded-2xl border border-line bg-ivory p-3">
                        <ReviewForm
                          productId={i.productId}
                          code={o.code}
                          token={token}
                          onDone={() => {
                            setReviewed((r) => [...r, i.productId!]);
                            setReviewing(null);
                          }}
                        />
                      </div>
                    ) : (
                      <button type="button" onClick={() => setReviewing(i.productId)} className="mt-2 text-sm font-semibold text-plum-600">
                        ★ {t.reviewsPlus.leave}
                      </button>
                    )
                  ) : null}
                  {i.productId != null && reviewed.includes(i.productId) && <p className="mt-2 text-sm text-success">{t.reviewsPlus.sent}</p>}
                  {token && i.orderItemId != null && (o.canExchange || o.exchanges.some((x) => x.orderItemId === i.orderItemId)) && (
                    <ExchangeAction o={o} item={i} token={token} onChanged={changed} />
                  )}
                </li>
              ))}
            </ul>
          </section>

          <dl className="space-y-1.5 rounded-2xl bg-ivory-deep/60 p-4 text-sm">
            <div className="flex justify-between">
              <dt className="text-ink-soft">{T.subtotal}</dt>
              <dd>{money(o.subtotal)}</dd>
            </div>
            {o.discount > 0 && (
              <div className="flex justify-between text-success">
                <dt>{T.discount}</dt>
                <dd dir="ltr">−{formatDA(o.discount, locale)}</dd>
              </div>
            )}
            <div className="flex justify-between">
              <dt className="text-ink-soft">{T.shipping}</dt>
              <dd>{o.shipping === 0 ? t.checkout.free : money(o.shipping)}</dd>
            </div>
            <div className="flex justify-between border-t border-line pt-2 text-base font-semibold">
              <dt>{settled ? T.total : T.toPay}</dt>
              <dd>{money(o.total)}</dd>
            </div>
          </dl>

          <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 text-sm">
            <dt className="text-ink-soft">{T.method}</dt>
            <dd>{o.deliveryType === "bureau" ? t.track.desk : t.track.home}</dd>
            <dt className="text-ink-soft">{T.wilaya}</dt>
            <dd>
              {o.wilayaCode} - {ar ? o.wilayaAr : o.wilayaFr}
            </dd>
            {(o.communeFr || o.communeAr) && (
              <>
                <dt className="text-ink-soft">{T.commune}</dt>
                <dd>{ar ? (o.communeAr ?? o.communeFr) : o.communeFr}</dd>
              </>
            )}
            {o.details?.address && (
              <>
                <dt className="text-ink-soft">{T.address}</dt>
                <dd>{o.details.address}</dd>
              </>
            )}
            {o.details && (
              <>
                <dt className="text-ink-soft">{T.recipient}</dt>
                <dd>
                  {o.details.name} · <span dir="ltr">{o.details.phoneMasked}</span>
                </dd>
              </>
            )}
          </dl>

          {wa && (
            <a
              href={`https://wa.me/${wa}?text=${encodeURIComponent(`${ar ? "مرحبا، بخصوص طلبي" : "Bonjour, à propos de ma commande"} ${o.code}`)}`}
              target="_blank"
              rel="noopener noreferrer"
              className="flex min-h-11 items-center justify-center gap-2 rounded-full border border-[#25D366] px-4 py-2 text-center text-sm font-semibold text-[#128C7E]"
            >
              💬 {T.help} {T.whatsappUs}
            </a>
          )}
        </div>
      </div>
    </article>
  );
}

export function TrackView() {
  const { t, locale } = useLocale();
  const saved = useSavedOrders();
  const site = useApi<SiteConfigDTO>("/site");
  const [linkOrder, setLinkOrder] = useState<TrackedOrderDTO | null>(null);
  const [linkToken, setLinkToken] = useState<string | undefined>();
  const [mine, setMine] = useState<TrackedOrderDTO[]>([]);
  const [phone, setPhone] = useState("");
  const [code, setCode] = useState("");
  const [token, setToken] = useState("");
  const [results, setResults] = useState<TrackedOrderDTO[] | null>(null);
  const [state, setState] = useState<"idle" | "loading" | "error" | "invalid">("idle");

  // 1) private link (?c=&t=)
  useEffect(() => {
    const p = new URLSearchParams(location.search);
    const c = p.get("c");
    const tk = p.get("t");
    if (c && tk) {
      setLinkToken(tk);
      apiGet<TrackedOrderDTO>(`/track/${c}?t=${encodeURIComponent(tk)}`).then(setLinkOrder, () => undefined);
    }
  }, []);
  // 2) orders placed on this device
  useEffect(() => {
    Promise.all(saved.slice(0, 5).map((o) => apiGet<TrackedOrderDTO>(`/track/${o.code}?t=${encodeURIComponent(o.token)}`).catch(() => null))).then((list) =>
      setMine(list.filter((x): x is TrackedOrderDTO => !!x)),
    );
  }, [saved]);

  // 3) phone number lookup
  async function lookup(e: React.FormEvent) {
    e.preventDefault();
    const p = normalizeDzPhone(phone);
    if (!p) return setState("invalid");
    setState("loading");
    try {
      setResults(await apiPost<TrackedOrderDTO[]>("/track", { phone: p, code: code.trim() || undefined, turnstileToken: token || "pending" }));
      setState("idle");
    } catch (err) {
      setState(err instanceof ApiError && err.code === "validation_failed" ? "invalid" : "error");
    }
  }

  const shownCodes = new Set<string>();
  const dedupe = (list: TrackedOrderDTO[]) => list.filter((o) => (shownCodes.has(o.code) ? false : (shownCodes.add(o.code), true)));

  return (
    <div className="mx-auto max-w-3xl px-4 py-8">
      <PageTitle>{t.track.pageTitle}</PageTitle>
      <div className="space-y-4">
        {linkOrder && dedupe([linkOrder]).map((o) => <OrderCard key={o.code} o={o} token={linkToken} />)}
        {linkOrder && <p className="text-center text-xs text-ink-soft">🔒 {t.trackPlus.privateLink}</p>}
      </div>

      {/* with a private link open, the phone lookup folds away under "track another order" */}
      <details open={!linkOrder} className="group my-6 rounded-card border border-line bg-surface/60">
        <summary className={`cursor-pointer list-none px-5 py-4 text-sm font-semibold text-plum-700 ${linkOrder ? "" : "hidden"}`}>{t.trackPlus.other}</summary>
        <form onSubmit={lookup} className="space-y-3 p-5">
        <p className="text-sm text-ink-soft">{t.track.text}</p>
        <div className="grid gap-3 sm:grid-cols-[1fr_12rem]">
          <input className={inputCls} type="tel" inputMode="tel" dir="ltr" placeholder={t.track.phone} value={phone} onChange={(e) => setPhone(e.target.value)} aria-label={t.track.phone} />
          <input className={`${inputCls} uppercase`} dir="ltr" placeholder={t.track.code} value={code} onChange={(e) => setCode(e.target.value)} aria-label={t.track.code} maxLength={12} />
        </div>
        <Turnstile siteKey={site.data?.turnstileSiteKey ?? ""} onToken={setToken} locale={locale} />
        {state === "invalid" && <p className="text-sm text-danger">{t.checkout.errors.phone_invalid}</p>}
        {state === "error" && <ErrorBox />}
        <button type="submit" disabled={state === "loading"} className="flex h-12 items-center gap-2 rounded-full bg-plum-600 px-6 font-semibold text-white">
          {state === "loading" && <Spinner className="size-4" />}
          {t.track.search}
        </button>
        </form>
      </details>

      {results && (
        <div className="space-y-4">
          {results.length === 0 ? <p className="text-center text-ink-soft">{t.track.none}</p> : dedupe(results).map((o) => <OrderCard key={o.code} o={o} />)}
        </div>
      )}

      {mine.length > 0 && (
        <section className="mt-8 space-y-4">
          <h2 className="text-lg font-semibold">{t.track.mine}</h2>
          {dedupe(mine).map((o) => (
            <OrderCard key={o.code} o={o} token={saved.find((x) => x.code === o.code)?.token} />
          ))}
        </section>
      )}
    </div>
  );
}
