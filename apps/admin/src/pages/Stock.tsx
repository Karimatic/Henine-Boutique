import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useSearch } from "@tanstack/react-router";
import { useState } from "react";
import { api, errorMessage, post } from "../api";
import { da, dateTime } from "../lib/format";
import { useCan } from "../Shell";
import { Badge, Button, Card, Empty, ErrorState, ListSkeleton, NumberField, PageHeader, Pills, SearchBox, Select, Sheet, Stat, TextField, useToast } from "../ui";

interface StockRow {
  id: number;
  sku: string;
  barcode: string | null;
  stock_on_hand: number;
  stock_reserved: number;
  low_stock_threshold: number;
  product_id: number;
  name_fr: string;
  options: string;
  price: number;
  cost_price: number | null;
  waiting: number;
}

const REASON: Record<string, string> = {
  reception: "📥 Réception", ajustement: "✏️ Ajustement", casse: "💔 Casse / défaut", retour: "↩️ Retour", inventaire: "📋 Inventaire",
  reservation: "🔒 Réservé (commande)", liberation: "🔓 Libéré (annulation)", vente: "🛍 Vendu (expédié)",
};

export function StockPage() {
  const search = useSearch({ strict: false }) as { filter?: string };
  const [filter, setFilter] = useState(search.filter ?? "all");
  const [q, setQ] = useState("");
  const [adjust, setAdjust] = useState<StockRow | null>(null);
  const [history, setHistory] = useState(false);
  const data = useQuery({ queryKey: ["stock", filter, q], queryFn: () => api<{ totals: Record<string, number | null>; rows: StockRow[] }>(`/stock?filter=${filter}&q=${encodeURIComponent(q)}`) });
  const t = data.data?.totals;
  return (
    <div>
      <PageHeader group="Catalogue" title="Stock" actions={<Button size="sm" onClick={() => setHistory(true)}>Historique des mouvements</Button>} />
      {t && (
        <div className="mb-4 grid grid-cols-2 gap-3 md:grid-cols-4">
          <Stat label="Pièces en stock" value={t.units ?? 0} />
          <Stat label="Valeur (prix de vente)" value={da(t.retail_value)} />
          <Stat label="Valeur (prix d'achat)" value={t.cost_value == null ? "🔒" : da(t.cost_value)} />
          <Stat label="Ruptures / stock bas" value={`${t.out_count ?? 0} / ${t.low_count ?? 0}`} tone={(t.out_count ?? 0) > 0 ? "warn" : undefined} />
        </div>
      )}
      <Pills value={filter} onChange={setFilter} options={[{ value: "all", label: "Tout" }, { value: "low", label: "Stock bas" }, { value: "out", label: "Ruptures" }, { value: "waiting", label: "🔔 Clientes en attente" }]} />
      <SearchBox value={q} onChange={setQ} placeholder="Produit, SKU ou code-barres…" />
      {data.error ? (
        <ErrorState error={data.error} onRetry={data.refetch} />
      ) : !data.data ? (
        <ListSkeleton />
      ) : data.data.rows.length === 0 ? (
        <Empty title="Rien à afficher" />
      ) : (
        <ul className="divide-y divide-line overflow-hidden rounded-xl border border-line bg-white">
          {data.data.rows.map((r) => {
            const available = r.stock_on_hand - r.stock_reserved;
            return (
              <li key={r.id}>
                <button type="button" onClick={() => setAdjust(r)} className="flex w-full items-center justify-between gap-3 px-4 py-3 text-start hover:bg-rose-100/30">
                  <span className="min-w-0">
                    <span className="block truncate text-sm font-medium">{r.name_fr} <span className="text-ink-soft">· {r.options}</span></span>
                    <span className="text-xs text-ink-soft">{r.sku}{r.waiting ? ` · 🔔 ${r.waiting} cliente(s) attendent` : ""}</span>
                  </span>
                  <span className="flex shrink-0 items-center gap-2 text-end">
                    {r.stock_reserved > 0 && <Badge tone="bg-sky-100 text-sky-800">{r.stock_reserved} réservé(s)</Badge>}
                    <span className={`w-12 text-lg font-semibold tabular-nums ${available <= 0 ? "text-red-700" : available <= r.low_stock_threshold ? "text-amber-700" : ""}`}>{available}</span>
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      )}
      {adjust && <AdjustSheet row={adjust} onClose={() => setAdjust(null)} />}
      <HistorySheet open={history} onClose={() => setHistory(false)} />
    </div>
  );
}

function AdjustSheet({ row, onClose }: { row: StockRow; onClose: () => void }) {
  const qc = useQueryClient();
  const toast = useToast();
  const can = useCan();
  const [mode, setMode] = useState<"add" | "remove" | "set">("add");
  const [qty, setQty] = useState<number | null>(null);
  const [reason, setReason] = useState("reception");
  const [note, setNote] = useState("");
  const moves = useQuery({ queryKey: ["movements", row.id], queryFn: () => api<{ id: number; delta: number; reason: string; note: string | null; actor: string; created_at: number; public_code: string | null }[]>(`/stock/movements?variant=${row.id}`) });
  const save = useMutation({
    mutationFn: () => post(`/stock/${row.id}/adjust`, { mode, qty: qty ?? 0, reason, note: note || null }),
    onSuccess: () => {
      toast("Stock mis à jour");
      void qc.invalidateQueries({ queryKey: ["stock"] });
      void qc.invalidateQueries({ queryKey: ["movements"] });
      onClose();
    },
    onError: (e) => toast(errorMessage(e), "error"),
  });
  return (
    <Sheet open onClose={onClose} title={`${row.name_fr} · ${row.options}`}>
      <div className="mb-4 grid grid-cols-3 gap-2 text-center">
        <Stat label="En stock" value={row.stock_on_hand} />
        <Stat label="Réservé" value={row.stock_reserved} />
        <Stat label="Disponible" value={row.stock_on_hand - row.stock_reserved} />
      </div>
      {can("stock.edit") && (
        <Card title="Mouvement de stock">
          <Pills value={mode} onChange={setMode} options={[{ value: "add", label: "+ Ajouter" }, { value: "remove", label: "− Retirer" }, { value: "set", label: "= Compter" }]} />
          <div className="grid gap-3 sm:grid-cols-2">
            <NumberField label={mode === "set" ? "Quantité comptée" : "Quantité"} value={qty} onChange={setQty} />
            <Select label="Raison" value={reason} onChange={(e) => setReason(e.target.value)}>
              <option value="reception">Réception fournisseur</option>
              <option value="ajustement">Ajustement / correction</option>
              <option value="casse">Casse / défaut</option>
              <option value="retour">Retour cliente</option>
              <option value="inventaire">Inventaire</option>
            </Select>
            <TextField label="Note (facultatif)" value={note} onChange={(e) => setNote(e.target.value)} className="sm:col-span-2" />
          </div>
          <Button variant="primary" className="mt-3 w-full" loading={save.isPending} disabled={qty == null} onClick={() => save.mutate()}>
            Valider
          </Button>
        </Card>
      )}
      <h3 className="mb-2 mt-5 text-sm font-semibold">Historique</h3>
      {!moves.data ? <ListSkeleton rows={3} /> : <MovementList rows={moves.data} />}
    </Sheet>
  );
}

function MovementList({ rows }: { rows: { id: number; delta: number; reason: string; note: string | null; actor: string; created_at: number; public_code: string | null; name_fr?: string; sku?: string }[] }) {
  if (!rows.length) return <p className="text-sm text-ink-soft">Aucun mouvement.</p>;
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
    <Sheet open={open} onClose={onClose} title="Mouvements de stock récents">
      {!q.data ? <ListSkeleton rows={4} /> : <MovementList rows={q.data} />}
    </Sheet>
  );
}
