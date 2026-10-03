/**
 * Store look, editable in Admin → Page d'accueil without touching code: logo, colours,
 * fonts, hero photo, banners, hand-picked products, footer note and the order of the
 * home page sections. Stored in the `design` setting, sent to the storefront in /site.
 */

/** Home page building blocks, in their default order. */
export const HOME_SECTIONS = [
  "stories",
  "hero",
  "promise",
  "drop",
  "flash",
  "new",
  "banners",
  "featured",
  "promos",
  "best",
  "lookbook",
  "instagram",
  "contest",
  "reviews",
  "recent",
  "faq",
  "newsletter",
] as const;
export type HomeSectionKey = (typeof HOME_SECTIONS)[number];

export const HOME_SECTION_LABEL: Record<HomeSectionKey, { fr: string; icon: string }> = {
  stories: { fr: "Catégories (cercles)", icon: "⭕" },
  hero: { fr: "Grande photo (hero)", icon: "🖼️" },
  promise: { fr: "Nos promesses", icon: "✅" },
  drop: { fr: "Lancement de collection", icon: "🚀" },
  flash: { fr: "Vente flash", icon: "⚡" },
  new: { fr: "Nouveautés", icon: "🆕" },
  banners: { fr: "Bannières", icon: "🏷️" },
  featured: { fr: "Produits mis en avant", icon: "⭐" },
  promos: { fr: "Promos", icon: "💸" },
  best: { fr: "Les plus vendus", icon: "🔥" },
  lookbook: { fr: "Lookbook Instagram", icon: "📸" },
  instagram: { fr: "Carte Instagram", icon: "📱" },
  contest: { fr: "Concours", icon: "🎁" },
  reviews: { fr: "Avis des clientes", icon: "💬" },
  recent: { fr: "Vus récemment", icon: "👀" },
  faq: { fr: "Questions fréquentes", icon: "❓" },
  newsletter: { fr: "Recevoir les nouveautés", icon: "🔔" },
};

/** Font pairs: Latin display + Latin text + Arabic text + Arabic display (Google Fonts, free). */
export const FONT_PRESETS = {
  classic: { label: "Classique (Playfair)", display: null, sans: null, arabic: null, arabicDisplay: null },
  elegant: { label: "Élégant (Cormorant)", display: "Cormorant Garamond", sans: "Jost", arabic: "Noto Kufi Arabic", arabicDisplay: "Amiri" },
  modern: { label: "Moderne (Montserrat)", display: "Montserrat", sans: "Inter", arabic: "Cairo", arabicDisplay: "Cairo" },
  soft: { label: "Doux (Lora)", display: "Lora", sans: "Nunito", arabic: "Almarai", arabicDisplay: "Reem Kufi" },
} as const;
export type FontPreset = keyof typeof FONT_PRESETS;

/** Ready-made colour themes. `accent` carries white text (buttons): every preset is ≥ 4.5:1. */
export const COLOR_PRESETS = [
  { key: "plum", label: "Prune (actuel)", accent: "#8e1048", soft: "#fbe4ec" },
  { key: "rose", label: "Rose poudré", accent: "#b03a6a", soft: "#fdeaf1" },
  { key: "noir", label: "Noir & or", accent: "#1f1a17", soft: "#f4ede4" },
  { key: "emeraude", label: "Émeraude", accent: "#0f6b52", soft: "#e2f3ec" },
  { key: "nuit", label: "Bleu nuit", accent: "#1d3b72", soft: "#e6ecf8" },
  { key: "terracotta", label: "Terracotta", accent: "#9c3d22", soft: "#f9e8df" },
] as const;

export interface BannerDTO {
  id: string;
  image: string;
  titleFr: string;
  titleAr: string;
  subtitleFr: string;
  subtitleAr: string;
  /** "/c/robes", "/collection/ete" or https://… */
  link: string;
}

export interface DesignDTO {
  /** media URL of the logo (replaces the written wordmark), null = the wordmark */
  logo: string | null;
  colors: { accent: string; soft: string };
  font: FontPreset;
  /** media URL of the home page photo, null = the built-in one */
  heroImage: string | null;
  banners: BannerDTO[];
  featured: { titleFr: string; titleAr: string; productIds: number[] };
  footerFr: string;
  footerAr: string;
  sections: { key: HomeSectionKey; on: boolean }[];
}

export const DEFAULT_DESIGN: DesignDTO = {
  logo: null,
  colors: { accent: "#8e1048", soft: "#fbe4ec" },
  font: "classic",
  heroImage: null,
  banners: [],
  featured: { titleFr: "Notre sélection", titleAr: "اختياراتنا لكِ", productIds: [] },
  footerFr: "",
  footerAr: "",
  sections: HOME_SECTIONS.map((key) => ({ key, on: true })),
};

/** Saved order + any section added since (appended, visible). */
export function resolveSections(saved: DesignDTO["sections"] | undefined): DesignDTO["sections"] {
  const known = (saved ?? []).filter((s, i, all) => (HOME_SECTIONS as readonly string[]).includes(s.key) && all.findIndex((x) => x.key === s.key) === i);
  const missing = HOME_SECTIONS.filter((k) => !known.some((s) => s.key === k)).map((key) => ({ key, on: true }));
  return [...known, ...missing];
}

/* ── colour maths (hex in, hex out) ── */

const HEX = /^#[0-9a-f]{6}$/i;
export const isHexColor = (s: string) => HEX.test(s);

function rgb(hex: string): [number, number, number] {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}
function toHex([r, g, b]: number[]): string {
  return `#${[r, g, b].map((v) => Math.round(Math.max(0, Math.min(255, v!))).toString(16).padStart(2, "0")).join("")}`;
}
/** `amount` of `b` into `a` (0 = a, 1 = b). */
export function mixHex(a: string, b: string, amount: number): string {
  const x = rgb(a);
  const y = rgb(b);
  return toHex(x.map((v, i) => v + (y[i]! - v) * amount));
}
function luminance(hex: string): number {
  const [r, g, b] = rgb(hex).map((v) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r! + 0.7152 * g! + 0.0722 * b!;
}
/** WCAG contrast ratio between two colours (1–21). */
export function contrastRatio(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi! + 0.05) / (lo! + 0.05);
}

/**
 * CSS variables for a colour theme. The accent drives every pink/plum shade of the store;
 * text colours derived from it keep ≥ 4.5:1 on white because the accent itself must.
 */
export function themeVars(colors: DesignDTO["colors"]): Record<string, string> {
  const accent = isHexColor(colors.accent) ? colors.accent : DEFAULT_DESIGN.colors.accent;
  const soft = isHexColor(colors.soft) ? colors.soft : DEFAULT_DESIGN.colors.soft;
  return {
    "--color-plum-600": accent,
    "--color-plum-700": mixHex(accent, "#000000", 0.25),
    "--color-rose-800": mixHex(accent, "#000000", 0.1),
    "--color-rose-700": accent,
    "--color-rose-500": mixHex(accent, "#ffffff", 0.3),
    "--color-rose-300": mixHex(accent, "#ffffff", 0.6),
    "--color-rose-100": soft,
    "--color-ivory-deep": mixHex(soft, "#ffffff", 0.45),
    "--color-line": mixHex(soft, "#d9d0d4", 0.5),
  };
}

/** Google Fonts stylesheet for a font preset (null = the self-hosted default). */
export function fontStylesheet(font: FontPreset): string | null {
  const f = FONT_PRESETS[font];
  if (!f || !f.display) return null;
  const fam = [...new Set([f.display, f.sans, f.arabic, f.arabicDisplay])]
    .map((n) => `family=${n!.replace(/ /g, "+")}:wght@400;500;600;700`)
    .join("&");
  return `https://fonts.googleapis.com/css2?${fam}&display=swap`;
}

export function fontVars(font: FontPreset): Record<string, string> {
  const f = FONT_PRESETS[font];
  if (!f || !f.display) return {};
  return {
    "--font-display": `"${f.display}", Georgia, serif`,
    "--font-sans": `"${f.sans}", system-ui, sans-serif`,
    "--font-arabic": `"${f.arabic}", "Segoe UI", Tahoma, sans-serif`,
    "--font-arabic-display": `"${f.arabicDisplay}", "${f.arabic}", serif`,
  };
}
