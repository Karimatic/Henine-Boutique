import { useLocale } from "@/lib/locale";
import { Blossom, InstagramIcon } from "@/components/ui/icons";
import { ColorModeSwitch } from "./ColorModeSwitch";
import { WhatsAppIcon } from "./FloatingHelp";
import { useDesign, useSite, whatsappLink } from "@/lib/site";
import { LanguageSwitch } from "./LanguageSwitch";

/** Social links saved in Admin → Contact (only the ones filled in). */
function useSocials() {
  const { t } = useLocale();
  const c = useSite().data?.contact;
  const instagram = c?.instagram ?? "https://www.instagram.com/henine.boutique/";
  return [
    { key: "instagram", href: instagram, label: "Instagram", icon: <InstagramIcon size={17} /> },
    { key: "whatsapp", href: whatsappLink(c?.whatsapp, t.plus.whatsapp.hello), label: "WhatsApp", icon: <WhatsAppIcon size={17} /> },
    { key: "tiktok", href: c?.tiktok, label: "TikTok", icon: <span aria-hidden="true" className="text-sm font-black">♪</span> },
    { key: "facebook", href: c?.facebook, label: "Facebook", icon: <span aria-hidden="true" className="text-sm font-black">f</span> },
  ].filter((s): s is typeof s & { href: string } => !!s.href);
}

export function SiteFooter() {
  const { t, href, ar } = useLocale();
  const design = useDesign();
  const socials = useSocials();
  const note = ar ? design.footerAr || design.footerFr : design.footerFr || design.footerAr;
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
    [href("/boutique"), t.plus.boutique.link],
    [href("/tenue"), t.plus.outfit.link],
    [href("/liens"), t.footer.links],
  ];
  return (
    <footer className="mt-8 bg-noir text-white">
      <div className="mx-auto max-w-6xl px-4 pb-8 pt-10">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div className="flex items-center gap-2.5">
            {design.logo ? (
              <img src={design.logo} alt="Henine Boutique" className="h-12 w-auto max-w-[12rem] rounded-lg bg-surface/95 object-contain p-1.5" />
            ) : (
              <>
                <Blossom size={30} />
                <div>
                  <p className="heading-display text-2xl italic" dir="ltr">
                    Henine Boutique
                  </p>
                  <p className="text-xs text-white/60">{t.brand.tagline}</p>
                </div>
              </>
            )}
          </div>
          <div className="flex flex-wrap items-center gap-2" aria-label={t.plus.footerFollow}>
            {socials.map((s) => (
              <a
                key={s.key}
                href={s.href}
                rel="noopener noreferrer"
                target="_blank"
                aria-label={s.label}
                className="inline-flex h-10 items-center gap-2 rounded-full bg-white/10 px-4 text-sm font-medium transition hover:bg-white/20"
              >
                {s.icon}
                <span className={s.key === "instagram" ? "" : "sr-only sm:not-sr-only"} dir="ltr">
                  {s.key === "instagram" ? "@henine.boutique" : s.label}
                </span>
              </a>
            ))}
          </div>
        </div>
        {note && <p className="mt-6 max-w-2xl whitespace-pre-line text-sm leading-relaxed text-white/75">{note}</p>}
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
        <div className="mt-8 flex flex-wrap items-center justify-between gap-3 border-t border-white/10 pt-5">
          <p className="text-xs text-white/50">
            © {new Date().getFullYear()} Henine Boutique · {t.footer.rights}
          </p>
          <div className="flex flex-wrap items-center gap-2 pe-14 md:pe-0">
            <ColorModeSwitch tone="dark" />
            <LanguageSwitch tone="dark" />
          </div>
        </div>
      </div>
    </footer>
  );
}
