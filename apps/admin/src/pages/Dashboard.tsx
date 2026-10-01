import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { api } from "../api";
import { ago, da } from "../lib/format";
import { useCan, useMe } from "../Shell";
import { Card, ErrorState, ListSkeleton, Stat, StatusBadge } from "../ui";

interface StockLine {
  id: number;
  product_id: number;
  name_fr: string;
  options: string;
  available: number;
  waiting: number;
}

interface DashboardData {
  kpis: { ordersToday: number; revenueToday: number; revenue7: number; revenue30: number; orders7: number; cancelledToday: number; confirmRate7: number | null; avgBasket30: number | null };
  pipeline: Record<string, number>;
  attention: {
    to_confirm: number; callbacks: number; high_risk: number; stale_confirmed: number; stale_preparing: number; stale_shipped: number; returns: number;
    abandoned: number; abandonedValue: number; restocked: number; outOfStock: number; lowStock: number; pendingReviews: number; newMessages: number; telegramBacklog: number;
  };
  lowStock: StockLine[];
  restocked: StockLine[];
  recent: { id: number; public_code: string; status: string; name: string; total: number; created_at: number; wilaya: string }[];
}

type Todo = { key: string; icon: string; label: string; hint?: string; count: number; to: string; search?: Record<string, string>; urgent?: boolean; perm: string };

/** Every line is a shortcut to the exact list that needs work, most urgent first. */
function todos(a: DashboardData["attention"]): Todo[] {
  return [
    { key: "callbacks", icon: "📞", label: "À rappeler maintenant", hint: "injoignables dont l'heure de rappel est passée", count: a.callbacks, to: "/commandes", search: { attention: "callbacks" }, urgent: true, perm: "orders.view" },
    { key: "to_confirm", icon: "🆕", label: "Commandes à confirmer", hint: "nouvelles + injoignables", count: a.to_confirm, to: "/commandes", search: { attention: "to_confirm" }, urgent: true, perm: "orders.view" },
    { key: "high_risk", icon: "🔴", label: "Risque élevé à vérifier", hint: "historique de retours / annulations : appelez avant de confirmer", count: a.high_risk, to: "/commandes", search: { attention: "high_risk" }, urgent: true, perm: "orders.view" },
    { key: "stale_confirmed", icon: "⏰", label: "Confirmées depuis plus de 24 h", hint: "à mettre en préparation", count: a.stale_confirmed, to: "/commandes", search: { attention: "stale_confirmed" }, perm: "orders.view" },
    { key: "stale_preparing", icon: "📦", label: "En préparation depuis plus de 48 h", hint: "à expédier", count: a.stale_preparing, to: "/commandes", search: { attention: "stale_preparing" }, perm: "orders.view" },
    { key: "stale_shipped", icon: "🚚", label: "Expédiées depuis plus de 7 jours", hint: "vérifier le suivi ZR Express", count: a.stale_shipped, to: "/commandes", search: { attention: "stale_shipped" }, perm: "orders.view" },
    { key: "returns", icon: "↩️", label: "Retours à réceptionner", hint: "remettre en stock à l'arrivée", count: a.returns, to: "/commandes", search: { attention: "returns" }, perm: "orders.view" },
    { key: "abandoned", icon: "🛒", label: "Paniers abandonnés (24 h)", hint: a.abandonedValue ? `${da(a.abandonedValue)} non commandés` : undefined, count: a.abandoned, to: "/paniers", perm: "carts.view" },
    { key: "restocked", icon: "🔔", label: "De retour en stock : clientes à prévenir", count: a.restocked, to: "/notifier", perm: "marketing.edit" },
    { key: "out", icon: "⛔", label: "Variantes en rupture", hint: a.lowStock ? `+ ${a.lowStock} en stock bas` : undefined, count: a.outOfStock, to: "/stock", search: { filter: "out" }, perm: "stock.view" },
    { key: "reviews", icon: "⭐", label: "Avis à valider", count: a.pendingReviews, to: "/avis", perm: "reviews.moderate" },
    { key: "messages", icon: "✉️", label: "Nouveaux messages", count: a.newMessages, to: "/contact", perm: "contact.view" },
    { key: "telegram", icon: "📱", label: "Messages Telegram en échec", count: a.telegramBacklog, to: "/erreurs", perm: "errors.view" },
  ];
}

const PIPELINE: [string, string][] = [
  ["nouvelle", "Nouvelles"],
  ["injoignable", "Injoignables"],
  ["confirmee", "Confirmées"],
  ["en_preparation", "En préparation"],
  ["expediee", "Expédiées"],
  ["en_livraison", "En livraison"],
  ["retour", "Retours"],
];

export function Dashboard() {
  const me = useMe();
  const can = useCan();
  const q = useQuery({ queryKey: ["dashboard"], queryFn: () => api<DashboardData>("/dashboard"), refetchInterval: 30_000 });
  const firstName = me.data?.name.split(" ")[0] ?? "";
  const d = q.data;
  const hour = new Date().getHours();
  const list = d ? todos(d.attention).filter((t) => t.count > 0 && can(t.perm as Parameters<typeof can>[0])) : [];

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-2xl font-semibold">{hour < 18 ? "Bonjour" : "Bonsoir"} {firstName} 🌸</h1>
        <p className="text-sm text-ink-soft">Voici ce qui demande votre attention.</p>
      </div>

      {q.error ? (
        <ErrorState error={q.error} onRetry={q.refetch} />
      ) : !d ? (
        <ListSkeleton rows={4} />
      ) : (
        <>
          <Card title="À faire maintenant" padded={false}>
            {list.length === 0 ? (
              <p className="px-4 pb-4 text-sm text-emerald-700">Tout est à jour ✓ Rien d'urgent pour le moment.</p>
            ) : (
              <ul className="divide-y divide-line">
                {list.map((t) => (
                  <li key={t.key}>
                    <Link to={t.to} search={t.search ?? {}} className={`flex items-center gap-3 px-4 py-3 transition hover:bg-rose-100/40 ${t.urgent ? "bg-rose-100/30" : ""}`}>
                      <span className="text-xl" aria-hidden="true">{t.icon}</span>
                      <span className="min-w-0 flex-1">
                        <span className="block text-sm font-semibold">{t.label}</span>
                        {t.hint && <span className="block truncate text-xs text-ink-soft">{t.hint}</span>}
                      </span>
                      <span className={`grid min-w-9 place-items-center rounded-full px-2.5 py-1 text-sm font-bold tabular-nums ${t.urgent ? "bg-plum-600 text-ivory" : "bg-ivory-deep"}`}>{t.count}</span>
                      <span className="text-ink-soft" aria-hidden="true">›</span>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </Card>

          <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
            <Stat label="Commandes aujourd'hui" value={d.kpis.ordersToday} hint={`${d.kpis.orders7} sur 7 j${d.kpis.cancelledToday ? ` · ${d.kpis.cancelledToday} annulée(s) non comptée(s)` : ""}`} />
            <Stat label="CA commandé aujourd'hui" value={da(d.kpis.revenueToday)} hint={`${da(d.kpis.revenue7)} sur 7 j`} />
            <Stat label="Taux de confirmation" value={d.kpis.confirmRate7 == null ? "—" : `${d.kpis.confirmRate7} %`} hint="confirmées ÷ (confirmées + annulées), 7 j" />
            <Stat label="Panier moyen" value={da(d.kpis.avgBasket30)} hint="30 derniers jours" />
          </div>

          <Card title="Commandes en cours" actions={<Link to="/statistiques" className="text-sm font-semibold text-plum-600">Statistiques</Link>}>
            <ul className="grid grid-cols-2 gap-2 text-sm sm:grid-cols-4 lg:grid-cols-7">
              {PIPELINE.map(([k, label]) => (
                <li key={k}>
                  <Link to="/commandes" search={{ status: k }} className="flex flex-col rounded-xl bg-ivory-deep px-3 py-2 hover:bg-rose-100/60">
                    <b className="text-lg tabular-nums">{d.pipeline[k] ?? 0}</b>
                    <span className="text-xs text-ink-soft">{label}</span>
                  </Link>
                </li>
              ))}
            </ul>
          </Card>

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
              {d.restocked.length > 0 && (
                <Card title="🔔 De retour en stock" actions={<Link to="/notifier" className="text-sm font-semibold text-plum-600">Prévenir</Link>}>
                  <ul className="space-y-1.5 text-sm">
                    {d.restocked.map((v) => (
                      <li key={v.id} className="flex justify-between gap-2">
                        <span className="truncate">{v.name_fr} <span className="text-ink-soft">{v.options}</span></span>
                        <b className="shrink-0 text-emerald-700">{v.waiting} cliente(s)</b>
                      </li>
                    ))}
                  </ul>
                </Card>
              )}
              <Card title="Stock à surveiller" actions={<Link to="/stock" className="text-sm font-semibold text-plum-600">Stock</Link>}>
                {d.lowStock.length === 0 ? (
                  <p className="text-sm text-ink-soft">Tout va bien ✓</p>
                ) : (
                  <ul className="space-y-2 text-sm">
                    {d.lowStock.map((v) => (
                      <li key={v.id} className="flex items-start justify-between gap-2">
                        <span className="min-w-0">
                          <span className="block truncate">{v.available <= 0 ? "⛔" : "⚠️"} {v.name_fr}</span>
                          <span className="block text-xs text-ink-soft">
                            {v.options || "Article unique"}
                            {v.waiting ? ` · 🔔 ${v.waiting} cliente(s) attendent` : ""}
                          </span>
                        </span>
                        <b className={`shrink-0 ${v.available <= 0 ? "text-red-700" : "text-amber-700"}`}>{v.available <= 0 ? "Épuisé" : `${v.available} restant${v.available > 1 ? "s" : ""}`}</b>
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
