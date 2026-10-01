import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { api } from "../api";
import { ago, da } from "../lib/format";
import { useMe } from "../Shell";
import { Card, ErrorState, ListSkeleton, Stat, StatusBadge } from "../ui";

interface DashboardData {
  kpis: { ordersToday: number; revenueToday: number; revenue7: number; revenue30: number; orders7: number; cancelledToday: number; confirmRate7: number | null; avgBasket30: number | null };
  pipeline: Record<string, number>;
  lowStock: { id: number; sku: string; name_fr: string; available: number }[];
  recent: { id: number; public_code: string; status: string; name: string; total: number; created_at: number; wilaya: string }[];
  pendingReviews: number;
  newMessages: number;
  callbacksDue: number;
  telegramBacklog: number;
}

export function Dashboard() {
  const me = useMe();
  const q = useQuery({ queryKey: ["dashboard"], queryFn: () => api<DashboardData>("/dashboard"), refetchInterval: 30_000 });
  const firstName = me.data?.name.split(" ")[0] ?? "";
  const d = q.data;
  const hour = new Date().getHours();

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-2xl font-semibold">{hour < 18 ? "Bonjour" : "Bonsoir"} {firstName} 🌸</h1>
        <p className="text-sm text-ink-soft">Voici l'activité de la boutique.</p>
      </div>

      {q.error ? (
        <ErrorState error={q.error} onRetry={q.refetch} />
      ) : !d ? (
        <ListSkeleton rows={4} />
      ) : (
        <>
          {(d.pipeline.nouvelle ?? 0) + (d.pipeline.injoignable ?? 0) > 0 && (
            <Link to="/commandes" search={{ status: "a_confirmer" }} className="flex items-center justify-between rounded-2xl bg-plum-600 p-4 text-ivory shadow-sm">
              <span>
                <span className="block text-2xl font-semibold">{(d.pipeline.nouvelle ?? 0) + (d.pipeline.injoignable ?? 0)}</span>
                <span className="text-sm text-ivory/80">commande(s) à confirmer{d.callbacksDue ? ` · ${d.callbacksDue} à rappeler` : ""}</span>
              </span>
              <span className="text-2xl">→</span>
            </Link>
          )}

          <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
            <Stat label="Commandes aujourd'hui" value={d.kpis.ordersToday} hint={`${d.kpis.orders7} sur 7 j${d.kpis.cancelledToday ? ` · ${d.kpis.cancelledToday} annulée(s) non comptée(s)` : ""}`} />
            <Stat label="CA commandé aujourd'hui" value={da(d.kpis.revenueToday)} hint={`${da(d.kpis.revenue7)} sur 7 j`} />
            <Stat label="Taux de confirmation" value={d.kpis.confirmRate7 == null ? "—" : `${d.kpis.confirmRate7} %`} hint="confirmées ÷ (confirmées + annulées), 7 j" />
            <Stat label="Panier moyen" value={da(d.kpis.avgBasket30)} hint="30 derniers jours" />
          </div>

          <div className="grid gap-4 md:grid-cols-[1.4fr_1fr]">
            <Card title="Dernières commandes" actions={<Link to="/commandes" className="text-sm font-semibold text-plum-600">Tout voir</Link>} padded={false}>
              {d.recent.length === 0 ? (
                <p className="px-4 pb-4 text-sm text-ink-soft">Aucune commande pour le moment. Passez une commande test sur la boutique !</p>
              ) : (
                <ul className="divide-y divide-line">
                  {d.recent.map((o) => (
                    <li key={o.id}>
                      <Link to="/commandes" search={{ o: o.id }} className="flex items-center justify-between gap-3 px-4 py-3 hover:bg-rose-100/40">
                        <span className="min-w-0">
                          <span className="block truncate text-sm font-medium">{o.name} · {o.wilaya}</span>
                          <span className="text-xs text-ink-soft">{o.public_code} · {ago(o.created_at)}</span>
                        </span>
                        <span className="flex flex-col items-end gap-1">
                          <span className="text-sm font-semibold tabular-nums">{da(o.total)}</span>
                          <StatusBadge status={o.status} />
                        </span>
                      </Link>
                    </li>
                  ))}
                </ul>
              )}
            </Card>

            <div className="space-y-4">
              <Card title="En cours">
                <ul className="grid grid-cols-2 gap-2 text-sm">
                  {[
                    ["confirmee", "Confirmées"],
                    ["en_preparation", "En préparation"],
                    ["expediee", "Expédiées"],
                    ["en_livraison", "En livraison"],
                    ["retour", "Retours"],
                  ].map(([k, label]) => (
                    <li key={k} className="flex justify-between rounded-xl bg-ivory-deep px-3 py-2">
                      <span>{label}</span>
                      <b className="tabular-nums">{d.pipeline[k!] ?? 0}</b>
                    </li>
                  ))}
                </ul>
              </Card>
              <Card title="À traiter">
                <ul className="space-y-2 text-sm">
                  <li><Link to="/avis" className="flex justify-between"><span>Avis à valider</span><b>{d.pendingReviews}</b></Link></li>
                  <li><Link to="/contact" className="flex justify-between"><span>Nouveaux messages</span><b>{d.newMessages}</b></Link></li>
                  <li><Link to="/erreurs" className="flex justify-between"><span>Messages Telegram en attente</span><b className={d.telegramBacklog ? "text-amber-700" : ""}>{d.telegramBacklog}</b></Link></li>
                </ul>
              </Card>
              <Card title="Stock bas" actions={<Link to="/stock" className="text-sm font-semibold text-plum-600">Stock</Link>}>
                {d.lowStock.length === 0 ? (
                  <p className="text-sm text-ink-soft">Tout va bien ✓</p>
                ) : (
                  <ul className="space-y-1.5 text-sm">
                    {d.lowStock.map((v) => (
                      <li key={v.id} className="flex justify-between gap-2">
                        <span className="truncate">{v.name_fr} <span className="text-ink-soft">{v.sku}</span></span>
                        <b className={v.available <= 0 ? "text-red-700" : "text-amber-700"}>{v.available}</b>
                      </li>
                    ))}
                  </ul>
                )}
              </Card>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
