import { normalizeDzPhone } from "@henine/shared";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { api, errorMessage, post } from "../api";
import { tr } from "../i18n";
import { da } from "../lib/format";
import { Button, Card, ErrorState, inputCls, ListSkeleton, PageHeader, SearchBox, Sheet, useToast } from "../ui";
import type { StockProduct, StockVariant } from "./Stock";
import { variantLabel } from "../lib/variants";

type Line = { variantId: number; qty: number; name: string; label: string; price: number; max: number };



/**
 * Caisse boutique: sell in the shop from the same stock as the website. Tap a piece, its
 * size, then "Encaisser": the stock drops at once and the website shows it straight away.
 */
export function CashierPage() {
  const qc = useQueryClient();
  const toast = useToast();
  const [q, setQ] = useState("");
  const list = useQuery({ queryKey: ["stock-products", "cashier"], queryFn: () => api<{ products: StockProduct[] }>("/stock/products?filter=all") });
  const [open, setOpen] = useState<StockProduct | null>(null);
  const [lines, setLines] = useState<Line[]>([]);
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const products = useMemo(
    () => (list.data?.products ?? []).filter((p) => p.status !== "archived" && `${p.name} ${p.nameAr}`.toLowerCase().includes(q.trim().toLowerCase())),
    [list.data, q],
  );
  const total = lines.reduce((s, l) => s + l.price * l.qty, 0);
  const phoneOk = !phone.trim() || !!normalizeDzPhone(phone);

  const sell = useMutation({
    mutationFn: () =>
      post<{ code: string; total: number }>("/sales/manual", {
        channel: "boutique",
        status: "livree",
        name: name.trim() || undefined,
        phone: phone.trim() ? normalizeDzPhone(phone) : undefined,
        lines: lines.map((l) => ({ variantId: l.variantId, qty: l.qty })),
      }),
    onSuccess: (r) => {
      toast(tr("Vente {0} enregistrée · {1} · stock du site mis à jour ✓", { 0: r.code, 1: da(r.total) }));
      setLines([]);
      setName("");
      setPhone("");
      void qc.invalidateQueries();
    },
    onError: (e) => toast(errorMessage(e), "error"),
  });

  function add(p: StockProduct, v: StockVariant) {
    const max = Math.max(0, v.onHand - v.reserved);
    setLines((ls) => {
      const cur = ls.find((l) => l.variantId === v.id);
      if (cur) return ls.map((l) => (l.variantId === v.id ? { ...l, qty: Math.min(max, l.qty + 1) } : l));
      return [...ls, { variantId: v.id, qty: 1, name: p.name, label: variantLabel(p, v), price: p.price, max }];
    });
    setOpen(null);
  }

  return (
    <div>
      <PageHeader
        group={tr("Catalogue")}
        title={tr("Caisse boutique")}
        subtitle={tr("Vente au magasin, même stock que le site : si la dernière pièce part ici, elle n'est plus proposée en ligne.")}
      />
      <div className="grid gap-4 lg:grid-cols-[1fr_22rem]">
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
                        <span className="line-clamp-1 text-sm font-semibold">{p.name}</span>
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
            <input className={`${inputCls} h-10`} placeholder={tr("Nom de la cliente (facultatif)")} value={name} onChange={(e) => setName(e.target.value)} />
            <input className={`${inputCls} h-10`} inputMode="tel" placeholder={tr("Téléphone (facultatif, pour sa fidélité)")} value={phone} onChange={(e) => setPhone(e.target.value)} />
            {!phoneOk && <p className="text-xs text-red-700">{tr("Numéro invalide")}</p>}
            <p className="flex items-baseline justify-between pt-1 text-lg">
              <span>{tr("Total")}</span>
              <b className="tabular-nums">{da(total)}</b>
            </p>
            <p className="text-xs text-ink-soft">{tr("Le total exact (promo, vente flash) est calculé à l'encaissement.")}</p>
            <Button variant="primary" className="w-full" disabled={!lines.length || !phoneOk} loading={sell.isPending} onClick={() => sell.mutate()}>
              {tr("✅ Encaisser")}
            </Button>
          </div>
        </Card>
      </div>

      {open && (
        <Sheet open onClose={() => setOpen(null)} title={open.name}>
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
