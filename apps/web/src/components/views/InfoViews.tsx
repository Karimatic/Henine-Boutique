"use client";

import { useEffect, useState } from "react";
import { normalizeDzPhone, toE164, type LinkDTO, type PageDTO, type SiteConfigDTO } from "@henine/shared";
import { Blossom, InstagramIcon } from "@/components/ui/icons";
import { Markdown } from "@/components/ui/Markdown";
import { ErrorBox, inputCls, PageTitle, Spinner } from "@/components/ui/kit";
import { apiPost, slugFromPath, useApi } from "@/lib/api";
import { useLocale } from "@/lib/locale";
import { Turnstile } from "@/lib/turnstile";

/* ───────── Contact ───────── */

export function ContactView() {
  const { t, ar, locale } = useLocale();
  const site = useApi<SiteConfigDTO>("/site");
  const [form, setForm] = useState({ name: "", phone: "", subject: "", message: "" });
  const [token, setToken] = useState("");
  const [state, setState] = useState<"idle" | "sending" | "sent" | "error">("idle");
  const c = site.data?.contact;
  const wa = c?.whatsapp ? toE164(c.whatsapp)?.replace("+", "") : null;
  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => setForm((f) => ({ ...f, [k]: e.target.value }));

  return (
    <div className="mx-auto grid max-w-5xl gap-8 px-4 py-8 md:grid-cols-[1fr_20rem]">
      <div>
        <PageTitle>{t.contact.title}</PageTitle>
        <p className="mb-6 text-ink-soft">{t.contact.text}</p>
        {state === "sent" ? (
          <p className="rounded-card bg-rose-100 p-6 font-medium text-plum-700">{t.contact.sent}</p>
        ) : (
          <form
            className="space-y-3"
            onSubmit={async (e) => {
              e.preventDefault();
              if (form.name.trim().length < 2 || form.message.trim().length < 5) return setState("error");
              const phone = form.phone ? normalizeDzPhone(form.phone) : null;
              if (form.phone && !phone) return setState("error");
              setState("sending");
              try {
                await apiPost("/contact", { name: form.name.trim(), phone: phone ?? undefined, subject: form.subject.trim() || undefined, message: form.message.trim(), turnstileToken: token || "pending" });
                setState("sent");
              } catch {
                setState("error");
              }
            }}
          >
            <input className={inputCls} placeholder={t.contact.name} value={form.name} onChange={set("name")} maxLength={80} aria-label={t.contact.name} />
            <input className={inputCls} placeholder={t.contact.phone} value={form.phone} onChange={set("phone")} type="tel" dir="ltr" aria-label={t.contact.phone} />
            <input className={inputCls} placeholder={t.contact.subject} value={form.subject} onChange={set("subject")} maxLength={120} aria-label={t.contact.subject} />
            <textarea className={`${inputCls} h-36 py-3`} placeholder={t.contact.message} value={form.message} onChange={set("message")} maxLength={2000} aria-label={t.contact.message} />
            <Turnstile siteKey={site.data?.turnstileSiteKey ?? ""} onToken={setToken} locale={locale} />
            {state === "error" && <p className="text-sm text-danger">{t.checkout.errors.generic}</p>}
            <button type="submit" disabled={state === "sending"} className="flex h-12 items-center gap-2 rounded-full bg-plum-600 px-7 font-semibold text-white">
              {state === "sending" && <Spinner className="size-4" />}
              {t.contact.send}
            </button>
          </form>
        )}
      </div>
      <aside className="h-fit space-y-4 rounded-card border border-line bg-surface/60 p-5 text-sm">
        {wa && (
          <a href={`https://wa.me/${wa}`} target="_blank" rel="noopener noreferrer" className="grid h-12 place-items-center rounded-full bg-[#25D366] font-semibold text-white">
            {t.contact.whatsapp}
          </a>
        )}
        {c?.phone && (
          <a href={`tel:${toE164(c.phone) ?? c.phone}`} className="grid h-12 place-items-center rounded-full border border-ink/15 font-semibold" dir="ltr">
            📞 {c.phone}
          </a>
        )}
        <div>
          <p className="font-semibold">{t.contact.hours}</p>
          <p className="text-ink-soft">{t.contact.hoursValue}</p>
        </div>
        <div>
          <p className="font-semibold">{t.contact.address}</p>
          <p className="text-ink-soft">{t.contact.addressValue}</p>
          {c?.maps && <a href={c.maps} target="_blank" rel="noopener noreferrer" className="text-plum-600 underline">Google Maps</a>}
        </div>
        {c?.instagram && (
          <a href={c.instagram} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-2 font-medium text-plum-700">
            <InstagramIcon size={18} /> Instagram
          </a>
        )}
      </aside>
    </div>
  );
}

/* ───────── Link in bio (/liens) ───────── */

export function LinksView() {
  const { t, ar, href } = useLocale();
  const { data, error, reload } = useApi<LinkDTO[]>("/links");
  return (
    <div className="mx-auto max-w-md px-4 py-10 text-center">
      <Blossom size={64} className="mx-auto animate-bloom" />
      <h1 className="heading-display mt-3 text-3xl text-plum-700" dir="ltr">{t.links.title}</h1>
      <p className="mt-1 text-sm text-ink-soft">{t.brand.tagline}</p>
      <ul className="mt-8 space-y-3">
        {error && <ErrorBox onRetry={reload} />}
        {!data && !error && [0, 1, 2, 3].map((i) => <li key={i} className="skeleton h-14 rounded-full" />)}
        {data?.map((l) => (
          <li key={l.id}>
            <a
              href={l.target.startsWith("/") ? href(l.target) : l.target}
              target={l.target.startsWith("http") ? "_blank" : undefined}
              rel={l.target.startsWith("http") ? "noopener noreferrer" : undefined}
              className="flex h-14 items-center justify-center rounded-full border border-line bg-surface font-semibold shadow-sm transition hover:border-plum-600 active:scale-[0.99]"
            >
              {(ar ? l.labelAr : l.labelFr) || l.target}
            </a>
          </li>
        ))}
      </ul>
    </div>
  );
}

/* ───────── Content pages (/p/<slug>) ───────── */

export function PageView() {
  const { t, ar } = useLocale();
  const [slug, setSlug] = useState<string | null>(null);
  useEffect(() => setSlug(slugFromPath(location.pathname)), []);
  const { data, error, reload } = useApi<PageDTO>(slug && slug !== "_" ? `/pages/${encodeURIComponent(slug)}` : null);
  useEffect(() => {
    if (data) document.title = `${ar ? data.titleAr : data.titleFr} · Henine Boutique`;
  }, [data, ar]);
  return (
    <div className="mx-auto max-w-2xl px-4 py-10">
      {error ? (
        error.status === 404 ? <p className="text-center text-ink-soft">{t.notFound.text}</p> : <ErrorBox onRetry={reload} />
      ) : !data ? (
        <div className="space-y-3"><div className="skeleton h-10 w-2/3" /><div className="skeleton h-4" /><div className="skeleton h-4 w-5/6" /></div>
      ) : (
        <>
          <PageTitle>{ar ? data.titleAr : data.titleFr}</PageTitle>
          <Markdown source={(ar ? data.bodyAr : data.bodyFr) || data.bodyFr} className="text-base" />
        </>
      )}
    </div>
  );
}
