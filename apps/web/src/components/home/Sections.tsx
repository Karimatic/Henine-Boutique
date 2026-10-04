"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { InstagramIcon } from "@/components/ui/icons";
import { useLocale } from "@/lib/locale";
import { useSite } from "@/lib/site";
import { useStoreTexts } from "@/lib/storeTexts";

/** Fades/slides its children in when they scroll into view (once). */
export function Reveal({ children, delay = 0, className = "" }: { children: ReactNode; delay?: number; className?: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const [visible, setVisible] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el || !("IntersectionObserver" in window)) return setVisible(true);
    const io = new IntersectionObserver(
      ([entry]) => {
        // also reveal sections already scrolled past (e.g. after jumping to an anchor)
        if (entry && (entry.isIntersecting || entry.boundingClientRect.top < 0)) {
          setVisible(true);
          io.disconnect();
        }
      },
      { rootMargin: "0px 0px -10% 0px" },
    );
    io.observe(el);
    return () => io.disconnect();
  }, []);
  return (
    <div ref={ref} className={`reveal ${visible ? "is-visible" : ""} ${className}`} style={{ transitionDelay: `${delay}ms` }}>
      {children}
    </div>
  );
}

/** Section heading: title on the start side, "see all" on the end side. */
export function SectionHead({ title, href, link }: { title: string; href?: string; link?: string }) {
  return (
    <div className="mb-4 flex items-end justify-between gap-3">
      <h2 className="heading-display text-[1.65rem] leading-tight md:text-4xl">{title}</h2>
      {href && link && (
        <a href={href} className="group inline-flex shrink-0 items-center gap-1 text-sm font-semibold text-plum-600">
          {link}
          <span aria-hidden="true" className="transition group-hover:translate-x-0.5 rtl:rotate-180 rtl:group-hover:-translate-x-0.5">→</span>
        </a>
      )}
    </div>
  );
}

/* ───────── Instagram: the big detailed card ───────── */

/** The Instagram block: the follow card with the shop's photos inside it. */
export function InstagramCard({ children }: { children?: React.ReactNode }) {
  const { t } = useLocale();
  const contact = useSite().data?.contact;
  const href = contact?.instagram || "https://www.instagram.com/henine.boutique/";
  // follower count as written in Admin → Contact (no chip when it's empty)
  const stats: [string, string][] = [...(contact?.followers ? [[contact.followers, t.instagram.followers] as [string, string]] : []), ...t.instagram.stats];
  return (
    <section className="mx-auto max-w-6xl px-4 py-10">
      <Reveal>
        <div className="ig-card relative overflow-hidden rounded-[2rem] p-6 md:p-8">
          <div aria-hidden="true" className="pointer-events-none absolute -end-16 -top-16 size-56 rounded-full bg-rose-100 blur-3xl" />
          <div className="relative flex flex-col items-center gap-5 text-center md:flex-row md:text-start">
            <a href={href} target="_blank" rel="noopener noreferrer" className="ig-logo grid size-20 shrink-0 place-items-center rounded-[1.6rem] text-white shadow-lg transition hover:scale-105" aria-label="Instagram">
              <InstagramIcon size={40} strokeWidth={1.8} />
            </a>
            <div className="flex-1">
              <p className="text-xs font-semibold uppercase tracking-[0.2em] text-rose-700">{t.instagram.label}</p>
              <h2 className="heading-display mt-1 text-2xl md:text-3xl">{t.instagram.heading}</h2>
              <p className="mt-2 max-w-xl text-sm leading-relaxed text-ink-soft">{t.instagram.text}</p>
              <ul className="mt-4 flex flex-wrap justify-center gap-2 md:justify-start">
                {stats.map(([value, label]) => (
                  <li key={label} className="rounded-full border border-line bg-ivory-deep/70 px-3 py-1.5 text-xs">
                    <b className="font-semibold text-plum-700" dir="ltr">{value}</b> <span className="text-ink-soft">{label}</span>
                  </li>
                ))}
              </ul>
            </div>
            <a
              href={href}
              target="_blank"
              rel="noopener noreferrer"
              className="ig-btn inline-flex h-12 shrink-0 items-center gap-2 rounded-full bg-gradient-to-r from-rose-700 via-plum-600 to-rose-700 px-6 font-semibold text-white shadow-soft transition hover:scale-[1.03]"
            >
              <InstagramIcon size={18} />
              <span dir="ltr">{t.instagram.cta}</span>
            </a>
          </div>
          {children && <div className="relative mt-6">{children}</div>}
        </div>
      </Reveal>
    </section>
  );
}

/* ───────── FAQ ───────── */

/** Questions in the page's language: built in, or edited in Admin → Paramètres → Textes. */
export function Faq() {
  const { t, href } = useLocale();
  const list = useStoreTexts().faq;
  return (
    <section className="mx-auto max-w-3xl px-4 py-10" aria-labelledby="faq-title">
      <h2 id="faq-title" className="heading-display mb-5 text-center text-[1.65rem] md:text-4xl">
        {t.faq.title}
      </h2>
      <div className="divide-y divide-line overflow-hidden rounded-[1.5rem] border border-line bg-surface">
        {list.map((f) => (
          <details key={f.q} className="faq-item group">
            <summary className="flex cursor-pointer items-center gap-4 px-5 py-4">
              <span className="flex-1 font-semibold">{f.q}</span>
              <span className="faq-plus grid size-8 shrink-0 place-items-center rounded-full bg-ivory-deep text-lg leading-none text-ink" aria-hidden="true">
                +
              </span>
            </summary>
            <p className="px-5 pb-5 text-sm leading-relaxed text-ink-soft">{f.a}</p>
          </details>
        ))}
      </div>
      <p className="mt-4 text-center text-sm text-ink-soft">
        {t.faq.helpTitle}{" "}
        <a href={href("/contact")} className="font-semibold text-plum-600 underline-offset-4 hover:underline">
          {t.faq.helpCta}
        </a>
      </p>
    </section>
  );
}
