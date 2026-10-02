import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import {
  BadgePercent,
  Banknote,
  ChevronDown,
  ChevronRight,
  ChevronUp,
  Globe,
  Camera,
  MessageCircle,
  Phone,
  ShoppingBag,
  Store,
  TrendingUp,
  Truck,
  Wallet,
  Zap,
  type LucideIcon,
} from "lucide-react";
import { api } from "../api";
import { Blossom } from "../brand";
import { ago, CHANNEL_LABEL, da, date } from "../lib/format";
import { useCan, useMe } from "../Shell";
import { Card, ErrorState, ListSkeleton, StatusBadge } from "../ui";

interface StockLine {
  id: number;
  product_id: number;
  name_fr: string;
  options: string;
  available: number;
  waiting: number;
}

interface Period {
  orders: number;
  revenue: number;
  confirmed: number;
  cancelled: number;
  delivered: number;
  returned: number;
  pending: number;
  discount: number;
  deliveredRevenue: number;
  confirmRate: number | null;
}

interface DashboardData {
  kpis: { ordersToday: number; revenueToday: number; cancelledToday: number };
  pipeline: Record<string, number>;
  attention: {
    to_confirm: number; callbacks: number; high_risk: number; stale_confirmed: number; stale_preparing: number; stale_shipped: number; returns: number;
    abandoned: number; abandonedValue: number; restocked: number; outOfStock: number; lowStock: number; pendingReviews: number; newMessages: number; telegramBacklog: number;
  };
  lowStock: StockLine[];
  restocked: StockLine[];
  recent: { id: number; public_code: string; status: string; name: string; total: number; created_at: number; wilaya: string }[];
  week: Period;
  prevWeek: Period;
  month: Period;
  prevMonth: Period;
  topProduct: { id: number; name: string; publishedAt: number; units: number; orders: number; revenue: number; weeks: number[]; image: string | null } | null;
  channels: { channel: string; orders: number; revenue: number }[];
  returningShare: number | null;
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

const CHANNEL_ICON: Record<string, LucideIcon> = { web: Globe, express: Zap, instagram: Camera, whatsapp: MessageCircle, boutique: Store, telephone: Phone };

/** "+18,2 %" vs the previous period; null when there is nothing to compare with. */
function change(cur: number, prev: number): { text: string; up: boolean } | null {
  if (!prev) return cur ? { text: "nouveau", up: true } : null;
  const p = ((cur - prev) / prev) * 100;
  return { text: `${p >= 0 ? "+" : ""}${p.toFixed(1).replace(".", ",")} %`, up: p >= 0 };
}

/* ───────────── Widgets (layout of the admincn dashboard) ───────────── */

function IconChip({ icon: Icon, size = "md" }: { icon: LucideIcon; size?: "md" | "lg" }) {
  return (
    <span className={`grid shrink-0 place-items-center rounded-md bg-plum-600/10 text-plum-600 ${size === "lg" ? "size-11" : "size-8"}`}>
      <Icon className={size === "lg" ? "size-5" : "size-4"} strokeWidth={1.9} />
    </span>
  );
}

function MetricCard({ icon, value, title, cur, prev, suffix = "que la semaine dernière" }: { icon: LucideIcon; value: string; title: string; cur: number; prev: number; suffix?: string }) {
  const c = change(cur, prev);
  return (
    <Card>
      <div className="flex items-center gap-2.5">
        <IconChip icon={icon} />
        <span className="text-2xl font-medium tabular-nums">{value}</span>
      </div>
      <p className="mt-4 text-base font-semibold">{title}</p>
      <p className="mt-1.5 text-sm">
        {c ? (
          <>
            <span className={c.up ? "text-emerald-700" : "text-red-700"}>{c.text}</span> <span className="text-ink-soft">{suffix}</span>
          </>
        ) : (
          <span className="text-ink-soft">pas encore de comparaison</span>
        )}
      </p>
    </Card>
  );
}

/** Tiny column chart; `faded` draws the light version used for the second line of a widget. */
function MiniBars({ values, faded = false }: { values: number[]; faded?: boolean }) {
  const max = Math.max(1, ...values);
  return (
    <svg width="72" height="44" viewBox="0 0 72 44" aria-hidden="true" className="shrink-0">
      {values.map((v, i) => {
        const h = Math.max(3, (v / max) * 42);
        return <rect key={i} x={i * 15 + 6} y={44 - h} width="9" height={h} rx="2" fill={faded ? "rgb(194 37 95 / 0.15)" : "var(--color-plum-600)"} />;
      })}
    </svg>
  );
}

function ProductInsight({ p }: { p: DashboardData["topProduct"] }) {
  return (
    <Card className="h-full">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-lg font-semibold">Produit vedette</p>
          <p className="mt-1 text-sm text-ink-soft">{p ? <>{p.name} · en ligne depuis le {date(p.publishedAt)}</> : "Aucune vente sur les 30 derniers jours."}</p>
        </div>
        {p?.image ? (
          <img src={p.image} alt="" className="h-16 w-20 shrink-0 rounded-md object-cover" />
        ) : (
          <span className="grid h-16 w-20 shrink-0 place-items-center rounded-md bg-ivory-deep">
            <Blossom size={30} />
          </span>
        )}
      </div>
      <div className="my-5 h-px bg-line" />
      <div className="space-y-4">
        <div className="flex items-center justify-between gap-2">
          <div>
            <p className="text-xs text-ink-soft">Pièces vendues (30 j)</p>
            <p className="text-2xl font-semibold tabular-nums">{p ? p.units : 0}</p>
          </div>
          <MiniBars values={p?.weeks ?? [0, 0, 0, 0]} />
        </div>
        <div className="flex items-center justify-between gap-2">
          <div>
            <p className="text-xs text-ink-soft">Commandes passées</p>
            <p className="text-2xl font-semibold tabular-nums">{p ? p.orders : 0}</p>
          </div>
          <MiniBars values={p?.weeks ?? [0, 0, 0, 0]} faded />
        </div>
      </div>
      {p && (
        <Link to="/produits/$id" params={{ id: String(p.id) }} className="mt-5 inline-flex items-center gap-1 text-sm font-semibold text-plum-600">
          Voir le produit <ChevronRight className="size-4" />
        </Link>
      )}
    </Card>
  );
}

/** Donut: delivered / in progress / returned & refused, for the orders of the last 30 days. */
function DeliveryDonut({ m }: { m: Period }) {
  const inProgress = Math.max(0, m.orders - m.delivered - m.returned);
  const parts = [
    { v: m.delivered, color: "var(--color-plum-600)", label: "Livrées" },
    { v: inProgress, color: "rgb(194 37 95 / 0.55)", label: "En cours" },
    { v: m.returned, color: "rgb(194 37 95 / 0.18)", label: "Retours" },
  ];
  const total = parts.reduce((s, p) => s + p.v, 0);
  const r = 62;
  const circ = 2 * Math.PI * r;
  let offset = 0;
  const rate = m.delivered + m.returned ? Math.round((m.delivered / (m.delivered + m.returned)) * 100) : null;
  return (
    <div className="flex h-full flex-col justify-between rounded-xl border border-line p-5">
      <p className="text-lg font-semibold">Livraisons (30 j)</p>
      <div className="relative mx-auto my-4 size-40">
        <svg viewBox="0 0 160 160" className="size-40 -rotate-90" aria-hidden="true">
          <circle cx="80" cy="80" r={r} fill="none" stroke="var(--color-ivory-deep)" strokeWidth="16" />
          {total > 0 &&
            parts.map((p) => {
              const len = (p.v / total) * circ;
              const el = <circle key={p.label} cx="80" cy="80" r={r} fill="none" stroke={p.color} strokeWidth="16" strokeDasharray={`${Math.max(0, len - 3)} ${circ}`} strokeDashoffset={-offset} />;
              offset += len;
              return el;
            })}
        </svg>
        <div className="absolute inset-0 grid place-content-center text-center">
          <span className="text-2xl font-semibold tabular-nums">{rate == null ? "—" : `${rate} %`}</span>
          <span className="text-xs text-ink-soft">réussies</span>
        </div>
      </div>
      <div className="flex items-center justify-between text-base">
        <span>Confirmées</span>
        <span className="text-xl font-semibold tabular-nums">{m.confirmRate == null ? "—" : `${m.confirmRate} %`}</span>
      </div>
    </div>
  );
}

function SalesMetrics({ month, prevMonth }: { month: Period; prevMonth: Period }) {
  const trend = change(month.revenue, prevMonth.revenue);
  const tiles: { icon: LucideIcon; title: string; value: string; hint?: string }[] = [
    { icon: TrendingUp, title: "Tendance des ventes", value: da(month.revenue), hint: trend ? `${trend.text} vs mois dernier` : undefined },
    { icon: BadgePercent, title: "Remises accordées", value: da(month.discount) },
    { icon: Wallet, title: "Encaissé (livrées)", value: da(month.deliveredRevenue) },
    { icon: ShoppingBag, title: "Commandes", value: String(month.orders) },
  ];
  return (
    <Card className="h-full">
      <div className="grid gap-6 lg:grid-cols-5">
        <div className="flex flex-col justify-between gap-6 lg:col-span-3">
          <p className="text-lg font-semibold">Ventes des 30 derniers jours</p>
          <div className="flex items-center gap-3">
            <span className="grid size-11 shrink-0 place-items-center rounded-lg bg-gradient-to-br from-rose-500 via-plum-600 to-plum-700">
              <Blossom size={26} light />
            </span>
            <div className="min-w-0">
              <p className="truncate text-xl font-medium">Henine Boutique</p>
              <p className="truncate text-sm text-ink-soft">Boumerdès · livraison 69 wilayas</p>
            </div>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            {tiles.map((t) => (
              <div key={t.title} className="flex items-center gap-3 rounded-xl border border-line px-4 py-2.5">
                <IconChip icon={t.icon} size="lg" />
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium text-ink-soft">{t.title}</p>
                  <p className="truncate text-lg font-medium tabular-nums">{t.value}</p>
                  {t.hint && <p className="truncate text-xs text-ink-soft">{t.hint}</p>}
                </div>
              </div>
            ))}
          </div>
        </div>
        <div className="lg:col-span-2">
          <DeliveryDonut m={month} />
        </div>
      </div>
    </Card>
  );
}

function Earnings({ month, prevMonth, channels }: { month: Period; prevMonth: Period; channels: DashboardData["channels"] }) {
  const c = change(month.revenue, prevMonth.revenue);
  const max = Math.max(1, ...channels.map((x) => x.revenue));
  return (
    <Card className="h-full">
      <p className="text-lg font-semibold">Chiffre d'affaires</p>
      <div className="mt-5 flex items-center gap-2">
        <span className="text-2xl font-semibold tabular-nums">{da(month.revenue)}</span>
        {c && c.text !== "nouveau" && (
          <span className={`flex items-center gap-0.5 text-sm ${c.up ? "text-emerald-700" : "text-red-700"}`}>
            {c.up ? <ChevronUp className="size-4" /> : <ChevronDown className="size-4" />}
            {c.text.replace(/^[+-]/, "")}
          </span>
        )}
      </div>
      <p className="mt-1 text-sm text-ink-soft">30 derniers jours · mois précédent : {da(prevMonth.revenue)}</p>
      <ul className="mt-6 space-y-4">
        {channels.length === 0 && <li className="text-sm text-ink-soft">Pas encore de ventes sur la période.</li>}
        {channels.slice(0, 4).map((ch) => (
          <li key={ch.channel} className="flex items-center justify-between gap-3">
            <span className="flex min-w-0 items-center gap-2.5">
              <IconChip icon={CHANNEL_ICON[ch.channel] ?? ShoppingBag} size="lg" />
              <span className="min-w-0">
                <span className="block truncate font-medium">{CHANNEL_LABEL[ch.channel] ?? ch.channel}</span>
                <span className="block text-sm text-ink-soft">{ch.orders} commande(s)</span>
              </span>
            </span>
            <span className="w-32 shrink-0 space-y-1.5 text-end sm:w-36">
              <span className="block text-sm tabular-nums">{da(ch.revenue)}</span>
              <span className="block h-1.5 overflow-hidden rounded-full bg-ivory-deep">
                <span className="block h-full rounded-full bg-plum-600" style={{ width: `${(ch.revenue / max) * 100}%` }} />
              </span>
            </span>
          </li>
        ))}
      </ul>
    </Card>
  );
}

function Loyalty({ share }: { share: number | null }) {
  const bars = 24;
  const filled = share == null ? 0 : Math.round((share * bars) / 100);
  return (
    <Card className="h-full">
      <div className="grid gap-6 md:grid-cols-[auto_1fr] md:items-end">
        <div>
          <p className="text-lg font-semibold">Clientes fidèles</p>
          <p className="mt-4 text-6xl font-medium tracking-tight tabular-nums">{share == null ? "—" : `${share} %`}</p>
        </div>
        <div>
          <p className="text-lg font-semibold">Retour des clientes</p>
          <p className="mt-2 text-sm text-ink-soft md:text-base">
            Part des commandes des 30 derniers jours passées par des clientes qui avaient déjà commandé chez Henine Boutique.
          </p>
        </div>
      </div>
      <div className="mt-6 flex h-14 items-end gap-1" aria-hidden="true">
        {Array.from({ length: bars }, (_, i) => (
          <span key={i} className={`flex-1 rounded-sm ${i < filled ? "bg-plum-600" : "bg-ivory-deep"}`} style={{ height: `${55 + ((i * 37) % 45)}%` }} />
        ))}
      </div>
    </Card>
  );
}

/* ───────────── Page ───────────── */

export function Dashboard() {
  const me = useMe();
  const can = useCan();
  const q = useQuery({ queryKey: ["dashboard"], queryFn: () => api<DashboardData>("/dashboard"), refetchInterval: 30_000 });
  const d = q.data;
  const firstName = me.data?.name.split(" ")[0] ?? "";
  const list = d ? todos(d.attention).filter((t) => t.count > 0 && can(t.perm as Parameters<typeof can>[0])) : [];

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-2">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Bonjour {firstName} 🌸</h1>
          <p className="text-sm text-ink-soft">Voici l'activité de la boutique et ce qui demande votre attention.</p>
        </div>
      </div>

      {q.error ? (
        <ErrorState error={q.error} onRetry={q.refetch} />
      ) : !d ? (
        <ListSkeleton rows={4} />
      ) : (
        <>
          <div className="grid gap-6 md:grid-cols-3">
            <MetricCard icon={ShoppingBag} value={String(d.week.orders)} title="Commandes (7 jours)" cur={d.week.orders} prev={d.prevWeek.orders} />
            <MetricCard icon={Banknote} value={da(d.week.revenue)} title="Chiffre d'affaires (7 jours)" cur={d.week.revenue} prev={d.prevWeek.revenue} />
            <MetricCard icon={Truck} value={String(d.week.delivered)} title="Commandes livrées (7 jours)" cur={d.week.delivered} prev={d.prevWeek.delivered} />
          </div>

          <div className="grid gap-6 lg:grid-cols-3">
            <div className="space-y-6">
              <ProductInsight p={d.topProduct} />
              <Earnings month={d.month} prevMonth={d.prevMonth} channels={d.channels} />
            </div>
            <div className="space-y-6 lg:col-span-2">
              <SalesMetrics month={d.month} prevMonth={d.prevMonth} />
              <Loyalty share={d.returningShare} />
            </div>
          </div>

          <div className="grid gap-6 lg:grid-cols-[1.3fr_1fr]">
            <Card title="À faire maintenant" padded={false}>
              {list.length === 0 ? (
                <p className="px-6 pb-6 text-sm text-emerald-700">Tout est à jour ✓ Rien d'urgent pour le moment.</p>
              ) : (
                <ul className="divide-y divide-line pb-2">
                  {list.map((t) => (
                    <li key={t.key}>
                      <Link to={t.to} search={t.search ?? {}} className="flex items-center gap-3 px-6 py-3 transition hover:bg-ivory-deep/60">
                        <span className="text-xl" aria-hidden="true">{t.icon}</span>
                        <span className="min-w-0 flex-1">
                          <span className="block text-sm font-semibold">{t.label}</span>
                          {t.hint && <span className="block truncate text-xs text-ink-soft">{t.hint}</span>}
                        </span>
                        <span className={`grid min-w-9 place-items-center rounded-md px-2.5 py-1 text-sm font-bold tabular-nums ${t.urgent ? "bg-plum-600 text-white" : "bg-ivory-deep"}`}>{t.count}</span>
                        <ChevronRight className="size-4 text-ink-soft" />
                      </Link>
                    </li>
                  ))}
                </ul>
              )}
            </Card>
            <Card title="Commandes en cours" actions={<Link to="/statistiques" className="text-sm font-semibold text-plum-600">Statistiques</Link>}>
              <ul className="grid grid-cols-2 gap-2 text-sm sm:grid-cols-3">
                {PIPELINE.map(([k, label]) => (
                  <li key={k}>
                    <Link to="/commandes" search={{ status: k }} className="flex flex-col rounded-lg border border-line px-3 py-2.5 transition hover:border-plum-600/40 hover:bg-ivory-deep/60">
                      <b className="text-lg tabular-nums">{d.pipeline[k] ?? 0}</b>
                      <span className="text-xs text-ink-soft">{label}</span>
                    </Link>
                  </li>
                ))}
              </ul>
              <p className="mt-3 text-xs text-ink-soft">
                Aujourd'hui : {d.kpis.ordersToday} commande(s) · {da(d.kpis.revenueToday)}
                {d.kpis.cancelledToday ? ` · ${d.kpis.cancelledToday} annulée(s) non comptée(s)` : ""}
              </p>
            </Card>
          </div>

          <div className="grid gap-6 lg:grid-cols-[1.3fr_1fr]">
            <Card title="Dernières commandes" actions={<Link to="/commandes" className="text-sm font-semibold text-plum-600">Tout voir</Link>} padded={false}>
              {d.recent.length === 0 ? (
                <p className="px-6 pb-6 text-sm text-ink-soft">Aucune commande pour le moment. Passez une commande test sur la boutique !</p>
              ) : (
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-y border-line bg-ivory text-start text-xs text-ink-soft">
                      <th className="px-6 py-2.5 text-start font-medium">Cliente</th>
                      <th className="hidden px-3 py-2.5 text-start font-medium sm:table-cell">Wilaya</th>
                      <th className="px-3 py-2.5 text-end font-medium">Total</th>
                      <th className="px-6 py-2.5 text-end font-medium">Statut</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-line">
                    {d.recent.map((o) => (
                      <tr key={o.id} className="transition hover:bg-ivory-deep/50">
                        <td className="px-6 py-3">
                          <Link to="/commandes" search={{ o: o.id }} className="block">
                            <span className="block truncate font-medium">{o.name}</span>
                            <span className="text-xs text-ink-soft">{o.public_code} · {ago(o.created_at)}</span>
                          </Link>
                        </td>
                        <td className="hidden px-3 py-3 text-ink-soft sm:table-cell">{o.wilaya}</td>
                        <td className="px-3 py-3 text-end font-medium tabular-nums">{da(o.total)}</td>
                        <td className="px-6 py-3 text-end">
                          <StatusBadge status={o.status} />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </Card>

            <div className="space-y-6">
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
