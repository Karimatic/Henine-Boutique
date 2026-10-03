import { formatDzPhone } from "@henine/shared";
import { useQuery } from "@tanstack/react-query";
import { useSearch } from "@tanstack/react-router";
import { Download } from "lucide-react";
import { useEffect } from "react";
import { api } from "../api";
import { Blossom } from "../brand";
import { da, date } from "../lib/format";
import { ErrorState, ListSkeleton } from "../ui";
import { tr } from "../i18n";

/**
 * Invoice of one order (A4), labels in French and Arabic. "Télécharger en PDF" opens the
 * print dialog: choose "Enregistrer au format PDF" (the file is named after the order).
 */

interface InvoiceOrder {
  id: number;
  public_code: string;
  created_at: number;
  name: string;
  phone: string;
  wilaya_code: number;
  wilaya_fr: string | null;
  wilaya_ar: string | null;
  commune_fr: string | null;
  address: string | null;
  delivery_type: "domicile" | "bureau";
  subtotal: number;
  discount_total: number;
  shipping_price: number;
  total: number;
  coupon_code: string | null;
  items: { name_fr: string; name_ar: string; options_label: string | null; sku: string | null; qty: number; unit_price: number }[];
}

export function InvoicePage() {
  const search = useSearch({ strict: false }) as { id?: string | number };
  const id = Number(search.id ?? 0);
  const q = useQuery({
    queryKey: ["invoice", id],
    queryFn: () => api<{ store: { name: string; phone: string | null; address: string | null }; slips: InvoiceOrder[] }>(`/order-slips?ids=${id}`),
    enabled: id > 0,
  });
  const o = q.data?.slips[0];
  useEffect(() => {
    if (o) document.title = `Facture ${o.public_code} · Henine Boutique`;
  }, [o]);

  return (
    <div className="min-h-dvh bg-ivory-deep/50 print:bg-surface">
      <div className="sticky top-0 z-10 flex items-center justify-between gap-3 border-b border-line bg-surface px-4 py-3 print:hidden">
        <p className="text-sm text-ink-soft">{tr("Dans la fenêtre qui s'ouvre, choisissez « Enregistrer au format PDF ».")}</p>
        <div className="flex gap-2">
          <button type="button" onClick={() => history.back()} className="h-9 rounded-lg border border-line px-3.5 text-sm font-semibold">
            {tr("Retour")}
          </button>
          <button type="button" onClick={() => window.print()} disabled={!o} className="inline-flex h-9 items-center gap-2 rounded-lg bg-plum-600 px-3.5 text-sm font-semibold text-white disabled:opacity-50">
            <Download className="size-4" /> {tr("Télécharger la facture PDF")}
          </button>
        </div>
      </div>
      {q.error ? (
        <div className="p-6"><ErrorState error={q.error} onRetry={q.refetch} /></div>
      ) : !q.data ? (
        <div className="p-6"><ListSkeleton rows={4} /></div>
      ) : !o ? (
        <p className="p-6">{tr("Commande introuvable.")}</p>
      ) : (
        <article className="mx-auto my-6 max-w-[210mm] bg-surface p-[14mm] text-[13px] leading-relaxed text-ink shadow-sm print:my-0 print:shadow-none" dir="ltr">
          <header className="flex items-start justify-between gap-6 border-b-2 border-plum-600 pb-5">
            <div className="flex items-center gap-3">
              <Blossom className="size-11" />
              <div>
                <p className="text-2xl font-bold uppercase tracking-[0.18em] text-plum-700">Henine Boutique</p>
                <p className="text-xs text-ink-soft">
                  {q.data.store.address ?? "Boumerdès"}{q.data.store.phone ? ` · ${formatDzPhone(q.data.store.phone)}` : ""}
                </p>
              </div>
            </div>
            <div className="text-end">
              <p className="text-xl font-semibold">Facture <span className="font-normal text-ink-soft">· فاتورة</span></p>
              <p className="font-mono text-base font-bold">Order #{o.public_code}</p>
              <p className="text-xs text-ink-soft">{date(o.created_at)}</p>
            </div>
          </header>

          <section className="mt-6 grid grid-cols-2 gap-6">
            <div className="rounded-xl bg-ivory-deep p-4">
              <p className="mb-1 text-xs font-semibold uppercase tracking-[0.12em] text-ink-soft">Client · الزبون</p>
              <p className="text-base font-semibold">{o.name}</p>
              <p>Téléphone · الهاتف : <b dir="ltr">{formatDzPhone(o.phone)}</b></p>
            </div>
            <div className="rounded-xl bg-ivory-deep p-4">
              <p className="mb-1 text-xs font-semibold uppercase tracking-[0.12em] text-ink-soft">Adresse · العنوان</p>
              <p>{o.address ?? "—"}</p>
              <p>
                {o.commune_fr ? `${o.commune_fr}, ` : ""}
                {String(o.wilaya_code).padStart(2, "0")} {o.wilaya_fr} {o.wilaya_ar ? `· ${o.wilaya_ar}` : ""}
              </p>
              <p className="text-xs text-ink-soft">{o.delivery_type === "bureau" ? "Livraison au bureau · التوصيل إلى المكتب" : "Livraison à domicile · التوصيل إلى المنزل"}</p>
            </div>
          </section>

          <table className="mt-6 w-full border-collapse">
            <thead>
              <tr className="border-b border-ink/20 text-start text-xs uppercase tracking-[0.1em] text-ink-soft">
                <th className="py-2 text-start font-semibold">Produit · المنتج</th>
                <th className="py-2 text-center font-semibold">Qté · الكمية</th>
                <th className="py-2 text-end font-semibold">Prix · السعر</th>
                <th className="py-2 text-end font-semibold">Total</th>
              </tr>
            </thead>
            <tbody>
              {o.items.map((it, i) => (
                <tr key={i} className="border-b border-line align-top">
                  <td className="py-2.5">
                    <p className="font-medium">{it.name_fr}</p>
                    <p className="text-xs text-ink-soft" dir="rtl">{it.name_ar}</p>
                    {(it.options_label || it.sku) && <p className="text-xs text-ink-soft">{[it.options_label, it.sku].filter(Boolean).join(" · ")}</p>}
                  </td>
                  <td className="py-2.5 text-center tabular-nums">{it.qty}</td>
                  <td className="py-2.5 text-end tabular-nums">{da(it.unit_price)}</td>
                  <td className="py-2.5 text-end font-medium tabular-nums">{da(it.unit_price * it.qty)}</td>
                </tr>
              ))}
            </tbody>
          </table>

          <section className="ms-auto mt-5 w-72 space-y-1.5 tabular-nums">
            <p className="flex justify-between"><span>Subtotal · المجموع</span><span>{da(o.subtotal)}</span></p>
            <p className="flex justify-between"><span>Delivery · التوصيل</span><span>{o.shipping_price ? da(o.shipping_price) : "Offerte · مجاني"}</span></p>
            {o.discount_total > 0 && (
              <p className="flex justify-between text-plum-700">
                <span>Discount · التخفيض{o.coupon_code ? ` (${o.coupon_code})` : ""}</span>
                <span>-{da(o.discount_total)}</span>
              </p>
            )}
            <p className="mt-2 flex justify-between border-t-2 border-ink pt-2 text-lg font-bold">
              <span>TOTAL · المبلغ الإجمالي</span>
              <span>{da(o.total)}</span>
            </p>
          </section>

          <footer className="mt-10 border-t border-line pt-4 text-center text-xs text-ink-soft">
            <p>Paiement à la livraison · الدفع عند الاستلام</p>
            <p>Merci pour votre confiance 🌸 شكرًا على ثقتك</p>
          </footer>
        </article>
      )}
    </div>
  );
}
