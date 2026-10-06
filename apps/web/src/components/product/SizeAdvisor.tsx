import { useState } from "react";
import { recommendSize, type SizeAdvice, type SizeGuideDTO } from "@henine/shared";
import { BottomSheet } from "@/components/ui/BottomSheet";
import { inputCls } from "@/components/ui/kit";
import { useLocale } from "@/lib/locale";

const KEY = "henine.measures.v1";
type Measures = { height: string; weight: string; bust: string; waist: string; hips: string; fit: "fitted" | "regular" | "loose" };
const EMPTY: Measures = { height: "", weight: "", bust: "", waist: "", hips: "", fit: "regular" };

function load(): Measures {
  try {
    return { ...EMPTY, ...(JSON.parse(localStorage.getItem(KEY) ?? "null") as Partial<Measures> | null) };
  } catch {
    return EMPTY;
  }
}

/** Arabic keyboards type ٠-٩: read them as 0-9. */
const num = (s: string) => {
  const n = Number(s.replace(/[٠-٩]/g, (d) => String(d.charCodeAt(0) - 0x0660)).replace(",", "."));
  return Number.isFinite(n) && n > 0 ? n : null;
};

/**
 * "📏 Quelle taille choisir ?": height, weight and (better) measurements → a suggested size
 * of this product, with the reasons, and a button that selects it.
 */
export function SizeAdvisorButton({
  sizes,
  guide,
  available,
  onChoose,
}: {
  /** this product's sizes, in order (French labels: the chart uses them) */
  sizes: { label: string; id: number }[];
  guide: SizeGuideDTO | null;
  /** pieces available if this size were chosen */
  available: (valueId: number) => number;
  onChoose: (valueId: number) => void;
}) {
  const { t, ar } = useLocale();
  const S = t.plus.size;
  const [open, setOpen] = useState(false);
  const [m, setM] = useState<Measures>(EMPTY);
  const [advice, setAdvice] = useState<SizeAdvice | null | "none">(null);

  function run() {
    const input = {
      sizes: sizes.map((s) => s.label),
      guide: guide ? { headers: guide.headersFr, rows: guide.rows } : null,
      height: num(m.height),
      weight: num(m.weight),
      bust: num(m.bust),
      waist: num(m.waist),
      hips: num(m.hips),
      fit: m.fit,
    };
    const a = recommendSize(input);
    setAdvice(a ?? "none");
    try {
      localStorage.setItem(KEY, JSON.stringify(m));
    } catch {
      /* private mode */
    }
  }

  const field = (k: "height" | "weight" | "bust" | "waist" | "hips", label: string) => (
    <label className="block">
      <span className="mb-1 block text-xs font-semibold text-ink-soft">{label}</span>
      <input inputMode="decimal" dir="ltr" className={`${inputCls} h-11`} value={m[k]} onChange={(e) => setM({ ...m, [k]: e.target.value })} maxLength={5} />
    </label>
  );
  const picked = advice && advice !== "none" ? sizes.find((s) => s.label === advice.size) : undefined;

  return (
    <>
      <button
        type="button"
        onClick={() => {
          setM(load());
          setAdvice(null);
          setOpen(true);
        }}
        className="mt-2 inline-flex h-9 items-center rounded-full bg-rose-100 px-3.5 text-sm font-semibold text-plum-700"
      >
        {S.open}
      </button>
      {open && (
        <BottomSheet title={S.title} onClose={() => setOpen(false)}>
          <p className="mb-4 text-sm leading-relaxed text-ink-soft">{S.intro}</p>
          <div className="grid grid-cols-2 gap-3">
            {field("height", S.height)}
            {field("weight", S.weight)}
          </div>
          {guide && (
            <>
              <div className="mt-3 grid grid-cols-3 gap-2">
                {field("bust", S.bust)}
                {field("waist", S.waist)}
                {field("hips", S.hips)}
              </div>
              <p className="mt-1.5 text-xs text-ink-soft">{S.measuresHint}</p>
            </>
          )}
          <fieldset className="mt-4">
            <legend className="mb-1.5 text-xs font-semibold text-ink-soft">{S.fit}</legend>
            <div className="grid grid-cols-3 gap-2">
              {(["fitted", "regular", "loose"] as const).map((f) => (
                <button
                  key={f}
                  type="button"
                  aria-pressed={m.fit === f}
                  onClick={() => setM({ ...m, fit: f })}
                  className={`h-10 rounded-xl border text-sm font-semibold ${m.fit === f ? "border-ink bg-ink text-on-ink" : "border-line bg-surface"}`}
                >
                  {S.fits[f]}
                </button>
              ))}
            </div>
          </fieldset>
          <button type="button" onClick={run} className="mt-5 h-12 w-full rounded-full bg-plum-600 font-semibold text-white">
            {S.cta}
          </button>

          {advice === "none" && <p className="mt-4 text-sm font-medium text-danger">{S.none}</p>}
          {advice && advice !== "none" && (
            <div className="mt-5 rounded-2xl bg-rose-100 p-4" aria-live="polite">
              <p className="text-xl font-bold text-plum-700">{S.result(advice.size)}</p>
              <ul className="mt-2 space-y-1 text-sm">
                {advice.reasons.map((r) => (
                  <li key={r.fr}>• {ar ? r.ar : r.fr}</li>
                ))}
              </ul>
              {advice.alternative && <p className="mt-2 text-sm text-ink-soft">{S.alternative(advice.alternative)}</p>}
              {picked && available(picked.id) === 0 && <p className="mt-2 text-sm font-medium text-danger">{S.soldOut(advice.size)}</p>}
              {picked && (
                <button
                  type="button"
                  onClick={() => {
                    onChoose(picked.id);
                    setOpen(false);
                  }}
                  className="mt-3 h-11 w-full rounded-full bg-ink font-semibold text-on-ink"
                >
                  {S.choose(advice.size)}
                </button>
              )}
              <p className="mt-2 text-xs text-ink-soft">{S.saved}</p>
            </div>
          )}
        </BottomSheet>
      )}
    </>
  );
}
