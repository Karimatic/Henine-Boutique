/**
 * Stock → Inventaire: count the shelves, compare with the system, have the corrections approved.
 * Nothing changes in the stock before the approval; the API then applies the differences
 * through the normal stock history (reason "inventaire").
 */
import { COUNT_REASON_LABEL, COUNT_REASONS, COUNT_STATUS_LABEL, type CountReason, type CountStatus } from "@henine/shared";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useNavigate, useParams } from "@tanstack/react-router";
import { useEffect, useMemo, useRef, useState } from "react";
import { api, errorMessage, post, put } from "../api";
import { isAr, tr } from "../i18n";
import { CategoryOptions, type CategoryLite } from "../lib/categories";
import { dateTime } from "../lib/format";
import { useCan } from "../Shell";
import { Badge, Button, Card, Empty, ErrorState, inputCls, ListSkeleton, PageHeader, Pills, SearchBox, Select, Sheet, Stat, TextArea, useToast } from "../ui";

interface CountSummaryRow {
  id: number; title: string; scope: string; status: CountStatus; created_by: string; created_at: number; submitted_at: number | null; decided_by: string | null;
  decided_at: number | null; lines: number; counted: number | null; discrepancies: number | null;
}
interface CountLine {
  variant_id: number; system_qty: number; counted_qty: number | null; difference: number | null; reason: CountReason | null; note: string | null;
  counted_by: string | null; applied_delta: number | null; sku: string; product_id: number; name_fr: string; name_ar: string; stock_on_hand: number; stock_reserved: number;
}
interface CountDetail {
  id: number; title: string; status: CountStatus; note: string | null; created_by: string; created_at: number; submitted_by: string | null; submitted_at: number | null;
  decided_by: string | null; decided_at: number | null; decision_note: string | null;
  summary: { lines: number; counted: number; discrepancies: number; missingPieces: number; foundPieces: number };
  lines: CountLine[];
}

const TONE: Record<CountStatus, string> = {
  counting: "bg-sky-100 text-sky-800",
  submitted: "bg-amber-100 text-amber-900",
  approved: "bg-emerald-100 text-emerald-800",
  rejected: "bg-red-100 text-red-800",
  cancelled: "bg-stone-200 text-stone-700",
};
const who = (a: string | null) => (a ? a.split(":").slice(2).join(":") || a : "—");

export function StockCountsPage() {
  const can = useCan();
  const navigate = useNavigate();
  const q = useQuery({ queryKey: ["stock-counts"], queryFn: () => api<CountSummaryRow[]>("/stock-counts") });
  const [starting, setStarting] = useState(false);
  return (
    <div className="space-y-4">
      <PageHeader
        group={tr("Catalogue")}
        title={tr("Inventaire physique")}
        subtitle={tr("Comptez les pièces en rayon : l'écart avec le système s'affiche, et le stock n'est corrigé qu'après validation.")}
        actions={
          <>
            <Link to="/stock" className="inline-flex h-9 items-center rounded-lg border border-line px-3.5 text-sm font-semibold">
              {tr("← Stock")}
            </Link>
            {can("stock.edit") && (
              <Button variant="primary" onClick={() => setStarting(true)}>
                {tr("+ Nouveau comptage")}
              </Button>
            )}
          </>
        }
      />
      {q.error ? (
        <ErrorState error={q.error} onRetry={q.refetch} />
      ) : !q.data ? (
        <ListSkeleton rows={3} />
      ) : !q.data.length ? (
        <Empty icon="📋" title={tr("Aucun inventaire pour l'instant")}>{tr("Lancez un comptage pour tout le stock, une catégorie ou un produit.")}</Empty>
      ) : (
        <ul className="space-y-2">
          {q.data.map((c) => (
            <li key={c.id}>
              <button
                type="button"
                onClick={() => void navigate({ to: "/stock/inventaire/$id", params: { id: String(c.id) } })}
                className="flex w-full flex-wrap items-center justify-between gap-2 rounded-xl border border-line bg-surface p-3 text-start hover:border-plum-600/40"
              >
                <span>
                  <span className="flex flex-wrap items-center gap-2">
                    <b>{c.title}</b>
                    <Badge tone={TONE[c.status]}>{tr(COUNT_STATUS_LABEL[c.status])}</Badge>
                  </span>
                  <span className="mt-0.5 block text-xs text-ink-soft">
                    #{c.id} · {dateTime(c.created_at)} · {tr("par {0}", { 0: who(c.created_by) })}
                  </span>
                </span>
                <span className="text-end text-sm">
                  {tr("{0}/{1} comptés", { 0: c.counted ?? 0, 1: c.lines })}
                  {(c.discrepancies ?? 0) > 0 && <span className="block text-xs font-semibold text-amber-800">{tr("{0} écart(s)", { 0: c.discrepancies })}</span>}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
      {starting && <StartCountSheet onClose={() => setStarting(false)} />}
    </div>
  );
}

function StartCountSheet({ onClose }: { onClose: () => void }) {
  const qc = useQueryClient();
  const toast = useToast();
  const navigate = useNavigate();
  const [scope, setScope] = useState<"all" | "category" | "product">("category");
  const [categoryId, setCategoryId] = useState("");
  const [productId, setProductId] = useState("");
  const cats = useQuery({ queryKey: ["categories"], queryFn: () => api<CategoryLite[]>("/categories") });
  const products = useQuery({ queryKey: ["products", "all", "", "", null], queryFn: () => api<{ id: number; name_fr: string; name_ar: string }[]>("/products?status=all&q=") });
  const start = useMutation({
    mutationFn: () =>
      post<{ id: number; lines: number }>(
        "/stock-counts",
        scope === "all" ? { scope } : scope === "category" ? { scope, categoryId: Number(categoryId) } : { scope, productId: Number(productId) },
      ),
    onSuccess: (r) => {
      toast(tr("Comptage lancé : {0} articles à compter", { 0: r.lines }));
      void qc.invalidateQueries({ queryKey: ["stock-counts"] });
      void navigate({ to: "/stock/inventaire/$id", params: { id: String(r.id) } });
    },
    onError: (e) => toast(errorMessage(e), "error"),
  });
  const ready = scope === "all" || (scope === "category" && categoryId) || (scope === "product" && productId);
  return (
    <Sheet
      open
      onClose={onClose}
      title={tr("Nouveau comptage")}
      footer={
        <Button variant="primary" disabled={!ready} loading={start.isPending} onClick={() => start.mutate()}>
          {tr("Commencer")}
        </Button>
      }
    >
      <div className="space-y-3">
        <Pills
          value={scope}
          onChange={setScope}
          options={[
            { value: "category", label: tr("Une catégorie") },
            { value: "product", label: tr("Un produit") },
            { value: "all", label: tr("Tout le stock") },
          ]}
        />
        {scope === "category" && (
          <Select label={tr("Catégorie")} value={categoryId} onChange={(e) => setCategoryId(e.target.value)}>
            <option value="">—</option>
            <CategoryOptions cats={cats.data ?? []} />
          </Select>
        )}
        {scope === "product" && (
          <Select label={tr("Produit")} value={productId} onChange={(e) => setProductId(e.target.value)}>
            <option value="">—</option>
            {(products.data ?? []).map((p) => (
              <option key={p.id} value={p.id}>
                {isAr ? p.name_ar || p.name_fr : p.name_fr}
              </option>
            ))}
          </Select>
        )}
        <p className="text-xs text-ink-soft">{tr("Les quantités du système sont notées maintenant. Les ventes faites pendant le comptage restent comptées : seul l'écart trouvé est corrigé.")}</p>
      </div>
    </Sheet>
  );
}

export function StockCountPage() {
  const { id } = useParams({ strict: false }) as { id: string };
  const qc = useQueryClient();
  const toast = useToast();
  const can = useCan();
  const q = useQuery({ queryKey: ["stock-count", id], queryFn: () => api<CountDetail>(`/stock-counts/${id}`) });
  const [filter, setFilter] = useState<"todo" | "diff" | "all">("all");
  const [search, setSearch] = useState("");
  // what the team typed, saved a moment later (several lines in one request)
  const [draft, setDraft] = useState<Record<number, { countedQty: number | null; reason: CountReason | null; note?: string }>>({});
  const pending = useRef<Record<number, { countedQty: number | null; reason: CountReason | null; note?: string }>>({});
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const save = useMutation({
    mutationFn: (lines: { variantId: number; countedQty: number | null; reason: CountReason | null; note?: string }[]) => put(`/stock-counts/${id}/lines`, { lines }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ["stock-count", id] }),
    onError: (e) => toast(errorMessage(e), "error"),
  });
  const flush = () => {
    const lines = Object.entries(pending.current).map(([v, l]) => ({ variantId: Number(v), ...l }));
    pending.current = {};
    if (lines.length) save.mutate(lines);
  };
  useEffect(() => () => clearTimeout(timer.current), []);
  const set = (l: CountLine, patch: Partial<{ countedQty: number | null; reason: CountReason | null; note: string }>) => {
    const cur = draft[l.variant_id] ?? { countedQty: l.counted_qty, reason: l.reason, note: l.note ?? undefined };
    const next = { ...cur, ...patch };
    setDraft((d) => ({ ...d, [l.variant_id]: next }));
    pending.current[l.variant_id] = next;
    clearTimeout(timer.current);
    timer.current = setTimeout(flush, 700);
  };
  const decide = useMutation({
    mutationFn: ({ action, note }: { action: "submit" | "approve" | "reject" | "reopen" | "cancel"; note?: string }) => post(`/stock-counts/${id}/${action}`, note ? { note } : {}),
    onSuccess: (_, v) => {
      const msg = { submit: tr("Envoyé pour validation"), approve: tr("Validé : le stock est corrigé"), reject: tr("Refusé : le stock ne change pas"), reopen: tr("Comptage rouvert"), cancel: tr("Comptage annulé") };
      toast(msg[v.action]);
      void qc.invalidateQueries({ queryKey: ["stock-count", id] });
      void qc.invalidateQueries({ queryKey: ["stock-counts"] });
      void qc.invalidateQueries({ queryKey: ["stock-products"] });
    },
    onError: (e) => toast(errorMessage(e), "error"),
  });
  const d = q.data;
  const lines = useMemo(() => {
    if (!d) return [];
    const s = search.trim().toLowerCase();
    return d.lines
      .map((l) => {
        const dr = draft[l.variant_id];
        const counted = dr ? dr.countedQty : l.counted_qty;
        return { ...l, counted_qty: counted, reason: dr ? dr.reason : l.reason, difference: counted == null ? null : counted - l.system_qty };
      })
      .filter((l) => (filter === "todo" ? l.counted_qty == null : filter === "diff" ? l.difference != null && l.difference !== 0 : true))
      .filter((l) => !s || `${l.name_fr} ${l.name_ar} ${l.sku}`.toLowerCase().includes(s));
  }, [d, draft, filter, search]);
  if (q.error) return <ErrorState error={q.error} onRetry={q.refetch} />;
  if (!d) return <ListSkeleton rows={6} />;
  const editing = d.status === "counting" && can("stock.edit");
  const missingReason = d.lines.some((l) => {
    const dr = draft[l.variant_id];
    const counted = dr ? dr.countedQty : l.counted_qty;
    const reason = dr ? dr.reason : l.reason;
    return counted != null && counted !== l.system_qty && !reason;
  });
  return (
    <div className="space-y-4 pb-24">
      <PageHeader
        group={tr("Inventaire physique")}
        title={d.title}
        subtitle={
          <span className="flex flex-wrap items-center gap-2">
            <Badge tone={TONE[d.status]}>{tr(COUNT_STATUS_LABEL[d.status])}</Badge>
            #{d.id} · {dateTime(d.created_at)} · {tr("par {0}", { 0: who(d.created_by) })}
            {d.decided_by && ` · ${tr("décidé par {0}", { 0: who(d.decided_by) })}`}
          </span>
        }
        actions={
          <Link to="/stock/inventaire" className="inline-flex h-9 items-center rounded-lg border border-line px-3.5 text-sm font-semibold">
            {tr("← Inventaires")}
          </Link>
        }
      />
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Stat label={tr("Comptés")} value={`${d.summary.counted}/${d.summary.lines}`} />
        <Stat label={tr("Écarts")} value={d.summary.discrepancies} tone={d.summary.discrepancies ? "warn" : "good"} />
        <Stat label={tr("Pièces manquantes")} value={d.summary.missingPieces} tone={d.summary.missingPieces ? "warn" : undefined} />
        <Stat label={tr("Pièces en plus")} value={d.summary.foundPieces} />
      </div>
      {d.decision_note && <p className="rounded-lg bg-ivory-deep p-3 text-sm">📝 {d.decision_note}</p>}

      <Pills
        value={filter}
        onChange={setFilter}
        options={[
          { value: "all", label: tr("Tout") },
          { value: "todo", label: tr("À compter") },
          { value: "diff", label: tr("Écarts") },
        ]}
      />
      <SearchBox value={search} onChange={setSearch} placeholder={tr("Produit, référence…")} />

      <Card padded={false}>
        <ul className="divide-y divide-line">
          {lines.map((l) => {
            const diff = l.difference;
            return (
              <li key={l.variant_id} className="p-3">
                <div className="flex flex-wrap items-center gap-3">
                  <span className="min-w-0 basis-full sm:flex-1 sm:basis-auto">
                    <span className="block truncate text-sm font-medium">{isAr ? l.name_ar || l.name_fr : l.name_fr}</span>
                    <span className="block text-xs text-ink-soft">
                      <span className="font-mono" dir="ltr">{l.sku}</span> · {tr("Système : {0}", { 0: l.system_qty })}
                    </span>
                  </span>
                  {editing ? (
                    <span className="flex items-center gap-1" dir="ltr">
                      <button type="button" className="grid size-10 place-items-center rounded-lg border border-line text-lg" onClick={() => set(l, { countedQty: Math.max(0, (l.counted_qty ?? l.system_qty) - 1) })} aria-label={tr("Moins")}>
                        −
                      </button>
                      <input
                        className={`${inputCls} text-center text-lg tabular-nums`}
                        style={{ width: "5.5rem" }}
                        inputMode="numeric"
                        value={l.counted_qty ?? ""}
                        placeholder="—"
                        onChange={(e) => set(l, { countedQty: e.target.value === "" ? null : Math.min(100000, Number(e.target.value.replace(/\D/g, "")) || 0) })}
                        aria-label={tr("Quantité comptée de {0}", { 0: l.sku })}
                      />
                      <button type="button" className="grid size-10 place-items-center rounded-lg border border-line text-lg" onClick={() => set(l, { countedQty: (l.counted_qty ?? l.system_qty) + 1 })} aria-label={tr("Plus")}>
                        +
                      </button>
                    </span>
                  ) : (
                    <span className="text-lg font-semibold tabular-nums">{l.counted_qty ?? "—"}</span>
                  )}
                  <span className={`w-14 text-end text-sm font-semibold tabular-nums ${diff == null ? "text-ink-soft" : diff < 0 ? "text-red-700" : diff > 0 ? "text-emerald-700" : "text-ink-soft"}`} dir="ltr">
                    {diff == null ? "" : diff > 0 ? `+${diff}` : diff}
                  </span>
                </div>
                {diff != null && diff !== 0 && (
                  <div className="mt-2 flex flex-wrap items-center gap-2">
                    {editing ? (
                      <select className={`${inputCls} h-10 w-auto ${!l.reason ? "border-amber-500" : ""}`} value={l.reason ?? ""} onChange={(e) => set(l, { reason: (e.target.value || null) as CountReason | null })} aria-label={tr("Raison de l'écart")}>
                        <option value="">{tr("Raison de l'écart…")}</option>
                        {COUNT_REASONS.map((r) => (
                          <option key={r} value={r}>
                            {tr(COUNT_REASON_LABEL[r])}
                          </option>
                        ))}
                      </select>
                    ) : (
                      <span className="text-xs text-ink-soft">{l.reason ? tr(COUNT_REASON_LABEL[l.reason]) : "—"}</span>
                    )}
                    {l.applied_delta != null && <span className="text-xs text-emerald-700">{tr("corrigé de {0}", { 0: l.applied_delta > 0 ? `+${l.applied_delta}` : l.applied_delta })}</span>}
                  </div>
                )}
              </li>
            );
          })}
          {!lines.length && <li className="p-6 text-center text-sm text-ink-soft">{tr("Rien dans ce filtre.")}</li>}
        </ul>
      </Card>

      <div className="sticky bottom-20 z-10 flex flex-wrap items-center justify-end gap-2 rounded-2xl border border-line bg-surface p-3 shadow-xl md:bottom-4">
        {save.isPending && <span className="me-auto text-xs text-ink-soft">{tr("Enregistrement…")}</span>}
        {d.status === "counting" && can("stock.edit") && (
          <>
            <Button variant="danger" onClick={() => decide.mutate({ action: "cancel" })}>{tr("Annuler le comptage")}</Button>
            <Button
              variant="primary"
              disabled={missingReason || save.isPending}
              onClick={() => {
                flush();
                decide.mutate({ action: "submit" });
              }}
            >
              {missingReason ? tr("Indiquez la raison de chaque écart") : tr("Envoyer pour validation")}
            </Button>
          </>
        )}
        {d.status === "submitted" && can("stock.edit") && <Button onClick={() => decide.mutate({ action: "reopen" })}>{tr("Rouvrir le comptage")}</Button>}
        {d.status === "submitted" && can("stock.approve") && <ApproveButtons onDecide={(action, note) => decide.mutate({ action, note })} busy={decide.isPending} />}
        {d.status === "submitted" && !can("stock.approve") && <span className="text-sm text-ink-soft">{tr("En attente de validation par une personne autorisée.")}</span>}
      </div>
    </div>
  );
}

function ApproveButtons({ onDecide, busy }: { onDecide: (a: "approve" | "reject", note?: string) => void; busy: boolean }) {
  const [rejecting, setRejecting] = useState(false);
  const [note, setNote] = useState("");
  return (
    <>
      <Button variant="danger" onClick={() => setRejecting(true)}>{tr("Refuser")}</Button>
      <Button variant="primary" loading={busy} onClick={() => onDecide("approve")}>{tr("✅ Valider et corriger le stock")}</Button>
      <Sheet
        open={rejecting}
        onClose={() => setRejecting(false)}
        title={tr("Refuser le comptage")}
        footer={
          <Button variant="danger" disabled={note.trim().length < 3} onClick={() => onDecide("reject", note.trim())}>
            {tr("Refuser")}
          </Button>
        }
      >
        <TextArea label={tr("Pourquoi ? (ex. : recompter le rayon des robes)")} value={note} onChange={(e) => setNote(e.target.value)} rows={3} />
      </Sheet>
    </>
  );
}
