import { formatDzPhone, resolveStoreTexts, STORE_TEXTS, type StoreTexts } from "@henine/shared";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { api, del, errorMessage, patch, post, put } from "../api";
import { ago, da, waLink } from "../lib/format";
import {
  Badge, Button, Card, Empty, ErrorState, Field, inputCls, ListSkeleton, NumberField, PageHeader, Pills, Select, Sheet, TextArea, TextField, Toggle, useToast,
} from "../ui";
import { tr } from "../i18n";

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
      <PageHeader group={tr("Commandes")} title={tr("Promos")} subtitle={tr("Codes promo, codes influenceuses et livraison offerte.")} actions={<Button variant="primary" onClick={() => setEdit({ type: "percent", value: 10, is_active: 1 })}>{tr("+ Nouveau code")}</Button>} />
      <FreeShipping current={q.data?.freeShippingOver ?? null} />
      <InfluencerReport />
      {q.error ? <ErrorState error={q.error} onRetry={q.refetch} /> : !q.data ? <ListSkeleton /> : q.data.coupons.length === 0 ? <Empty title={tr("Aucun code promo")} icon="🏷" /> : (
        <ul className="grid gap-2 md:grid-cols-2">
          {q.data.coupons.map((c) => {
            const expired = c.ends_at != null && c.ends_at < Date.now();
            return (
              <li key={c.id}>
                <button type="button" onClick={() => setEdit(c)} className="w-full rounded-xl border border-line bg-white p-4 text-start hover:border-plum-600/40">
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-mono text-lg font-bold text-plum-700">{c.code}</span>
                    <Badge tone={!c.is_active || expired ? "bg-stone-200 text-stone-600" : "bg-emerald-100 text-emerald-800"}>{!c.is_active ? tr("Désactivé") : expired ? tr("Expiré") : tr("Actif")}</Badge>
                  </div>
                  <p className="text-sm">{couponLabel(c)}{c.min_subtotal ? tr(" dès {0}", { 0: da(c.min_subtotal) }) : ""}{c.first_order_only ? tr(" · 1re commande") : ""}</p>
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

function FreeShipping({ current }: { current: number | null }) {
  const home = useQuery({ queryKey: ["home"], queryFn: () => api<{ checkout: { express_on_product: boolean; desk_enabled: boolean; free_shipping_over: number | null; max_orders_per_phone_per_hour: number } } & Record<string, unknown>>("/home") });
  const [value, setValue] = useState<number | null>(current);
  useEffect(() => {
    setValue(current);
  }, [current]);
  const save = useSave(
    async (v: number | null) => {
      const h = home.data!;
      await put("/home", { announcement: h.announcement, hero: h.hero, maintenance: h.maintenance, checkout: { ...h.checkout, free_shipping_over: v } });
    },
    ["coupons", "home"],
  );
  return (
    <Card title={tr("🚚 Livraison offerte automatique")} className="mb-4">
      <div className="flex flex-wrap items-end gap-2">
        <NumberField label={tr("Dès un panier de")} suffix={tr("DA")} value={value} onChange={setValue} hint={tr("vide = jamais")} className="w-48" />
        <Button onClick={() => save.mutate(value)} loading={save.isPending} disabled={!home.data}>{tr("Enregistrer")}</Button>
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
              className={`h-8 rounded-md px-3.5 text-sm font-semibold transition ${lang === code ? "bg-white text-plum-700 shadow-sm" : "text-ink-soft hover:text-ink"}`}
            >
              {label}
            </button>
          ))}
        </div>
      }
    >
      <p className="mb-5 rounded-lg bg-rose-100/60 p-3 text-sm text-plum-700">
        {tr("Vous modifiez les textes")} <b>{rtl ? tr("en arabe") : tr("en français")}</b> {tr("(page")} {rtl ? tr("arabe") : tr("française")} {tr("de la boutique). L'autre langue ne change pas : ce que vous ne modifiez pas garde son texte d'origine.")}
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
                  className="grid size-10 shrink-0 place-items-center rounded-lg border border-line bg-white text-ink-soft hover:border-red-200 hover:text-red-700 disabled:opacity-30"
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

      <div className="sticky bottom-[calc(4.5rem+env(safe-area-inset-bottom))] mt-5 flex flex-wrap items-center justify-end gap-2 rounded-xl border border-line/70 bg-white/95 p-3 shadow-sm backdrop-blur md:bottom-3">
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
  const [status, setStatus] = useState("approved");
  const settings = useQuery({ queryKey: ["reviews-settings"], queryFn: () => api<{ auto_approve_verified: boolean }>("/reviews/settings") });
  const saveSettings = useSave((v: { auto_approve_verified: boolean }) => put("/reviews/settings", v), ["reviews-settings"]);
  const q = useQuery({ queryKey: ["reviews", status], queryFn: () => api<{ rows: Review[]; counts: { status: string; n: number; avg: number }[] }>(`/reviews?status=${status}`) });
  const count = (s: string) => q.data?.counts.find((c) => c.status === s)?.n ?? 0;
  const approved = q.data?.counts.find((c) => c.status === "approved");
  return (
    <div>
      <PageHeader group={tr("Marketing")} title={tr("Avis")} subtitle={approved ? tr("Note moyenne publiée : {0} / 5 ({1} avis)", { 0: approved.avg.toFixed(1), 1: approved.n }) : undefined} />
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
        <ul className="space-y-2">{q.data.rows.map((r) => <ReviewItem key={r.id} r={r} />)}</ul>
      )}
    </div>
  );
}

function ReviewItem({ r }: { r: Review }) {
  const [reply, setReply] = useState(r.reply ?? "");
  const save = useSave((body: Record<string, unknown>) => patch(`/reviews/${r.id}`, body), ["reviews"]);
  const remove = useSave(() => del(`/reviews/${r.id}`), ["reviews"], tr("Avis supprimé"));
  return (
    <li className="rounded-xl border border-line bg-white p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="font-semibold">{r.name} <span className="text-gold">{"★".repeat(r.rating)}<span className="text-line">{"★".repeat(5 - r.rating)}</span></span></span>
        <span className="text-xs text-ink-soft">{r.product} · {ago(r.created_at)}</span>
      </div>
      {r.text && <p className="mt-1 text-sm">{r.text}</p>}
      <div className="mt-2 flex flex-wrap gap-1.5">
        {r.verified ? <Badge tone="bg-emerald-100 text-emerald-800">{tr("Achat vérifié")}</Badge> : null}
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
    queryFn: () => api<{ notifications: Notifications; waitlists: { variant_id: number; name_fr: string; options: string; sku: string; available: number; waiting: number; push_waiting: number | null; phones: string | null; last_at: number }[] }>("/notifier"),
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
                      {formatDzPhone(p)}
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
}

export function ContactPage() {
  const [status, setStatus] = useState("open");
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
                <li key={m.id} className="rounded-xl border border-line bg-white p-4">
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
                <button type="button" onClick={() => setEdit(c)} className="w-full rounded-xl border border-line bg-white p-4 text-start transition hover:border-plum-600/40">
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
            <TextField label="الاسم (عربي)" dir="rtl" value={f.nameAr} onChange={(e) => setF({ ...f, nameAr: e.target.value })} maxLength={80} />
            <TextArea label={tr("Texte (français)")} rows={2} value={f.descriptionFr} onChange={(e) => setF({ ...f, descriptionFr: e.target.value })} maxLength={1000} />
            <TextArea label="النص (عربي)" dir="rtl" rows={2} value={f.descriptionAr} onChange={(e) => setF({ ...f, descriptionAr: e.target.value })} maxLength={1000} />
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
