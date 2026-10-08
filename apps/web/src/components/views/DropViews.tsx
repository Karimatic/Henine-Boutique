import { useEffect, useRef, useState } from "react";
import type { CollectionDTO, DropTeaserDTO, ProductCardDTO } from "@henine/shared";
import { ProductGrid, ProductGridSkeleton } from "@/components/product/ProductCard";
import { Blossom } from "@/components/ui/icons";
import { ErrorBox, PageTitle, ProductImage } from "@/components/ui/kit";
import { ApiError, slugFromPath, useApi } from "@/lib/api";
import { useLocale } from "@/lib/locale";

/* ───────── Countdown ───────── */

/**
 * Client-side countdown to a server timestamp. `serverNow` (when known) corrects a phone
 * whose clock is off, so everyone sees the same launch moment. No polling, no websockets.
 */
export function useCountdown(target: number | null, serverNow?: number) {
  const offset = useRef(0);
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (serverNow != null) offset.current = serverNow - Date.now();
    setNow(Date.now() + offset.current);
  }, [serverNow]);
  useEffect(() => {
    if (!target) return;
    const id = setInterval(() => setNow(Date.now() + offset.current), 1000);
    return () => clearInterval(id);
  }, [target]);
  const left = target ? Math.max(0, target - now) : 0;
  return { left, done: !target || left === 0, now };
}

export function Countdown({ left, large = false }: { left: number; large?: boolean }) {
  const { t } = useLocale();
  const s = Math.floor(left / 1000);
  const parts: [number, string][] = [
    [Math.floor(s / 86400), t.drop.units.d],
    [Math.floor((s % 86400) / 3600), t.drop.units.h],
    [Math.floor((s % 3600) / 60), t.drop.units.m],
    [s % 60, t.drop.units.s],
  ];
  const shown = parts[0]![0] > 0 ? parts : parts.slice(1);
  return (
    <span className="inline-flex gap-1.5 tabular-nums" dir="ltr" role="timer" aria-live="off">
      {shown.map(([v, u], i) => (
        <span key={i} className={`inline-flex items-baseline gap-0.5 rounded-xl bg-white/15 ${large ? "px-3 py-2 text-3xl font-bold md:text-4xl" : "px-2 py-1 text-base font-bold"}`}>
          {String(v).padStart(2, "0")}
          <span className={large ? "text-sm font-medium opacity-80" : "text-[11px] font-medium opacity-80"}>{u}</span>
        </span>
      ))}
    </span>
  );
}

/* ───────── Home banner ───────── */

export function DropBanner({ drop }: { drop: DropTeaserDTO }) {
  const { t, ar, href } = useLocale();
  const { left, done, now } = useCountdown(drop.startsAt);
  const ended = drop.endsAt != null && drop.endsAt <= now;
  if (ended) return null;
  const name = ar ? drop.nameAr : drop.nameFr;
  return (
    <section className="mx-auto max-w-6xl px-4 pt-4">
      <a
        href={href(`/collection/${drop.slug}`)}
        className="flex flex-col items-center gap-3 rounded-[1.5rem] bg-gradient-to-br from-plum-700 via-plum-600 to-rose-700 p-5 text-center text-white shadow-soft md:flex-row md:justify-between md:p-6 md:text-start"
      >
        <span>
          <span className="block text-xs font-semibold uppercase tracking-[0.18em] text-rose-300">{done ? t.drop.live : t.drop.soon}</span>
          <span className="heading-display mt-1 block text-2xl md:text-3xl">{name}</span>
        </span>
        {!done && drop.showCountdown ? (
          <span className="flex flex-col items-center gap-1.5 md:items-end">
            <span className="text-xs text-white/80">{t.drop.launchIn}</span>
            <Countdown left={left} />
          </span>
        ) : (
          <span className="inline-flex h-11 items-center rounded-full bg-ivory px-6 font-semibold text-plum-700">{t.drop.see}</span>
        )}
      </a>
    </section>
  );
}

/* ───────── Collection / drop page ───────── */

export function CollectionView() {
  const { t, ar } = useLocale();
  const [slug, setSlug] = useState<string | null>(null);
  useEffect(() => setSlug(slugFromPath(location.pathname)), []);
  const { data, error, reload } = useApi<CollectionDTO>(slug && slug !== "_" ? `/collections/${encodeURIComponent(slug)}` : null);
  const [fresh, setFresh] = useState<CollectionDTO | null>(null);
  const c = fresh ?? data;
  const { left, done, now } = useCountdown(c && !c.launched ? c.startsAt : null, c?.now);

  // at launch time, fetch the unlocked collection once (bypassing the browser cache;
  // the edge cache already has a new key for it, so this stays cheap during a rush)
  useEffect(() => {
    if (!c || c.launched || !done || !slug) return;
    const id = setTimeout(() => {
      fetch(`/api/collections/${encodeURIComponent(slug)}`, { cache: "no-store" })
        .then((r) => (r.ok ? (r.json() as Promise<CollectionDTO>) : null))
        .then((next) => next && setFresh(next), () => undefined);
    }, 800);
    return () => clearTimeout(id);
  }, [c, done, slug]);

  if ((error instanceof ApiError && error.status === 404) || slug === "_") {
    return <p className="mx-auto max-w-md px-4 py-20 text-center text-ink-soft">{t.drop.notFound}</p>;
  }
  if (error) return <div className="mx-auto max-w-6xl px-4 py-10"><ErrorBox onRetry={reload} /></div>;
  if (!c) {
    return (
      <div className="mx-auto max-w-6xl px-4 py-8">
        <div className="skeleton mb-6 h-48 rounded-[1.5rem]" />
        <ProductGridSkeleton count={4} />
      </div>
    );
  }

  const name = ar ? c.nameAr : c.nameFr;
  const description = ar ? c.descriptionAr : c.descriptionFr;
  const upcoming = !c.launched && !done;
  const ended = c.endsAt != null && c.endsAt <= now;

  return (
    <div className="mx-auto max-w-6xl px-4 pb-12 pt-6">
      <header className="relative mb-8 overflow-hidden rounded-[1.75rem] bg-plum-700 text-white">
        {c.image && <ProductImage image={c.image} alt="" sizes="100vw" priority className="absolute inset-0 opacity-30" />}
        <div className="relative flex flex-col items-center gap-4 px-5 py-10 text-center md:py-14">
          <Blossom size={34} />
          <p className="text-xs font-semibold uppercase tracking-[0.2em] text-rose-300">{ended ? t.drop.ended : upcoming ? t.drop.soon : t.drop.live}</p>
          <h1 className="heading-display text-4xl leading-tight md:text-5xl">{name}</h1>
          {description && <p className="max-w-xl text-white/85">{description}</p>}
          {upcoming && c.showCountdown && c.startsAt && (
            <div className="mt-2 flex flex-col items-center gap-2">
              <span className="text-sm text-white/80">{t.drop.launchIn}</span>
              <Countdown left={left} large />
              <span className="text-sm text-white/80">{t.drop.remind}</span>
            </div>
          )}
        </div>
      </header>

      {c.products.length > 0 ? (
        <ProductGrid products={c.products} />
      ) : upcoming ? (
        <p className="rounded-card border border-dashed border-line p-8 text-center text-ink-soft">🔒 {t.drop.locked}</p>
      ) : done && !c.launched ? (
        <ProductGridSkeleton count={4} />
      ) : (
        <p className="text-center text-ink-soft">{t.arrivals.empty}</p>
      )}
    </div>
  );
}

/* ───────── Nouveautés ───────── */

export function NewArrivalsView() {
  const { t } = useLocale();
  const catalog = useApi<ProductCardDTO[]>("/catalog");
  const products = [...(catalog.data ?? [])].sort((a, b) => b.createdAt - a.createdAt);
  return (
    <div className="mx-auto max-w-6xl px-4 py-8">
      <PageTitle>{t.arrivals.title}</PageTitle>
      <p className="-mt-3 mb-6 text-ink-soft">{t.arrivals.text}</p>
      {catalog.error ? (
        <ErrorBox onRetry={catalog.reload} />
      ) : !catalog.data ? (
        <ProductGridSkeleton count={8} />
      ) : products.length === 0 ? (
        <p className="text-ink-soft">{t.arrivals.empty}</p>
      ) : (
        <ProductGrid products={products} level={2} />
      )}
    </div>
  );
}
