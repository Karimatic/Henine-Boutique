import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { api } from "../api";
import { OUTCOME_REASON_LABEL, type OutcomeReason } from "@henine/shared";
import { CHANNEL_LABEL, da } from "../lib/format";
import { Card, ErrorState, ListSkeleton, PageHeader, Pills, Stat, TextField } from "../ui";

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
  topProducts: { product_id: number; name_fr: string; units: number; revenue: number }[];
}

const pct = (v: number | null) => (v == null ? "—" : `${v} %`);

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
    <Card title="Évolution" actions={<Pills value={metric} onChange={setMetric} options={[{ value: "orders", label: "Commandes" }, { value: "revenue", label: "CA" }]} />}>
      <svg viewBox={`0 0 ${W} ${H}`} className="h-48 w-full" role="img" aria-label={`${metric === "orders" ? "Commandes" : "Chiffre d'affaires"} par jour`}>
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
  if (!rows.length) return <p className="text-sm text-ink-soft">Pas encore de données.</p>;
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
      <div className="flex h-24 items-end gap-0.5" role="img" aria-label="Commandes par heure">
        {values.map((v, h) => (
          <div key={h} className="flex-1 rounded-t" style={{ height: `${Math.max(2, (v / max) * 100)}%`, background: h === best && v > 0 ? "var(--color-plum-600)" : "var(--color-rose-300)" }} title={`${h}h : ${v} commande(s)`} />
        ))}
      </div>
      <div className="mt-1 flex justify-between text-[10px] text-ink-soft"><span>0h</span><span>6h</span><span>12h</span><span>18h</span><span>23h</span></div>
      {Math.max(...values) > 0 && <p className="mt-2 text-sm">Heure la plus active : <b>{best}h–{best + 1}h</b> (idéal pour publier sur Instagram).</p>}
    </div>
  );
}

const RANGES = [
  { value: "today", label: "Aujourd'hui" },
  { value: "7", label: "7 jours" },
  { value: "30", label: "30 jours" },
  { value: "90", label: "90 jours" },
  { value: "365", label: "1 an" },
  { value: "custom", label: "Période…" },
];

const REASON_LABEL = (r: string) => (r === "unknown" ? "Non précisé" : (OUTCOME_REASON_LABEL[r as OutcomeReason] ?? r));

type WilayaSort = "orders" | "revenue" | "deliveryRate" | "returned";

function WilayaTable({ rows }: { rows: StatsData["wilayas"] }) {
  const [sort, setSort] = useState<WilayaSort>("orders");
  const [all, setAll] = useState(false);
  const sorted = [...rows].sort((a, b) => (sort === "deliveryRate" ? (b.deliveryRate ?? -1) - (a.deliveryRate ?? -1) : (b[sort] ?? 0) - (a[sort] ?? 0)));
  const shown = all ? sorted : sorted.slice(0, 12);
  if (!rows.length) return <p className="text-sm text-ink-soft">Pas encore de commandes sur la période.</p>;
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
              <th className="px-2 py-2 text-start">Wilaya</th>
              {th("orders", "Commandes")}
              <th className="px-2 py-2 text-end">Livrées</th>
              <th className="px-2 py-2 text-end">Annulées</th>
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
          {all ? "Voir moins" : `Voir les ${rows.length} wilayas`}
        </button>
      )}
      <p className="mt-2 text-xs text-ink-soft">Taux de livraison = livrées ÷ (livrées + retours), sur les colis dont l'issue est connue.</p>
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
        group="Analyse"
        title="Statistiques"
        subtitle="Commandes passées sur la période. Les annulées ne comptent jamais dans le chiffre d'affaires."
        actions={<a href={`/api/admin/orders.csv?days=${csvDays}`} className="inline-flex h-9 items-center rounded-full border border-line bg-white px-3.5 text-sm font-semibold">Export CSV</a>}
      />
      <Pills value={range} onChange={setRange} options={RANGES} />
      {range === "custom" && (
        <div className="flex flex-wrap items-end gap-3">
          <TextField label="Du" type="date" value={from} max={to} onChange={(e) => setFrom(e.target.value)} />
          <TextField label="Au" type="date" value={to} min={from} max={today} onChange={(e) => setTo(e.target.value)} />
        </div>
      )}
      {q.error ? <ErrorState error={q.error} onRetry={q.refetch} /> : !d ? <ListSkeleton rows={4} /> : (
        <>
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
            <Stat label="Commandes" value={d.totals.orders} hint={`${d.totals.placed} passées · ${d.totals.customers} clientes`} />
            <Stat label="Chiffre d'affaires" value={da(d.totals.revenue)} hint="commandé, hors annulées" />
            <Stat label="Encaissé (livrées)" value={da(d.totals.deliveredRevenue)} tone="good" />
            <Stat label="Panier moyen" value={da(d.totals.avgBasket)} />
            <Stat label="Livrées" value={d.totals.delivered} tone="good" hint={`taux ${pct(d.totals.deliveryRate)}`} />
            <Stat label="En attente" value={d.totals.pending} hint={`+ ${d.totals.inProgress} en cours`} tone={d.totals.pending ? "warn" : undefined} />
            <Stat label="Annulées" value={d.totals.cancelled} hint={`confirmation ${pct(d.totals.confirmRate)}`} />
            <Stat label="Retours" value={d.totals.returned} hint={`taux ${pct(d.totals.returnRate)}`} tone={(d.totals.returnRate ?? 0) > 20 ? "warn" : undefined} />
          </div>
          {d.range.days > 1 && <DailyChart data={d.daily} since={d.range.since} days={d.range.days} />}
          <Card title="Entonnoir des commandes">
            <BarList
              rows={[
                { label: "Passées", value: d.funnel.placed, display: String(d.funnel.placed) },
                { label: "Confirmées", value: d.funnel.confirmed, display: String(d.funnel.confirmed) },
                { label: "Expédiées", value: d.funnel.shipped, display: String(d.funnel.shipped) },
                { label: "Livrées", value: d.funnel.delivered, display: String(d.funnel.delivered) },
                { label: "Retours", value: d.funnel.returned, display: String(d.funnel.returned) },
                { label: "Annulées", value: d.funnel.cancelled, display: String(d.funnel.cancelled) },
              ]}
            />
          </Card>
          <Card title="Wilayas">
            <WilayaTable rows={d.wilayas} />
          </Card>
          <div className="grid gap-4 md:grid-cols-2">
            <Card title="Pourquoi les retours ?">
              <BarList rows={returnReasons.map((r) => ({ label: REASON_LABEL(r.reason), value: r.n, display: String(r.n) }))} />
            </Card>
            <Card title="Pourquoi les annulations ?">
              <BarList rows={cancelReasons.map((r) => ({ label: REASON_LABEL(r.reason), value: r.n, display: String(r.n) }))} />
            </Card>
          </div>
          <Card title="Livraison">
            {dl && (
              <>
                <div className="grid grid-cols-2 gap-3">
                  <Stat
                    label="Préparation (confirmée → expédiée)"
                    value={dl.prepHoursMedian == null ? "—" : `${dl.prepHoursMedian} h`}
                    hint={dl.prepHoursMedian == null ? `pas assez de données (${dl.prepSample}/${dl.minSample})` : `médiane sur ${dl.prepSample} colis`}
                  />
                  <Stat
                    label="Transport (expédiée → livrée)"
                    value={dl.shipDaysMedian == null ? "—" : `${dl.shipDaysMedian} j`}
                    hint={dl.shipDaysMedian == null ? `pas assez de données (${dl.shipSample}/${dl.minSample})` : `médiane sur ${dl.shipSample} colis`}
                  />
                </div>
                <ul className="mt-4 divide-y divide-line text-sm">
                  {dl.byType.map((t) => (
                    <li key={t.type} className="flex flex-wrap items-center justify-between gap-2 py-2">
                      <span className="font-medium">{t.type === "bureau" ? "🏢 Bureau (stop-desk)" : "🏠 Domicile"}</span>
                      <span className="text-ink-soft">
                        {t.shipped} expédiée(s) · {t.delivered} livrée(s) · {t.returned} retour(s) · taux <b className="text-ink">{pct(t.deliveryRate)}</b>
                        {t.avg_days != null ? ` · ${t.avg_days} j en moyenne` : ""}
                      </span>
                    </li>
                  ))}
                </ul>
                <p className="mt-2 text-xs text-ink-soft">
                  Durées calculées à partir des changements de statut (Expédiée, Livrée) ; elles ne s'affichent qu'à partir de {dl.minSample} colis pour rester fiables.
                </p>
              </>
            )}
          </Card>
          <div className="grid gap-4 md:grid-cols-2">
            <Card title="Produits les plus vendus">
              <BarList rows={d.topProducts.map((p) => ({ label: p.name_fr, value: p.units, display: `${p.units} pcs`, sub: da(p.revenue) }))} />
            </Card>
            <Card title="Canaux">
              <BarList rows={d.channels.map((c) => ({ label: CHANNEL_LABEL[c.channel] ?? c.channel, value: c.revenue, display: da(c.revenue), sub: `${c.orders} cmd` }))} />
            </Card>
            <Card title="Heures des commandes (Algérie)">
              <HoursChart hours={d.hours} />
            </Card>
          </div>
        </>
      )}
    </div>
  );
}
