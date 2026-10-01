import { normalizeDzPhone } from "@henine/shared";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { api, errorMessage, post } from "../api";
import { CHANNEL_LABEL, da, date } from "../lib/format";
import { useCan } from "../Shell";
import { Button, Card, Empty, ErrorState, inputCls, ListSkeleton, PageHeader, Pills, Select, Sheet, Stat, StatusBadge, TextField, useToast } from "../ui";

interface SalesData {
  days: number;
  totals: { orders: number; revenue: number; merch: number };
  byProduct: { product_id: number; name_fr: string; units: number; revenue: number; cost: number | null; returned: number }[];
  byChannel: { channel: string; orders: number; revenue: number }[];
  recentManual: { id: number; public_code: string; channel: string; name: string; total: number; status: string; created_at: number }[];
}

export function SalesPage() {
  const can = useCan();
  const [days, setDays] = useState("30");
  const [open, setOpen] = useState(false);
  const q = useQuery({ queryKey: ["sales", days], queryFn: () => api<SalesData>(`/sales?days=${days}`) });
  const d = q.data;
  const margin = d && d.byProduct.every((p) => p.cost != null) ? d.byProduct.reduce((s, p) => s + p.revenue - (p.cost ?? 0), 0) : null;
  return (
    <div>
      <PageHeader
        group="Catalogue"
        title="Ventes"
        subtitle="Performance par produit + ventes réalisées en boutique, sur Instagram ou par téléphone."
        actions={can("sales.create") && <Button variant="primary" onClick={() => setOpen(true)}>+ Vente manuelle</Button>}
      />
      <Pills value={days} onChange={setDays} options={[{ value: "7", label: "7 jours" }, { value: "30", label: "30 jours" }, { value: "90", label: "90 jours" }, { value: "365", label: "1 an" }]} />
      {q.error ? (
        <ErrorState error={q.error} onRetry={q.refetch} />
      ) : !d ? (
        <ListSkeleton />
      ) : (
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
            <Stat label="Ventes confirmées" value={d.totals.orders} />
            <Stat label="Chiffre d'affaires" value={da(d.totals.revenue)} hint="livraison incluse" />
            <Stat label="Marchandise" value={da(d.totals.merch)} hint="hors livraison" />
            <Stat label="Marge brute" value={margin == null ? "🔒" : da(margin)} hint={margin == null ? "prix d'achat requis" : undefined} />
          </div>
          <Card title="Par canal">
            {d.byChannel.length === 0 ? <p className="text-sm text-ink-soft">Aucune vente sur la période.</p> : (
              <ul className="grid gap-2 sm:grid-cols-3">
                {d.byChannel.map((c) => (
                  <li key={c.channel} className="rounded-xl bg-ivory-deep px-3 py-2 text-sm">
                    <span className="font-semibold">{CHANNEL_LABEL[c.channel] ?? c.channel}</span>
                    <span className="block text-ink-soft">{c.orders} vente(s) · {da(c.revenue)}</span>
                  </li>
                ))}
              </ul>
            )}
          </Card>
          <Card title="Par produit" padded={false}>
            {d.byProduct.length === 0 ? <p className="px-4 pb-4 text-sm text-ink-soft">Aucune vente sur la période.</p> : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="text-xs text-ink-soft">
                    <tr className="border-b border-line"><th className="px-4 py-2 text-start font-medium">Produit</th><th className="px-2 text-end font-medium">Pièces</th><th className="px-2 text-end font-medium">CA</th><th className="px-4 text-end font-medium">Retours</th></tr>
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
          <Card title="Dernières ventes manuelles">
            {d.recentManual.length === 0 ? <p className="text-sm text-ink-soft">Enregistrez ici les ventes faites en boutique à Boumerdès ou en message privé Instagram : le stock se met à jour.</p> : (
              <ul className="space-y-2 text-sm">
                {d.recentManual.map((o) => (
                  <li key={o.id} className="flex items-center justify-between gap-2">
                    <span>{o.name} · <span className="text-ink-soft">{CHANNEL_LABEL[o.channel]} · {date(o.created_at)}</span></span>
                    <span className="flex items-center gap-2"><b>{da(o.total)}</b><StatusBadge status={o.status} /></span>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </div>
      )}
      {open && <ManualSale onClose={() => setOpen(false)} />}
    </div>
  );
}

interface VariantOption {
  id: number;
  label: string;
  price: number;
  available: number;
}

function ManualSale({ onClose }: { onClose: () => void }) {
  const qc = useQueryClient();
  const toast = useToast();
  const stock = useQuery({ queryKey: ["stock", "all", ""], queryFn: () => api<{ rows: { id: number; name_fr: string; options: string; price: number; stock_on_hand: number; stock_reserved: number }[] }>("/stock?filter=all") });
  const variants: VariantOption[] = useMemo(
    () => (stock.data?.rows ?? []).map((r) => ({ id: r.id, label: `${r.name_fr} · ${r.options}`, price: r.price, available: r.stock_on_hand - r.stock_reserved })),
    [stock.data],
  );
  const [channel, setChannel] = useState<"boutique" | "instagram" | "whatsapp" | "telephone">("boutique");
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [lines, setLines] = useState<{ variantId: number; qty: number }[]>([]);
  const [pick, setPick] = useState("");
  const [wilaya, setWilaya] = useState(35);
  const [deliveryType, setDeliveryType] = useState<"domicile" | "bureau">("domicile");
  const [address, setAddress] = useState("");
  const [shipping, setShipping] = useState<number | null>(null);
  const wilayas = useQuery({ queryKey: ["wilayas-public"], queryFn: () => fetch("/api/geo/wilayas").then((r) => r.json() as Promise<{ code: number; fr: string; home: number | null; desk: number | null }[]>) });
  const boutique = channel === "boutique";
  const subtotal = lines.reduce((s, l) => s + (variants.find((v) => v.id === l.variantId)?.price ?? 0) * l.qty, 0);
  const w = wilayas.data?.find((x) => x.code === wilaya);
  const ship = boutique ? 0 : shipping ?? (deliveryType === "bureau" ? w?.desk : w?.home) ?? 0;

  const save = useMutation({
    mutationFn: () =>
      post("/sales/manual", {
        channel,
        name: name.trim(),
        phone,
        lines,
        status: boutique ? "livree" : "confirmee",
        wilaya: boutique ? 35 : wilaya,
        communeId: null,
        deliveryType: boutique ? "bureau" : deliveryType,
        address: !boutique && deliveryType === "domicile" ? address : undefined,
        shipping: boutique ? 0 : ship,
      }),
    onSuccess: () => {
      toast(boutique ? "Vente enregistrée, stock mis à jour ✓" : "Commande créée (confirmée) ✓");
      void qc.invalidateQueries();
      onClose();
    },
    onError: (e) => toast(errorMessage(e), "error"),
  });

  const valid = name.trim().length >= 2 && normalizeDzPhone(phone) && lines.length > 0 && (boutique || deliveryType === "bureau" || address.trim().length >= 4);

  return (
    <Sheet
      open
      onClose={onClose}
      title="Vente manuelle"
      footer={
        <div className="flex items-center justify-between gap-3">
          <span className="text-sm">Total : <b>{da(subtotal + ship)}</b></span>
          <Button variant="primary" disabled={!valid} loading={save.isPending} onClick={() => save.mutate()}>Enregistrer</Button>
        </div>
      }
    >
      <div className="space-y-4">
        <Pills value={channel} onChange={setChannel} options={(["boutique", "instagram", "whatsapp", "telephone"] as const).map((c) => ({ value: c, label: CHANNEL_LABEL[c]! }))} />
        <p className="text-xs text-ink-soft">{boutique ? "Vente en boutique : marquée « livrée », le stock est retiré immédiatement." : "Commande reçue par message/téléphone : créée « confirmée » et suivie comme les commandes du site."}</p>
        <div className="grid gap-3 sm:grid-cols-2">
          <TextField label="Nom de la cliente" value={name} onChange={(e) => setName(e.target.value)} />
          <TextField label="Téléphone" inputMode="tel" value={phone} onChange={(e) => setPhone(e.target.value)} error={phone && !normalizeDzPhone(phone) ? "Numéro invalide" : null} />
        </div>
        <Card title="Articles">
          <div className="flex gap-2">
            <select className={inputCls} value={pick} onChange={(e) => setPick(e.target.value)} aria-label="Choisir un article">
              <option value="">Choisir un article…</option>
              {variants.map((v) => (
                <option key={v.id} value={v.id} disabled={v.available <= 0}>{v.label} ({v.available} dispo)</option>
              ))}
            </select>
            <Button onClick={() => { const id = Number(pick); if (id && !lines.some((l) => l.variantId === id)) setLines([...lines, { variantId: id, qty: 1 }]); setPick(""); }}>Ajouter</Button>
          </div>
          {lines.length === 0 ? <Empty title="Aucun article" icon="🛍" /> : (
            <ul className="mt-3 space-y-2">
              {lines.map((l) => {
                const v = variants.find((x) => x.id === l.variantId);
                return (
                  <li key={l.variantId} className="flex items-center justify-between gap-2 text-sm">
                    <span className="min-w-0 truncate">{v?.label}</span>
                    <span className="flex items-center gap-2">
                      <input type="number" min={1} max={v?.available ?? 20} className={`${inputCls} h-9 w-16 text-center`} value={l.qty} onChange={(e) => setLines(lines.map((x) => (x.variantId === l.variantId ? { ...x, qty: Math.max(1, Number(e.target.value) || 1) } : x)))} aria-label="Quantité" />
                      <button type="button" onClick={() => setLines(lines.filter((x) => x.variantId !== l.variantId))} className="text-red-700" aria-label="Retirer">✕</button>
                    </span>
                  </li>
                );
              })}
            </ul>
          )}
        </Card>
        {!boutique && (
          <Card title="Livraison">
            <div className="grid gap-3 sm:grid-cols-2">
              <Select label="Wilaya" value={wilaya} onChange={(e) => { setWilaya(Number(e.target.value)); setShipping(null); }}>
                {wilayas.data?.map((x) => <option key={x.code} value={x.code}>{x.code} - {x.fr}</option>)}
              </Select>
              <Select label="Mode" value={deliveryType} onChange={(e) => { setDeliveryType(e.target.value as "domicile" | "bureau"); setShipping(null); }}>
                <option value="domicile">Domicile</option>
                <option value="bureau">Bureau (stop-desk)</option>
              </Select>
              {deliveryType === "domicile" && <TextField label="Adresse" value={address} onChange={(e) => setAddress(e.target.value)} className="sm:col-span-2" />}
              <TextField label="Frais de livraison (DA)" type="number" value={shipping ?? ship} onChange={(e) => setShipping(Number(e.target.value) || 0)} />
            </div>
          </Card>
        )}
      </div>
    </Sheet>
  );
}
