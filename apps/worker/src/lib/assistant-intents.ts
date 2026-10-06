/**
 * The assistant's everyday questions, answered from the shop's real data before falling back
 * to the product search: last products seen, favourites, cart, "where is my order", delivery
 * price and time to a wilaya, the shop's place and hours, contact, offers, new arrivals, best
 * sellers, a product's price and sizes in stock, a size from height and weight, the FAQ, and
 * follow-ups ("et en rouge ?"). Arabic, Darija and French. Rules only, no paid AI.
 */
import {
  boutiqueStatus,
  DAY_NAMES,
  DEFAULT_BOUTIQUE,
  formatDA,
  normalizeSearch,
  recommendSize,
  sha256Hex,
  STATUS_LABELS,
  timingSafeEqual,
  type AssistantReplyDTO,
  type OrderStatus,
  type ProductCardDTO,
} from "@henine/shared";
import type { z } from "zod";
import type { assistantInput } from "@henine/shared";
import type { Env } from "../env";
import { recommend, understand } from "./assistant";
import { getProductDetail, productCards } from "./catalog";
import { getSettings } from "./settings";

type Input = z.infer<typeof assistantInput>;
type Ctx = Input["context"];

const PREFIXES = ["", "ل", "ب", "و", "ال", "لل", "بال", "وال", "ف"];
const digits = (s: string) => s.replace(/[٠-٩]/g, (d) => String(d.charCodeAt(0) - 0x0660)).replace(/[۰-۹]/g, (d) => String(d.charCodeAt(0) - 0x06f0));

/** Text the rules read: normalised, Arabic digits as 0-9, punctuation as spaces. */
function clean(q: string): string {
  return ` ${normalizeSearch(digits(q)).replace(/[!?؟،,;:()«»"'.]/g, " ").replace(/\s+/g, " ").trim()} `;
}

/** One of these words (whole word, Arabic prefixes allowed; long words may be inside others). */
function hasAny(text: string, words: string[]): boolean {
  return words.some((w) => {
    const n = normalizeSearch(w);
    if (n.includes(" ")) return text.includes(` ${n} `) || text.includes(n);
    return PREFIXES.some((p) => text.includes(` ${p}${n} `)) || (n.length >= 5 && text.includes(n));
  });
}

const W = {
  greet: ["سلام", "السلام", "مرحبا", "اهلا", "صباح الخير", "مساء الخير", "bonjour", "bonsoir", "salut", "slt", "salam", "hello", "hi", "coucou"],
  thanks: ["شكرا", "يعطيك الصحة", "بارك الله", "merci", "thanks", "تسلمي", "ربي يحفظك"],
  recent: ["اخر منتج", "اخر ما", "اخر حاجة", "شاهدت", "شفت", "دخلت", "زرت", "vu", "vus", "consulte", "consultes", "visite", "recemment", "historique"],
  last: ["اخر", "dernier", "derniere", "derniers", "recemment"],
  favorites: ["مفضلتي", "المفضلة", "مفضلاتي", "favoris", "favori", "liste d'envies", "wishlist", "اعجبتني"],
  cart: ["سلتي", "السلة", "سلة", "panier", "باني", "قضيتي"],
  order: ["طلبي", "طلبيتي", "طلبيه", "الطلبية", "commande", "colis", "كوليتي", "الكولي", "وصلت", "وين وصل", "suivi", "suivre", "تتبع", "livree", "expediee"],
  delivery: ["توصيل", "التوصيل", "الشحن", "يوصل", "توصلو", "توصلون", "livraison", "livrer", "livrez", "expedition", "frais", "ارسال"],
  price: ["سعر", "بكم", "قداش", "قديش", "شحال", "ثمن", "prix", "combien", "coute", "tarif"],
  stock: ["كاين", "متوفر", "متوفرة", "موجود", "disponible", "dispo", "reste", "stock"],
  shop: ["المحل", "محل", "محلكم", "الحانوت", "عنوان", "العنوان", "وين راكم", "اين", "boutique", "magasin", "adresse", "ou etes", "localisation", "map", "خريطة"],
  hours: ["مفتوح", "تفتحو", "تفتحون", "تغلقو", "وقت", "اوقات", "ساعات", "ouvert", "ouvre", "ferme", "horaire", "horaires", "heure"],
  contact: ["رقم", "هاتف", "تيليفون", "واتساب", "واتس", "انستغرام", "تواصل", "numero", "telephone", "whatsapp", "contact", "instagram", "appeler"],
  promo: ["تخفيض", "تخفيضات", "صولد", "عرض", "عروض", "كود", "promo", "promos", "solde", "soldes", "reduction", "remise", "code", "offre", "flash"],
  new: ["جديد", "الجديد", "جديدكم", "واش جديد", "nouveau", "nouveaute", "nouveautes", "nouvelle collection", "arrivage"],
  best: ["الاكثر مبيعا", "الاكثر طلبا", "الافضل", "best", "populaire", "tendance", "meilleures ventes", "top"],
  size: ["مقاسي", "مقاس", "قياس", "taille", "pointure", "size"],
};

const T = (ar: boolean, a: string, f: string) => (ar ? a : f);

/** Prices inside an Arabic sentence: "2 500 دج" (a Latin "DA" flips around in right-to-left text). */
const dzd = (n: number) => `${Math.round(n).toLocaleString("fr-FR").replace(/[  ]/g, " ")} دج`;

function cardsBySlugs(all: ProductCardDTO[], slugs: string[]): ProductCardDTO[] {
  return slugs.map((s) => all.find((p) => p.slug === s)).filter((p): p is ProductCardDTO => !!p);
}

const withWhy = (list: ProductCardDTO[], why: (p: ProductCardDTO) => string[] = () => []) => list.map((p) => ({ ...p, why: why(p) }));

export async function answer(env: Env, input: Input): Promise<AssistantReplyDTO> {
  const ar = input.locale === "ar";
  const ctx: Ctx = input.context ?? { recent: [], favorites: [], cart: [], orders: [], history: [] };
  const text = clean(input.q);
  const wordsCount = text.trim().split(" ").filter(Boolean).length;
  const base = (reply: string, extra: Partial<AssistantReplyDTO> = {}): AssistantReplyDTO => ({ reply, understood: [], products: [], relaxed: false, ...extra });

  // ── small talk ──
  if (wordsCount <= 4 && hasAny(text, W.thanks)) {
    return base(T(ar, "بكل سرور 🌸 إذا احتجتِ أي شيء آخر أنا هنا.", "Avec plaisir 🌸 Je suis là si vous avez besoin d'autre chose."), { intent: "thanks" });
  }
  if (wordsCount <= 3 && hasAny(text, W.greet)) {
    return base(
      T(ar, "وعليكم السلام 🌸 أنا مساعدة Henine. أبحث لك عن قطعة (لون، مناسبة، مقاس، ميزانية)، أخبرك بسعر التوصيل إلى ولايتك، أين وصل طلبك، أو أين محلنا.", "Bonjour 🌸 Je suis l'assistante Henine. Je trouve une pièce pour vous (couleur, occasion, taille, budget), je donne le prix de livraison vers votre wilaya, où en est votre commande, ou l'adresse de la boutique."),
      { intent: "greet" },
    );
  }

  const all = await productCards(env);

  // ── what this phone knows ──
  if (hasAny(text, W.recent) || (hasAny(text, W.last) && hasAny(text, ["منتج", "قطعة", "produit", "article", "شاهدت", "دخلت", "vu"]))) {
    const list = cardsBySlugs(all, ctx.recent).slice(0, 6);
    return base(
      list.length
        ? T(ar, `آخر ما شاهدتِه: «${list[0]!.nameAr}»${list.length > 1 ? ` ثم ${list.length - 1} قطعة أخرى` : ""}.`, `Le dernier produit vu : « ${list[0]!.nameFr} »${list.length > 1 ? `, puis ${list.length - 1} autre(s)` : ""}.`)
        : T(ar, "لم تشاهدي أي منتج بعد على هذا الهاتف.", "Vous n'avez encore regardé aucun produit sur ce téléphone."),
      { intent: "recent", products: withWhy(list) },
    );
  }
  if (hasAny(text, W.favorites)) {
    const list = cardsBySlugs(all, ctx.favorites);
    return base(
      list.length ? T(ar, `في مفضلتك ${list.length} قطعة ❤️`, `${list.length} pièce(s) dans vos favoris ❤️`) : T(ar, "مفضلتك فارغة. اضغطي ♡ على أي قطعة لحفظها.", "Vos favoris sont vides : touchez ♡ sur une pièce pour la garder."),
      { intent: "favorites", products: withWhy(list.slice(0, 6), (p) => [p.inStock ? T(ar, "متوفرة", "Disponible") : T(ar, "نفدت حاليًا", "Épuisée pour le moment")]), actions: [{ label: T(ar, "❤️ مفضلتي", "❤️ Mes favoris"), href: "/favoris" }] },
    );
  }
  if (hasAny(text, W.cart) && !hasAny(text, W.delivery)) {
    const lines = ctx.cart;
    const pieces = lines.reduce((s, l) => s + l.qty, 0);
    const total = lines.reduce((s, l) => s + l.qty * l.price, 0);
    return base(
      pieces
        ? T(ar, `في سلتك ${pieces} قطعة بمجموع ${dzd(total)} (دون التوصيل).`, `Votre panier : ${pieces} pièce(s), ${formatDA(total, "fr")} (hors livraison).`)
        : T(ar, "سلتك فارغة حاليًا.", "Votre panier est vide pour le moment."),
      { intent: "cart", products: withWhy(cardsBySlugs(all, [...new Set(lines.map((l) => l.slug))]).slice(0, 6)), actions: pieces ? [{ label: T(ar, "🛍️ إتمام الطلب", "🛍️ Commander"), href: "/commande" }] : [] },
    );
  }
  if (hasAny(text, W.order) && !hasAny(text, W.delivery.filter((w) => w !== "توصيل"))) {
    for (const o of ctx.orders) {
      const row = await env.DB.prepare(
        "SELECT o.public_code, o.status, o.track_token_hash, o.total, w.name_fr, w.name_ar, o.tracking_number FROM orders o LEFT JOIN wilayas w ON w.code = o.wilaya_code WHERE o.public_code = ?",
      )
        .bind(o.code.toUpperCase())
        .first<{ public_code: string; status: OrderStatus; track_token_hash: string; total: number; name_fr: string | null; name_ar: string | null; tracking_number: string | null }>();
      if (!row || !timingSafeEqual(await sha256Hex(o.token, env.TRACK_TOKEN_PEPPER), row.track_token_hash)) continue;
      const label = STATUS_LABELS[row.status][ar ? "ar" : "fr"];
      return base(
        T(ar, `طلبك ${row.public_code} (${dzd(row.total)}): ${label}${row.name_ar ? ` · إلى ${row.name_ar}` : ""}.`, `Votre commande ${row.public_code} (${formatDA(row.total, "fr")}) : ${label}${row.name_fr ? ` · vers ${row.name_fr}` : ""}.`),
        { intent: "order", actions: [{ label: T(ar, "📦 تفاصيل التتبع", "📦 Voir le suivi"), href: `/suivi?c=${row.public_code}&t=${encodeURIComponent(o.token)}` }] },
      );
    }
    return base(T(ar, "لا أجد طلبًا على هذا الهاتف. يمكنك تتبعه برقم هاتفك من صفحة التتبع.", "Je ne trouve pas de commande sur ce téléphone. Suivez-la avec votre numéro sur la page Suivi."), {
      intent: "order",
      actions: [{ label: T(ar, "📦 تتبع الطلب", "📦 Suivre ma commande"), href: "/suivi" }],
    });
  }

  // ── delivery to a wilaya ──
  if (hasAny(text, W.delivery)) {
    const { results: wilayas } = await env.DB.prepare("SELECT code, name_fr, name_ar, home_price, desk_price, delay_days, is_active FROM wilayas ORDER BY code").all<{
      code: number; name_fr: string; name_ar: string; home_price: number | null; desk_price: number | null; delay_days: string | null; is_active: number;
    }>();
    const num = text.match(/(?:^|\s)(\d{1,2})(?=\s|$)/);
    const w =
      wilayas.find((x) => [x.name_fr, x.name_ar].some((n) => hasAny(text, [n]))) ??
      (num ? wilayas.find((x) => x.code === Number(num[1])) : undefined);
    const { checkout } = await getSettings(env, ["checkout"]);
    const free = checkout.free_shipping_over ? T(ar, ` التوصيل مجاني ابتداءً من ${dzd(checkout.free_shipping_over)}.`, ` Livraison offerte dès ${formatDA(checkout.free_shipping_over, "fr")}.`) : "";
    if (w) {
      if (!w.is_active || (w.home_price == null && w.desk_price == null)) {
        return base(T(ar, `للأسف التوصيل إلى ${w.name_ar} غير متاح حاليًا.`, `La livraison vers ${w.name_fr} n'est pas disponible pour le moment.`), { intent: "delivery" });
      }
      const parts = [
        w.home_price != null ? T(ar, `إلى المنزل ${dzd(w.home_price)}`, `à domicile ${formatDA(w.home_price, "fr")}`) : null,
        checkout.desk_enabled && w.desk_price != null ? T(ar, `إلى المكتب ${dzd(w.desk_price)}`, `au bureau ${formatDA(w.desk_price, "fr")}`) : null,
      ].filter(Boolean);
      const delay = w.delay_days ? T(ar, ` المدة: ${w.delay_days} أيام.`, ` Délai : ${w.delay_days} jours.`) : "";
      return base(T(ar, `🚚 التوصيل إلى ${w.name_ar} (${w.code}): ${parts.join("، ")}.${delay}${free} الدفع عند الاستلام.`, `🚚 Livraison vers ${w.name_fr} (${w.code}) : ${parts.join(", ")}.${delay}${free} Paiement à la livraison.`), { intent: "delivery" });
    }
    return base(
      T(ar, `نوصل إلى الولايات الـ69 مع ZR Express، إلى المنزل أو إلى المكتب، والدفع عند الاستلام.${free} قولي لي ولايتك وأعطيك السعر والمدة بالضبط.`, `Nous livrons les 69 wilayas avec ZR Express, à domicile ou au bureau, paiement à la livraison.${free} Dites-moi votre wilaya pour le prix et le délai exacts.`),
      { intent: "delivery" },
    );
  }

  // ── the shop, its hours, contact ──
  if (hasAny(text, W.shop) || hasAny(text, W.hours)) {
    const { boutique: saved } = await getSettings(env, ["boutique"]);
    const b = { ...DEFAULT_BOUTIQUE, ...saved };
    const s = boutiqueStatus(b.hours);
    const day = s.next ? (s.next.today ? T(ar, "اليوم", "aujourd'hui") : s.next.tomorrow ? T(ar, "غدًا", "demain") : DAY_NAMES[ar ? "ar" : "fr"][s.next.day]) : "";
    const status = s.open ? T(ar, `مفتوح الآن حتى ${s.closesAt}.`, `Ouvert maintenant jusqu'à ${s.closesAt}.`) : s.next ? T(ar, `مغلق الآن، يفتح ${day} على ${s.next.time}.`, `Fermé, ouvre ${day} à ${s.next.time}.`) : "";
    return base(T(ar, `📍 محلنا: ${b.addressAr}. ${status}`, `📍 La boutique : ${b.addressFr}. ${status}`), {
      intent: "shop",
      actions: [
        { label: T(ar, "📍 الخريطة والأوقات", "📍 Plan et horaires"), href: "/boutique" },
        { label: T(ar, "🧭 الاتجاهات", "🧭 Itinéraire"), href: `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(b.mapQuery)}` },
      ],
    });
  }
  if (hasAny(text, W.contact) && !hasAny(text, W.price)) {
    const { contact } = await getSettings(env, ["contact"]);
    const lines = [contact.whatsapp ? `WhatsApp ${contact.whatsapp}` : null, contact.phone ? `☎ ${contact.phone}` : null, "Instagram @henine.boutique"].filter(Boolean);
    return base(T(ar, `تواصلي معنا: ${lines.join(" · ")}.`, `Pour nous joindre : ${lines.join(" · ")}.`), {
      intent: "contact",
      actions: [{ label: T(ar, "✉️ تواصلي معنا", "✉️ Nous écrire"), href: "/contact" }],
    });
  }

  // ── offers, new arrivals, best sellers ──
  const inStock = all.filter((p) => p.inStock);
  if (hasAny(text, W.promo)) {
    const list = inStock.filter((p) => p.flash || (p.compareAtPrice != null && p.compareAtPrice > p.price)).slice(0, 6);
    return base(
      list.length
        ? T(ar, `🔥 ${list.length} قطعة بتخفيض الآن:`, `🔥 ${list.length} pièce(s) en promotion en ce moment :`)
        : T(ar, "لا توجد تخفيضات حاليًا. فعّلي «استقبال الجديد» لتعرفي أول تخفيض 🌸", "Pas de promotion en ce moment. Activez « Recevoir les nouveautés » pour être prévenue 🌸"),
      { intent: "promo", products: withWhy(list, (p) => (p.compareAtPrice ? [`-${Math.round((1 - p.price / p.compareAtPrice) * 100)}%`] : [])) },
    );
  }
  if (hasAny(text, W.new) && understand(input.q).colors.length === 0) {
    const list = [...inStock].sort((a, b) => b.createdAt - a.createdAt).slice(0, 6);
    return base(T(ar, "✨ آخر ما وصل إلى المحل:", "✨ Les dernières arrivées :"), { intent: "new", products: withWhy(list), actions: [{ label: T(ar, "كل الجديد", "Toutes les nouveautés"), href: "/nouveautes" }] });
  }
  if (hasAny(text, W.best)) {
    const RANK = { bestseller: 0, trending: 1, popular: 2 } as const;
    const list = inStock.filter((p) => p.badge).sort((a, b) => RANK[a.badge!] - RANK[b.badge!]).slice(0, 6);
    const shown = list.length ? list : [...inStock].sort((a, b) => (b.rating?.avg ?? 0) - (a.rating?.avg ?? 0)).slice(0, 6);
    return base(T(ar, "🔥 الأكثر طلبًا عندنا:", "🔥 Les plus demandées :"), { intent: "best", products: withWhy(shown) });
  }

  // ── one product by its name: price, sizes in stock ──
  const named = all
    .map((p) => {
      const tokens = normalizeSearch(`${p.nameFr} ${p.nameAr}`).split(/\s+/).filter((t) => t.length >= 4);
      return { p, hits: tokens.filter((t) => text.includes(t)).length };
    })
    .filter((x) => x.hits > 0)
    .sort((a, b) => b.hits - a.hits)[0];
  if (named && (hasAny(text, W.price) || hasAny(text, W.stock) || named.hits >= 2)) {
    const d = await getProductDetail(env, named.p.slug);
    if (d) {
      const sizeOpt = d.options.find((o) => o.kind === "taille");
      const sizes = (sizeOpt?.values ?? [])
        .filter((v) => d.variants.some((vr) => vr.optionValueIds.includes(v.id) && vr.available > 0))
        .map((v) => (ar ? v.labelAr : v.labelFr));
      const wantSize = understand(input.q).sizes[0]?.toUpperCase();
      const sizeAnswer = wantSize
        ? sizes.map((s) => s.toUpperCase()).includes(wantSize)
          ? T(ar, ` المقاس ${wantSize} متوفر ✓.`, ` La taille ${wantSize} est disponible ✓.`)
          : T(ar, ` المقاس ${wantSize} غير متوفر حاليًا.`, ` La taille ${wantSize} n'est pas disponible pour le moment.`)
        : "";
      const avail = !d.inStock
        ? T(ar, " نفد حاليًا، يمكنك طلب إشعار عند عودته.", " Épuisé pour le moment : demandez à être prévenue de son retour.")
        : sizes.length
          ? T(ar, ` المقاسات المتوفرة: ${sizes.join("، ")}.`, ` Tailles disponibles : ${sizes.join(", ")}.`)
          : T(ar, " متوفر.", " Disponible.");
      return base(T(ar, `«${d.nameAr}»: ${dzd(d.price)}.${avail}${sizeAnswer}`, `« ${d.nameFr} » : ${formatDA(d.price, "fr")}.${avail}${sizeAnswer}`), {
        intent: "product",
        products: withWhy([d]),
      });
    }
  }

  // ── a size from height and weight ──
  const h = text.match(/(1[3-9]\d|2[01]\d)\s*(?:cm|سم|سنتي)?/);
  const kg = text.match(/(\d{2,3})\s*(?:kg|كغ|كيلو|kilo)/);
  if (hasAny(text, W.size) && h && kg) {
    const advice = recommendSize({ sizes: ["XS", "S", "M", "L", "XL", "XXL"], height: Number(h[1]), weight: Number(kg[1]) });
    if (advice) {
      return base(
        T(ar, `📏 حسب طولك ووزنك، المقاس الأقرب لك: ${advice.size}${advice.alternative ? ` (أو ${advice.alternative})` : ""}. في صفحة كل منتج زر «أي مقاس أختار؟» يقارن بجدول ذلك الموديل.`, `📏 D'après votre taille et votre poids : ${advice.size}${advice.alternative ? ` (ou ${advice.alternative})` : ""}. Sur chaque fiche, « Quelle taille choisir ? » compare avec le tableau du modèle.`),
        { intent: "size" },
      );
    }
  }

  // ── FAQ (payment, exchanges, discretion…) ──
  const { faq } = await getSettings(env, ["faq"]);
  const qWords = text.trim().split(" ").filter((w) => w.length >= 3);
  const bestFaq = faq
    .map((f) => {
      const qn = normalizeSearch(`${f.q_ar} ${f.q_fr}`);
      return { f, score: qWords.filter((w) => qn.includes(w)).length };
    })
    .sort((a, b) => b.score - a.score)[0];
  const looksLikeQuestion = /\?|؟|كيف|هل|واش|comment|est-ce|peut|puis/.test(input.q) || hasAny(text, ["دفع", "نخلص", "تبديل", "ارجاع", "paiement", "payer", "echange", "retour", "discret", "سري"]);
  if (bestFaq && bestFaq.score >= 1 && looksLikeQuestion && understand(input.q).categories.length === 0) {
    return base(ar ? bestFaq.f.a_ar : bestFaq.f.a_fr, { intent: "faq" });
  }

  // ── product search; a short follow-up ("et en rouge ?") continues the previous one ──
  const w = understand(input.q);
  const onlyRefines = w.categories.length === 0 && !w.occasion && w.words.length <= 1 && (w.colors.length > 0 || w.sizes.length > 0 || w.maxPrice != null);
  const query = onlyRefines && ctx.previous ? `${ctx.previous} ${input.q}` : input.q;
  const found = await recommend(env, query, input.locale);
  return {
    ...found,
    intent: "search",
    reply: found.products.length
      ? undefined
      : T(ar, "لم أجد قطعة متوفرة بهذه المواصفات. جربي لونًا أو مقاسًا آخر، أو اسأليني عن الجديد أو التخفيضات.", "Je n'ai rien trouvé en stock avec ces critères. Essayez une autre couleur ou taille, ou demandez-moi les nouveautés ou les promos."),
  };
}
