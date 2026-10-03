/**
 * "✨ Assistante Henine": turns a free-text wish ("robe noire pour un mariage, moins de
 * 8000 DA", "بيجامة حمراء مقاس L") into filters and answers with real products only:
 * published, in stock, with their price. Rules, no paid AI: colours, sizes, budget,
 * occasions and categories in French, Arabic and Darija.
 */
import { formatDA, normalizeSearch, type AssistantReplyDTO, type ProductCardDTO } from "@henine/shared";
import type { Env } from "../env";
import { productCards } from "./catalog";

/** Colour families: words that name them (normalised) + a reference hex for custom colour names. */
const COLORS: { key: string; fr: string; ar: string; hex: string; words: string[] }[] = [
  { key: "noir", fr: "noir", ar: "أسود", hex: "#1a1a1a", words: ["noir", "noire", "black", "اسود", "سوداء", "سودا", "كحل", "كحلة", "k7al", "khal"] },
  { key: "blanc", fr: "blanc", ar: "أبيض", hex: "#f7f5f2", words: ["blanc", "blanche", "white", "ابيض", "بيضاء", "بيضا", "abyad"] },
  { key: "rouge", fr: "rouge", ar: "أحمر", hex: "#b3261e", words: ["rouge", "red", "احمر", "حمراء", "حمرا", "bordeaux", "بوردو", "عنابي"] },
  { key: "rose", fr: "rose", ar: "وردي", hex: "#e8a0b4", words: ["rose", "pink", "وردي", "وردية", "روز", "زهري", "poudre"] },
  { key: "bleu", fr: "bleu", ar: "أزرق", hex: "#2a5aa8", words: ["bleu", "bleue", "blue", "ازرق", "زرقاء", "زرقا", "marine", "نيلي"] },
  { key: "vert", fr: "vert", ar: "أخضر", hex: "#2f7a55", words: ["vert", "verte", "green", "اخضر", "خضراء", "خضرا", "emeraude", "زمردي", "kaki"] },
  { key: "beige", fr: "beige", ar: "بيج", hex: "#d8c3a5", words: ["beige", "بيج", "nude", "camel", "كريمي", "creme"] },
  { key: "marron", fr: "marron", ar: "بني", hex: "#6b4226", words: ["marron", "brun", "brown", "بني", "chocolat", "قهوي"] },
  { key: "gris", fr: "gris", ar: "رمادي", hex: "#8a8a8a", words: ["gris", "grise", "grey", "gray", "رمادي", "رمادية"] },
  { key: "violet", fr: "violet", ar: "بنفسجي", hex: "#6b3fa0", words: ["violet", "violette", "mauve", "lilas", "بنفسجي", "موف"] },
  { key: "jaune", fr: "jaune", ar: "أصفر", hex: "#e5b81f", words: ["jaune", "yellow", "اصفر", "صفراء", "moutarde"] },
  { key: "dore", fr: "doré", ar: "ذهبي", hex: "#c9a14a", words: ["dore", "doree", "or", "gold", "ذهبي", "ذهبية"] },
];

/** Occasions → what to look for (category slugs / words in the name, tags or description). */
const OCCASIONS: { fr: string; ar: string; words: string[]; categories: string[]; hints: string[] }[] = [
  {
    fr: "mariage / soirée", ar: "عرس / سهرة",
    words: ["mariage", "soiree", "fete", "ceremonie", "gala", "عرس", "زفاف", "عروس", "سهرة", "حفلة", "حفل", "مناسبة", "fiancailles", "خطوبة", "تصديرة"],
    categories: ["robes", "djebba"], hints: ["soiree", "satin", "paillettes", "dentelle", "longue", "سهرة", "ساتان", "جبة"],
  },
  {
    fr: "maison / nuit", ar: "الدار / النوم",
    words: ["maison", "nuit", "dormir", "sommeil", "detente", "الدار", "البيت", "نوم", "النوم", "راحة"],
    categories: ["pyjamas", "djebba"], hints: ["pyjama", "nuisette", "coton", "بيجامة", "جبة"],
  },
  {
    fr: "mariée / lune de miel", ar: "عروس / شهر العسل",
    words: ["lune de miel", "trousseau", "شهر العسل", "جهاز", "الجهاز"],
    categories: [], hints: ["nuisette", "soie", "dentelle", "satin"],
  },
  {
    fr: "tous les jours", ar: "كل يوم",
    words: ["quotidien", "travail", "bureau", "casual", "يومي", "العمل", "الخدمة"],
    categories: [], hints: ["coton", "confort"],
  },
];

/** Category words (besides the category names themselves). */
const CATEGORY_WORDS: Record<string, string[]> = {
  robes: ["robe", "robes", "فستان", "فساتين", "قفطان", "كفتان", "dress", "rob"],
  pyjamas: ["pyjama", "pyjamas", "بيجامة", "بيجامات", "pijama", "pyj"],
  djebba: ["djebba", "djebbas", "jebba", "jebbas", "جبة", "جبات", "جبه", "قندورة", "gandoura", "djellaba", "جلابة"],
};

const SIZES = ["xxs", "xs", "s", "m", "l", "xl", "xxl", "xxxl", "3xl", "4xl"];

export interface Wish {
  maxPrice: number | null;
  minPrice: number | null;
  colors: typeof COLORS;
  sizes: string[];
  occasion: (typeof OCCASIONS)[number] | null;
  categories: string[];
  words: string[];
}

/** "8000", "8 000", "8.000", "8k", "8 الاف", "8 آلاف" → 8000 */
function amount(raw: string, unit?: string): number {
  const n = Number(raw.replace(/[\s.,]/g, ""));
  return unit && /^(k|الاف|آلاف|الف|ألف|mille)$/.test(unit) ? n * 1000 : n;
}

/** Patterns are written naturally ("حتى", "إلى") and normalised like the text they read. */
const rx = (src: string) => new RegExp(normalizeSearch(src));

const digits = (s: string) => s.replace(/[٠-٩]/g, (d) => String(d.charCodeAt(0) - 0x0660)).replace(/[۰-۹]/g, (d) => String(d.charCodeAt(0) - 0x06f0));

export function understand(q: string): Wish {
  const text = ` ${normalizeSearch(digits(q)).replace(/[!?،,;:()]/g, " ")} `;
  const NUM = String.raw`(\d{1,3}(?:[\s.]\d{3})+|\d+)\s*(k|الاف|آلاف|الف|ألف|mille)?`;
  let maxPrice: number | null = null;
  let minPrice: number | null = null;
  const between = text.match(rx(String.raw`(?:entre|بين|من)\s*${NUM}\s*(?:et|و|الى|إلى|a|-)\s*${NUM}`));
  if (between) {
    minPrice = amount(between[1]!, between[2]);
    maxPrice = amount(between[3]!, between[4]);
  } else {
    const max = text.match(rx(String.raw`(?:moins de|moins que|max(?:imum)?|sous|pas plus de|jusqu'?a|budget|اقل من|اقل|ما يفوتش|ما يتعداش|حتى|لا يتجاوز|في حدود|حوالي|<)\s*${NUM}`));
    if (max) maxPrice = amount(max[1]!, max[2]);
    const min = text.match(rx(String.raw`(?:plus de|au moins|minimum|اكثر من|فوق|>)\s*${NUM}`));
    if (min) minPrice = amount(min[1]!, min[2]);
    // a lone amount with a currency ("5000 da", "5000 دج") is a budget
    if (maxPrice == null && minPrice == null) {
      const lone = text.match(rx(String.raw`${NUM}\s*(?:da|dzd|دج|دينار|dinars?)`));
      if (lone) maxPrice = amount(lone[1]!, lone[2]);
    }
  }
  if (maxPrice != null && maxPrice < 100) maxPrice = null; // "2 robes" is not a budget
  // Arabic glues little words on: "لعرس", "بالأسود", "والأحمر"
  const PREFIXES = ["", "ل", "ب", "و", "ال", "لل", "بال", "وال"];
  const has = (w: string) => {
    const n = normalizeSearch(w);
    return PREFIXES.some((pre) => text.includes(` ${pre}${n} `)) || (n.length > 4 && text.includes(n));
  };
  const colors = COLORS.filter((c) => c.words.some(has));
  const sizes = SIZES.filter((s) => new RegExp(String.raw`(?:^|\s)(?:taille|مقاس|size|t)?\s*${s}(?=\s|$)`).test(text) && (s.length > 1 || /taille|مقاس|size/.test(text)));
  const numSize = text.match(/(?:taille|مقاس|size)\s*(3[4-9]|4[0-9]|5[0-4])\b/);
  if (numSize) sizes.push(numSize[1]!);
  const occasion = OCCASIONS.find((o) => o.words.some(has)) ?? null;
  const categories = Object.entries(CATEGORY_WORDS).filter(([, ws]) => ws.some(has)).map(([slug]) => slug);
  const STOP = new Set(["je", "veux", "cherche", "une", "un", "des", "pour", "avec", "de", "la", "le", "les", "et", "en", "moins", "plus", "da", "dzd", "اريد", "حابة", "نحب", "ابغي", "بغيت", "عندكم", "لـ", "ل", "في", "من", "مع", "على", "دج", "اقل", "سعر", "بسعر", "taille", "مقاس"]);
  const words = text
    .split(/\s+/)
    .filter((w) => w.length > 2 && !STOP.has(w) && !/^\d/.test(w))
    // words already understood (colour, occasion, type, with or without a prefix) are not free words
    .filter((w) => {
      const known = [...COLORS.flatMap((c) => c.words), ...(occasion?.words ?? []), ...Object.values(CATEGORY_WORDS).flat()].map(normalizeSearch);
      return !PREFIXES.some((pre) => known.includes(w.startsWith(pre) ? w.slice(pre.length) : ""));
    });
  return { maxPrice, minPrice, colors, sizes, occasion, categories, words };
}

function hexDistance(a: string, b: string): number {
  const p = (h: string) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
  const [x, y] = [p(a), p(b)];
  return Math.sqrt(x.reduce((s, v, i) => s + (v - y[i]!) ** 2, 0));
}

interface Extra {
  description: string;
  category: string | null;
  /** option values in stock: label (normalised) + kind + hex */
  values: { label: string; kind: string; hex: string | null }[];
}

export async function recommend(env: Env, q: string, locale: "fr" | "ar"): Promise<AssistantReplyDTO> {
  const ar = locale === "ar";
  const wish = understand(q);
  const [cards, extraRes, valuesRes] = await Promise.all([
    productCards(env),
    env.DB.prepare("SELECT p.id, p.description_fr, p.description_ar, c.slug FROM products p LEFT JOIN categories c ON c.id = p.category_id WHERE p.status IN ('published','scheduled')").all<{
      id: number; description_fr: string | null; description_ar: string | null; slug: string | null;
    }>(),
    env.DB.prepare(
      `SELECT var.product_id, ov.label_fr, ov.label_ar, ov.hex, o.kind, SUM(MAX(var.stock_on_hand - var.stock_reserved, 0)) AS available
         FROM variants var, json_each(var.option_value_ids) je
         JOIN option_values ov ON ov.id = je.value JOIN product_options o ON o.id = ov.option_id
        WHERE var.is_active = 1 GROUP BY var.product_id, ov.id`,
    ).all<{ product_id: number; label_fr: string; label_ar: string; hex: string | null; kind: string; available: number }>(),
  ]);
  const extra = new Map<number, Extra>();
  for (const r of extraRes.results) {
    extra.set(r.id, { description: normalizeSearch(`${r.description_fr ?? ""} ${r.description_ar ?? ""}`), category: r.slug, values: [] });
  }
  for (const v of valuesRes.results) {
    if (v.available <= 0) continue;
    extra.get(v.product_id)?.values.push(
      { label: normalizeSearch(v.label_fr), kind: v.kind, hex: v.hex },
      { label: normalizeSearch(v.label_ar), kind: v.kind, hex: v.hex },
    );
  }

  type Check = { ok: boolean; why?: string };
  const evaluate = (p: ProductCardDTO) => {
    const x = extra.get(p.id);
    const hay = normalizeSearch(`${p.nameFr} ${p.nameAr} ${p.tags.join(" ")} ${x?.description ?? ""}`);
    const color: Check = !wish.colors.length
      ? { ok: true }
      : (() => {
          const hit = wish.colors.find(
            (c) =>
              (x?.values ?? []).some((v) => v.kind === "couleur" && (c.words.some((w) => v.label.includes(normalizeSearch(w))) || (v.hex != null && hexDistance(v.hex, c.hex) < 70))) ||
              c.words.some((w) => w.length > 3 && hay.includes(normalizeSearch(w))),
          );
          return hit ? { ok: true, why: ar ? `اللون ${hit.ar} متوفر` : `Existe en ${hit.fr}` } : { ok: false };
        })();
    const size: Check = !wish.sizes.length
      ? { ok: true }
      : (() => {
          const hit = wish.sizes.find((s) => (x?.values ?? []).some((v) => v.kind === "taille" && v.label === s));
          return hit ? { ok: true, why: ar ? `المقاس ${hit.toUpperCase()} متوفر` : `Taille ${hit.toUpperCase()} disponible` } : { ok: false };
        })();
    const wantCats = wish.categories.length ? wish.categories : (wish.occasion?.categories ?? []);
    const category: Check = !wantCats.length
      ? { ok: true }
      : x?.category && wantCats.includes(x.category)
        ? { ok: true, why: wish.occasion && !wish.categories.length ? (ar ? `مناسب لـ${wish.occasion.ar}` : `Idéal pour ${wish.occasion.fr}`) : undefined }
        : { ok: false };
    const price: Check =
      (wish.maxPrice == null || p.price <= wish.maxPrice) && (wish.minPrice == null || p.price >= wish.minPrice)
        ? { ok: true, why: wish.maxPrice != null ? (ar ? `${formatDA(p.price, "ar")} ضمن ميزانيتك` : `${formatDA(p.price, "fr")}, dans votre budget`) : undefined }
        : { ok: false };
    // free words and occasion hints only raise the score
    const wordHits = wish.words.filter((w) => hay.includes(w)).length;
    const hintHits = (wish.occasion?.hints ?? []).filter((h) => hay.includes(normalizeSearch(h))).length;
    const score = wordHits * 3 + hintHits * 2 + (p.rating?.avg ?? 0) / 2 + (p.badge ? 1 : 0) + (p.flash ? 1 : 0);
    return { p, checks: { price, color, category, size }, score, words: wordHits + hintHits };
  };

  const pool = cards.filter((p) => p.inStock).map(evaluate);
  // everything asked for; otherwise loosen, the least important first
  const tiers: (keyof ReturnType<typeof evaluate>["checks"])[][] = [
    ["price", "color", "category", "size"],
    ["price", "color", "category"],
    ["price", "category"],
    ["category"],
    ["price"],
    [],
  ];
  let picked: typeof pool = [];
  let tierIndex = 0;
  for (; tierIndex < tiers.length; tierIndex++) {
    const need = tiers[tierIndex]!;
    // first try: the free words too ("satin", "dentelle"…)
    picked = pool.filter((e) => need.every((k) => e.checks[k].ok) && (tierIndex > 0 || !wish.words.length || e.words > 0));
    if (picked.length) break;
  }
  if (!picked.length) picked = pool; // never an empty answer: the shop's best pieces
  picked.sort((a, b) => b.score - a.score || a.p.price - b.p.price);

  const understood: string[] = [];
  if (wish.categories.length) understood.push(ar ? `النوع: ${wish.categories.map((c) => ({ robes: "فساتين", pyjamas: "بيجامات", djebba: "جبة" })[c] ?? c).join("، ")}` : `Type : ${wish.categories.join(", ")}`);
  if (wish.occasion) understood.push(ar ? `المناسبة: ${wish.occasion.ar}` : `Occasion : ${wish.occasion.fr}`);
  if (wish.colors.length) understood.push(ar ? `اللون: ${wish.colors.map((c) => c.ar).join("، ")}` : `Couleur : ${wish.colors.map((c) => c.fr).join(", ")}`);
  if (wish.sizes.length) understood.push(ar ? `المقاس: ${wish.sizes.map((s) => s.toUpperCase()).join("، ")}` : `Taille : ${wish.sizes.map((s) => s.toUpperCase()).join(", ")}`);
  if (wish.maxPrice != null) understood.push(ar ? `الميزانية: أقل من ${formatDA(wish.maxPrice, "ar")}` : `Budget : jusqu'à ${formatDA(wish.maxPrice, "fr")}`);
  if (wish.minPrice != null) understood.push(ar ? `من ${formatDA(wish.minPrice, "ar")}` : `À partir de ${formatDA(wish.minPrice, "fr")}`);

  return {
    understood,
    relaxed: tierIndex > 0 && (understood.length > 0 || wish.words.length > 0),
    products: picked.slice(0, 6).map((e) => ({
      ...e.p,
      why: [
        ...Object.values(e.checks).map((c) => (c.ok ? c.why : undefined)).filter((w): w is string => !!w),
        ...(e.p.flash ? [ar ? `⚡ تخفيض -${e.p.flash.percent}% الآن` : `⚡ -${e.p.flash.percent} % en ce moment`] : []),
        ...(e.p.rating ? [ar ? `★ ${e.p.rating.avg} (${e.p.rating.count} تقييم)` : `★ ${e.p.rating.avg} (${e.p.rating.count} avis)`] : []),
      ].slice(0, 3),
    })),
  };
}
