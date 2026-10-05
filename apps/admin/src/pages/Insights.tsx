import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { api } from "../api";
import { tr } from "../i18n";
import { da, daMinus, ltr } from "../lib/format";
import { useCan } from "../Shell";
import { Card, ErrorState, ListSkeleton, Pills, Stat } from "../ui";

const pct = (v: number) => ltr(`${Math.round(v * 100)} %`);

interface ReturnsData {
  shippedOrders: number;
  returnedOrders: number;
  rate: number;
  reasons: { reason: string; label: string; n: number; share: number }[];
  sizes: { size: string; shipped: number; returned: number; rate: number; too_small: number; too_large: number }[];
  averageRate: number;
  alerts: { size: string; rate: number; average: number; hint: "too_small" | "too_large" | null }[];
  products: { product_id: number; name: string; shipped: number; returned: number; rate: number; size_returns: number; defects: number }[];
}

/** One bar per row, the value written next to it (no colour carries meaning alone). */
function BarRow({ label, value, share, hint }: { label: string; value: string; share: number; hint?: string }) {
  return (
    <li className="grid grid-cols-[minmax(7rem,10rem)_1fr_auto] items-center gap-3 text-sm">
      <span className="truncate">{label}</span>
      <span className="h-2.5 overflow-hidden rounded-full bg-ivory-deep" aria-hidden="true">
        <span className="block h-full rounded-full bg-[var(--color-chart)]" style={{ width: `${Math.max(2, Math.min(100, share * 100))}%` }} />
      </span>
      <span className="text-end tabular-nums">
        <b>{value}</b>
        {hint && <span className="ms-1.5 text-xs text-ink-soft">{hint}</span>}
      </span>
    </li>
  );
}

/** Statistiques → Retours: why parcels come back, which sizes and products come back most. */
export function ReturnsSection({ query }: { query: string }) {
  const q = useQuery({ queryKey: ["stats-returns", query], queryFn: () => api<ReturnsData>(`/stats/returns?${query}`), placeholderData: (p) => p });
  const d = q.data;
  return (
    <Card title={tr("📦 Retours : pourquoi et sur quelles tailles")}>
      {q.error ? <ErrorState error={q.error} onRetry={q.refetch} /> : !d ? <ListSkeleton rows={3} /> : d.returnedOrders === 0 ? (
        <p className="text-sm text-ink-soft">
          {tr("Aucun retour sur la période ({0} colis expédiés). Quand vous marquez une commande « Retour », choisissez la raison (trop petit, trop grand, défaut…) : elle apparaît ici.", { 0: d.shippedOrders })}
        </p>
      ) : (
        <div className="space-y-5">
          <div className="grid grid-cols-3 gap-3">
            <Stat label={tr("Taux de retour")} value={pct(d.rate)} tone={d.rate > 0.15 ? "warn" : undefined} />
            <Stat label={tr("Colis retournés")} value={d.returnedOrders} />
            <Stat label={tr("Colis expédiés")} value={d.shippedOrders} />
          </div>
          <section>
            <h3 className="mb-2 text-sm font-semibold">{tr("Raisons des retours")}</h3>
            <ul className="space-y-1.5">
              {d.reasons.map((r) => (
                <BarRow key={r.reason} label={tr(r.label)} value={pct(r.share)} share={r.share} hint={`(${r.n})`} />
              ))}
            </ul>
          </section>
          {d.alerts.length > 0 && (
            <ul className="space-y-2">
              {d.alerts.map((a) => (
                <li key={a.size} className="rounded-lg bg-amber-50 p-3 text-sm text-amber-900">
                  ⚠️ {tr("La taille {0} revient beaucoup : {1} de retours contre {2} en moyenne.", { 0: a.size, 1: pct(a.rate), 2: pct(a.average) })}{" "}
                  {a.hint === "too_small"
                    ? tr("Surtout « trop petit » : le modèle taille petit, indiquez-le dans le guide des tailles ou la description.")
                    : a.hint === "too_large"
                      ? tr("Surtout « trop grand » : le modèle taille grand, indiquez-le dans le guide des tailles ou la description.")
                      : tr("Vérifiez le guide des tailles et la description de ce modèle.")}
                </li>
              ))}
            </ul>
          )}
          {d.sizes.length > 0 && (
            <section>
              <h3 className="mb-2 text-sm font-semibold">{tr("Retours par taille (pièces)")}</h3>
              <ul className="space-y-1.5">
                {d.sizes.map((s) => (
                  <BarRow key={s.size} label={s.size} value={pct(s.rate)} share={s.rate} hint={tr("{0}/{1}", { 0: s.returned, 1: s.shipped })} />
                ))}
              </ul>
            </section>
          )}
          {d.products.length > 0 && (
            <section>
              <h3 className="mb-2 text-sm font-semibold">{tr("Produits les plus retournés")}</h3>
              <ul className="divide-y divide-line text-sm">
                {d.products.map((p) => (
                  <li key={p.product_id} className="flex items-center justify-between gap-3 py-2">
                    <span className="min-w-0 truncate">{p.name}</span>
                    <span className="shrink-0 text-end text-xs text-ink-soft">
                      <b className="text-sm text-ink">{pct(p.rate)}</b> · {p.returned}/{p.shipped}
                      {p.size_returns ? tr(" · {0} taille", { 0: p.size_returns }) : ""}
                      {p.defects ? tr(" · {0} défaut", { 0: p.defects }) : ""}
                    </span>
                  </li>
                ))}
              </ul>
            </section>
          )}
        </div>
      )}
    </Card>
  );
}

interface ProfitRow {
  id: number;
  name: string;
  image: string | null;
  units: number;
  returnedUnits: number;
  revenue: number;
  cost: number;
  delivery: number;
  returns: number;
  discounts: number;
  profit: number;
  margin: number;
  missingCost: boolean;
}

/** Statistiques → Rentabilité: what each product really earns once costs are taken off. */
export function ProfitSection({ query }: { query: string }) {
  const can = useCan();
  const allowed = can("cost.view");
  const q = useQuery({
    queryKey: ["stats-profit", query],
    queryFn: () => api<{ rows: ProfitRow[]; totals: Record<"revenue" | "cost" | "delivery" | "returns" | "discounts" | "profit", number>; missingCost: number }>(`/stats/profit?${query}`),
    enabled: allowed,
    placeholderData: (p) => p,
  });
  const [sort, setSort] = useState<"profit" | "margin" | "revenue" | "units">("profit");
  if (!allowed) return null;
  const d = q.data;
  const rows = [...(d?.rows ?? [])].sort((a, b) => b[sort] - a[sort]);
  return (
    <Card title={tr("💰 Rentabilité par produit")}>
      <p className="mb-3 text-xs text-ink-soft">
        {tr("Commandes livrées de la période. Coût = prix d'achat × pièces ; livraison = livraison offerte payée par la boutique ; retours = livraison perdue sur les colis revenus ; remises = codes et points. Frais de livraison estimés avec vos tarifs par wilaya.")}
      </p>
      {q.error ? <ErrorState error={q.error} onRetry={q.refetch} /> : !d ? <ListSkeleton rows={3} /> : d.rows.length === 0 ? (
        <p className="text-sm text-ink-soft">{tr("Pas encore de commande livrée sur la période.")}</p>
      ) : (
        <>
          <div className="mb-4 grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
            <Stat label={tr("Ventes livrées")} value={da(d.totals.revenue)} />
            <Stat label={tr("Coût des produits")} value={da(d.totals.cost)} />
            <Stat label={tr("Livraison offerte")} value={da(d.totals.delivery)} />
            <Stat label={tr("Retours")} value={da(d.totals.returns)} />
            <Stat label={tr("Remises")} value={da(d.totals.discounts)} />
            <Stat label={tr("Bénéfice estimé")} value={da(d.totals.profit)} tone={d.totals.profit >= 0 ? "good" : "warn"} />
          </div>
          {d.missingCost > 0 && (
            <p className="mb-3 rounded-lg bg-amber-50 p-3 text-sm text-amber-900">
              ⚠️ {tr("{0} produit(s) sans prix d'achat : leur bénéfice est surestimé. Ajoutez le prix d'achat dans la fiche produit.", { 0: d.missingCost })}
            </p>
          )}
          <Pills
            value={sort}
            onChange={setSort}
            options={[
              { value: "profit", label: tr("Plus rentables") },
              { value: "margin", label: tr("Meilleure marge") },
              { value: "revenue", label: tr("Plus gros chiffre") },
              { value: "units", label: tr("Plus vendus") },
            ]}
          />
          <div className="overflow-x-auto">
            <table className="w-full min-w-[46rem] text-sm">
              <thead>
                <tr className="text-xs uppercase tracking-[0.08em] text-ink-soft">
                  <th className="py-1.5 text-start font-semibold">{tr("Produit")}</th>
                  <th className="py-1.5 text-end font-semibold">{tr("Pièces")}</th>
                  <th className="py-1.5 text-end font-semibold">{tr("Ventes")}</th>
                  <th className="py-1.5 text-end font-semibold">{tr("Coût")}</th>
                  <th className="py-1.5 text-end font-semibold">{tr("Livraison")}</th>
                  <th className="py-1.5 text-end font-semibold">{tr("Retours")}</th>
                  <th className="py-1.5 text-end font-semibold">{tr("Remises")}</th>
                  <th className="py-1.5 text-end font-semibold">{tr("Bénéfice")}</th>
                  <th className="py-1.5 text-end font-semibold">{tr("Marge")}</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.id} className="border-t border-line">
                    <td className="py-2">
                      <span className="flex items-center gap-2">
                        {r.image ? <img src={r.image} alt="" className="h-10 w-8 rounded object-cover" /> : <span className="grid h-10 w-8 place-items-center rounded bg-rose-100">👗</span>}
                        <span className="min-w-0">
                          <span className="block max-w-[14rem] truncate font-medium">{r.name}</span>
                          {r.missingCost && <span className="text-xs text-amber-800">{tr("prix d'achat manquant")}</span>}
                        </span>
                      </span>
                    </td>
                    <td className="py-2 text-end tabular-nums">{r.units}{r.returnedUnits ? <span className="text-xs text-ink-soft"> (+{r.returnedUnits} ↩)</span> : null}</td>
                    <td className="py-2 text-end tabular-nums">{da(r.revenue)}</td>
                    <td className="py-2 text-end tabular-nums">{daMinus(r.cost)}</td>
                    <td className="py-2 text-end tabular-nums">{daMinus(r.delivery)}</td>
                    <td className="py-2 text-end tabular-nums">{daMinus(r.returns)}</td>
                    <td className="py-2 text-end tabular-nums">{daMinus(r.discounts)}</td>
                    <td className={`py-2 text-end font-semibold tabular-nums ${r.profit < 0 ? "text-red-700" : ""}`}>{da(r.profit)}</td>
                    <td className="py-2 text-end tabular-nums">{pct(r.margin)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </Card>
  );
}
