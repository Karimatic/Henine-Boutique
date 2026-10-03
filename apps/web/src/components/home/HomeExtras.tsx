"use client";

import { useEffect, useState } from "react";
import type { FlashInfoDTO, ProductCardDTO } from "@henine/shared";
import { ProductGrid } from "@/components/product/ProductCard";
import { InstagramIcon } from "@/components/ui/icons";
import { Countdown, useCountdown } from "@/components/views/DropViews";
import { useLocale } from "@/lib/locale";
import { pushSupported, subscribeNews } from "@/lib/push";
import { useDesign, useSite } from "@/lib/site";
import { Reveal, SectionHead } from "./Sections";

/* ───────── ⚡ Flash sale: countdown + its products ───────── */

export function FlashBlock({ products }: { products: ProductCardDTO[] }) {
  const { t, ar } = useLocale();
  const sale = useSite().data?.flash;
  const { left, done } = useCountdown(sale?.endsAt ?? null);
  if (!sale || done) return null;
  const list = products.filter((p) => p.flash?.saleId === sale.id);
  if (!list.length) return null;
  return (
    <section id="flash" className="mx-auto max-w-6xl scroll-mt-24 px-3 py-6 md:px-4">
      <div className="overflow-hidden rounded-[1.75rem] bg-gradient-to-br from-noir via-plum-700 to-plum-600 p-4 text-white md:p-7">
        <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
          <div>
            <p className="inline-flex items-center gap-1.5 rounded-full bg-white/15 px-3 py-1 text-xs font-bold uppercase tracking-[0.14em]">
              <span className="animate-pulse" aria-hidden="true">⚡</span> {t.plus.flash.title} · -{sale.percent}%
            </p>
            <h2 className="heading-display mt-2 text-3xl md:text-4xl">{ar ? sale.nameAr : sale.nameFr}</h2>
          </div>
          <div className="text-end">
            <p className="mb-1 text-xs font-medium text-white/75">{t.plus.flash.endsIn}</p>
            <Countdown left={left} />
          </div>
        </div>
        <div className="rounded-[1.25rem] bg-ivory p-3 text-ink md:p-4">
          <ProductGrid products={list.slice(0, 8)} />
        </div>
      </div>
    </section>
  );
}

/** Product page / card: how much is left at the sale price. */
export function FlashStock({ flash, compact = false }: { flash: FlashInfoDTO; compact?: boolean }) {
  const { t } = useLocale();
  if (flash.limit == null) return compact ? null : <p className="text-xs font-medium text-rose-700">🔥 {t.plus.flash.hot}</p>;
  const left = Math.max(0, flash.limit - flash.sold);
  const pct = Math.min(100, Math.round((flash.sold / flash.limit) * 100));
  return (
    <div className={compact ? "space-y-1" : "space-y-1.5"}>
      <div className="flex items-center justify-between gap-2 text-xs font-semibold">
        <span className="text-rose-700">🔥 {t.plus.flash.left(left)}</span>
        {!compact && <span className="text-ink-soft">{t.plus.flash.sold(flash.sold, flash.limit)}</span>}
      </div>
      <span className="block h-2 overflow-hidden rounded-full bg-rose-100" role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100}>
        <span className="block h-full rounded-full bg-gradient-to-r from-rose-500 to-plum-600 rtl:bg-gradient-to-l" style={{ width: `${Math.max(6, pct)}%` }} />
      </span>
    </div>
  );
}

/** Product page panel: ⚡ -30 %, ends in 02:31:48, pieces left. */
export function FlashPanel({ flash }: { flash: FlashInfoDTO }) {
  const { t } = useLocale();
  const { left, done } = useCountdown(flash.endsAt);
  if (done) return null;
  return (
    <div className="mt-4 rounded-2xl bg-gradient-to-br from-plum-600 to-plum-700 p-4 text-white">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="font-bold">⚡ {t.plus.flash.title} · -{flash.percent}%</p>
        <div className="flex items-center gap-2 text-xs">
          <span className="text-white/75">{t.plus.flash.endsIn}</span>
          <Countdown left={left} />
        </div>
      </div>
      <div className="mt-3 rounded-xl bg-surface/95 p-3 text-ink">
        <FlashStock flash={flash} />
      </div>
    </div>
  );
}

/* ───────── Banners (Admin → Apparence) ───────── */

export function Banners() {
  const { ar, href } = useLocale();
  const banners = useDesign().banners;
  if (!banners.length) return null;
  const link = (l: string) => (!l ? undefined : l.startsWith("/") ? href(l) : l);
  return (
    <section className="mx-auto max-w-6xl px-3 py-5 md:px-4">
      <ul className={`grid gap-3 ${banners.length > 1 ? "md:grid-cols-2" : ""}`}>
        {banners.map((b, i) => {
          const title = ar ? b.titleAr || b.titleFr : b.titleFr || b.titleAr;
          const subtitle = ar ? b.subtitleAr || b.subtitleFr : b.subtitleFr || b.subtitleAr;
          const external = !!b.link && !b.link.startsWith("/");
          return (
            <li key={b.id}>
              <Reveal delay={i * 80}>
                <a
                  href={link(b.link)}
                  {...(external ? { target: "_blank", rel: "noopener noreferrer" } : {})}
                  className="group relative block aspect-[16/9] overflow-hidden rounded-[1.5rem] bg-noir md:aspect-[2/1]"
                >
                  <img src={b.image} alt={title} loading="lazy" className="absolute inset-0 size-full object-cover transition duration-700 group-hover:scale-105" />
                  {(title || subtitle) && (
                    <>
                      <span aria-hidden="true" className="absolute inset-0 bg-gradient-to-t from-noir/80 via-noir/20 to-transparent" />
                      <span className="absolute inset-x-0 bottom-0 p-5 text-white">
                        {title && <span className="heading-display block text-2xl md:text-3xl">{title}</span>}
                        {subtitle && <span className="mt-1 block text-sm text-white/85">{subtitle}</span>}
                      </span>
                    </>
                  )}
                </a>
              </Reveal>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

/* ───────── Hand-picked products ───────── */

export function Featured({ products }: { products: ProductCardDTO[] }) {
  const { ar } = useLocale();
  const f = useDesign().featured;
  const list = f.productIds.map((id) => products.find((p) => p.id === id)).filter((p): p is ProductCardDTO => !!p);
  if (!list.length) return null;
  return (
    <section className="mx-auto max-w-6xl px-4 py-6">
      <SectionHead title={(ar ? f.titleAr || f.titleFr : f.titleFr || f.titleAr) || "⭐"} />
      <ProductGrid products={list} />
    </section>
  );
}

/* ───────── "Recevoir les nouveautés" (push, no e-mail) ───────── */

export function Newsletter() {
  const { t, locale } = useLocale();
  const N = t.plus.newsletter;
  const site = useSite();
  const [state, setState] = useState<"idle" | "busy" | "done" | "denied" | "ios" | "error">("idle");
  const [supported, setSupported] = useState(true);
  useEffect(() => {
    const ios = /iphone|ipad|ipod/i.test(navigator.userAgent);
    const standalone = matchMedia("(display-mode: standalone)").matches;
    if (!pushSupported()) {
      setSupported(false);
      if (ios && !standalone) setState("ios");
    }
  }, []);
  const ig = site.data?.contact.instagram ?? "https://www.instagram.com/henine.boutique/";
  return (
    <section className="mx-auto max-w-6xl px-3 py-6 md:px-4">
      <Reveal>
        <div className="relative overflow-hidden rounded-[1.75rem] bg-rose-100 px-5 py-8 text-center md:px-10">
          <span aria-hidden="true" className="pointer-events-none absolute -end-10 -top-10 size-40 rounded-full bg-surface/50 blur-2xl" />
          <p className="text-3xl" aria-hidden="true">💌</p>
          <h2 className="heading-display mt-2 text-3xl">{N.title}</h2>
          <p className="mx-auto mt-2 max-w-md text-sm leading-relaxed text-ink-soft">{N.text}</p>
          {state === "done" ? (
            <p className="mt-5 font-semibold text-plum-700">{N.done}</p>
          ) : state === "ios" ? (
            <p className="mx-auto mt-5 max-w-sm text-sm font-medium text-plum-700">{N.ios}</p>
          ) : supported ? (
            <button
              type="button"
              disabled={state === "busy"}
              onClick={async () => {
                setState("busy");
                const r = await subscribeNews(locale);
                setState(r === "ok" ? "done" : r === "denied" ? "denied" : "error");
              }}
              className="lift mt-5 inline-flex h-12 items-center rounded-full bg-plum-600 px-7 font-semibold text-white disabled:opacity-60"
            >
              {N.cta}
            </button>
          ) : null}
          {state === "denied" && <p className="mt-2 text-sm text-danger">{N.denied}</p>}
          {state === "error" && <p className="mt-2 text-sm text-danger">{t.common.error}</p>}
          <a href={ig} target="_blank" rel="noopener noreferrer" className="mt-4 flex items-center justify-center gap-1.5 text-sm font-semibold text-plum-700">
            <InstagramIcon size={16} /> {N.instagram}
          </a>
        </div>
      </Reveal>
    </section>
  );
}
