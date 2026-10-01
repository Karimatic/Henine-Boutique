#!/usr/bin/env node
/**
 * Builds seed/geo.sql: 69 wilayas (law 26-06, decree 26-206) + ~1541 communes,
 * with default ZR Express shipping prices from Boumerdès (35).
 *
 * Commune source: github.com/othmanus/algeria-cities (58-wilaya layout, with dairas).
 * Wilayas 59–69 are whole dairas carved out of a parent wilaya; the mapping below was
 * cross-checked against the published commune counts/lists of each new wilaya.
 *
 * Usage: node packages/db/scripts/build-geo-seed.mjs
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const cacheFile = join(here, "../data/algeria_cities.json");
const outFile = join(here, "../seed/geo.sql");
const SOURCE = "https://raw.githubusercontent.com/othmanus/algeria-cities/master/json/algeria_cities.json";

// code, FR, AR, parent (for 59–69)
const WILAYAS = [
  [1, "Adrar", "أدرار"], [2, "Chlef", "الشلف"], [3, "Laghouat", "الأغواط"], [4, "Oum El Bouaghi", "أم البواقي"],
  [5, "Batna", "باتنة"], [6, "Béjaïa", "بجاية"], [7, "Biskra", "بسكرة"], [8, "Béchar", "بشار"],
  [9, "Blida", "البليدة"], [10, "Bouira", "البويرة"], [11, "Tamanrasset", "تمنراست"], [12, "Tébessa", "تبسة"],
  [13, "Tlemcen", "تلمسان"], [14, "Tiaret", "تيارت"], [15, "Tizi Ouzou", "تيزي وزو"], [16, "Alger", "الجزائر"],
  [17, "Djelfa", "الجلفة"], [18, "Jijel", "جيجل"], [19, "Sétif", "سطيف"], [20, "Saïda", "سعيدة"],
  [21, "Skikda", "سكيكدة"], [22, "Sidi Bel Abbès", "سيدي بلعباس"], [23, "Annaba", "عنابة"], [24, "Guelma", "قالمة"],
  [25, "Constantine", "قسنطينة"], [26, "Médéa", "المدية"], [27, "Mostaganem", "مستغانم"], [28, "M'Sila", "المسيلة"],
  [29, "Mascara", "معسكر"], [30, "Ouargla", "ورقلة"], [31, "Oran", "وهران"], [32, "El Bayadh", "البيض"],
  [33, "Illizi", "إليزي"], [34, "Bordj Bou Arréridj", "برج بوعريريج"], [35, "Boumerdès", "بومرداس"], [36, "El Tarf", "الطارف"],
  [37, "Tindouf", "تندوف"], [38, "Tissemsilt", "تيسمسيلت"], [39, "El Oued", "الوادي"], [40, "Khenchela", "خنشلة"],
  [41, "Souk Ahras", "سوق أهراس"], [42, "Tipaza", "تيبازة"], [43, "Mila", "ميلة"], [44, "Aïn Defla", "عين الدفلى"],
  [45, "Naâma", "النعامة"], [46, "Aïn Témouchent", "عين تموشنت"], [47, "Ghardaïa", "غرداية"], [48, "Relizane", "غليزان"],
  [49, "Timimoun", "تيميمون"], [50, "Bordj Badji Mokhtar", "برج باجي مختار"], [51, "Ouled Djellal", "أولاد جلال"],
  [52, "Béni Abbès", "بني عباس"], [53, "In Salah", "عين صالح"], [54, "In Guezzam", "عين قزام"], [55, "Touggourt", "تقرت"],
  [56, "Djanet", "جانت"], [57, "El M'Ghair", "المغير"], [58, "El Meniaa", "المنيعة"],
  [59, "Aflou", "أفلو", 3], [60, "Barika", "بريكة", 5], [61, "El Kantara", "القنطرة", 7],
  [62, "Bir El Ater", "بئر العاتر", 12], [63, "El Aricha", "العريشة", 13], [64, "Ksar Chellala", "قصر الشلالة", 14],
  [65, "Aïn Oussera", "عين وسارة", 17], [66, "Messaad", "مسعد", 17], [67, "Ksar El Boukhari", "قصر البخاري", 26],
  [68, "Bou Saâda", "بوسعادة", 28], [69, "El Abiodh Sidi Cheikh", "الأبيض سيدي الشيخ", 32],
];

// New wilaya ← [parent, dairas (dataset spelling)]; expected commune count in comment.
const NEW_WILAYA_DAIRAS = {
  59: [3, ["Aflou", "Gueltat Sidi Saad", "Brida", "El Ghicha", "Oued Morra"]], // 12
  60: [5, ["Barika", "Djezzar", "Seggana"]], // 8
  61: [7, ["El Kantara", "Djemorah", "El Outaya"]], // 5
  62: [12, ["Bir El Ater", "Negrine"]], // 4
  63: [13, null], // 4 — split across dairas, listed by commune below
  64: [14, ["Ksar Chellala", "Hamadia"]], // 6
  65: [17, ["Ain Oussera", "Birine", "Had Sahary", "Sidi Laadjel"]], // 10
  66: [17, ["Messaad", "Faidh El Botma"]], // 8
  67: [26, ["Ksar El Boukhari", "Chahbounia", "Ouled Antar", "Aziz", "Ain Boucif", "Chellalat El Adhaoura"]], // 21
  68: [28, ["Bousaada", "Ouled Sidi Brahim", "Sidi Ameur", "Ben Srour", "Ain El Melh", "Medjedel", "Djebel Messaad", "Khoubana"]], // 23
  69: [32, ["Labiodh Sidi Cheikh", "Brezina"]], // 7
};
const NEW_WILAYA_COMMUNES = { 63: ["El Aricha", "El Gor", "Sidi Djillali", "Bouihi"] };
const EXPECTED = { 59: 12, 60: 8, 61: 5, 62: 4, 63: 4, 64: 6, 65: 10, 66: 8, 67: 21, 68: 23, 69: 7 };

/**
 * DEFAULT shipping prices (DA) from Boumerdès, by zone: ESTIMATES until Ilyas's
 * ZR Express contract grid is imported (Admin → Contenu → Livraison, or API sync).
 */
const ZONES = {
  local: { home: 400, desk: 300, delay: "1", codes: [35] },
  centre: { home: 500, desk: 350, delay: "1-2", codes: [9, 10, 15, 16, 42] },
  nord: {
    home: 650, desk: 450, delay: "2-3",
    codes: [2, 4, 5, 6, 12, 13, 14, 18, 19, 20, 21, 22, 23, 24, 25, 26, 27, 28, 29, 31, 34, 36, 38, 40, 41, 43, 44, 46, 48, 60, 62, 63, 64, 67],
  },
  plateaux: { home: 800, desk: 550, delay: "2-4", codes: [3, 7, 17, 32, 39, 45, 47, 51, 55, 57, 59, 61, 65, 66, 68, 69] },
  sud: { home: 1000, desk: 700, delay: "3-5", codes: [1, 8, 30, 49, 52, 58] },
  grandSud: { home: 1400, desk: 900, delay: "4-7", codes: [11, 33, 37, 50, 53, 54, 56] },
};

async function loadCommunes() {
  if (!existsSync(cacheFile)) {
    mkdirSync(dirname(cacheFile), { recursive: true });
    const res = await fetch(SOURCE);
    if (!res.ok) throw new Error(`download failed: ${res.status}`);
    writeFileSync(cacheFile, await res.text());
  }
  return JSON.parse(readFileSync(cacheFile, "utf8"));
}

const q = (v) => (v == null ? "NULL" : typeof v === "number" ? String(v) : `'${String(v).replace(/'/g, "''")}'`);

const communes = await loadCommunes();

// Assign every commune to its current (69-wilaya) code.
const assigned = communes.map((c) => ({ ...c, code: Number(c.wilaya_code) }));
for (const [newCode, [parent, dairas]] of Object.entries(NEW_WILAYA_DAIRAS)) {
  const names = NEW_WILAYA_COMMUNES[newCode];
  const moved = assigned.filter(
    (c) =>
      c.code === parent &&
      (dairas ? dairas.includes(c.daira_name_ascii) : names.includes(c.commune_name_ascii)),
  );
  if (moved.length !== EXPECTED[newCode]) {
    throw new Error(`wilaya ${newCode}: expected ${EXPECTED[newCode]} communes, matched ${moved.length}`);
  }
  for (const c of moved) c.code = Number(newCode);
}

const zoneOf = new Map();
for (const z of Object.values(ZONES)) for (const code of z.codes) zoneOf.set(code, z);
for (const [code] of WILAYAS) if (!zoneOf.has(code)) throw new Error(`wilaya ${code} has no shipping zone`);

const lines = [
  "-- Generated by packages/db/scripts/build-geo-seed.mjs. Do not edit by hand.",
  "-- 69 wilayas (loi 26-06, décret présidentiel 26-206) + communes.",
  "-- Shipping prices are ESTIMATES from Boumerdès until the ZR Express grid is imported.",
  "-- Idempotent: names/parents are refreshed, prices edited in the admin are kept.",
];
for (const [code, fr, ar, parent] of WILAYAS) {
  const z = zoneOf.get(code);
  lines.push(
    `INSERT INTO wilayas (code, name_fr, name_ar, parent_code, is_active, home_price, desk_price, delay_days, sort) VALUES (${[
      code, q(fr), q(ar), parent ?? "NULL", 1, z.home, z.desk, q(z.delay), code,
    ].join(", ")}) ON CONFLICT(code) DO UPDATE SET name_fr = excluded.name_fr, name_ar = excluded.name_ar, parent_code = excluded.parent_code;`,
  );
}
const rows = assigned
  .sort((a, b) => a.code - b.code || a.commune_name_ascii.localeCompare(b.commune_name_ascii))
  .map((c) =>
    `(${[c.id, c.code, q(c.commune_name_ascii), q(c.commune_name), q(c.daira_name_ascii), q(c.daira_name)].join(", ")})`,
  );
// batch inserts to keep statements reasonably small for D1
for (let i = 0; i < rows.length; i += 100) {
  lines.push(
    `INSERT INTO communes (id, wilaya_code, name_fr, name_ar, daira_fr, daira_ar) VALUES\n${rows.slice(i, i + 100).join(",\n")}\n` +
      "ON CONFLICT(id) DO UPDATE SET wilaya_code = excluded.wilaya_code, name_fr = excluded.name_fr, " +
      "name_ar = excluded.name_ar, daira_fr = excluded.daira_fr, daira_ar = excluded.daira_ar;",
  );
}
lines.push(
  `INSERT OR IGNORE INTO settings (key, value) VALUES ('shipping.prices_verified', 'false');`,
  `INSERT OR IGNORE INTO carriers (slug, name, adapter, is_default, is_active) VALUES ('zr-express', 'ZR Express', 'zr', 1, 1);`,
);

mkdirSync(dirname(outFile), { recursive: true });
writeFileSync(outFile, lines.join("\n") + "\n");

const perWilaya = new Map();
for (const c of assigned) perWilaya.set(c.code, (perWilaya.get(c.code) ?? 0) + 1);
console.log(`wrote ${outFile}`);
console.log(`wilayas: ${WILAYAS.length}, communes: ${assigned.length}`);
console.log("new wilayas:", [...perWilaya].filter(([k]) => k >= 59).map(([k, v]) => `${k}:${v}`).join(" "));
