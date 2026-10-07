/**
 * Finance: what the business really earns (Résultat), the cash the courier collects and pays
 * back (Encaissements), and the expenses (Dépenses). Every number comes from the API (one model
 * with the per-order profit); this page only shows it.
 */
import {
  EXPENSE_CATEGORIES,
  EXPENSE_CATEGORY_LABEL,
  PAYMENT_METHOD_LABEL,
  PAYMENT_METHODS,
  RECONCILIATION_LABEL,
  type ExpenseCategory,
  type PaymentMethod,
  type ReconciliationStatus,
} from "@henine/shared";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate, useSearch } from "@tanstack/react-router";
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { api, del, errorMessage, patch, post, put, upload } from "../api";
import { isAr, tr } from "../i18n";
import { da, daMinus, dateTime } from "../lib/format";
import { usePeriod } from "../lib/period";
import { ProfitSection } from "./Insights";
import { useCan, useMe } from "../Shell";
import { Badge, Button, Card, confirmAction, Empty, ErrorState, inputCls, ListSkeleton, NumberField, PageHeader, Pills, SearchBox, Select, Sheet, Stat, TextArea, TextField, Toggle, useToast } from "../ui";
import { SubNav } from "../lib/subnav";

/* ───────────── Types (as the API returns them) ───────────── */

interface Pnl {
  revenue: number; discounts: number; cogs: number; grossProfit: number; deliveryCosts: number; returnCosts: number; packaging: number;
  orderProfit: number; operatingExpenses: number; netProfit: number; netMargin: number | null; expensesByCategory: Record<ExpenseCategory, number>;
  delivered: number; returned: number; missingCost: number; estimatedFees: number;
}
interface CodTotals {
  orders: number; expected: number; collected: number; carrierFees: number; returnFees: number; netExpected: number; remitted: number; outstanding: number;
  discrepancies: number; byStatus: Record<ReconciliationStatus, number>;
}
interface Summary {
  pnl: Pnl;
  cod: CodTotals;
  outstandingAll: CodTotals;
  inTransit: { orders: number; amount: number };
}
interface CodRow {
  id: number; code: string; name: string; phone: string; outcome: "delivered" | "returned"; wilaya: string | null; wilayaAr: string | null; tracking: string | null;
  settledAt: number; expected: number; collected: number; carrierFee: number; returnFee: number; netExpected: number; remitted: number; outstanding: number;
  discrepancy: number; estimated: boolean; status: ReconciliationStatus; disputed: boolean; note: string | null; recorded: boolean;
}
interface Remittance {
  id: number; received_on: string; reference: string | null; amount: number; note: string | null; created_by: string; created_at: number;
  voided_at: number | null; voided_by: string | null; void_reason: string | null; orders: number;
}
interface Expense {
  id: number; spent_on: string; amount: number; category: ExpenseCategory; description: string; payment_method: PaymentMethod | null; reference: string | null;
  has_receipt: number; notes: string | null; created_by: string; created_at: number; updated_by: string | null; voided_at: number | null; void_reason: string | null;
}

const STATUS_TONE: Record<ReconciliationStatus, string> = {
  pending: "bg-amber-100 text-amber-900",
  partial: "bg-sky-100 text-sky-800",
  reconciled: "bg-emerald-100 text-emerald-800",
  disputed: "bg-red-100 text-red-800",
  overpaid: "bg-violet-100 text-violet-800",
};
const actorName = (a: string | null) => (a ? (a.split(":").slice(2).join(":") || a) : "—");
const dayLabel = (d: string) => new Date(`${d}T12:00:00+01:00`).toLocaleDateString(isAr ? "ar-DZ" : "fr-DZ", { day: "2-digit", month: "short", year: "numeric" });
const today = () => new Date(Date.now() + 3600_000).toISOString().slice(0, 10);

type Tab = "resultat" | "cod" | "depenses";

export function FinancePage() {
  const can = useCan();
  const navigate = useNavigate();
  const search = useSearch({ strict: false }) as { tab?: string };
  const tab: Tab = search.tab === "cod" || search.tab === "depenses" ? search.tab : "resultat";
  const tabs: { key: Tab; label: string }[] = [
    { key: "resultat", label: tr("📊 Résultat") },
    { key: "cod", label: tr("💵 Encaissements (COD)") },
    { key: "depenses", label: tr("🧾 Dépenses") },
  ];
  return (
    <div className="space-y-4">
      <PageHeader
        group={tr("Analyse")}
        title={tr("Finance")}
        subtitle={tr("Ce que la boutique gagne vraiment : l'argent que le livreur doit, ce qu'il a versé, les dépenses et le bénéfice net.")}
      />
      <SubNav of="analysis" />
      <div className="-mx-4 overflow-x-auto border-b border-line px-4 md:mx-0 md:px-0" role="tablist" aria-label={tr("Finance")}>
        <div className="flex w-max gap-1">
          {tabs.map((t) => (
            <button
              key={t.key}
              type="button"
              role="tab"
              aria-selected={tab === t.key}
              onClick={() => void navigate({ to: "/finance", search: { tab: t.key } as never })}
              className={`-mb-px border-b-2 px-3.5 py-2.5 text-sm font-semibold transition ${tab === t.key ? "border-plum-600 text-plum-700" : "border-transparent text-ink-soft hover:text-ink"}`}
            >
              {t.label}
            </button>
          ))}
        </div>
      </div>
      {tab === "resultat" ? <ResultTab /> : tab === "cod" ? <CodTab canEdit={can("finance.edit")} /> : <ExpensesTab canEdit={can("finance.edit")} />}
    </div>
  );
}

/* ───────────── Résultat ───────────── */

function Line({ label, value, strong, minus, hint }: { label: string; value: number; strong?: boolean; minus?: boolean; hint?: ReactNode }) {
  return (
    <div className={`flex items-baseline justify-between gap-3 py-2 ${strong ? "border-t border-line text-base font-semibold" : "text-sm"}`}>
      <dt className={strong ? "" : "text-ink-soft"}>
        {label}
        {hint && <span className="block text-xs font-normal text-ink-soft">{hint}</span>}
      </dt>
      <dd className={`shrink-0 tabular-nums ${strong && value < 0 ? "text-red-700" : ""}`}>{minus ? (value ? daMinus(value) : "—") : da(value)}</dd>
    </div>
  );
}

function ResultTab() {
  const { query, picker } = usePeriod();
  const navigate = useNavigate();
  const q = useQuery({ queryKey: ["finance-summary", query], queryFn: () => api<Summary>(`/finance/summary?${query}`), placeholderData: (p) => p });
  const d = q.data;
  if (q.error) return <ErrorState error={q.error} onRetry={q.refetch} />;
  const p = d?.pnl;
  const expenses = p ? (Object.entries(p.expensesByCategory) as [ExpenseCategory, number][]).filter(([, v]) => v > 0).sort((a, b) => b[1] - a[1]) : [];
  return (
    <div className="space-y-4">
      {picker}
      {!d || !p ? (
        <ListSkeleton rows={4} />
      ) : (
        <>
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
            <Stat label={tr("Bénéfice net")} value={da(p.netProfit)} tone={p.netProfit >= 0 ? "good" : "warn"} hint={p.netMargin != null ? tr("marge {0} %", { 0: Math.round(p.netMargin * 100) }) : undefined} />
            <Stat label={tr("Ventes livrées")} value={da(p.revenue)} hint={tr("{0} commande(s) livrée(s)", { 0: p.delivered })} />
            <Stat label={tr("Bénéfice des commandes")} value={da(p.orderProfit)} hint={tr("avant les dépenses")} />
            <Stat label={tr("Dépenses")} value={da(p.operatingExpenses)} />
          </div>

          <div className="grid gap-4 lg:grid-cols-[3fr_2fr]">
            <Card title={tr("Compte de résultat")}>
              <dl>
                <Line label={tr("Ventes livrées")} value={p.revenue} hint={tr("prix des articles des commandes livrées sur la période")} />
                <Line label={tr("Remises (codes, points, gestes)")} value={p.discounts} minus />
                <Line
                  label={tr("Coût des produits vendus")}
                  value={p.cogs}
                  minus
                  hint={p.missingCost ? <span className="text-amber-800">{tr("{0} commande(s) avec un article sans prix d'achat : bénéfice surestimé", { 0: p.missingCost })}</span> : undefined}
                />
                <Line label={tr("Marge brute")} value={p.grossProfit} strong />
                <Line label={tr("Livraison payée par la boutique")} value={p.deliveryCosts} minus hint={tr("livraison offerte ou moins chère que le tarif du livreur")} />
                <Line label={tr("Colis retournés (frais du livreur)")} value={p.returnCosts} minus hint={tr("{0} retour(s)", { 0: p.returned })} />
                <Line label={tr("Emballage")} value={p.packaging} minus />
                <Line label={tr("Bénéfice des commandes")} value={p.orderProfit} strong />
                {expenses.map(([k, v]) => (
                  <Line key={k} label={`${EXPENSE_CATEGORY_LABEL[k].emoji} ${tr(EXPENSE_CATEGORY_LABEL[k].fr)}`} value={v} minus />
                ))}
                {!expenses.length && <Line label={tr("Dépenses")} value={0} minus />}
                <Line label={tr("Bénéfice net")} value={p.netProfit} strong />
              </dl>
              <p className="mt-3 rounded-lg bg-ivory-deep p-3 text-xs leading-relaxed text-ink-soft">
                {tr("La livraison, les retours et l'emballage des commandes sont comptés automatiquement : dans les dépenses, n'enregistrez que les frais en plus (publicité, loyer, salaires…).")}
                {p.estimatedFees > 0 && <> {tr("{0} frais de livreur sont estimés d'après vos tarifs par wilaya : relevez les vrais montants dans Encaissements.", { 0: p.estimatedFees })}</>}
              </p>
            </Card>

            <Card title={tr("💵 Argent du livreur")}>
              <div className="grid grid-cols-2 gap-3">
                <Stat label={tr("Reste dû (toutes dates)")} value={da(d.outstandingAll.outstanding)} tone={d.outstandingAll.outstanding > 0 ? "warn" : "good"} hint={tr("{0} colis à rapprocher", { 0: d.outstandingAll.orders })} />
                <Stat label={tr("Chez le livreur")} value={da(d.inTransit.amount)} hint={tr("{0} colis en cours de livraison", { 0: d.inTransit.orders })} />
                <Stat label={tr("À recevoir (période)")} value={da(d.cod.netExpected)} hint={tr("encaissé moins les frais")} />
                <Stat label={tr("Déjà versé (période)")} value={da(d.cod.remitted)} tone="good" />
                <Stat label={tr("Frais de livraison")} value={da(d.cod.carrierFees)} />
                <Stat label={tr("Frais de retour")} value={da(d.cod.returnFees)} />
              </div>
              {(d.cod.discrepancies > 0 || d.cod.byStatus.disputed > 0) && (
                <p className="mt-3 rounded-lg bg-amber-50 p-3 text-sm text-amber-900">
                  ⚠️ {tr("{0} écart(s) entre le montant dû et le montant encaissé · {1} litige(s).", { 0: d.cod.discrepancies, 1: d.cod.byStatus.disputed })}
                </p>
              )}
              <Button className="mt-3" onClick={() => void navigate({ to: "/finance", search: { tab: "cod" } as never })}>
                {tr("Voir les encaissements →")}
              </Button>
            </Card>
          </div>
          <ProfitSection query={query} />
        </>
      )}
    </div>
  );
}

/* ───────────── Encaissements (COD) ───────────── */

const COD_FILTERS: { value: string; label: string }[] = [
  { value: "open", label: tr("À rapprocher") },
  { value: "pending", label: tr("En attente") },
  { value: "partial", label: tr("Partiellement versé") },
  { value: "disputed", label: tr("Litige") },
  { value: "overpaid", label: tr("Trop versé") },
  { value: "reconciled", label: tr("Rapproché") },
  { value: "all", label: tr("Tous") },
];

function CodTab({ canEdit }: { canEdit: boolean }) {
  const [status, setStatus] = useState("open");
  const [outcome, setOutcome] = useState("");
  const [q, setQ] = useState("");
  const [page, setPage] = useState(0);
  const [selected, setSelected] = useState<Map<number, CodRow>>(new Map());
  const [editing, setEditing] = useState<CodRow | null>(null);
  const [paying, setPaying] = useState(false);
  useEffect(() => setPage(0), [status, outcome, q]);
  const query = `status=${status === "all" ? "" : status}&outcome=${outcome}&q=${encodeURIComponent(q)}&page=${page}`;
  const list = useQuery({ queryKey: ["finance-cod", query], queryFn: () => api<{ totals: CodTotals; rows: CodRow[]; page: number; pages: number }>(`/finance/cod?${query}`), placeholderData: (p) => p });
  const toggle = (r: CodRow) =>
    setSelected((s) => {
      const n = new Map(s);
      if (n.has(r.id)) n.delete(r.id);
      else n.set(r.id, r);
      return n;
    });
  const t = list.data?.totals;
  return (
    <div className="space-y-4">
      {t && (
        <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
          <Stat label={tr("Colis")} value={t.orders} />
          <Stat label={tr("Encaissé par le livreur")} value={da(t.collected)} />
          <Stat label={tr("Frais (livraison + retours)")} value={da(t.carrierFees + t.returnFees)} />
          <Stat label={tr("Déjà versé")} value={da(t.remitted)} tone="good" />
          <Stat label={tr("Reste dû")} value={da(t.outstanding)} tone={t.outstanding > 0 ? "warn" : "good"} />
        </div>
      )}
      <Pills value={status} onChange={setStatus} options={COD_FILTERS} />
      <div className="grid gap-2 sm:grid-cols-[1fr_auto]">
        <SearchBox value={q} onChange={setQ} placeholder={tr("Code, nom, téléphone, n° de suivi…")} />
        <select className={`${inputCls} mb-4 h-11 sm:w-48`} value={outcome} onChange={(e) => setOutcome(e.target.value)} aria-label={tr("Résultat de la livraison")}>
          <option value="">{tr("Livrés et retours")}</option>
          <option value="delivered">{tr("Livrés")}</option>
          <option value="returned">{tr("Retournés")}</option>
        </select>
      </div>

      {list.error ? (
        <ErrorState error={list.error} onRetry={list.refetch} />
      ) : !list.data ? (
        <ListSkeleton />
      ) : !list.data.rows.length ? (
        <Empty icon="💵" title={tr("Rien à rapprocher ici")}>{tr("Les colis livrés ou retournés par le livreur apparaissent ici.")}</Empty>
      ) : (
        <ul className="space-y-2">
          {list.data.rows.map((r) => (
            <li key={r.id} className="flex items-start gap-3 rounded-xl border border-line bg-surface p-3">
              {canEdit && (
                <input
                  type="checkbox"
                  className="mt-1 size-5 shrink-0 accent-plum-600"
                  checked={selected.has(r.id)}
                  disabled={r.outstanding === 0 && !selected.has(r.id)}
                  onChange={() => toggle(r)}
                  aria-label={tr("Sélectionner {0}", { 0: r.code })}
                />
              )}
              <button type="button" className="min-w-0 flex-1 text-start" onClick={() => canEdit && setEditing(r)} disabled={!canEdit}>
                <span className="flex flex-wrap items-center gap-2">
                  <span className="font-mono text-xs">{r.code}</span>
                  <bdi className="font-medium">{r.name}</bdi>
                  <Badge tone={r.outcome === "delivered" ? "bg-emerald-50 text-emerald-800" : "bg-stone-200 text-stone-700"}>{r.outcome === "delivered" ? tr("Livré") : tr("Retourné")}</Badge>
                  <Badge tone={STATUS_TONE[r.status]}>{tr(RECONCILIATION_LABEL[r.status])}</Badge>
                  {r.estimated && <span className="text-xs text-ink-soft">{tr("frais estimés")}</span>}
                </span>
                <span className="mt-1 block text-xs text-ink-soft">
                  {(isAr ? r.wilayaAr : r.wilaya) ?? "—"} · {dateTime(r.settledAt)}
                  {r.tracking ? ` · ${r.tracking}` : ""}
                </span>
                <span className="mt-1.5 grid grid-cols-2 gap-x-4 gap-y-0.5 text-xs sm:grid-cols-4">
                  <span>{tr("Encaissé")} <b className="tabular-nums">{da(r.collected)}</b></span>
                  <span>{tr("Frais")} <b className="tabular-nums">{daMinus(r.carrierFee + r.returnFee)}</b></span>
                  <span>{tr("Versé")} <b className="tabular-nums">{da(r.remitted)}</b></span>
                  <span className={r.outstanding !== 0 ? "font-semibold text-amber-800" : "text-emerald-700"}>
                    {tr("Reste")} <b className="tabular-nums">{da(r.outstanding)}</b>
                  </span>
                </span>
                {r.discrepancy !== 0 && <span className="mt-1 block text-xs font-medium text-red-700">⚠️ {tr("Écart de {0} avec le montant de la commande", { 0: da(r.discrepancy) })}</span>}
                {r.note && <span className="mt-1 block text-xs text-ink-soft">📝 {r.note}</span>}
              </button>
            </li>
          ))}
        </ul>
      )}
      {list.data && list.data.pages > 1 && (
        <div className="flex items-center justify-center gap-3 text-sm">
          <Button disabled={page === 0} onClick={() => setPage((p) => p - 1)}>←</Button>
          <span>{tr("Page {0} sur {1}", { 0: page + 1, 1: list.data.pages })}</span>
          <Button disabled={page + 1 >= list.data.pages} onClick={() => setPage((p) => p + 1)}>→</Button>
        </div>
      )}

      {canEdit && selected.size > 0 && (
        <div className="sticky bottom-20 z-10 flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-line bg-surface p-3 shadow-xl md:bottom-4">
          <span className="text-sm">
            {tr("{0} colis sélectionné(s)", { 0: selected.size })} · <b className="tabular-nums">{da([...selected.values()].reduce((s, r) => s + r.outstanding, 0))}</b>
          </span>
          <span className="flex gap-2">
            <Button onClick={() => setSelected(new Map())}>{tr("Désélectionner")}</Button>
            <Button variant="primary" onClick={() => setPaying(true)}>{tr("💵 Enregistrer un versement")}</Button>
          </span>
        </div>
      )}

      <RemittancesCard canEdit={canEdit} />
      {editing && <StatementSheet row={editing} onClose={() => setEditing(null)} />}
      {paying && (
        <RemittanceSheet
          rows={[...selected.values()]}
          onClose={() => setPaying(false)}
          onDone={() => {
            setPaying(false);
            setSelected(new Map());
          }}
        />
      )}
    </div>
  );
}

/** What the courier's statement says about one parcel. */
function StatementSheet({ row, onClose }: { row: CodRow; onClose: () => void }) {
  const qc = useQueryClient();
  const toast = useToast();
  const delivered = row.outcome === "delivered";
  const [collected, setCollected] = useState<number | null>(row.recorded ? row.collected : null);
  const [fee, setFee] = useState<number | null>(row.estimated ? null : delivered ? row.carrierFee : row.returnFee);
  const [disputed, setDisputed] = useState(row.disputed);
  const [note, setNote] = useState(row.note ?? "");
  const save = useMutation({
    mutationFn: () =>
      put(`/finance/cod/${row.id}`, {
        collected: delivered ? collected : null,
        carrierFee: delivered ? fee : null,
        returnFee: delivered ? null : fee,
        disputed,
        note: note.trim() || undefined,
      }),
    onSuccess: () => {
      toast(tr("Relevé enregistré"));
      void qc.invalidateQueries({ queryKey: ["finance-cod"] });
      void qc.invalidateQueries({ queryKey: ["finance-summary"] });
      onClose();
    },
    onError: (e) => toast(errorMessage(e), "error"),
  });
  return (
    <Sheet
      open
      onClose={onClose}
      title={`${row.code} · ${row.name}`}
      footer={
        <Button variant="primary" loading={save.isPending} disabled={disputed && note.trim().length < 3} onClick={() => save.mutate()}>
          {tr("Enregistrer")}
        </Button>
      }
    >
      <p className="mb-4 text-sm text-ink-soft">{tr("Recopiez ce que dit le relevé du livreur. Laissez vide pour garder l'estimation.")}</p>
      <div className="space-y-3">
        {delivered && <NumberField label={tr("Montant encaissé par le livreur")} value={collected} onChange={setCollected} suffix="DA" hint={tr("Montant de la commande : {0}", { 0: da(row.expected) })} />}
        <NumberField
          label={delivered ? tr("Frais de livraison du livreur") : tr("Frais de retour du livreur")}
          value={fee}
          onChange={setFee}
          suffix="DA"
          hint={row.estimated ? tr("Estimation (tarif de la wilaya) : {0}", { 0: da(delivered ? row.carrierFee : row.returnFee) }) : undefined}
        />
        <Toggle checked={disputed} onChange={setDisputed} label={tr("Litige avec le livreur")} hint={tr("Montant contesté, colis perdu… La raison est obligatoire.")} />
        <TextArea label={tr("Note")} value={note} onChange={(e) => setNote(e.target.value)} rows={3} />
      </div>
    </Sheet>
  );
}

/** A payment from the courier, split over the selected parcels. */
function RemittanceSheet({ rows, onClose, onDone }: { rows: CodRow[]; onClose: () => void; onDone: () => void }) {
  const qc = useQueryClient();
  const toast = useToast();
  const [receivedOn, setReceivedOn] = useState(today());
  const [reference, setReference] = useState("");
  const [note, setNote] = useState("");
  const [amounts, setAmounts] = useState<Record<number, string>>(() => Object.fromEntries(rows.map((r) => [r.id, String(r.outstanding)])));
  const total = useMemo(() => rows.reduce((s, r) => s + (Number(amounts[r.id]) || 0), 0), [rows, amounts]);
  const save = useMutation({
    mutationFn: () =>
      post<{ id: number; amount: number }>("/finance/remittances", {
        receivedOn,
        reference: reference.trim() || undefined,
        note: note.trim() || undefined,
        allocations: rows.map((r) => ({ orderId: r.id, amount: Math.round(Number(amounts[r.id]) || 0) })).filter((a) => a.amount !== 0),
      }),
    onSuccess: (r) => {
      toast(tr("Versement de {0} enregistré", { 0: da(r.amount) }));
      for (const k of ["finance-cod", "finance-summary", "finance-remittances"]) void qc.invalidateQueries({ queryKey: [k] });
      onDone();
    },
    onError: (e) => toast(errorMessage(e), "error"),
  });
  return (
    <Sheet
      open
      onClose={onClose}
      wide
      title={tr("💵 Versement du livreur")}
      footer={
        <div className="flex w-full flex-wrap items-center justify-between gap-3">
          <span className="text-sm">
            {tr("Total")} <b className="tabular-nums text-base">{da(total)}</b>
          </span>
          <Button variant="primary" loading={save.isPending} disabled={!total && rows.every((r) => !Number(amounts[r.id]))} onClick={() => save.mutate()}>
            {tr("Enregistrer le versement")}
          </Button>
        </div>
      }
    >
      <div className="grid gap-3 sm:grid-cols-2">
        <TextField label={tr("Reçu le")} type="date" value={receivedOn} max={today()} onChange={(e) => setReceivedOn(e.target.value)} />
        <TextField label={tr("Référence (relevé, virement…)")} value={reference} onChange={(e) => setReference(e.target.value)} maxLength={80} />
      </div>
      <p className="mt-4 mb-2 text-sm font-semibold">{tr("Montant par colis")}</p>
      <p className="mb-2 text-xs text-ink-soft">{tr("Un retour se note en négatif : ses frais sont retenus sur le versement.")}</p>
      <ul className="divide-y divide-line rounded-xl border border-line">
        {rows.map((r) => (
          <li key={r.id} className="flex items-center justify-between gap-3 p-2.5 text-sm">
            <span className="min-w-0">
              <span className="font-mono text-xs">{r.code}</span> · <bdi>{r.name}</bdi>
              <span className="block text-xs text-ink-soft">{tr("reste {0}", { 0: da(r.outstanding) })}</span>
            </span>
            <input
              className={`${inputCls} w-32 text-end tabular-nums`}
              inputMode="numeric"
              value={amounts[r.id] ?? ""}
              onChange={(e) => setAmounts((a) => ({ ...a, [r.id]: e.target.value.replace(/[^\d-]/g, "") }))}
              aria-label={tr("Montant pour {0}", { 0: r.code })}
              dir="ltr"
            />
          </li>
        ))}
      </ul>
      <TextArea className="mt-3" label={tr("Note")} value={note} onChange={(e) => setNote(e.target.value)} rows={2} />
    </Sheet>
  );
}

function RemittancesCard({ canEdit }: { canEdit: boolean }) {
  const qc = useQueryClient();
  const toast = useToast();
  const q = useQuery({ queryKey: ["finance-remittances"], queryFn: () => api<Remittance[]>("/finance/remittances") });
  const voidIt = useMutation({
    mutationFn: ({ id, reason }: { id: number; reason: string }) => post(`/finance/remittances/${id}/void`, { reason }),
    onSuccess: () => {
      toast(tr("Versement annulé : ses colis sont de nouveau dus"));
      for (const k of ["finance-cod", "finance-summary", "finance-remittances"]) void qc.invalidateQueries({ queryKey: [k] });
    },
    onError: (e) => toast(errorMessage(e), "error"),
  });
  return (
    <Card title={tr("Versements du livreur")}>
      {q.error ? (
        <ErrorState error={q.error} onRetry={q.refetch} />
      ) : !q.data ? (
        <ListSkeleton rows={2} />
      ) : !q.data.length ? (
        <p className="text-sm text-ink-soft">{tr("Aucun versement enregistré. Sélectionnez des colis ci-dessus, puis « Enregistrer un versement ».")}</p>
      ) : (
        <ul className="divide-y divide-line">
          {q.data.map((r) => (
            <li key={r.id} className={`flex flex-wrap items-center justify-between gap-2 py-2.5 text-sm ${r.voided_at ? "opacity-55" : ""}`}>
              <span className="min-w-0">
                <b className="tabular-nums">{da(r.amount)}</b> · {dayLabel(r.received_on)}
                {r.reference ? ` · ${r.reference}` : ""}
                <span className="block text-xs text-ink-soft">
                  {tr("{0} colis · par {1}", { 0: r.orders, 1: actorName(r.created_by) })}
                  {r.voided_at ? ` · ${tr("annulé : {0}", { 0: r.void_reason ?? "" })}` : ""}
                </span>
              </span>
              {canEdit && !r.voided_at && (
                <Button
                  variant="danger"
                  onClick={() => {
                    const reason = window.prompt(tr("Pourquoi annuler ce versement ?"));
                    if (reason && reason.trim().length >= 3) voidIt.mutate({ id: r.id, reason: reason.trim() });
                  }}
                >
                  {tr("Annuler")}
                </Button>
              )}
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

/* ───────────── Dépenses ───────────── */

const monthStart = () => `${today().slice(0, 7)}-01`;

function ExpensesTab({ canEdit }: { canEdit: boolean }) {
  const qc = useQueryClient();
  const toast = useToast();
  const me = useMe();
  const [from, setFrom] = useState(monthStart());
  const [to, setTo] = useState(today());
  const [category, setCategory] = useState("");
  const [q, setQ] = useState("");
  const [voided, setVoided] = useState(false);
  const [page, setPage] = useState(0);
  const [editing, setEditing] = useState<Partial<Expense> | null>(null);
  useEffect(() => setPage(0), [from, to, category, q, voided]);
  const query = `from=${from}&to=${to}&category=${category}&q=${encodeURIComponent(q)}&voided=${voided ? 1 : 0}&page=${page}`;
  const list = useQuery({ queryKey: ["expenses", query], queryFn: () => api<{ rows: Expense[]; total: number; count: number; page: number; pages: number }>(`/expenses?${query}`), placeholderData: (p) => p });
  const refresh = () => {
    void qc.invalidateQueries({ queryKey: ["expenses"] });
    void qc.invalidateQueries({ queryKey: ["finance-summary"] });
  };
  const voidIt = useMutation({
    mutationFn: ({ id, reason }: { id: number; reason: string }) => post(`/expenses/${id}/void`, { reason }),
    onSuccess: () => {
      toast(tr("Dépense annulée"));
      refresh();
    },
    onError: (e) => toast(errorMessage(e), "error"),
  });
  const remove = useMutation({
    mutationFn: (id: number) => del(`/expenses/${id}`),
    onSuccess: () => {
      toast(tr("Dépense supprimée"));
      refresh();
    },
    onError: (e) => toast(errorMessage(e), "error"),
  });
  const owner = me.data?.role === "owner";
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end gap-3">
        <TextField label={tr("Du")} type="date" value={from} max={to} onChange={(e) => setFrom(e.target.value)} />
        <TextField label={tr("Au")} type="date" value={to} min={from} onChange={(e) => setTo(e.target.value)} />
        <Select label={tr("Catégorie")} value={category} onChange={(e) => setCategory(e.target.value)}>
          <option value="">{tr("Toutes")}</option>
          {EXPENSE_CATEGORIES.map((k) => (
            <option key={k} value={k}>
              {EXPENSE_CATEGORY_LABEL[k].emoji} {tr(EXPENSE_CATEGORY_LABEL[k].fr)}
            </option>
          ))}
        </Select>
        {canEdit && (
          <Button variant="primary" onClick={() => setEditing({ spent_on: today(), category: "advertising" })}>
            {tr("+ Nouvelle dépense")}
          </Button>
        )}
      </div>
      <div className="grid gap-2 sm:grid-cols-[1fr_auto]">
        <SearchBox value={q} onChange={setQ} placeholder={tr("Description, référence…")} />
        <label className="mb-4 flex items-center gap-2 text-sm">
          <input type="checkbox" className="size-4 accent-plum-600" checked={voided} onChange={(e) => setVoided(e.target.checked)} />
          {tr("Afficher les annulées")}
        </label>
      </div>
      {list.data && (
        <p className="text-sm">
          {tr("{0} dépense(s) · total", { 0: list.data.count })} <b className="tabular-nums">{da(list.data.total)}</b>
        </p>
      )}
      {list.error ? (
        <ErrorState error={list.error} onRetry={list.refetch} />
      ) : !list.data ? (
        <ListSkeleton />
      ) : !list.data.rows.length ? (
        <Empty icon="🧾" title={tr("Aucune dépense sur la période")}>{tr("Publicité, loyer, salaires, emballages… notez-les pour connaître le vrai bénéfice.")}</Empty>
      ) : (
        <ul className="space-y-2">
          {list.data.rows.map((e) => (
            <li key={e.id} className={`rounded-xl border border-line bg-surface p-3 ${e.voided_at ? "opacity-55" : ""}`}>
              <div className="flex flex-wrap items-start justify-between gap-2">
                <span className="min-w-0">
                  <span className="font-medium">
                    {EXPENSE_CATEGORY_LABEL[e.category]?.emoji} {e.description}
                  </span>
                  <span className="block text-xs text-ink-soft">
                    {dayLabel(e.spent_on)} · {tr(EXPENSE_CATEGORY_LABEL[e.category]?.fr ?? e.category)}
                    {e.payment_method ? ` · ${tr(PAYMENT_METHOD_LABEL[e.payment_method])}` : ""}
                    {e.reference ? ` · ${e.reference}` : ""} · {tr("par {0}", { 0: actorName(e.created_by) })}
                  </span>
                  {e.voided_at && <span className="block text-xs text-red-700">{tr("Annulée : {0}", { 0: e.void_reason ?? "" })}</span>}
                </span>
                <b className="shrink-0 tabular-nums">{da(e.amount)}</b>
              </div>
              <div className="mt-2 flex flex-wrap gap-2">
                {!!e.has_receipt && (
                  <a href={`/api/admin/expenses/${e.id}/receipt`} target="_blank" rel="noreferrer" className="text-sm font-semibold text-plum-700 hover:underline">
                    {tr("🧾 Voir le reçu")}
                  </a>
                )}
                {canEdit && !e.voided_at && (
                  <>
                    <Button onClick={() => setEditing(e)}>{tr("Modifier")}</Button>
                    <Button
                      variant="danger"
                      onClick={() => {
                        const reason = window.prompt(tr("Pourquoi annuler cette dépense ?"));
                        if (reason && reason.trim().length >= 3) voidIt.mutate({ id: e.id, reason: reason.trim() });
                      }}
                    >
                      {tr("Annuler")}
                    </Button>
                  </>
                )}
                {owner && (
                  <Button variant="danger" onClick={() => confirmAction(tr("Supprimer définitivement cette dépense ?")) && remove.mutate(e.id)}>
                    {tr("Supprimer")}
                  </Button>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
      {list.data && list.data.pages > 1 && (
        <div className="flex items-center justify-center gap-3 text-sm">
          <Button disabled={page === 0} onClick={() => setPage((p) => p - 1)}>←</Button>
          <span>{tr("Page {0} sur {1}", { 0: page + 1, 1: list.data.pages })}</span>
          <Button disabled={page + 1 >= list.data.pages} onClick={() => setPage((p) => p + 1)}>→</Button>
        </div>
      )}
      {editing && <ExpenseSheet expense={editing} onClose={() => setEditing(null)} onSaved={refresh} />}
    </div>
  );
}

/** A receipt photo, made small enough to upload (JPEG, longest side 1600 px). */
async function receiptJpeg(file: File): Promise<Blob> {
  const bmp = await createImageBitmap(file, { imageOrientation: "from-image" });
  const k = Math.min(1, 1600 / Math.max(bmp.width, bmp.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(bmp.width * k);
  canvas.height = Math.round(bmp.height * k);
  canvas.getContext("2d")!.drawImage(bmp, 0, 0, canvas.width, canvas.height);
  bmp.close();
  return new Promise((ok, ko) => canvas.toBlob((b) => (b ? ok(b) : ko(new Error("receipt"))), "image/jpeg", 0.85));
}

function ExpenseSheet({ expense, onClose, onSaved }: { expense: Partial<Expense>; onClose: () => void; onSaved: () => void }) {
  const toast = useToast();
  const [spentOn, setSpentOn] = useState(expense.spent_on ?? today());
  const [amount, setAmount] = useState<number | null>(expense.amount ?? null);
  const [category, setCategory] = useState<ExpenseCategory>(expense.category ?? "advertising");
  const [description, setDescription] = useState(expense.description ?? "");
  const [method, setMethod] = useState<PaymentMethod | "">(expense.payment_method ?? "");
  const [reference, setReference] = useState(expense.reference ?? "");
  const [notes, setNotes] = useState(expense.notes ?? "");
  const [receipt, setReceipt] = useState<File | null>(null);
  const save = useMutation({
    mutationFn: async () => {
      const data = {
        spentOn, amount: amount ?? 0, category, description: description.trim(), paymentMethod: method || null,
        reference: reference.trim() || undefined, notes: notes.trim() || undefined,
      };
      const id = expense.id ?? (await post<{ id: number }>("/expenses", data)).id;
      if (expense.id) await patch(`/expenses/${expense.id}`, data);
      if (receipt) {
        const form = new FormData();
        form.append("file", await receiptJpeg(receipt), "recu.jpg");
        await upload(`/expenses/${id}/receipt`, form);
      }
    },
    onSuccess: () => {
      toast(expense.id ? tr("Dépense modifiée") : tr("Dépense enregistrée"));
      onSaved();
      onClose();
    },
    onError: (e) => toast(errorMessage(e), "error"),
  });
  return (
    <Sheet
      open
      onClose={onClose}
      title={expense.id ? tr("Modifier la dépense") : tr("Nouvelle dépense")}
      footer={
        <Button variant="primary" loading={save.isPending} disabled={!amount || description.trim().length < 2} onClick={() => save.mutate()}>
          {tr("Enregistrer")}
        </Button>
      }
    >
      <div className="space-y-3">
        <div className="grid grid-cols-2 gap-3">
          <TextField label={tr("Date")} type="date" value={spentOn} max={today()} onChange={(e) => setSpentOn(e.target.value)} />
          <NumberField label={tr("Montant")} value={amount} onChange={setAmount} suffix="DA" min={1} />
        </div>
        <Select label={tr("Catégorie")} value={category} onChange={(e) => setCategory(e.target.value as ExpenseCategory)}>
          {EXPENSE_CATEGORIES.map((k) => (
            <option key={k} value={k}>
              {EXPENSE_CATEGORY_LABEL[k].emoji} {tr(EXPENSE_CATEGORY_LABEL[k].fr)}
            </option>
          ))}
        </Select>
        {(category === "delivery" || category === "returns" || category === "packaging") && (
          <p className="rounded-lg bg-amber-50 p-2.5 text-xs text-amber-900">
            {tr("Les frais de livraison, de retour et l'emballage des commandes sont déjà comptés automatiquement : n'ajoutez ici que les frais en plus, sinon ils seraient comptés deux fois.")}
          </p>
        )}
        <TextField label={tr("Description")} value={description} onChange={(e) => setDescription(e.target.value)} maxLength={200} placeholder={tr("Ex. : pub Instagram du 1er au 7")} />
        <div className="grid grid-cols-2 gap-3">
          <Select label={tr("Payé par")} value={method} onChange={(e) => setMethod(e.target.value as PaymentMethod | "")}>
            <option value="">—</option>
            {PAYMENT_METHODS.map((m) => (
              <option key={m} value={m}>
                {tr(PAYMENT_METHOD_LABEL[m])}
              </option>
            ))}
          </Select>
          <TextField label={tr("Référence / n° de reçu")} value={reference} onChange={(e) => setReference(e.target.value)} maxLength={80} />
        </div>
        <TextArea label={tr("Notes")} value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} />
        <label className="block text-sm font-medium">
          {tr("Photo du reçu (facultatif)")}
          <input type="file" accept="image/*" capture="environment" className="mt-1 block w-full text-sm" onChange={(e) => setReceipt(e.target.files?.[0] ?? null)} />
          <span className="mt-1 block text-xs text-ink-soft">{tr("Gardée en privé : visible seulement dans l'administration.")}</span>
        </label>
      </div>
    </Sheet>
  );
}

