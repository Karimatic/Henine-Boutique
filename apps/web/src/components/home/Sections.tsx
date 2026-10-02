"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { InstagramIcon } from "@/components/ui/icons";
import { useLocale } from "@/lib/locale";
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

/* ───────── Instagram ───────── */

export function InstagramCard() {
  const { t } = useLocale();
  const href = "https://www.instagram.com/henine.boutique/";
  return (
    <section className="mx-auto max-w-6xl px-4 py-8">
      <Reveal>
        <a
          href={href}
          target="_blank"
          rel="noopener noreferrer"
          className="lift group relative flex items-center gap-4 overflow-hidden rounded-[1.75rem] bg-ink p-5 text-white md:p-8"
        >
          <span aria-hidden="true" className="pointer-events-none absolute -end-10 -top-16 size-56 rounded-full bg-rose-500/40 blur-3xl" />
          <span aria-hidden="true" className="pointer-events-none absolute -bottom-20 start-10 size-48 rounded-full bg-plum-600/50 blur-3xl" />
          <span className="ig-logo relative grid size-14 shrink-0 place-items-center rounded-2xl text-white shadow-lg transition group-hover:scale-105 md:size-16">
            <InstagramIcon size={30} strokeWidth={1.8} />
          </span>
          <span className="relative min-w-0 flex-1">
            <span className="block heading-display text-xl leading-snug md:text-3xl">{t.instagram.heading}</span>
            <span className="mt-1 block text-sm text-white/70">
              <b className="font-semibold text-white" dir="ltr">{t.instagram.stats[0]?.[0]}</b> {t.instagram.stats[0]?.[1]} · <span dir="ltr">@henine.boutique</span>
            </span>
          </span>
          <span aria-hidden="true" className="relative grid size-10 shrink-0 place-items-center rounded-full bg-white text-ink transition group-hover:translate-x-0.5 rtl:rotate-180">
            →
          </span>
        </a>
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
      <div className="divide-y divide-line overflow-hidden rounded-[1.5rem] border border-line bg-white">
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
