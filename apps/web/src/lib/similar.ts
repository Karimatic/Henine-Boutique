import { normalizeSearch, type ProductCardDTO } from "@henine/shared";

export type SimilarReason = "category" | "color" | "price" | "style";

const GENERIC = new Set(["nouveaute", "best-seller", "promo"]);
const STOP = new Set(["avec", "pour", "dans", "sans", "robe", "robes", "henine"]);

function hexDistance(a: string, b: string): number {
  const p = (h: string) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
  const [x, y] = [p(a), p(b)];
  return Math.sqrt(x.reduce((s, v, i) => s + (v - y[i]!) ** 2, 0));
}

/** Words that describe a piece: material, pattern, cut ("satin", "rayé", "longue"…). */
function styleWords(p: ProductCardDTO): Set<string> {
  const words = normalizeSearch(`${p.nameFr} ${p.nameAr}`).split(/[\s'’-]+/).filter((w) => w.length >= 4 && !STOP.has(w));
  return new Set([...words, ...p.tags.filter((t) => !GENERIC.has(t))]);
}

/**
 * "Voir des modèles similaires", no image AI: same category, a close colour, a close price
 * and shared style words (material, pattern, cut). In-stock pieces only.
 */
export function similarProducts(target: ProductCardDTO, all: ProductCardDTO[], limit = 8): (ProductCardDTO & { reasons: SimilarReason[] })[] {
  const mine = styleWords(target);
  return all
    .filter((p) => p.id !== target.id && p.inStock)
    .map((p) => {
      const reasons: SimilarReason[] = [];
      let score = 0;
      if (p.categorySlug && p.categorySlug === target.categorySlug) {
        score += 3;
        reasons.push("category");
      }
      const near = target.colors.some((a) => p.colors.some((b) => /^#[0-9a-f]{6}$/i.test(a) && /^#[0-9a-f]{6}$/i.test(b) && hexDistance(a, b) < 70));
      if (near) {
        score += 2;
        reasons.push("color");
      }
      const ratio = target.price ? p.price / target.price : 0;
      if (ratio >= 0.75 && ratio <= 1.25) {
        score += 2;
        reasons.push("price");
      } else if (ratio >= 0.5 && ratio <= 1.5) score += 1;
      const shared = [...styleWords(p)].filter((w) => mine.has(w)).length;
      if (shared) {
        score += Math.min(3, shared);
        reasons.push("style");
      }
      return { ...p, reasons, score };
    })
    .filter((p) => p.score >= 2)
    .sort((a, b) => b.score - a.score || (b.rating?.avg ?? 0) - (a.rating?.avg ?? 0))
    .slice(0, limit)
    .map(({ score: _score, ...p }) => p);
}
