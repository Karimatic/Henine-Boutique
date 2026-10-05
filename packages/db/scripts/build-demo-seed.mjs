#!/usr/bin/env node
/**
 * Builds seed/demo.sql: example products (with sizes, colours, stock), content pages,
 * link-in-bio links and a welcome coupon, so the store and admin can be tried end to end.
 * Safe to re-run (INSERT OR REPLACE on fixed ids). Not meant for production data.
 *
 * Usage: node packages/db/scripts/build-demo-seed.mjs
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const outFile = join(dirname(fileURLToPath(import.meta.url)), "../seed/demo.sql");
const q = (v) =>
  v == null ? "NULL" : typeof v === "number" ? String(v) : typeof v === "boolean" ? (v ? "1" : "0") : `'${String(v).replace(/'/g, "''")}'`;
const now = Date.now();

const SIZES = {
  S: ["S", "S"], M: ["M", "M"], L: ["L", "L"], XL: ["XL", "XL"], XXL: ["XXL", "XXL"],
  "85B": ["85B", "85B"], "90B": ["90B", "90B"], "95C": ["95C", "95C"], "100C": ["100C", "100C"],
  TU: ["Taille unique", "مقاس واحد"],
};
const COLORS = {
  rose: ["Rose poudré", "وردي فاتح", "#e8b4bc"],
  noir: ["Noir", "أسود", "#1f1a1c"],
  blanc: ["Blanc", "أبيض", "#f7f3ee"],
  ivoire: ["Ivoire", "عاجي", "#efe6d6"],
  champagne: ["Champagne", "شمبانيا", "#e9d3b0"],
  bordeaux: ["Bordeaux", "خمري", "#6d1f33"],
  lavande: ["Lavande", "لافندر", "#b9a7d6"],
  ciel: ["Bleu ciel", "أزرق سماوي", "#a9c8e8"],
  nude: ["Nude", "بيج", "#d9b8a3"],
  emeraude: ["Émeraude", "زمردي", "#1f6f5c"],
  gris: ["Gris chiné", "رمادي", "#9a9a9e"],
  marine: ["Bleu marine", "كحلي", "#1f2a44"],
};

/*
 * Two sample pieces per category (see base.sql for the tree). `compare` = on sale
 * (Promotions); `age` = days since it arrived (Nouveautés shows the latest first).
 */
const PRODUCTS = [
  // ── Pyjamas d'été
  { slug: "pyjama-short-coton-fleuri", cat: "pyjamas-ete", fr: "Pyjama short coton fleuri", ar: "بيجامة شورت قطن مزهرة", price: 2900, compare: null, cost: 1400, age: 2, tags: ["nouveaute"],
    descFr: "Débardeur + short en **coton léger**, imprimé fleuri.\n\n- Frais et doux pour les nuits d'été\n- Short à taille élastique\n- Lavage à 30°",
    descAr: "قميص بدون أكمام + شورت من **القطن الخفيف** بطبعة زهور.\n\n- منعش وناعم لليالي الصيف\n- شورت بخصر مطاطي\n- غسيل على 30 درجة",
    sizes: ["S", "M", "L", "XL"], colors: ["rose", "ciel"], stock: (s) => (s === "XL" ? 2 : 6) },
  { slug: "ensemble-satin-ete-lina", cat: "pyjamas-ete", fr: "Ensemble satin d'été Lina", ar: "طقم ساتان صيفي لينا", price: 3800, compare: 4500, cost: 1900, age: 25, tags: [],
    descFr: "Chemise manches courtes + short en **satin fluide**, passepoil contrasté.",
    descAr: "قميص بأكمام قصيرة + شورت من **الساتان الناعم** بحواف متباينة.",
    sizes: ["S", "M", "L", "XL"], colors: ["champagne", "lavande"], stock: () => 4 },
  // ── Pyjamas d'hiver
  { slug: "pyjama-polaire-douceur", cat: "pyjamas-hiver", fr: "Pyjama polaire Douceur", ar: "بيجامة صوف ناعمة", price: 4200, compare: null, cost: 2100, age: 6, tags: ["nouveaute"],
    descFr: "Pyjama en **polaire très douce**, haut à col rond et pantalon chaud.\n\n- Idéal pour les nuits froides\n- Ne bouloche pas",
    descAr: "بيجامة من **الصوف الناعم جدا**، قميص بياقة دائرية وسروال دافئ.\n\n- مثالية لليالي الباردة\n- لا تتكور",
    sizes: ["M", "L", "XL", "XXL"], colors: ["bordeaux", "gris"], stock: () => 5 },
  { slug: "pyjama-velours-cosy", cat: "pyjamas-hiver", fr: "Pyjama velours Cosy", ar: "بيجامة قطيفة دافئة", price: 4500, compare: 5500, cost: 2300, age: 40, tags: [],
    descFr: "Ensemble en **velours côtelé** doux, chaud et élégant à la maison.",
    descAr: "طقم من **القطيفة الناعمة**، دافئ وأنيق في البيت.",
    sizes: ["M", "L", "XL"], colors: ["noir", "rose"], stock: (s) => (s === "XL" ? 1 : 3) },
  // ── Robes de chambre & nuisettes
  { slug: "robe-de-chambre-satin-yasmine", cat: "robes-de-chambre-nuisettes", fr: "Robe de chambre satin Yasmine", ar: "روب دو شامبر ساتان ياسمين", price: 4900, compare: null, cost: 2400, age: 3, tags: ["nouveaute"],
    descFr: "Robe de chambre longue en **satin**, ceinture à nouer et manches évasées.",
    descAr: "روب دو شامبر طويل من **الساتان**، بحزام للربط وأكمام واسعة.",
    sizes: ["S", "M", "L", "XL"], colors: ["champagne", "bordeaux"], stock: () => 4 },
  { slug: "nuisette-dentelle-amira", cat: "robes-de-chambre-nuisettes", fr: "Nuisette dentelle Amira", ar: "قميص نوم دانتيل أميرة", price: 2500, compare: 3200, cost: 1000, age: 30, tags: [],
    descFr: "Nuisette **satinée** à fines bretelles réglables, bordure en dentelle.",
    descAr: "قميص نوم **ساتان** بحمالات رفيعة قابلة للتعديل وحواف من الدانتيل.",
    sizes: ["S", "M", "L"], colors: ["rose", "noir"], stock: () => 3 },
  // ── Lingerie › Ensembles
  { slug: "ensemble-dentelle-rose", cat: "ensembles-lingerie", fr: "Ensemble dentelle Rose", ar: "طقم دانتيل روز", price: 2900, compare: null, cost: 1200, age: 1, tags: ["nouveaute"],
    descFr: "Soutien-gorge + culotte en **dentelle délicate**. Livré dans un emballage discret.",
    descAr: "حمالة صدر + سروال داخلي من **الدانتيل الرقيق**. يصلك في تغليف سري.",
    sizes: ["S", "M", "L"], colors: ["rose", "noir"], stock: () => 5 },
  { slug: "ensemble-satin-nour", cat: "ensembles-lingerie", fr: "Ensemble satin Nour", ar: "طقم ساتان نور", price: 3300, compare: null, cost: 1500, age: 20, tags: [],
    descFr: "Ensemble **satin et tulle**, armatures souples, très confortable.",
    descAr: "طقم من **الساتان والتول**، بأسلاك مرنة ومريح جدا.",
    sizes: ["S", "M", "L"], colors: ["champagne", "bordeaux"], stock: () => 4 },
  // ── Lingerie › Soutiens-gorge & culottes
  { slug: "soutien-gorge-confort", cat: "soutiens-gorge-culottes", fr: "Soutien-gorge confort sans armatures", ar: "حمالة صدر مريحة بدون سلك", price: 1600, compare: null, cost: 650, age: 12, tags: [],
    descFr: "Soutien-gorge **sans armatures**, bonnets moulés, invisible sous les vêtements.",
    descAr: "حمالة صدر **بدون سلك**، بأكواب مقولبة، لا تظهر تحت الملابس.",
    sizes: ["85B", "90B", "95C", "100C"], colors: ["nude", "noir"], stock: () => 6 },
  { slug: "lot-3-culottes-coton", cat: "soutiens-gorge-culottes", fr: "Lot de 3 culottes coton", ar: "3 سراويل داخلية قطنية", price: 1200, compare: 1500, cost: 450, age: 35, tags: [],
    descFr: "Trois culottes en **coton doux**, coutures plates, pour tous les jours.",
    descAr: "ثلاثة سراويل داخلية من **القطن الناعم**، بخياطة مسطحة، لكل يوم.",
    sizes: ["S", "M", "L", "XL"], colors: ["blanc", "nude"], stock: () => 8 },
  // ── Lingerie › Gaines
  { slug: "gaine-taille-haute", cat: "gaines", fr: "Gaine gainante taille haute", ar: "مشد البطن بخصر عالٍ", price: 2700, compare: null, cost: 1100, age: 8, tags: [],
    descFr: "Gaine **taille haute** qui affine la silhouette, sans couture visible.",
    descAr: "مشد **بخصر عالٍ** ينحف القوام، بدون خياطة ظاهرة.",
    sizes: ["S", "M", "L", "XL"], colors: ["nude", "noir"], stock: () => 5 },
  { slug: "body-sculptant-invisible", cat: "gaines", fr: "Body sculptant invisible", ar: "بودي مشد غير مرئي", price: 3200, compare: null, cost: 1400, age: 50, tags: [],
    descFr: "Body **sculptant** à bretelles réglables, invisible sous une robe.",
    descAr: "بودي **مشد** بحمالات قابلة للتعديل، لا يظهر تحت الفستان.",
    sizes: ["S", "M", "L", "XL"], colors: ["nude"], stock: () => 4 },
  // ── Lingerie › Trousseau de mariée
  { slug: "coffret-trousseau-lilia", cat: "trousseau-mariee", fr: "Coffret trousseau Lilia (5 pièces)", ar: "طقم جهاز العروس ليليا (5 قطع)", price: 12900, compare: null, cost: 6500, age: 4, tags: ["nouveaute"],
    descFr: "Le coffret de la mariée : **robe de chambre, nuisette, 2 ensembles et pyjama**, dans une boîte cadeau.\n\n- Couleurs assorties\n- Emballage cadeau offert",
    descAr: "طقم العروس: **روب دو شامبر، قميص نوم، طقمان داخليان وبيجامة** في علبة هدية.\n\n- ألوان متناسقة\n- تغليف هدية مجاني",
    sizes: ["S", "M", "L"], colors: ["ivoire", "rose"], stock: () => 2 },
  { slug: "ensemble-mariee-dentelle-blanche", cat: "trousseau-mariee", fr: "Ensemble mariée dentelle blanche", ar: "طقم العروس دانتيل أبيض", price: 6900, compare: 7900, cost: 3200, age: 45, tags: [],
    descFr: "Nuisette longue + robe de chambre en **dentelle blanche**, pour la nuit de noces.",
    descAr: "قميص نوم طويل + روب دو شامبر من **الدانتيل الأبيض** لليلة العرس.",
    sizes: ["S", "M", "L"], colors: ["blanc", "ivoire"], stock: () => 3 },
  // ── Lingerie › Lingerie fine
  { slug: "nuisette-longue-soie-layla", cat: "lingerie-fine", fr: "Nuisette longue soie Layla", ar: "قميص نوم طويل حرير ليلى", price: 5400, compare: null, cost: 2600, age: 5, tags: ["nouveaute"],
    descFr: "Nuisette longue **effet soie**, dos décolleté en dentelle.",
    descAr: "قميص نوم طويل **بملمس الحرير**، بظهر مفتوح من الدانتيل.",
    sizes: ["S", "M", "L"], colors: ["bordeaux", "noir"], stock: () => 3 },
  { slug: "robe-nuit-satin-fendue", cat: "lingerie-fine", fr: "Robe de nuit satin fendue", ar: "فستان نوم ساتان بفتحة", price: 4800, compare: null, cost: 2200, age: 28, tags: [],
    descFr: "Robe de nuit en **satin** fendue sur le côté, bretelles croisées.",
    descAr: "فستان نوم من **الساتان** بفتحة جانبية وحمالات متقاطعة.",
    sizes: ["S", "M", "L"], colors: ["emeraude", "champagne"], stock: () => 3 },
  // ── Sportswear & survêtements
  { slug: "survetement-molleton-sara", cat: "sportswear-survetements", fr: "Survêtement molleton Sara", ar: "بدلة رياضية سارة", price: 5900, compare: null, cost: 2900, age: 9, tags: [],
    descFr: "Sweat à capuche + jogging en **molleton doux**, coupe confortable.",
    descAr: "سترة بقبعة + سروال رياضي من **القطن الصوفي الناعم**، بقصة مريحة.",
    sizes: ["S", "M", "L", "XL"], colors: ["gris", "marine"], stock: () => 4 },
  { slug: "ensemble-legging-brassiere", cat: "sportswear-survetements", fr: "Ensemble legging & brassière", ar: "طقم ليغينغ وصدرية رياضية", price: 3900, compare: 4600, cost: 1800, age: 38, tags: [],
    descFr: "Legging **gainant** taille haute + brassière de sport, tissu respirant.",
    descAr: "ليغينغ **مشد** بخصر عالٍ + صدرية رياضية، قماش يسمح بالتهوية.",
    sizes: ["S", "M", "L"], colors: ["noir", "lavande"], stock: () => 5 },
  // ── Gandouras, djebbas & robes
  { slug: "djebba-brodee-lilia", cat: "gandouras-djebbas-robes", fr: "Djebba brodée Lilia", ar: "جبة مطرزة ليليا", price: 5200, compare: null, cost: 2800, age: 2, tags: ["nouveaute"],
    descFr: "Djebba longue et fluide, **broderie au col et aux manches**, coupe ample et confortable.\n\n- Tissu léger, agréable toute la journée\n- Idéale pour la maison, les visites et les fêtes",
    descAr: "جبة طويلة وانسيابية، **تطريز على الياقة والأكمام**، قصة واسعة ومريحة.\n\n- قماش خفيف ومريح طوال اليوم\n- مثالية للبيت والزيارات والمناسبات",
    sizes: ["M", "L", "XL", "XXL"], colors: ["bordeaux", "champagne"], stock: (s) => (s === "XXL" ? 2 : 4) },
  { slug: "gandoura-ete-kenza", cat: "gandouras-djebbas-robes", fr: "Gandoura d'été Kenza", ar: "قندورة صيفية كنزة", price: 3500, compare: null, cost: 1700, age: 15, tags: [],
    descFr: "Gandoura **en coton**, légère et fraîche, motifs discrets. Taille unique ample.",
    descAr: "قندورة **من القطن**، خفيفة ومنعشة، بنقوش هادئة. مقاس واحد واسع.",
    sizes: ["TU"], colors: ["ciel", "rose"], stock: () => 6 },
];

const lines = [
  "-- Generated by packages/db/scripts/build-demo-seed.mjs: DEMO DATA, safe to re-run.",
  "PRAGMA defer_foreign_keys = on;",
];

let optionId = 0, valueId = 0, variantId = 0;
PRODUCTS.forEach((p, i) => {
  const id = i + 1;
  lines.push(
    `INSERT OR REPLACE INTO products (id, slug, name_fr, name_ar, description_fr, description_ar, status, category_id, tags, price, compare_at_price, cost_price, sort, created_at, published_at, updated_at) VALUES (${[
      id, q(p.slug), q(p.fr), q(p.ar), q(p.descFr), q(p.descAr), q("published"),
      `(SELECT id FROM categories WHERE slug = ${q(p.cat)})`, q(JSON.stringify(p.tags)), p.price, q(p.compare), q(p.cost), i,
      now - p.age * 86400_000, now - p.age * 86400_000, now,
    ].join(", ")});`,
  );
  const sizeOpt = ++optionId;
  lines.push(`INSERT OR REPLACE INTO product_options (id, product_id, kind, name_fr, name_ar, sort) VALUES (${sizeOpt}, ${id}, 'taille', 'Taille', 'المقاس', 0);`);
  const sizeVals = p.sizes.map((s, k) => {
    const vid = ++valueId;
    lines.push(`INSERT OR REPLACE INTO option_values (id, option_id, label_fr, label_ar, hex, sort) VALUES (${vid}, ${sizeOpt}, ${q(SIZES[s][0])}, ${q(SIZES[s][1])}, NULL, ${k});`);
    return [s, vid];
  });
  const colorOpt = ++optionId;
  lines.push(`INSERT OR REPLACE INTO product_options (id, product_id, kind, name_fr, name_ar, sort) VALUES (${colorOpt}, ${id}, 'couleur', 'Couleur', 'اللون', 1);`);
  const colorVals = p.colors.map((c, k) => {
    const vid = ++valueId;
    const [fr, ar, hex] = COLORS[c];
    lines.push(`INSERT OR REPLACE INTO option_values (id, option_id, label_fr, label_ar, hex, sort) VALUES (${vid}, ${colorOpt}, ${q(fr)}, ${q(ar)}, ${q(hex)}, ${k});`);
    return [c, vid];
  });
  const prefix = p.slug.split("-").map((w) => w.slice(0, 3)).join("").toUpperCase().slice(0, 9);
  for (const [c, cv] of colorVals) {
    for (const [s, sv] of sizeVals) {
      const vid = ++variantId;
      lines.push(
        `INSERT OR REPLACE INTO variants (id, product_id, sku, option_value_ids, stock_on_hand, stock_reserved, low_stock_threshold, is_active) VALUES (${vid}, ${id}, ${q(`${prefix}-${c.toUpperCase()}-${s}`)}, ${q(JSON.stringify([sv, cv]))}, ${p.stock(s, c)}, 0, 2, 1);`,
      );
    }
  }
});

// Content pages (full texts, also used for production: data/pages.json)
const PAGES = JSON.parse(readFileSync(join(dirname(fileURLToPath(import.meta.url)), "../data/pages.json"), "utf8")).map((p) => [
  p.slug, p.titleFr, p.titleAr, p.bodyFr, p.bodyAr,
]);
PAGES.forEach(([slug, tFr, tAr, bFr, bAr], i) =>
  lines.push(`INSERT OR REPLACE INTO pages (id, slug, title_fr, title_ar, body_fr, body_ar, is_active) VALUES (${i + 1}, ${q(slug)}, ${q(tFr)}, ${q(tAr)}, ${q(bFr)}, ${q(bAr)}, 1);`),
);

// Link in bio + one short link
const LINKS = [
  ["bio", null, "🛍️ Voir la boutique", "🛍️ تصفحي المتجر", "/", "shop"],
  ["bio", null, "📦 Suivre ma commande", "📦 تتبع طلبي", "/suivi", "package"],
  ["bio", null, "📸 Instagram", "📸 إنستغرام", "https://www.instagram.com/henine.boutique/", "instagram"],
  ["bio", null, "📍 Nous contacter", "📍 تواصلي معنا", "/contact", "pin"],
  ["short", "insta", "Instagram bio", "Instagram bio", "/?utm_source=instagram&utm_medium=bio", null],
];
LINKS.forEach(([kind, slug, lFr, lAr, target, icon], i) =>
  lines.push(`INSERT OR REPLACE INTO links (id, kind, slug, label_fr, label_ar, target, icon, sort, is_active) VALUES (${i + 1}, ${q(kind)}, ${q(slug)}, ${q(lFr)}, ${q(lAr)}, ${q(target)}, ${q(icon)}, ${i}, 1);`),
);

lines.push(
  `INSERT OR IGNORE INTO coupons (code, type, value, min_subtotal, is_active) VALUES ('BIENVENUE10', 'percent', 10, 3000, 1);`,
  `INSERT OR REPLACE INTO settings (key, value) VALUES ('catalog_version', '${now}');`,
);

mkdirSync(dirname(outFile), { recursive: true });
writeFileSync(outFile, lines.join("\n") + "\n");
console.log(`wrote ${outFile}: ${PRODUCTS.length} products, ${variantId} variants`);
