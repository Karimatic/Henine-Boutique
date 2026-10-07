import { formatDzPhone, resolveStoreTexts, STORE_TEXTS, type StoreTexts } from "@henine/shared";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useSearch } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { api, del, errorMessage, patch, post, put } from "../api";
import { ago, da, daMinus, ltr, waLink } from "../lib/format";
import { CategoryPicker, ProductPicker } from "../lib/pickers";
import {
  Badge, Button, Card, Empty, ErrorState, Field, inputCls, ListSkeleton, NumberField, PageHeader, Pills, Select, Sheet, TextArea, TextField, Toggle, useToast,
} from "../ui";
import { tr } from "../i18n";
import { SubNav } from "../lib/subnav";

function useSave<T>(fn: (v: T) => Promise<unknown>, invalidate: string[], ok = "Enregistré ✓") {
  const qc = useQueryClient();
  const toast = useToast();
  return useMutation({
    mutationFn: fn,
    onSuccess: () => {
      toast(tr(ok));
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
  /** JSON {productIds, categoryIds}: the discount only for these */
  applies_to: string | null;
  used_count: number;
  orders: number;
  revenue: number;
  discounted: number;
}

const couponLabel = (c: Pick<Coupon, "type" | "value">) => (c.type === "percent" ? ltr(`-${c.value} %`) : c.type === "fixed" ? daMinus(c.value) : "Livraison offerte");
const toDateInput = (ts: number | null) => (ts ? new Date(ts + 3600_000).toISOString().slice(0, 10) : "");
const fromDateInput = (s: string, end = false) => (s ? new Date(`${s}T${end ? "23:59:59" : "00:00:00"}+01:00`).getTime() : null);

export function PromosPage() {
  const q = useQuery({ queryKey: ["coupons"], queryFn: () => api<{ coupons: Coupon[]; freeShippingOver: number | null }>("/coupons") });
  const [edit, setEdit] = useState<Partial<Coupon> | null>(null);
  return (
    <div>
      <PageHeader group={tr("Commandes")} title={tr("Promos")} subtitle={tr("Codes promo et codes influenceuses. La livraison offerte automatique se règle dans Paramètres → Commandes & livraison.")} actions={<Button variant="primary" onClick={() => setEdit({ type: "percent", value: 10, is_active: 1 })}>{tr("+ Nouveau code")}</Button>} />
      <SubNav of="promos" />
      <FlashSales />
      <InfluencerReport />
      {q.error ? <ErrorState error={q.error} onRetry={q.refetch} /> : !q.data ? <ListSkeleton /> : q.data.coupons.length === 0 ? <Empty title={tr("Aucun code promo")} icon="🏷" /> : (
        <ul className="grid gap-2 md:grid-cols-2">
          {q.data.coupons.map((c) => {
            const expired = c.ends_at != null && c.ends_at < Date.now();
            return (
              <li key={c.id}>
                <button type="button" onClick={() => setEdit(c)} className="w-full rounded-xl border border-line bg-surface p-4 text-start hover:border-plum-600/40">
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-mono text-lg font-bold text-plum-700">{c.code}</span>
                    <Badge tone={!c.is_active || expired ? "bg-stone-200 text-stone-600" : "bg-emerald-100 text-emerald-800"}>{!c.is_active ? tr("Désactivé") : expired ? tr("Expiré") : tr("Actif")}</Badge>
                  </div>
                  <p className="text-sm">
                    {couponLabel(c)}{c.min_subtotal ? tr(" dès {0}", { 0: da(c.min_subtotal) }) : ""}{c.first_order_only ? tr(" · 1re commande") : ""}
                    {c.applies_to ? tr(" · sur certains articles") : ""}
                  </p>
                  <p className="mt-1 text-xs text-ink-soft">
                    {c.used_count}{c.usage_limit ? `/${c.usage_limit}` : ""} {tr("utilisation(s) ·")} {da(c.revenue)} {tr("de ventes")}{c.influencer_name ? ` · 👤 ${c.influencer_name}${c.commission_pct ? ` (${c.commission_pct} % = ${da(Math.round((c.revenue * c.commission_pct) / 100))})` : ""}` : ""}
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

interface InfluencerRow {
  name: string;
  codes: string[];
  orders: number;
  delivered: number;
  returned: number;
  pending: number;
  newCustomers: number;
  deliveredSales: number;
  pendingSales: number;
  commission: number;
  pendingCommission: number;
}

/** Start of a month in Algiers time (UTC+1), `offset` months from now. */
function monthStart(offset = 0): number {
  const now = new Date(Date.now() + 3600_000);
  return Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + offset, 1) - 3600_000;
}

function InfluencerReport() {
  const [period, setPeriod] = useState<"month" | "last" | "30" | "all">("month");
  const range = period === "month" ? [monthStart(), 0] : period === "last" ? [monthStart(-1), monthStart()] : period === "30" ? [Date.now() - 30 * 86400_000, 0] : [0, 0];
  const q = useQuery({ queryKey: ["influencers", period], queryFn: () => api<InfluencerRow[]>(`/influencers?from=${range[0]}&to=${range[1] || ""}`) });
  if (q.data && q.data.length === 0) return null; // no influencer codes yet: nothing to show
  const total = (q.data ?? []).reduce((s, r) => s + r.commission, 0);
  return (
    <Card title={tr("👤 Influenceuses : ce que leurs codes rapportent")} className="mb-4">
      <Pills
        value={period}
        onChange={setPeriod}
        options={[
          { value: "month", label: tr("Ce mois-ci") },
          { value: "last", label: tr("Mois dernier") },
          { value: "30", label: tr("30 derniers jours") },
          { value: "all", label: tr("Depuis le début") },
        ]}
      />
      {q.error ? (
        <ErrorState error={q.error} onRetry={q.refetch} />
      ) : !q.data ? (
        <ListSkeleton rows={2} />
      ) : (
        <>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[40rem] text-sm">
              <thead>
                <tr className="border-b border-line text-xs text-ink-soft">
                  <th className="py-2 text-start font-medium">{tr("Influenceuse")}</th>
                  <th className="px-2 text-end font-medium">{tr("Commandes")}</th>
                  <th className="px-2 text-end font-medium">{tr("Livrées")}</th>
                  <th className="px-2 text-end font-medium">{tr("Nouvelles clientes")}</th>
                  <th className="px-2 text-end font-medium">{tr("Ventes livrées")}</th>
                  <th className="ps-2 text-end font-medium">{tr("Commission due")}</th>
                </tr>
              </thead>
              <tbody>
                {q.data.map((r) => (
                  <tr key={r.name} className="border-b border-line/60 last:border-0">
                    <td className="py-2.5">
                      <span className="block font-semibold">{r.name}</span>
                      <span className="block font-mono text-xs text-ink-soft">{r.codes.join(" · ")}</span>
                    </td>
                    <td className="px-2 text-end tabular-nums">
                      {r.orders}
                      {r.pending ? <span className="block text-xs text-ink-soft">{r.pending} {tr("en cours")}</span> : null}
                    </td>
                    <td className="px-2 text-end tabular-nums">
                      {r.delivered}
                      {r.returned ? <span className="block text-xs text-orange-700">{r.returned} {tr("retour(s)")}</span> : null}
                    </td>
                    <td className="px-2 text-end tabular-nums">{r.newCustomers}</td>
                    <td className="px-2 text-end tabular-nums">{da(r.deliveredSales)}</td>
                    <td className="ps-2 text-end tabular-nums">
                      <b>{da(r.commission)}</b>
                      {r.pendingCommission ? <span className="block text-xs text-ink-soft">+ {da(r.pendingCommission)} {tr("si livrées")}</span> : null}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="mt-3 flex flex-wrap justify-between gap-2 text-xs text-ink-soft">
            <span>{tr("Commission calculée sur les commandes")} <b>{tr("livrées")}</b> {tr("uniquement, sur les articles (après remise, livraison non comptée).")}</span>
            <span>
              {tr("Total à payer :")} <b className="text-ink">{da(total)}</b>
            </span>
          </p>
        </>
      )}
    </Card>
  );
}

function CouponSheet({ coupon, onClose }: { coupon: Partial<Coupon>; onClose: () => void }) {
  const [f, setF] = useState(coupon);
  const scope0 = JSON.parse(coupon.applies_to ?? "null") as { productIds?: number[]; categoryIds?: number[] } | null;
  const [productIds, setProductIds] = useState<number[]>(scope0?.productIds ?? []);
  const [categoryIds, setCategoryIds] = useState<number[]>(scope0?.categoryIds ?? []);
  const [limited, setLimited] = useState(!!(scope0?.productIds?.length || scope0?.categoryIds?.length));
  const save = useSave(
    () => {
      const body = {
        code: (f.code ?? "").toUpperCase(), type: f.type, value: f.type === "free_shipping" ? 0 : f.value ?? 0, minSubtotal: f.min_subtotal ?? null,
        usageLimit: f.usage_limit ?? null, perCustomerLimit: f.per_customer_limit ?? null, firstOrderOnly: !!f.first_order_only,
        startsAt: f.starts_at ?? null, endsAt: f.ends_at ?? null, isActive: !!f.is_active, influencerName: f.influencer_name || null, commissionPct: f.commission_pct ?? null,
        appliesTo: limited && (productIds.length || categoryIds.length) ? { productIds, categoryIds } : null,
      };
      return coupon.id ? put(`/coupons/${coupon.id}`, body) : post("/coupons", body);
    },
    ["coupons"],
  );
  const remove = useSave(() => del(`/coupons/${coupon.id}`), ["coupons"], tr("Code supprimé"));
  return (
    <Sheet
      open
      onClose={onClose}
      title={coupon.id ? tr("Code {0}", { 0: coupon.code }) : tr("Nouveau code promo")}
      footer={
        <div className="flex justify-between gap-2">
          {coupon.id ? <Button variant="danger" onClick={() => confirm(tr("Supprimer ce code ?")) && remove.mutate(undefined, { onSuccess: onClose })}>{tr("Supprimer")}</Button> : <span />}
          <Button variant="primary" loading={save.isPending} onClick={() => save.mutate(undefined, { onSuccess: onClose })}>{tr("Enregistrer")}</Button>
        </div>
      }
    >
      <div className="grid gap-3 sm:grid-cols-2">
        <TextField label={tr("Code")} value={f.code ?? ""} onChange={(e) => setF({ ...f, code: e.target.value.toUpperCase().replace(/[^A-Z0-9_-]/g, "") })} placeholder={tr("ETE25")} />
        <Select label={tr("Type")} value={f.type} onChange={(e) => setF({ ...f, type: e.target.value as Coupon["type"] })}>
          <option value="percent">{tr("Pourcentage")}</option>
          <option value="fixed">{tr("Montant fixe")}</option>
          <option value="free_shipping">{tr("Livraison offerte")}</option>
        </Select>
        {f.type !== "free_shipping" && <NumberField label={f.type === "percent" ? tr("Remise") : tr("Montant")} suffix={f.type === "percent" ? "%" : tr("DA")} value={f.value ?? null} onChange={(v) => setF({ ...f, value: v ?? 0 })} />}
        <NumberField label={tr("Panier minimum")} suffix={tr("DA")} value={f.min_subtotal ?? null} onChange={(v) => setF({ ...f, min_subtotal: v })} />
        <NumberField label={tr("Utilisations max (total)")} value={f.usage_limit ?? null} onChange={(v) => setF({ ...f, usage_limit: v })} hint={tr("vide = illimité")} />
        <NumberField label={tr("Utilisations max par cliente")} value={f.per_customer_limit ?? null} onChange={(v) => setF({ ...f, per_customer_limit: v })} />
        <TextField label={tr("Début")} type="date" value={toDateInput(f.starts_at ?? null)} onChange={(e) => setF({ ...f, starts_at: fromDateInput(e.target.value) })} />
        <TextField label={tr("Fin")} type="date" value={toDateInput(f.ends_at ?? null)} onChange={(e) => setF({ ...f, ends_at: fromDateInput(e.target.value, true) })} />
        <TextField label={tr("Influenceuse (facultatif)")} value={f.influencer_name ?? ""} onChange={(e) => setF({ ...f, influencer_name: e.target.value })} />
        <NumberField label={tr("Commission")} suffix="%" value={f.commission_pct ?? null} onChange={(v) => setF({ ...f, commission_pct: v })} />
      </div>
      <div className="mt-3">
        <Toggle label={tr("Réservé à la première commande")} checked={!!f.first_order_only} onChange={(v) => setF({ ...f, first_order_only: v ? 1 : 0 })} />
        <Toggle
          label={tr("Seulement sur certaines catégories ou certains produits")}
          hint={tr("Sinon, la remise s'applique à tout le panier.")}
          checked={limited}
          onChange={setLimited}
        />
        {limited && (
          <div className="mb-3 space-y-4 rounded-xl bg-ivory-deep p-3">
            <CategoryPicker label={tr("Catégories concernées")} value={categoryIds} onChange={setCategoryIds} />
            <ProductPicker label={tr("Produits concernés")} value={productIds} onChange={setProductIds} max={200} />
            <p className="text-xs text-ink-soft">{tr("La remise ne compte que les articles de ces catégories / produits ; les autres articles du panier gardent leur prix.")}</p>
          </div>
        )}
        <Toggle label={tr("Actif")} checked={!!f.is_active} onChange={(v) => setF({ ...f, is_active: v ? 1 : 0 })} />
      </div>
    </Sheet>
  );
}

/* ───────────── Textes de la boutique ───────────── */

type TextLocale = "ar" | "fr";
export type Overrides = Partial<StoreTexts>;

/**
 * Edit the store's texts one language at a time. Each box starts with what customers see
 * today; whatever is left as the built-in text isn't stored, so the other language and any
 * untouched text keep their default. "Rétablir" puts a text back to the original.
 */
export function StoreTextsEditor({ saved }: { saved: { ar: Overrides; fr: Overrides } }) {
  const [lang, setLang] = useState<TextLocale>("ar");
  const [draft, setDraft] = useState<StoreTexts>(() => resolveStoreTexts("ar", saved.ar));
  // reload only when the language or the saved texts really change (not on every parent render)
  const savedKey = JSON.stringify(saved[lang]);
  useEffect(() => setDraft(resolveStoreTexts(lang, JSON.parse(savedKey) as Overrides)), [lang, savedKey]);
  const save = useSave((v: { locale: TextLocale; texts: Overrides }) => put("/home/texts", v), ["home"], tr("Textes enregistrés ✓ (visibles tout de suite sur la boutique)"));
  const def = STORE_TEXTS[lang];
  const rtl = lang === "ar";
  const dir = rtl ? "rtl" : "ltr";

  // only what differs from the built-in text is stored
  function overridesOf(t: StoreTexts): Overrides {
    const o: Overrides = {};
    for (const k of ["eyebrow", "title", "subtitle", "pause"] as const) if (t[k].trim() && t[k].trim() !== def[k]) o[k] = t[k].trim();
    const ann = t.announcement.map((m) => m.trim()).filter(Boolean);
    if (ann.length && JSON.stringify(ann) !== JSON.stringify(def.announcement)) o.announcement = ann;
    const faq = t.faq.map((f) => ({ q: f.q.trim(), a: f.a.trim() })).filter((f) => f.q && f.a);
    if (faq.length && JSON.stringify(faq) !== JSON.stringify(def.faq)) o.faq = faq;
    return o;
  }
  const changed = JSON.stringify(overridesOf(draft)) !== JSON.stringify(overridesOf(resolveStoreTexts(lang, saved[lang])));
  const edited = (k: keyof StoreTexts) => JSON.stringify(draft[k]) !== JSON.stringify(def[k]);
  const reset = (k: keyof StoreTexts) => setDraft((d) => ({ ...d, [k]: def[k] }));
  const resetBtn = (k: keyof StoreTexts) =>
    edited(k) ? (
      <button type="button" onClick={() => reset(k)} className="text-xs font-semibold text-plum-600 hover:underline">
        {tr("Rétablir le texte d'origine")}
      </button>
    ) : (
      <span className="text-xs text-ink-soft">{tr("texte d'origine")}</span>
    );
  const moveFaq = (i: number, d: -1 | 1) =>
    setDraft((x) => {
      const faq = [...x.faq];
      const j = i + d;
      if (j < 0 || j >= faq.length) return x;
      [faq[i], faq[j]] = [faq[j]!, faq[i]!];
      return { ...x, faq };
    });

  return (
    <Card
      title={tr("Textes de la boutique")}
      actions={
        <div className="inline-flex rounded-lg bg-ivory-deep/70 p-1" role="tablist" aria-label={tr("Langue des textes")}>
          {(
            [
              ["ar", "العربية"],
              ["fr", tr("Français")],
            ] as const
          ).map(([code, label]) => (
            <button
              key={code}
              type="button"
              role="tab"
              aria-selected={lang === code}
              onClick={() => setLang(code)}
              className={`h-8 rounded-md px-3.5 text-sm font-semibold transition ${lang === code ? "bg-surface text-plum-700 shadow-sm" : "text-ink-soft hover:text-ink"}`}
            >
              {label}
            </button>
          ))}
        </div>
      }
    >
      <p className="mb-5 rounded-lg bg-rose-100/60 p-3 text-sm text-plum-700">
        {tr("Vous modifiez les textes")} <b>{rtl ? tr("en arabe") : tr("en français")}</b> {tr("(page")} {rtl ? tr("arabe") : tr("française")} {tr("de la boutique). Ce que vous changez est traduit automatiquement dans l'autre langue à l'enregistrement ; ce que vous ne modifiez pas garde son texte d'origine.")}
      </p>

      <div className="space-y-5">
        <section>
          <h3 className="mb-3 text-sm font-semibold uppercase tracking-[0.1em] text-ink-soft">{tr("✨ Haut de la page d'accueil")}</h3>
          <div className="grid gap-3">
            <Field label={tr("Petite ligne au-dessus du titre")} hint={resetBtn("eyebrow")}>
              {(id) => <input id={id} dir={dir} className={inputCls} value={draft.eyebrow} maxLength={60} onChange={(e) => setDraft({ ...draft, eyebrow: e.target.value })} />}
            </Field>
            <Field label={tr("Grand titre animé")} hint={resetBtn("title")}>
              {(id) => <input id={id} dir={dir} className={`${inputCls} text-lg font-semibold`} value={draft.title} maxLength={90} onChange={(e) => setDraft({ ...draft, title: e.target.value })} />}
            </Field>
            <Field label={tr("Texte sous le titre")} hint={resetBtn("subtitle")}>
              {(id) => <textarea id={id} dir={dir} rows={2} className={`${inputCls} h-auto py-2.5`} value={draft.subtitle} maxLength={240} onChange={(e) => setDraft({ ...draft, subtitle: e.target.value })} />}
            </Field>
          </div>
        </section>

        <section>
          <div className="mb-3 flex items-center justify-between gap-2">
            <h3 className="text-sm font-semibold uppercase tracking-[0.1em] text-ink-soft">{tr("📣 Messages du bandeau")}</h3>
            {resetBtn("announcement")}
          </div>
          <ul className="space-y-2">
            {draft.announcement.map((m, i) => (
              <li key={i} className="flex gap-2">
                <input
                  dir={dir}
                  className={inputCls}
                  value={m}
                  maxLength={120}
                  aria-label={tr("Message {0}", { 0: i + 1 })}
                  onChange={(e) => setDraft({ ...draft, announcement: draft.announcement.map((x, k) => (k === i ? e.target.value : x)) })}
                />
                <button
                  type="button"
                  aria-label={tr("Supprimer ce message")}
                  disabled={draft.announcement.length <= 1}
                  onClick={() => setDraft({ ...draft, announcement: draft.announcement.filter((_, k) => k !== i) })}
                  className="grid size-10 shrink-0 place-items-center rounded-lg border border-line bg-surface text-ink-soft hover:border-red-200 hover:text-red-700 disabled:opacity-30"
                >
                  {tr("×")}
                </button>
              </li>
            ))}
          </ul>
          {draft.announcement.length < 8 && (
            <Button size="sm" className="mt-2" onClick={() => setDraft({ ...draft, announcement: [...draft.announcement, ""] })}>
              {tr("+ Ajouter un message")}
            </Button>
          )}
        </section>

        <section>
          <div className="mb-3 flex items-center justify-between gap-2">
            <h3 className="text-sm font-semibold uppercase tracking-[0.1em] text-ink-soft">{tr("❓ Questions fréquentes")}</h3>
            {resetBtn("faq")}
          </div>
          <ol className="space-y-3">
            {draft.faq.map((f, i) => (
              <li key={i} className="rounded-xl border border-line/70 bg-ivory/40 p-3">
                <div className="mb-2 flex items-center justify-between">
                  <span className="text-xs font-semibold text-ink-soft">{tr("Question")} {i + 1}</span>
                  <span className="flex gap-1">
                    <button type="button" onClick={() => moveFaq(i, -1)} disabled={i === 0} aria-label={tr("Monter")} className="grid size-8 place-items-center rounded-lg hover:bg-rose-100 disabled:opacity-30">
                      ↑
                    </button>
                    <button type="button" onClick={() => moveFaq(i, 1)} disabled={i === draft.faq.length - 1} aria-label={tr("Descendre")} className="grid size-8 place-items-center rounded-lg hover:bg-rose-100 disabled:opacity-30">
                      ↓
                    </button>
                    <button
                      type="button"
                      onClick={() => setDraft({ ...draft, faq: draft.faq.filter((_, k) => k !== i) })}
                      disabled={draft.faq.length <= 1}
                      aria-label={tr("Supprimer la question")}
                      className="grid size-8 place-items-center rounded-lg text-red-700 hover:bg-red-50 disabled:opacity-30"
                    >
                      {tr("×")}
                    </button>
                  </span>
                </div>
                <input
                  dir={dir}
                  className={`${inputCls} font-medium`}
                  placeholder={tr("Question")}
                  value={f.q}
                  maxLength={200}
                  onChange={(e) => setDraft({ ...draft, faq: draft.faq.map((x, k) => (k === i ? { ...x, q: e.target.value } : x)) })}
                />
                <textarea
                  dir={dir}
                  rows={2}
                  className={`${inputCls} mt-2 h-auto py-2.5`}
                  placeholder={tr("Réponse")}
                  value={f.a}
                  maxLength={1000}
                  onChange={(e) => setDraft({ ...draft, faq: draft.faq.map((x, k) => (k === i ? { ...x, a: e.target.value } : x)) })}
                />
              </li>
            ))}
          </ol>
          {draft.faq.length < 20 && (
            <Button size="sm" className="mt-2" onClick={() => setDraft({ ...draft, faq: [...draft.faq, { q: "", a: "" }] })}>
              {tr("+ Ajouter une question")}
            </Button>
          )}
        </section>

        <section>
          <h3 className="mb-3 text-sm font-semibold uppercase tracking-[0.1em] text-ink-soft">{tr("🌙 Message quand les commandes sont en pause")}</h3>
          <Field label={tr("Message affiché aux clientes")} hint={resetBtn("pause")}>
            {(id) => <input id={id} dir={dir} className={inputCls} value={draft.pause} maxLength={240} onChange={(e) => setDraft({ ...draft, pause: e.target.value })} />}
          </Field>
        </section>
      </div>

      <div className="sticky bottom-[calc(4.5rem+env(safe-area-inset-bottom))] mt-5 flex flex-wrap items-center justify-end gap-2 rounded-xl border border-line/70 bg-surface/95 p-3 shadow-sm backdrop-blur md:bottom-3">
        {changed && <span className="me-auto text-sm text-amber-700">{tr("Modifications non enregistrées")}</span>}
        <Button disabled={!changed} onClick={() => setDraft(resolveStoreTexts(lang, saved[lang]))}>
          {tr("Annuler")}
        </Button>
        <Button variant="primary" disabled={!changed} loading={save.isPending} onClick={() => save.mutate({ locale: lang, texts: overridesOf(draft) })}>
          {tr("Enregistrer les textes")} {rtl ? tr("arabes") : tr("français")}
        </Button>
      </div>
    </Card>
  );
}

/* ───────────── Avis ───────────── */

interface Review {
  id: number;
  product_id: number;
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
  /** customer photos */
  photo_urls?: string[];
}

export function ReviewsPage() {
  // ?status= from the search bar (a review waiting for approval opens on "À valider")
  const linked = (useSearch({ strict: false }) as { status?: string }).status;
  const [status, setStatus] = useState(linked && ["approved", "pending", "rejected", "all"].includes(linked) ? linked : "approved");
  useEffect(() => {
    if (linked && ["approved", "pending", "rejected", "all"].includes(linked)) setStatus(linked);
  }, [linked]);
  const settings = useQuery({ queryKey: ["reviews-settings"], queryFn: () => api<{ auto_approve_verified: boolean }>("/reviews/settings") });
  const saveSettings = useSave((v: { auto_approve_verified: boolean }) => put("/reviews/settings", v), ["reviews-settings"]);
  const q = useQuery({ queryKey: ["reviews", status], queryFn: () => api<{ rows: Review[]; counts: { status: string; n: number; avg: number }[] }>(`/reviews?status=${status}`) });
  const count = (s: string) => q.data?.counts.find((c) => c.status === s)?.n ?? 0;
  const approved = q.data?.counts.find((c) => c.status === "approved");
  const [editing, setEditing] = useState<Partial<Review> | null>(null);
  return (
    <div>
      <PageHeader
        group={tr("Marketing")}
        title={tr("Avis")}
        subtitle={approved ? tr("Note moyenne publiée : {0} / 5 ({1} avis)", { 0: approved.avg.toFixed(1), 1: approved.n }) : undefined}
        actions={<Button variant="primary" onClick={() => setEditing({})}>{tr("+ Ajouter un avis")}</Button>}
      />
      <Card className="mb-4">
        <p className="mb-2 text-sm text-ink-soft">
          {tr("Seules les clientes dont la commande est")} <b>{tr("livrée")}</b> {tr("peuvent laisser un avis (depuis leur lien de suivi, ou avec n° de commande + téléphone). Un avis par produit et par commande, affiché avec le prénom et l'initiale du nom.")}
        </p>
        {settings.data && (
          <Toggle
            label={tr("Publier automatiquement les avis vérifiés")}
            hint={tr("Sinon, ils attendent votre validation dans « À valider ». Vous pouvez toujours masquer ou supprimer un avis.")}
            checked={settings.data.auto_approve_verified}
            onChange={(v) => saveSettings.mutate({ auto_approve_verified: v })}
          />
        )}
      </Card>
      <Pills value={status} onChange={setStatus} options={[{ value: "approved", label: tr("Publiés ({0})", { 0: count("approved") }) }, { value: "pending", label: tr("À valider ({0})", { 0: count("pending") }) }, { value: "rejected", label: tr("Masqués") }, { value: "all", label: tr("Tous") }]} />
      {q.error ? <ErrorState error={q.error} onRetry={q.refetch} /> : !q.data ? <ListSkeleton /> : q.data.rows.length === 0 ? <Empty title={tr("Aucun avis ici")} icon="⭐" /> : (
        <ul className="space-y-2">{q.data.rows.map((r) => <ReviewItem key={r.id} r={r} onEdit={() => setEditing(r)} />)}</ul>
      )}
      {editing && <ReviewSheet review={editing} onClose={() => setEditing(null)} />}
    </div>
  );
}

/** Add a review received elsewhere, or fix one the team added (customers' verified reviews stay as written). */
function ReviewSheet({ review, onClose }: { review: Partial<Review>; onClose: () => void }) {
  const products = useQuery({ queryKey: ["products-lite"], queryFn: () => api<{ id: number; name_fr: string }[]>("/products?status=all") });
  const [f, setF] = useState({
    productId: review.product_id ?? null,
    name: review.name ?? "",
    rating: review.rating ?? 5,
    text: review.text ?? "",
    date: new Date(review.created_at ?? Date.now()).toISOString().slice(0, 10),
  });
  const payload = () => ({
    productId: f.productId!, name: f.name.trim(), rating: f.rating, text: f.text.trim() || null,
    ...(review.id ? {} : { createdAt: Math.min(Date.now(), new Date(`${f.date}T12:00:00+01:00`).getTime()) }),
  });
  const save = useSave(() => (review.id ? patch(`/reviews/${review.id}`, payload()) : post("/reviews", payload())), ["reviews"], review.id ? tr("Avis modifié ✓") : tr("Avis ajouté ✓"));
  return (
    <Sheet
      open
      onClose={onClose}
      title={review.id ? tr("Modifier l'avis") : tr("Ajouter un avis")}
      footer={
        <Button variant="primary" className="w-full" loading={save.isPending} disabled={!f.productId || f.name.trim().length < 2} onClick={() => save.mutate(undefined, { onSuccess: onClose })}>
          {tr("Enregistrer")}
        </Button>
      }
    >
      <div className="space-y-3">
        <p className="rounded-lg bg-rose-100/60 p-3 text-sm text-plum-700">
          {tr("Pour un avis reçu ailleurs (Instagram, WhatsApp, en boutique). Il s'affiche sans le badge « Achat vérifié », réservé aux clientes livrées.")}
        </p>
        <Select label={tr("Produit")} value={f.productId ?? ""} onChange={(e) => setF({ ...f, productId: e.target.value ? Number(e.target.value) : null })}>
          <option value="">{tr("Choisir un article…")}</option>
          {(products.data ?? []).map((p) => (
            <option key={p.id} value={p.id}>
              {p.name_fr}
            </option>
          ))}
        </Select>
        <TextField label={tr("Prénom de la cliente (ex : Amira B.)")} value={f.name} maxLength={60} onChange={(e) => setF({ ...f, name: e.target.value })} />
        <div>
          <p className="mb-1.5 text-sm font-medium">{tr("Note")}</p>
          <div className="flex gap-1" dir="ltr">
            {[1, 2, 3, 4, 5].map((n) => (
              <button
                key={n}
                type="button"
                aria-label={`${n}/5`}
                onClick={() => setF({ ...f, rating: n })}
                className={`grid size-11 place-items-center rounded-xl border text-2xl transition ${n <= f.rating ? "border-gold/40 bg-amber-50 text-gold" : "border-line text-line"}`}
              >
                ★
              </button>
            ))}
          </div>
        </div>
        <TextArea label={tr("Avis")} rows={4} value={f.text} maxLength={1000} onChange={(e) => setF({ ...f, text: e.target.value })} />
        {!review.id && <TextField label={tr("Date de l'avis")} type="date" value={f.date} max={new Date().toISOString().slice(0, 10)} onChange={(e) => setF({ ...f, date: e.target.value })} />}
      </div>
    </Sheet>
  );
}

function ReviewItem({ r, onEdit }: { r: Review; onEdit: () => void }) {
  const [reply, setReply] = useState(r.reply ?? "");
  const save = useSave((body: Record<string, unknown>) => patch(`/reviews/${r.id}`, body), ["reviews"]);
  const remove = useSave(() => del(`/reviews/${r.id}`), ["reviews"], tr("Avis supprimé"));
  return (
    <li className="rounded-xl border border-line bg-surface p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="font-semibold">{r.name} <span className="text-gold">{"★".repeat(r.rating)}<span className="text-line">{"★".repeat(5 - r.rating)}</span></span></span>
        <span className="text-xs text-ink-soft">{r.product} · {ago(r.created_at)}</span>
      </div>
      {r.text && <p className="mt-1 text-sm">{r.text}</p>}
      {(r.photo_urls ?? []).length > 0 && (
        <div className="mt-2 flex gap-2">
          {r.photo_urls!.map((src) => (
            <a key={src} href={src} target="_blank" rel="noreferrer" className="overflow-hidden rounded-lg ring-1 ring-line">
              <img src={src} alt={tr("Photo de la cliente")} className="size-20 object-cover" />
            </a>
          ))}
        </div>
      )}
      <div className="mt-2 flex flex-wrap gap-1.5">
        {r.verified ? <Badge tone="bg-emerald-100 text-emerald-800">{tr("Achat vérifié")}</Badge> : <Badge tone="bg-stone-100 text-stone-700">{tr("Ajouté par l'équipe")}</Badge>}
        {r.is_featured ? <Badge>{tr("⭐ Mis en avant")}</Badge> : null}
      </div>
      <div className="mt-3 flex gap-2">
        <input className={`${inputCls} h-10`} placeholder={tr("Répondre publiquement (facultatif)…")} value={reply} onChange={(e) => setReply(e.target.value)} />
        <Button size="sm" className="h-10" onClick={() => save.mutate({ reply: reply || null })}>{tr("Répondre")}</Button>
      </div>
      <div className="mt-3 flex flex-wrap gap-2">
        {r.status !== "approved" && <Button size="sm" variant="primary" onClick={() => save.mutate({ status: "approved" })}>{tr("✓ Publier")}</Button>}
        {r.status !== "rejected" && <Button size="sm" onClick={() => save.mutate({ status: "rejected" })}>{tr("Masquer")}</Button>}
        <Button size="sm" variant="ghost" onClick={() => save.mutate({ isFeatured: !r.is_featured })}>{r.is_featured ? tr("Ne plus mettre en avant") : tr("Mettre en avant")}</Button>
        {!r.verified && <Button size="sm" onClick={onEdit}>✏️ {tr("Modifier")}</Button>}
        <Button size="sm" variant="danger" onClick={() => confirm(tr("Supprimer définitivement cet avis ?")) && remove.mutate(undefined)}>{tr("Supprimer")}</Button>
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
    queryFn: () =>
      api<{
        notifications: Notifications;
        waitlists: { variant_id: number; name_fr: string; options: string; sku: string; available: number; waiting: number; push_waiting: number | null; phones: string | null; last_at: number }[];
        newsSubscribers: number;
        campaigns: { id: number; title: string; status: string; stats: { total?: number; sent?: number; failed?: number }; created_at: number }[];
      }>("/notifier"),
    refetchInterval: (query) => (query.state.data?.campaigns.some((x) => x.status === "sending") ? 15_000 : false),
  });
  const [n, setN] = useState<Notifications | null>(null);
  useEffect(() => {
    if (q.data) setN(q.data.notifications);
  }, [q.data]);
  const save = useSave((v: Notifications) => put("/notifier/settings", v), ["notifier"]);
  const notified = useSave((variantId: number) => post(`/notifier/waitlist/${variantId}/notified`), ["notifier"], tr("Marquées comme prévenues"));
  if (q.error) return <ErrorState error={q.error} onRetry={q.refetch} />;
  if (!q.data || !n) return <ListSkeleton />;
  const toggle = (k: keyof Notifications) => (v: boolean) => {
    const next = { ...n, [k]: v };
    setN(next);
    save.mutate(next);
  };
  return (
    <div className="space-y-4">
      <PageHeader group={tr("Marketing")} title={tr("Notifier")} subtitle={tr("Ce que l'équipe reçoit sur Telegram, et les clientes qui attendent un retour en stock.")} />
      <BroadcastCard subscribers={q.data.newsSubscribers} campaigns={q.data.campaigns} />
      <Card title={tr("📱 Notifications Telegram de l'équipe")}>
        <Toggle label={tr("Nouvelle commande")} hint={tr("Avec boutons Confirmer / Injoignable / Annuler")} checked={n.telegram_new_order} onChange={toggle("telegram_new_order")} />
        <Toggle label={tr("Mise à jour du message quand le statut change")} checked={n.telegram_status_change} onChange={toggle("telegram_status_change")} />
        <Toggle label={tr("Alerte stock bas")} checked={n.telegram_low_stock} onChange={toggle("telegram_low_stock")} />
        <Toggle label={tr("Nouvel avis à valider")} checked={n.telegram_review} onChange={toggle("telegram_review")} />
        <Toggle label={tr("Nouveau message de contact")} checked={n.telegram_contact} onChange={toggle("telegram_contact")} />
        <div className="mt-2 border-t border-line pt-2">
          <Toggle
            label={tr("Tous les membres du groupe peuvent utiliser les boutons")}
            hint={tr("Sinon, seules les personnes dont l'ID Telegram est renseigné dans Équipe (et selon leur rôle).")}
            checked={n.trust_group_members}
            onChange={toggle("trust_group_members")}
          />
        </div>
      </Card>
      <Card title={tr("🔔 Clientes en attente d'un retour en stock")}>
        {q.data.waitlists.length === 0 ? (
          <p className="text-sm text-ink-soft">{tr("Personne pour l'instant. Sur une taille épuisée, la boutique propose « Prévenez-moi du retour ».")}</p>
        ) : (
          <ul className="space-y-3">
            {q.data.waitlists.map((w) => (
              <li key={w.variant_id} className="rounded-xl bg-ivory-deep p-3">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-sm font-semibold">{w.name_fr} · {w.options}</span>
                  <Badge tone={w.available > 0 ? "bg-emerald-100 text-emerald-800" : "bg-stone-200 text-stone-700"}>{w.available > 0 ? tr("De retour ({0})", { 0: w.available }) : tr("Toujours épuisé")}</Badge>
                </div>
                <p className="mt-1 text-xs text-ink-soft">
                  {w.waiting} {tr("cliente(s) · dernière demande")} {ago(w.last_at)}
                  {w.push_waiting ? tr(" · dont {0} par notification (envoyée automatiquement au retour du stock)", { 0: w.push_waiting }) : ""}
                </p>
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {(w.phones ?? "").split(", ").filter(Boolean).map((p) => (
                    <a key={p} href={waLink(p, `Bonjour 🌸 Bonne nouvelle : « ${w.name_fr} (${w.options}) » est de retour chez Henine Boutique ! ${location.origin}`)} target="_blank" rel="noreferrer" className="rounded-full bg-[#25D366] px-3 py-1 text-xs font-semibold text-white">
                      <bdi dir="ltr">{formatDzPhone(p)}</bdi>
                    </a>
                  ))}
                </div>
                <Button size="sm" className="mt-2" onClick={() => notified.mutate(w.variant_id)}>{tr("Marquer comme prévenues")}</Button>
              </li>
            ))}
          </ul>
        )}
      </Card>
      <Card title={tr("📲 Notifications sur le téléphone des clientes")}>
        <p className="text-sm text-ink-soft">
          {tr("Sur une taille épuisée, la cliente peut toucher « 🔔 Me prévenir sur ce téléphone » : dès que vous remettez du stock (fiche produit ou page Stock), elle reçoit une notification avec la photo, qui ouvre le produit. Rien à faire de votre côté. Fonctionne sur Android et ordinateur ; sur iPhone, seulement si la boutique est ajoutée à l'écran d'accueil.")}
        </p>
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
      <PageHeader group={tr("Marketing")} title={tr("Liens")} subtitle={tr("Page « lien en bio » Instagram et liens courts avec compteur de clics.")} />
      {q.error ? <ErrorState error={q.error} onRetry={q.refetch} /> : !q.data ? <ListSkeleton /> : (
        <>
          <Card title={tr("🌸 Page lien en bio")} actions={<Button size="sm" variant="primary" onClick={() => setEdit({ kind: "bio", is_active: 1, sort: bio.length })}>{tr("+ Lien")}</Button>}>
            <p className="mb-3 text-sm text-ink-soft">{tr("À mettre dans la bio Instagram :")} <a href="/liens" target="_blank" rel="noreferrer" className="font-mono font-semibold text-plum-600">{origin}/liens</a></p>
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
          <Card title={tr("🔗 Liens courts (suivi des clics)")} actions={<Button size="sm" variant="primary" onClick={() => setEdit({ kind: "short", is_active: 1 })}>{tr("+ Lien court")}</Button>}>
            {short.length === 0 ? <p className="text-sm text-ink-soft">{tr("Ex :")} {origin}/l/ete25 → une page, avec le nombre de clics.</p> : (
              <ul className="divide-y divide-line">
                {short.map((l) => (
                  <li key={l.id}>
                    <button type="button" onClick={() => setEdit(l)} className="flex w-full items-center justify-between gap-2 py-2.5 text-start">
                      <span className="min-w-0">
                        <span className="block truncate font-mono text-sm font-semibold text-plum-700">/l/{l.slug}</span>
                        <span className="block truncate text-xs text-ink-soft">→ {l.target}</span>
                      </span>
                      <Badge tone="bg-stone-100 text-stone-700">{l.clicks} {tr("clic(s)")}</Badge>
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
  const remove = useSave(() => del(`/links/${link.id}`), ["links"], tr("Lien supprimé"));
  return (
    <Sheet
      open
      onClose={onClose}
      title={link.id ? tr("Modifier le lien") : f.kind === "short" ? tr("Nouveau lien court") : tr("Nouveau lien")}
      footer={
        <div className="flex justify-between gap-2">
          {link.id ? <Button variant="danger" onClick={() => confirm(tr("Supprimer ce lien ?")) && remove.mutate(undefined, { onSuccess: onClose })}>{tr("Supprimer")}</Button> : <span />}
          <Button variant="primary" loading={save.isPending} onClick={() => save.mutate(undefined, { onSuccess: onClose })}>{tr("Enregistrer")}</Button>
        </div>
      }
    >
      <div className="grid gap-3">
        {f.kind === "short" && <TextField label={tr("Adresse courte")} hint={`${location.origin}/l/…`} value={f.slug ?? ""} onChange={(e) => setF({ ...f, slug: e.target.value.toLowerCase() })} placeholder={tr("ete25")} />}
        <TextField label={tr("Texte du bouton (FR)")} value={f.label_fr ?? ""} onChange={(e) => setF({ ...f, label_fr: e.target.value })} placeholder={tr("🛍️ Voir la boutique")} />
        <TextField label={tr("Texte du bouton (AR)")} dir="rtl" value={f.label_ar ?? ""} onChange={(e) => setF({ ...f, label_ar: e.target.value })} />
        <TextField label={tr("Destination")} hint="/page de la boutique ou https://…" value={f.target ?? ""} onChange={(e) => setF({ ...f, target: e.target.value })} placeholder="/c/robes ou https://wa.me/213…" />
        {f.kind === "bio" && <NumberField label={tr("Ordre")} value={f.sort ?? 0} onChange={(v) => setF({ ...f, sort: v ?? 0 })} />}
        <Toggle label={tr("Actif")} checked={!!f.is_active} onChange={(v) => setF({ ...f, is_active: v ? 1 : 0 })} />
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

export interface ContactSettings {
  phone: string | null; whatsapp: string | null; instagram: string | null; tiktok: string | null; facebook: string | null; maps: string | null;
  followers: string | null;
}

export function ContactPage() {
  const linked = (useSearch({ strict: false }) as { status?: string }).status;
  const [status, setStatus] = useState(linked && ["open", "done", "spam", "all"].includes(linked) ? linked : "open");
  useEffect(() => {
    if (linked && ["open", "done", "spam", "all"].includes(linked)) setStatus(linked);
  }, [linked]);
  const q = useQuery({ queryKey: ["contact", status], queryFn: () => api<{ rows: Message[]; contact: ContactSettings }>(`/contact?status=${status}`) });
  const setMsg = useSave(({ id, s }: { id: number; s: string }) => patch(`/contact/${id}`, { status: s }), ["contact", "dashboard"], tr("Message mis à jour"));
  return (
    <div className="space-y-4">
      <PageHeader group={tr("Marketing")} title={tr("Contact")} subtitle={tr("Messages reçus via la page Contact + coordonnées affichées sur la boutique.")} />
      <Pills value={status} onChange={setStatus} options={[{ value: "open", label: tr("À traiter") }, { value: "done", label: tr("Traités") }, { value: "spam", label: tr("Spam") }, { value: "all", label: tr("Tous") }]} />
      {q.error ? <ErrorState error={q.error} onRetry={q.refetch} /> : !q.data ? <ListSkeleton /> : (
        <>
          {q.data.rows.length === 0 ? <Empty title={tr("Aucun message")} icon="✉️" /> : (
            <ul className="space-y-2">
              {q.data.rows.map((m) => (
                <li key={m.id} className="rounded-xl border border-line bg-surface p-4">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className="font-semibold">{m.name}{m.subject ? ` · ${m.subject}` : ""}</span>
                    <span className="text-xs text-ink-soft">{ago(m.created_at)}</span>
                  </div>
                  <p className="mt-1 whitespace-pre-line text-sm">{m.message}</p>
                  <div className="mt-3 flex flex-wrap gap-2">
                    {m.phone && <a href={waLink(m.phone, `Bonjour ${m.name} 🌸 Ici Henine Boutique, suite à votre message : `)} target="_blank" rel="noreferrer" className="inline-flex h-9 items-center rounded-lg bg-[#25D366] px-3.5 text-sm font-semibold text-white">{tr("Répondre sur WhatsApp")}</a>}
                    {m.status !== "done" && <Button size="sm" variant="primary" onClick={() => setMsg.mutate({ id: m.id, s: "done" })}>{tr("✓ Traité")}</Button>}
                    {m.status !== "spam" && <Button size="sm" variant="ghost" onClick={() => setMsg.mutate({ id: m.id, s: "spam" })}>{tr("Spam")}</Button>}
                  </div>
                </li>
              ))}
            </ul>
          )}
          <p className="text-sm text-ink-soft">{tr("Téléphone, WhatsApp et réseaux affichés sur la boutique :")} <Link to="/parametres" search={{ tab: "contact" }} className="font-semibold text-plum-600">{tr("Paramètres → Contact")}</Link></p>
        </>
      )}
    </div>
  );
}

export function ContactSettingsCard({ contact }: { contact: ContactSettings }) {
  const [c, setC] = useState(contact);
  const save = useSave(() => put("/contact/settings", { contact: Object.fromEntries(Object.entries(c).map(([k, v]) => [k, v || null])) }), ["contact", "home"]);
  const field = (k: keyof ContactSettings, label: string, extra?: Record<string, unknown>) => (
    <TextField label={label} value={c[k] ?? ""} onChange={(e) => setC({ ...c, [k]: e.target.value })} {...extra} />
  );
  return (
    <Card title={tr("Coordonnées affichées sur la boutique")}>
      <div className="grid gap-3 sm:grid-cols-2">
        {field("phone", "Téléphone", { inputMode: "tel" })}
        {field("whatsapp", "WhatsApp", { inputMode: "tel" })}
        {field("instagram", "Instagram (https://…)")}
        {field("tiktok", "TikTok (https://…)")}
        {field("facebook", "Facebook (https://…)")}
        {field("maps", "Google Maps (https://…)")}
        {field("followers", tr("Abonnés Instagram (ex. +89K, vide = masqué)"), { maxLength: 12, hint: tr("Remplacé par le vrai nombre (mis à jour chaque jour) quand Instagram est connecté dans Paramètres → Connexions.") })}
      </div>
      <Button variant="primary" className="mt-3" loading={save.isPending} onClick={() => save.mutate(undefined)}>{tr("Enregistrer")}</Button>
    </Card>
  );
}

/* ───────────── Collections & drops ───────────── */

interface CollectionRow {
  id: number;
  slug: string;
  name_fr: string;
  name_ar: string;
  description_fr: string | null;
  description_ar: string | null;
  starts_at: number | null;
  ends_at: number | null;
  show_countdown: number;
  lock_products: number;
  is_active: number;
  product_ids: number[];
}

/** <input type="datetime-local"> in Algiers time (UTC+1, no DST). */
const toLocalInput = (ts: number | null) => (ts ? new Date(ts + 3600_000).toISOString().slice(0, 16) : "");
const fromLocalInput = (s: string) => (s ? new Date(`${s}:00+01:00`).getTime() : null);

function dropState(c: Pick<CollectionRow, "is_active" | "starts_at" | "ends_at">): [string, string] {
  const now = Date.now();
  if (!c.is_active) return [tr("Brouillon"), "bg-stone-200 text-stone-700"];
  if (c.ends_at && c.ends_at <= now) return [tr("Terminée"), "bg-stone-200 text-stone-500"];
  if (c.starts_at && c.starts_at > now) return [tr("Programmée"), "bg-sky-100 text-sky-800"];
  return ["En ligne", "bg-emerald-100 text-emerald-800"];
}

export function CollectionsPage() {
  const q = useQuery({ queryKey: ["collections"], queryFn: () => api<CollectionRow[]>("/collections") });
  const [edit, setEdit] = useState<Partial<CollectionRow> | null>(null);
  const origin = location.origin;
  return (
    <div>
      <PageHeader
        group={tr("Marketing")}
        title={tr("Collections & lancements")}
        subtitle={tr("Une page à partager sur Instagram, avec compte à rebours avant le lancement.")}
        actions={<Button variant="primary" onClick={() => setEdit({ is_active: 0, show_countdown: 1, lock_products: 1, product_ids: [] })}>{tr("+ Nouvelle collection")}</Button>}
      />
      <SubNav of="promos" />
      {q.error ? (
        <ErrorState error={q.error} onRetry={q.refetch} />
      ) : !q.data ? (
        <ListSkeleton />
      ) : q.data.length === 0 ? (
        <Empty title={tr("Aucune collection")} icon="✨">
          {tr("Exemple : « Collection Ramadan », lancement vendredi 20:00, avec compte à rebours. Les pièces restent cachées jusqu'au lancement si vous le souhaitez.")}
        </Empty>
      ) : (
        <ul className="space-y-2">
          {q.data.map((c) => {
            const [label, tone] = dropState(c);
            return (
              <li key={c.id}>
                <button type="button" onClick={() => setEdit(c)} className="w-full rounded-xl border border-line bg-surface p-4 text-start transition hover:border-plum-600/40">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="truncate font-semibold">{c.name_fr}</p>
                      <p className="truncate font-mono text-xs text-plum-600">{origin}/collection/{c.slug}</p>
                    </div>
                    <Badge tone={tone}>{label}</Badge>
                  </div>
                  <p className="mt-1 text-sm text-ink-soft">
                    {c.product_ids.length} {tr("produit(s)")}
                    {c.starts_at ? tr(" · lancement {0}", { 0: new Date(c.starts_at).toLocaleString("fr-FR", { timeZone: "Africa/Algiers", dateStyle: "medium", timeStyle: "short" }) }) : ""}
                    {c.lock_products ? tr(" · 🔒 cachées avant") : ""}
                  </p>
                </button>
              </li>
            );
          })}
        </ul>
      )}
      {edit && <CollectionSheet c={edit} onClose={() => setEdit(null)} />}
    </div>
  );
}

function CollectionSheet({ c, onClose }: { c: Partial<CollectionRow>; onClose: () => void }) {
  const [f, setF] = useState({
    slug: c.slug ?? "",
    nameFr: c.name_fr ?? "",
    nameAr: c.name_ar ?? "",
    descriptionFr: c.description_fr ?? "",
    descriptionAr: c.description_ar ?? "",
    startsAt: toLocalInput(c.starts_at ?? null),
    endsAt: toLocalInput(c.ends_at ?? null),
    showCountdown: c.show_countdown !== 0,
    lockProducts: !!c.lock_products,
    isActive: !!c.is_active,
    productIds: c.product_ids ?? [],
  });
  const [search, setSearch] = useState("");
  const products = useQuery({ queryKey: ["products", "all", ""], queryFn: () => api<{ id: number; name_fr: string; image: string | null; status: string }[]>("/products?status=all&q=") });
  const save = useSave(() => {
    const body = {
      slug: f.slug || undefined, nameFr: f.nameFr, nameAr: f.nameAr, descriptionFr: f.descriptionFr || null, descriptionAr: f.descriptionAr || null,
      startsAt: fromLocalInput(f.startsAt), endsAt: fromLocalInput(f.endsAt), showCountdown: f.showCountdown, lockProducts: f.lockProducts,
      isActive: f.isActive, productIds: f.productIds,
    };
    return c.id ? put(`/collections/${c.id}`, body) : post("/collections", body);
  }, ["collections"]);
  const remove = useSave(() => del(`/collections/${c.id}`), ["collections"], tr("Collection supprimée"));
  const byId = new Map((products.data ?? []).map((p) => [p.id, p]));
  const matches = (products.data ?? []).filter((p) => !f.productIds.includes(p.id) && p.name_fr.toLowerCase().includes(search.toLowerCase())).slice(0, 12);
  const move = (i: number, d: number) =>
    setF((x) => {
      const ids = [...x.productIds];
      const j = i + d;
      if (j < 0 || j >= ids.length) return x;
      [ids[i], ids[j]] = [ids[j]!, ids[i]!];
      return { ...x, productIds: ids };
    });

  return (
    <Sheet
      open
      onClose={onClose}
      wide
      title={c.id ? f.nameFr || tr("Collection") : tr("Nouvelle collection")}
      footer={
        <div className="flex flex-wrap gap-2">
          <Button variant="primary" loading={save.isPending} disabled={f.nameFr.trim().length < 2} onClick={() => save.mutate(undefined, { onSuccess: onClose })}>
            {tr("Enregistrer")}
          </Button>
          {c.id && (
            <Button variant="danger" onClick={() => confirm(tr("Supprimer cette collection ? (les produits ne sont pas supprimés)")) && remove.mutate(undefined, { onSuccess: onClose })}>
              {tr("Supprimer")}
            </Button>
          )}
        </div>
      }
    >
      <div className="space-y-4">
        <Card title={tr("Infos")}>
          <div className="grid gap-3 sm:grid-cols-2">
            <TextField label={tr("Nom (français)")} value={f.nameFr} onChange={(e) => setF({ ...f, nameFr: e.target.value })} maxLength={80} />
            <TextField label={tr("Nom (arabe)")} dir="rtl" value={f.nameAr} onChange={(e) => setF({ ...f, nameAr: e.target.value })} maxLength={80} />
            <TextArea label={tr("Texte (français)")} rows={2} value={f.descriptionFr} onChange={(e) => setF({ ...f, descriptionFr: e.target.value })} maxLength={1000} />
            <TextArea label={tr("Texte (arabe)")} dir="rtl" rows={2} value={f.descriptionAr} onChange={(e) => setF({ ...f, descriptionAr: e.target.value })} maxLength={1000} />
            <TextField label={tr("Adresse")} hint={`/collection/${f.slug || "…"}`} value={f.slug} placeholder={tr("ex : ramadan-2027")} onChange={(e) => setF({ ...f, slug: e.target.value })} className="sm:col-span-2" />
          </div>
        </Card>
        <Card title={tr("Lancement")}>
          <div className="grid gap-3 sm:grid-cols-2">
            <TextField label={tr("Début (heure d'Algérie)")} type="datetime-local" value={f.startsAt} onChange={(e) => setF({ ...f, startsAt: e.target.value })} hint={tr("vide = tout de suite")} />
            <TextField label={tr("Fin (facultatif)")} type="datetime-local" value={f.endsAt} onChange={(e) => setF({ ...f, endsAt: e.target.value })} />
          </div>
          <div className="mt-3 space-y-1">
            <Toggle label={tr("Afficher le compte à rebours")} checked={f.showCountdown} onChange={(v) => setF({ ...f, showCountdown: v })} />
            <Toggle
              label={tr("Cacher les pièces jusqu'au lancement")}
              hint={tr("Elles n'apparaissent nulle part (et ne peuvent pas être commandées) avant l'heure du début.")}
              checked={f.lockProducts}
              onChange={(v) => setF({ ...f, lockProducts: v })}
            />
            <Toggle label={tr("Publiée")} hint={tr("Visible sur la boutique (bannière d'accueil + page de la collection).")} checked={f.isActive} onChange={(v) => setF({ ...f, isActive: v })} />
          </div>
        </Card>
        <Card title={tr("Produits ({0})", { 0: f.productIds.length })}>
          {f.productIds.length > 0 && (
            <ul className="mb-3 divide-y divide-line">
              {f.productIds.map((id, i) => (
                <li key={id} className="flex items-center gap-2 py-2 text-sm">
                  {byId.get(id)?.image ? <img src={byId.get(id)!.image!} alt="" className="h-10 w-8 rounded object-cover" /> : <span className="grid h-10 w-8 place-items-center rounded bg-rose-100">👗</span>}
                  <span className="min-w-0 flex-1 truncate">{byId.get(id)?.name_fr ?? `#${id}`}</span>
                  <button type="button" onClick={() => move(i, -1)} className="grid size-8 place-items-center rounded-full hover:bg-rose-100" aria-label={tr("Monter")}>↑</button>
                  <button type="button" onClick={() => move(i, 1)} className="grid size-8 place-items-center rounded-full hover:bg-rose-100" aria-label={tr("Descendre")}>↓</button>
                  <button type="button" onClick={() => setF({ ...f, productIds: f.productIds.filter((x) => x !== id) })} className="grid size-8 place-items-center rounded-full text-red-700 hover:bg-red-50" aria-label={tr("Retirer")}>{tr("×")}</button>
                </li>
              ))}
            </ul>
          )}
          <input className={inputCls} placeholder={tr("Ajouter un produit : tapez son nom…")} value={search} onChange={(e) => setSearch(e.target.value)} />
          <ul className="mt-2 grid gap-1.5 sm:grid-cols-2">
            {matches.map((p) => (
              <li key={p.id}>
                <button type="button" onClick={() => setF({ ...f, productIds: [...f.productIds, p.id] })} className="flex w-full items-center gap-2 rounded-xl border border-dashed border-line px-2 py-1.5 text-start text-sm hover:border-plum-600">
                  {p.image ? <img src={p.image} alt="" className="h-9 w-7 rounded object-cover" /> : <span className="grid h-9 w-7 place-items-center rounded bg-rose-100 text-xs">👗</span>}
                  <span className="min-w-0 flex-1 truncate">+ {p.name_fr}</span>
                  {p.status !== "published" && <span className="text-xs text-ink-soft">{tr("brouillon")}</span>}
                </button>
              </li>
            ))}
          </ul>
          <p className="mt-2 text-xs text-ink-soft">{tr("Astuce : créez les pièces en « En ligne » et cochez « Cacher jusqu'au lancement » ; elles apparaîtront seules à l'heure dite.")}</p>
        </Card>
      </div>
    </Sheet>
  );
}

/* ───────────── Ventes flash ───────────── */

interface FlashSale {
  id: number;
  nameFr: string;
  nameAr: string;
  percent: number;
  productIds: number[];
  limit: number | null;
  startsAt: number;
  endsAt: number;
  isActive: boolean;
  units: number;
  sales: number;
}

function leftLabel(ms: number): string {
  const m = Math.max(0, Math.round(ms / 60_000));
  if (m < 60) return tr("{0} min", { 0: m });
  const h = Math.floor(m / 60);
  if (h < 48) return tr("{0} h {1} min", { 0: h, 1: m % 60 });
  return tr("{0} jours", { 0: Math.round(h / 24) });
}

function FlashSales() {
  const q = useQuery({ queryKey: ["flash-sales"], queryFn: () => api<FlashSale[]>("/flash-sales") });
  const [edit, setEdit] = useState<Partial<FlashSale> | null>(null);
  const now = Date.now();
  return (
    <Card
      title={tr("⚡ Ventes flash")}
      className="mb-4"
      actions={
        <Button size="sm" variant="primary" onClick={() => setEdit({ percent: 20, isActive: true, productIds: [], limit: null, startsAt: Date.now(), endsAt: Date.now() + 24 * 3600_000 })}>
          {tr("+ Vente flash")}
        </Button>
      }
    >
      <p className="mb-3 text-sm text-ink-soft">
        {tr("Une remise sur quelques produits pendant un temps limité : compte à rebours, ancien prix barré, % de remise et quantité limitée sur la boutique. Le prix revient tout seul à la fin.")}
      </p>
      {q.error ? <ErrorState error={q.error} onRetry={q.refetch} /> : !q.data ? <ListSkeleton rows={2} /> : q.data.length === 0 ? (
        <p className="text-sm text-ink-soft">{tr("Aucune vente flash pour l'instant.")}</p>
      ) : (
        <ul className="grid gap-2 md:grid-cols-2">
          {q.data.map((f) => {
            const live = f.isActive && f.startsAt <= now && f.endsAt > now;
            const soon = f.isActive && f.startsAt > now;
            return (
              <li key={f.id}>
                <button type="button" onClick={() => setEdit(f)} className="w-full rounded-xl border border-line bg-surface p-3.5 text-start hover:border-plum-600/40">
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-semibold">⚡ {f.nameFr} · -{f.percent} %</span>
                    <Badge tone={live ? "bg-emerald-100 text-emerald-800" : soon ? "bg-sky-100 text-sky-800" : "bg-stone-200 text-stone-600"}>
                      {live ? tr("En cours") : soon ? tr("À venir") : !f.isActive ? tr("Désactivée") : tr("Terminée")}
                    </Badge>
                  </div>
                  <p className="mt-1 text-xs text-ink-soft">
                    {live ? tr("Se termine dans {0}", { 0: leftLabel(f.endsAt - now) }) : soon ? tr("Commence dans {0}", { 0: leftLabel(f.startsAt - now) }) : new Date(f.endsAt).toLocaleDateString()}
                    {" · "}{tr("{0} produit(s)", { 0: f.productIds.length })}{f.limit ? tr(" · {0} pièces max par produit", { 0: f.limit }) : ""}
                  </p>
                  <p className="mt-1 text-xs">{tr("{0} pièce(s) vendue(s) · {1}", { 0: f.units, 1: da(f.sales) })}</p>
                </button>
              </li>
            );
          })}
        </ul>
      )}
      {edit && <FlashSheet sale={edit} onClose={() => setEdit(null)} />}
    </Card>
  );
}

function FlashSheet({ sale, onClose }: { sale: Partial<FlashSale>; onClose: () => void }) {
  const [f, setF] = useState(sale);
  const [start, setStart] = useState(toLocalInput(sale.startsAt ?? Date.now()));
  const [end, setEnd] = useState(toLocalInput(sale.endsAt ?? Date.now() + 86400_000));
  const toast = useToast();
  const save = useSave(
    () => {
      const body = {
        nameFr: (f.nameFr ?? "").trim(), nameAr: (f.nameAr ?? "").trim() || (f.nameFr ?? "").trim(), percent: f.percent ?? 0, productIds: f.productIds ?? [],
        limit: f.limit ?? null, startsAt: fromLocalInput(start) ?? 0, endsAt: fromLocalInput(end) ?? 0, isActive: f.isActive ?? true,
      };
      return sale.id ? put(`/flash-sales/${sale.id}`, body) : post("/flash-sales", body);
    },
    ["flash-sales", "products"],
  );
  const remove = useSave(() => del(`/flash-sales/${sale.id}`), ["flash-sales"], tr("Vente flash supprimée"));
  const valid = (f.nameFr ?? "").trim().length >= 2 && (f.percent ?? 0) >= 1 && (f.percent ?? 0) <= 90 && (f.productIds ?? []).length > 0 && (fromLocalInput(end) ?? 0) > (fromLocalInput(start) ?? 0);
  return (
    <Sheet
      open
      onClose={onClose}
      title={sale.id ? tr("Vente flash · {0}", { 0: sale.nameFr }) : tr("Nouvelle vente flash")}
      footer={
        <div className="flex justify-between gap-2">
          {sale.id ? <Button variant="danger" onClick={() => confirm(tr("Supprimer cette vente flash ?")) && remove.mutate(undefined, { onSuccess: onClose })}>{tr("Supprimer")}</Button> : <span />}
          <Button
            variant="primary"
            loading={save.isPending}
            onClick={() => (valid ? save.mutate(undefined, { onSuccess: onClose }) : toast(tr("Nom, remise (1 à 90 %), au moins un produit, et une fin après le début."), "error"))}
          >
            {tr("Enregistrer")}
          </Button>
        </div>
      }
    >
      <div className="grid gap-3 sm:grid-cols-2">
        <TextField label={tr("Nom (français)")} placeholder={tr("Vente flash du week-end")} value={f.nameFr ?? ""} onChange={(e) => setF({ ...f, nameFr: e.target.value })} maxLength={60} />
        <TextField label={tr("Nom (arabe)")} dir="rtl" placeholder="تخفيض نهاية الأسبوع" value={f.nameAr ?? ""} onChange={(e) => setF({ ...f, nameAr: e.target.value })} maxLength={60} />
        <NumberField label={tr("Remise")} suffix="%" value={f.percent ?? null} onChange={(v) => setF({ ...f, percent: v ?? 0 })} hint={tr("de 1 à 90 %")} />
        <NumberField label={tr("Quantité limitée (par produit)")} value={f.limit ?? null} onChange={(v) => setF({ ...f, limit: v })} hint={tr("vide = jusqu'à la fin, sans limite")} />
        <TextField label={tr("Début")} type="datetime-local" value={start} onChange={(e) => setStart(e.target.value)} />
        <TextField label={tr("Fin")} type="datetime-local" value={end} onChange={(e) => setEnd(e.target.value)} />
      </div>
      <div className="mt-4">
        <ProductPicker label={tr("Produits en vente flash")} value={f.productIds ?? []} onChange={(ids) => setF({ ...f, productIds: ids })} max={100} />
      </div>
      <div className="mt-3">
        <Toggle label={tr("Active")} checked={f.isActive ?? true} onChange={(v) => setF({ ...f, isActive: v })} />
      </div>
    </Sheet>
  );
}

/* ───────────── Notification to "Recevoir les nouveautés" subscribers ───────────── */

function BroadcastCard({ subscribers, campaigns }: { subscribers: number; campaigns: { id: number; title: string; status: string; stats: { total?: number; sent?: number; failed?: number }; created_at: number }[] }) {
  const [f, setF] = useState({ titleFr: "", titleAr: "", bodyFr: "", bodyAr: "", path: "/" });
  const send = useSave(() => post("/notifier/broadcast", f), ["notifier"], tr("Envoi lancé ✓"));
  const sending = campaigns.some((c) => c.status === "sending");
  const ready = f.titleFr.trim().length >= 2 && f.titleAr.trim().length >= 2 && f.bodyFr.trim().length >= 2 && f.bodyAr.trim().length >= 2 && f.path.startsWith("/");
  return (
    <Card title={tr("📣 Notification aux abonnées ({0})", { 0: subscribers })}>
      <p className="mb-3 text-sm text-ink-soft">
        {tr("Les clientes qui ont touché « Recevoir les nouveautés » sur la boutique reçoivent ce message sur leur téléphone, dans leur langue. Gratuit, sans e-mail. Envoi par lots de quelques dizaines toutes les 5 minutes.")}
      </p>
      {subscribers === 0 ? (
        <p className="text-sm">{tr("Personne n'est encore abonné. Le bloc « Recevoir les nouveautés » est sur la page d'accueil (Page d'accueil → Sections).")}</p>
      ) : (
        <>
          <div className="grid gap-3 sm:grid-cols-2">
            <TextField label={tr("Titre (français)")} placeholder={tr("Nouvelle collection 🌸")} value={f.titleFr} onChange={(e) => setF({ ...f, titleFr: e.target.value })} maxLength={60} />
            <TextField label={tr("Titre (arabe)")} dir="rtl" placeholder="تشكيلة جديدة 🌸" value={f.titleAr} onChange={(e) => setF({ ...f, titleAr: e.target.value })} maxLength={60} />
            <TextArea label={tr("Message (français)")} rows={2} value={f.bodyFr} onChange={(e) => setF({ ...f, bodyFr: e.target.value })} maxLength={160} />
            <TextArea label={tr("Message (arabe)")} rows={2} dir="rtl" value={f.bodyAr} onChange={(e) => setF({ ...f, bodyAr: e.target.value })} maxLength={160} />
            <TextField label={tr("Page ouverte au toucher")} dir="ltr" placeholder="/nouveautes" value={f.path} onChange={(e) => setF({ ...f, path: e.target.value.trim() })} hint={tr("/ = accueil, /c/robes, /produit/…, /collection/…")} />
          </div>
          <Button
            className="mt-3"
            variant="primary"
            disabled={!ready || sending}
            loading={send.isPending}
            onClick={() => confirm(tr("Envoyer à {0} abonnée(s) ?", { 0: subscribers })) && send.mutate(undefined, { onSuccess: () => setF({ titleFr: "", titleAr: "", bodyFr: "", bodyAr: "", path: "/" }) })}
          >
            {sending ? tr("Un envoi est en cours…") : tr("Envoyer la notification")}
          </Button>
        </>
      )}
      {campaigns.length > 0 && (
        <ul className="mt-4 divide-y divide-line border-t border-line text-sm">
          {campaigns.map((c) => (
            <li key={c.id} className="flex items-center justify-between gap-2 py-2">
              <span className="min-w-0 truncate">{c.title}</span>
              <span className="shrink-0 text-xs text-ink-soft">
                {c.status === "sending" ? tr("⏳ en cours") : tr("✓ envoyée")} · {tr("{0}/{1} reçue(s)", { 0: c.stats.sent ?? 0, 1: c.stats.total ?? 0 })} · {ago(c.created_at)}
              </span>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}
