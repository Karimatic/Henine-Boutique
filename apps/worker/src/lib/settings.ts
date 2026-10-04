/**
 * Typed access to the `settings` key/value table. Values are JSON; missing keys fall back
 * to defaults, so the store works even on an empty database.
 */
import { DEFAULT_BOUTIQUE, DEFAULT_DESIGN, type BoutiqueDTO, type DesignDTO, type StoreTextOverrides } from "@henine/shared";
import type { Env } from "../env";

export interface Settings {
  store: { name: string; tagline_fr: string; tagline_ar: string; city_fr: string; city_ar: string; hours_fr: string; hours_ar: string; wilaya: number };
  contact: {
    phone: string | null; whatsapp: string | null; instagram: string | null; tiktok: string | null;
    facebook: string | null; maps: string | null; address_fr: string | null; address_ar: string | null;
    /** Instagram follower count shown on the home page ("+89K"); hidden when empty. */
    followers: string | null;
  };
  announcement: { active: boolean; messages_fr: string[]; messages_ar: string[] };
  hero: { eyebrow_fr: string; eyebrow_ar: string; title_fr: string; title_ar: string; subtitle_fr: string; subtitle_ar: string };
  checkout: {
    cod: boolean; express_on_product: boolean; require_turnstile: boolean; max_orders_per_phone_per_hour: number;
    free_shipping_over: number | null; desk_enabled: boolean;
  };
  loyalty: { enabled: boolean; points_per_100da: number; redeem_value_da: number; min_redeem: number; expiry_days: number };
  maintenance: { active: boolean; message_fr: string; message_ar: string };
  notifications: {
    telegram_new_order: boolean; telegram_status_change: boolean; telegram_low_stock: boolean;
    telegram_review: boolean; telegram_contact: boolean; trust_group_members: boolean;
  };
  telegram: {
    token_enc: string | null; chat_id: string | null; chat_title: string | null; bot_username: string | null;
    webhook_secret_enc: string | null; webhook_url: string | null; last_update_id: number;
  };
  integrations: { zr_id_enc: string | null; zr_token_enc: string | null; meta_pixel_id: string | null; tiktok_pixel_id: string | null };
  /** Instagram API (product photos from the shop's posts); token encrypted */
  instagram: {
    token_enc: string | null; username: string | null; user_id: string | null; refreshed_at: number | null;
    /** live follower count from the Instagram API (daily), shown on the home page */
    followers?: number | null; followers_at?: number | null;
  };
  /** Home page FAQ (Admin → Marketing → Page d’accueil) */
  faq: { q_fr: string; a_fr: string; q_ar: string; a_ar: string }[];
  "shipping.prices_verified": boolean;
  catalog_version: number;
  /** start/end times of published drops: public cache keys change when one passes */
  drop_times: number[];
  reviews: { auto_approve_verified: boolean };
  /** edits to the built-in store texts (hero, banner, FAQ, pause message), per language */
  texts: { ar: StoreTextOverrides; fr: StoreTextOverrides };
  /** logo, colours, fonts, banners, home sections (Admin → Page d'accueil → Apparence) */
  design: DesignDTO;
  /** the shop in Boumerdès: address, map, opening hours (the /boutique page) */
  boutique: BoutiqueDTO;
}

export const DEFAULTS: Settings = {
  store: {
    name: "Henine Boutique", tagline_fr: "L’élégance & la qualité au meilleur prix", tagline_ar: "الأناقة والجودة بأفضل سعر",
    city_fr: "Boumerdès", city_ar: "بومرداس", hours_fr: "Ouvert 7j/7", hours_ar: "مفتوح 7/7", wilaya: 35,
  },
  contact: {
    phone: null, whatsapp: null, instagram: "https://www.instagram.com/henine.boutique/", tiktok: null,
    facebook: null, maps: null, address_fr: "Boumerdès", address_ar: "بومرداس", followers: "+89K",
  },
  announcement: {
    active: true,
    messages_fr: ["🚚 Livraison dans les 69 wilayas", "💵 Paiement à la livraison", "🌸 Boutique à Boumerdès · 7j/7"],
    messages_ar: ["🚚 التوصيل إلى 69 ولاية", "💵 الدفع عند الاستلام", "🌸 محلنا في بومرداس · 7/7"],
  },
  hero: {
    eyebrow_fr: "Nouvelle collection", eyebrow_ar: "تشكيلة جديدة",
    title_fr: "L’élégance & la qualité au meilleur prix", title_ar: "الأناقة والجودة بأفضل سعر",
    subtitle_fr: "Robes, djebbas et pyjamas choisis avec soin, livrés partout en Algérie.",
    subtitle_ar: "فساتين، جبات وبيجامات مختارة بعناية، تصلك إلى كل أنحاء الجزائر.",
  },
  checkout: {
    cod: true, express_on_product: true, require_turnstile: true, max_orders_per_phone_per_hour: 3,
    free_shipping_over: null, desk_enabled: true,
  },
  loyalty: { enabled: false, points_per_100da: 1, redeem_value_da: 5, min_redeem: 100, expiry_days: 365 }, // 1 pt / 100 DA, 1 pt = 5 DA → 5 % back
  maintenance: { active: false, message_fr: "", message_ar: "" },
  notifications: {
    telegram_new_order: true, telegram_status_change: true, telegram_low_stock: true,
    telegram_review: true, telegram_contact: true, trust_group_members: true,
  },
  telegram: { token_enc: null, chat_id: null, chat_title: null, bot_username: null, webhook_secret_enc: null, webhook_url: null, last_update_id: 0 },
  integrations: { zr_id_enc: null, zr_token_enc: null, meta_pixel_id: null, tiktok_pixel_id: null },
  instagram: { token_enc: null, username: null, user_id: null, refreshed_at: null },
  faq: [
    { q_ar: "أين توصلون؟", a_ar: "نوصل إلى كل الولايات الـ69 مع ZR Express، إلى المنزل أو إلى أقرب مكتب.", q_fr: "Où livrez-vous ?", a_fr: "Dans les 69 wilayas avec ZR Express, à domicile ou au bureau le plus proche." },
    { q_ar: "كيف أدفع؟", a_ar: "تدفعين نقدًا عند استلام الطلب، لا حاجة لبطاقة بنكية.", q_fr: "Comment payer ?", a_fr: "En espèces à la réception du colis, sans carte bancaire." },
    { q_ar: "متى يصل طلبي؟", a_ar: "من 1 إلى 3 أيام في ولايات الشمال، وحتى 7 أيام في ولايات الجنوب.", q_fr: "Quand arrive ma commande ?", a_fr: "1 à 3 jours dans le Nord, jusqu’à 7 jours dans le Sud." },
    { q_ar: "هل يمكنني تبديل المقاس؟", a_ar: "نعم، تواصلي معنا خلال 48 ساعة من الاستلام وسنجد الحل معًا.", q_fr: "Puis-je échanger la taille ?", a_fr: "Oui, contactez-nous dans les 48 h suivant la réception." },
    { q_ar: "هل التغليف سري؟", a_ar: "نعم، كل الطلبات تُرسل في تغليف سري تمامًا.", q_fr: "L’emballage est-il discret ?", a_fr: "Oui, toutes les commandes partent dans un emballage totalement discret." },
    { q_ar: "كيف أتتبع طلبي؟", a_ar: "برقم هاتفك فقط من صفحة «تتبع الطلب»، بدون حساب أو كلمة سر.", q_fr: "Comment suivre ma commande ?", a_fr: "Avec votre numéro de téléphone sur la page « Suivi », sans compte." },
  ],
  "shipping.prices_verified": false,
  catalog_version: 0,
  drop_times: [],
  reviews: { auto_approve_verified: true },
  texts: { ar: {}, fr: {} },
  design: DEFAULT_DESIGN,
  boutique: DEFAULT_BOUTIQUE,
};

export type SettingKey = keyof Settings;

function merge<K extends SettingKey>(key: K, stored: unknown): Settings[K] {
  const def = DEFAULTS[key];
  if (stored == null) return def;
  if (typeof def === "object" && def !== null && !Array.isArray(def) && typeof stored === "object") {
    return { ...def, ...(stored as object) } as Settings[K];
  }
  return stored as Settings[K];
}

export async function getSetting<K extends SettingKey>(env: Env, key: K): Promise<Settings[K]> {
  const row = await env.DB.prepare("SELECT value FROM settings WHERE key = ?").bind(key).first<{ value: string }>();
  return merge(key, row ? JSON.parse(row.value) : null);
}

export async function getSettings<K extends SettingKey>(env: Env, keys: K[]): Promise<Pick<Settings, K>> {
  const placeholders = keys.map(() => "?").join(",");
  const { results } = await env.DB.prepare(`SELECT key, value FROM settings WHERE key IN (${placeholders})`)
    .bind(...keys)
    .all<{ key: K; value: string }>();
  const found = new Map(results.map((r) => [r.key, JSON.parse(r.value)]));
  const out = {} as Pick<Settings, K>;
  for (const k of keys) out[k] = merge(k, found.get(k));
  return out;
}

export function setSettingStmt<K extends SettingKey>(env: Env, key: K, value: Settings[K]) {
  return env.DB.prepare(
    "INSERT INTO settings (key, value, updated_at) VALUES (?, ?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at",
  ).bind(key, JSON.stringify(value), Date.now());
}

export async function setSetting<K extends SettingKey>(env: Env, key: K, value: Settings[K]) {
  await setSettingStmt(env, key, value).run();
}

/** Partial update of an object setting. */
export async function patchSetting<K extends SettingKey>(env: Env, key: K, patch: Partial<Settings[K]>): Promise<Settings[K]> {
  const current = await getSetting(env, key);
  const next = { ...(current as object), ...(patch as object) } as Settings[K];
  await setSetting(env, key, next);
  return next;
}

/** Bumped on every catalogue change: public catalogue cache keys include it. */
export function bumpCatalogStmt(env: Env) {
  return setSettingStmt(env, "catalog_version", Date.now());
}
