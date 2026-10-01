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
  return (
    <footer className="border-t border-line bg-ivory-deep">
      <div className="mx-auto grid max-w-6xl gap-8 px-4 py-10 md:grid-cols-[1.4fr_1fr_1fr]">
        <div className="flex items-start gap-3">
          <Blossom size={32} />
          <div>
            <p className="heading-display text-2xl text-plum-700" dir="ltr">
              Henine Boutique
            </p>
            <p className="text-sm text-ink-soft">{t.brand.tagline}</p>
            <a
              href="https://www.instagram.com/henine.boutique/"
              rel="noopener noreferrer"
              target="_blank"
              className="mt-4 inline-flex items-center gap-2 rounded-full border border-line px-4 py-2 text-sm font-medium hover:border-plum-600"
            >
              <InstagramIcon size={18} />
              <span dir="ltr">@henine.boutique</span>
            </a>
          </div>
        </div>
        <nav aria-label={t.footer.help}>
          <p className="mb-2 text-sm font-semibold">{t.footer.help}</p>
          <ul className="space-y-2 text-sm text-ink-soft">
            <li><a href={href("/suivi")} className="hover:text-plum-700">{t.track.cta}</a></li>
            {pages.map(([slug, label]) => (
              <li key={slug}><a href={href(`/p/${slug}`)} className="hover:text-plum-700">{label}</a></li>
            ))}
          </ul>
        </nav>
        <nav aria-label={t.footer.shop}>
          <p className="mb-2 text-sm font-semibold">{t.footer.shop}</p>
          <ul className="space-y-2 text-sm text-ink-soft">
            <li><a href={href("/categories")} className="hover:text-plum-700">{t.categories.all}</a></li>
            <li><a href={href("/contact")} className="hover:text-plum-700">{t.footer.contact}</a></li>
            <li><a href={href("/liens")} className="hover:text-plum-700">{t.footer.links}</a></li>
            <li className="pt-2"><LanguageSwitch className="inline-flex" /></li>
          </ul>
        </nav>
      </div>
      <p className="pb-6 text-center text-xs text-ink-soft">
        © {new Date().getFullYear()} Henine Boutique · {t.footer.rights}
      </p>
    </footer>
  );
}
