/**
 * Expéditions: failed deliveries to follow up (the call-back queue) and the courier hand-over
 * sheets (bordereaux d'envoi). Contacts are written in the order's history; handing a sheet
 * over marks its orders "expédiée" (the API does it, through the normal order steps).
 */
import {
  FAILED_DELIVERY_REASON_LABEL,
  FAILED_DELIVERY_REASONS,
  FOLLOWUP_STATUS_LABEL,
  MANIFEST_STATUS_LABEL,
  type ContactKind,
  type FailedDeliveryReason,
  type FollowupStatus,
  type ManifestStatus,
} from "@henine/shared";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useNavigate, useSearch } from "@tanstack/react-router";
import { useState } from "react";
import { api, errorMessage, patch, post } from "../api";
import { isAr, tr } from "../i18n";
import { ago, da, dateTime, statusLabel, telLink, waLink } from "../lib/format";
import { useCan } from "../Shell";
import { Badge, Button, Card, Empty, ErrorState, inputCls, ListSkeleton, PageHeader, Pills, Select, Sheet, Stat, TextArea, TextField, useToast } from "../ui";

type Tab = "echecs" | "bordereaux";

export function LogisticsPage() {
  const navigate = useNavigate();
  const search = useSearch({ strict: false }) as { tab?: string; m?: number };
  const tab: Tab = search.tab === "bordereaux" ? "bordereaux" : "echecs";
  const tabs: { key: Tab; label: string }[] = [
    { key: "echecs", label: tr("📞 Échecs de livraison") },
    { key: "bordereaux", label: tr("📋 Bordereaux d'envoi") },
  ];
  return (
    <div className="space-y-4">
      <PageHeader group={tr("Commandes")} title={tr("Expéditions")} subtitle={tr("Les colis qui partent chez le livreur, et ceux qu'il n'a pas pu livrer.")} />
      <div className="-mx-4 overflow-x-auto border-b border-line px-4 md:mx-0 md:px-0" role="tablist" aria-label={tr("Expéditions")}>
        <div className="flex w-max gap-1">
          {tabs.map((t) => (
            <button
              key={t.key}
              type="button"
              role="tab"
              aria-selected={tab === t.key}
              onClick={() => void navigate({ to: "/expeditions", search: { tab: t.key } as never })}
              className={`-mb-px border-b-2 px-3.5 py-2.5 text-sm font-semibold transition ${tab === t.key ? "border-plum-600 text-plum-700" : "border-transparent text-ink-soft hover:text-ink"}`}
            >
              {t.label}
            </button>
          ))}
        </div>
      </div>
      {tab === "echecs" ? <FollowupQueue /> : <Manifests open={search.m} />}
    </div>
  );
}

/* ───────────── Failed deliveries ───────────── */

interface Followup {
  id: number; order_id: number; reason: FailedDeliveryReason; status: FollowupStatus; attempts: number; last_attempt_at: number; next_action_at: number | null;
  assigned_to: number | null; assigned_name: string | null; escalated: number; note: string | null; created_at: number; closed_at: number | null;
  public_code: string; order_status: string; name: string; phone: string; total: number; tracking_number: string | null; wilaya: string | null; wilaya_ar: string | null;
  contacts: number; last_contact_at: number | null;
}

const FU_TONE: Record<FollowupStatus, string> = {
  needs_contact: "bg-red-100 text-red-800",
  contacted: "bg-sky-100 text-sky-800",
  callback: "bg-amber-100 text-amber-900",
  retry_requested: "bg-violet-100 text-violet-800",
  unreachable: "bg-stone-200 text-stone-800",
  resolved: "bg-emerald-100 text-emerald-800",
  cancelled: "bg-stone-200 text-stone-700",
};

function FollowupQueue() {
  const can = useCan();
  const [filter, setFilter] = useState("due");
  const q = useQuery({
    queryKey: ["followups", filter],
    queryFn: () => api<{ rows: Followup[]; counts: { open: number; due: number; escalated: number } }>(`/followups?status=${filter}`),
    refetchInterval: 60_000,
  });
  const [working, setWorking] = useState<Followup | null>(null);
  const counts = q.data?.counts;
  return (
    <div className="space-y-4">
      {counts && (
        <div className="grid grid-cols-3 gap-3">
          <Stat label={tr("À rappeler maintenant")} value={counts.due} tone={counts.due ? "warn" : "good"} />
          <Stat label={tr("En cours de suivi")} value={counts.open} />
          <Stat label={tr("Escaladés")} value={counts.escalated} tone={counts.escalated ? "warn" : undefined} />
        </div>
      )}
      <Pills
        value={filter}
        onChange={setFilter}
        options={[
          { value: "due", label: tr("À traiter maintenant") },
          { value: "open", label: tr("Tous les suivis ouverts") },
          { value: "resolved", label: tr("Résolus") },
          { value: "all", label: tr("Tous") },
        ]}
      />
      {q.error ? (
        <ErrorState error={q.error} onRetry={q.refetch} />
      ) : !q.data ? (
        <ListSkeleton />
      ) : !q.data.rows.length ? (
        <Empty icon="🚚" title={filter === "due" ? tr("Personne à rappeler maintenant") : tr("Aucune livraison échouée")}>
          {tr("Quand le livreur n'arrive pas à livrer, notez-le sur la commande (« Échec de livraison ») : elle arrive ici.")}
        </Empty>
      ) : (
        <ul className="space-y-2">
          {q.data.rows.map((f) => {
            const due = f.next_action_at != null && f.next_action_at <= Date.now() && !f.closed_at;
            return (
              <li key={f.id} className={`rounded-xl border bg-surface p-3 ${f.escalated ? "border-red-300" : "border-line"}`}>
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <span className="min-w-0">
                    <span className="flex flex-wrap items-center gap-2">
                      <b><bdi>{f.name}</bdi></b>
                      <Badge tone={FU_TONE[f.status]}>{tr(FOLLOWUP_STATUS_LABEL[f.status])}</Badge>
                      {!!f.escalated && <Badge tone="bg-red-600 text-white">{tr("Escaladé")}</Badge>}
                    </span>
                    <span className="mt-0.5 block text-xs text-ink-soft">
                      <Link to="/commandes" search={{ o: f.order_id } as never} className="font-mono text-plum-700 hover:underline">
                        {f.public_code}
                      </Link>{" "}
                      · {statusLabel(f.order_status)} · {da(f.total)} · {(isAr ? f.wilaya_ar : f.wilaya) ?? "—"}
                    </span>
                  </span>
                  <span className="text-end text-xs">
                    <span className={due ? "font-semibold text-red-700" : "text-ink-soft"}>
                      {f.next_action_at ? (due ? tr("À rappeler maintenant") : tr("Rappel {0}", { 0: dateTime(f.next_action_at) })) : ""}
                    </span>
                    <span className="block text-ink-soft">{f.assigned_name ? tr("Suivi par {0}", { 0: f.assigned_name }) : tr("Non attribué")}</span>
                  </span>
                </div>
                <p className="mt-2 text-sm">
                  🚚 {tr(FAILED_DELIVERY_REASON_LABEL[f.reason])} · {tr("{0} tentative(s)", { 0: f.attempts })} · {tr("dernière {0}", { 0: ago(f.last_attempt_at) })}
                  {f.contacts > 0 && <span className="text-ink-soft"> · {tr("{0} contact(s), le dernier {1}", { 0: f.contacts, 1: ago(f.last_contact_at) })}</span>}
                </p>
                {f.note && <p className="mt-1 text-xs text-ink-soft">📝 {f.note}</p>}
                <div className="mt-2.5 flex flex-wrap gap-2">
                  <a href={telLink(f.phone)} className="inline-flex h-10 items-center rounded-lg border border-line px-3 text-sm font-semibold" dir="ltr">
                    📞 {f.phone}
                  </a>
                  <a
                    href={waLink(f.phone, tr("Bonjour {0}, le livreur n'a pas pu vous livrer votre commande {1} de Henine Boutique. Quand êtes-vous disponible ?", { 0: f.name, 1: f.public_code }))}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex h-10 items-center rounded-lg border border-line px-3 text-sm font-semibold"
                  >
                    💬 WhatsApp
                  </a>
                  {can("orders.edit") && !f.closed_at && (
                    <Button variant="primary" onClick={() => setWorking(f)}>
                      {tr("Noter le résultat")}
                    </Button>
                  )}
                  {can("orders.edit") && f.closed_at && <Button onClick={() => setWorking(f)}>{tr("Rouvrir")}</Button>}
                </div>
              </li>
            );
          })}
        </ul>
      )}
      {working && <FollowupSheet f={working} onClose={() => setWorking(null)} />}
    </div>
  );
}

const toLocalInput = (ts: number) => new Date(ts - new Date().getTimezoneOffset() * 60_000).toISOString().slice(0, 16);

function FollowupSheet({ f, onClose }: { f: Followup; onClose: () => void }) {
  const qc = useQueryClient();
  const toast = useToast();
  const assignees = useQuery({ queryKey: ["followup-assignees"], queryFn: () => api<{ id: number; name: string }[]>("/followups/assignees"), staleTime: 5 * 60_000 });
  const [contact, setContact] = useState<ContactKind | "">(f.closed_at ? "" : "call");
  const [status, setStatus] = useState<FollowupStatus>(f.closed_at ? "needs_contact" : f.status === "needs_contact" ? "contacted" : f.status);
  const [when, setWhen] = useState(toLocalInput(f.next_action_at && f.next_action_at > Date.now() ? f.next_action_at : Date.now() + 3 * 3600_000));
  const [assigned, setAssigned] = useState<string>(f.assigned_to ? String(f.assigned_to) : "");
  const [note, setNote] = useState("");
  const [escalate, setEscalate] = useState(!!f.escalated);
  const save = useMutation({
    mutationFn: () =>
      patch(`/followups/${f.id}`, {
        status,
        nextActionAt: status === "callback" ? new Date(when).getTime() : status === "resolved" || status === "cancelled" ? null : undefined,
        assignedTo: assigned ? Number(assigned) : null,
        escalated: escalate,
        note: note.trim() || undefined,
        contact: contact ? { kind: contact, note: note.trim() || undefined } : undefined,
      }),
    onSuccess: () => {
      toast(tr("Suivi enregistré"));
      void qc.invalidateQueries({ queryKey: ["followups"] });
      void qc.invalidateQueries({ queryKey: ["dashboard"] });
      onClose();
    },
    onError: (e) => toast(errorMessage(e), "error"),
  });
  const RESULTS: FollowupStatus[] = f.closed_at ? ["needs_contact"] : ["contacted", "callback", "retry_requested", "unreachable", "resolved", "cancelled"];
  return (
    <Sheet
      open
      onClose={onClose}
      title={`${f.public_code} · ${f.name}`}
      footer={
        <Button variant="primary" loading={save.isPending} onClick={() => save.mutate()}>
          {tr("Enregistrer")}
        </Button>
      }
    >
      <div className="space-y-3">
        {!f.closed_at && (
          <Select label={tr("Contact fait")} value={contact} onChange={(e) => setContact(e.target.value as ContactKind | "")}>
            <option value="call">{tr("📞 Appel")}</option>
            <option value="whatsapp">{tr("💬 WhatsApp")}</option>
            <option value="sms">{tr("✉️ SMS")}</option>
            <option value="">{tr("Pas de contact (seulement le statut)")}</option>
          </Select>
        )}
        <Select label={tr("Résultat")} value={status} onChange={(e) => setStatus(e.target.value as FollowupStatus)}>
          {RESULTS.map((s) => (
            <option key={s} value={s}>
              {tr(FOLLOWUP_STATUS_LABEL[s])}
            </option>
          ))}
        </Select>
        {status === "callback" && <TextField label={tr("Rappeler le")} type="datetime-local" value={when} onChange={(e) => setWhen(e.target.value)} />}
        {status === "retry_requested" && <p className="rounded-lg bg-violet-50 p-2.5 text-xs text-violet-900">{tr("Pensez à demander le nouveau passage au livreur ; c'est noté dans l'historique de la commande.")}</p>}
        <Select label={tr("Suivi par")} value={assigned} onChange={(e) => setAssigned(e.target.value)}>
          <option value="">{tr("Personne")}</option>
          {assignees.data?.map((m) => (
            <option key={m.id} value={m.id}>
              {m.name}
            </option>
          ))}
        </Select>
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" className="size-4 accent-plum-600" checked={escalate} onChange={(e) => setEscalate(e.target.checked)} />
          {tr("Escalader à la responsable")}
        </label>
        <TextArea label={tr("Note")} value={note} onChange={(e) => setNote(e.target.value)} rows={3} placeholder={tr("Ex. : disponible demain après 17 h, nouvelle adresse…")} />
      </div>
    </Sheet>
  );
}

/** "Échec de livraison" on an order out for delivery (order sheet): opens a follow-up. */
export function FailedDeliveryButton({ orderId, onDone }: { orderId: number; onDone: () => void }) {
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState<FailedDeliveryReason>("no_answer");
  const [note, setNote] = useState("");
  const save = useMutation({
    mutationFn: () => post(`/orders/${orderId}/failed-delivery`, { reason, note: note.trim() || undefined }),
    onSuccess: () => {
      toast(tr("Échec noté : la cliente est à recontacter (Expéditions)"));
      setOpen(false);
      onDone();
    },
    onError: (e) => toast(errorMessage(e), "error"),
  });
  return (
    <>
      <Button onClick={() => setOpen(true)}>{tr("🚚 Échec de livraison")}</Button>
      <Sheet
        open={open}
        onClose={() => setOpen(false)}
        title={tr("Le livreur n'a pas pu livrer")}
        footer={
          <Button variant="primary" loading={save.isPending} onClick={() => save.mutate()}>
            {tr("Enregistrer l'échec")}
          </Button>
        }
      >
        <div className="space-y-3">
          <Select label={tr("Pourquoi ?")} value={reason} onChange={(e) => setReason(e.target.value as FailedDeliveryReason)}>
            {FAILED_DELIVERY_REASONS.map((r) => (
              <option key={r} value={r}>
                {tr(FAILED_DELIVERY_REASON_LABEL[r])}
              </option>
            ))}
          </Select>
          <TextArea label={tr("Note")} value={note} onChange={(e) => setNote(e.target.value)} rows={3} />
          <p className="text-xs text-ink-soft">{tr("La cliente arrive dans Expéditions → Échecs de livraison, à rappeler tout de suite.")}</p>
        </div>
      </Sheet>
    </>
  );
}

/* ───────────── Courier hand-over sheets ───────────── */

interface ManifestSummary {
  id: number; code: string; status: ManifestStatus; carrier: string; handoff_ref: string | null; created_at: number; handed_at: number | null; confirmed_at: number | null;
  packages: number; cod_total: number; fees_total: number;
}
interface ManifestDetail extends ManifestSummary {
  note: string | null; created_by: string; handed_by: string | null;
  orders: { order_id: number; cod_amount: number; fee: number; public_code: string; status: string; name: string; phone: string; wilaya: string | null; wilaya_ar: string | null; commune: string | null; delivery_type: string; tracking_number: string | null; items: number }[];
  totals: { packages: number; cod: number; fees: number };
}
interface Eligible {
  id: number; public_code: string; status: string; name: string; total: number; delivery_type: string; tracking_number: string | null; packed_at: number | null; wilaya: string | null; wilaya_ar: string | null; fee: number | null; items: number;
}

const M_TONE: Record<ManifestStatus, string> = {
  draft: "bg-stone-200 text-stone-800",
  ready: "bg-sky-100 text-sky-800",
  handed_over: "bg-amber-100 text-amber-900",
  confirmed: "bg-emerald-100 text-emerald-800",
  cancelled: "bg-stone-200 text-stone-600",
};

function Manifests({ open }: { open?: number }) {
  const can = useCan();
  const navigate = useNavigate();
  const q = useQuery({ queryKey: ["manifests"], queryFn: () => api<ManifestSummary[]>("/manifests") });
  const [creating, setCreating] = useState(false);
  const show = (id: number | null) => void navigate({ to: "/expeditions", search: { tab: "bordereaux", ...(id ? { m: id } : {}) } as never });
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-ink-soft">{tr("Regroupez les colis prêts, imprimez le bordereau, notez la remise au livreur : les commandes passent « expédiées » toutes ensemble.")}</p>
        {can("orders.ship") && (
          <Button variant="primary" onClick={() => setCreating(true)}>
            {tr("+ Nouveau bordereau")}
          </Button>
        )}
      </div>
      {q.error ? (
        <ErrorState error={q.error} onRetry={q.refetch} />
      ) : !q.data ? (
        <ListSkeleton rows={3} />
      ) : !q.data.length ? (
        <Empty icon="📋" title={tr("Aucun bordereau pour l'instant")} />
      ) : (
        <ul className="space-y-2">
          {q.data.map((m) => (
            <li key={m.id}>
              <button type="button" onClick={() => show(m.id)} className="flex w-full flex-wrap items-center justify-between gap-2 rounded-xl border border-line bg-surface p-3 text-start hover:border-plum-600/40">
                <span>
                  <span className="flex items-center gap-2">
                    <b className="font-mono text-sm">{m.code}</b>
                    <Badge tone={M_TONE[m.status]}>{tr(MANIFEST_STATUS_LABEL[m.status])}</Badge>
                  </span>
                  <span className="mt-0.5 block text-xs text-ink-soft">
                    {m.carrier} · {dateTime(m.handed_at ?? m.created_at)}
                    {m.handoff_ref ? ` · ${m.handoff_ref}` : ""}
                  </span>
                </span>
                <span className="text-end text-sm">
                  {tr("{0} colis", { 0: m.packages })}
                  <span className="block text-xs text-ink-soft">{tr("à encaisser {0}", { 0: da(m.cod_total) })}</span>
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
      {creating && (
        <NewManifestSheet
          onClose={() => setCreating(false)}
          onCreated={(id) => {
            setCreating(false);
            show(id);
          }}
        />
      )}
      {open != null && <ManifestSheet id={open} onClose={() => show(null)} />}
    </div>
  );
}

function NewManifestSheet({ onClose, onCreated }: { onClose: () => void; onCreated: (id: number) => void }) {
  const qc = useQueryClient();
  const toast = useToast();
  const q = useQuery({ queryKey: ["manifest-eligible"], queryFn: () => api<Eligible[]>("/manifests/eligible") });
  const [sel, setSel] = useState<Set<number>>(new Set());
  const create = useMutation({
    mutationFn: () => post<{ id: number; code: string }>("/manifests", { orderIds: [...sel] }),
    onSuccess: (r) => {
      toast(tr("Bordereau {0} créé", { 0: r.code }));
      void qc.invalidateQueries({ queryKey: ["manifests"] });
      void qc.invalidateQueries({ queryKey: ["manifest-eligible"] });
      onCreated(r.id);
    },
    onError: (e) => toast(errorMessage(e), "error"),
  });
  const rows = q.data ?? [];
  const packed = rows.filter((r) => r.packed_at);
  return (
    <Sheet
      open
      onClose={onClose}
      wide
      title={tr("Nouveau bordereau")}
      footer={
        <Button variant="primary" disabled={!sel.size} loading={create.isPending} onClick={() => create.mutate()}>
          {tr("Créer avec {0} colis", { 0: sel.size })}
        </Button>
      }
    >
      {q.error ? (
        <ErrorState error={q.error} onRetry={q.refetch} />
      ) : !q.data ? (
        <ListSkeleton />
      ) : !rows.length ? (
        <Empty icon="📦" title={tr("Aucune commande prête")}>{tr("Les commandes confirmées ou en préparation apparaissent ici.")}</Empty>
      ) : (
        <>
          <div className="mb-3 flex flex-wrap gap-2">
            <Button onClick={() => setSel(new Set(rows.map((r) => r.id)))}>{tr("Tout sélectionner ({0})", { 0: rows.length })}</Button>
            {packed.length > 0 && <Button onClick={() => setSel(new Set(packed.map((r) => r.id)))}>{tr("Seulement les colis emballés ({0})", { 0: packed.length })}</Button>}
            {sel.size > 0 && <Button onClick={() => setSel(new Set())}>{tr("Aucun")}</Button>}
          </div>
          <ul className="divide-y divide-line rounded-xl border border-line">
            {rows.map((r) => (
              <li key={r.id}>
                <label className="flex cursor-pointer items-center gap-3 p-2.5 text-sm">
                  <input
                    type="checkbox"
                    className="size-5 accent-plum-600"
                    checked={sel.has(r.id)}
                    onChange={() =>
                      setSel((s) => {
                        const n = new Set(s);
                        if (n.has(r.id)) n.delete(r.id);
                        else n.add(r.id);
                        return n;
                      })
                    }
                  />
                  <span className="min-w-0 flex-1">
                    <span className="font-mono text-xs">{r.public_code}</span> · <bdi>{r.name}</bdi>
                    <span className="block text-xs text-ink-soft">
                      {(isAr ? r.wilaya_ar : r.wilaya) ?? "—"} · {r.delivery_type === "bureau" ? tr("Bureau") : tr("Domicile")} · {tr("{0} article(s)", { 0: r.items })} · {statusLabel(r.status)}
                      {r.packed_at ? ` · ✅ ${tr("emballé")}` : ""}
                    </span>
                  </span>
                  <b className="tabular-nums">{da(r.total)}</b>
                </label>
              </li>
            ))}
          </ul>
        </>
      )}
    </Sheet>
  );
}

function ManifestSheet({ id, onClose }: { id: number; onClose: () => void }) {
  const qc = useQueryClient();
  const toast = useToast();
  const can = useCan();
  const q = useQuery({ queryKey: ["manifest", id], queryFn: () => api<ManifestDetail>(`/manifests/${id}`) });
  const [handoff, setHandoff] = useState("");
  const [tracking, setTracking] = useState<Record<number, string>>({});
  const refresh = () => {
    for (const k of [["manifest", id], ["manifests"], ["manifest-eligible"], ["orders"]]) void qc.invalidateQueries({ queryKey: k });
  };
  const move = useMutation({
    mutationFn: (to: ManifestStatus) => post<{ removed: { orderId: number; error: string }[] }>(`/manifests/${id}/status`, { to, handoffRef: to === "handed_over" ? handoff.trim() || undefined : undefined }),
    onSuccess: (r, to) => {
      toast(r.removed.length ? tr("{0} commande(s) retirée(s) : elles ne pouvaient plus partir", { 0: r.removed.length }) : tr("Bordereau : {0}", { 0: tr(MANIFEST_STATUS_LABEL[to]) }), r.removed.length ? "error" : undefined);
      refresh();
    },
    onError: (e) => toast(errorMessage(e), "error"),
  });
  const remove = useMutation({
    mutationFn: (orderId: number) => post(`/manifests/${id}/orders`, { remove: [orderId] }),
    onSuccess: refresh,
    onError: (e) => toast(errorMessage(e), "error"),
  });
  const saveTracking = useMutation({
    mutationFn: () => post(`/manifests/${id}/tracking`, { lines: Object.entries(tracking).filter(([, v]) => v.trim().length >= 3).map(([orderId, v]) => ({ orderId: Number(orderId), trackingNumber: v.trim() })) }),
    onSuccess: () => {
      toast(tr("Numéros de suivi enregistrés"));
      setTracking({});
      refresh();
    },
    onError: (e) => toast(errorMessage(e), "error"),
  });
  const m = q.data;
  const ship = can("orders.ship");
  return (
    <Sheet open onClose={onClose} wide title={m ? `${m.code} · ${tr(MANIFEST_STATUS_LABEL[m.status])}` : tr("Bordereau")}>
      {q.error ? (
        <ErrorState error={q.error} onRetry={q.refetch} />
      ) : !m ? (
        <ListSkeleton />
      ) : (
        <div className="space-y-4">
          <div className="grid grid-cols-3 gap-3">
            <Stat label={tr("Colis")} value={m.totals.packages} />
            <Stat label={tr("À encaisser")} value={da(m.totals.cod)} />
            <Stat label={tr("Frais estimés")} value={da(m.totals.fees)} />
          </div>
          {m.handed_at && (
            <p className="text-sm text-ink-soft">
              {tr("Remis au livreur {0}", { 0: dateTime(m.handed_at) })}
              {m.handoff_ref ? ` · ${m.handoff_ref}` : ""}
            </p>
          )}
          <div className="flex flex-wrap gap-2">
            <a href={`/admin/manifeste?id=${m.id}`} target="_blank" rel="noreferrer" className="inline-flex h-11 items-center rounded-xl border border-line px-4 text-sm font-semibold">
              {tr("🖨️ Imprimer le bordereau")}
            </a>
            <a href={`/api/admin/manifests/${m.id}/csv`} className="inline-flex h-11 items-center rounded-xl border border-line px-4 text-sm font-semibold">
              {tr("Export CSV")}
            </a>
          </div>

          <Card title={tr("Colis")} padded={false}>
            <ul className="divide-y divide-line">
              {m.orders.map((o) => (
                <li key={o.order_id} className="flex flex-wrap items-center gap-3 p-3 text-sm">
                  <span className="min-w-0 flex-1">
                    <Link to="/commandes" search={{ o: o.order_id } as never} className="font-mono text-xs text-plum-700 hover:underline">
                      {o.public_code}
                    </Link>{" "}
                    · <bdi>{o.name}</bdi> · {statusLabel(o.status)}
                    <span className="block text-xs text-ink-soft">
                      {(isAr ? o.wilaya_ar : o.wilaya) ?? "—"}
                      {o.commune ? ` · ${o.commune}` : ""} · {o.delivery_type === "bureau" ? tr("Bureau") : tr("Domicile")} · {tr("{0} article(s)", { 0: o.items })}
                    </span>
                  </span>
                  {ship && m.status !== "confirmed" && m.status !== "cancelled" ? (
                    <input
                      className={`${inputCls} w-36`}
                      placeholder={tr("N° de suivi")}
                      defaultValue={o.tracking_number ?? ""}
                      onChange={(e) => setTracking((t) => ({ ...t, [o.order_id]: e.target.value }))}
                      aria-label={tr("N° de suivi de {0}", { 0: o.public_code })}
                      dir="ltr"
                    />
                  ) : (
                    <span className="font-mono text-xs">{o.tracking_number ?? "—"}</span>
                  )}
                  <b className="tabular-nums">{da(o.cod_amount)}</b>
                  {ship && m.status === "draft" && (
                    <Button variant="danger" onClick={() => remove.mutate(o.order_id)}>
                      {tr("Retirer")}
                    </Button>
                  )}
                </li>
              ))}
            </ul>
          </Card>
          {ship && Object.keys(tracking).length > 0 && (
            <Button loading={saveTracking.isPending} onClick={() => saveTracking.mutate()}>
              {tr("Enregistrer les numéros de suivi")}
            </Button>
          )}

          {ship && (
            <div className="space-y-3 rounded-xl bg-ivory-deep p-3">
              {m.status === "draft" && (
                <div className="flex flex-wrap gap-2">
                  <Button variant="primary" loading={move.isPending} onClick={() => move.mutate("ready")}>{tr("✅ Prêt (liste fermée)")}</Button>
                  <Button variant="danger" onClick={() => move.mutate("cancelled")}>{tr("Annuler le bordereau")}</Button>
                </div>
              )}
              {m.status === "ready" && (
                <>
                  <TextField label={tr("Remise au livreur (nom, n° de ramassage…)")} value={handoff} onChange={(e) => setHandoff(e.target.value)} maxLength={120} />
                  <div className="flex flex-wrap gap-2">
                    <Button variant="primary" loading={move.isPending} onClick={() => move.mutate("handed_over")}>{tr("🚚 Remis au livreur")}</Button>
                    <Button onClick={() => move.mutate("draft")}>{tr("Modifier la liste")}</Button>
                    <Button variant="danger" onClick={() => move.mutate("cancelled")}>{tr("Annuler le bordereau")}</Button>
                  </div>
                  <p className="text-xs text-ink-soft">{tr("À la remise, toutes les commandes passent « expédiées » et le stock sort de la boutique.")}</p>
                </>
              )}
              {m.status === "handed_over" && (
                <Button variant="primary" loading={move.isPending} onClick={() => move.mutate("confirmed")}>{tr("Le livreur a confirmé la réception")}</Button>
              )}
            </div>
          )}
        </div>
      )}
    </Sheet>
  );
}

/* ───────────── Printable sheet (/manifeste?id=…) ───────────── */

export function ManifestPrintPage() {
  const { id } = useSearch({ strict: false }) as { id?: number };
  const q = useQuery({ queryKey: ["manifest", id], queryFn: () => api<ManifestDetail>(`/manifests/${id}`), enabled: !!id });
  const m = q.data;
  if (q.error) return <ErrorState error={q.error} />;
  if (!m) return <ListSkeleton />;
  return (
    <div className="mx-auto max-w-4xl bg-white p-6 text-black print:p-0" dir="ltr">
      <div className="mb-4 flex items-start justify-between">
        <div>
          <h1 className="text-xl font-bold">Henine Boutique · Bordereau {m.code}</h1>
          <p className="text-sm">
            {m.carrier} · {m.totals.packages} colis · à encaisser {da(m.totals.cod)} · {dateTime(m.handed_at ?? m.created_at)}
          </p>
        </div>
        <button type="button" onClick={() => window.print()} className="rounded border px-3 py-1.5 text-sm print:hidden">
          🖨️ Imprimer
        </button>
      </div>
      <table className="w-full border-collapse text-xs">
        <thead>
          <tr className="border-b-2 border-black text-start">
            {["#", "Commande", "Suivi", "Cliente", "Téléphone", "Wilaya / commune", "Livr.", "Art.", "À encaisser"].map((h) => (
              <th key={h} className="px-1.5 py-1 text-start">{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {m.orders.map((o, i) => (
            <tr key={o.order_id} className="border-b border-gray-300">
              <td className="px-1.5 py-1">{i + 1}</td>
              <td className="px-1.5 py-1 font-mono">{o.public_code}</td>
              <td className="px-1.5 py-1 font-mono">{o.tracking_number ?? ""}</td>
              <td className="px-1.5 py-1">{o.name}</td>
              <td className="px-1.5 py-1">{o.phone}</td>
              <td className="px-1.5 py-1">{[o.wilaya, o.commune].filter(Boolean).join(" · ")}</td>
              <td className="px-1.5 py-1">{o.delivery_type === "bureau" ? "Bureau" : "Domicile"}</td>
              <td className="px-1.5 py-1">{o.items}</td>
              <td className="px-1.5 py-1 text-end tabular-nums">{da(o.cod_amount)}</td>
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr className="font-bold">
            <td colSpan={8} className="px-1.5 py-2 text-end">Total à encaisser</td>
            <td className="px-1.5 py-2 text-end tabular-nums">{da(m.totals.cod)}</td>
          </tr>
        </tfoot>
      </table>
      <div className="mt-10 grid grid-cols-2 gap-10 text-sm">
        <div className="border-t border-black pt-2">Remis par (boutique) : nom, date, signature</div>
        <div className="border-t border-black pt-2">Reçu par (livreur) : nom, date, signature</div>
      </div>
    </div>
  );
}
