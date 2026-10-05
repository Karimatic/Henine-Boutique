import { useEffect, useRef, useState, type ReactNode } from "react";
import { tr } from "../i18n";

/*
 * Small SVG charts for the admin. Single series in the brand plum (one hue), thin marks,
 * 2px lines, rounded data ends, recessive grid; every mark has a hover/touch tooltip.
 * Time always runs left → right (also in Arabic), so charts are laid out dir="ltr".
 */

const PLUM = "var(--color-chart)";

function useHover() {
  const [i, setI] = useState<number | null>(null);
  return { i, set: setI, clear: () => setI(null) };
}

/** Width of the chart's box in pixels, so the drawing is 1:1 and the tooltip lands on the point. */
function useWidth(fallback = 640) {
  const ref = useRef<HTMLDivElement>(null);
  const [w, setW] = useState(fallback);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => e && setW(Math.max(240, Math.round(e.contentRect.width))));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return [ref, w] as const;
}

/**
 * Next to the point under the pointer (x, y in % of the chart): above it, or below it near the
 * top so it never covers the card title; kept inside the chart at both ends.
 */
function Tooltip({ x, y, children }: { x: number; y: number; children: ReactNode }) {
  const below = y < 35;
  const tx = x < 18 ? "0%" : x > 82 ? "-100%" : "-50%";
  return (
    <div
      role="status"
      className="pointer-events-none absolute z-10 whitespace-nowrap rounded-lg border border-line bg-surface px-2.5 py-1.5 text-xs shadow-lg"
      style={{ left: `${x}%`, top: `${y}%`, transform: `translate(${tx}, ${below ? "12px" : "calc(-100% - 12px)"})` }}
    >
      {children}
    </div>
  );
}

/** Line + soft area over time, crosshair and tooltip following the pointer. */
export function TrendChart({
  points, format, axisFormat = format, label, height = 200,
}: {
  points: { label: string; value: number; sub?: string }[];
  format: (v: number) => string;
  axisFormat?: (v: number) => string;
  label: string;
  height?: number;
}) {
  const hover = useHover();
  const ref = useRef<SVGSVGElement>(null);
  const [box, W] = useWidth();
  const H = height;
  const pad = { l: 44, r: 12, t: 14, b: 24 };
  const max = Math.max(1, ...points.map((p) => p.value));
  // small counts: an even top so the middle line is a whole number (0 · 3 · 6, not 0 · 3 · 5)
  const nice = max <= 10 ? Math.ceil(niceMax(max) / 2) * 2 : niceMax(max);
  const x = (i: number) => pad.l + (points.length <= 1 ? 0 : (i * (W - pad.l - pad.r)) / (points.length - 1));
  const y = (v: number) => H - pad.b - ((H - pad.t - pad.b) * v) / nice;
  const line = points.map((p, i) => `${i ? "L" : "M"}${x(i).toFixed(1)},${y(p.value).toFixed(1)}`).join(" ");
  const area = points.length ? `${line} L${x(points.length - 1)},${H - pad.b} L${x(0)},${H - pad.b} Z` : "";
  // no "1, 1, 0" axis: a middle line only when its label differs from the others
  const ticks = [0, 0.5, 1].map((f) => f * nice).filter((t, i, all) => all.findIndex((u) => axisFormat(u) === axisFormat(t)) === i);
  const xTicks = points.length > 2 ? [0, Math.floor((points.length - 1) / 2), points.length - 1] : points.map((_, i) => i);
  const gradId = `g-${label.replace(/\W/g, "")}`;

  function onMove(e: React.PointerEvent<SVGSVGElement>) {
    const box = ref.current?.getBoundingClientRect();
    if (!box || !points.length) return;
    const vx = ((e.clientX - box.left) / box.width) * W;
    const i = Math.round(((vx - pad.l) / (W - pad.l - pad.r)) * (points.length - 1));
    hover.set(Math.max(0, Math.min(points.length - 1, i)));
  }

  const h = hover.i != null ? points[hover.i] : null;
  return (
    <div ref={box} className="relative" dir="ltr">
      <svg
        ref={ref}
        viewBox={`0 0 ${W} ${H}`}
        className="w-full touch-pan-y"
        style={{ height }}
        role="img"
        aria-label={label}
        onPointerMove={onMove}
        onPointerDown={onMove}
        onPointerLeave={hover.clear}
      >
        <defs>
          <linearGradient id={gradId} x1="0" x2="0" y1="0" y2="1">
            <stop offset="0" stopColor="var(--color-chart)" stopOpacity="0.22" />
            <stop offset="1" stopColor="var(--color-chart)" stopOpacity="0" />
          </linearGradient>
        </defs>
        {ticks.map((t) => (
          <g key={t}>
            <line x1={pad.l} x2={W - pad.r} y1={y(t)} y2={y(t)} stroke="var(--color-line)" strokeDasharray={t ? "3 4" : undefined} />
            <text x={pad.l - 8} y={y(t) + 3.5} textAnchor="end" fontSize="10" fill="var(--color-ink-soft)">
              {axisFormat(t)}
            </text>
          </g>
        ))}
        {area && <path d={area} fill={`url(#${gradId})`} />}
        {line && <path d={line} fill="none" stroke={PLUM} strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />}
        {xTicks.map((i) => (
          <text key={i} x={x(i)} y={H - 6} textAnchor={i === 0 ? "start" : i === points.length - 1 ? "end" : "middle"} fontSize="10" fill="var(--color-ink-soft)">
            {points[i]?.label}
          </text>
        ))}
        {h && hover.i != null && (
          <g>
            <line x1={x(hover.i)} x2={x(hover.i)} y1={pad.t} y2={H - pad.b} stroke="var(--color-ink-soft)" strokeWidth="1" strokeDasharray="2 3" />
            <circle cx={x(hover.i)} cy={y(h.value)} r="5" fill={PLUM} stroke="var(--color-surface)" strokeWidth="2" />
          </g>
        )}
      </svg>
      {h && hover.i != null && (
        <Tooltip x={(x(hover.i) / W) * 100} y={(y(h.value) / H) * 100}>
          <span className="block text-ink-soft">{h.label}</span>
          <b className="tabular-nums">{format(h.value)}</b>
          {h.sub && <span className="block text-ink-soft">{h.sub}</span>}
        </Tooltip>
      )}
    </div>
  );
}

/** Vertical columns (categories or days), the highest one darker, tooltip per column. */
export function ColumnChart({
  items, format, label, height = 160,
}: {
  items: { label: string; value: number; sub?: string }[];
  format: (v: number) => string;
  label: string;
  height?: number;
}) {
  const hover = useHover();
  const max = Math.max(1, ...items.map((d) => d.value));
  const best = items.reduce((b, d, i) => (d.value > (items[b]?.value ?? 0) ? i : b), 0);
  return (
    <div className="relative" dir="ltr">
      <div className="flex items-end gap-1.5" style={{ height }} role="img" aria-label={label} onPointerLeave={hover.clear}>
        {items.map((d, i) => (
          <button
            key={d.label}
            type="button"
            onPointerEnter={() => hover.set(i)}
            onFocus={() => hover.set(i)}
            onClick={() => hover.set(i)}
            className="group relative flex h-full flex-1 items-end justify-center"
            aria-label={`${d.label} : ${format(d.value)}`}
          >
            <span
              className="block w-full max-w-9 rounded-t-[4px] transition-opacity"
              style={{
                height: `${Math.max(d.value ? 4 : 1.5, (d.value / max) * 100)}%`,
                background: i === best && d.value > 0 ? "var(--color-chart-strong)" : PLUM,
                opacity: hover.i == null || hover.i === i ? 1 : 0.55,
              }}
            />
          </button>
        ))}
      </div>
      <div className="mt-1.5 flex gap-1.5 text-center text-[10.5px] text-ink-soft">
        {items.map((d) => (
          <span key={d.label} className="flex-1 truncate">
            {d.label}
          </span>
        ))}
      </div>
      {hover.i != null && items[hover.i] && (
        <Tooltip x={((hover.i + 0.5) / items.length) * 100} y={100 - Math.max(4, (items[hover.i]!.value / max) * 100) - 12}>
          <span className="block text-ink-soft">{items[hover.i]!.label}</span>
          <b className="tabular-nums">{format(items[hover.i]!.value)}</b>
          {items[hover.i]!.sub && <span className="block text-ink-soft">{items[hover.i]!.sub}</span>}
        </Tooltip>
      )}
    </div>
  );
}

/** One bar split into parts (2px gaps), legend with counts and shares (never colour alone). */
export function StackBar({ parts, label }: { parts: { key: string; label: string; value: number; color: string }[]; label: string }) {
  const hover = useHover();
  const total = parts.reduce((s, p) => s + p.value, 0);
  if (!total) return <p className="text-sm text-ink-soft">{tr("Pas encore de données.")}</p>;
  const shown = parts.filter((p) => p.value > 0);
  return (
    <div dir="ltr">
      <div className="flex h-4 w-full gap-[2px] overflow-hidden rounded-full" role="img" aria-label={label} onPointerLeave={hover.clear}>
        {shown.map((p, i) => (
          <span
            key={p.key}
            onPointerEnter={() => hover.set(i)}
            className="h-full first:rounded-s-full last:rounded-e-full transition-opacity"
            style={{ width: `${(p.value / total) * 100}%`, background: p.color, opacity: hover.i == null || hover.i === i ? 1 : 0.5 }}
            title={`${p.label} : ${p.value}`}
          />
        ))}
      </div>
      <ul className="mt-3 grid grid-cols-2 gap-x-4 gap-y-1.5 text-sm sm:grid-cols-3" dir="auto">
        {parts.map((p) => (
          <li key={p.key} className="flex items-center gap-2">
            <span className="size-2.5 shrink-0 rounded-full" style={{ background: p.color }} aria-hidden="true" />
            <span className="min-w-0 flex-1 truncate">{p.label}</span>
            <b className="tabular-nums">{p.value}</b>
            <span className="w-10 text-end text-xs tabular-nums text-ink-soft">{Math.round((p.value / total) * 100)} %</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

/** Round axis maximum: 1, 2, 5 × 10ⁿ. */
function niceMax(v: number): number {
  const p = 10 ** Math.floor(Math.log10(v));
  for (const m of [1, 2, 2.5, 5, 7.5, 10]) if (m * p >= v) return m * p;
  return 10 * p;
}

/** "12k" style short amounts for axes. */
export const shortDA = (v: number) => (v >= 1_000_000 ? `${(v / 1_000_000).toFixed(1).replace(".0", "")}M` : v >= 1000 ? `${Math.round(v / 1000)}k` : String(Math.round(v)));
