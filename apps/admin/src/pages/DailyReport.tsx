/**
 * Statistiques → Rapport du jour: one day at a glance for the manager (same numbers as the
 * evening Telegram summary), with what still needs doing now.
 */
import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { useState } from "react";
import { api } from "../api";
import { tr } from "../i18n";
import { da } from "../lib/format";
import { Card, ErrorState, ListSkeleton } from "../ui";

interface DailyReport {
  day: string;
  orders: number;
  revenue: number;
  confirmed: number;
  cancelled: number;
  shipped: number;
  delivered: number;
  returned: number;
  profit: number | null;
  profitMissingCost: boolean;
  confirmRate: number | null;
  avgConfirmMinutes: number | null;
  topProduct: { id: number; name: string; units: number } | null;
  topWilaya: { code: number; name: string; orders: number } | null;
  pending: number;
  late: number;
  previous: { orders: number; revenue: number };
}

const today = () => new Date(Date.now() + 3600_000).toISOString().slice(0, 10);
const shift = (day: string, n: number) => new Date(Date.parse(`${day}T12:00:00Z`) + n * 86400_000).toISOString().slice(0, 10);

function Delta({ now, before }: { now: number; before: number }) {
  if (!before) return null;
  const d = Math.round(((now - before) / before) * 100);
  return <span className={`ms-1 text-xs font-semibold ${d >= 0 ? "text-emerald-700" : "text-red-700"}`}>{d >= 0 ? "▲" : "▼"} {Math.abs(d)} %</span>;
}

export function DailyReportCard() {
  const [day, setDay] = useState(today);
  const q = useQuery({ queryKey: ["report-daily", day], queryFn: () => api<DailyReport>(`/reports/daily?day=${day}`), placeholderData: (p) => p });
  const r = q.data;
  const isToday = day === today();
  const label = new Date(`${day}T12:00:00Z`).toLocaleDateString(document.documentElement.lang === "ar" ? "ar-DZ" : "fr-FR", { weekday: "long", day: "numeric", month: "long" });
  const tile = (title: string, value: React.ReactNode, hint?: React.ReactNode, tone = "") => (
    <div className={`rounded-xl border border-line p-3 ${tone}`}>
      <p className="text-xs text-ink-soft">{title}</p>
      <p className="mt-0.5 text-xl font-semibold tabular-nums">{value}</p>
      {hint ? <p className="mt-0.5 text-xs text-ink-soft">{hint}</p> : null}
    </div>
  );
  return (
    <Card
      title={tr("📊 Rapport du jour")}
      actions={
        <div className="flex items-center gap-1">
          <button type="button" aria-label={tr("Jour précédent")} onClick={() => setDay((d) => shift(d, -1))} className="grid size-10 place-items-center rounded-lg border border-line"><span dir="ltr">‹</span></button>
          <input type="date" value={day} max={today()} onChange={(e) => e.target.value && setDay(e.target.value)} className="h-10 rounded-lg border border-line bg-surface px-2 text-sm" aria-label={tr("Jour")} />
          <button type="button" aria-label={tr("Jour suivant")} disabled={isToday} onClick={() => setDay((d) => shift(d, 1))} className="grid size-10 place-items-center rounded-lg border border-line disabled:opacity-40"><span dir="ltr">›</span></button>
        </div>
      }
    >
      <p className="-mt-1 mb-3 text-sm capitalize text-ink-soft">{label}{isToday ? ` · ${tr("en cours")}` : ""}</p>
      {q.error ? (
        <ErrorState error={q.error} onRetry={q.refetch} />
      ) : !r ? (
        <ListSkeleton rows={2} />
      ) : (
        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
            {tile(tr("Commandes"), <>{r.orders}<Delta now={r.orders} before={r.previous.orders} /></>, tr("veille : {0}", { 0: r.previous.orders }))}
            {tile(tr("Chiffre d'affaires"), <>{da(r.revenue)}<Delta now={r.revenue} before={r.previous.revenue} /></>, tr("hors annulées"))}
            {r.profit != null
              ? tile(tr("Bénéfice estimé"), da(r.profit), r.profitMissingCost ? tr("coûts incomplets") : r.revenue ? tr("marge {0} %", { 0: Math.round((r.profit / r.revenue) * 100) }) : undefined, r.profit < 0 ? "bg-red-50" : "bg-emerald-50/60")
              : tile(tr("Taux de confirmation"), r.confirmRate != null ? `${r.confirmRate} %` : "—")}
            {tile(tr("Temps moyen de confirmation"), r.avgConfirmMinutes != null ? `${r.avgConfirmMinutes} ${tr("min")}` : "—")}
          </div>
          <div className="grid grid-cols-3 gap-2 md:grid-cols-6">
            {tile(tr("✅ Confirmées"), r.confirmed)}
            {tile(tr("❌ Annulées"), r.cancelled)}
            {tile(tr("🚚 Expédiées"), r.shipped)}
            {tile(tr("🎉 Livrées"), r.delivered)}
            {tile(tr("↩️ Retours"), r.returned)}
            {tile(tr("⏳ À confirmer"), r.pending, tr("maintenant"), r.pending ? "bg-amber-50" : "")}
          </div>
          <div className="grid gap-2 sm:grid-cols-3">
            <div className="rounded-xl bg-ivory-deep p-3 text-sm">
              <p className="text-xs text-ink-soft">{tr("🏆 Produit du jour")}</p>
              <p className="mt-0.5 font-semibold">{r.topProduct ? `${r.topProduct.name} · ${r.topProduct.units}` : "—"}</p>
            </div>
            <div className="rounded-xl bg-ivory-deep p-3 text-sm">
              <p className="text-xs text-ink-soft">{tr("📍 Wilaya du jour")}</p>
              <p className="mt-0.5 font-semibold">{r.topWilaya ? `${r.topWilaya.code} · ${r.topWilaya.name} · ${r.topWilaya.orders}` : "—"}</p>
            </div>
            <Link
              to="/commandes"
              search={{ attention: "late" } as never}
              className={`rounded-xl p-3 text-sm ${r.late ? "bg-red-50 text-red-900" : "bg-ivory-deep"}`}
            >
              <p className="text-xs opacity-80">{tr("⏰ En retard maintenant")}</p>
              <p className="mt-0.5 font-semibold">{r.late ? tr("{0} commande(s) à traiter →", { 0: r.late }) : tr("Aucune 🌸")}</p>
            </Link>
          </div>
        </div>
      )}
    </Card>
  );
}
