import { formatDzPhone } from "@henine/shared";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { api, errorMessage, patch, post, put } from "../api";
import { ago, da, date, telLink, waLink } from "../lib/format";
import { useCan } from "../Shell";
import { Badge, Button, Card, Empty, ErrorState, ListSkeleton, NumberField, PageHeader, Pills, SearchBox, Sheet, Stat, StatusBadge, TextArea, TextField, Toggle, useToast } from "../ui";

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
}

export function CustomersPage() {
  const [segment, setSegment] = useState("all");
  const [q, setQ] = useState("");
  const [open, setOpen] = useState<number | null>(null);
  const list = useQuery({ queryKey: ["customers", segment, q], queryFn: () => api<CustomerRow[]>(`/customers?segment=${segment}&q=${encodeURIComponent(q)}`) });
  return (
    <div>
      <PageHeader group="Commandes" title="Clients" subtitle="Chaque numéro de téléphone = une cliente. Historique, fiabilité, points." />
      <Pills
        value={segment}
        onChange={setSegment}
        options={[
          { value: "all", label: "Toutes" }, { value: "vip", label: "VIP (3+ livrées)" }, { value: "fideles", label: "Fidèles" }, { value: "nouvelles", label: "Nouvelles" },
          { value: "risque", label: "À risque (retours)" }, { value: "inactives", label: "Inactives 60 j" }, { value: "blacklist", label: "Liste noire" },
        ]}
      />
      <SearchBox value={q} onChange={setQ} placeholder="Nom ou téléphone…" />
      {list.error ? <ErrorState error={list.error} onRetry={list.refetch} /> : !list.data ? <ListSkeleton /> : list.data.length === 0 ? <Empty title="Aucune cliente" /> : (
        <ul className="divide-y divide-line overflow-hidden rounded-2xl border border-line bg-white/70">
          {list.data.map((c) => (
            <li key={c.id}>
              <button type="button" onClick={() => setOpen(c.id)} className="flex w-full items-center justify-between gap-3 px-4 py-3 text-start hover:bg-rose-100/30">
                <span className="min-w-0">
                  <span className="block truncate font-medium">{c.name} {c.is_blacklisted ? "⛔" : ""}</span>
                  <span className="text-xs text-ink-soft">{formatDzPhone(c.phone)} · {c.wilaya ?? "—"} · {ago(c.last_order_at)}</span>
                </span>
                <span className="shrink-0 text-end text-sm">
                  <b className="tabular-nums">{da(c.total_spent)}</b>
                  <span className="block text-xs text-ink-soft">{c.delivered_count}/{c.orders_count} livrées{c.returned_count ? ` · ${c.returned_count} retour(s)` : ""}</span>
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
        orders: { id: number; public_code: string; status: string; total: number; channel: string; created_at: number }[];
        ledger: { id: number; delta: number; reason: string; note: string | null; created_at: number }[];
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
      toast("Fiche mise à jour");
      void qc.invalidateQueries({ queryKey: ["customer", id] });
      void qc.invalidateQueries({ queryKey: ["customers"] });
    },
    onError: (e) => toast(errorMessage(e), "error"),
  });
  const addPoints = useMutation({
    mutationFn: () => post(`/customers/${id}/points`, { delta: points ?? 0, note: pointsNote || "Ajustement manuel" }),
    onSuccess: () => {
      toast("Points mis à jour");
      setPoints(null);
      setPointsNote("");
      void qc.invalidateQueries({ queryKey: ["customer", id] });
    },
    onError: (e) => toast(errorMessage(e), "error"),
  });
  const c = q.data?.customer;
  return (
    <Sheet open onClose={onClose} title={c ? `${c.name}` : "Cliente"} wide>
      {!q.data || !c ? <ListSkeleton rows={4} /> : (
        <div className="space-y-4">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-mono">{formatDzPhone(c.phone)}</span>
            <a href={telLink(c.phone)} className="rounded-full bg-plum-600 px-3 py-1.5 text-sm font-semibold text-ivory">📞 Appeler</a>
            <a href={waLink(c.phone, `Bonjour ${c.name} 🌸 `)} target="_blank" rel="noreferrer" className="rounded-full bg-[#25D366] px-3 py-1.5 text-sm font-semibold text-white">WhatsApp</a>
            {c.is_blacklisted ? <Badge tone="bg-red-100 text-red-800">⛔ Liste noire</Badge> : null}
          </div>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            <Stat label="Commandes" value={c.orders_count} />
            <Stat label="Livrées" value={c.delivered_count} tone="good" />
            <Stat label="Retours" value={c.returned_count} tone={c.returned_count ? "warn" : undefined} />
            <Stat label="Total dépensé" value={da(c.total_spent)} />
          </div>
          <Card title="Commandes">
            <ul className="space-y-1.5 text-sm">
              {q.data.orders.map((o) => (
                <li key={o.id} className="flex items-center justify-between gap-2">
                  <a href={`/admin/commandes?o=${o.id}`} className="font-mono text-plum-600">{o.public_code}</a>
                  <span className="text-ink-soft">{date(o.created_at)}</span>
                  <span className="flex items-center gap-2"><b>{da(o.total)}</b><StatusBadge status={o.status} /></span>
                </li>
              ))}
            </ul>
          </Card>
          {can("customers.edit") && (
            <Card title="Notes & fiabilité">
              <TextArea label="Notes internes" value={notes} onChange={(e) => setNotes(e.target.value)} rows={3} />
              <Button className="mt-2" size="sm" onClick={() => save.mutate({ notes: notes || null })}>Enregistrer la note</Button>
              <div className="mt-4 border-t border-line pt-3">
                <Toggle
                  label="Liste noire"
                  hint="Ses prochaines commandes seront signalées ⛔ dans l'admin et sur Telegram."
                  checked={!!c.is_blacklisted}
                  onChange={(v) => save.mutate({ isBlacklisted: v, blacklistReason: v ? reason || "Non précisé" : null })}
                />
                {!!c.is_blacklisted && <TextField label="Raison" value={reason} onChange={(e) => setReason(e.target.value)} onBlur={() => save.mutate({ blacklistReason: reason || null })} />}
              </div>
            </Card>
          )}
          {can("loyalty.edit") && (
            <Card title={`Points fidélité : ${c.points_balance}`}>
              <div className="grid gap-2 sm:grid-cols-[8rem_1fr_auto] sm:items-end">
                <NumberField label="± points" min={-100000} value={points} onChange={setPoints} />
                <TextField label="Raison" value={pointsNote} onChange={(e) => setPointsNote(e.target.value)} />
                <Button onClick={() => addPoints.mutate()} disabled={!points} loading={addPoints.isPending}>Valider</Button>
              </div>
              {q.data.ledger.length > 0 && (
                <ul className="mt-3 space-y-1 text-sm">
                  {q.data.ledger.map((l) => (
                    <li key={l.id} className="flex justify-between"><span>{l.note ?? l.reason} · <span className="text-ink-soft">{date(l.created_at)}</span></span><b className={l.delta < 0 ? "text-red-700" : "text-emerald-700"}>{l.delta > 0 ? "+" : ""}{l.delta}</b></li>
                  ))}
                </ul>
              )}
            </Card>
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
  value: number;
  updated_at: number;
  last_contacted_at: number | null;
  recovered_code: string | null;
  items: { variantId: number; qty: number; name: string }[];
}

export function CartsPage() {
  const qc = useQueryClient();
  const [filter, setFilter] = useState("abandoned");
  const q = useQuery({ queryKey: ["carts", filter], queryFn: () => api<{ stats: { total: number; recovered: number; lost_value: number }; rows: CartRow[] }>(`/carts?filter=${filter}`) });
  const s = q.data?.stats;
  const origin = location.origin;
  return (
    <div>
      <PageHeader group="Commandes" title="Paniers abandonnés" subtitle="Clientes ayant commencé une commande sans la terminer (avec leur accord pour être recontactées)." />
      {s && (
        <div className="mb-4 grid grid-cols-3 gap-3">
          <Stat label="Paniers (30 j)" value={s.total} />
          <Stat label="Récupérés" value={s.recovered} tone="good" hint={s.total ? `${Math.round((s.recovered / s.total) * 100)} %` : undefined} />
          <Stat label="Valeur non récupérée" value={da(s.lost_value)} />
        </div>
      )}
      <Pills value={filter} onChange={setFilter} options={[{ value: "abandoned", label: "À relancer" }, { value: "recovered", label: "Récupérés" }, { value: "all", label: "Tous" }]} />
      {q.error ? <ErrorState error={q.error} onRetry={q.refetch} /> : !q.data ? <ListSkeleton /> : q.data.rows.length === 0 ? (
        <Empty title="Aucun panier" icon="🛒">Ils apparaissent quand une cliente saisit son numéro au paiement et coche « me recontacter ».</Empty>
      ) : (
        <ul className="space-y-2">
          {q.data.rows.map((c) => (
            <li key={c.id} className="rounded-2xl border border-line bg-white/70 p-4">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="font-semibold">{c.name ?? "Sans nom"} · <span className="font-mono text-sm">{formatDzPhone(c.phone)}</span></p>
                  <p className="text-sm text-ink-soft">{c.items.map((i) => `${i.name} ×${i.qty}`).join(", ")}</p>
                  <p className="text-xs text-ink-soft">{c.wilaya ?? "—"} · {ago(c.updated_at)}{c.last_contacted_at ? ` · relancée ${ago(c.last_contacted_at)}` : ""}</p>
                </div>
                <b className="shrink-0">{da(c.value)}</b>
              </div>
              {c.recovered_code ? (
                <Badge tone="bg-emerald-100 text-emerald-800">✓ Commande {c.recovered_code}</Badge>
              ) : (
                <a
                  href={waLink(c.phone, `Bonjour ${c.name ?? ""} 🌸 Ici Henine Boutique. Vous avez laissé des articles dans votre panier : ${c.items.map((i) => i.name).join(", ")}. Besoin d'aide pour finaliser ? ${origin}/panier`)}
                  target="_blank"
                  rel="noreferrer"
                  onClick={() => void post(`/carts/${c.id}/contacted`).then(() => qc.invalidateQueries({ queryKey: ["carts"] }))}
                  className="mt-2 inline-flex h-9 items-center rounded-full bg-[#25D366] px-4 text-sm font-semibold text-white"
                >
                  Relancer sur WhatsApp
                </a>
              )}
            </li>
          ))}
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
      toast("Programme fidélité enregistré");
      void qc.invalidateQueries({ queryKey: ["loyalty"] });
    },
    onError: (e) => toast(errorMessage(e), "error"),
  });
  if (q.error) return <ErrorState error={q.error} onRetry={q.refetch} />;
  if (!q.data || !s) return <ListSkeleton />;
  const pctBack = s.points_per_100da * s.redeem_value_da;
  return (
    <div className="space-y-4">
      <PageHeader group="Commandes" title="Fidélité" subtitle="Des points gagnés à chaque commande livrée (la livraison confirme le numéro)." />
      <div className="grid grid-cols-3 gap-3">
        <Stat label="Clientes avec points" value={q.data.stats.members} />
        <Stat label="Points en circulation" value={q.data.stats.outstanding} />
        <Stat label="Valeur (engagement)" value={da(q.data.stats.liabilityDa)} />
      </div>
      <Card title="Règles du programme">
        <Toggle label="Programme actif" hint="Les points sont crédités automatiquement quand une commande passe à « Livrée »." checked={s.enabled} onChange={(v) => setS({ ...s, enabled: v })} />
        <div className="mt-3 grid gap-3 sm:grid-cols-2">
          <NumberField label="Points gagnés par tranche de 100 DA" value={s.points_per_100da} onChange={(v) => setS({ ...s, points_per_100da: v ?? 0 })} />
          <NumberField label="Valeur d'un point" suffix="DA" value={s.redeem_value_da} onChange={(v) => setS({ ...s, redeem_value_da: v ?? 0 })} />
          <NumberField label="Minimum pour utiliser ses points" suffix="pts" value={s.min_redeem} onChange={(v) => setS({ ...s, min_redeem: v ?? 0 })} />
          <NumberField label="Expiration" suffix="jours" value={s.expiry_days} onChange={(v) => setS({ ...s, expiry_days: v ?? 0 })} />
        </div>
        <p className="mt-3 rounded-xl bg-rose-100 p-3 text-sm text-plum-700">
          Exemple : une commande de 10 000 DA livrée rapporte <b>{Math.floor(10000 / 100) * s.points_per_100da} points</b>, soit {da(Math.floor(10000 / 100) * s.points_per_100da * s.redeem_value_da)} de réduction ({pctBack} % reversé).
        </p>
        <p className="mt-2 text-xs text-ink-soft">L'utilisation des points au paiement arrive dans une prochaine étape ; en attendant, appliquez-les manuellement (fiche cliente → points).</p>
        <Button variant="primary" className="mt-3" loading={save.isPending} onClick={() => save.mutate()}>Enregistrer</Button>
      </Card>
      <Card title="Meilleures clientes">
        {q.data.top.length === 0 ? <p className="text-sm text-ink-soft">Aucune cliente n'a encore de points.</p> : (
          <ol className="space-y-1.5 text-sm">
            {q.data.top.map((c, i) => (
              <li key={c.id} className="flex justify-between gap-2"><span>{i + 1}. {c.name} <span className="text-ink-soft">({c.delivered_count} livrées)</span></span><b>{c.points_balance} pts</b></li>
            ))}
          </ol>
        )}
      </Card>
    </div>
  );
}
