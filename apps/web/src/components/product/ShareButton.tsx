"use client";

import { useState } from "react";
import { formatDA } from "@henine/shared";
import { useLocale } from "@/lib/locale";

/**
 * Share a product: the phone's own share sheet (Web Share API: WhatsApp, Instagram DMs…)
 * when available, otherwise a small sheet with WhatsApp, Facebook and "copy link".
 * The link carries utm_source=share, and its preview (photo, name, price) comes from the
 * OpenGraph tags the Worker injects into product pages.
 */
export function ShareButton({ slug, name, price, className = "" }: { slug: string; name: string; price: number; className?: string }) {
  const { t, href, locale } = useLocale();
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState(false);

  const url = () => `${location.origin}${href(`/produit/${slug}`)}?utm_source=share&utm_medium=social`;
  const text = t.share.text(name, formatDA(price, locale));

  async function share() {
    if (typeof navigator.share === "function") {
      try {
        await navigator.share({ title: name, text, url: url() });
        return;
      } catch (err) {
        if ((err as Error).name === "AbortError") return; // closed by the user
      }
    }
    setOpen(true);
  }

  async function copy() {
    try {
      await navigator.clipboard.writeText(url());
    } catch {
      const el = document.createElement("textarea");
      el.value = url();
      document.body.appendChild(el);
      el.select();
      document.execCommand("copy");
      el.remove();
    }
    setCopied(true);
    setTimeout(() => setCopied(false), 2200);
  }

  return (
    <>
      <button
        type="button"
        onClick={share}
        className={`inline-flex h-11 items-center justify-center gap-2 rounded-full border border-ink/15 bg-ivory/80 px-4 text-sm font-semibold text-ink backdrop-blur transition hover:border-plum-600 active:scale-[0.98] ${className}`}
      >
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M12 3v12M7.5 7.5 12 3l4.5 4.5M5 13v6a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-6" />
        </svg>
        {t.share.button}
      </button>

      {open && (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-noir/40 md:items-center" onClick={() => setOpen(false)}>
          <div role="dialog" aria-modal="true" aria-label={t.share.title} onClick={(e) => e.stopPropagation()} className="w-full rounded-t-3xl bg-ivory p-5 pb-[max(1.25rem,env(safe-area-inset-bottom))] shadow-soft md:max-w-sm md:rounded-3xl">
            <div className="mb-4 flex items-center justify-between">
              <p className="font-semibold">{t.share.title}</p>
              <button type="button" onClick={() => setOpen(false)} aria-label={t.common.close} className="grid size-10 place-items-center rounded-full text-xl text-ink-soft hover:bg-rose-100">
                ×
              </button>
            </div>
            <div className="grid gap-2.5">
              <a
                href={`https://wa.me/?text=${encodeURIComponent(`${text}\n${url()}`)}`}
                target="_blank"
                rel="noopener noreferrer"
                className="grid h-12 place-items-center rounded-full bg-[#25D366] font-semibold text-white"
              >
                WhatsApp
              </a>
              <a
                href={`https://www.facebook.com/sharer/sharer.php?u=${encodeURIComponent(url())}`}
                target="_blank"
                rel="noopener noreferrer"
                className="grid h-12 place-items-center rounded-full bg-[#1877F2] font-semibold text-white"
              >
                Facebook
              </a>
              <button type="button" onClick={copy} className="h-12 rounded-full border border-ink/15 font-semibold">
                {copied ? t.share.copied : t.share.copy}
              </button>
              <p className="pt-1 text-xs leading-relaxed text-ink-soft">{t.share.instagram}</p>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
