import {
  formatDzPhone,
  OUTCOME_REASON_LABEL,
  OUTCOME_REASONS,
  canTransition,
  type CustomerSegment,
  type OrderStatus,
  type OutcomeReason,
  type RiskAssessment,
  type RiskLevel,
} from "@henine/shared";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useNavigate, useSearch } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { api, del, errorMessage, patch, post } from "../api";
import { ago, CHANNEL_LABEL, da, daMinus, dateTime, statusLabel, telLink, waLink } from "../lib/format";
import { RiskBadge, RiskPanel, SegmentBadge } from "../lib/risk";
import { useLive } from "../lib/live";
import {
  ContactActions,
  ContactHistory,
  ContactTimeBadge,
  CustomerWarning,
  DiscountBox,
  ExchangesCard,
  ItemsEditor,
  OrderHistory,
  PreviousOrders,
  ProfitBlock,
  SlaBadge,
  type OrderOpsData,
} from "./OrderOps";
import { useCan, useMe } from "../Shell";
import { Badge, Button, Card, Empty, ErrorState, inputCls, ListSkeleton, PageHeader, Pills, SearchBox, Sheet, StatusBadge, TextArea, TextField, useToast } from "../ui";
import { tr } from "../i18n";

interface OrderRow {
  id: number;
  public_code: string;
  status: OrderStatus;
  channel: string;
  name: string;
  phone: string;
  total: number;
  wilaya_code: number;
  wilaya: string;
  delivery_type: string;
  created_at: number;
  risk_score: number;
  confirm_attempts: number;
  next_callback_at: number | null;
  items: number;
  returned_count: number | null;
  delivered_count: number | null;
  outcome_reason: string | null;
  risk: { level: RiskLevel; score: number };
}

/** Dashboard "needs attention" shortcuts (same keys as the API's attentionSql). */
export const ATTENTION_LABEL: Record<string, string> = {
  late: tr("En retard (délais dépassés)"),
  to_confirm: tr("À confirmer"),
  callbacks: tr("À rappeler maintenant"),
  high_risk: tr("Risque élevé à vérifier"),
  stale_confirmed: tr("Confirmées depuis plus de 24 h"),
  stale_preparing: tr("En préparation depuis plus de 48 h"),
  stale_shipped: tr("Expédiées depuis plus de 7 jours"),
  returns: tr("Retours à réceptionner"),
};

const TABS = [
  { value: "active", label: tr("En cours") },
  { value: "a_confirmer", label: tr("À confirmer") },
  { value: "confirmee", label: tr("Confirmées") },
  { value: "en_preparation", label: tr("Préparation") },
  { value: "en_cours", label: tr("Expédiées") },
  { value: "termine", label: tr("Livrées") },
  { value: "annule", label: tr("Annulées") },
  { value: "retours", label: tr("Retours") },
  { value: "all", label: tr("Toutes") },
];

export function OrdersPage() {
  const search = useSearch({ strict: false }) as { status?: string; o?: number; attention?: string };
  const navigate = useNavigate();
  // the red "new orders" counter resets while this page is on screen
  const live = useLive();
  useEffect(() => {
    const seen = () => !document.hidden && live.markSeen();
    seen();
    document.addEventListener("visibilitychange", seen);
    return () => document.removeEventListener("visibilitychange", seen);
  }, [live]);
  const [status, setStatus] = useState(search.status ?? "active");
  const attention = search.attention && tr(ATTENTION_LABEL[search.attention]) ? search.attention : null;
  const clearAttention = () => void navigate({ to: "/commandes", search: (s: Record<string, unknown>) => ({ ...s, attention: undefined }) });
  const [q, setQ] = useState("");
  const [debounced, setDebounced] = useState("");
  useEffect(() => {
    const id = setTimeout(() => setDebounced(q), 300);
    return () => clearTimeout(id);
  }, [q]);
  // more filters: wilaya and dates (Algiers days)
  const [wilaya, setWilaya] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const wilayas = useQuery({
    queryKey: ["geo-wilayas"],
    queryFn: () => fetch("/api/geo/wilayas").then((r) => r.json() as Promise<{ code: number; fr: string }[]>),
    staleTime: 3600_000,
  });
  const day = (s: string, end = false) => (s ? new Date(`${s}T00:00:00+01:00`).getTime() + (end ? 86400_000 : 0) : 0);
  const extra = `${wilaya ? `&wilaya=${wilaya}` : ""}${from ? `&from=${day(from)}` : ""}${to ? `&to=${day(to, true)}` : ""}`;
  const list = useQuery({
    queryKey: ["orders", status, debounced, attention, extra],
    queryFn: () =>
      api<{ rows: OrderRow[]; counts: Record<string, number> }>(`/orders?status=${status}&q=${encodeURIComponent(debounced)}${attention ? `&attention=${attention}` : ""}${extra}`),
    refetchInterval: 20_000,
  });
  const openId = search.o ?? null;
  const setOpen = (id: number | null) => void navigate({ to: "/commandes", search: (s: Record<string, unknown>) => ({ ...s, o: id ?? undefined }) });
  const counts = list.data?.counts ?? {};
  const toConfirm = (counts.nouvelle ?? 0) + (counts.injoignable ?? 0);
  // several orders at once: tick them, then one button
  const [picked, setPicked] = useState<number[]>([]);
  useEffect(() => setPicked([]), [status, debounced, attention, extra]);
  const rows = list.data?.rows ?? [];
  const allPicked = rows.length > 0 && rows.every((r) => picked.includes(r.id));
  const toggle = (id: number) => setPicked((p) => (p.includes(id) ? p.filter((x) => x !== id) : [...p, id]));

  return (
    <div>
      <PageHeader
        group={tr("Commandes")}
        title={tr("Commandes")}
        subtitle={toConfirm ? tr("{0} à confirmer", { 0: toConfirm }) : tr("Tout est à jour ✓")}
        actions={
          <a href="/api/admin/orders.csv?days=90" className="inline-flex h-9 items-center rounded-lg border border-line bg-surface px-3.5 text-sm font-semibold">
            {tr("Export CSV")}
          </a>
        }
      />
      {attention ? (
        <div className="mb-3 flex items-center justify-between gap-3 rounded-xl bg-plum-600 px-4 py-3 text-sm text-white">
          <span>{tr("Filtre :")} <b>{tr(ATTENTION_LABEL[attention])}</b></span>
          <button type="button" onClick={clearAttention} className="rounded-full bg-white/15 px-3 py-1 font-semibold">{tr("Tout afficher ✕")}</button>
        </div>
      ) : (
        <Pills value={status} onChange={setStatus} options={TABS.map((t) => ({ value: t.value, label: t.value === "a_confirmer" && toConfirm ? `${t.label} (${toConfirm})` : t.label }))} />
      )}
      <SearchBox value={q} onChange={setQ} placeholder={tr("N° de commande, nom, téléphone…")} />
      <div className="-mt-2 mb-4 flex flex-wrap items-center gap-2">
        <select className={`${inputCls} h-10 w-auto min-w-[11rem]`} value={wilaya} onChange={(e) => setWilaya(e.target.value)} aria-label={tr("Wilaya")}>
          <option value="">{tr("Toutes les wilayas")}</option>
          {(wilayas.data ?? []).map((w) => (
            <option key={w.code} value={w.code}>{String(w.code).padStart(2, "0")} · {w.fr}</option>
          ))}
        </select>
        <label className="flex items-center gap-1.5 text-sm text-ink-soft">
          {tr("Du")}
          <input type="date" className={`${inputCls} h-10 w-auto`} value={from} onChange={(e) => setFrom(e.target.value)} />
        </label>
        <label className="flex items-center gap-1.5 text-sm text-ink-soft">
          {tr("au")}
          <input type="date" className={`${inputCls} h-10 w-auto`} value={to} onChange={(e) => setTo(e.target.value)} />
        </label>
        {(wilaya || from || to) && (
          <button type="button" onClick={() => { setWilaya(""); setFrom(""); setTo(""); }} className="h-10 rounded-lg px-3 text-sm font-semibold text-plum-700">
            {tr("Effacer les filtres ✕")}
          </button>
        )}
      </div>
      {list.error ? (
        <ErrorState error={list.error} onRetry={list.refetch} />
      ) : !list.data ? (
        <ListSkeleton />
      ) : list.data.rows.length === 0 ? (
        <Empty title={tr("Aucune commande ici")}>{tr("Les nouvelles commandes du site arrivent automatiquement (et sur Telegram).")}</Empty>
      ) : (
        <>
        <label className="mb-2 flex w-fit cursor-pointer items-center gap-2 px-1 text-sm text-ink-soft">
          <input type="checkbox" className="size-4 accent-plum-600" checked={allPicked} onChange={() => setPicked(allPicked ? [] : rows.map((r) => r.id))} />
          {tr("Tout sélectionner (")}{rows.length})
        </label>
        <ul className="space-y-2">
          {list.data.rows.map((o) => (
            <li key={o.id} className="flex items-stretch gap-2">
              <label className={`grid w-10 shrink-0 cursor-pointer place-items-center rounded-xl border transition ${picked.includes(o.id) ? "border-plum-600 bg-rose-100/60" : "border-line bg-surface"}`}>
                <input type="checkbox" className="size-4 accent-plum-600" checked={picked.includes(o.id)} onChange={() => toggle(o.id)} aria-label={tr("Sélectionner {0}", { 0: o.public_code })} />
              </label>
              <button type="button" onClick={() => setOpen(o.id)} className="min-w-0 flex-1 rounded-xl border border-line bg-surface p-3.5 text-start transition hover:border-plum-600/40 active:scale-[0.995]">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="truncate font-semibold">{o.name}</p>
                    <p className="text-sm text-ink-soft">
                      {o.wilaya_code} · {o.wilaya} · {o.delivery_type === "bureau" ? tr("Bureau") : tr("Domicile")}
                    </p>
                  </div>
                  <div className="text-end">
                    <p className="font-semibold tabular-nums">{da(o.total)}</p>
                    <StatusBadge status={o.status} />
                  </div>
                </div>
                <div className="mt-2 flex flex-wrap items-center gap-1.5 text-xs text-ink-soft">
                  <span className="font-mono">{o.public_code}</span>·<span>{ago(o.created_at)}</span>·<span>{o.items} {tr("article(s)")}</span>·<span>{tr(CHANNEL_LABEL[o.channel]) ?? o.channel}</span>
                  {o.returned_count ? <Badge tone="bg-orange-100 text-orange-800">⚠ {o.returned_count} {tr("retour(s)")}</Badge> : null}
                  {(o.delivered_count ?? 0) >= 2 ? <Badge tone="bg-emerald-100 text-emerald-800">{tr("Fidèle")}</Badge> : null}
                  {o.risk.level !== "low" ? <RiskBadge level={o.risk.level} /> : null}
                  {o.status === "injoignable" ? <Badge tone="bg-amber-100 text-amber-800">📵 {o.confirm_attempts} {tr("appel(s)")}</Badge> : null}
                  {o.outcome_reason ? <Badge tone="bg-stone-100 text-stone-700">{tr(OUTCOME_REASON_LABEL[o.outcome_reason as OutcomeReason]) ?? o.outcome_reason}</Badge> : null}
                </div>
              </button>
            </li>
          ))}
        </ul>
        </>
      )}
      {picked.length > 0 && <BulkBar ids={picked} rows={rows} onDone={() => setPicked([])} />}
      <OrderSheet id={openId} onClose={() => setOpen(null)} />
    </div>
  );
}

/** Pieces of these orders have left the shop (deleting asks whether to put them back in stock). */
const LEFT_SHOP = ["expediee", "en_livraison", "livree", "retour"] as const;

/** The same steps as in one order (except "Expédiée": a tracking number per parcel). */
const BULK: { to: OrderStatus; label: string; perm: "orders.confirm" | "orders.ship"; variant: "primary" | "secondary" | "danger"; reason?: boolean }[] = [
  { to: "confirmee", label: tr("✅ Confirmer"), perm: "orders.confirm", variant: "primary" },
  { to: "injoignable", label: tr("📵 Injoignable"), perm: "orders.confirm", variant: "secondary" },
  { to: "en_preparation", label: tr("📦 En préparation"), perm: "orders.ship", variant: "secondary" },
  { to: "en_livraison", label: tr("🛵 En livraison"), perm: "orders.ship", variant: "secondary" },
  { to: "livree", label: tr("🎉 Livrées"), perm: "orders.ship", variant: "secondary" },
  { to: "retour", label: tr("↩️ Retour"), perm: "orders.ship", variant: "danger", reason: true },
  { to: "retour_recu", label: tr("📥 Retour reçu"), perm: "orders.ship", variant: "secondary" },
  { to: "nouvelle", label: tr("Rouvrir"), perm: "orders.confirm", variant: "secondary" },
  { to: "annulee", label: tr("Annuler"), perm: "orders.confirm", variant: "danger", reason: true },
  { to: "doublon", label: tr("Doublon"), perm: "orders.confirm", variant: "danger" },
  { to: "fausse", label: tr("Fausse commande"), perm: "orders.confirm", variant: "danger" },
];

/**
 * Bottom bar shown while orders are ticked: only the steps that at least one of them can
 * take (a confirmed order can't be confirmed again…), with how many will change.
 */
function BulkBar({ ids, rows, onDone }: { ids: number[]; rows: OrderRow[]; onDone: () => void }) {
  const can = useCan();
  const owner = useMe().data?.role === "owner";
  const qc = useQueryClient();
  const toast = useToast();
  const chosen = rows.filter((r) => ids.includes(r.id));
  const [askReason, setAskReason] = useState<OrderStatus | null>(null);
  const done = () => {
    void qc.invalidateQueries({ queryKey: ["orders"] });
    void qc.invalidateQueries({ queryKey: ["dashboard"] });
    onDone();
  };
  const run = useMutation({
    mutationFn: (v: { to: OrderStatus; reason?: OutcomeReason }) =>
      post<{ done: string[]; failed: { id: number; error: string }[] }>("/orders/bulk-status", { ids: chosen.filter((r) => canTransition(r.status, v.to)).map((r) => r.id), ...v }),
    onSuccess: (r, v) => {
      toast(tr("{0} commande(s) : {1}{2}", { 0: r.done.length, 1: statusLabel(v.to), 2: r.failed.length ? ` · ${r.failed.length} non modifiée(s) (statut déjà changé ou stock insuffisant)` : "" }), r.failed.length ? "error" : undefined);
      setAskReason(null);
      done();
    },
    onError: (e) => toast(errorMessage(e), "error"),
  });
  const remove = useMutation({
    mutationFn: (restock: boolean) => post<{ done: string[] }>("/orders/bulk-delete", { ids, restock }),
    onSuccess: (r) => {
      toast(tr("{0} commande(s) supprimée(s)", { 0: r.done.length }));
      done();
    },
    onError: (e) => toast(errorMessage(e), "error"),
  });
  const actions = BULK.filter((b) => can(b.perm)).map((b) => ({ ...b, n: chosen.filter((r) => canTransition(r.status, b.to)).length })).filter((b) => b.n > 0);
  const reasons = askReason
    ? OUTCOME_REASONS.filter((r) => r !== "duplicate" && (askReason === "retour" ? r !== "size_issue" && r !== "product_issue" : !["too_small", "too_large", "defect"].includes(r)))
    : [];
  return (
    <div className="fixed inset-x-0 bottom-[calc(4rem+env(safe-area-inset-bottom))] z-30 border-t border-line bg-surface/95 p-3 shadow-[0_-4px_16px_rgb(43_22_32/0.08)] backdrop-blur md:bottom-0 md:ps-[15rem]">
      <div className="mx-auto max-w-6xl space-y-2 px-1 md:px-8">
        {askReason && (
          <div className="flex flex-wrap items-center gap-1.5 rounded-lg bg-ivory-deep p-2 text-sm">
            <span className="me-1 font-semibold">{tr("{0} : pour quelle raison ?", { 0: BULK.find((b) => b.to === askReason)?.label ?? "" })}</span>
            {reasons.map((r) => (
              <Button key={r} size="sm" loading={run.isPending && run.variables?.reason === r} onClick={() => run.mutate({ to: askReason, reason: r })}>
                {tr(OUTCOME_REASON_LABEL[r])}
              </Button>
            ))}
            <button type="button" onClick={() => setAskReason(null)} className="ms-auto text-ink-soft underline">{tr("Retour")}</button>
          </div>
        )}
        <div className="flex items-center gap-2 overflow-x-auto pb-0.5 [scrollbar-width:none]">
          <p className="me-auto shrink-0 text-sm">
            <b>{ids.length}</b> {tr("sélectionnée(s)")}
            <button type="button" onClick={onDone} className="ms-2 text-ink-soft underline">{tr("annuler")}</button>
          </p>
          {actions.length === 0 && <span className="shrink-0 text-xs text-ink-soft">{tr("Aucune étape possible pour cette sélection")}</span>}
          {actions.map((b) => (
            <Button
              key={b.to}
              size="sm"
              className="shrink-0"
              variant={b.variant}
              loading={run.isPending && run.variables?.to === b.to && !b.reason}
              title={b.n < ids.length ? tr("{0} sur {1} peuvent passer à ce statut", { 0: b.n, 1: ids.length }) : undefined}
              onClick={() => (b.reason ? setAskReason(b.to) : confirm(tr("{0} : {1} commande(s) ?", { 0: b.label, 1: b.n })) && run.mutate({ to: b.to }))}
            >
              {b.label}{b.n < ids.length ? ` (${b.n})` : ""}
            </Button>
          ))}
          <Link to="/bordereaux" search={{ ids: ids.join(",") }} className="inline-flex h-8 shrink-0 items-center rounded-lg border border-line bg-surface px-3 text-sm font-semibold">
            {tr("🖨 Bordereaux")}
          </Link>
          {owner && (
            <Button
              size="sm"
              variant="danger"
              className="shrink-0"
              loading={remove.isPending}
              onClick={() => {
                if (!confirm(tr("Supprimer définitivement {0} commande(s) ?", { 0: ids.length }))) return;
                const left = chosen.some((r) => (LEFT_SHOP as readonly string[]).includes(r.status));
                remove.mutate(left ? confirm(tr("Certaines sont déjà sorties de la boutique. Remettre leurs articles en stock ? (OK = oui · Annuler = non)")) : false);
              }}
            >
              {tr("🗑 Supprimer")}
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}

type OrderDetail = {
  order: Record<string, unknown> & {
    id: number; public_code: string; status: OrderStatus; name: string; phone: string; wilaya_code: number; wilaya_fr: string; commune_fr: string | null;
    commune_text: string | null; address: string | null; delivery_type: string; subtotal: number; discount_total: number; shipping_price: number; total: number;
    coupon_code: string | null; customer_note: string | null; internal_note: string | null; tracking_number: string | null; channel: string; created_at: number;
    orders_count: number | null; delivered_count: number | null; returned_count: number | null; cancelled_count: number | null; is_blacklisted: number | null;
    customer_id: number; risk_score: number; confirm_attempts: number; ua_short: string | null; locale: string; outcome_reason: string | null;
    contact_time: string | null; manual_discount: number; manual_discount_reason: string | null; received_at: number | null; receipt_issue: string | null;
  };
  items: { id: number; variant_id: number | null; name_fr: string; options_label: string | null; sku: string; qty: number; unit_price: number; image: string | null; available: number | null }[];
  events: { id: number; from_status: string | null; to_status: string | null; kind: string; actor: string; source: string; note: string | null; created_at: number }[];
  next: OrderStatus[];
  risk: RiskAssessment;
  segment: CustomerSegment;
} & OrderOpsData;

/** Statuses that ask why (cancellation / return reasons feed the analytics). */
const NEEDS_REASON: OrderStatus[] = ["annulee", "fausse", "retour"];

const ACTION: Partial<Record<OrderStatus, { label: string; variant: "primary" | "secondary" | "danger" }>> = {
  confirmee: { label: tr("✅ Confirmer"), variant: "primary" },
  injoignable: { label: tr("📵 Injoignable"), variant: "secondary" },
  en_preparation: { label: tr("📦 En préparation"), variant: "primary" },
  expediee: { label: tr("🚚 Expédiée"), variant: "primary" },
  en_livraison: { label: tr("🛵 En livraison"), variant: "secondary" },
  livree: { label: tr("🎉 Livrée"), variant: "primary" },
  retour: { label: tr("↩️ Retour"), variant: "danger" },
  retour_recu: { label: tr("📥 Retour reçu (remis en stock)"), variant: "primary" },
  annulee: { label: tr("Annuler"), variant: "danger" },
  doublon: { label: tr("Doublon"), variant: "danger" },
  fausse: { label: tr("Fausse commande"), variant: "danger" },
  nouvelle: { label: tr("Rouvrir"), variant: "secondary" },
};


function OrderSheet({ id, onClose }: { id: number | null; onClose: () => void }) {
  const qc = useQueryClient();
  const toast = useToast();
  const can = useCan();
  const q = useQuery({ queryKey: ["order", id], queryFn: () => api<OrderDetail>(`/orders/${id}`), enabled: id != null });
  const refresh = () => {
    void qc.invalidateQueries({ queryKey: ["order", id] });
    void qc.invalidateQueries({ queryKey: ["orders"] });
    void qc.invalidateQueries({ queryKey: ["dashboard"] });
  };
  const status = useMutation({
    mutationFn: (v: { to: OrderStatus; reason?: OutcomeReason; note?: string; trackingNumber?: string }) => post(`/orders/${id}/status`, v),
    onSuccess: (_, v) => {
      toast(tr("Statut : {0}", { 0: statusLabel(v.to) }));
      setAsk(null);
      refresh();
    },
    onError: (e) => toast(errorMessage(e), "error"),
  });
  const [ask, setAsk] = useState<OrderStatus | null>(null);
  const [note, setNote] = useState("");
  const addNote = useMutation({
    mutationFn: (kind: "note" | "call" | "whatsapp") => post(`/orders/${id}/note`, { note: note || (kind === "call" ? "Appel" : "Message WhatsApp"), kind }),
    onSuccess: () => {
      setNote("");
      refresh();
    },
  });
  const [editing, setEditing] = useState(false);
  const [editingItems, setEditingItems] = useState(false);
  const [discounting, setDiscounting] = useState(false);
  const navigate = useNavigate();
  const openOther = (oid: number) => void navigate({ to: "/commandes", search: (s: Record<string, unknown>) => ({ ...s, o: oid }) });
  const d = q.data;
  const o = d?.order;
  const owner = useMe().data?.role === "owner";
  const remove = useMutation({
    mutationFn: (restock: boolean) => del(`/orders/${id}${restock ? "?restock=1" : ""}`),
    onSuccess: () => {
      toast(tr("Commande supprimée"));
      refresh();
      onClose();
    },
    onError: (e) => toast(errorMessage(e), "error"),
  });
  function askDelete() {
    if (!o) return;
    if (!confirm(tr("Supprimer définitivement la commande {0} ? Le stock réservé est libéré, les points et le code promo sont rendus.", { 0: o.public_code }))) return;
    const left = (LEFT_SHOP as readonly string[]).includes(o.status);
    remove.mutate(left ? confirm(tr("Les articles sont déjà sortis de la boutique. Les remettre en stock ? (OK = oui, c'était un test · Annuler = non, ils ont été livrés)")) : false);
  }

  const waText = o
    ? `Bonjour ${o.name} 🌸 Ici Henine Boutique. Nous confirmons votre commande ${o.public_code} (${da(o.total)}), livraison ${o.delivery_type === "bureau" ? "au bureau" : "à domicile"} à ${o.wilaya_fr}. Merci !`
    : "";

  return (
    <Sheet
      open={id != null}
      onClose={onClose}
      wide
      title={o ? <span className="flex flex-wrap items-center gap-2"><span className="font-mono">{o.public_code}</span><StatusBadge status={o.status} />{d && <SlaBadge sla={d.sla} />}</span> : tr("Commande")}
      footer={
        d && (d.next.length > 0 || owner) ? (
          <div className="flex flex-wrap gap-2">
            {d.next.map((to) => (
              <Button
                key={to}
                variant={ACTION[to]?.variant ?? "secondary"}
                size="sm"
                loading={status.isPending && status.variables?.to === to}
                onClick={() => {
                  if (NEEDS_REASON.includes(to) || to === "expediee") return setAsk(to);
                  if (to === "doublon" && !confirm(tr("Marquer comme doublon ? Le stock réservé sera libéré."))) return;
                  status.mutate({ to });
                }}
              >
                {ACTION[to]?.label ?? statusLabel(to)}
              </Button>
            ))}
            {owner && (
              <Button variant="danger" size="sm" className="ms-auto" loading={remove.isPending} onClick={askDelete}>
                {tr("🗑 Supprimer")}
              </Button>
            )}
          </div>
        ) : undefined
      }
    >
      {q.error ? (
        <ErrorState error={q.error} onRetry={q.refetch} />
      ) : !o || !d ? (
        <ListSkeleton rows={4} />
      ) : (
        <div className="space-y-4">
          {ask && (
            <StatusDialog
              to={ask}
              trackingNumber={o.tracking_number}
              loading={status.isPending}
              onCancel={() => setAsk(null)}
              onConfirm={(v) => status.mutate({ to: ask, ...v })}
            />
          )}
          <Card>
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="text-lg font-semibold">{o.name}</p>
                <p className="font-mono text-sm"><bdi dir="ltr">{formatDzPhone(o.phone)}</bdi></p>
                <p className="mt-1 text-sm text-ink-soft">
                  {o.wilaya_code} · {o.wilaya_fr} › {o.commune_fr ?? o.commune_text ?? "?"} · {o.delivery_type === "bureau" ? tr("🏢 Bureau") : tr("🏠 Domicile")}
                </p>
                {o.address && <p className="text-sm">🏠 {o.address}</p>}
              </div>
              <div className="flex shrink-0 flex-col gap-2">
                <Link to="/bordereaux" search={{ ids: String(o.id) }} className="inline-flex h-10 items-center justify-center whitespace-nowrap rounded-lg border border-line bg-surface px-3 text-sm font-semibold">{tr("🖨 Bordereau")}</Link>
                <Link to="/facture" search={{ id: String(o.id) }} className="inline-flex h-10 items-center justify-center whitespace-nowrap rounded-lg border border-line bg-surface px-3 text-sm font-semibold">{tr("🧾 Facture PDF")}</Link>
              </div>
            </div>
            <div className="mt-2 flex flex-wrap items-center gap-2 text-xs">
              <ContactTimeBadge value={o.contact_time} />
              <span className="text-ink-soft">{d.lastContactAt ? tr("Dernier contact : {0}", { 0: ago(d.lastContactAt) }) : tr("Pas encore contactée")}</span>
            </div>
            {o.phone && (
              <div className="mt-3">
                <ContactActions orderId={o.id} phone={o.phone} waText={waText} onLogged={refresh} />
              </div>
            )}
            {o.customer_note && <p className="mt-3 rounded-xl border border-amber-300 bg-amber-50 p-3 text-sm font-medium text-amber-950">📝 {tr("Note de la cliente :")} {o.customer_note}</p>}
            {o.receipt_issue && <p className="mt-3 rounded-xl border border-red-300 bg-red-50 p-3 text-sm font-semibold text-red-900">❌ {tr("Problème signalé par la cliente :")} {o.receipt_issue}</p>}
            {o.received_at && <p className="mt-3 rounded-xl bg-emerald-50 p-2.5 text-sm text-emerald-800">✅ {tr("Réception confirmée par la cliente · {0}", { 0: dateTime(o.received_at) })}</p>}
            <div className="mt-3">
              <CustomerWarning
                risk={d.risk}
                counts={{ orders: o.orders_count ?? 1, delivered: o.delivered_count ?? 0, cancelled: o.cancelled_count ?? 0, returned: o.returned_count ?? 0, blacklisted: !!o.is_blacklisted }}
              />
            </div>
            <div className="mt-3 flex flex-wrap gap-1.5 text-xs">
              <Badge tone="bg-stone-100 text-stone-700">{o.orders_count ?? 1} {tr("commande(s)")}</Badge>
              <Badge tone="bg-emerald-100 text-emerald-800">{o.delivered_count ?? 0} {tr("livrée(s)")}</Badge>
              {o.returned_count ? <Badge tone="bg-orange-100 text-orange-800">{o.returned_count} {tr("retour(s)")}</Badge> : null}
              {o.cancelled_count ? <Badge tone="bg-stone-200 text-stone-700">{o.cancelled_count} {tr("annulée(s)")}</Badge> : null}
              {o.is_blacklisted ? <Badge tone="bg-red-100 text-red-800">{tr("⛔ Liste noire")}</Badge> : null}
              <Badge tone="bg-stone-100 text-stone-700">{tr(CHANNEL_LABEL[o.channel]) ?? o.channel}</Badge>
              {o.ua_short && <Badge tone="bg-stone-100 text-stone-700">{o.ua_short}</Badge>}
              <SegmentBadge segment={d.segment} />
            </div>
            <div className="mt-3">
              <RiskPanel risk={d.risk} />
            </div>
            {o.outcome_reason && (
              <p className="mt-3 rounded-xl bg-stone-100 p-2.5 text-sm">
                {tr("Motif :")} <b>{tr(OUTCOME_REASON_LABEL[o.outcome_reason as OutcomeReason]) ?? o.outcome_reason}</b>
              </p>
            )}
            <div className="mt-3">
              <PreviousOrders data={d} onOpen={openOther} />
            </div>
          </Card>

          {editingItems ? (
            <ItemsEditor orderId={o.id} items={d.items} onDone={() => { setEditingItems(false); refresh(); }} />
          ) : (
            <Card
              title={tr("Articles ({0})", { 0: d.items.reduce((s, i) => s + i.qty, 0) })}
              actions={
                d.editable && (
                  <div className="flex gap-1.5">
                    {can("orders.edit") && <Button size="sm" onClick={() => setEditingItems(true)}>{tr("✏️ Modifier")}</Button>}
                    {d.canDiscount && <Button size="sm" onClick={() => setDiscounting((v) => !v)}>{tr("💰 Remise")}</Button>}
                  </div>
                )
              }
            >
              <ul className="space-y-2">
                {d.items.map((i) => (
                  <li key={i.id} className="flex items-center gap-3 text-sm">
                    {i.image ? <img src={i.image} alt="" className="h-14 w-11 rounded-md object-cover" /> : <span className="grid h-14 w-11 place-items-center rounded-md bg-rose-100">👗</span>}
                    <span className="min-w-0 flex-1">
                      <span className="block font-medium">{i.name_fr}</span>
                      <span className="text-ink-soft">{i.options_label} · {i.sku}</span>
                    </span>
                    <span className="text-end tabular-nums">
                      {i.qty} {tr("×")} {da(i.unit_price)}
                    </span>
                  </li>
                ))}
              </ul>
              <dl className="mt-3 space-y-1 border-t border-line pt-3 text-sm">
                <div className="flex justify-between"><dt className="text-ink-soft">{tr("Sous-total")}</dt><dd>{da(o.subtotal)}</dd></div>
                {o.discount_total - o.manual_discount > 0 && (
                  <div className="flex justify-between text-emerald-700"><dt>{tr("Remise")} {o.coupon_code}</dt><dd>{daMinus(o.discount_total - o.manual_discount)}</dd></div>
                )}
                {o.manual_discount > 0 && (
                  <div className="flex justify-between gap-3 text-emerald-700">
                    <dt>
                      {tr("Remise manuelle")}
                      {o.manual_discount_reason ? <span className="text-ink-soft"> · {o.manual_discount_reason}</span> : null}
                    </dt>
                    <dd>{daMinus(o.manual_discount)}</dd>
                  </div>
                )}
                <div className="flex justify-between"><dt className="text-ink-soft">{tr("Livraison")}</dt><dd>{da(o.shipping_price)}</dd></div>
                <div className="flex justify-between text-base font-semibold"><dt>{tr("Total (à encaisser)")}</dt><dd>{da(o.total)}</dd></div>
              </dl>
              {discounting && d.editable && (
                <DiscountBox
                  orderId={o.id}
                  subtotal={o.subtotal}
                  otherDiscount={o.discount_total - o.manual_discount}
                  current={o.manual_discount}
                  onDone={() => {
                    setDiscounting(false);
                    refresh();
                  }}
                />
              )}
              {d.profit && <ProfitBlock profit={d.profit} />}
              {!d.editable && <p className="mt-2 text-xs text-ink-soft">{tr("🔒 Le colis est parti : les articles, l'adresse et la remise ne se modifient plus.")}</p>}
            </Card>
          )}

          <ExchangesCard data={d} onChange={refresh} />

          {editing ? (
            <EditOrder order={o} editable={d.editable} onDone={() => { setEditing(false); refresh(); }} />
          ) : (
            <Card
              title={tr("Livraison & suivi")}
              actions={can("orders.edit") && <Button size="sm" onClick={() => setEditing(true)}>{tr("Modifier")}</Button>}
            >
              <p className="text-sm">{tr("N° de suivi ZR Express :")} <b>{o.tracking_number ?? "—"}</b></p>
              {o.internal_note && <p className="mt-2 text-sm text-ink-soft">🔒 {o.internal_note}</p>}
            </Card>
          )}

          <Card title={tr("💬 Contacts avec la cliente")}>
            <ContactHistory data={d} orderId={o.id} />
          </Card>

          <Card title={tr("Historique de la commande")}>
            <OrderHistory events={d.events} changes={d.changes} />
            <div className="mt-3 flex gap-2">
              <input className={inputCls} placeholder={tr("Ajouter une note interne…")} value={note} onChange={(e) => setNote(e.target.value)} maxLength={1000} />
              <Button onClick={() => note.trim() && addNote.mutate("note")} loading={addNote.isPending}>{tr("Ajouter")}</Button>
            </div>
          </Card>
        </div>
      )}
    </Sheet>
  );
}

/**
 * Asked before a status change: why it was cancelled / returned (feeds Statistiques →
 * motifs), or the ZR Express tracking number when the parcel ships.
 */
function StatusDialog({
  to,
  trackingNumber,
  loading,
  onCancel,
  onConfirm,
}: {
  to: OrderStatus;
  trackingNumber: string | null;
  loading: boolean;
  onCancel: () => void;
  onConfirm: (v: { reason?: OutcomeReason; note?: string; trackingNumber?: string }) => void;
}) {
  const [reason, setReason] = useState<OutcomeReason | null>(null);
  const [note, setNote] = useState("");
  const [tracking, setTracking] = useState(trackingNumber ?? "");
  const shipping = to === "expediee";
  // returns: why the parcel came back (sizes, defects… feed Statistiques → Retours); cancellations: why it never left
  const RETURN_ONLY: OutcomeReason[] = ["too_small", "too_large", "defect"];
  const reasons = OUTCOME_REASONS.filter(
    (r) => r !== "duplicate" && (to === "retour" ? r !== "size_issue" && r !== "product_issue" : !RETURN_ONLY.includes(r)),
  );
  const ref = useRef<HTMLDivElement>(null);
  // the buttons live in the sheet footer: bring the question into view
  useEffect(() => {
    void ref.current?.scrollIntoView({ behavior: "smooth", block: "center" });
  }, []);
  return (
    <div ref={ref}>
    <Card title={shipping ? tr("🚚 Expédier la commande") : tr("{0} : pour quelle raison ?", { 0: ACTION[to]?.label ?? statusLabel(to) })} className="border-plum-600/40 ring-2 ring-plum-600/10">
      {shipping ? (
        <TextField label={tr("N° de suivi ZR Express (facultatif)")} value={tracking} onChange={(e) => setTracking(e.target.value)} placeholder={tr("ex : ZR123456789")} autoFocus />
      ) : (
        <>
          <div className="grid gap-1.5 sm:grid-cols-2">
            {reasons.map((r) => (
              <label key={r} className={`flex cursor-pointer items-center gap-2 rounded-xl border px-3 py-2.5 text-sm ${reason === r ? "border-plum-600 bg-rose-100/60" : "border-line bg-surface"}`}>
                <input type="radio" name="reason" className="accent-plum-600" checked={reason === r} onChange={() => setReason(r)} />
                {tr(OUTCOME_REASON_LABEL[r])}
              </label>
            ))}
          </div>
          <TextField label={tr("Précision (facultatif)")} className="mt-3" value={note} onChange={(e) => setNote(e.target.value)} maxLength={300} />
          {to !== "retour" && <p className="mt-2 text-xs text-ink-soft">{tr("Le stock réservé sera libéré.")}</p>}
        </>
      )}
      <div className="mt-3 flex gap-2">
        <Button
          variant={shipping ? "primary" : "danger"}
          loading={loading}
          disabled={!shipping && !reason}
          onClick={() => onConfirm(shipping ? { trackingNumber: tracking.trim() || undefined } : { reason: reason!, note: note.trim() || undefined })}
        >
          {tr("Confirmer")}
        </Button>
        <Button onClick={onCancel}>{tr("Annuler")}</Button>
      </div>
    </Card>
    </div>
  );
}

function EditOrder({ order, editable, onDone }: { order: OrderDetail["order"]; editable: boolean; onDone: () => void }) {

  const toast = useToast();
  const [form, setForm] = useState({
    name: order.name,
    phone: order.phone,
    address: order.address ?? "",
    trackingNumber: order.tracking_number ?? "",
    internalNote: order.internal_note ?? "",
    shippingPrice: order.shipping_price,
    deliveryType: order.delivery_type as "domicile" | "bureau",
    customerNote: order.customer_note ?? "",
    reason: "",
  });
  const save = useMutation({
    mutationFn: () =>
      patch(`/orders/${order.id}`, {
        name: form.name,
        phone: form.phone,
        address: form.address || null,
        trackingNumber: form.trackingNumber || null,
        internalNote: form.internalNote || null,
        shippingPrice: form.shippingPrice,
        deliveryType: form.deliveryType,
        customerNote: form.customerNote || null,
        reason: form.reason.trim() || undefined,
      }),
    onSuccess: () => {
      toast(tr("Commande modifiée"));
      onDone();
    },
    onError: (e) => toast(errorMessage(e), "error"),
  });
  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) => setForm((f) => ({ ...f, [k]: e.target.value }));
  return (
    <Card title={tr("Modifier la commande")}>
      <div className="grid gap-3 sm:grid-cols-2">
        {!editable && <p className="rounded-xl bg-stone-100 p-2.5 text-sm sm:col-span-2">{tr("🔒 Colis parti : seuls le suivi et les notes se modifient.")}</p>}
        <TextField label={tr("Nom")} value={form.name} onChange={set("name")} disabled={!editable} />
        <TextField label={tr("Téléphone")} value={form.phone} onChange={set("phone")} inputMode="tel" disabled={!editable} />
        <TextField label={tr("Adresse")} value={form.address} onChange={set("address")} className="sm:col-span-2" disabled={!editable} />
        <label className="text-sm font-medium">
          {tr("Mode")}
          <select className={`${inputCls} mt-1`} value={form.deliveryType} onChange={set("deliveryType")} disabled={!editable}>
            <option value="domicile">{tr("Domicile")}</option>
            <option value="bureau">{tr("Bureau (stop-desk)")}</option>
          </select>
        </label>
        <TextField label={tr("Frais de livraison (DA)")} type="number" value={form.shippingPrice} onChange={(e) => setForm((f) => ({ ...f, shippingPrice: Number(e.target.value) || 0 }))} disabled={!editable} />
        <TextField label={tr("N° de suivi ZR Express")} value={form.trackingNumber} onChange={set("trackingNumber")} className="sm:col-span-2" />
        <TextArea label={tr("Note de la cliente (affichée en évidence)")} value={form.customerNote} onChange={set("customerNote")} className="sm:col-span-2" rows={2} />
        <TextArea label={tr("Note interne (invisible pour la cliente)")} value={form.internalNote} onChange={set("internalNote")} className="sm:col-span-2" rows={2} />
        <TextField label={tr("Raison du changement (gardée dans l'historique)")} value={form.reason} onChange={set("reason")} className="sm:col-span-2" maxLength={300} />
      </div>
      <div className="mt-3 flex gap-2">
        <Button variant="primary" loading={save.isPending} onClick={() => save.mutate()}>{tr("Enregistrer")}</Button>
        <Button onClick={onDone}>{tr("Annuler")}</Button>
      </div>
    </Card>
  );
}
