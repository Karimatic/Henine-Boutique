import { formatDzPhone } from "@henine/shared";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { api, del, errorMessage, patch, post, put } from "../api";
import { ago, da, waLink } from "../lib/format";
import {
  Badge, Button, Card, Empty, ErrorState, inputCls, ListSkeleton, NumberField, PageHeader, Pills, Select, Sheet, TextArea, TextField, Toggle, useToast,
} from "../ui";

function useSave<T>(fn: (v: T) => Promise<unknown>, invalidate: string[], ok = "Enregistré ✓") {
  const qc = useQueryClient();
  const toast = useToast();
  return useMutation({
    mutationFn: fn,
    onSuccess: () => {
      toast(ok);
      for (const k of invalidate) void qc.invalidateQueries({ queryKey: [k] });
    },
    onError: (e) => toast(errorMessage(e), "error"),
  });
}

/* ───────────── Promos ───────────── */

interface Coupon {
  id: number;
  code: string;
  type: "percent" | "fixed" | "free_shipping";
  value: number;
  min_subtotal: number | null;
  usage_limit: number | null;
  per_customer_limit: number | null;
  first_order_only: number;
  starts_at: number | null;
  ends_at: number | null;
  is_active: number;
  influencer_name: string | null;
  commission_pct: number | null;
  used_count: number;
  orders: number;
  revenue: number;
  discounted: number;
}

const couponLabel = (c: Pick<Coupon, "type" | "value">) => (c.type === "percent" ? `-${c.value} %` : c.type === "fixed" ? `-${da(c.value)}` : "Livraison offerte");
const toDateInput = (ts: number | null) => (ts ? new Date(ts + 3600_000).toISOString().slice(0, 10) : "");
const fromDateInput = (s: string, end = false) => (s ? new Date(`${s}T${end ? "23:59:59" : "00:00:00"}+01:00`).getTime() : null);

export function PromosPage() {
  const q = useQuery({ queryKey: ["coupons"], queryFn: () => api<{ coupons: Coupon[]; freeShippingOver: number | null }>("/coupons") });
  const [edit, setEdit] = useState<Partial<Coupon> | null>(null);
  return (
    <div>
      <PageHeader group="Commandes" title="Promos" subtitle="Codes promo, codes influenceuses et livraison offerte." actions={<Button variant="primary" onClick={() => setEdit({ type: "percent", value: 10, is_active: 1 })}>+ Nouveau code</Button>} />
      <FreeShipping current={q.data?.freeShippingOver ?? null} />
      {q.error ? <ErrorState error={q.error} onRetry={q.refetch} /> : !q.data ? <ListSkeleton /> : q.data.coupons.length === 0 ? <Empty title="Aucun code promo" icon="🏷" /> : (
        <ul className="grid gap-2 md:grid-cols-2">
          {q.data.coupons.map((c) => {
            const expired = c.ends_at != null && c.ends_at < Date.now();
            return (
              <li key={c.id}>
                <button type="button" onClick={() => setEdit(c)} className="w-full rounded-2xl border border-line bg-white/70 p-4 text-start hover:border-plum-600/40">
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-mono text-lg font-bold text-plum-700">{c.code}</span>
                    <Badge tone={!c.is_active || expired ? "bg-stone-200 text-stone-600" : "bg-emerald-100 text-emerald-800"}>{!c.is_active ? "Désactivé" : expired ? "Expiré" : "Actif"}</Badge>
                  </div>
                  <p className="text-sm">{couponLabel(c)}{c.min_subtotal ? ` dès ${da(c.min_subtotal)}` : ""}{c.first_order_only ? " · 1re commande" : ""}</p>
                  <p className="mt-1 text-xs text-ink-soft">
                    {c.used_count}{c.usage_limit ? `/${c.usage_limit}` : ""} utilisation(s) · {da(c.revenue)} de ventes{c.influencer_name ? ` · 👤 ${c.influencer_name}${c.commission_pct ? ` (${c.commission_pct} % = ${da(Math.round((c.revenue * c.commission_pct) / 100))})` : ""}` : ""}
                  </p>
                </button>
              </li>
            );
          })}
        </ul>
      )}
      {edit && <CouponSheet coupon={edit} onClose={() => setEdit(null)} />}
    </div>
  );
}

function FreeShipping({ current }: { current: number | null }) {
  const home = useQuery({ queryKey: ["home"], queryFn: () => api<{ checkout: { express_on_product: boolean; desk_enabled: boolean; free_shipping_over: number | null; max_orders_per_phone_per_hour: number } } & Record<string, unknown>>("/home") });
  const [value, setValue] = useState<number | null>(current);
  useEffect(() => setValue(current), [current]);
  const save = useSave(
    async (v: number | null) => {
      const h = home.data!;
      await put("/home", { announcement: h.announcement, hero: h.hero, maintenance: h.maintenance, checkout: { ...h.checkout, free_shipping_over: v } });
    },
    ["coupons", "home"],
  );
  return (
    <Card title="🚚 Livraison offerte automatique" className="mb-4">
      <div className="flex flex-wrap items-end gap-2">
        <NumberField label="Dès un panier de" suffix="DA" value={value} onChange={setValue} hint="vide = jamais" className="w-48" />
        <Button onClick={() => save.mutate(value)} loading={save.isPending} disabled={!home.data}>Enregistrer</Button>
      </div>
    </Card>
  );
}

function CouponSheet({ coupon, onClose }: { coupon: Partial<Coupon>; onClose: () => void }) {
  const [f, setF] = useState(coupon);
  const save = useSave(
    () => {
      const body = {
        code: (f.code ?? "").toUpperCase(), type: f.type, value: f.type === "free_shipping" ? 0 : f.value ?? 0, minSubtotal: f.min_subtotal ?? null,
        usageLimit: f.usage_limit ?? null, perCustomerLimit: f.per_customer_limit ?? null, firstOrderOnly: !!f.first_order_only,
        startsAt: f.starts_at ?? null, endsAt: f.ends_at ?? null, isActive: !!f.is_active, influencerName: f.influencer_name || null, commissionPct: f.commission_pct ?? null,
      };
      return coupon.id ? put(`/coupons/${coupon.id}`, body) : post("/coupons", body);
    },
    ["coupons"],
  );
  const remove = useSave(() => del(`/coupons/${coupon.id}`), ["coupons"], "Code supprimé");
  return (
    <Sheet
      open
      onClose={onClose}
      title={coupon.id ? `Code ${coupon.code}` : "Nouveau code promo"}
      footer={
        <div className="flex justify-between gap-2">
          {coupon.id ? <Button variant="danger" onClick={() => confirm("Supprimer ce code ?") && remove.mutate(undefined, { onSuccess: onClose })}>Supprimer</Button> : <span />}
          <Button variant="primary" loading={save.isPending} onClick={() => save.mutate(undefined, { onSuccess: onClose })}>Enregistrer</Button>
        </div>
      }
    >
      <div className="grid gap-3 sm:grid-cols-2">
        <TextField label="Code" value={f.code ?? ""} onChange={(e) => setF({ ...f, code: e.target.value.toUpperCase().replace(/[^A-Z0-9_-]/g, "") })} placeholder="ETE25" />
        <Select label="Type" value={f.type} onChange={(e) => setF({ ...f, type: e.target.value as Coupon["type"] })}>
          <option value="percent">Pourcentage</option>
          <option value="fixed">Montant fixe</option>
          <option value="free_shipping">Livraison offerte</option>
        </Select>
        {f.type !== "free_shipping" && <NumberField label={f.type === "percent" ? "Remise" : "Montant"} suffix={f.type === "percent" ? "%" : "DA"} value={f.value ?? null} onChange={(v) => setF({ ...f, value: v ?? 0 })} />}
        <NumberField label="Panier minimum" suffix="DA" value={f.min_subtotal ?? null} onChange={(v) => setF({ ...f, min_subtotal: v })} />
        <NumberField label="Utilisations max (total)" value={f.usage_limit ?? null} onChange={(v) => setF({ ...f, usage_limit: v })} hint="vide = illimité" />
        <NumberField label="Utilisations max par cliente" value={f.per_customer_limit ?? null} onChange={(v) => setF({ ...f, per_customer_limit: v })} />
        <TextField label="Début" type="date" value={toDateInput(f.starts_at ?? null)} onChange={(e) => setF({ ...f, starts_at: fromDateInput(e.target.value) })} />
        <TextField label="Fin" type="date" value={toDateInput(f.ends_at ?? null)} onChange={(e) => setF({ ...f, ends_at: fromDateInput(e.target.value, true) })} />
        <TextField label="Influenceuse (facultatif)" value={f.influencer_name ?? ""} onChange={(e) => setF({ ...f, influencer_name: e.target.value })} />
        <NumberField label="Commission" suffix="%" value={f.commission_pct ?? null} onChange={(v) => setF({ ...f, commission_pct: v })} />
      </div>
      <div className="mt-3">
        <Toggle label="Réservé à la première commande" checked={!!f.first_order_only} onChange={(v) => setF({ ...f, first_order_only: v ? 1 : 0 })} />
        <Toggle label="Actif" checked={!!f.is_active} onChange={(v) => setF({ ...f, is_active: v ? 1 : 0 })} />
      </div>
    </Sheet>
  );
}

/* ───────────── Page d'accueil ───────────── */

interface HomeSettings {
  announcement: { active: boolean; messages_fr: string[]; messages_ar: string[] };
  hero: { eyebrow_fr: string; eyebrow_ar: string; title_fr: string; title_ar: string; subtitle_fr: string; subtitle_ar: string };
  checkout: { express_on_product: boolean; desk_enabled: boolean; free_shipping_over: number | null; max_orders_per_phone_per_hour: number };
  maintenance: { active: boolean; message_fr: string; message_ar: string };
  faq: FaqItem[];
}

interface FaqItem {
  q_fr: string;
  a_fr: string;
  q_ar: string;
  a_ar: string;
}

function FaqEditor({ items, onChange }: { items: FaqItem[]; onChange: (v: FaqItem[]) => void }) {
  const update = (i: number, patch: Partial<FaqItem>) => onChange(items.map((x, k) => (k === i ? { ...x, ...patch } : x)));
  const move = (i: number, d: -1 | 1) => {
    const next = [...items];
    const j = i + d;
    if (j < 0 || j >= next.length) return;
    [next[i], next[j]] = [next[j]!, next[i]!];
    onChange(next);
  };
  return (
    <Card title="❓ Questions fréquentes (bas de la page d'accueil)" actions={<Button size="sm" onClick={() => onChange([...items, { q_fr: "", a_fr: "", q_ar: "", a_ar: "" }])}>+ Question</Button>}>
      {items.length === 0 && <p className="text-sm text-ink-soft">Aucune question : la section est masquée sur la boutique.</p>}
      <ol className="space-y-4">
        {items.map((f, i) => (
          <li key={i} className="rounded-2xl border border-line bg-white/60 p-3">
            <div className="mb-2 flex items-center justify-between">
              <span className="text-sm font-semibold">Question {i + 1}</span>
              <span className="flex gap-1">
                <Button size="sm" variant="ghost" onClick={() => move(i, -1)} disabled={i === 0} aria-label="Monter">↑</Button>
                <Button size="sm" variant="ghost" onClick={() => move(i, 1)} disabled={i === items.length - 1} aria-label="Descendre">↓</Button>
                <Button size="sm" variant="danger" onClick={() => onChange(items.filter((_, k) => k !== i))}>Retirer</Button>
              </span>
            </div>
            <div className="grid gap-2 sm:grid-cols-2">
              <TextField label="السؤال (عربي)" dir="rtl" value={f.q_ar} onChange={(e) => update(i, { q_ar: e.target.value })} maxLength={200} />
              <TextField label="Question (FR)" value={f.q_fr} onChange={(e) => update(i, { q_fr: e.target.value })} maxLength={200} />
              <TextArea label="الجواب (عربي)" dir="rtl" rows={2} value={f.a_ar} onChange={(e) => update(i, { a_ar: e.target.value })} maxLength={1000} />
              <TextArea label="Réponse (FR)" rows={2} value={f.a_fr} onChange={(e) => update(i, { a_fr: e.target.value })} maxLength={1000} />
            </div>
          </li>
        ))}
      </ol>
    </Card>
  );
}

export function HomePageSettings() {
  const q = useQuery({ queryKey: ["home"], queryFn: () => api<HomeSettings>("/home") });
  const [s, setS] = useState<HomeSettings | null>(null);
  useEffect(() => {
    if (q.data) setS(q.data);
  }, [q.data]);
  const save = useSave(() => put("/home", s), ["home"], "Page d'accueil mise à jour ✓ (visible immédiatement)");
  if (q.error) return <ErrorState error={q.error} onRetry={q.refetch} />;
  if (!s) return <ListSkeleton />;
  const lines = (arr: string[]) => arr.join("\n");
  const split = (v: string) => v.split("\n").map((x) => x.trim()).filter(Boolean).slice(0, 6);
  return (
    <div className="space-y-4 pb-20">
      <PageHeader group="Marketing" title="Page d'accueil" subtitle="Textes du haut de la boutique, bandeau d'annonces et options de commande." actions={<a href="/" target="_blank" rel="noreferrer" className="inline-flex h-9 items-center rounded-full border border-line bg-white px-3.5 text-sm font-semibold">Voir la boutique ↗</a>} />
      <Card title="✨ Grand titre animé (haut de page)">
        <div className="grid gap-3 sm:grid-cols-2">
          <TextField label="Sur-titre (FR)" value={s.hero.eyebrow_fr} onChange={(e) => setS({ ...s, hero: { ...s.hero, eyebrow_fr: e.target.value } })} />
          <TextField label="Sur-titre (AR)" dir="rtl" value={s.hero.eyebrow_ar} onChange={(e) => setS({ ...s, hero: { ...s.hero, eyebrow_ar: e.target.value } })} />
          <TextField label="Titre animé (FR)" value={s.hero.title_fr} onChange={(e) => setS({ ...s, hero: { ...s.hero, title_fr: e.target.value } })} maxLength={90} />
          <TextField label="Titre animé (AR)" dir="rtl" value={s.hero.title_ar} onChange={(e) => setS({ ...s, hero: { ...s.hero, title_ar: e.target.value } })} maxLength={90} />
          <TextArea label="Sous-titre (FR)" rows={2} value={s.hero.subtitle_fr} onChange={(e) => setS({ ...s, hero: { ...s.hero, subtitle_fr: e.target.value } })} />
          <TextArea label="Sous-titre (AR)" dir="rtl" rows={2} value={s.hero.subtitle_ar} onChange={(e) => setS({ ...s, hero: { ...s.hero, subtitle_ar: e.target.value } })} />
        </div>
      </Card>
      <Card title="📣 Bandeau d'annonces (tout en haut)">
        <Toggle label="Afficher le bandeau" checked={s.announcement.active} onChange={(v) => setS({ ...s, announcement: { ...s.announcement, active: v } })} />
        <div className="mt-2 grid gap-3 sm:grid-cols-2">
          <TextArea label="Messages FR (un par ligne)" rows={4} value={lines(s.announcement.messages_fr)} onChange={(e) => setS({ ...s, announcement: { ...s.announcement, messages_fr: split(e.target.value) } })} />
          <TextArea label="Messages AR (سطر لكل رسالة)" dir="rtl" rows={4} value={lines(s.announcement.messages_ar)} onChange={(e) => setS({ ...s, announcement: { ...s.announcement, messages_ar: split(e.target.value) } })} />
        </div>
      </Card>
      <Card title="🛒 Options de commande">
        <Toggle label="Commande express sur la fiche produit" hint="Formulaire directement sur la page du produit (recommandé)." checked={s.checkout.express_on_product} onChange={(v) => setS({ ...s, checkout: { ...s.checkout, express_on_product: v } })} />
        <Toggle label="Livraison au bureau (stop-desk)" checked={s.checkout.desk_enabled} onChange={(v) => setS({ ...s, checkout: { ...s.checkout, desk_enabled: v } })} />
        <NumberField label="Anti-abus : commandes max par numéro et par heure" value={s.checkout.max_orders_per_phone_per_hour} onChange={(v) => setS({ ...s, checkout: { ...s.checkout, max_orders_per_phone_per_hour: Math.max(1, v ?? 3) } })} className="mt-2 max-w-xs" />
      </Card>
      <FaqEditor items={s.faq ?? []} onChange={(faq) => setS({ ...s, faq })} />
      <Card title="🌙 Mode pause (vacances)">
        <Toggle label="Mettre les commandes en pause" hint="La boutique reste visible mais les nouvelles commandes sont refusées avec votre message." checked={s.maintenance.active} onChange={(v) => setS({ ...s, maintenance: { ...s.maintenance, active: v } })} />
        <div className="mt-2 grid gap-3 sm:grid-cols-2">
          <TextField label="Message FR" value={s.maintenance.message_fr} onChange={(e) => setS({ ...s, maintenance: { ...s.maintenance, message_fr: e.target.value } })} />
          <TextField label="Message AR" dir="rtl" value={s.maintenance.message_ar} onChange={(e) => setS({ ...s, maintenance: { ...s.maintenance, message_ar: e.target.value } })} />
        </div>
      </Card>
      <div className="fixed inset-x-0 bottom-[calc(4rem+env(safe-area-inset-bottom))] z-30 border-t border-line bg-ivory/95 p-3 backdrop-blur md:bottom-0 md:ps-[15rem]">
        <div className="mx-auto flex max-w-6xl justify-end px-1 md:px-8">
          <Button variant="primary" loading={save.isPending} onClick={() => save.mutate(undefined)}>Enregistrer</Button>
        </div>
      </div>
    </div>
  );
}

/* ───────────── Avis ───────────── */

interface Review {
  id: number;
  product: string;
  slug: string;
  name: string;
  rating: number;
  text: string | null;
  status: string;
  reply: string | null;
  is_featured: number;
  verified: number;
  created_at: number;
}

export function ReviewsPage() {
  const [status, setStatus] = useState("pending");
  const q = useQuery({ queryKey: ["reviews", status], queryFn: () => api<{ rows: Review[]; counts: { status: string; n: number; avg: number }[] }>(`/reviews?status=${status}`) });
  const count = (s: string) => q.data?.counts.find((c) => c.status === s)?.n ?? 0;
  const approved = q.data?.counts.find((c) => c.status === "approved");
  return (
    <div>
      <PageHeader group="Marketing" title="Avis" subtitle={approved ? `Note moyenne publiée : ${approved.avg.toFixed(1)} / 5 (${approved.n} avis)` : undefined} />
      <Pills value={status} onChange={setStatus} options={[{ value: "pending", label: `À valider (${count("pending")})` }, { value: "approved", label: "Publiés" }, { value: "rejected", label: "Refusés" }, { value: "all", label: "Tous" }]} />
      {q.error ? <ErrorState error={q.error} onRetry={q.refetch} /> : !q.data ? <ListSkeleton /> : q.data.rows.length === 0 ? <Empty title="Aucun avis ici" icon="⭐" /> : (
        <ul className="space-y-2">{q.data.rows.map((r) => <ReviewItem key={r.id} r={r} />)}</ul>
      )}
    </div>
  );
}

function ReviewItem({ r }: { r: Review }) {
  const [reply, setReply] = useState(r.reply ?? "");
  const save = useSave((body: Record<string, unknown>) => patch(`/reviews/${r.id}`, body), ["reviews"]);
  const remove = useSave(() => del(`/reviews/${r.id}`), ["reviews"], "Avis supprimé");
  return (
    <li className="rounded-2xl border border-line bg-white/70 p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="font-semibold">{r.name} <span className="text-gold">{"★".repeat(r.rating)}<span className="text-line">{"★".repeat(5 - r.rating)}</span></span></span>
        <span className="text-xs text-ink-soft">{r.product} · {ago(r.created_at)}</span>
      </div>
      {r.text && <p className="mt-1 text-sm">{r.text}</p>}
      <div className="mt-2 flex flex-wrap gap-1.5">
        {r.verified ? <Badge tone="bg-emerald-100 text-emerald-800">Achat vérifié</Badge> : null}
        {r.is_featured ? <Badge>⭐ Mis en avant</Badge> : null}
      </div>
      <div className="mt-3 flex gap-2">
        <input className={`${inputCls} h-10`} placeholder="Répondre publiquement (facultatif)…" value={reply} onChange={(e) => setReply(e.target.value)} />
        <Button size="sm" className="h-10" onClick={() => save.mutate({ reply: reply || null })}>Répondre</Button>
      </div>
      <div className="mt-3 flex flex-wrap gap-2">
        {r.status !== "approved" && <Button size="sm" variant="primary" onClick={() => save.mutate({ status: "approved" })}>✓ Publier</Button>}
        {r.status !== "rejected" && <Button size="sm" onClick={() => save.mutate({ status: "rejected" })}>Refuser</Button>}
        <Button size="sm" variant="ghost" onClick={() => save.mutate({ isFeatured: !r.is_featured })}>{r.is_featured ? "Ne plus mettre en avant" : "Mettre en avant"}</Button>
        <Button size="sm" variant="danger" onClick={() => confirm("Supprimer définitivement cet avis ?") && remove.mutate(undefined)}>Supprimer</Button>
      </div>
    </li>
  );
}

/* ───────────── Notifier ───────────── */

interface Notifications {
  telegram_new_order: boolean;
  telegram_status_change: boolean;
  telegram_low_stock: boolean;
  telegram_review: boolean;
  telegram_contact: boolean;
  trust_group_members: boolean;
}

export function NotifierPage() {
  const q = useQuery({
    queryKey: ["notifier"],
    queryFn: () => api<{ notifications: Notifications; waitlists: { variant_id: number; name_fr: string; options: string; sku: string; available: number; waiting: number; phones: string; last_at: number }[] }>("/notifier"),
  });
  const [n, setN] = useState<Notifications | null>(null);
  useEffect(() => {
    if (q.data) setN(q.data.notifications);
  }, [q.data]);
  const save = useSave((v: Notifications) => put("/notifier/settings", v), ["notifier"]);
  const notified = useSave((variantId: number) => post(`/notifier/waitlist/${variantId}/notified`), ["notifier"], "Marquées comme prévenues");
  if (q.error) return <ErrorState error={q.error} onRetry={q.refetch} />;
  if (!q.data || !n) return <ListSkeleton />;
  const toggle = (k: keyof Notifications) => (v: boolean) => {
    const next = { ...n, [k]: v };
    setN(next);
    save.mutate(next);
  };
  return (
    <div className="space-y-4">
      <PageHeader group="Marketing" title="Notifier" subtitle="Ce que l'équipe reçoit sur Telegram, et les clientes qui attendent un retour en stock." />
      <Card title="📱 Notifications Telegram de l'équipe">
        <Toggle label="Nouvelle commande" hint="Avec boutons Confirmer / Injoignable / Annuler" checked={n.telegram_new_order} onChange={toggle("telegram_new_order")} />
        <Toggle label="Mise à jour du message quand le statut change" checked={n.telegram_status_change} onChange={toggle("telegram_status_change")} />
        <Toggle label="Alerte stock bas" checked={n.telegram_low_stock} onChange={toggle("telegram_low_stock")} />
        <Toggle label="Nouvel avis à valider" checked={n.telegram_review} onChange={toggle("telegram_review")} />
        <Toggle label="Nouveau message de contact" checked={n.telegram_contact} onChange={toggle("telegram_contact")} />
        <div className="mt-2 border-t border-line pt-2">
          <Toggle
            label="Tous les membres du groupe peuvent utiliser les boutons"
            hint="Sinon, seules les personnes dont l'ID Telegram est renseigné dans Équipe (et selon leur rôle)."
            checked={n.trust_group_members}
            onChange={toggle("trust_group_members")}
          />
        </div>
      </Card>
      <Card title="🔔 Clientes en attente d'un retour en stock">
        {q.data.waitlists.length === 0 ? (
          <p className="text-sm text-ink-soft">Personne pour l'instant. Sur une taille épuisée, la boutique propose « Prévenez-moi du retour ».</p>
        ) : (
          <ul className="space-y-3">
            {q.data.waitlists.map((w) => (
              <li key={w.variant_id} className="rounded-xl bg-ivory-deep p-3">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-sm font-semibold">{w.name_fr} · {w.options}</span>
                  <Badge tone={w.available > 0 ? "bg-emerald-100 text-emerald-800" : "bg-stone-200 text-stone-700"}>{w.available > 0 ? `De retour (${w.available})` : "Toujours épuisé"}</Badge>
                </div>
                <p className="mt-1 text-xs text-ink-soft">{w.waiting} cliente(s) · dernière demande {ago(w.last_at)}</p>
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {w.phones.split(", ").map((p) => (
                    <a key={p} href={waLink(p, `Bonjour 🌸 Bonne nouvelle : « ${w.name_fr} (${w.options}) » est de retour chez Henine Boutique ! ${location.origin}`)} target="_blank" rel="noreferrer" className="rounded-full bg-[#25D366] px-3 py-1 text-xs font-semibold text-white">
                      {formatDzPhone(p)}
                    </a>
                  ))}
                </div>
                <Button size="sm" className="mt-2" onClick={() => notified.mutate(w.variant_id)}>Marquer comme prévenues</Button>
              </li>
            ))}
          </ul>
        )}
      </Card>
      <Card title="📲 Notifications sur le téléphone des clientes">
        <p className="text-sm text-ink-soft">Les notifications « push » nécessitent l'adresse https définitive de la boutique (après le déploiement). Prévues dans une prochaine étape.</p>
      </Card>
    </div>
  );
}

/* ───────────── Liens ───────────── */

interface LinkRow {
  id: number;
  kind: "bio" | "short";
  slug: string | null;
  label_fr: string | null;
  label_ar: string | null;
  target: string;
  icon: string | null;
  sort: number;
  is_active: number;
  clicks: number;
}

export function LinksPage() {
  const q = useQuery({ queryKey: ["links"], queryFn: () => api<LinkRow[]>("/links") });
  const [edit, setEdit] = useState<Partial<LinkRow> | null>(null);
  const bio = q.data?.filter((l) => l.kind === "bio") ?? [];
  const short = q.data?.filter((l) => l.kind === "short") ?? [];
  const origin = location.origin;
  return (
    <div className="space-y-4">
      <PageHeader group="Marketing" title="Liens" subtitle="Page « lien en bio » Instagram et liens courts avec compteur de clics." />
      {q.error ? <ErrorState error={q.error} onRetry={q.refetch} /> : !q.data ? <ListSkeleton /> : (
        <>
          <Card title="🌸 Page lien en bio" actions={<Button size="sm" variant="primary" onClick={() => setEdit({ kind: "bio", is_active: 1, sort: bio.length })}>+ Lien</Button>}>
            <p className="mb-3 text-sm text-ink-soft">À mettre dans la bio Instagram : <a href="/liens" target="_blank" rel="noreferrer" className="font-mono font-semibold text-plum-600">{origin}/liens</a></p>
            <ul className="divide-y divide-line">
              {bio.map((l) => (
                <li key={l.id}>
                  <button type="button" onClick={() => setEdit(l)} className="flex w-full items-center justify-between gap-2 py-2.5 text-start">
                    <span className={`min-w-0 ${l.is_active ? "" : "opacity-50"}`}>
                      <span className="block truncate text-sm font-medium">{l.label_fr}</span>
                      <span className="block truncate text-xs text-ink-soft">{l.target}</span>
                    </span>
                    <span className="text-ink-soft">›</span>
                  </button>
                </li>
              ))}
            </ul>
          </Card>
          <Card title="🔗 Liens courts (suivi des clics)" actions={<Button size="sm" variant="primary" onClick={() => setEdit({ kind: "short", is_active: 1 })}>+ Lien court</Button>}>
            {short.length === 0 ? <p className="text-sm text-ink-soft">Ex : {origin}/l/ete25 → une page, avec le nombre de clics.</p> : (
              <ul className="divide-y divide-line">
                {short.map((l) => (
                  <li key={l.id}>
                    <button type="button" onClick={() => setEdit(l)} className="flex w-full items-center justify-between gap-2 py-2.5 text-start">
                      <span className="min-w-0">
                        <span className="block truncate font-mono text-sm font-semibold text-plum-700">/l/{l.slug}</span>
                        <span className="block truncate text-xs text-ink-soft">→ {l.target}</span>
                      </span>
                      <Badge tone="bg-stone-100 text-stone-700">{l.clicks} clic(s)</Badge>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </>
      )}
      {edit && <LinkSheet link={edit} onClose={() => setEdit(null)} />}
    </div>
  );
}

function LinkSheet({ link, onClose }: { link: Partial<LinkRow>; onClose: () => void }) {
  const [f, setF] = useState(link);
  const save = useSave(() => {
    const body = { kind: f.kind, slug: f.slug || null, labelFr: f.label_fr || null, labelAr: f.label_ar || null, target: f.target ?? "", icon: f.icon || null, sort: f.sort ?? 0, isActive: !!f.is_active };
    return link.id ? put(`/links/${link.id}`, body) : post("/links", body);
  }, ["links"]);
  const remove = useSave(() => del(`/links/${link.id}`), ["links"], "Lien supprimé");
  return (
    <Sheet
      open
      onClose={onClose}
      title={link.id ? "Modifier le lien" : f.kind === "short" ? "Nouveau lien court" : "Nouveau lien"}
      footer={
        <div className="flex justify-between gap-2">
          {link.id ? <Button variant="danger" onClick={() => confirm("Supprimer ce lien ?") && remove.mutate(undefined, { onSuccess: onClose })}>Supprimer</Button> : <span />}
          <Button variant="primary" loading={save.isPending} onClick={() => save.mutate(undefined, { onSuccess: onClose })}>Enregistrer</Button>
        </div>
      }
    >
      <div className="grid gap-3">
        {f.kind === "short" && <TextField label="Adresse courte" hint={`${location.origin}/l/…`} value={f.slug ?? ""} onChange={(e) => setF({ ...f, slug: e.target.value.toLowerCase() })} placeholder="ete25" />}
        <TextField label="Texte du bouton (FR)" value={f.label_fr ?? ""} onChange={(e) => setF({ ...f, label_fr: e.target.value })} placeholder="🛍️ Voir la boutique" />
        <TextField label="Texte du bouton (AR)" dir="rtl" value={f.label_ar ?? ""} onChange={(e) => setF({ ...f, label_ar: e.target.value })} />
        <TextField label="Destination" hint="/page de la boutique ou https://…" value={f.target ?? ""} onChange={(e) => setF({ ...f, target: e.target.value })} placeholder="/c/robes ou https://wa.me/213…" />
        {f.kind === "bio" && <NumberField label="Ordre" value={f.sort ?? 0} onChange={(v) => setF({ ...f, sort: v ?? 0 })} />}
        <Toggle label="Actif" checked={!!f.is_active} onChange={(v) => setF({ ...f, is_active: v ? 1 : 0 })} />
      </div>
    </Sheet>
  );
}

/* ───────────── Contact ───────────── */

interface Message {
  id: number;
  name: string;
  phone: string | null;
  subject: string | null;
  message: string;
  status: string;
  created_at: number;
}

interface ContactSettings {
  phone: string | null; whatsapp: string | null; instagram: string | null; tiktok: string | null; facebook: string | null; maps: string | null; address_fr: string | null; address_ar: string | null;
}

export function ContactPage() {
  const [status, setStatus] = useState("open");
  const q = useQuery({ queryKey: ["contact", status], queryFn: () => api<{ rows: Message[]; contact: ContactSettings; store: { hours_fr: string; hours_ar: string } }>(`/contact?status=${status}`) });
  const setMsg = useSave(({ id, s }: { id: number; s: string }) => patch(`/contact/${id}`, { status: s }), ["contact", "dashboard"], "Message mis à jour");
  return (
    <div className="space-y-4">
      <PageHeader group="Marketing" title="Contact" subtitle="Messages reçus via la page Contact + coordonnées affichées sur la boutique." />
      <Pills value={status} onChange={setStatus} options={[{ value: "open", label: "À traiter" }, { value: "done", label: "Traités" }, { value: "spam", label: "Spam" }, { value: "all", label: "Tous" }]} />
      {q.error ? <ErrorState error={q.error} onRetry={q.refetch} /> : !q.data ? <ListSkeleton /> : (
        <>
          {q.data.rows.length === 0 ? <Empty title="Aucun message" icon="✉️" /> : (
            <ul className="space-y-2">
              {q.data.rows.map((m) => (
                <li key={m.id} className="rounded-2xl border border-line bg-white/70 p-4">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className="font-semibold">{m.name}{m.subject ? ` · ${m.subject}` : ""}</span>
                    <span className="text-xs text-ink-soft">{ago(m.created_at)}</span>
                  </div>
                  <p className="mt-1 whitespace-pre-line text-sm">{m.message}</p>
                  <div className="mt-3 flex flex-wrap gap-2">
                    {m.phone && <a href={waLink(m.phone, `Bonjour ${m.name} 🌸 Ici Henine Boutique, suite à votre message : `)} target="_blank" rel="noreferrer" className="inline-flex h-9 items-center rounded-full bg-[#25D366] px-3.5 text-sm font-semibold text-white">Répondre sur WhatsApp</a>}
                    {m.status !== "done" && <Button size="sm" variant="primary" onClick={() => setMsg.mutate({ id: m.id, s: "done" })}>✓ Traité</Button>}
                    {m.status !== "spam" && <Button size="sm" variant="ghost" onClick={() => setMsg.mutate({ id: m.id, s: "spam" })}>Spam</Button>}
                  </div>
                </li>
              ))}
            </ul>
          )}
          <ContactSettingsCard contact={q.data.contact} store={q.data.store} />
        </>
      )}
    </div>
  );
}

function ContactSettingsCard({ contact, store }: { contact: ContactSettings; store: { hours_fr: string; hours_ar: string } }) {
  const [c, setC] = useState(contact);
  const [s, setS] = useState(store);
  const save = useSave(() => put("/contact/settings", { contact: Object.fromEntries(Object.entries(c).map(([k, v]) => [k, v || null])), store: s }), ["contact"]);
  const field = (k: keyof ContactSettings, label: string, extra?: Record<string, unknown>) => (
    <TextField label={label} value={c[k] ?? ""} onChange={(e) => setC({ ...c, [k]: e.target.value })} {...extra} />
  );
  return (
    <Card title="Coordonnées affichées sur la boutique">
      <div className="grid gap-3 sm:grid-cols-2">
        {field("phone", "Téléphone", { inputMode: "tel" })}
        {field("whatsapp", "WhatsApp", { inputMode: "tel" })}
        {field("instagram", "Instagram (https://…)")}
        {field("tiktok", "TikTok (https://…)")}
        {field("facebook", "Facebook (https://…)")}
        {field("maps", "Google Maps (https://…)")}
        {field("address_fr", "Adresse (FR)")}
        {field("address_ar", "Adresse (AR)", { dir: "rtl" })}
        <TextField label="Horaires (FR)" value={s.hours_fr} onChange={(e) => setS({ ...s, hours_fr: e.target.value })} />
        <TextField label="Horaires (AR)" dir="rtl" value={s.hours_ar} onChange={(e) => setS({ ...s, hours_ar: e.target.value })} />
      </div>
      <Button variant="primary" className="mt-3" loading={save.isPending} onClick={() => save.mutate(undefined)}>Enregistrer</Button>
    </Card>
  );
}

