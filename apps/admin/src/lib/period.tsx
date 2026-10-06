/** The period of a report (Statistiques, Finance): presets or a custom range, as an API query. */
import { useState } from "react";
import { tr } from "../i18n";
import { Pills, TextField } from "../ui";

export const RANGES = [
  { value: "today", label: tr("Aujourd'hui") },
  { value: "7", label: tr("7 jours") },
  { value: "30", label: tr("30 jours") },
  { value: "90", label: tr("90 jours") },
  { value: "365", label: tr("1 an") },
  { value: "custom", label: tr("Période…") },
];

const day = (ts: number) => new Date(ts + 3600_000).toISOString().slice(0, 10);

export function usePeriod(initial = "30") {
  const [range, setRange] = useState(initial);
  const today = day(Date.now());
  const [from, setFrom] = useState(day(Date.now() - 29 * 86400_000));
  const [to, setTo] = useState(today);
  const query = range === "custom" ? `from=${from}&to=${to}` : `range=${range}`;
  const picker = (
    <>
      <Pills value={range} onChange={setRange} options={RANGES} />
      {range === "custom" && (
        <div className="mb-4 flex flex-wrap items-end gap-3">
          <TextField label={tr("Du")} type="date" value={from} max={to} onChange={(e) => setFrom(e.target.value)} />
          <TextField label={tr("Au")} type="date" value={to} min={from} max={today} onChange={(e) => setTo(e.target.value)} />
        </div>
      )}
    </>
  );
  return { query, range, picker };
}
