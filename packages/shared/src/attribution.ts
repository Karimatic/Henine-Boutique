/**
 * Where an order comes from. The store remembers how a visitor arrived (campaign link, ad click,
 * a link shared on Instagram / WhatsApp, Google…) for 30 days and sends it with the order; the
 * team's own orders take the source of their channel. Normalised to one short list so the
 * statistics can compare sources.
 */

export const ORDER_SOURCES = ["direct", "instagram", "facebook", "tiktok", "google", "whatsapp", "telegram", "word_of_mouth", "referral", "campaign", "push", "boutique", "other"] as const;
export type OrderSource = (typeof ORDER_SOURCES)[number];

export const ORDER_SOURCE_LABEL: Record<OrderSource, { fr: string; ar: string; emoji: string }> = {
  direct: { fr: "Site (accès direct)", ar: "الموقع مباشرة", emoji: "🌐" },
  instagram: { fr: "Instagram", ar: "إنستغرام", emoji: "📸" },
  facebook: { fr: "Facebook", ar: "فيسبوك", emoji: "📘" },
  tiktok: { fr: "TikTok", ar: "تيك توك", emoji: "🎵" },
  google: { fr: "Google", ar: "غوغل", emoji: "🔎" },
  whatsapp: { fr: "WhatsApp", ar: "واتساب", emoji: "💬" },
  telegram: { fr: "Telegram", ar: "تيليغرام", emoji: "✈️" },
  word_of_mouth: { fr: "Bouche-à-oreille (une amie…)", ar: "من صديقة أو معارف", emoji: "🗣️" },
  referral: { fr: "Autre site (lien)", ar: "موقع آخر (رابط)", emoji: "🔗" },
  campaign: { fr: "Campagne", ar: "حملة", emoji: "📣" },
  push: { fr: "Notification", ar: "إشعار", emoji: "🔔" },
  boutique: { fr: "Boutique (en magasin)", ar: "المحل", emoji: "🏬" },
  other: { fr: "Autre", ar: "أخرى", emoji: "✨" },
};

/* ── The shop's own sources (Statistiques → Sources) ── */

/** A source the shop adds itself (an influencer, a flyer, a story…), reached through its own link `?utm_source=<key>`. */
export interface CustomSource {
  key: string;
  name: string;
  emoji: string;
}

export interface SourceSettings {
  /** built-in sources renamed, given another emoji, or hidden */
  builtIn: Partial<Record<OrderSource, { name?: string; emoji?: string; hidden?: boolean }>>;
  custom: CustomSource[];
  /** ask « How did you hear about us? » at checkout (answer kept when the visit says nothing) */
  ask: boolean;
}

export const DEFAULT_SOURCE_SETTINGS: SourceSettings = { builtIn: {}, custom: [], ask: false };

/** the link code of a custom source: lowercase letters, digits and dashes, never a built-in name */
export const CUSTOM_SOURCE_KEY = /^[a-z0-9][a-z0-9-]{1,29}$/;

/** Built-in sources a customer can name herself at checkout. */
export const ASKABLE_SOURCES: OrderSource[] = ["instagram", "facebook", "tiktok", "google", "whatsapp", "word_of_mouth", "other"];

/** Name and emoji of a source in a language (the shop's renaming and own sources first). */
export function sourceLabel(key: string, settings: SourceSettings | null | undefined, lang: "fr" | "ar"): { name: string; emoji: string; custom: boolean } {
  const own = settings?.custom.find((c) => c.key === key);
  if (own) return { name: own.name, emoji: own.emoji || "🏷️", custom: true };
  const base = (ORDER_SOURCE_LABEL as Record<string, { fr: string; ar: string; emoji: string }>)[key];
  const over = settings?.builtIn[key as OrderSource];
  if (!base) return { name: key, emoji: "🏷️", custom: true };
  return { name: over?.name || base[lang], emoji: over?.emoji || base.emoji, custom: false };
}

/** The checkout question's answers: the shop's own sources, then the visible built-in ones. */
export function askableSources(settings: SourceSettings): string[] {
  return [...settings.custom.map((c) => c.key), ...ASKABLE_SOURCES.filter((k) => !settings.builtIn[k]?.hidden)];
}


export interface Touch {
  utmSource?: string | null;
  utmMedium?: string | null;
  utmCampaign?: string | null;
  /** host of the page the visitor came from ("l.instagram.com") */
  referrer?: string | null;
  /** an ad click id was in the address (fbclid, gclid, ttclid) */
  clickId?: "fb" | "google" | "tiktok" | null;
}

const BY_NAME: [RegExp, OrderSource][] = [
  [/insta|^ig$/, "instagram"],
  [/facebook|^fb$|meta|messenger/, "facebook"],
  [/tiktok|^tt$/, "tiktok"],
  [/google|gads|adwords|youtube/, "google"],
  [/whatsapp|^wa$/, "whatsapp"],
  [/telegram|^tg$/, "telegram"],
  [/push/, "push"],
];

/**
 * The source of a visit / an order. A link made for one of the shop's own sources
 * (`?utm_source=<its key>`) counts for that source.
 */
export function classifySource(t: Touch, custom: readonly CustomSource[] = []): string {
  const s = (t.utmSource ?? "").toLowerCase().trim();
  if (s && custom.some((c) => c.key === s)) return s;
  return classifyBuiltIn(t);
}

function classifyBuiltIn(t: Touch): OrderSource {
  const s = (t.utmSource ?? "").toLowerCase().trim();
  if (s) {
    for (const [re, src] of BY_NAME) if (re.test(s)) return src;
    if (s === "pwa" || s === "share") return s === "share" ? "referral" : "direct";
    return "campaign";
  }
  if (t.clickId === "fb") return "facebook";
  if (t.clickId === "google") return "google";
  if (t.clickId === "tiktok") return "tiktok";
  const r = (t.referrer ?? "").toLowerCase();
  if (r) {
    for (const [re, src] of BY_NAME) if (re.test(r.replace(/^(www|l|lm|m)\./, "").split(".")[0] ?? "")) return src;
    if (/(^|\.)instagram\.com$/.test(r)) return "instagram";
    if (/(^|\.)(facebook|fb)\.com$|messenger\.com$/.test(r)) return "facebook";
    if (/(^|\.)tiktok\.com$/.test(r)) return "tiktok";
    if (/(^|\.)google\.|bing\.com$|duckduckgo\.com$|yahoo\./.test(r)) return "google";
    if (/whatsapp\.com$|wa\.me$/.test(r)) return "whatsapp";
    if (/t\.me$|telegram\.org$/.test(r)) return "telegram";
    return "referral";
  }
  return "direct";
}

/** The team's orders (Caisse, manual orders): the channel says where it came from. */
export function sourceOfChannel(channel: string): OrderSource | null {
  if (channel === "instagram") return "instagram";
  if (channel === "whatsapp") return "whatsapp";
  if (channel === "boutique") return "boutique";
  if (channel === "telephone") return "other";
  return null;
}
