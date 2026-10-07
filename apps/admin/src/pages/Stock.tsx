import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useNavigate, useSearch } from "@tanstack/react-router";
import { PackagePlus } from "lucide-react";
import { useMemo, useState } from "react";
import { api, errorMessage, post } from "../api";
import { tr } from "../i18n";
import { dateTime } from "../lib/format";
import { useCan } from "../Shell";
import { Button, Empty, ErrorState, inputCls, ListSkeleton, PageHeader, Pills, SearchBox, Sheet, Stat, TextField, useToast } from "../ui";

/* ───────────── Data ───────────── */

export interface StockVariant {
  id: number;
  sku: string;
  valueIds: number[];
  onHand: number;
  reserved: number;
  low: number;
  active: boolean;
  waiting: number;
}
export interface StockProduct {
  id: number;
  name: string;
  nameAr: string;
  status: string;
  price: number;
  category: string | null;
  image: string | null;
  options: { id: number; kind: string; name: string; values: { id: number; label: string; hex: string | null }[] }[];
  variants: StockVariant[];
}

const REASON: Record<string, string> = {
  reception: tr("📥 Réception"), ajustement: "✏️ Ajustement", casse: tr("💔 Casse / défaut"), retour: tr("↩️ Retour"), inventaire: tr("📋 Inventaire"),
  reservation: tr("🔒 Réservé (commande)"), liberation: tr("🔓 Libéré (annulation)"), vente: tr("🛍 Vendu (expédié)"),
};

/** Lines (colours) × columns (sizes) of a product; works with 0, 1 or 2 options. */
function layout(p: StockProduct) {
  const color = p.options.find((o) => o.kind === "couleur");
  const size = p.options.find((o) => o.kind === "taille");
  const rowsOpt = color ?? (size ? undefined : p.options[0]);
  const colsOpt = size ?? (color ? p.options.find((o) => o !== color) : p.options[1]);
  const rows = rowsOpt?.values ?? [{ id: 0, label: "", hex: null }];
  const cols = colsOpt?.values ?? [{ id: 0, label: "", hex: null }];
  const cell = (r: number, c: number) =>
    p.variants.find((v) => (r === 0 || v.valueIds.includes(r)) && (c === 0 || v.valueIds.includes(c))) ?? null;
  return { rows, cols, rowsOpt, colsOpt, cell };
}

const avail = (v: StockVariant) => v.onHand - v.reserved;
const tone = (v: StockVariant) =>
  !v.active ? "border-line bg-stone-100 text-ink-soft" : avail(v) <= 0 ? "border-red-200 bg-red-50 text-red-800" : avail(v) <= v.low ? "border-amber-200 bg-amber-50 text-amber-800" : "border-line bg-surface";

/**
 * The size × colour table of a product. `mode`:
 *  - "view": available pieces (tap = edit),
 *  - "set": boxes with the counted quantity in hand,
 *  - "add": boxes with the quantity received (delivery).
 */
export function StockMatrix({
  p, mode, values, onChange, onTap,
}: {
  p: StockProduct;
  mode: "view" | "set" | "add";
  values?: Record<number, string>;
  onChange?: (variantId: number, value: string) => void;
  onTap?: () => void;
}) {
  const { rows, cols, rowsOpt, colsOpt, cell } = layout(p);
  return (
    <div className="-mx-1 overflow-x-auto px-1" dir="ltr">
      <table className="w-full border-separate border-spacing-1 text-sm">
        {colsOpt && (
          <thead>
            <tr>
              <th />
              {cols.map((c) => (
                <th key={c.id} className="min-w-14 text-center text-xs font-semibold">
                  {c.label}
                </th>
              ))}
              {mode === "view" && <th className="w-10 text-center text-xs font-medium text-ink-soft">{tr("Total")}</th>}
            </tr>
          </thead>
        )}
        <tbody>
          {rows.map((r) => {
            const rowVariants = cols.map((c) => cell(r.id, c.id)).filter((v): v is StockVariant => !!v && v.active);
            return (
              <tr key={r.id}>
                {rowsOpt && (
                  <th className="whitespace-nowrap pe-1 text-start text-sm font-medium">
                    <span className="inline-flex items-center gap-1.5">
                      {r.hex && <span className="size-3.5 shrink-0 rounded-full border border-line" style={{ background: r.hex }} />}
                      {r.label}
                    </span>
                  </th>
                )}
                {cols.map((c) => {
                  const v = cell(r.id, c.id);
                  if (!v) return <td key={c.id} />;
                  if (mode === "view") {
                    return (
                      <td key={c.id}>
                        <button
                          type="button"
                          onClick={onTap}
                          title={v.reserved ? tr("{0} réservé(s) par des commandes", { 0: v.reserved }) : v.sku}
                          className={`relative grid h-11 w-full min-w-14 place-items-center rounded-lg border text-base font-semibold tabular-nums transition hover:border-plum-600 ${tone(v)}`}
                        >
                          {avail(v)}
                          {v.reserved > 0 && <span className="absolute end-1 top-0.5 text-[9px] font-medium text-sky-700">🔒{v.reserved}</span>}
                          {v.waiting > 0 && <span className="absolute start-1 top-0.5 text-[9px]">🔔{v.waiting}</span>}
                        </button>
                      </td>
                    );
                  }
                  return (
                    <td key={c.id}>
                      <input
                        type="text"
                        inputMode="numeric"
                        disabled={!v.active}
                        placeholder={mode === "add" ? "+0" : String(v.onHand)}
                        aria-label={`${r.label} ${c.label}`.trim() || p.name}
                        value={values?.[v.id] ?? ""}
                        onChange={(e) => onChange?.(v.id, e.target.value.replace(/[٠-٩]/g, (d) => String(d.charCodeAt(0) - 0x660)).replace(/[^0-9]/g, ""))}
                        className={`h-11 w-full min-w-14 rounded-lg border text-center text-base font-semibold tabular-nums outline-none focus:border-plum-600 focus:ring-2 focus:ring-plum-600/15 ${
                          values?.[v.id] ? "border-plum-600 bg-rose-100/50" : "border-line bg-surface"
                        }`}
                      />
                    </td>
                  );
                })}
                {mode === "view" && <td className="text-center font-semibold tabular-nums text-ink-soft">{rowVariants.reduce((s, v) => s + avail(v), 0)}</td>}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

/* ───────────── Stock page: one card per product ───────────── */

export function StockPage() {
  const search = useSearch({ strict: false }) as { filter?: string };
  const can = useCan();
  const [filter, setFilter] = useState(search.filter ?? "all");
  const [q, setQ] = useState("");
  const [category, setCategory] = useState("");
  const [history, setHistory] = useState(false);
  const categories = useQuery({ queryKey: ["categories"], queryFn: () => api<{ id: number; name_fr: string }[]>("/categories") });
  const data = useQuery({
    queryKey: ["stock-products", filter, q, category],
    queryFn: () => api<{ products: StockProduct[] }>(`/stock/products?filter=${filter}&q=${encodeURIComponent(q)}&category=${category}`),
  });
  const products = data.data?.products ?? [];
  const all = products.flatMap((p) => p.variants.filter((v) => v.active));
  return (
    <div>
      <PageHeader
        group={tr("Catalogue")}
        title={tr("Stock")}
        subtitle={tr("Chaque produit avec son tableau couleur × taille. Touchez un chiffre pour modifier.")}
        actions={
          <>
            <Link
              to="/stock/inventaire"
              title={tr("Compter les pièces du magasin et corriger le stock s'il y a une différence")}
              className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-line bg-surface px-3.5 text-sm font-semibold"
            >
              {tr("📋 Compter le stock")}
            </Link>
            {can("stock.edit") && (
              <Link to="/stock/reception" className="inline-flex h-9 items-center gap-1.5 rounded-lg bg-plum-600 px-3.5 text-sm font-semibold text-white">
                <PackagePlus className="size-4" /> {tr("Réception")}
              </Link>
            )}
            <Button size="sm" onClick={() => setHistory(true)}>
              {tr("Historique des mouvements")}
            </Button>
          </>
        }
      />
      {data.data && (
        <div className="mb-4 grid grid-cols-2 gap-3 md:grid-cols-4">
          <Stat label={tr("Pièces disponibles")} value={all.reduce((s, v) => s + Math.max(0, avail(v)), 0)} />
          <Stat label={tr("Produits")} value={products.length} />
          <Stat label={tr("Tailles épuisées")} value={all.filter((v) => avail(v) <= 0).length} tone={all.some((v) => avail(v) <= 0) ? "warn" : undefined} />
          <Stat label={tr("Stock bas")} value={all.filter((v) => avail(v) > 0 && avail(v) <= v.low).length} />
        </div>
      )}
      <Pills
        value={filter}
        onChange={setFilter}
        options={[
          { value: "all", label: tr("Tout") },
          { value: "low", label: tr("Stock bas") },
          { value: "out", label: tr("Épuisé") },
          { value: "waiting", label: tr("🔔 Clientes en attente") },
        ]}
      />
      {filter === "waiting" && (
        <div className="mb-3 rounded-xl border border-plum-600/30 bg-rose-100/40 p-3.5 text-sm leading-relaxed">
          <p className="font-semibold">{tr("🔔 Des clientes attendent ces tailles")}</p>
          <p className="mt-1 text-ink-soft">
            {tr("Sur la boutique, quand une taille est épuisée, la cliente peut toucher « Prévenez-moi » et laisser son numéro. Elle apparaît ici, et le petit 🔔 sur une case dit combien de clientes attendent cette taille.")}
          </p>
          <p className="mt-1 text-ink-soft">
            {tr("Dès que vous remettez du stock (Réception, ou en touchant le chiffre), elles reçoivent une notification si elles l'ont acceptée, et leurs numéros s'affichent sur le tableau de bord pour les appeler ou leur écrire sur WhatsApp.")}
          </p>
        </div>
      )}
      <div className="mb-3 grid gap-2 sm:grid-cols-[1fr_14rem]">
        <SearchBox value={q} onChange={setQ} placeholder={tr("Produit, SKU ou code-barres…")} />
        <select className={`${inputCls} h-11`} value={category} onChange={(e) => setCategory(e.target.value)} aria-label={tr("Catégorie")}>
          <option value="">{tr("Toutes les catégories")}</option>
          {(categories.data ?? []).map((c) => (
            <option key={c.id} value={c.id}>
              {c.name_fr}
            </option>
          ))}
        </select>
      </div>
      {data.error ? (
        <ErrorState error={data.error} onRetry={data.refetch} />
      ) : !data.data ? (
        <ListSkeleton />
      ) : products.length === 0 ? (
        <Empty title={tr("Rien à afficher")} />
      ) : (
        <ul className="grid gap-3 xl:grid-cols-2">
          {products.map((p) => (
            <ProductStockCard key={p.id} p={p} editable={can("stock.edit")} />
          ))}
        </ul>
      )}
      <HistorySheet open={history} onClose={() => setHistory(false)} />
    </div>
  );
}

function ProductStockCard({ p, editable }: { p: StockProduct; editable: boolean }) {
  const qc = useQueryClient();
  const toast = useToast();
  const [editing, setEditing] = useState(false);
  const [values, setValues] = useState<Record<number, string>>({});
  const [reason, setReason] = useState("inventaire");
  const total = p.variants.filter((v) => v.active).reduce((s, v) => s + Math.max(0, avail(v)), 0);
  const changes = Object.entries(values)
    .filter(([id, v]) => v !== "" && Number(v) !== p.variants.find((x) => x.id === Number(id))?.onHand)
    .map(([id, v]) => ({ variantId: Number(id), mode: "set" as const, qty: Number(v) }));
  const save = useMutation({
    mutationFn: () => post<{ changed: number }>("/stock/batch", { reason, lines: changes }),
    onSuccess: (r) => {
      toast(tr("{0} quantité(s) mise(s) à jour ✓", { 0: r.changed }));
      setEditing(false);
      setValues({});
      void qc.invalidateQueries({ queryKey: ["stock-products"] });
      void qc.invalidateQueries({ queryKey: ["movements"] });
      void qc.invalidateQueries({ queryKey: ["products"] });
    },
    onError: (e) => toast(errorMessage(e), "error"),
  });
  const start = () => {
    if (!editable) return;
    setValues(Object.fromEntries(p.variants.map((v) => [v.id, String(v.onHand)])));
    setEditing(true);
  };
  return (
    <li className={`rounded-xl border bg-surface p-4 transition ${editing ? "border-plum-600 shadow-[0_8px_24px_-12px_rgb(106_12_54/0.35)]" : "border-line"}`}>
      <div className="mb-3 flex items-center gap-3">
        {p.image ? <img src={p.image} alt="" className="h-14 w-11 shrink-0 rounded-lg object-cover" /> : <span className="grid h-14 w-11 shrink-0 place-items-center rounded-lg bg-rose-100 text-xl">👗</span>}
        <div className="min-w-0 flex-1">
          <Link to="/produits/$id" params={{ id: String(p.id) }} className="block truncate font-semibold hover:text-plum-700">
            {p.name}
          </Link>
          <p className="truncate text-xs text-ink-soft">
            {p.category ?? tr("Sans catégorie")}
            {p.status !== "published" ? ` · ${tr("Brouillon")}` : ""}
          </p>
        </div>
        <div className="text-end">
          <p className={`text-xl font-semibold tabular-nums ${total <= 0 ? "text-red-700" : ""}`}>{total}</p>
          <p className="text-[11px] text-ink-soft">{tr("disponibles")}</p>
        </div>
      </div>
      <StockMatrix p={p} mode={editing ? "set" : "view"} values={values} onChange={(id, v) => setValues((x) => ({ ...x, [id]: v }))} onTap={start} />
      {editing ? (
        <div className="mt-3 space-y-2 rounded-lg bg-ivory-deep/70 p-3">
          <p className="text-xs text-ink-soft">{tr("Tapez la quantité que vous avez en main pour chaque case, puis enregistrez.")}</p>
          <div className="flex flex-wrap items-center gap-2">
            <select className={`${inputCls} h-10 w-auto flex-1`} value={reason} onChange={(e) => setReason(e.target.value)} aria-label={tr("Raison")}>
              <option value="inventaire">{tr("📋 Comptage / inventaire")}</option>
              <option value="ajustement">{tr("✏️ Correction")}</option>
              <option value="casse">{tr("💔 Casse / défaut")}</option>
              <option value="retour">{tr("↩️ Retour cliente")}</option>
            </select>
            <Button size="sm" onClick={() => { setEditing(false); setValues({}); }}>
              {tr("Annuler")}
            </Button>
            <Button size="sm" variant="primary" disabled={!changes.length} loading={save.isPending} onClick={() => save.mutate()}>
              {changes.length ? tr("Enregistrer ({0})", { 0: changes.length }) : tr("Enregistrer")}
            </Button>
          </div>
        </div>
      ) : (
        editable && (
          <div className="mt-2 flex items-center justify-between gap-2">
            <span className="text-[11px] text-ink-soft">{tr("Rouge = épuisé · orange = stock bas · 🔒 réservé · 🔔 clientes en attente")}</span>
            <Button size="sm" onClick={start}>
              ✏️ {tr("Modifier les quantités")}
            </Button>
          </div>
        )
      )}
    </li>
  );
}

/* ───────────── Réception: a whole delivery in one go ───────────── */

export function ReceptionPage() {
  const qc = useQueryClient();
  const toast = useToast();
  const navigate = useNavigate();
  const [q, setQ] = useState("");
  const [picked, setPicked] = useState<StockProduct[]>([]);
  const [values, setValues] = useState<Record<number, string>>({});
  const [note, setNote] = useState("");
  const found = useQuery({
    queryKey: ["stock-products", "search", q],
    queryFn: () => api<{ products: StockProduct[] }>(`/stock/products?filter=all&q=${encodeURIComponent(q)}`),
    enabled: q.trim().length >= 1,
  });
  const lines = useMemo(
    () => Object.entries(values).filter(([, v]) => Number(v) > 0).map(([id, v]) => ({ variantId: Number(id), mode: "add" as const, qty: Number(v) })),
    [values],
  );
  const pieces = lines.reduce((s, l) => s + l.qty, 0);
  const save = useMutation({
    mutationFn: () => post<{ pieces: number }>("/stock/batch", { reason: "reception", note: note || null, lines }),
    onSuccess: (r) => {
      toast(tr("{0} pièce(s) ajoutée(s) au stock ✓", { 0: r.pieces }));
      void qc.invalidateQueries({ queryKey: ["stock-products"] });
      void qc.invalidateQueries({ queryKey: ["products"] });
      void qc.invalidateQueries({ queryKey: ["movements"] });
      void navigate({ to: "/stock" });
    },
    onError: (e) => toast(errorMessage(e), "error"),
  });
  const matches = (found.data?.products ?? []).filter((p) => !picked.some((x) => x.id === p.id)).slice(0, 8);
  return (
    <div className="pb-24">
      <PageHeader
        group={tr("Catalogue › Stock")}
        title={tr("📥 Nouvelle réception")}
        subtitle={tr("Une livraison est arrivée : ajoutez les produits, tapez les quantités reçues, puis un seul bouton met tout en stock.")}
      />
      <div className="mb-4 rounded-xl border border-line bg-surface p-4">
        <SearchBox value={q} onChange={setQ} placeholder={tr("Ajouter un produit : tapez son nom…")} />
        {q && (
          <ul className="grid gap-2 sm:grid-cols-2">
            {matches.map((p) => (
              <li key={p.id}>
                <button
                  type="button"
                  onClick={() => { setPicked((x) => [p, ...x]); setQ(""); }}
                  className="flex w-full items-center gap-3 rounded-xl border border-dashed border-line p-2 text-start hover:border-plum-600"
                >
                  {p.image ? <img src={p.image} alt="" className="h-12 w-9 rounded-md object-cover" /> : <span className="grid h-12 w-9 place-items-center rounded-md bg-rose-100">👗</span>}
                  <span className="min-w-0">
                    <span className="block truncate font-medium">+ {p.name}</span>
                    <span className="text-xs text-ink-soft">{p.category ?? ""}</span>
                  </span>
                </button>
              </li>
            ))}
            {found.data && matches.length === 0 && <li className="text-sm text-ink-soft">{tr("Aucun produit")}</li>}
          </ul>
        )}
      </div>
      {picked.length === 0 ? (
        <Empty title={tr("Aucun produit dans cette réception")} icon="📦">
          {tr("Cherchez les produits reçus ci-dessus. Un produit nouveau ? Créez-le d'abord dans Produits.")}
        </Empty>
      ) : (
        <ul className="space-y-3">
          {picked.map((p) => (
            <li key={p.id} className="rounded-xl border border-line bg-surface p-4">
              <div className="mb-3 flex items-center gap-3">
                {p.image ? <img src={p.image} alt="" className="h-12 w-9 rounded-md object-cover" /> : <span className="grid h-12 w-9 place-items-center rounded-md bg-rose-100">👗</span>}
                <p className="min-w-0 flex-1 truncate font-semibold">{p.name}</p>
                <button
                  type="button"
                  onClick={() => {
                    setPicked((x) => x.filter((y) => y.id !== p.id));
                    setValues((v) => Object.fromEntries(Object.entries(v).filter(([id]) => !p.variants.some((x) => x.id === Number(id)))));
                  }}
                  className="text-sm text-ink-soft underline"
                >
                  {tr("Retirer")}
                </button>
              </div>
              <StockMatrix p={p} mode="add" values={values} onChange={(id, v) => setValues((x) => ({ ...x, [id]: v }))} />
            </li>
          ))}
        </ul>
      )}
      <div className="mt-4">
        <TextField label={tr("Note (fournisseur, facture…)")} value={note} maxLength={200} onChange={(e) => setNote(e.target.value)} />
      </div>
      <div className="fixed inset-x-0 bottom-[calc(4rem+env(safe-area-inset-bottom))] z-30 border-t border-line bg-surface/95 p-3 backdrop-blur md:bottom-0 md:ps-[15rem]">
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-3 px-1 md:px-8">
          <p className="text-sm">
            <b className="text-lg tabular-nums">{pieces}</b> {tr("pièce(s) à ajouter")}
          </p>
          <Button variant="primary" disabled={!pieces} loading={save.isPending} onClick={() => save.mutate()}>
            {tr("Ajouter au stock")}
          </Button>
        </div>
      </div>
    </div>
  );
}

/* ───────────── History ───────────── */

function MovementList({ rows }: { rows: { id: number; delta: number; reason: string; note: string | null; actor: string; created_at: number; public_code: string | null; name_fr?: string; sku?: string }[] }) {
  if (!rows.length) return <p className="text-sm text-ink-soft">{tr("Aucun mouvement.")}</p>;
  return (
    <ul className="space-y-1.5 text-sm">
      {rows.map((m) => (
        <li key={m.id} className="flex items-baseline justify-between gap-2">
          <span className="min-w-0">
            <span className="block">{REASON[m.reason] ?? m.reason}{m.public_code ? ` · ${m.public_code}` : ""}{m.name_fr ? ` · ${m.name_fr} (${m.sku})` : ""}</span>
            <span className="text-xs text-ink-soft">{dateTime(m.created_at)} · {m.actor.split(":").slice(2).join(":") || m.actor}{m.note ? ` · ${m.note}` : ""}</span>
          </span>
          <b className={`tabular-nums ${m.delta < 0 ? "text-red-700" : "text-emerald-700"}`}>{m.delta > 0 ? `+${m.delta}` : m.delta}</b>
        </li>
      ))}
    </ul>
  );
}

function HistorySheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const q = useQuery({ queryKey: ["movements", "all"], queryFn: () => api<Parameters<typeof MovementList>[0]["rows"]>("/stock/movements"), enabled: open });
  return (
    <Sheet open={open} onClose={onClose} title={tr("Mouvements de stock récents")}>
      {!q.data ? <ListSkeleton rows={4} /> : <MovementList rows={q.data} />}
    </Sheet>
  );
}
