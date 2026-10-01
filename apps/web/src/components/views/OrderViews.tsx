"use client";

import { useEffect, useState } from "react";
import { dateLocale, formatDA, normalizeDzPhone, TRACKING_STEPS, trackingStepIndex, type SiteConfigDTO, type TrackedOrderDTO } from "@henine/shared";
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
      <div className="mt-6 rounded-card border border-line bg-white/70 p-5">
        <p className="text-sm text-ink-soft">{t.thanks.code}</p>
        <p className="mt-1 font-mono text-2xl font-bold tracking-wider text-plum-700" dir="ltr">{params.code}</p>
        {order && (
          <p className="mt-2 text-sm text-ink-soft" dir="ltr">
            {formatDA(order.total, locale)}
          </p>
        )}
      </div>
      <div className="mt-6 grid gap-3">
        <a href={href(`/suivi?c=${params.code}&t=${encodeURIComponent(params.token)}`)} className="grid h-12 place-items-center rounded-full bg-plum-600 font-semibold text-ivory">
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

function Timeline({ o }: { o: TrackedOrderDTO }) {
  const { t, locale } = useLocale();
  const current = trackingStepIndex(o.status);
  const cancelled = current === -1;
  const when = (status: string) => o.events.find((e) => e.status === status)?.at;
  const fmt = (ts: number) => new Date(ts).toLocaleString(dateLocale(locale), { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
  if (cancelled) return <p className="rounded-xl bg-ink/5 p-3 text-sm font-medium">{t.status[o.status]}</p>;
  return (
    <ol className="relative space-y-4 ps-7">
      <span aria-hidden="true" className="absolute bottom-2 start-[0.6rem] top-2 w-px bg-line" />
      {TRACKING_STEPS.map((s, i) => {
        const done = i <= current;
        const ts = when(s);
        return (
          <li key={s} className="relative">
            <span
              aria-hidden="true"
              className={`absolute -start-7 top-0.5 grid size-5 place-items-center rounded-full border-2 text-[10px] ${done ? "border-plum-600 bg-plum-600 text-ivory" : "border-line bg-ivory"} ${i === current ? "ring-4 ring-plum-600/15" : ""}`}
            >
              {done ? "✓" : ""}
            </span>
            <p className={`text-sm ${done ? "font-semibold text-ink" : "text-ink-soft"}`}>{t.status[s]}</p>
            {ts && <p className="text-xs text-ink-soft">{fmt(ts)}</p>}
          </li>
        );
      })}
    </ol>
  );
}

function OrderCard({ o }: { o: TrackedOrderDTO }) {
  const { t, ar, locale } = useLocale();
  return (
    <article className="rounded-card border border-line bg-white/70 p-5">
      <div className="mb-4 flex flex-wrap items-baseline justify-between gap-2">
        <p className="font-mono text-lg font-bold text-plum-700" dir="ltr">{o.code}</p>
        <p className="text-sm text-ink-soft">
          {t.track.placedOn} {new Date(o.createdAt).toLocaleDateString(dateLocale(locale))} · <span dir="ltr">{formatDA(o.total, locale)}</span>
        </p>
      </div>
      <div className="grid gap-6 md:grid-cols-2">
        <Timeline o={o} />
        <div className="space-y-3">
          <ul className="space-y-2">
            {o.items.map((i, k) => (
              <li key={k} className="flex items-center gap-3 text-sm">
                <ProductImage image={i.image} alt="" className="aspect-[4/5] w-11 shrink-0 rounded-md" />
                <span>
                  {ar ? i.nameAr : i.nameFr}
                  {i.options && <span className="text-ink-soft"> · {i.options}</span>} × {i.qty}
                </span>
              </li>
            ))}
          </ul>
          <p className="text-sm text-ink-soft">
            📍 {ar ? o.wilayaAr : o.wilayaFr} · {o.deliveryType === "bureau" ? t.track.desk : t.track.home}
          </p>
          {o.details && (
            <p className="text-sm text-ink-soft">
              👤 {o.details.name} · <span dir="ltr">{o.details.phoneMasked}</span>
              {o.details.address && <><br />🏠 {o.details.address}</>}
            </p>
          )}
          {o.trackingNumber && (
            <p className="rounded-xl bg-rose-100 p-3 text-sm">
              {t.track.trackingNumber} : <b dir="ltr">{o.trackingNumber}</b>
            </p>
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
    if (c && tk) apiGet<TrackedOrderDTO>(`/track/${c}?t=${encodeURIComponent(tk)}`).then(setLinkOrder, () => undefined);
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
        {linkOrder && dedupe([linkOrder]).map((o) => <OrderCard key={o.code} o={o} />)}
      </div>

      <form onSubmit={lookup} className="my-6 space-y-3 rounded-card border border-line bg-white/60 p-5">
        <p className="text-sm text-ink-soft">{t.track.text}</p>
        <div className="grid gap-3 sm:grid-cols-[1fr_12rem]">
          <input className={inputCls} type="tel" inputMode="tel" dir="ltr" placeholder={t.track.phone} value={phone} onChange={(e) => setPhone(e.target.value)} aria-label={t.track.phone} />
          <input className={`${inputCls} uppercase`} dir="ltr" placeholder={t.track.code} value={code} onChange={(e) => setCode(e.target.value)} aria-label={t.track.code} maxLength={12} />
        </div>
        <Turnstile siteKey={site.data?.turnstileSiteKey ?? ""} onToken={setToken} locale={locale} />
        {state === "invalid" && <p className="text-sm text-danger">{t.checkout.errors.phone_invalid}</p>}
        {state === "error" && <ErrorBox />}
        <button type="submit" disabled={state === "loading"} className="flex h-12 items-center gap-2 rounded-full bg-plum-600 px-6 font-semibold text-ivory">
          {state === "loading" && <Spinner className="size-4" />}
          {t.track.search}
        </button>
      </form>

      {results && (
        <div className="space-y-4">
          {results.length === 0 ? <p className="text-center text-ink-soft">{t.track.none}</p> : dedupe(results).map((o) => <OrderCard key={o.code} o={o} />)}
        </div>
      )}

      {mine.length > 0 && (
        <section className="mt-8 space-y-4">
          <h2 className="text-lg font-semibold">{t.track.mine}</h2>
          {dedupe(mine).map((o) => <OrderCard key={o.code} o={o} />)}
        </section>
      )}
    </div>
  );
}
