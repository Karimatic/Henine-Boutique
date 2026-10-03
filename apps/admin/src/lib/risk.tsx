import { RISK_LEVEL_LABEL, RISK_REASON_LABEL, SEGMENT_LABEL, type CustomerSegment, type RiskAssessment, type RiskLevel } from "@henine/shared";
import { Badge } from "../ui";
import { tr } from "../i18n";

export const SEGMENT_TONE: Record<CustomerSegment, string> = {
  new: "bg-sky-100 text-sky-800",
  returning: "bg-emerald-100 text-emerald-800",
  vip: "bg-plum-600 text-white",
  high_risk: "bg-red-100 text-red-800",
};

export function SegmentBadge({ segment }: { segment: CustomerSegment }) {
  return (
    <Badge tone={SEGMENT_TONE[segment]}>
      {segment === "vip" ? "💎 " : ""}
      {tr(SEGMENT_LABEL[segment])}
    </Badge>
  );
}

export function RiskBadge({ level, score }: { level: RiskLevel; score?: number }) {
  const tone = level === "high" ? "bg-red-100 text-red-800" : level === "medium" ? "bg-amber-100 text-amber-800" : "bg-emerald-50 text-emerald-800";
  return (
    <Badge tone={tone}>
      {RISK_LEVEL_LABEL[level].emoji} {tr(RISK_LEVEL_LABEL[level].fr)}
      {score != null ? ` · ${score}` : ""}
    </Badge>
  );
}

/** Level + every reason with its points: the score is never a black box. */
export function RiskPanel({ risk }: { risk: RiskAssessment }) {
  return (
    <div className="rounded-xl bg-ivory-deep p-3 text-sm">
      <div className="flex flex-wrap items-center gap-2">
        <RiskBadge level={risk.level} score={risk.score} />
        <span className="text-xs text-ink-soft">{tr("Aide à la décision, jamais un refus automatique.")}</span>
      </div>
      {risk.reasons.length > 0 ? (
        <ul className="mt-2 space-y-0.5 text-xs">
          {risk.reasons.map((r) => (
            <li key={r.code} className="flex justify-between gap-3">
              <span>
                {r.count > 1 ? `${r.count} ` : ""}
                {tr(RISK_REASON_LABEL[r.code])}
              </span>
              <b className={r.points < 0 ? "text-emerald-700" : "text-red-700"}>
                {r.points > 0 ? "+" : ""}
                {r.points}
              </b>
            </li>
          ))}
        </ul>
      ) : (
        <p className="mt-1 text-xs text-ink-soft">{tr("Aucun signal : nouvelle cliente sans historique.")}</p>
      )}
    </div>
  );
}
