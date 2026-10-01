import { formatDzPhone, type OrderStatus } from "@henine/shared";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate, useSearch } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { api, errorMessage, patch, post } from "../api";
import { ago, CHANNEL_LABEL, da, dateTime, statusLabel, telLink, waLink } from "../lib/format";
import { useCan } from "../Shell";
import { Badge, Button, Card, Empty, ErrorState, inputCls, ListSkeleton, PageHeader, Pills, SearchBox, Sheet, StatusBadge, TextArea, TextField, useToast } from "../ui";

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
}

const TABS = [
  { value: "active", label: "En cours" },
  { value: "a_confirmer", label: "À confirmer" },
  { value: "confirmee", label: "Confirmées" },
  { value: "en_preparation", label: "Préparation" },
  { value: "en_cours", label: "Expédiées" },
  { value: "termine", label: "Livrées" },
  { value: "annule", label: "Annulées / retours" },
  { value: "all", label: "Toutes" },
];

export function OrdersPage() {
  const search = useSearch({ strict: false }) as { status?: string; o?: number };
  const navigate = useNavigate();
  const [status, setStatus] = useState(search.status ?? "active");
  const [q, setQ] = useState("");
  const [debounced, setDebounced] = useState("");
  useEffect(() => {
    const id = setTimeout(() => setDebounced(q), 300);
    return () => clearTimeout(id);
  }, [q]);
  const list = useQuery({
    queryKey: ["orders", status, debounced],
    queryFn: () => api<{ rows: OrderRow[]; counts: Record<string, number> }>(`/orders?status=${status}&q=${encodeURIComponent(debounced)}`),
    refetchInterval: 20_000,
  });
  const openId = search.o ?? null;
  const setOpen = (id: number | null) => void navigate({ to: "/commandes", search: (s: Record<string, unknown>) => ({ ...s, o: id ?? undefined }) });
  const counts = list.data?.counts ?? {};
  const toConfirm = (counts.nouvelle ?? 0) + (counts.injoignable ?? 0);

  return (
    <div>
      <PageHeader
        group="Commandes"
        title="Commandes"
        subtitle={toConfirm ? `${toConfirm} à confirmer` : "Tout est à jour ✓"}
        actions={
          <a href="/api/admin/orders.csv?days=90" className="inline-flex h-9 items-center rounded-full border border-line bg-white px-3.5 text-sm font-semibold">
            Export CSV
          </a>
        }
      />
      <Pills value={status} onChange={setStatus} options={TABS.map((t) => ({ value: t.value, label: t.value === "a_confirmer" && toConfirm ? `${t.label} (${toConfirm})` : t.label }))} />
      <SearchBox value={q} onChange={setQ} placeholder="N° de commande, nom, téléphone…" />
      {list.error ? (
        <ErrorState error={list.error} onRetry={list.refetch} />
      ) : !list.data ? (
        <ListSkeleton />
      ) : list.data.rows.length === 0 ? (
        <Empty title="Aucune commande ici">Les nouvelles commandes du site arrivent automatiquement (et sur Telegram).</Empty>
      ) : (
        <ul className="space-y-2">
          {list.data.rows.map((o) => (
            <li key={o.id}>
              <button type="button" onClick={() => setOpen(o.id)} className="w-full rounded-2xl border border-line bg-white/70 p-3.5 text-start transition hover:border-plum-600/40 active:scale-[0.995]">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="truncate font-semibold">{o.name}</p>
                    <p className="text-sm text-ink-soft">
                      {o.wilaya_code} · {o.wilaya} · {o.delivery_type === "bureau" ? "Bureau" : "Domicile"}
                    </p>
                  </div>
                  <div className="text-end">
                    <p className="font-semibold tabular-nums">{da(o.total)}</p>
                    <StatusBadge status={o.status} />
                  </div>
                </div>
                <div className="mt-2 flex flex-wrap items-center gap-1.5 text-xs text-ink-soft">
                  <span className="font-mono">{o.public_code}</span>·<span>{ago(o.created_at)}</span>·<span>{o.items} article(s)</span>·<span>{CHANNEL_LABEL[o.channel] ?? o.channel}</span>
                  {o.returned_count ? <Badge tone="bg-orange-100 text-orange-800">⚠ {o.returned_count} retour(s)</Badge> : null}
                  {(o.delivered_count ?? 0) >= 2 ? <Badge tone="bg-emerald-100 text-emerald-800">Fidèle</Badge> : null}
                  {o.risk_score >= 50 ? <Badge tone="bg-red-100 text-red-800">Risque</Badge> : null}
                  {o.status === "injoignable" ? <Badge tone="bg-amber-100 text-amber-800">📵 {o.confirm_attempts} appel(s)</Badge> : null}
                </div>
              </button>
            </li>
          ))}
        </ul>
      )}
      <OrderSheet id={openId} onClose={() => setOpen(null)} />
    </div>
  );
}

interface OrderDetail {
  order: Record<string, unknown> & {
    id: number; public_code: string; status: OrderStatus; name: string; phone: string; wilaya_code: number; wilaya_fr: string; commune_fr: string | null;
    commune_text: string | null; address: string | null; delivery_type: string; subtotal: number; discount_total: number; shipping_price: number; total: number;
    coupon_code: string | null; customer_note: string | null; internal_note: string | null; tracking_number: string | null; channel: string; created_at: number;
    orders_count: number | null; delivered_count: number | null; returned_count: number | null; cancelled_count: number | null; is_blacklisted: number | null;
    customer_id: number; risk_score: number; confirm_attempts: number; ua_short: string | null; locale: string;
  };
  items: { id: number; name_fr: string; options_label: string | null; sku: string; qty: number; unit_price: number; image: string | null; available: number | null }[];
  events: { id: number; from_status: string | null; to_status: string | null; kind: string; actor: string; source: string; note: string | null; created_at: number }[];
  next: OrderStatus[];
}

const ACTION: Partial<Record<OrderStatus, { label: string; variant: "primary" | "secondary" | "danger" }>> = {
  confirmee: { label: "✅ Confirmer", variant: "primary" },
  injoignable: { label: "📵 Injoignable", variant: "secondary" },
  en_preparation: { label: "📦 En préparation", variant: "primary" },
  expediee: { label: "🚚 Expédiée", variant: "primary" },
  en_livraison: { label: "🛵 En livraison", variant: "secondary" },
  livree: { label: "🎉 Livrée", variant: "primary" },
  retour: { label: "↩️ Retour", variant: "danger" },
  retour_recu: { label: "📥 Retour reçu (remis en stock)", variant: "primary" },
  annulee: { label: "Annuler", variant: "danger" },
  doublon: { label: "Doublon", variant: "danger" },
  fausse: { label: "Fausse commande", variant: "danger" },
  nouvelle: { label: "Rouvrir", variant: "secondary" },
};

function actorName(a: string) {
  const p = a.split(":");
  return p.length >= 3 ? `${p.slice(2).join(":")}${p[0] === "telegram" ? " (Telegram)" : ""}` : a === "customer" ? "Cliente" : a;
}

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
    mutationFn: (to: OrderStatus) => post(`/orders/${id}/status`, { to }),
    onSuccess: (_, to) => {
      toast(`Statut : ${statusLabel(to)}`);
      refresh();
    },
    onError: (e) => toast(errorMessage(e), "error"),
  });
  const [note, setNote] = useState("");
  const addNote = useMutation({
    mutationFn: (kind: "note" | "call" | "whatsapp") => post(`/orders/${id}/note`, { note: note || (kind === "call" ? "Appel" : "Message WhatsApp"), kind }),
    onSuccess: () => {
      setNote("");
      refresh();
    },
  });
  const [editing, setEditing] = useState(false);
  const d = q.data;
  const o = d?.order;

  const waText = o
    ? `Bonjour ${o.name} 🌸 Ici Henine Boutique. Nous confirmons votre commande ${o.public_code} (${da(o.total)}), livraison ${o.delivery_type === "bureau" ? "au bureau" : "à domicile"} à ${o.wilaya_fr}. Merci !`
    : "";

  return (
    <Sheet
      open={id != null}
      onClose={onClose}
      wide
      title={o ? <span className="flex items-center gap-2"><span className="font-mono">{o.public_code}</span><StatusBadge status={o.status} /></span> : "Commande"}
      footer={
        d && d.next.length > 0 ? (
          <div className="flex flex-wrap gap-2">
            {d.next.map((to) => (
              <Button
                key={to}
                variant={ACTION[to]?.variant ?? "secondary"}
                size="sm"
                loading={status.isPending && status.variables === to}
                onClick={() => {
                  if ((to === "annulee" || to === "fausse" || to === "doublon") && !confirm(`${ACTION[to]?.label} cette commande ? Le stock réservé sera libéré.`)) return;
                  status.mutate(to);
                }}
              >
                {ACTION[to]?.label ?? statusLabel(to)}
              </Button>
            ))}
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
          <Card>
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="text-lg font-semibold">{o.name}</p>
                <p className="font-mono text-sm">{formatDzPhone(o.phone)}</p>
                <p className="mt-1 text-sm text-ink-soft">
                  {o.wilaya_code} · {o.wilaya_fr} › {o.commune_fr ?? o.commune_text ?? "?"} · {o.delivery_type === "bureau" ? "🏢 Bureau" : "🏠 Domicile"}
                </p>
                {o.address && <p className="text-sm">🏠 {o.address}</p>}
              </div>
              <div className="flex flex-col gap-2">
                <a href={telLink(o.phone)} onClick={() => addNote.mutate("call")} className="inline-flex h-10 items-center justify-center gap-1.5 whitespace-nowrap rounded-full bg-plum-600 px-4 text-sm font-semibold text-ivory">📞 Appeler</a>
                <a href={waLink(o.phone, waText)} target="_blank" rel="noreferrer" onClick={() => addNote.mutate("whatsapp")} className="inline-flex h-10 items-center justify-center whitespace-nowrap rounded-full bg-[#25D366] px-4 text-sm font-semibold text-white">WhatsApp</a>
              </div>
            </div>
            <div className="mt-3 flex flex-wrap gap-1.5 text-xs">
              <Badge tone="bg-stone-100 text-stone-700">{o.orders_count ?? 1} commande(s)</Badge>
              <Badge tone="bg-emerald-100 text-emerald-800">{o.delivered_count ?? 0} livrée(s)</Badge>
              {o.returned_count ? <Badge tone="bg-orange-100 text-orange-800">{o.returned_count} retour(s)</Badge> : null}
              {o.cancelled_count ? <Badge tone="bg-stone-200 text-stone-700">{o.cancelled_count} annulée(s)</Badge> : null}
              {o.is_blacklisted ? <Badge tone="bg-red-100 text-red-800">⛔ Liste noire</Badge> : null}
              <Badge tone="bg-stone-100 text-stone-700">{CHANNEL_LABEL[o.channel] ?? o.channel}</Badge>
              {o.ua_short && <Badge tone="bg-stone-100 text-stone-700">{o.ua_short}</Badge>}
            </div>
          </Card>

          <Card title={`Articles (${d.items.reduce((s, i) => s + i.qty, 0)})`}>
            <ul className="space-y-2">
              {d.items.map((i) => (
                <li key={i.id} className="flex items-center gap-3 text-sm">
                  {i.image ? <img src={i.image} alt="" className="h-14 w-11 rounded-md object-cover" /> : <span className="grid h-14 w-11 place-items-center rounded-md bg-rose-100">👗</span>}
                  <span className="min-w-0 flex-1">
                    <span className="block font-medium">{i.name_fr}</span>
                    <span className="text-ink-soft">{i.options_label} · {i.sku}</span>
                  </span>
                  <span className="text-end tabular-nums">
                    {i.qty} × {da(i.unit_price)}
                  </span>
                </li>
              ))}
            </ul>
            <dl className="mt-3 space-y-1 border-t border-line pt-3 text-sm">
              <div className="flex justify-between"><dt className="text-ink-soft">Sous-total</dt><dd>{da(o.subtotal)}</dd></div>
              {o.discount_total > 0 && <div className="flex justify-between text-emerald-700"><dt>Remise {o.coupon_code}</dt><dd>−{da(o.discount_total)}</dd></div>}
              <div className="flex justify-between"><dt className="text-ink-soft">Livraison</dt><dd>{da(o.shipping_price)}</dd></div>
              <div className="flex justify-between text-base font-semibold"><dt>Total (à encaisser)</dt><dd>{da(o.total)}</dd></div>
            </dl>
            {o.customer_note && <p className="mt-3 rounded-xl bg-amber-50 p-3 text-sm">📝 {o.customer_note}</p>}
          </Card>

          {editing ? (
            <EditOrder order={o} onDone={() => { setEditing(false); refresh(); }} />
          ) : (
            <Card
              title="Livraison & suivi"
              actions={can("orders.edit") && <Button size="sm" onClick={() => setEditing(true)}>Modifier</Button>}
            >
              <p className="text-sm">N° de suivi ZR Express : <b>{o.tracking_number ?? "—"}</b></p>
              {o.internal_note && <p className="mt-2 text-sm text-ink-soft">🔒 {o.internal_note}</p>}
            </Card>
          )}

          <Card title="Historique">
            <ol className="space-y-2 text-sm">
              {d.events.map((e) => (
                <li key={e.id} className="flex gap-2">
                  <span className="w-24 shrink-0 text-xs text-ink-soft">{dateTime(e.created_at)}</span>
                  <span>
                    {e.kind === "status" ? (
                      <>{e.to_status ? <StatusBadge status={e.to_status} /> : null} par <b>{actorName(e.actor)}</b>{e.source === "telegram" ? " 📱" : ""}</>
                    ) : (
                      <>
                        {e.kind === "call" ? "📞" : e.kind === "whatsapp" ? "💬" : e.kind === "edit" ? "✏️" : "📝"} {e.note} <span className="text-ink-soft">— {actorName(e.actor)}</span>
                      </>
                    )}
                  </span>
                </li>
              ))}
            </ol>
            <div className="mt-3 flex gap-2">
              <input className={inputCls} placeholder="Ajouter une note interne…" value={note} onChange={(e) => setNote(e.target.value)} maxLength={1000} />
              <Button onClick={() => note.trim() && addNote.mutate("note")} loading={addNote.isPending}>Ajouter</Button>
            </div>
          </Card>
        </div>
      )}
    </Sheet>
  );
}

function EditOrder({ order, onDone }: { order: OrderDetail["order"]; onDone: () => void }) {
  const toast = useToast();
  const [form, setForm] = useState({
    name: order.name,
    phone: order.phone,
    address: order.address ?? "",
    trackingNumber: order.tracking_number ?? "",
    internalNote: order.internal_note ?? "",
    shippingPrice: order.shipping_price,
    deliveryType: order.delivery_type as "domicile" | "bureau",
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
      }),
    onSuccess: () => {
      toast("Commande modifiée");
      onDone();
    },
    onError: (e) => toast(errorMessage(e), "error"),
  });
  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) => setForm((f) => ({ ...f, [k]: e.target.value }));
  return (
    <Card title="Modifier la commande">
      <div className="grid gap-3 sm:grid-cols-2">
        <TextField label="Nom" value={form.name} onChange={set("name")} />
        <TextField label="Téléphone" value={form.phone} onChange={set("phone")} inputMode="tel" />
        <TextField label="Adresse" value={form.address} onChange={set("address")} className="sm:col-span-2" />
        <label className="text-sm font-medium">
          Mode
          <select className={`${inputCls} mt-1`} value={form.deliveryType} onChange={set("deliveryType")}>
            <option value="domicile">Domicile</option>
            <option value="bureau">Bureau (stop-desk)</option>
          </select>
        </label>
        <TextField label="Frais de livraison (DA)" type="number" value={form.shippingPrice} onChange={(e) => setForm((f) => ({ ...f, shippingPrice: Number(e.target.value) || 0 }))} />
        <TextField label="N° de suivi ZR Express" value={form.trackingNumber} onChange={set("trackingNumber")} className="sm:col-span-2" />
        <TextArea label="Note interne (invisible pour la cliente)" value={form.internalNote} onChange={set("internalNote")} className="sm:col-span-2" rows={2} />
      </div>
      <div className="mt-3 flex gap-2">
        <Button variant="primary" loading={save.isPending} onClick={() => save.mutate()}>Enregistrer</Button>
        <Button onClick={onDone}>Annuler</Button>
      </div>
    </Card>
  );
}
