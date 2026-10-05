/**
 * Customer-facing store texts that the team can edit (Admin → Page d'accueil → Textes).
 * Built-in defaults exist for both languages, so nothing ever has to be translated: the
 * admin edits one language at a time, and anything left untouched keeps its default.
 */
import type { Locale } from "./i18n";

export interface StoreTexts {
  /** small line above the big animated title */
  eyebrow: string;
  /** the big animated title at the top of the home page */
  title: string;
  subtitle: string;
  /** messages scrolling in the top banner */
  announcement: string[];
  /** questions at the bottom of the home page */
  faq: { q: string; a: string }[];
  /** shown when orders are paused (Admin → Page d'accueil → pause) */
  pause: string;
}

/** Only the texts the team changed, per language. */
export type StoreTextOverrides = Partial<StoreTexts>;

export const STORE_TEXTS: Record<Locale, StoreTexts> = {
  fr: {
    eyebrow: "Nouvelle collection",
    title: "L’élégance & la qualité au meilleur prix",
    subtitle: "Pyjamas, lingerie, nuisettes et djebbas choisis avec soin, livrés partout en Algérie.",
    announcement: ["🚚 Livraison dans les 69 wilayas", "💵 Paiement à la livraison", "🔄 Échange possible", "🌸 Boutique à Boumerdès · 7j/7"],
    faq: [
      { q: "Où livrez-vous ?", a: "Dans les 69 wilayas avec ZR Express, à domicile ou au bureau le plus proche." },
      { q: "Comment payer ?", a: "En espèces à la réception du colis, sans carte bancaire." },
      { q: "Quand arrive ma commande ?", a: "1 à 3 jours dans le Nord, jusqu’à 7 jours dans le Sud." },
      { q: "Puis-je échanger la taille ?", a: "Oui, contactez-nous dans les 48 h suivant la réception." },
      { q: "L’emballage est-il discret ?", a: "Oui, toutes les commandes partent dans un emballage totalement discret." },
      { q: "Comment suivre ma commande ?", a: "Avec votre numéro de téléphone sur la page « Suivi », sans compte." },
    ],
    pause: "La boutique est momentanément en pause.",
  },
  ar: {
    eyebrow: "تشكيلة جديدة",
    title: "الأناقة والجودة بأفضل سعر",
    subtitle: "بيجامات، ملابس داخلية، قمصان نوم وجبب مختارة بعناية، تصلك إلى كل أنحاء الجزائر.",
    announcement: ["🚚 التوصيل إلى 69 ولاية", "💵 الدفع عند الاستلام", "🔄 إمكانية التبديل", "🌸 محلنا في بومرداس · 7/7"],
    faq: [
      { q: "أين توصلون؟", a: "نوصل إلى كل الولايات الـ69 مع ZR Express، إلى المنزل أو إلى أقرب مكتب." },
      { q: "كيف أدفع؟", a: "تدفعين نقدًا عند استلام الطلب، لا حاجة لبطاقة بنكية." },
      { q: "متى يصل طلبي؟", a: "من 1 إلى 3 أيام في ولايات الشمال، وحتى 7 أيام في ولايات الجنوب." },
      { q: "هل يمكنني تبديل المقاس؟", a: "نعم، تواصلي معنا خلال 48 ساعة من الاستلام وسنجد الحل معًا." },
      { q: "هل التغليف سري؟", a: "نعم، كل الطلبات تُرسل في تغليف سري تمامًا." },
      { q: "كيف أتتبع طلبي؟", a: "برقم هاتفك فقط من صفحة «تتبع الطلب»، بدون حساب أو كلمة سر." },
    ],
    pause: "المتجر متوقف مؤقتا.",
  },
};

/** Defaults + the team's edits for one language (empty edits fall back to the default). */
export function resolveStoreTexts(locale: Locale, overrides: StoreTextOverrides | undefined): StoreTexts {
  const d = STORE_TEXTS[locale];
  const o = overrides ?? {};
  const str = (v: string | undefined, fallback: string) => (v && v.trim() ? v : fallback);
  const announcement = o.announcement?.filter((m) => m.trim());
  const faq = o.faq?.filter((f) => f.q.trim() && f.a.trim());
  return {
    eyebrow: str(o.eyebrow, d.eyebrow),
    title: str(o.title, d.title),
    subtitle: str(o.subtitle, d.subtitle),
    announcement: announcement?.length ? announcement : d.announcement,
    faq: faq?.length ? faq : d.faq,
    pause: str(o.pause, d.pause),
  };
}
