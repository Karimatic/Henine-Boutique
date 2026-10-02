import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { api } from "../api";
import { OUTCOME_REASON_LABEL, type OutcomeReason } from "@henine/shared";
import { CHANNEL_LABEL, da } from "../lib/format";
import { Card, ErrorState, ListSkeleton, PageHeader, Pills, Stat, TextField } from "../ui";
import { tr } from "../i18n";
import { ColumnChart, shortDA, StackBar, TrendChart } from "../lib/charts";

interface StatsData {
  range: { since: number; until: number; label: string; days: number };
  totals: {
    placed: number; orders: number; revenue: number; deliveredRevenue: number; avgBasket: number | null; delivered: number; cancelled: number;
    returned: number; pending: number; inProgress: number; customers: number; repeatRate: number | null; confirmRate: number | null;
    deliveryRate: number | null; returnRate: number | null;
  };
  funnel: { placed: number; confirmed: number; shipped: number; delivered: number; returned: number; cancelled: number };
  daily: { date: string; orders: number; revenue: number }[];
  wilayas: {
    code: number; name: string; placed: number; orders: number; revenue: number; delivered: number; cancelled: number; returned: number;
    deliveryRate: number | null; avg_days: number | null;
  }[];
  reasons: { kind: "cancel" | "return"; reason: string; n: number }[];
  delivery: {
    minSample: number; prepHoursMedian: number | null; prepSample: number; shipDaysMedian: number | null; shipSample: number;
    byType: { type: string; shipped: number; delivered: number; returned: number; deliveryRate: number | null; avg_days: number | null }[];
  };
  channels: { channel: string; orders: number; revenue: number }[];
  hours: { hour: string; orders: number }[];
  weekdays: { dow: number; orders: number; revenue: number }[];
  topProducts: { product_id: number; name_fr: string; units: number; revenue: number }[];
}

const pct = (v: number | null) => (v == null ? "—" : `${v} %`);

/** Every day of the range (missing days = 0), "dd/mm" labels. */
function fillDays(data: StatsData["daily"], since: number, days: number) {
  const byDate = new Map(data.map((d) => [d.date, d]));
  return Array.from({ length: days }, (_, i) => {
    const date = new Date(since + 3600_000 + i * 86400_000).toISOString().slice(0, 10);
    const row = byDate.get(date);
    return { date, label: date.slice(5).split("-").reverse().join("/"), orders: row?.orders ?? 0, revenue: row?.revenue ?? 0 };
  });
}

/** Revenue adding up day after day over the period. */
function CumulativeChart({ data, since, days }: { data: StatsData["daily"]; since: number; days: number }) {
  let run = 0;
  const points = fillDays(data, since, days).map((d) => {
    run += d.revenue;
    return { label: d.label, value: run, sub: d.revenue ? tr("+ {0} ce jour-là", { 0: da(d.revenue) }) : undefined };
  });
  return (
    <Card title={tr("Chiffre d'affaires cumulé")}>
      <TrendChart points={points} format={(v) => da(v)} axisFormat={shortDA} label={tr("Chiffre d'affaires cumulé")} />
    </Card>
  );
}

// Algeria's week starts on Saturday
const WEEK = [
  [6, "Sam"], [0, "Dim"], [1, "Lun"], [2, "Mar"], [3, "Mer"], [4, "Jeu"], [5, "Ven"],
] as const;

function WeekdayChart({ rows }: { rows: StatsData["weekdays"] }) {
  const items = WEEK.map(([dow, name]) => {
    const r = rows.find((x) => Number(x.dow) === dow);
    return { label: tr(name), value: r?.orders ?? 0, sub: r ? da(r.revenue) : undefined };
  });
  const best = items.reduce((b, d) => (d.value > b.value ? d : b), items[0]!);
  return (
    <Card title={tr("Jours de la semaine")}>
      <ColumnChart items={items} format={(v) => tr("{0} commande(s)", { 0: v })} label={tr("Commandes par jour de la semaine")} />
      {best.value > 0 && (
        <p className="mt-3 text-sm">
          {tr("Meilleur jour :")} <b>{best.label}</b> {tr("(publiez la veille au soir sur Instagram).")}
        </p>
      )}
    </Card>
  );
}

/** Daily columns: one series, labelled peaks, dates on the axis. */
function DailyChart({ data, since, days }: { data: StatsData["daily"]; since: number; days: number }) {
  const [metric, setMetric] = useState<"orders" | "revenue">("orders");
  // fill missing days with zero so the time axis is honest
  const byDate = new Map(data.map((d) => [d.date, d]));
  const series: { date: string; value: number }[] = [];
  for (let i = 0; i < days; i++) {
    const date = new Date(since + 3600_000 + i * 86400_000).toISOString().slice(0, 10);
    const row = byDate.get(date);
    series.push({ date, value: row ? row[metric] : 0 });
  }
  const max = Math.max(1, ...series.map((s) => s.value));
  const W = 640;
  const H = 180;
  const pad = { l: 8, r: 8, t: 18, b: 22 };
  const bw = (W - pad.l - pad.r) / series.length;
  const fmt = (v: number) => (metric === "revenue" ? (v >= 1000 ? `${Math.round(v / 1000)}k` : String(v)) : String(v));
  const peak = series.reduce((m, s, i) => (s.value > (series[m]?.value ?? 0) ? i : m), 0);
  const ticks = [0, Math.floor(series.length / 2), series.length - 1];

  return (
    <Card title={tr("Évolution")} actions={<Pills value={metric} onChange={setMetric} options={[{ value: "orders", label: tr("Commandes") }, { value: "revenue", label: tr("CA") }]} />}>
      <svg viewBox={`0 0 ${W} ${H}`} className="h-48 w-full" role="img" aria-label={tr("{0} par jour", { 0: metric === "orders" ? "Commandes" : "Chiffre d'affaires" })}>
        <line x1={pad.l} x2={W - pad.r} y1={H - pad.b} y2={H - pad.b} stroke="var(--color-line)" />
        {series.map((s, i) => {
          const h = ((H - pad.t - pad.b) * s.value) / max;
          const x = pad.l + i * bw;
          return (
            <g key={s.date}>
              <rect x={x + bw * 0.15} y={H - pad.b - h} width={Math.max(1, bw * 0.7)} height={h} rx={Math.min(3, bw * 0.2)} fill={i === peak && s.value > 0 ? "var(--color-plum-600)" : "var(--color-rose-500)"}>
                <title>{`${s.date} : ${metric === "revenue" ? da(s.value) : `${s.value} commande(s)`}`}</title>
              </rect>
              {i === peak && s.value > 0 && (
                <text x={x + bw / 2} y={H - pad.b - h - 5} textAnchor="middle" fontSize="11" fill="var(--color-ink)" fontWeight="600">{fmt(s.value)}</text>
              )}
            </g>
          );
        })}
        {ticks.map((i) => (
          <text key={i} x={pad.l + i * bw + bw / 2} y={H - 6} textAnchor="middle" fontSize="10" fill="var(--color-ink-soft)">
            {series[i]?.date.slice(5).split("-").reverse().join("/")}
          </text>
        ))}
      </svg>
    </Card>
  );
}

/** Horizontal bars with the value printed at the end: easy to read on a phone. */
function BarList({ rows }: { rows: { label: string; value: number; display: string; sub?: string }[] }) {
  const max = Math.max(1, ...rows.map((r) => r.value));
  if (!rows.length) return <p className="text-sm text-ink-soft">{tr("Pas encore de données.")}</p>;
  return (
    <ul className="space-y-2">
      {rows.map((r) => (
        <li key={r.label}>
          <div className="flex items-baseline justify-between gap-2 text-sm">
            <span className="truncate">{r.label}{r.sub && <span className="text-xs text-ink-soft"> · {r.sub}</span>}</span>
            <span className="shrink-0 font-semibold tabular-nums">{r.display}</span>
          </div>
          <div className="mt-1 h-2 rounded-full bg-ivory-deep">
            <div className="h-2 rounded-full bg-plum-600" style={{ width: `${(r.value / max) * 100}%` }} />
          </div>
        </li>
      ))}
    </ul>
  );
}

function HoursChart({ hours }: { hours: StatsData["hours"] }) {
  const values = Array.from({ length: 24 }, (_, h) => hours.find((x) => Number(x.hour) === h)?.orders ?? 0);
  const max = Math.max(1, ...values);
  const best = values.indexOf(Math.max(...values));
  return (
    <div>
      <div className="flex h-24 items-end gap-0.5" role="img" aria-label={tr("Commandes par heure")}>
        {values.map((v, h) => (
          <div key={h} className="flex-1 rounded-t" style={{ height: `${Math.max(2, (v / max) * 100)}%`, background: h === best && v > 0 ? "var(--color-plum-600)" : "var(--color-rose-300)" }} title={tr("{0}h : {1} commande(s)", { 0: h, 1: v })} />
        ))}
      </div>
      <div className="mt-1 flex justify-between text-[10px] text-ink-soft"><span>0h</span><span>6h</span><span>{tr("12h")}</span><span>{tr("18h")}</span><span>{tr("23h")}</span></div>
      {Math.max(...values) > 0 && <p className="mt-2 text-sm">{tr("Heure la plus active :")} <b>{best}{tr("h–")}{best + 1}h</b> {tr("(idéal pour publier sur Instagram).")}</p>}
    </div>
  );
}

const RANGES = [
  { value: "today", label: tr("Aujourd'hui") },
  { value: "7", label: tr("7 jours") },
  { value: "30", label: tr("30 jours") },
  { value: "90", label: tr("90 jours") },
  { value: "365", label: tr("1 an") },
  { value: "custom", label: tr("Période…") },
];

const REASON_LABEL = (r: string) => (r === "unknown" ? "Non précisé" : (tr(OUTCOME_REASON_LABEL[r as OutcomeReason]) ?? r));

type WilayaSort = "orders" | "revenue" | "deliveryRate" | "returned";

function WilayaTable({ rows }: { rows: StatsData["wilayas"] }) {
  const [sort, setSort] = useState<WilayaSort>("orders");
  const [all, setAll] = useState(false);
  const sorted = [...rows].sort((a, b) => (sort === "deliveryRate" ? (b.deliveryRate ?? -1) - (a.deliveryRate ?? -1) : (b[sort] ?? 0) - (a[sort] ?? 0)));
  const shown = all ? sorted : sorted.slice(0, 12);
  if (!rows.length) return <p className="text-sm text-ink-soft">{tr("Pas encore de commandes sur la période.")}</p>;
  const th = (k: WilayaSort, label: string) => (
    <th className="px-2 py-2 text-end">
      <button type="button" onClick={() => setSort(k)} className={`font-semibold ${sort === k ? "text-plum-700 underline" : ""}`}>{label}</button>
    </th>
  );
  return (
    <div>
      <div className="-mx-4 overflow-x-auto px-4">
        <table className="w-full min-w-[34rem] text-sm">
          <thead className="text-xs text-ink-soft">
            <tr className="border-b border-line">
              <th className="px-2 py-2 text-start">{tr("Wilaya")}</th>
              {th("orders", tr("Commandes"))}
              <th className="px-2 py-2 text-end">{tr("Livrées")}</th>
              <th className="px-2 py-2 text-end">{tr("Annulées")}</th>
              {th("returned", "Retours")}
              {th("deliveryRate", "Taux livr.")}
              {th("revenue", "CA")}
            </tr>
          </thead>
          <tbody>
            {shown.map((w) => (
              <tr key={w.code} className="border-b border-line/60">
                <td className="px-2 py-2">{w.code} - {w.name}</td>
                <td className="px-2 py-2 text-end tabular-nums font-semibold">{w.orders}</td>
                <td className="px-2 py-2 text-end tabular-nums">{w.delivered}</td>
                <td className="px-2 py-2 text-end tabular-nums text-ink-soft">{w.cancelled}</td>
                <td className={`px-2 py-2 text-end tabular-nums ${w.returned ? "text-orange-700" : ""}`}>{w.returned}</td>
                <td className={`px-2 py-2 text-end tabular-nums ${(w.deliveryRate ?? 100) < 70 ? "font-semibold text-red-700" : ""}`}>{pct(w.deliveryRate)}</td>
                <td className="px-2 py-2 text-end tabular-nums">{da(w.revenue)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {rows.length > 12 && (
        <button type="button" onClick={() => setAll(!all)} className="mt-2 text-sm font-semibold text-plum-600">
          {all ? tr("Voir moins") : tr("Voir les {0} wilayas", { 0: rows.length })}
        </button>
      )}
      <p className="mt-2 text-xs text-ink-soft">{tr("Taux de livraison = livrées ÷ (livrées + retours), sur les colis dont l'issue est connue.")}</p>
    </div>
  );
}

export function StatsPage() {
  const [range, setRange] = useState("30");
  const today = new Date(Date.now() + 3600_000).toISOString().slice(0, 10);
  const [from, setFrom] = useState(new Date(Date.now() + 3600_000 - 29 * 86400_000).toISOString().slice(0, 10));
  const [to, setTo] = useState(today);
  const query = range === "custom" ? `from=${from}&to=${to}` : `range=${range}`;
  const q = useQuery({ queryKey: ["stats", query], queryFn: () => api<StatsData>(`/stats?${query}`), placeholderData: (prev) => prev });
  const d = q.data;
  const csvDays = d ? Math.min(365, Math.ceil((Date.now() - d.range.since) / 86400_000)) : 30;
  const cancelReasons = d?.reasons.filter((r) => r.kind === "cancel") ?? [];
  const returnReasons = d?.reasons.filter((r) => r.kind === "return") ?? [];
  const dl = d?.delivery;
  return (
    <div className="space-y-4">
      <PageHeader
        group={tr("Analyse")}
        title={tr("Statistiques")}
        subtitle={tr("Commandes passées sur la période. Les annulées ne comptent jamais dans le chiffre d'affaires.")}
        actions={<a href={`/api/admin/orders.csv?days=${csvDays}`} className="inline-flex h-9 items-center rounded-lg border border-line bg-white px-3.5 text-sm font-semibold">{tr("Export CSV")}</a>}
      />
      <Pills value={range} onChange={setRange} options={RANGES} />
      {range === "custom" && (
        <div className="flex flex-wrap items-end gap-3">
          <TextField label={tr("Du")} type="date" value={from} max={to} onChange={(e) => setFrom(e.target.value)} />
          <TextField label={tr("Au")} type="date" value={to} min={from} max={today} onChange={(e) => setTo(e.target.value)} />
        </div>
      )}
      {q.error ? <ErrorState error={q.error} onRetry={q.refetch} /> : !d ? <ListSkeleton rows={4} /> : (
        <>
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
            <Stat label={tr("Commandes")} value={d.totals.orders} hint={tr("{0} passées · {1} clientes", { 0: d.totals.placed, 1: d.totals.customers })} />
            <Stat label={tr("Chiffre d'affaires")} value={da(d.totals.revenue)} hint={tr("commandé, hors annulées")} />
            <Stat label={tr("Encaissé (livrées)")} value={da(d.totals.deliveredRevenue)} tone="good" />
            <Stat label={tr("Panier moyen")} value={da(d.totals.avgBasket)} />
            <Stat label={tr("Livrées")} value={d.totals.delivered} tone="good" hint={tr("taux {0}", { 0: pct(d.totals.deliveryRate) })} />
            <Stat label={tr("En attente")} value={d.totals.pending} hint={tr("+ {0} en cours", { 0: d.totals.inProgress })} tone={d.totals.pending ? "warn" : undefined} />
            <Stat label={tr("Annulées")} value={d.totals.cancelled} hint={tr("confirmation {0}", { 0: pct(d.totals.confirmRate) })} />
            <Stat label={tr("Retours")} value={d.totals.returned} hint={tr("taux {0}", { 0: pct(d.totals.returnRate) })} tone={(d.totals.returnRate ?? 0) > 20 ? "warn" : undefined} />
          </div>
          {d.range.days > 1 && <DailyChart data={d.daily} since={d.range.since} days={d.range.days} />}
          <Card title={tr("Résultat des commandes")}>
            <StackBar
              label={tr("Résultat des commandes")}
              parts={[
                { key: "delivered", label: tr("Livrées"), value: d.totals.delivered, color: "#1baf7a" },
                { key: "progress", label: tr("En cours"), value: d.totals.inProgress, color: "#2a78d6" },
                { key: "pending", label: tr("À confirmer"), value: d.totals.pending, color: "#eda100" },
                { key: "returned", label: tr("Retours"), value: d.totals.returned, color: "#e34948" },
                { key: "cancelled", label: tr("Annulées"), value: d.totals.cancelled, color: "#4a3aa7" },
              ]}
            />
          </Card>
          <div className="grid gap-4 md:grid-cols-2">
            {d.range.days > 1 && <CumulativeChart data={d.daily} since={d.range.since} days={d.range.days} />}
            <WeekdayChart rows={d.weekdays ?? []} />
          </div>
          <Card title={tr("Entonnoir des commandes")}>
            <BarList
              rows={[
                { label: tr("Passées"), value: d.funnel.placed, display: String(d.funnel.placed) },
                { label: tr("Confirmées"), value: d.funnel.confirmed, display: String(d.funnel.confirmed) },
                { label: tr("Expédiées"), value: d.funnel.shipped, display: String(d.funnel.shipped) },
                { label: tr("Livrées"), value: d.funnel.delivered, display: String(d.funnel.delivered) },
                { label: tr("Retours"), value: d.funnel.returned, display: String(d.funnel.returned) },
                { label: tr("Annulées"), value: d.funnel.cancelled, display: String(d.funnel.cancelled) },
              ]}
            />
          </Card>
          <div className="grid gap-4 md:grid-cols-[1fr_1.4fr]">
            <Card title={tr("Top wilayas")}>
              <BarList
                rows={[...d.wilayas]
                  .sort((a, b) => b.orders - a.orders)
                  .slice(0, 8)
                  .map((w) => ({ label: `${w.code} - ${w.name}`, value: w.orders, display: String(w.orders), sub: da(w.revenue) }))}
              />
            </Card>
            <Card title={tr("Wilayas")}>
              <WilayaTable rows={d.wilayas} />
            </Card>
          </div>
          <div className="grid gap-4 md:grid-cols-2">
            <Card title={tr("Pourquoi les retours ?")}>
              <BarList rows={returnReasons.map((r) => ({ label: REASON_LABEL(r.reason), value: r.n, display: String(r.n) }))} />
            </Card>
            <Card title={tr("Pourquoi les annulations ?")}>
              <BarList rows={cancelReasons.map((r) => ({ label: REASON_LABEL(r.reason), value: r.n, display: String(r.n) }))} />
            </Card>
          </div>
          <Card title={tr("Livraison")}>
            {dl && (
              <>
                <div className="grid grid-cols-2 gap-3">
                  <Stat
                    label={tr("Préparation (confirmée → expédiée)")}
                    value={dl.prepHoursMedian == null ? "—" : `${dl.prepHoursMedian} h`}
                    hint={dl.prepHoursMedian == null ? tr("pas assez de données ({0}/{1})", { 0: dl.prepSample, 1: dl.minSample }) : tr("médiane sur {0} colis", { 0: dl.prepSample })}
                  />
                  <Stat
                    label={tr("Transport (expédiée → livrée)")}
                    value={dl.shipDaysMedian == null ? "—" : `${dl.shipDaysMedian} j`}
                    hint={dl.shipDaysMedian == null ? tr("pas assez de données ({0}/{1})", { 0: dl.shipSample, 1: dl.minSample }) : tr("médiane sur {0} colis", { 0: dl.shipSample })}
                  />
                </div>
                <ul className="mt-4 divide-y divide-line text-sm">
                  {dl.byType.map((t) => (
                    <li key={t.type} className="flex flex-wrap items-center justify-between gap-2 py-2">
                      <span className="font-medium">{t.type === "bureau" ? tr("🏢 Bureau (stop-desk)") : tr("🏠 Domicile")}</span>
                      <span className="text-ink-soft">
                        {t.shipped} {tr("expédiée(s) ·")} {t.delivered} {tr("livrée(s) ·")} {t.returned} {tr("retour(s) · taux")} <b className="text-ink">{pct(t.deliveryRate)}</b>
                        {t.avg_days != null ? tr(" · {0} j en moyenne", { 0: t.avg_days }) : ""}
                      </span>
                    </li>
                  ))}
                </ul>
                <p className="mt-2 text-xs text-ink-soft">
                  {tr("Durées calculées à partir des changements de statut (Expédiée, Livrée) ; elles ne s'affichent qu'à partir de")} {dl.minSample} {tr("colis pour rester fiables.")}
                </p>
              </>
            )}
          </Card>
          <div className="grid gap-4 md:grid-cols-2">
            <Card title={tr("Produits les plus vendus")}>
              <BarList rows={d.topProducts.map((p) => ({ label: p.name_fr, value: p.units, display: `${p.units} pcs`, sub: da(p.revenue) }))} />
            </Card>
            <Card title={tr("Canaux")}>
              <BarList rows={d.channels.map((c) => ({ label: tr(CHANNEL_LABEL[c.channel]) ?? c.channel, value: c.revenue, display: da(c.revenue), sub: `${c.orders} cmd` }))} />
            </Card>
            <Card title={tr("Heures des commandes (Algérie)")}>
              <HoursChart hours={d.hours} />
            </Card>
          </div>
        </>
      )}
    </div>
  );
}
