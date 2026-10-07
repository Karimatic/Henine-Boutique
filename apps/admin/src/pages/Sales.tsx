import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { api } from "../api";
import { CHANNEL_LABEL, da, date } from "../lib/format";
import { useCan } from "../Shell";
import { Card, ErrorState, ListSkeleton, PageHeader, Pills, Stat, StatusBadge } from "../ui";
import { SaleDesk } from "./Cashier";
import { tr } from "../i18n";

interface SalesData {
  days: number;
  totals: { orders: number; revenue: number; merch: number };
  byProduct: { product_id: number; name_fr: string; units: number; revenue: number; cost: number | null; returned: number }[];
  byChannel: { channel: string; orders: number; revenue: number }[];
  recentManual: { id: number; public_code: string; channel: string; name: string; total: number; status: string; created_at: number }[];
}

/** Ventes: record a sale (shop, phone, WhatsApp, Instagram), and see how sales are going. */
export function SalesPage() {
  const can = useCan();
  const [days, setDays] = useState("30");
  const [view, setView] = useState<"new" | "results">(() => (can("sales.create") ? "new" : "results"));
  const q = useQuery({ queryKey: ["sales", days], queryFn: () => api<SalesData>(`/sales?days=${days}`), enabled: view === "results" });
  const d = q.data;
  const margin = d && d.byProduct.every((p) => p.cost != null) ? d.byProduct.reduce((s, p) => s + p.revenue - (p.cost ?? 0), 0) : null;
  return (
    <div>
      <PageHeader
        group={tr("Catalogue")}
        title={tr("Ventes")}
        subtitle={tr("Les ventes faites au magasin, par téléphone, WhatsApp ou Instagram, et leurs résultats.")}
      />
      {can("sales.create") && (
        <Pills value={view} onChange={setView} options={[{ value: "new", label: tr("🧾 Nouvelle vente") }, { value: "results", label: tr("📊 Résultats") }]} />
      )}
      {view === "new" ? <SaleDesk /> : (
      <>
      <Pills value={days} onChange={setDays} options={[{ value: "7", label: tr("7 jours") }, { value: "30", label: tr("30 jours") }, { value: "90", label: tr("90 jours") }, { value: "365", label: tr("1 an") }]} />
      {q.error ? (
        <ErrorState error={q.error} onRetry={q.refetch} />
      ) : !d ? (
        <ListSkeleton />
      ) : (
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
            <Stat label={tr("Ventes confirmées")} value={d.totals.orders} />
            <Stat label={tr("Chiffre d'affaires")} value={da(d.totals.revenue)} hint={tr("livraison incluse")} />
            <Stat label={tr("Marchandise")} value={da(d.totals.merch)} hint={tr("hors livraison")} />
            <Stat label={tr("Marge brute")} value={margin == null ? "🔒" : da(margin)} hint={margin == null ? tr("prix d'achat requis") : undefined} />
          </div>
          <Card title={tr("Par canal")}>
            {d.byChannel.length === 0 ? <p className="text-sm text-ink-soft">{tr("Aucune vente sur la période.")}</p> : (
              <ul className="grid gap-2 sm:grid-cols-3">
                {d.byChannel.map((c) => (
                  <li key={c.channel} className="rounded-xl bg-ivory-deep px-3 py-2 text-sm">
                    <span className="font-semibold">{tr(CHANNEL_LABEL[c.channel]) ?? c.channel}</span>
                    <span className="block text-ink-soft">{c.orders} {tr("vente(s) ·")} {da(c.revenue)}</span>
                  </li>
                ))}
              </ul>
            )}
          </Card>
          <Card title={tr("Par produit")} padded={false}>
            {d.byProduct.length === 0 ? <p className="px-4 pb-4 text-sm text-ink-soft">{tr("Aucune vente sur la période.")}</p> : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="text-xs text-ink-soft">
                    <tr className="border-b border-line"><th className="px-4 py-2 text-start font-medium">{tr("Produit")}</th><th className="px-2 text-end font-medium">{tr("Pièces")}</th><th className="px-2 text-end font-medium">{tr("CA")}</th><th className="px-4 text-end font-medium">{tr("Retours")}</th></tr>
                  </thead>
                  <tbody>
                    {d.byProduct.map((p) => (
                      <tr key={`${p.product_id}-${p.name_fr}`} className="border-b border-line/60 last:border-0">
                        <td className="px-4 py-2">{p.name_fr}</td>
                        <td className="whitespace-nowrap px-2 text-end tabular-nums">{p.units}</td>
                        <td className="whitespace-nowrap px-2 text-end tabular-nums">{da(p.revenue)}</td>
                        <td className={`px-4 text-end tabular-nums ${p.returned ? "text-orange-700" : "text-ink-soft"}`}>{p.returned}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Card>
          <Card title={tr("Dernières ventes manuelles")}>
            {d.recentManual.length === 0 ? <p className="text-sm text-ink-soft">{tr("Les ventes de la Caisse et les commandes reçues sur Instagram, WhatsApp ou par téléphone apparaissent ici.")}</p> : (
              <ul className="space-y-2 text-sm">
                {d.recentManual.map((o) => (
                  <li key={o.id} className="flex items-center justify-between gap-2">
                    <span>{o.name} · <span className="text-ink-soft">{tr(CHANNEL_LABEL[o.channel])} · {date(o.created_at)}</span></span>
                    <span className="flex items-center gap-2"><b>{da(o.total)}</b><StatusBadge status={o.status} /></span>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </div>
      )}
      </>
      )}
    </div>
  );
}
