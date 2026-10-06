/**
 * Physical stock count (inventaire): the team counts the shelves, the system compares with
 * what it believes, and an authorised person approves the corrections. Nothing changes in the
 * stock before the approval; the corrections then go through the normal stock history.
 */

export const COUNT_STATUSES = ["counting", "submitted", "approved", "rejected", "cancelled"] as const;
export type CountStatus = (typeof COUNT_STATUSES)[number];

export const COUNT_STATUS_LABEL: Record<CountStatus, string> = {
  counting: "Comptage en cours",
  submitted: "À valider",
  approved: "Validé (stock corrigé)",
  rejected: "Refusé",
  cancelled: "Annulé",
};

const COUNT_TRANSITIONS: Record<CountStatus, readonly CountStatus[]> = {
  counting: ["submitted", "cancelled"],
  submitted: ["approved", "rejected", "counting"],
  approved: [],
  rejected: [],
  cancelled: [],
};
export const canCountTransition = (from: CountStatus, to: CountStatus) => COUNT_TRANSITIONS[from].includes(to);

export const COUNT_SCOPES = ["all", "category", "product", "variants"] as const;
export type CountScope = (typeof COUNT_SCOPES)[number];

export const COUNT_REASONS = ["damaged", "missing", "found", "count_error", "theft", "data_fix", "other"] as const;
export type CountReason = (typeof COUNT_REASONS)[number];
export const COUNT_REASON_LABEL: Record<CountReason, string> = {
  damaged: "Abîmé",
  missing: "Manquant",
  found: "Retrouvé",
  count_error: "Erreur de comptage précédente",
  theft: "Vol / perte",
  data_fix: "Correction des données",
  other: "Autre",
};

export interface CountLine {
  /** what the system had when the count started */
  systemQty: number;
  /** what was found on the shelf (null = not counted yet) */
  countedQty: number | null;
}

/** counted − system: negative = pieces missing, positive = pieces found. null while not counted. */
export const countDifference = (l: CountLine): number | null => (l.countedQty == null ? null : l.countedQty - l.systemQty);

/**
 * The stock after approval. Sales and receptions may have happened while counting, so the
 * difference found is applied to today's stock (not the old snapshot overwritten).
 * Never below what pending orders already hold.
 */
export function stockAfterCount(currentOnHand: number, reserved: number, line: CountLine): { target: number; delta: number; belowReserved: boolean } {
  const diff = countDifference(line) ?? 0;
  const target = Math.max(0, currentOnHand + diff);
  return { target, delta: target - currentOnHand, belowReserved: target < reserved };
}

export interface CountSummary {
  lines: number;
  counted: number;
  /** lines whose count differs from the system */
  discrepancies: number;
  missingPieces: number;
  foundPieces: number;
}

export function countSummary(lines: CountLine[]): CountSummary {
  const s: CountSummary = { lines: lines.length, counted: 0, discrepancies: 0, missingPieces: 0, foundPieces: 0 };
  for (const l of lines) {
    const d = countDifference(l);
    if (d == null) continue;
    s.counted++;
    if (d !== 0) s.discrepancies++;
    if (d < 0) s.missingPieces -= d;
    else s.foundPieces += d;
  }
  return s;
}
