/**
 * Order sheet tools (Commandes → a order): customer warning, contact log, items editor,
 * manual discount, exchange requests, real profit, SLA and the full change history.
 */
import {
  DUPLICATE_REASON_LABEL,
  type DuplicateAction,
  type DuplicateReason,
  type DuplicateStatus,
  CONTACT_KIND_LABEL,
  CONTACT_KINDS,
  CONTACT_TIME_LABEL,
  EXCHANGE_REASON_LABEL,
  EXCHANGE_STATUS_LABEL,
  manualDiscountAmount,
  type ContactKind,
  type ContactTime,
  type ExchangeReason,
  type ExchangeStatus,
  type OrderStatus,
  type ProfitResult,
  type RiskAssessment,
  RISK_LEVEL_LABEL,
} from "@henine/shared";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { api, errorMessage, post, put } from "../api";
import { isAr, tr } from "../i18n";
import { ago, da, daMinus, dateTime, telLink, waLink } from "../lib/format";
import { variantLabel } from "../lib/variants";
import { Badge, Button, Card, inputCls, SearchBox, StatusBadge, useToast } from "../ui";
import { useCan } from "../Shell";
import type { StockProduct } from "./Stock";

export interface OrderOpsData {
  changes: { id: number; field: string; old_value: string | null; new_value: string | null; reason: string | null; actor: string; created_at: number }[];
  exchanges: {
    id: number; order_item_id: number; product: string; from_label: string | null; to_label: string | null; to_variant_id: number; reason: ExchangeReason;
    note: string | null; status: ExchangeStatus; available: number | null; decision_note: string | null; created_at: number;
  }[];
  previous: { id: number; public_code: string; status: OrderStatus; total: number; created_at: number }[];
  contacts: { id: number; order_id: number; kind: string; actor: string; note: string | null; created_at: number; public_code: string }[];
  lastContactAt: number | null;
  profit: ProfitResult | null;
  sla: { stage: "confirm" | "prepare" | "ship"; since: number; limit: number; late: number } | null;
  editable: boolean;
  canDiscount: boolean;
}

export function actorName(a: string) {
  const p = a.split(":");
  return p.length >= 3 ? `${p.slice(2).join(":")}${p[0] === "telegram" ? " (Telegram)" : ""}` : a === "customer" ? tr("Cliente") : a === "system" ? tr("Système") : a;
}

/* ───────────── Customer warning (clear words, not just a score) ───────────── */

export function CustomerWarning({
  risk,
  counts,
}: {
  risk: RiskAssessment;
  counts: { orders: number; delivered: number; cancelled: number; returned: number; blacklisted: boolean };
}) {
  const bad = counts.cancelled + counts.returned > 0 || counts.blacklisted;
  if (risk.level === "low" && !bad) return null;
  const tone = risk.level === "high" || counts.blacklisted ? "border-red-300 bg-red-50 text-red-900" : "border-amber-300 bg-amber-50 text-amber-900";
  return (
    <div className={`rounded-xl border p-3 text-sm ${tone}`} role="alert">
      <p className="font-bold">
        ⚠️ {tr("Attention à cette cliente")} · {tr("risque")} {tr(RISK_LEVEL_LABEL[risk.level].fr).toLowerCase()}
      </p>
      <p className="mt-1">
        {tr("{0} commande(s) avant · {1} livrée(s) · {2} annulée(s) · {3} retour(s)", { 0: Math.max(counts.orders - 1, 0), 1: counts.delivered, 2: counts.cancelled, 3: counts.returned })}
        {counts.blacklisted ? ` · ${tr("⛔ liste noire")}` : ""}
      </p>
      <p className="mt-1 text-xs opacity-80">{tr("Confirmez bien l'adresse et la taille par téléphone avant d'expédier.")}</p>
    </div>
  );
}

/* ───────────── SLA ───────────── */

const STAGE_LABEL = { confirm: tr("confirmation"), prepare: tr("préparation"), ship: tr("expédition") };

export function SlaBadge({ sla }: { sla: OrderOpsData["sla"] }) {
  if (!sla) return null;
  const spent = Math.floor((Date.now() - sla.since) / 60_000);
  const left = sla.limit - spent;
  // "30 دقيقة", "5 سا 15 د", "3 أيام" in Arabic; "30 min", "5 h 15", "3 j" in French
  const fmt = (m: number) => {
    const d = Math.round(m / 1440);
    const h = Math.floor(m / 60);
    const mm = String(m % 60).padStart(2, "0");
    if (isAr) return m >= 60 * 48 ? `${d} ${d <= 10 ? "أيام" : "يومًا"}` : m >= 60 ? `${h} سا ${mm} د` : `${m} دقيقة`;
    return m >= 60 * 48 ? `${d} j` : m >= 60 ? `${h} h ${mm}` : `${m} min`;
  };
  return sla.late > 0 ? (
    <Badge tone="bg-red-100 text-red-800">{tr("⏰ En retard de {0} ({1})", { 0: fmt(sla.late), 1: STAGE_LABEL[sla.stage] })}</Badge>
  ) : (
    <Badge tone={left <= 10 ? "bg-amber-100 text-amber-800" : "bg-stone-100 text-stone-700"}>{tr("⏱ {0} restant(es) pour la {1}", { 0: fmt(Math.max(left, 0)), 1: STAGE_LABEL[sla.stage] })}</Badge>
  );
}

/* ───────────── Quick actions + contact log ───────────── */

export function ContactActions({ orderId, phone, waText, onLogged }: { orderId: number; phone: string; waText: string; onLogged: () => void }) {
  const toast = useToast();
  const [kind, setKind] = useState<ContactKind | null>(null);
  const [note, setNote] = useState("");
  const log = useMutation({
    mutationFn: (v: { kind: ContactKind; note?: string }) => post(`/orders/${orderId}/contact`, v),
    onSuccess: () => {
      setKind(null);
      setNote("");
      onLogged();
    },
    onError: (e) => toast(errorMessage(e), "error"),
  });
  const big = "inline-flex h-12 items-center justify-center gap-1.5 rounded-xl px-3 text-sm font-semibold";
  return (
    <div>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        {/* the link opens the phone / WhatsApp; the contact is logged at the same time */}
        <a href={telLink(phone)} onClick={() => setKind("call")} className={`${big} bg-plum-600 text-white`}>{tr("📞 Appeler")}</a>
        <a href={waLink(phone, waText)} target="_blank" rel="noreferrer" onClick={() => setKind("whatsapp")} className={`${big} bg-[#25D366] text-white`}>{tr("💬 WhatsApp")}</a>
        <a href={`sms:${phone}`} onClick={() => setKind("sms")} className={`${big} border border-line bg-surface`}>{tr("✉️ SMS")}</a>
        <button type="button" onClick={() => setKind("note")} className={`${big} border border-line bg-surface`}>{tr("📝 Noter")}</button>
      </div>
      {kind && (
        <div className="mt-3 rounded-xl border border-plum-600/30 bg-rose-100/40 p-3">
          <p className="text-sm font-semibold">{tr("Comment s'est passé le contact ?")}</p>
          <div className="mt-2 flex flex-wrap gap-1.5">
            {CONTACT_KINDS.map((k) => (
              <button
                key={k}
                type="button"
                onClick={() => setKind(k)}
                className={`h-9 rounded-full border px-3 text-sm ${kind === k ? "border-plum-600 bg-plum-600 text-white" : "border-line bg-surface"}`}
              >
                {CONTACT_KIND_LABEL[k].emoji} {tr(CONTACT_KIND_LABEL[k].fr)}
              </button>
            ))}
          </div>
          <div className="mt-2 flex flex-col gap-2 sm:flex-row">
            <input className={inputCls} placeholder={tr("Ex. : la cliente confirme, livrer après 17 h…")} value={note} onChange={(e) => setNote(e.target.value)} maxLength={1000} />
            <div className="flex gap-2">
              <Button variant="primary" loading={log.isPending} onClick={() => log.mutate({ kind, note: note.trim() || undefined })}>{tr("Enregistrer")}</Button>
              <Button onClick={() => setKind(null)}>{tr("Ignorer")}</Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export function ContactHistory({ data, orderId }: { data: OrderOpsData; orderId: number }) {
  if (!data.contacts.length) return <p className="text-sm text-ink-soft">{tr("Aucun contact enregistré pour cette cliente.")}</p>;
  return (
    <ol className="space-y-2.5 text-sm">
      {data.contacts.map((c) => (
        <li key={c.id} className="rounded-xl bg-ivory-deep p-2.5">
          <p className="text-xs text-ink-soft">
            {dateTime(c.created_at)} · {actorName(c.actor)}
            {c.order_id !== orderId && <> · <span className="font-mono">{c.public_code}</span></>}
          </p>
          <p className="mt-0.5">
            {CONTACT_KIND_LABEL[c.kind as ContactKind]?.emoji ?? "🔸"} <b>{tr(CONTACT_KIND_LABEL[c.kind as ContactKind]?.fr ?? c.kind)}</b>
            {c.note && c.note !== CONTACT_KIND_LABEL[c.kind as ContactKind]?.fr ? <> · {c.note}</> : null}
          </p>
        </li>
      ))}
    </ol>
  );
}

export function ContactTimeBadge({ value }: { value: string | null }) {
  const t = value ? CONTACT_TIME_LABEL[value as ContactTime] : null;
  if (!t) return null;
  return <Badge tone="bg-sky-100 text-sky-900">{tr("{0} À appeler : {1}", { 0: t.emoji, 1: tr(t.fr).toLowerCase() })}</Badge>;
}

export function PreviousOrders({ data, onOpen }: { data: OrderOpsData; onOpen: (id: number) => void }) {
  if (!data.previous.length) return null;
  return (
    <div>
      <p className="mb-1.5 text-xs font-semibold uppercase tracking-wider text-ink-soft">{tr("Ses commandes précédentes")}</p>
      <ul className="space-y-1">
        {data.previous.map((p) => (
          <li key={p.id}>
            <button type="button" onClick={() => onOpen(p.id)} className="flex w-full items-center justify-between gap-2 rounded-lg px-2 py-1.5 text-sm hover:bg-ivory-deep">
              <span className="flex items-center gap-2">
                <span className="font-mono text-xs">{p.public_code}</span>
                <StatusBadge status={p.status} />
              </span>
              <span className="text-xs text-ink-soft">{da(p.total)} · {ago(p.created_at)}</span>
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}

/* ───────────── Items editor (before shipping) ───────────── */

interface EditLine {
  key: string;
  itemId?: number;
  variantId: number;
  qty: number;
  name: string;
  label: string;
  price: number;
}

export function ItemsEditor({
  orderId,
  items,
  onDone,
}: {
  orderId: number;
  items: { id: number; variant_id: number | null; name_fr: string; options_label: string | null; qty: number; unit_price: number }[];
  onDone: () => void;
}) {
  const toast = useToast();
  const can = useCan();
  const [lines, setLines] = useState<EditLine[]>(() =>
    items.filter((i) => i.variant_id != null).map((i) => ({ key: `i${i.id}`, itemId: i.id, variantId: i.variant_id!, qty: i.qty, name: i.name_fr, label: i.options_label ?? "", price: i.unit_price })),
  );
  const [reason, setReason] = useState("");
  const [q, setQ] = useState("");
  const [picking, setPicking] = useState<string | null>(null); // line key whose variant is changed, or "new"
  const stock = useQuery({
    queryKey: ["stock-products", "order-edit"],
    queryFn: () => api<{ products: StockProduct[] }>("/stock/products?filter=all"),
    enabled: can("stock.view"),
  });
  const products = useMemo(
    () => (stock.data?.products ?? []).filter((p) => p.status !== "archived" && `${p.name} ${p.nameAr}`.toLowerCase().includes(q.trim().toLowerCase())).slice(0, 12),
    [stock.data, q],
  );
  const save = useMutation({
    mutationFn: () => put(`/orders/${orderId}/items`, { lines: lines.map((l) => ({ itemId: l.itemId, variantId: l.variantId, qty: l.qty })), reason: reason.trim() }),
    onSuccess: () => {
      toast(tr("Articles mis à jour"));
      onDone();
    },
    onError: (e) => toast(errorMessage(e), "error"),
  });
  const setQty = (key: string, qty: number) => setLines((ls) => ls.map((l) => (l.key === key ? { ...l, qty: Math.min(Math.max(qty, 1), 20) } : l)));
  function choose(p: StockProduct, v: StockProduct["variants"][number]) {
    const next = { variantId: v.id, name: p.name, label: variantLabel(p, v), price: p.price };
    setLines((ls) => (picking === "new" ? [...ls, { key: `n${v.id}-${Date.now()}`, qty: 1, ...next }] : ls.map((l) => (l.key === picking ? { ...l, ...next } : l))));
    setPicking(null);
    setQ("");
  }
  return (
    <Card title={tr("Modifier les articles")}>
      <ul className="space-y-2">
        {lines.map((l) => (
          <li key={l.key} className="flex flex-wrap items-center gap-2 rounded-xl border border-line p-2.5 text-sm">
            <span className="min-w-0 flex-1">
              <span className="block font-medium">{l.name}</span>
              <span className="text-ink-soft">{l.label} · {da(l.price)}</span>
            </span>
            <span className="flex items-center gap-1">
              <button type="button" aria-label={tr("Moins")} onClick={() => setQty(l.key, l.qty - 1)} className="grid size-10 place-items-center rounded-lg border border-line text-lg">−</button>
              <span className="w-8 text-center font-semibold tabular-nums">{l.qty}</span>
              <button type="button" aria-label={tr("Plus")} onClick={() => setQty(l.key, l.qty + 1)} className="grid size-10 place-items-center rounded-lg border border-line text-lg">+</button>
            </span>
            {can("stock.view") && <Button size="sm" onClick={() => setPicking(l.key)}>{tr("Taille / couleur")}</Button>}
            <Button size="sm" variant="danger" onClick={() => setLines((ls) => ls.filter((x) => x.key !== l.key))} disabled={lines.length === 1}>{tr("Retirer")}</Button>
          </li>
        ))}
      </ul>
      {can("stock.view") && !picking && (
        <Button className="mt-2" onClick={() => setPicking("new")}>{tr("+ Ajouter un article")}</Button>
      )}
      {picking && (
        <div className="mt-3 rounded-xl border border-plum-600/30 p-3">
          <p className="mb-2 text-sm font-semibold">{picking === "new" ? tr("Choisir l'article à ajouter") : tr("Choisir la nouvelle taille / couleur")}</p>
          <SearchBox value={q} onChange={setQ} placeholder={tr("Rechercher un produit…")} />
          <ul className="mt-2 max-h-72 space-y-2 overflow-y-auto">
            {products.map((p) => (
              <li key={p.id} className="rounded-lg bg-ivory-deep p-2">
                <p className="text-sm font-medium">{p.name} <span className="text-ink-soft">· {da(p.price)}</span></p>
                <div className="mt-1.5 flex flex-wrap gap-1.5">
                  {p.variants.filter((v) => v.active).map((v) => {
                    const free = Math.max(v.onHand - v.reserved, 0);
                    return (
                      <button
                        key={v.id}
                        type="button"
                        disabled={free <= 0}
                        onClick={() => choose(p, v)}
                        className="h-9 rounded-full border border-line bg-surface px-3 text-xs disabled:opacity-40"
                      >
                        {variantLabel(p, v) || v.sku} · {free}
                      </button>
                    );
                  })}
                </div>
              </li>
            ))}
          </ul>
          <Button className="mt-2" size="sm" onClick={() => setPicking(null)}>{tr("Fermer")}</Button>
        </div>
      )}
      <label className="mt-3 block text-sm font-medium">
        {tr("Raison du changement")} *
        <input className={`${inputCls} mt-1`} value={reason} onChange={(e) => setReason(e.target.value)} placeholder={tr("Ex. : la cliente préfère la taille L")} maxLength={300} />
      </label>
      <div className="mt-3 flex gap-2">
        <Button variant="primary" loading={save.isPending} disabled={reason.trim().length < 2 || !lines.length} onClick={() => save.mutate()}>{tr("Enregistrer")}</Button>
        <Button onClick={onDone}>{tr("Annuler")}</Button>
      </div>
      <p className="mt-2 text-xs text-ink-soft">{tr("Le stock réservé suit les changements. Le prix d'origine est gardé pour un article inchangé.")}</p>
    </Card>
  );
}

/* ───────────── Manual discount ───────────── */

export function DiscountBox({ orderId, subtotal, otherDiscount, current, onDone }: { orderId: number; subtotal: number; otherDiscount: number; current: number; onDone: () => void }) {
  const toast = useToast();
  const [kind, setKind] = useState<"fixed" | "percent">("fixed");
  const [value, setValue] = useState(current ? String(current) : "");
  const [reason, setReason] = useState("");
  const amount = Math.min(manualDiscountAmount(subtotal, kind, Number(value) || 0), Math.max(subtotal - otherDiscount, 0));
  const save = useMutation({
    mutationFn: (v: number) => post<{ amount: number; total: number }>(`/orders/${orderId}/discount`, { kind, value: v, reason: reason.trim() }),
    onSuccess: (r) => {
      toast(r.amount ? tr("Remise de {0} appliquée · nouveau total {1}", { 0: da(r.amount), 1: da(r.total) }) : tr("Remise retirée"));
      onDone();
    },
    onError: (e) => toast(errorMessage(e), "error"),
  });
  return (
    <div className="mt-3 rounded-xl border border-plum-600/30 bg-rose-100/30 p-3">
      <div className="flex flex-wrap items-end gap-2">
        <div className="flex overflow-hidden rounded-lg border border-line">
          {(["fixed", "percent"] as const).map((k) => (
            <button key={k} type="button" onClick={() => setKind(k)} className={`h-11 px-4 text-sm font-semibold ${kind === k ? "bg-plum-600 text-white" : "bg-surface"}`}>
              {k === "fixed" ? "DA" : "%"}
            </button>
          ))}
        </div>
        <input className={`${inputCls} w-32`} inputMode="numeric" value={value} onChange={(e) => setValue(e.target.value.replace(/[^\d.]/g, ""))} aria-label={tr("Montant de la remise")} placeholder="0" />
        <span className="pb-3 text-sm text-ink-soft">= {daMinus(amount)}</span>
      </div>
      <label className="mt-2 block text-sm font-medium">
        {tr("Raison")} *
        <input className={`${inputCls} mt-1`} value={reason} onChange={(e) => setReason(e.target.value)} placeholder={tr("Ex. : fidélité, geste commercial, retard de livraison…")} maxLength={300} />
      </label>
      <div className="mt-3 flex flex-wrap gap-2">
        <Button variant="primary" loading={save.isPending} disabled={reason.trim().length < 2 || !amount} onClick={() => save.mutate(Number(value) || 0)}>{tr("Appliquer la remise")}</Button>
        {current > 0 && <Button variant="danger" disabled={reason.trim().length < 2} onClick={() => save.mutate(0)}>{tr("Retirer la remise")}</Button>}
        <Button onClick={onDone}>{tr("Annuler")}</Button>
      </div>
    </div>
  );
}

/* ───────────── Profit ───────────── */

export function ProfitBlock({ profit }: { profit: ProfitResult }) {
  const row = (label: string, v: number, minus = true) => (
    <div className="flex justify-between gap-3"><dt className="text-ink-soft">{label}</dt><dd className="tabular-nums">{v ? (minus ? daMinus(v) : da(v)) : "—"}</dd></div>
  );
  return (
    <div className="mt-3 rounded-xl bg-ivory-deep p-3 text-sm">
      <p className="mb-1.5 font-semibold">{tr("💸 Bénéfice estimé")}</p>
      <dl className="space-y-0.5">
        {row(tr("Vente des articles"), profit.revenue, false)}
        {row(tr("Coût des produits"), profit.productCost)}
        {row(tr("Livraison payée par la boutique"), profit.shippingCost)}
        {row(tr("Coûts par colis (emballage…)"), profit.packaging)}
        {row(tr("Remises"), profit.discount)}
        <div className={`mt-1 flex items-center justify-between gap-3 border-t border-line pt-2 text-base font-semibold ${profit.profit < 0 ? "text-red-700" : "text-emerald-700"}`}>
          <dt className="flex flex-wrap items-center gap-2">
            {tr("Bénéfice")}
            {profit.margin != null && (
              <span className="rounded-full bg-current/10 px-2 py-0.5 text-xs font-medium">{tr("marge {0} %", { 0: Math.round(profit.margin * 100) })}</span>
            )}
          </dt>
          <dd className="tabular-nums">{da(profit.profit)}</dd>
        </div>
      </dl>
      {profit.missingCost && <p className="mt-1 text-xs text-amber-800">{tr("Coût d'achat manquant pour un article : le bénéfice est surestimé (Produits → coût).")}</p>}
    </div>
  );
}

/* ───────────── Exchanges ───────────── */

export function ExchangesCard({ data, onChange }: { data: OrderOpsData; onChange: () => void }) {
  const toast = useToast();
  const can = useCan();
  const act = useMutation({
    mutationFn: (v: { id: number; action: "approve" | "reject" | "complete" }) => post(`/exchanges/${v.id}`, { action: v.action }),
    onSuccess: (_, v) => {
      toast(v.action === "approve" ? tr("Échange accepté (la nouvelle taille est mise de côté)") : v.action === "reject" ? tr("Échange refusé") : tr("Échange effectué : stock mis à jour"));
      onChange();
    },
    onError: (e) => toast(errorMessage(e), "error"),
  });
  if (!data.exchanges.length) return null;
  return (
    <Card title={tr("🔄 Demandes d'échange")}>
      <ul className="space-y-2">
        {data.exchanges.map((x) => (
          <li key={x.id} className="rounded-xl border border-line p-3 text-sm">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="font-semibold">{x.product} : {x.from_label ?? "?"} → {x.to_label ?? "?"}</p>
              <Badge tone={x.status === "pending" ? "bg-amber-100 text-amber-900" : x.status === "rejected" ? "bg-stone-200 text-stone-700" : "bg-emerald-100 text-emerald-800"}>
                {tr(EXCHANGE_STATUS_LABEL[x.status].fr)}
              </Badge>
            </div>
            <p className="mt-1 text-ink-soft">
              {tr(EXCHANGE_REASON_LABEL[x.reason]?.fr ?? x.reason)}{x.note ? ` · « ${x.note} »` : ""} · {ago(x.created_at)}
            </p>
            {x.status === "pending" && <p className="mt-1 text-xs">{tr("Stock de la nouvelle taille :")} <b>{x.available ?? 0}</b></p>}
            {can("orders.edit") && (x.status === "pending" || x.status === "approved") && (
              <div className="mt-2 flex flex-wrap gap-2">
                {x.status === "pending" && (
                  <Button size="sm" variant="primary" disabled={(x.available ?? 0) <= 0} loading={act.isPending} onClick={() => act.mutate({ id: x.id, action: "approve" })}>{tr("Accepter")}</Button>
                )}
                {x.status === "approved" && (
                  <Button size="sm" variant="primary" loading={act.isPending} onClick={() => act.mutate({ id: x.id, action: "complete" })}>{tr("✓ Échange fait")}</Button>
                )}
                <Button size="sm" variant="danger" loading={act.isPending} onClick={() => act.mutate({ id: x.id, action: "reject" })}>{tr("Refuser")}</Button>
              </div>
            )}
          </li>
        ))}
      </ul>
    </Card>
  );
}

/* ───────────── Full history: status, edits, contacts ───────────── */

const FIELD_LABEL: Record<string, string> = {
  name: tr("Nom"), phone: tr("Téléphone"), wilaya_code: tr("Wilaya"), commune_id: tr("Commune"), address: tr("Adresse"), delivery_type: tr("Mode de livraison"),
  shipping_price: tr("Frais de livraison"), internal_note: tr("Note interne"), tracking_number: tr("N° de suivi"), assigned_to: tr("Assignée à"),
  outcome_reason: tr("Motif"), customer_note: tr("Note de la cliente"), variant: tr("Article"), qty: tr("Quantité"), item_added: tr("Article ajouté"),
  item_removed: tr("Article retiré"), subtotal: tr("Sous-total"), discount: tr("Remise manuelle"), exchange: tr("Échange"),
};

export function OrderHistory({
  events,
  changes,
}: {
  events: { id: number; to_status: string | null; kind: string; actor: string; source: string; note: string | null; created_at: number }[];
  changes: OrderOpsData["changes"];
}) {
  const rows = [
    ...events.filter((e) => e.kind !== "edit" || !changes.length).map((e) => ({ at: e.created_at, key: `e${e.id}`, e, c: null as OrderOpsData["changes"][number] | null })),
    ...changes.map((c) => ({ at: c.created_at, key: `c${c.id}`, e: null, c })),
  ].sort((a, b) => a.at - b.at);
  const money = (f: string, v: string | null) => (v != null && ["shipping_price", "subtotal", "discount"].includes(f) ? da(Number(v)) : v);
  return (
    <ol className="space-y-2 text-sm">
      {rows.map(({ key, at, e, c }) => (
        <li key={key} className="flex gap-2">
          <span className="w-24 shrink-0 text-xs text-ink-soft">{dateTime(at)}</span>
          <span className="min-w-0">
            {e ? (
              e.kind === "status" ? (
                <>{e.to_status ? <StatusBadge status={e.to_status} /> : null} {tr("par")} <b>{actorName(e.actor)}</b>{e.source === "telegram" ? " 📱" : ""}{e.note ? <span className="text-ink-soft"> · {e.note}</span> : null}</>
              ) : (
                <>
                  {CONTACT_KIND_LABEL[e.kind as ContactKind]?.emoji ?? (e.kind === "receipt" ? "📬" : e.kind === "exchange" ? "🔄" : e.kind === "edit" ? "✏️" : "📝")} {e.note}{" "}
                  <span className="text-ink-soft">— {actorName(e.actor)}</span>
                </>
              )
            ) : c ? (
              <>
                ✏️ <b>{FIELD_LABEL[c.field] ?? c.field}</b> : {money(c.field, c.old_value) ?? "—"} → {money(c.field, c.new_value) ?? "—"}
                {c.reason ? <span className="text-ink-soft"> · {c.reason}</span> : null} <span className="text-ink-soft">— {actorName(c.actor)}</span>
              </>
            ) : null}
          </span>
        </li>
      ))}
    </ol>
  );
}


/* ───────────── Possible duplicate orders ───────────── */

interface DuplicatePair {
  id: number;
  order_id: number;
  other_order_id: number;
  score: number;
  reasons: DuplicateReason[];
  minutes_apart: number;
  status: DuplicateStatus;
  decided_by: string | null;
  decided_at: number | null;
  thisIsNewer: boolean;
  other: { id: number; public_code: string; status: OrderStatus; name: string; total: number; created_at: number; wilaya: string | null; address: string | null; items: { name_fr: string; options_label: string | null; qty: number }[] };
}

const DECIDED_LABEL: Partial<Record<DuplicateStatus, string>> = {
  kept: "les deux commandes gardées",
  merged: "commandes fusionnées",
  cancelled: "doublon annulé",
  reviewed: "vérifié",
  ignored: "avertissement ignoré",
};

const apart = (min: number) => (min < 60 ? tr("{0} min d'écart", { 0: min }) : min < 48 * 60 ? tr("{0} h d'écart", { 0: Math.round(min / 60) }) : tr("{0} j d'écart", { 0: Math.round(min / 1440) }));

/** "Possible duplicate" on the order sheet: why, the other order, and the team's decision. */
export function DuplicateWarnings({ orderId, code, onChanged, openOther }: { orderId: number; code: string; onChanged: () => void; openOther: (id: number) => void }) {
  const toast = useToast();
  const can = useCan();
  const q = useQuery({ queryKey: ["order-duplicates", orderId], queryFn: () => api<DuplicatePair[]>(`/orders/${orderId}/duplicates`) });
  const decide = useMutation({
    mutationFn: ({ id, action }: { id: number; action: DuplicateAction }) => post<{ status: DuplicateStatus }>(`/duplicates/${id}`, { action }),
    onSuccess: () => {
      toast(tr("Décision enregistrée"));
      void q.refetch();
      onChanged();
    },
    onError: (e) => toast(errorMessage(e), "error"),
  });
  const pairs = q.data ?? [];
  if (!pairs.length) return null;
  const editable = (s: OrderStatus) => ["nouvelle", "injoignable", "confirmee", "en_preparation"].includes(s);
  return (
    <div className="space-y-2">
      {pairs.map((p) =>
        p.status !== "open" ? (
          <p key={p.id} className="rounded-xl bg-ivory-deep p-2.5 text-xs text-ink-soft">
            {tr("Doublon possible avec {0} : {1}", { 0: p.other.public_code, 1: tr(DECIDED_LABEL[p.status] ?? p.status) })}
            {p.decided_by ? ` · ${actorName(p.decided_by)}` : ""}
          </p>
        ) : (
          <div key={p.id} className="rounded-xl border border-amber-400 bg-amber-50 p-3 text-sm text-amber-950">
            <p className="font-semibold">⚠️ {tr("Doublon possible avec {0}", { 0: p.other.public_code })}</p>
            <div className="mt-1.5 flex flex-wrap gap-1.5">
              {p.reasons.map((r) => (
                <Badge key={r} tone="bg-amber-200/70 text-amber-950">
                  {r === "minutes_apart" || r === "hours_apart" ? apart(p.minutes_apart) : tr(DUPLICATE_REASON_LABEL[r])}
                </Badge>
              ))}
            </div>
            <button type="button" onClick={() => openOther(p.other.id)} className="mt-2 block w-full rounded-lg bg-white/70 p-2.5 text-start text-ink hover:bg-white">
              <span className="flex flex-wrap items-center gap-2 text-sm">
                <span className="font-mono text-xs">{p.other.public_code}</span> · {p.other.name} · <StatusBadge status={p.other.status} /> · <b className="tabular-nums">{da(p.other.total)}</b>
              </span>
              <span className="mt-1 block text-xs text-ink-soft">
                {p.other.items.map((i) => `${i.name_fr}${i.options_label ? ` (${i.options_label})` : ""} × ${i.qty}`).join(" · ")}
              </span>
              <span className="mt-0.5 block text-xs text-ink-soft">{dateTime(p.other.created_at)} · {tr("ouvrir →")}</span>
            </button>
            {can("orders.edit") && (
              <div className="mt-2.5 flex flex-wrap gap-2">
                <Button size="sm" loading={decide.isPending} onClick={() => decide.mutate({ id: p.id, action: "keep" })}>
                  {tr("Garder les deux")}
                </Button>
                {can("orders.confirm") && (
                  <Button
                    size="sm"
                    variant="danger"
                    onClick={() => confirm(tr("Annuler {0} comme doublon ? Son stock réservé est libéré.", { 0: p.thisIsNewer ? code : p.other.public_code })) && decide.mutate({ id: p.id, action: "cancel" })}
                  >
                    {p.thisIsNewer ? tr("Annuler celle-ci (doublon)") : tr("Annuler {0} (doublon)", { 0: p.other.public_code })}
                  </Button>
                )}
                {can("orders.confirm") && editable(p.other.status) && (
                  <Button
                    size="sm"
                    onClick={() =>
                      confirm(tr("Tout regrouper dans la commande la plus ancienne ? Les articles en commun ne sont pas doublés, la plus récente est annulée.")) &&
                      decide.mutate({ id: p.id, action: "merge" })
                    }
                  >
                    {tr("Fusionner en une commande")}
                  </Button>
                )}
                <Button size="sm" onClick={() => decide.mutate({ id: p.id, action: "reviewed" })}>
                  {tr("Vérifié")}
                </Button>
                <Button size="sm" onClick={() => decide.mutate({ id: p.id, action: "ignore" })}>
                  {tr("Ignorer")}
                </Button>
              </div>
            )}
          </div>
        ),
      )}
    </div>
  );
}
