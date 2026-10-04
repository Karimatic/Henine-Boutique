"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { toE164, type CategoryDTO, type SiteConfigDTO } from "@henine/shared";
import { Blossom, ChatIcon, GridIcon, HeartIcon, HomeIcon, InstagramIcon, MenuIcon, PackageIcon, SearchIcon, SparkleIcon } from "@/components/ui/icons";
import { useApi } from "@/lib/api";
import { useLocale } from "@/lib/locale";
import { StoryArt } from "@/components/home/Showcase";
import { ColorModeSwitch } from "./ColorModeSwitch";
import { useLocaleHref } from "./LanguageSwitch";

/**
 * The ☰ menu: everything a visitor may look for in one place (language, categories,
 * new arrivals, favourites, order tracking, contact). Opens as a side panel from the
 * edge its button is on (left in Arabic, right in French). The panel is portalled to <body>: the sticky
 * header uses backdrop-filter, which would otherwise turn it into the containing block of
 * this `position: fixed` overlay and clip it to the header's height.
 */
export function SiteMenu() {
  const { t, href, ar, locale } = useLocale();
  const [open, setOpen] = useState(false);
  const button = useRef<HTMLButtonElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const { data: categories } = useApi<CategoryDTO[]>("/categories");
  const site = useApi<SiteConfigDTO>("/site");
  const arHref = useLocaleHref("ar");
  const frHref = useLocaleHref("fr");

  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    panel.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") close();
    };
    window.addEventListener("keydown", onKey);
    return () => {
      document.body.style.overflow = prev;
      window.removeEventListener("keydown", onKey);
    };
  }, [open]);

  function close() {
    setOpen(false);
    button.current?.focus();
  }

  const contact = site.data?.contact;
  const wa = contact?.whatsapp ? toE164(contact.whatsapp)?.replace("+", "") : null;
  const row = "flex min-h-12 items-center gap-3 rounded-xl px-3 text-[15px] font-medium text-ink transition hover:bg-rose-100";

  return (
    <>
      <button
        ref={button}
        type="button"
        onClick={() => setOpen(true)}
        aria-label={t.nav.menu}
        aria-expanded={open}
        aria-controls="site-menu"
        className="grid size-11 place-items-center rounded-full hover:bg-rose-100"
      >
        <MenuIcon />
      </button>

      {open &&
        createPortal(
        <div className="fixed inset-0 z-50" role="presentation">
          <div className="animate-fade absolute inset-0 bg-noir/40" onClick={close} aria-hidden="true" />
          <div
            id="site-menu"
            ref={panel}
            role="dialog"
            aria-modal="true"
            aria-label={t.nav.menu}
            tabIndex={-1}
            className="menu-panel absolute inset-y-0 end-0 flex w-[min(21rem,86vw)] flex-col bg-ivory shadow-soft outline-none"
          >
            <div className="flex items-center justify-between border-b border-line px-4 py-3">
              <span className="flex items-center gap-2">
                <Blossom size={24} />
                <span className="heading-display text-xl italic text-plum-700" dir="ltr">
                  Henine Boutique
                </span>
              </span>
              <button type="button" onClick={close} aria-label={t.common.close} className="grid size-10 place-items-center rounded-full text-2xl text-ink-soft hover:bg-rose-100">
                ×
              </button>
            </div>

            <div className="flex-1 overflow-y-auto overscroll-contain px-3 py-4">
              <p className="px-3 pb-2 text-xs font-semibold uppercase tracking-wider text-ink-soft">{t.nav.language}</p>
              <div className="mb-5 grid grid-cols-2 gap-2 px-1">
                {(
                  [
                    ["ar", "العربية", arHref],
                    ["fr", "Français", frHref],
                  ] as const
                ).map(([code, label, url]) => (
                  <a
                    key={code}
                    href={url}
                    hrefLang={code}
                    lang={code}
                    aria-current={locale === code ? "true" : undefined}
                    className={`grid h-11 place-items-center rounded-xl border text-sm font-semibold transition ${locale === code ? "border-plum-600 bg-plum-600 text-white" : "border-line bg-surface text-ink hover:border-plum-600"}`}
                  >
                    {label}
                  </a>
                ))}
              </div>

              <p className="px-3 pb-1 text-xs font-semibold uppercase tracking-wider text-ink-soft">{t.nav.shop}</p>
              <nav aria-label={t.nav.shop} className="mb-4">
                <a href={href("/")} className={row}><HomeIcon size={20} className="text-plum-600" />{t.nav.home}</a>
                <a href={href("/recherche")} className={row}><SearchIcon size={20} className="text-plum-600" />{t.nav.search}</a>
                <a href={href("/nouveautes")} className={row}><SparkleIcon size={20} className="text-plum-600" />{t.home.newArrivals}</a>
                {/* categories with something to show: their photo + how many pieces */}
                {(categories ?? [])
                  .filter((c) => (c.productCount ?? 0) > 0)
                  .map((c) => (
                    <a key={c.id} href={href(`/c/${c.slug}`)} className={row}>
                      <span className="group block size-8 shrink-0 overflow-hidden rounded-full ring-2 ring-rose-100">
                        <StoryArt kind={c.slug} />
                      </span>
                      <span className="flex-1">{ar ? c.nameAr : c.nameFr}</span>
                      <span className="rounded-full bg-ivory-deep px-2 py-0.5 text-xs text-ink-soft" dir="ltr">{c.productCount}</span>
                    </a>
                  ))}
                <a href={href("/categories")} className={row}><GridIcon size={20} className="text-plum-600" />{t.categories.all}</a>
                <a href={href("/favoris")} className={row}><HeartIcon size={20} className="text-plum-600" />{t.nav.favorites}</a>
              </nav>

              <p className="px-3 pb-1 text-xs font-semibold uppercase tracking-wider text-ink-soft">{t.nav.help}</p>
              <nav aria-label={t.nav.help}>
                <a href={href("/suivi")} className={row}><PackageIcon size={20} className="text-plum-600" />{t.track.cta}</a>
                <a href={href("/contact")} className={row}><ChatIcon size={20} className="text-plum-600" />{t.contact.title}</a>
                <a href={href("/boutique")} className={row}><span className="w-5 text-center text-lg" aria-hidden="true">📍</span>{t.plus.boutique.title}</a>
                <a href={href("/tenue")} className={row}><span className="w-5 text-center text-lg" aria-hidden="true">👗</span>{t.plus.outfit.title}</a>
              </nav>
              <div className="mt-4 px-3">
                <p className="pb-2 text-xs font-semibold uppercase tracking-wider text-ink-soft">{t.plus.mode.label}</p>
                <ColorModeSwitch />
              </div>
            </div>

            {(wa || contact?.instagram) && (
              <div className="border-t border-line p-4">
                <p className="pb-2 text-xs font-semibold uppercase tracking-wider text-ink-soft">{t.nav.follow}</p>
                <div className="flex gap-2">
                  {contact?.instagram && (
                    <a href={contact.instagram} target="_blank" rel="noopener noreferrer" className="flex h-11 flex-1 items-center justify-center gap-2 rounded-full border border-line bg-surface text-sm font-semibold">
                      <InstagramIcon size={18} /> Instagram
                    </a>
                  )}
                  {wa && (
                    <a href={`https://wa.me/${wa}`} target="_blank" rel="noopener noreferrer" className="flex h-11 flex-1 items-center justify-center rounded-full bg-[#25D366] text-sm font-semibold text-white">
                      WhatsApp
                    </a>
                  )}
                </div>
              </div>
            )}
          </div>
        </div>,
          document.body,
        )}
    </>
  );
}
