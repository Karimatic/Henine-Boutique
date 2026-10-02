"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { BagIcon, ChatIcon, GiftIcon, InstagramIcon, PhoneIcon } from "@/components/ui/icons";
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

function SectionTitle({ eyebrow, title }: { eyebrow: string; title: string }) {
  return (
    <div className="mb-8 text-center">
      <p className="mb-2 text-xs font-semibold uppercase tracking-[0.2em] text-rose-700">{eyebrow}</p>
      <h2 className="heading-display text-3xl md:text-4xl">{title}</h2>
      <span aria-hidden="true" className="mx-auto mt-3 block h-0.5 w-14 rounded-full bg-gradient-to-r from-gold via-rose-500 to-plum-600" />
    </div>
  );
}

/* ───────── How to order: 3 connected steps ───────── */

const STEP_ICONS = { bag: BagIcon, phone: PhoneIcon, gift: GiftIcon } as const;

export function HowToOrder() {
  const { t } = useLocale();
  return (
    <section className="relative overflow-hidden bg-gradient-to-b from-ivory via-rose-100/40 to-ivory py-14" aria-labelledby="howto-title">
      <div className="mx-auto max-w-6xl px-4">
        <div id="howto-title">
          <SectionTitle eyebrow={t.howTo.eyebrow} title={t.howTo.title} />
        </div>
        <ol className="relative grid gap-5 md:grid-cols-3 md:gap-6">
          {/* animated dashed connector between the steps */}
          <span aria-hidden="true" className="step-line absolute inset-x-[16%] top-12 hidden h-0.5 md:block" />
          <span aria-hidden="true" className="step-line-v absolute bottom-12 start-[2.6rem] top-12 w-0.5 md:hidden" />
          {t.howTo.steps.map((s, i) => {
            const Icon = STEP_ICONS[s.icon as keyof typeof STEP_ICONS];
            return (
              <li key={s.title}>
                <Reveal delay={i * 140}>
                  <div className="relative flex gap-4 rounded-3xl border border-line bg-ivory/90 p-5 shadow-soft backdrop-blur md:flex-col md:items-center md:p-7 md:text-center">
                    <span className="step-icon relative grid size-14 shrink-0 place-items-center rounded-2xl bg-gradient-to-br from-rose-100 to-ivory-deep text-plum-700 ring-1 ring-rose-300/60" style={{ animationDelay: `${i * 0.6}s` }}>
                      <Icon size={26} />
                    </span>
                    <div>
                      <p className="step-num font-sans text-4xl font-extrabold leading-none tabular-nums md:mt-4" dir="ltr" aria-hidden="true">
                        {String(i + 1).padStart(2, "0")}
                      </p>
                      <h3 className="mt-1 text-lg font-semibold">{s.title}</h3>
                      <p className="mt-1 text-sm leading-relaxed text-ink-soft">{s.text}</p>
                    </div>
                  </div>
                </Reveal>
              </li>
            );
          })}
        </ol>
      </div>
    </section>
  );
}

/* ───────── Instagram card ───────── */

export function InstagramCard() {
  const { t } = useLocale();
  const href = "https://www.instagram.com/henine.boutique/";
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
                {t.instagram.stats.map(([value, label]) => (
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
              className="ig-btn inline-flex h-12 shrink-0 items-center gap-2 rounded-full bg-gradient-to-r from-rose-700 via-plum-600 to-rose-700 px-6 font-semibold text-ivory shadow-soft transition hover:scale-[1.03]"
            >
              <InstagramIcon size={18} />
              <span dir="ltr">{t.instagram.cta}</span>
            </a>
          </div>
        </div>
      </Reveal>
    </section>
  );
}

/* ───────── FAQ ───────── */

/** Questions in the page's language: built in, or edited in Admin → Page d'accueil → Textes. */
export function Faq() {
  const { t, href } = useLocale();
  const list = useStoreTexts().faq;
  return (
    <section className="mx-auto max-w-6xl px-4 py-14" aria-labelledby="faq-title">
      <div id="faq-title">
        <SectionTitle eyebrow={t.faq.eyebrow} title={t.faq.title} />
      </div>
      <div className="grid gap-6 md:grid-cols-[1fr_18rem] md:items-start">
        <div className="space-y-3">
          {list.map((f, i) => (
            <Reveal key={f.q} delay={Math.min(i, 5) * 70}>
              <details className="faq-item group rounded-2xl border border-line bg-ivory shadow-[0_1px_2px_rgb(42_26_36/0.04)] transition open:border-rose-300 open:shadow-soft" open={i === 0}>
                <summary className="flex cursor-pointer items-center gap-4 p-4 md:p-5">
                  <span className="step-num shrink-0 font-sans text-2xl font-extrabold leading-none tabular-nums" dir="ltr" aria-hidden="true">
                    {String(i + 1).padStart(2, "0")}
                  </span>
                  <span className="flex-1 font-semibold">{f.q}</span>
                  <span className="faq-plus grid size-8 shrink-0 place-items-center rounded-full bg-rose-100 text-lg leading-none text-plum-700" aria-hidden="true">
                    +
                  </span>
                </summary>
                <p className="px-4 pb-5 ps-[3.75rem] text-sm leading-relaxed text-ink-soft md:px-5 md:ps-[4.25rem]">{f.a}</p>
              </details>
            </Reveal>
          ))}
        </div>
        <Reveal delay={150}>
          <aside className="rounded-3xl bg-gradient-to-br from-plum-700 via-plum-600 to-rose-700 p-6 text-ivory shadow-soft">
            <ChatIcon size={32} className="text-rose-300" />
            <p className="heading-display mt-3 text-2xl">{t.faq.helpTitle}</p>
            <p className="mt-1 text-sm text-ivory/80">{t.faq.helpText}</p>
            <a href={href("/contact")} className="mt-5 inline-flex h-11 items-center rounded-full bg-ivory px-5 text-sm font-semibold text-plum-700 transition hover:scale-[1.03]">
              {t.faq.helpCta}
            </a>
          </aside>
        </Reveal>
      </div>
    </section>
  );
}
