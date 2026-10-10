import { formatDzPhone, OUTCOME_REASON_LABEL, type CustomerSegment, type OutcomeReason, type RiskAssessment, type RiskLevel } from "@henine/shared";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate, useSearch } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { api, del, errorMessage, patch, post, put } from "../api";
import { ago, da, date, ltr, telLink, waLink } from "../lib/format";
import { RiskBadge, RiskPanel, SegmentBadge } from "../lib/risk";
import { useCan, useMe } from "../Shell";
import { Badge, Button, Card, Empty, ErrorState, ListSkeleton, NumberField, PageHeader, Pills, SearchBox, Sheet, Stat, StatusBadge, TextArea, TextField, Toggle, useToast, useIsOwner } from "../ui";
import { tr } from "../i18n";

/* ───────────── Clients ───────────── */

interface CustomerRow {
  id: number;
  name: string;
  phone: string;
  wilaya: string | null;
  orders_count: number;
  delivered_count: number;
  returned_count: number;
  total_spent: number;
  points_balance: number;
  is_blacklisted: number;
  last_order_at: number | null;
  segment: CustomerSegment;
  risk: { level: RiskLevel; score: number };
}

const SEGMENTS = [
  { value: "all", label: tr("Toutes") },
  { value: "new", label: tr("Nouvelles") },
  { value: "returning", label: tr("Fidèles") },
  { value: "vip", label: tr("VIP") },
  { value: "high_spender", label: tr("💰 Gros paniers") },
  { value: "abandoned", label: tr("🛒 Panier abandonné") },
  { value: "high_risk", label: tr("Risque élevé") },
  { value: "inactives", label: tr("😴 Inactives 60 j") },
  { value: "blacklist", label: tr("Liste noire") },
];

export function CustomersPage() {
  const [segment, setSegment] = useState("all");
  // ?c=12 opens that customer, ?q= fills the search (links from the search bar)
  const navigate = useNavigate();
  const search = useSearch({ strict: false }) as { c?: number; q?: string | number };
  const [q, setQ] = useState(search.q != null ? String(search.q) : "");
  useEffect(() => {
    if (search.q != null) setQ(String(search.q));
  }, [search.q]);
  const open = search.c ?? null;
  const setOpen = (id: number | null) => void navigate({ to: "/clients", search: (s: Record<string, unknown>) => ({ ...s, c: id ?? undefined }) });
  const list = useQuery({
    queryKey: ["customers", segment, q],
    queryFn: () => api<{ counts: Record<string, number>; rows: CustomerRow[] }>(`/customers?segment=${segment}&q=${encodeURIComponent(q)}`),
  });
  const counts = list.data?.counts;
  return (
    <div>
      <PageHeader
        group={tr("Commandes")}
        title={tr("Clients")}
        subtitle={tr("Chaque numéro de téléphone = une cliente. Segments calculés sur l'historique réel (VIP : 3 livrées ou 25 000 DA dépensés ; gros panier : 6 000 DA en moyenne par commande livrée).")}
      />
      <Pills
        value={segment}
        onChange={setSegment}
        options={SEGMENTS.map((s) => ({
          value: s.value,
          label: counts ? `${s.label} (${s.value === "all" ? counts.all_count : (counts[s.value] ?? 0)})` : s.label,
        }))}
      />
      <SearchBox value={q} onChange={setQ} placeholder={tr("Nom ou téléphone…")} />
      {list.error ? <ErrorState error={list.error} onRetry={list.refetch} /> : !list.data ? <ListSkeleton /> : list.data.rows.length === 0 ? <Empty title={tr("Aucune cliente")} /> : (
        <ul className="divide-y divide-line overflow-hidden rounded-xl border border-line bg-surface">
          {list.data.rows.map((c) => (
            <li key={c.id}>
              <button type="button" onClick={() => setOpen(c.id)} className="flex w-full items-center justify-between gap-3 px-4 py-3 text-start hover:bg-rose-100/30">
                <span className="min-w-0">
                  <span className="block truncate font-medium">{c.name} {c.is_blacklisted ? "⛔" : ""}</span>
                  <span className="text-xs text-ink-soft"><bdi dir="ltr">{formatDzPhone(c.phone)}</bdi> · {c.wilaya ?? "—"} · {ago(c.last_order_at)}</span>
                  <span className="mt-1 flex flex-wrap gap-1 text-xs">
                    <SegmentBadge segment={c.segment} />
                    {c.risk.level !== "low" && <RiskBadge level={c.risk.level} />}
                  </span>
                </span>
                <span className="shrink-0 text-end text-sm">
                  <b className="tabular-nums">{da(c.total_spent)}</b>
                  <span className="block text-xs text-ink-soft">{c.delivered_count}/{c.orders_count} {tr("livrées")}{c.returned_count ? tr(" · {0} retour(s)", { 0: c.returned_count }) : ""}</span>
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
      {open != null && <CustomerSheet id={open} onClose={() => setOpen(null)} />}
    </div>
  );
}

function CustomerSheet({ id, onClose }: { id: number; onClose: () => void }) {
  const qc = useQueryClient();
  const toast = useToast();
  const can = useCan();
  const q = useQuery({
    queryKey: ["customer", id],
    queryFn: () =>
      api<{
        customer: CustomerRow & { notes: string | null; blacklist_reason: string | null; cancelled_count: number; created_at: number };
        orders: { id: number; public_code: string; status: string; total: number; channel: string; created_at: number; outcome_reason: string | null }[];
        ledger: { id: number; delta: number; reason: string; note: string | null; created_at: number }[];
        risk: RiskAssessment;
        segment: CustomerSegment;
      }>(`/customers/${id}`),
  });
  const [notes, setNotes] = useState("");
  const [reason, setReason] = useState("");
  const [points, setPoints] = useState<number | null>(null);
  const [pointsNote, setPointsNote] = useState("");
  useEffect(() => {
    if (q.data) {
      setNotes(q.data.customer.notes ?? "");
      setReason(q.data.customer.blacklist_reason ?? "");
    }
  }, [q.data]);
  const save = useMutation({
    mutationFn: (body: Record<string, unknown>) => patch(`/customers/${id}`, body),
    onSuccess: () => {
      toast(tr("Fiche mise à jour"));
      void qc.invalidateQueries({ queryKey: ["customer", id] });
      void qc.invalidateQueries({ queryKey: ["customers"] });
    },
    onError: (e) => toast(errorMessage(e), "error"),
  });
  const addPoints = useMutation({
    mutationFn: () => post(`/customers/${id}/points`, { delta: points ?? 0, note: pointsNote || "Ajustement manuel" }),
    onSuccess: () => {
      toast(tr("Points mis à jour"));
      setPoints(null);
      setPointsNote("");
      void qc.invalidateQueries({ queryKey: ["customer", id] });
    },
    onError: (e) => toast(errorMessage(e), "error"),
  });
  const c = q.data?.customer;
  const owner = useMe().data?.role === "owner";
  const remove = useMutation({
    mutationFn: () => del(`/customers/${id}`),
    onSuccess: () => {
      toast(tr("Cliente supprimée"));
      void qc.invalidateQueries({ queryKey: ["customers"] });
      onClose();
    },
    onError: (e) => toast(errorMessage(e), "error"),
  });
  return (
    <Sheet open onClose={onClose} title={c ? `${c.name}` : tr("Cliente")} wide>
      {!q.data || !c ? <ListSkeleton rows={4} /> : (
        <div className="space-y-4">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-mono"><bdi dir="ltr">{formatDzPhone(c.phone)}</bdi></span>
            <a href={telLink(c.phone)} className="rounded-full bg-plum-600 px-3 py-1.5 text-sm font-semibold text-white">{tr("📞 Appeler")}</a>
            <a href={waLink(c.phone, `Bonjour ${c.name} 🌸 `)} target="_blank" rel="noreferrer" className="rounded-full bg-[#25D366] px-3 py-1.5 text-sm font-semibold text-white">{tr("WhatsApp")}</a>
            {c.is_blacklisted ? <Badge tone="bg-red-100 text-red-800">{tr("⛔ Liste noire")}</Badge> : null}
            <SegmentBadge segment={q.data.segment} />
          </div>
          <RiskPanel risk={q.data.risk} />
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            <Stat label={tr("Commandes")} value={c.orders_count} />
            <Stat label={tr("Livrées")} value={c.delivered_count} tone="good" />
            <Stat label={tr("Retours")} value={c.returned_count} tone={c.returned_count ? "warn" : undefined} />
            <Stat label={tr("Total dépensé")} value={da(c.total_spent)} />
          </div>
          <Card title={tr("Commandes")}>
            <ul className="space-y-1.5 text-sm">
              {q.data.orders.map((o) => (
                <li key={o.id} className="flex items-center justify-between gap-2">
                  <a href={`/admin/commandes?o=${o.id}`} className="font-mono text-plum-600">{o.public_code}</a>
                  <span className="text-ink-soft">
                    {date(o.created_at)}
                    {o.outcome_reason ? ` · ${tr(OUTCOME_REASON_LABEL[o.outcome_reason as OutcomeReason]) ?? o.outcome_reason}` : ""}
                  </span>
                  <span className="flex items-center gap-2"><b>{da(o.total)}</b><StatusBadge status={o.status} /></span>
                </li>
              ))}
            </ul>
          </Card>
          {can("customers.edit") && (
            <Card title={tr("Notes & fiabilité")}>
              <TextArea label={tr("Notes internes")} value={notes} onChange={(e) => setNotes(e.target.value)} rows={3} />
              <Button className="mt-2" size="sm" onClick={() => save.mutate({ notes: notes || null })}>{tr("Enregistrer la note")}</Button>
              <div className="mt-4 border-t border-line pt-3">
                <Toggle
                  label={tr("Liste noire")}
                  hint={tr("Ses prochaines commandes seront signalées ⛔ dans l'admin et sur Telegram.")}
                  checked={!!c.is_blacklisted}
                  onChange={(v) => save.mutate({ isBlacklisted: v, blacklistReason: v ? reason || "Non précisé" : null })}
                />
                {!!c.is_blacklisted && <TextField label={tr("Raison")} value={reason} onChange={(e) => setReason(e.target.value)} onBlur={() => save.mutate({ blacklistReason: reason || null })} />}
              </div>
            </Card>
          )}
          {can("loyalty.edit") && (
            <Card title={tr("Points fidélité : {0}", { 0: c.points_balance })}>
              <div className="grid gap-2 sm:grid-cols-[8rem_1fr_auto] sm:items-end">
                <NumberField label={tr("± points")} min={-100000} value={points} onChange={setPoints} />
                <TextField label={tr("Raison")} value={pointsNote} onChange={(e) => setPointsNote(e.target.value)} />
                <Button onClick={() => addPoints.mutate()} disabled={!points} loading={addPoints.isPending}>{tr("Valider")}</Button>
              </div>
              {q.data.ledger.length > 0 && (
                <ul className="mt-3 space-y-1 text-sm">
                  {q.data.ledger.map((l) => (
                    <li key={l.id} className="flex justify-between"><span>{tr(LEDGER_LABEL[l.reason] ?? l.reason)}{l.note ? ` · ${l.note}` : ""} · <span className="text-ink-soft">{date(l.created_at)}</span></span><b className={l.delta < 0 ? "text-red-700" : "text-emerald-700"}>{l.delta > 0 ? "+" : ""}{l.delta}</b></li>
                  ))}
                </ul>
              )}
            </Card>
          )}
          {owner && (
            <div className="border-t border-line pt-3">
              <Button ownerOnly
                variant="danger"
                loading={remove.isPending}
                onClick={() =>
                  confirm(tr("Supprimer la fiche de {0} ? Ses commandes restent dans l'historique (sous « Clientes sans fiche »), ses points de fidélité sont perdus.", { 0: c?.name ?? "" })) &&
                  remove.mutate()
                }
              >
                {tr("🗑 Supprimer la cliente")}
              </Button>
            </div>
          )}
        </div>
      )}
    </Sheet>
  );
}

/* ───────────── Paniers ───────────── */

interface CartRow {
  id: string;
  phone: string;
  name: string | null;
  wilaya: string | null;
  commune: string | null;
  delivery_type: string | null;
  channel: string | null;
  step: string | null;
  value: number;
  created_at: number;
  updated_at: number;
  last_contacted_at: number | null;
  recovered_code: string | null;
  customer_orders: number;
  items: { variantId: number; qty: number; name: string }[];
  locale: string | null;
}

/** "نسيت شيئًا في سلتك 🛒": the reminder in her language, with the link that refills her cart. */
function reminderText(c: CartRow): string {
  const ar = c.locale !== "fr";
  const link = `${location.origin}${ar ? "" : "/fr"}/panier?r=${c.id}`;
  const items = c.items.map((i) => i.name).join(ar ? "، " : ", ");
  if (ar) {
    return `السلام عليكم ${c.name ?? ""} 🌸\nنسيتِ شيئًا في سلتك 🛒: ${items}.\nأكملي طلبك من هنا: ${link}\nHenine Boutique`;
  }
  return `Bonjour ${c.name ?? ""} 🌸\nVous avez oublié quelque chose dans votre panier 🛒 : ${items}.\nTerminez votre commande ici : ${link}\nHenine Boutique`;
}

const STEP_LABEL: Record<string, [string, number]> = {
  details: [tr("Coordonnées saisies"), 1],
  address: ["Wilaya choisie", 2],
  delivery: ["Commune / livraison", 3],
  ready: [tr("Formulaire complet, non envoyé"), 4],
  checkout: [tr("Coordonnées saisies"), 1],
};

export function CartsPage() {
  const owner = useIsOwner();
  const qc = useQueryClient();
  const [filter, setFilter] = useState("abandoned");
  const q = useQuery({
    queryKey: ["carts", filter],
    queryFn: () => api<{ stats: { total: number; recovered: number; lost_value: number }; rows: CartRow[] }>(`/carts?filter=${filter}`),
    refetchInterval: 60_000,
  });
  const s = q.data?.stats;
  return (
    <div>
      <PageHeader
        group={tr("Commandes")}
        title={tr("Paniers abandonnés")}
        subtitle={tr("Commandes commencées (numéro saisi) mais non envoyées depuis 30 min. Aucun message automatique : c'est vous qui décidez de rappeler.")}
      />
      {s && (
        <div className="mb-4 grid grid-cols-3 gap-3">
          <Stat label={tr("Paniers (30 j)")} value={s.total} />
          <Stat label={tr("Récupérés")} value={s.recovered} tone="good" hint={s.total ? `${Math.round((s.recovered / s.total) * 100)} %` : undefined} />
          <Stat label={tr("Valeur non récupérée")} value={da(s.lost_value)} />
        </div>
      )}
      <Pills
        value={filter}
        onChange={setFilter}
        options={[{ value: "abandoned", label: tr("À relancer") }, { value: "active", label: tr("En cours (< 30 min)") }, { value: "recovered", label: tr("Récupérés") }, { value: "all", label: tr("Tous") }]}
      />
      {q.error ? <ErrorState error={q.error} onRetry={q.refetch} /> : !q.data ? <ListSkeleton /> : q.data.rows.length === 0 ? (
        <Empty title={tr("Aucun panier")} icon="🛒">{tr("Ils apparaissent quand une cliente saisit un numéro valide au moment de commander, sans envoyer la commande.")}</Empty>
      ) : (
        <ul className="space-y-2">
          {q.data.rows.map((c) => {
            const [stepLabel, stepN] = STEP_LABEL[c.step ?? "details"] ?? ["—", 1];
            return (
            <li key={c.id} className="rounded-xl border border-line bg-surface p-4">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="font-semibold">{c.name ?? tr("Sans nom")} · <span className="font-mono text-sm"><bdi dir="ltr">{formatDzPhone(c.phone)}</bdi></span></p>
                  <p className="text-sm text-ink-soft">{c.items.map((i) => `${i.name} ×${i.qty}`).join(", ")}</p>
                  <p className="text-xs text-ink-soft">
                    📍 {c.wilaya ?? tr("wilaya non choisie")}{c.commune ? ` › ${c.commune}` : ""}{c.delivery_type ? ` · ${c.delivery_type === "bureau" ? "Bureau" : "Domicile"}` : ""}
                    {c.channel === "express" ? tr(" · commande express") : ""}
                  </p>
                  <p className="text-xs text-ink-soft">
                    {tr("Dernière activité")} {ago(c.updated_at)}{c.last_contacted_at ? tr(" · relancée {0}", { 0: ago(c.last_contacted_at) }) : ""}
                    {c.customer_orders ? tr(" · {0} commande(s) passée(s)", { 0: c.customer_orders }) : tr(" · jamais commandé")}
                  </p>
                  <div className="mt-1.5 flex items-center gap-2 text-xs">
                    <span className="flex gap-0.5" aria-hidden="true">
                      {[1, 2, 3, 4].map((n) => <span key={n} className={`h-1.5 w-5 rounded-full ${n <= stepN ? "bg-plum-600" : "bg-line"}`} />)}
                    </span>
                    <span className="text-ink-soft">{stepLabel}</span>
                  </div>
                </div>
                <b className="shrink-0">{da(c.value)}</b>
              </div>
              {c.recovered_code ? (
                <Badge tone="bg-emerald-100 text-emerald-800">{tr("✓ Commande")} {c.recovered_code}</Badge>
              ) : (
                <div className="mt-2 flex flex-wrap gap-2">
                <a href={telLink(c.phone)} onClick={() => void post(`/carts/${c.id}/contacted`).then(() => qc.invalidateQueries({ queryKey: ["carts"] }))} className="inline-flex h-9 items-center rounded-lg bg-plum-600 px-4 text-sm font-semibold text-white">
                  {tr("📞 Appeler")}
                </a>
                <a
                  href={waLink(c.phone, reminderText(c))}
                  target="_blank"
                  rel="noreferrer"
                  onClick={() => void post(`/carts/${c.id}/contacted`).then(() => qc.invalidateQueries({ queryKey: ["carts"] }))}
                  className="inline-flex h-9 items-center rounded-lg bg-[#25D366] px-4 text-sm font-semibold text-white"
                >
                  {tr("WhatsApp")}
                </a>
                <button
                  type="button"
                  hidden={!owner}
                  onClick={() => confirm(tr("Supprimer ce panier de la liste ?")) && void del(`/carts/${c.id}`).then(() => qc.invalidateQueries({ queryKey: ["carts"] }))}
                  className="ms-auto inline-flex h-9 items-center rounded-lg border border-line px-3 text-sm font-semibold text-red-700"
                >
                  {tr("🗑 Supprimer")}
                </button>
                </div>
              )}
              {c.recovered_code && (
                <button
                  type="button"
                  hidden={!owner}
                  onClick={() => confirm(tr("Supprimer ce panier de la liste ?")) && void del(`/carts/${c.id}`).then(() => qc.invalidateQueries({ queryKey: ["carts"] }))}
                  className="ms-2 text-xs font-semibold text-red-700 underline"
                >
                  {tr("🗑 Supprimer")}
                </button>
              )}
            </li>
            );
          })}
        </ul>

      )}
    </div>
  );
}

/* ───────────── Fidélité ───────────── */

interface LoyaltySettings {
  enabled: boolean;
  points_per_100da: number;
  redeem_value_da: number;
  min_redeem: number;
  expiry_days: number;
}

/** Lines of a customer's points history. */
const LEDGER_LABEL: Record<string, string> = {
  order: "🛍️ Commande livrée",
  redeem: "🎁 Points utilisés",
  manual: "✏️ Ajustement",
  expiry: "⌛ Points expirés",
  reversal: "↩️ Commande annulée",
  referral: "👭 Parrainage",
  birthday: "🎂 Anniversaire",
};

export function LoyaltyPage() {
  const qc = useQueryClient();
  const toast = useToast();
  const q = useQuery({ queryKey: ["loyalty"], queryFn: () => api<{ settings: LoyaltySettings; top: { id: number; name: string; phone: string; points_balance: number; delivered_count: number; total_spent: number }[]; stats: { outstanding: number; members: number; liabilityDa: number } }>("/loyalty") });
  const [s, setS] = useState<LoyaltySettings | null>(null);
  useEffect(() => {
    if (q.data) setS(q.data.settings);
  }, [q.data]);
  const save = useMutation({
    mutationFn: () => put("/loyalty", s),
    onSuccess: () => {
      toast(tr("Programme fidélité enregistré"));
      void qc.invalidateQueries({ queryKey: ["loyalty"] });
    },
    onError: (e) => toast(errorMessage(e), "error"),
  });
  if (q.error) return <ErrorState error={q.error} onRetry={q.refetch} />;
  if (!q.data || !s) return <ListSkeleton />;
  const pctBack = s.points_per_100da * s.redeem_value_da;
  return (
    <div className="space-y-4">
      <PageHeader group={tr("Commandes")} title={tr("Fidélité")} subtitle={tr("Des points gagnés à chaque commande livrée (la livraison confirme le numéro).")} />
      <div className="grid grid-cols-3 gap-3">
        <Stat label={tr("Clientes avec points")} value={q.data.stats.members} />
        <Stat label={tr("Points en circulation")} value={q.data.stats.outstanding} />
        <Stat label={tr("Valeur (engagement)")} value={da(q.data.stats.liabilityDa)} />
      </div>
      <Card title={tr("Règles du programme")}>
        <Toggle label={tr("Programme actif")} hint={tr("Les points sont crédités automatiquement quand une commande passe à « Livrée ».")} checked={s.enabled} onChange={(v) => setS({ ...s, enabled: v })} />
        <p className="mt-4 text-sm font-medium">{tr("Ce que la cliente récupère sur chaque commande livrée")}</p>
        <div className="mt-2 flex flex-wrap gap-2">
          {[2, 3, 5, 10].map((pct) => (
            <button
              key={pct}
              type="button"
              aria-pressed={pctBack === pct}
              onClick={() => setS({ ...s, points_per_100da: 1, redeem_value_da: pct })}
              className={`h-11 min-w-20 rounded-xl border px-4 text-sm font-semibold transition ${pctBack === pct ? "border-plum-600 bg-plum-600 text-white" : "border-line bg-surface hover:border-plum-600/40"}`}
            >
              {ltr(`${pct} %`)}
            </button>
          ))}
        </div>
        <p className="mt-3 rounded-xl bg-rose-100 p-3 text-sm text-plum-700">
          {tr("Exemple : pour une commande de 10 000 DA livrée, la cliente gagne")} <b>{da(Math.floor(10000 / 100) * s.points_per_100da * s.redeem_value_da)}</b>{" "}
          {tr("à déduire d'une prochaine commande, dès")} {da(s.min_redeem * s.redeem_value_da)} {tr("cumulés.")}
        </p>
        <p className="mt-4 text-sm font-medium">{tr("Validité des points")}</p>
        <div className="mt-2 flex flex-wrap gap-2">
          {(
            [
              [90, tr("3 mois")],
              [180, tr("6 mois")],
              [365, tr("1 an")],
              [730, tr("2 ans")],
              [0, tr("Jamais")],
            ] as [number, string][]
          ).map(([days, label]) => (
            <button
              key={days}
              type="button"
              aria-pressed={s.expiry_days === days}
              onClick={() => setS({ ...s, expiry_days: days })}
              className={`h-11 min-w-20 rounded-xl border px-4 text-sm font-semibold transition ${s.expiry_days === days ? "border-plum-600 bg-plum-600 text-white" : "border-line bg-surface hover:border-plum-600/40"}`}
            >
              {label}
            </button>
          ))}
        </div>
        <p className="mt-1.5 text-xs text-ink-soft">
          {s.expiry_days > 0
            ? tr("Les points gagnés il y a plus longtemps et pas encore utilisés disparaissent chaque soir (les plus anciens d'abord). C'est noté dans l'historique de la cliente.")
            : tr("Les points restent valables sans limite.")}
        </p>
        <details className="mt-3 text-sm">
          <summary className="cursor-pointer font-medium text-ink-soft">{tr("Réglages avancés")}</summary>
          <div className="mt-3 grid gap-3 sm:grid-cols-3">
            <NumberField label={tr("Points gagnés par tranche de 100 DA")} value={s.points_per_100da} onChange={(v) => setS({ ...s, points_per_100da: v ?? 0 })} />
            <NumberField label={tr("Valeur d'un point")} suffix={tr("DA")} value={s.redeem_value_da} onChange={(v) => setS({ ...s, redeem_value_da: v ?? 0 })} />
            <NumberField label={tr("Minimum pour utiliser ses points")} suffix={tr("pts")} value={s.min_redeem} onChange={(v) => setS({ ...s, min_redeem: v ?? 0 })} />
          </div>
        </details>
        <Button variant="primary" className="mt-3" loading={save.isPending} onClick={() => save.mutate()}>{tr("Enregistrer")}</Button>
      </Card>
      <Card title={tr("Meilleures clientes")}>
        {q.data.top.length === 0 ? <p className="text-sm text-ink-soft">{tr("Aucune cliente n'a encore de points.")}</p> : (
          <ol className="space-y-1.5 text-sm">
            {q.data.top.map((c, i) => (
              <li key={c.id} className="flex justify-between gap-2"><span>{i + 1}. {c.name} <span className="text-ink-soft">({c.delivered_count} {tr("livrées)")}</span></span><b>{c.points_balance} {tr("pts")}</b></li>
            ))}
          </ol>
        )}
      </Card>
    </div>
  );
}
