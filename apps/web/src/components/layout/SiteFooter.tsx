"use client";

import { useLocale } from "@/lib/locale";
import { Blossom, InstagramIcon } from "@/components/ui/icons";
import { LanguageSwitch } from "./LanguageSwitch";

export function SiteFooter() {
  const { t, href, ar } = useLocale();
  const pages = [
    ["livraison-retours", ar ? "التوصيل والإرجاع" : "Livraison & retours"],
    ["cgv", ar ? "شروط البيع" : "Conditions de vente"],
    ["confidentialite", ar ? "الخصوصية" : "Confidentialité"],
    ["a-propos", ar ? "من نحن" : "À propos"],
  ];
  const links: [string, string][] = [
    [href("/suivi"), t.track.cta],
    [href("/categories"), t.categories.all],
    ...pages.map(([slug, label]) => [href(`/p/${slug}`), label] as [string, string]),
    [href("/contact"), t.footer.contact],
    [href("/liens"), t.footer.links],
  ];
  return (
    <footer className="mt-8 bg-ink text-white">
      <div className="mx-auto max-w-6xl px-4 pb-8 pt-10">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div className="flex items-center gap-2.5">
            <Blossom size={30} />
            <div>
              <p className="heading-display text-2xl italic" dir="ltr">
                Henine Boutique
              </p>
              <p className="text-xs text-white/60">{t.brand.tagline}</p>
            </div>
          </div>
          <a
            href="https://www.instagram.com/henine.boutique/"
            rel="noopener noreferrer"
            target="_blank"
            className="inline-flex h-10 items-center gap-2 rounded-full bg-white/10 px-4 text-sm font-medium transition hover:bg-white/20"
          >
            <InstagramIcon size={17} />
            <span dir="ltr">@henine.boutique</span>
          </a>
        </div>
        <nav aria-label={t.footer.help} className="mt-8">
          <ul className="grid grid-cols-2 gap-x-4 gap-y-2.5 text-sm text-white/70 md:grid-cols-4">
            {links.map(([to, label]) => (
              <li key={to}>
                <a href={to} className="transition hover:text-white">
                  {label}
                </a>
              </li>
            ))}
          </ul>
        </nav>
        <div className="mt-8 flex items-center justify-between gap-3 border-t border-white/10 pt-5">
          <p className="text-xs text-white/50">
            © {new Date().getFullYear()} Henine Boutique · {t.footer.rights}
          </p>
          <LanguageSwitch className="inline-flex" />
        </div>
      </div>
    </footer>
  );
}
