import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { api } from "../api";
import { CHANNEL_LABEL, da } from "../lib/format";
import { Card, ErrorState, ListSkeleton, PageHeader, Pills, Stat } from "../ui";

interface StatsData {
  days: number;
  totals: { orders: number; revenue: number; avgBasket: number; customers: number; repeatRate: number; confirmRate: number | null; deliveryRate: number | null; returnRate: number | null };
  funnel: { placed: number; confirmed: number; shipped: number; delivered: number; returned: number; cancelled: number };
  daily: { date: string; orders: number; revenue: number }[];
  wilayas: { code: number; name: string; orders: number; revenue: number; returns: number }[];
  channels: { channel: string; orders: number; revenue: number }[];
  hours: { hour: string; orders: number }[];
  topProducts: { product_id: number; name_fr: string; units: number; revenue: number }[];
}

const pct = (v: number | null) => (v == null ? "—" : `${v} %`);

/** Daily columns: one series, labelled peaks, dates on the axis. */
function DailyChart({ data, days }: { data: StatsData["daily"]; days: number }) {
  const [metric, setMetric] = useState<"orders" | "revenue">("orders");
  // fill missing days with zero so the time axis is honest
  const byDate = new Map(data.map((d) => [d.date, d]));
  const series: { date: string; value: number }[] = [];
  for (let i = days - 1; i >= 0; i--) {
    const date = new Date(Date.now() + 3600_000 - i * 86400_000).toISOString().slice(0, 10);
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

export function StatsPage() {
  const [days, setDays] = useState("30");
  const q = useQuery({ queryKey: ["stats", days], queryFn: () => api<StatsData>(`/stats?days=${days}`) });
  const d = q.data;
  return (
    <div className="space-y-4">
      <PageHeader group="Analyse" title="Statistiques" subtitle="Commandes passées sur la période (hors annulées)." actions={<a href={`/api/admin/orders.csv?days=${days}`} className="inline-flex h-9 items-center rounded-full border border-line bg-white px-3.5 text-sm font-semibold">Export CSV</a>} />
      <Pills value={days} onChange={setDays} options={[{ value: "7", label: "7 jours" }, { value: "30", label: "30 jours" }, { value: "90", label: "90 jours" }, { value: "365", label: "1 an" }]} />
      {q.error ? <ErrorState error={q.error} onRetry={q.refetch} /> : !d ? <ListSkeleton rows={4} /> : (
        <>
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
            <Stat label="Chiffre d'affaires" value={da(d.totals.revenue)} />
            <Stat label="Commandes" value={d.totals.orders} hint={`${d.totals.customers} clientes`} />
            <Stat label="Panier moyen" value={da(d.totals.avgBasket)} />
            <Stat label="Clientes fidèles" value={pct(d.totals.repeatRate)} hint="part des commandes" />
            <Stat label="Taux de confirmation" value={pct(d.totals.confirmRate)} tone={(d.totals.confirmRate ?? 100) < 60 ? "warn" : "good"} />
            <Stat label="Taux de livraison" value={pct(d.totals.deliveryRate)} hint="des colis expédiés" />
            <Stat label="Taux de retour" value={pct(d.totals.returnRate)} tone={(d.totals.returnRate ?? 0) > 20 ? "warn" : undefined} />
            <Stat label="Annulées" value={d.funnel.cancelled} />
          </div>
          <DailyChart data={d.daily} days={Number(days)} />
          <Card title="Entonnoir des commandes">
            <BarList
              rows={[
                { label: "Passées", value: d.funnel.placed, display: String(d.funnel.placed) },
                { label: "Confirmées", value: d.funnel.confirmed, display: String(d.funnel.confirmed) },
                { label: "Expédiées", value: d.funnel.shipped, display: String(d.funnel.shipped) },
                { label: "Livrées", value: d.funnel.delivered, display: String(d.funnel.delivered) },
                { label: "Retours", value: d.funnel.returned, display: String(d.funnel.returned) },
              ]}
            />
          </Card>
          <div className="grid gap-4 md:grid-cols-2">
            <Card title="Top wilayas">
              <BarList rows={d.wilayas.slice(0, 10).map((w) => ({ label: `${w.code} - ${w.name}`, value: w.orders, display: `${w.orders} · ${da(w.revenue)}`, sub: w.returns ? `${w.returns} retour(s)` : undefined }))} />
            </Card>
            <Card title="Produits les plus vendus">
              <BarList rows={d.topProducts.map((p) => ({ label: p.name_fr, value: p.units, display: `${p.units} pcs` , sub: da(p.revenue) }))} />
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
