/**
 * Where an order comes from. The store remembers how a visitor arrived (campaign link, ad click,
 * a link shared on Instagram / WhatsApp, Google…) for 30 days and sends it with the order; the
 * team's own orders take the source of their channel. Normalised to one short list so the
 * statistics can compare sources.
 */

export const ORDER_SOURCES = ["direct", "instagram", "facebook", "tiktok", "google", "whatsapp", "telegram", "referral", "campaign", "push", "boutique", "other"] as const;
export type OrderSource = (typeof ORDER_SOURCES)[number];

export const ORDER_SOURCE_LABEL: Record<OrderSource, { fr: string; emoji: string }> = {
  direct: { fr: "Site (accès direct)", emoji: "🌐" },
  instagram: { fr: "Instagram", emoji: "📸" },
  facebook: { fr: "Facebook", emoji: "📘" },
  tiktok: { fr: "TikTok", emoji: "🎵" },
  google: { fr: "Google", emoji: "🔎" },
  whatsapp: { fr: "WhatsApp", emoji: "💬" },
  telegram: { fr: "Telegram", emoji: "✈️" },
  referral: { fr: "Autre site (lien)", emoji: "🔗" },
  campaign: { fr: "Campagne", emoji: "📣" },
  push: { fr: "Notification", emoji: "🔔" },
  boutique: { fr: "Boutique (en magasin)", emoji: "🏬" },
  other: { fr: "Autre", emoji: "✨" },
};

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

/** The source of a visit / an order. */
export function classifySource(t: Touch): OrderSource {
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
