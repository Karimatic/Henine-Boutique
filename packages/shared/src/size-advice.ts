/**
 * "Quelle taille choisir ?": a size suggestion from the customer's measurements, read
 * against the product's own size chart (Admin → size guides). Without a chart or
 * measurements, an estimate from height and weight. Rules only, explained in words.
 */

export interface SizeAdviceInput {
  /** product sizes in shop order ("S", "M"… or "38", "40"…) */
  sizes: string[];
  /** the product's size chart: first column = size, others = measurements in cm ("84-88") */
  guide?: { headers: string[]; rows: string[][] } | null;
  height?: number | null;
  weight?: number | null;
  bust?: number | null;
  waist?: number | null;
  hips?: number | null;
  fit?: "fitted" | "regular" | "loose";
}

export interface SizeAdvice {
  size: string;
  /** what the suggestion is based on, in both languages */
  reasons: { fr: string; ar: string }[];
  method: "measurements" | "height_weight";
  /** the other size worth trying (between two sizes) */
  alternative: string | null;
}

type Measure = "bust" | "waist" | "hips";
const MEASURE_HEADERS: Record<Measure, RegExp> = {
  bust: /poitrine|bust|chest|صدر/i,
  waist: /tour de taille|waist|خصر/i,
  hips: /hanche|hip|ورك|أرداف|ارداف/i,
};
const MEASURE_NAME: Record<Measure, { fr: string; ar: string }> = {
  bust: { fr: "tour de poitrine", ar: "محيط الصدر" },
  waist: { fr: "tour de taille", ar: "محيط الخصر" },
  hips: { fr: "tour de hanches", ar: "محيط الورك" },
};

const LADDER = ["XS", "S", "M", "L", "XL", "XXL", "3XL"];
const EU: Record<string, string> = { XS: "34", S: "36", M: "38", L: "40", XL: "42", XXL: "44", "3XL": "46" };

/** "84-88" → [84, 88]; "88" → [88, 88]; anything else → null */
export function parseRange(cell: string | undefined): [number, number] | null {
  const nums = (cell ?? "").replace(",", ".").match(/\d+(?:\.\d+)?/g)?.map(Number);
  if (!nums?.length) return null;
  return [Math.min(...nums), Math.max(...nums)];
}

const norm = (s: string) => s.trim().toUpperCase().replace(/^XXXL$/, "3XL");

/** Closest size of the product to a size of the standard ladder (letters or EU numbers). */
function toProductSize(ladderIndex: number, sizes: string[]): string | null {
  if (!sizes.length) return null;
  const i = Math.max(0, Math.min(LADDER.length - 1, ladderIndex));
  const wanted = [norm(LADDER[i]!), EU[LADDER[i]!]!];
  const direct = sizes.find((s) => wanted.includes(norm(s)));
  if (direct) return direct;
  // nearest existing size on the ladder
  const ranked = sizes
    .map((s) => {
      const n = norm(s);
      const li = LADDER.indexOf(n) >= 0 ? LADDER.indexOf(n) : Object.values(EU).indexOf(n);
      return { s, d: li < 0 ? 99 : Math.abs(li - i) };
    })
    .sort((a, b) => a.d - b.d);
  return ranked[0]!.d < 99 ? ranked[0]!.s : null;
}

export function recommendSize(input: SizeAdviceInput): SizeAdvice | null {
  const sizes = input.sizes.filter(Boolean);
  if (!sizes.length) return null;
  const fit = input.fit ?? "regular";

  // 1) measurements against the product's chart
  const guide = input.guide;
  const given = (Object.keys(MEASURE_HEADERS) as Measure[]).filter((m) => (input[m] ?? 0) > 30);
  if (guide && given.length) {
    const cols = new Map<Measure, number>();
    for (const m of given) {
      const col = guide.headers.findIndex((h, i) => i > 0 && MEASURE_HEADERS[m].test(h));
      if (col > 0) cols.set(m, col);
    }
    // chart rows that are sizes of this product, in chart order
    const rows = guide.rows.filter((r) => sizes.some((s) => norm(s) === norm(r[0] ?? "")));
    if (cols.size && rows.length) {
      let need = 0;
      let edge: "low" | "high" | "mid" = "mid";
      const reasons: SizeAdvice["reasons"] = [];
      for (const [m, col] of cols) {
        const v = input[m]!;
        let idx = rows.findIndex((r) => {
          const range = parseRange(r[col]);
          return range != null && v <= range[1];
        });
        const beyond = idx < 0;
        if (beyond) idx = rows.length - 1;
        const range = parseRange(rows[idx]![col]);
        const size = rows[idx]![0]!;
        if (idx >= need) {
          need = idx;
          if (range && range[1] > range[0]) {
            const pos = (v - range[0]) / (range[1] - range[0]);
            edge = pos >= 0.67 ? "high" : pos <= 0.33 ? "low" : "mid";
          }
        }
        const r = range ? (range[0] === range[1] ? `${range[0]}` : `${range[0]}-${range[1]}`) : "";
        reasons.push(
          beyond
            ? { fr: `Votre ${MEASURE_NAME[m].fr} (${v} cm) dépasse le tableau : ${size} est la plus grande taille.`, ar: `${MEASURE_NAME[m].ar} (${v} سم) أكبر من الجدول: ${size} هو أكبر مقاس.` }
            : { fr: `Votre ${MEASURE_NAME[m].fr} (${v} cm) correspond au ${size} (${r} cm).`, ar: `${MEASURE_NAME[m].ar} (${v} سم) يوافق المقاس ${size} (${r} سم).` },
        );
      }
      if (cols.size > 1) reasons.push({ fr: "On garde la plus grande des tailles trouvées, pour être à l'aise partout.", ar: "نختار أكبر مقاس من بينها لتكوني مرتاحة في كل مكان." });
      let pick = need;
      let alt: number | null = null;
      if (edge === "high") {
        if (fit === "loose" && need + 1 < rows.length) {
          pick = need + 1;
          reasons.push({ fr: "Vous aimez porter ample : on monte d'une taille.", ar: "تحبين اللباس الواسع: نزيد مقاسًا واحدًا." });
        } else if (need + 1 < rows.length) alt = need + 1;
      } else if (edge === "low") {
        if (fit === "fitted" && need > 0) {
          pick = need - 1;
          reasons.push({ fr: "Vous aimez porter ajusté : on descend d'une taille.", ar: "تحبين اللباس الضيق: ننقص مقاسًا واحدًا." });
        } else if (need > 0 && fit !== "loose") alt = need - 1;
      }
      return { size: rows[pick]![0]!, reasons, method: "measurements", alternative: alt != null ? rows[alt]![0]! : null };
    }
  }

  // 2) estimate from height and weight (body mass index → usual size)
  const h = input.height ?? 0;
  const w = input.weight ?? 0;
  if (h >= 130 && h <= 210 && w >= 30 && w <= 200) {
    const bmi = w / (h / 100) ** 2;
    const steps = [18, 20.5, 23.5, 26.5, 29.5, 33];
    let base = steps.findIndex((t) => bmi < t);
    if (base < 0) base = steps.length;
    // close to the next or previous bucket: that size is worth trying too
    const upper = steps[base];
    const lower = steps[base - 1];
    const shift = upper != null && upper - bmi < 0.8 ? 1 : lower != null && bmi - lower < 0.8 ? -1 : 0;
    let i = base;
    if (h >= 175 && i < 2) i++; // tall: the shorter sizes run short
    if (fit === "loose") i++;
    if (fit === "fitted" && i > 0) i--;
    const size = toProductSize(i, sizes);
    if (!size) return null;
    const altSize = shift ? toProductSize(i + shift, sizes) : null;
    return {
      size,
      method: "height_weight",
      alternative: altSize && altSize !== size ? altSize : null,
      reasons: [
        { fr: `Estimation d'après votre taille (${h} cm) et votre poids (${w} kg).`, ar: `تقدير حسب طولك (${h} سم) ووزنك (${w} كغ).` },
        { fr: "Pour plus de précision, ajoutez votre tour de poitrine, de taille et de hanches.", ar: "لدقة أكبر، أضيفي محيط الصدر والخصر والورك." },
      ],
    };
  }
  return null;
}
