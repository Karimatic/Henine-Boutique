"use client";

import { useEffect, useState } from "react";
import type { ActivityDTO } from "@henine/shared";
import { apiGet } from "@/lib/api";
import { useLocale } from "@/lib/locale";

const SEEN_KEY = "henine.activity.seen";
const MAX_PER_VISIT = 3;

/**
 * "Une cliente de Blida vient de commander…": real orders of the last 48 h only (product,
 * wilaya, time; never a name or a number). A few times per visit, never during checkout,
 * under the header so it never covers the buy buttons.
 */
export function ActivityToast() {
  const { t, ar, href } = useLocale();
  const [list, setList] = useState<ActivityDTO[]>([]);
  const [shown, setShown] = useState<ActivityDTO | null>(null);

  useEffect(() => {
    if (/\/(panier|commande|merci|suivi)/.test(location.pathname)) return;
    if (matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    apiGet<ActivityDTO[]>("/activity").then(setList, () => undefined);
  }, []);

  useEffect(() => {
    if (!list.length) return;
    let seen = 0;
    try {
      seen = Number(sessionStorage.getItem(SEEN_KEY) ?? 0);
    } catch {
      /* private mode */
    }
    if (seen >= MAX_PER_VISIT) return;
    const timers: number[] = [];
    list.slice(0, MAX_PER_VISIT - seen).forEach((a, i) => {
      timers.push(window.setTimeout(() => {
        setShown(a);
        try {
          sessionStorage.setItem(SEEN_KEY, String(seen + i + 1));
        } catch {
          /* ignore */
        }
      }, 9000 + i * 28000));
      timers.push(window.setTimeout(() => setShown(null), 9000 + i * 28000 + 6500));
    });
    return () => timers.forEach(clearTimeout);
  }, [list]);

  if (!shown) return null;
  return (
    <div role="status" className="pointer-events-none fixed inset-x-3 top-[4.25rem] z-30 flex justify-center md:top-20">
      <a
        href={href(`/produit/${shown.productSlug}`)}
        className="toast-in pointer-events-auto flex max-w-sm items-center gap-3 rounded-2xl border border-line bg-white/95 px-4 py-2.5 shadow-[0_12px_32px_-12px_rgb(23_10_16/0.35)] backdrop-blur"
      >
        <span className="relative flex size-2.5 shrink-0" aria-hidden="true">
          <span className="absolute inline-flex size-full animate-ping rounded-full bg-emerald-400 opacity-60" />
          <span className="relative inline-flex size-2.5 rounded-full bg-emerald-500" />
        </span>
        <span className="min-w-0 text-[13px] leading-snug">
          <span className="block text-ink-soft">{t.activity.ordered(ar ? shown.wilayaAr : shown.wilayaFr)}</span>
          <b className="block truncate">{ar ? shown.productAr : shown.productFr}</b>
        </span>
        <span className="shrink-0 text-[11px] text-ink-soft">{t.activity.ago(shown.minutesAgo)}</span>
      </a>
    </div>
  );
}
