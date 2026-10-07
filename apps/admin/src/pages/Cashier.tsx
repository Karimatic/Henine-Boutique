import { normalizeDzPhone } from "@henine/shared";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { api, errorMessage, post } from "../api";
import { isAr, tr } from "../i18n";
import { da } from "../lib/format";
import { Button, Card, ErrorState, inputCls, ListSkeleton, SearchBox, Sheet, useToast } from "../ui";
import type { StockProduct, StockVariant } from "./Stock";
import { variantLabel } from "../lib/variants";

type Line = { variantId: number; qty: number; name: string; label: string; price: number; max: number };
type Channel = "boutique" | "telephone" | "whatsapp" | "instagram";

const CHANNELS: { value: Channel; label: string; hint: string }[] = [
  { value: "boutique", label: tr("🏪 Au magasin"), hint: tr("La cliente est là : la vente est terminée tout de suite, le stock baisse.") },
  { value: "telephone", label: tr("📞 Téléphone"), hint: tr("Commande à livrer : elle rejoint les commandes du site, déjà confirmée.") },
  { value: "whatsapp", label: tr("💬 WhatsApp"), hint: tr("Commande à livrer : elle rejoint les commandes du site, déjà confirmée.") },
  { value: "instagram", label: tr("📸 Instagram"), hint: tr("Commande à livrer : elle rejoint les commandes du site, déjà confirmée.") },
];

/**
 * One screen for every sale made outside the website: in the shop, by phone, WhatsApp or
 * Instagram. Tap a piece, its size, then save: the stock is shared with the website, so the
 * last piece sold here is no longer offered online.
 */
export function SaleDesk() {
  const qc = useQueryClient();
  const toast = useToast();
  const [channel, setChannel] = useState<Channel>("boutique");
  const [q, setQ] = useState("");
  const list = useQuery({ queryKey: ["stock-products", "cashier"], queryFn: () => api<{ products: StockProduct[] }>("/stock/products?filter=all") });
  const wilayas = useQuery({
    queryKey: ["wilayas-public"],
    queryFn: () => fetch("/api/geo/wilayas").then((r) => r.json() as Promise<{ code: number; fr: string; ar: string; home: number | null; desk: number | null }[]>),
    enabled: channel !== "boutique",
  });
  const [open, setOpen] = useState<StockProduct | null>(null);
  const [lines, setLines] = useState<Line[]>([]);
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [wilaya, setWilaya] = useState(35);
  const [deliveryType, setDeliveryType] = useState<"domicile" | "bureau">("domicile");
  const [address, setAddress] = useState("");
  const [shipping, setShipping] = useState<number | null>(null);
  const inShop = channel === "boutique";
  const products = useMemo(
    () => (list.data?.products ?? []).filter((p) => p.status !== "archived" && `${p.name} ${p.nameAr}`.toLowerCase().includes(q.trim().toLowerCase())),
    [list.data, q],
  );
  const w = wilayas.data?.find((x) => x.code === wilaya);
  const ship = inShop ? 0 : (shipping ?? (deliveryType === "bureau" ? w?.desk : w?.home) ?? 0);
  const subtotal = lines.reduce((s, l) => s + l.price * l.qty, 0);
  const phoneOk = inShop ? !phone.trim() || !!normalizeDzPhone(phone) : !!normalizeDzPhone(phone);
  const valid = lines.length > 0 && phoneOk && (inShop || (name.trim().length >= 2 && (deliveryType === "bureau" || address.trim().length >= 4)));

  const save = useMutation({
    mutationFn: () =>
      post<{ code: string; total: number }>("/sales/manual", {
        channel,
        status: inShop ? "livree" : "confirmee",
        name: name.trim() || undefined,
        phone: phone.trim() ? normalizeDzPhone(phone) : undefined,
        lines: lines.map((l) => ({ variantId: l.variantId, qty: l.qty })),
        ...(inShop
          ? {}
          : { wilaya, communeId: null, deliveryType, address: deliveryType === "domicile" ? address : undefined, shipping: ship }),
      }),
    onSuccess: (r) => {
      toast(inShop ? tr("Vente {0} enregistrée · {1} · stock du site mis à jour ✓", { 0: r.code, 1: da(r.total) }) : tr("Commande {0} créée (confirmée) · {1} ✓", { 0: r.code, 1: da(r.total) }));
      setLines([]);
      setName("");
      setPhone("");
      setAddress("");
      setShipping(null);
      void qc.invalidateQueries();
    },
    onError: (e) => toast(errorMessage(e), "error"),
  });

  function add(p: StockProduct, v: StockVariant) {
    const max = Math.max(0, v.onHand - v.reserved);
    setLines((ls) => {
      const cur = ls.find((l) => l.variantId === v.id);
      if (cur) return ls.map((l) => (l.variantId === v.id ? { ...l, qty: Math.min(max, l.qty + 1) } : l));
      return [...ls, { variantId: v.id, qty: 1, name: isAr ? p.nameAr || p.name : p.name, label: variantLabel(p, v), price: p.price, max }];
    });
    setOpen(null);
  }

  return (
    <div>
      {/* where the sale comes from */}
      <div className="mb-2 grid grid-cols-2 gap-2 sm:grid-cols-4">
        {CHANNELS.map((c) => (
          <button
            key={c.value}
            type="button"
            aria-pressed={channel === c.value}
            onClick={() => setChannel(c.value)}
            className={`h-12 rounded-xl border text-sm font-semibold transition ${channel === c.value ? "border-plum-600 bg-plum-600 text-white" : "border-line bg-surface hover:border-plum-600/40"}`}
          >
            {c.label}
          </button>
        ))}
      </div>
      <p className="mb-4 text-sm text-ink-soft">{CHANNELS.find((c) => c.value === channel)!.hint}</p>

      <div className="grid gap-4 lg:grid-cols-[1fr_24rem]">
        <div>
          <SearchBox value={q} onChange={setQ} placeholder={tr("Chercher un article…")} />
          {list.error ? <ErrorState error={list.error} onRetry={list.refetch} /> : !list.data ? <ListSkeleton /> : (
            <ul className="grid grid-cols-2 gap-2 sm:grid-cols-3 xl:grid-cols-4">
              {products.map((p) => {
                const left = p.variants.filter((v) => v.active).reduce((s, v) => s + Math.max(0, v.onHand - v.reserved), 0);
                return (
                  <li key={p.id}>
                    <button
                      type="button"
                      disabled={left === 0}
                      onClick={() => setOpen(p)}
                      className="w-full overflow-hidden rounded-xl border border-line bg-surface text-start transition hover:border-plum-600/40 disabled:opacity-45"
                    >
                      {p.image ? <img src={p.image} alt="" className="aspect-[4/5] w-full object-cover" /> : <span className="grid aspect-[4/5] w-full place-items-center bg-rose-100 text-4xl">👗</span>}
                      <span className="block p-2">
                        <span className="line-clamp-1 text-sm font-semibold">{isAr ? p.nameAr || p.name : p.name}</span>
                        <span className="flex justify-between text-xs">
                          <b className="tabular-nums">{da(p.price)}</b>
                          <span className={left ? "text-ink-soft" : "text-red-700"}>{left ? tr("{0} en stock", { 0: left }) : tr("Épuisé")}</span>
                        </span>
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>

        <Card title={tr("🧾 Ticket")} className="lg:sticky lg:top-20 lg:self-start">
          {lines.length === 0 ? (
            <p className="text-sm text-ink-soft">{tr("Touchez un article pour l'ajouter.")}</p>
          ) : (
            <ul className="divide-y divide-line">
              {lines.map((l) => (
                <li key={l.variantId} className="flex items-center gap-2 py-2 text-sm">
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-medium">{l.name}</span>
                    <span className="text-xs text-ink-soft">{l.label} · {da(l.price)}</span>
                  </span>
                  <button type="button" className="grid size-8 place-items-center rounded-lg border border-line" onClick={() => setLines((ls) => ls.flatMap((x) => (x.variantId === l.variantId ? (x.qty > 1 ? [{ ...x, qty: x.qty - 1 }] : []) : [x])))} aria-label="−">−</button>
                  <span className="w-6 text-center font-semibold tabular-nums">{l.qty}</span>
                  <button type="button" className="grid size-8 place-items-center rounded-lg border border-line disabled:opacity-40" disabled={l.qty >= l.max} onClick={() => setLines((ls) => ls.map((x) => (x.variantId === l.variantId ? { ...x, qty: x.qty + 1 } : x)))} aria-label="+">+</button>
                </li>
              ))}
            </ul>
          )}
          <div className="mt-3 space-y-2 border-t border-line pt-3">
            <input className={`${inputCls} h-10`} placeholder={inShop ? tr("Nom de la cliente (facultatif)") : tr("Nom de la cliente")} value={name} onChange={(e) => setName(e.target.value)} />
            <input className={`${inputCls} h-10`} inputMode="tel" placeholder={inShop ? tr("Téléphone (facultatif, pour sa fidélité)") : tr("Téléphone")} value={phone} onChange={(e) => setPhone(e.target.value)} />
            {phone.trim() && !normalizeDzPhone(phone) && <p className="text-xs text-red-700">{tr("Numéro invalide")}</p>}
            {!inShop && (
              <>
                <select className={`${inputCls} h-10`} value={wilaya} onChange={(e) => { setWilaya(Number(e.target.value)); setShipping(null); }} aria-label={tr("Wilaya")}>
                  {wilayas.data?.map((x) => <option key={x.code} value={x.code}>{x.code} - {x.fr}</option>)}
                </select>
                <div className="grid grid-cols-2 gap-2">
                  {(["domicile", "bureau"] as const).map((t) => (
                    <button
                      key={t}
                      type="button"
                      aria-pressed={deliveryType === t}
                      onClick={() => { setDeliveryType(t); setShipping(null); }}
                      className={`h-10 rounded-lg border text-sm font-medium ${deliveryType === t ? "border-plum-600 bg-plum-600/10 text-plum-700" : "border-line"}`}
                    >
                      {t === "domicile" ? tr("🏠 Domicile") : tr("🏢 Bureau (stop-desk)")}
                    </button>
                  ))}
                </div>
                {deliveryType === "domicile" && <input className={`${inputCls} h-10`} placeholder={tr("Adresse")} value={address} onChange={(e) => setAddress(e.target.value)} />}
                <label className="flex items-center justify-between gap-2 text-sm">
                  {tr("Livraison")}
                  <input className={`${inputCls} h-10 w-32 text-end`} type="number" min={0} value={shipping ?? ship} onChange={(e) => setShipping(Number(e.target.value) || 0)} aria-label={tr("Frais de livraison (DA)")} />
                </label>
              </>
            )}
            <p className="flex items-baseline justify-between pt-1 text-lg">
              <span>{tr("Total")}</span>
              <b className="tabular-nums">{da(subtotal + ship)}</b>
            </p>
            <Button variant="primary" className="w-full" disabled={!valid} loading={save.isPending} onClick={() => save.mutate()}>
              {inShop ? tr("✅ Encaisser") : tr("✅ Créer la commande")}
            </Button>
          </div>
        </Card>
      </div>

      {open && (
        <Sheet open onClose={() => setOpen(null)} title={isAr ? open.nameAr || open.name : open.name}>
          <ul className="grid grid-cols-2 gap-2 sm:grid-cols-3">
            {open.variants.filter((v) => v.active).map((v) => {
              const left = Math.max(0, v.onHand - v.reserved);
              return (
                <li key={v.id}>
                  <button
                    type="button"
                    disabled={left === 0}
                    onClick={() => add(open, v)}
                    className="w-full rounded-xl border border-line bg-surface p-3 text-start disabled:opacity-40"
                  >
                    <span className="block font-semibold">{variantLabel(open, v) || tr("Article")}</span>
                    <span className={`text-xs ${left ? "text-ink-soft" : "text-red-700"}`}>{left ? tr("{0} en stock", { 0: left }) : tr("Épuisé")}</span>
                  </button>
                </li>
              );
            })}
          </ul>
        </Sheet>
      )}
    </div>
  );
}

/** The old Caisse address opens the sale screen in Ventes. */
export function CashierPage() {
  const navigate = useNavigate();
  useEffect(() => void navigate({ to: "/ventes", replace: true }), [navigate]);
  return null;
}
