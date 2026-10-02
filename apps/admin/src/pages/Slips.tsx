import { formatDzPhone } from "@henine/shared";
import { useQuery } from "@tanstack/react-query";
import { useSearch } from "@tanstack/react-router";
import { Printer } from "lucide-react";
import { useEffect } from "react";
import { api } from "../api";
import { Blossom } from "../brand";
import { da, date } from "../lib/format";
import { ErrorState, ListSkeleton } from "../ui";
import { tr } from "../i18n";

/**
 * Packing slips, two per A4 sheet: who to deliver to, what's in the parcel and the exact
 * amount the courier collects. Opened from the orders list (several) or an order (one);
 * the print dialog opens by itself.
 */

interface Slip {
  id: number;
  public_code: string;
  created_at: number;
  name: string;
  phone: string;
  wilaya_code: number;
  wilaya_fr: string | null;
  wilaya_ar: string | null;
  commune_fr: string | null;
  commune_ar: string | null;
  address: string | null;
  delivery_type: "domicile" | "bureau";
  subtotal: number;
  discount_total: number;
  shipping_price: number;
  total: number;
  customer_note: string | null;
  tracking_number: string | null;
  items: { name_fr: string; name_ar: string; options_label: string | null; sku: string | null; qty: number; unit_price: number }[];
}

interface SlipsData {
  store: { name: string; phone: string | null; address: string | null };
  slips: Slip[];
}

export function SlipsPage() {
  const search = useSearch({ strict: false }) as { ids?: string | number };
  const ids = String(search.ids ?? "");
  const q = useQuery({ queryKey: ["slips", ids], queryFn: () => api<SlipsData>(`/order-slips?ids=${encodeURIComponent(ids)}`), enabled: !!ids });
  useEffect(() => {
    if (!q.data?.slips.length) return;
    const t = setTimeout(() => window.print(), 400);
    return () => clearTimeout(t);
  }, [q.data]);

  return (
    <div className="slips min-h-dvh bg-ivory-deep/50 print:bg-white">
      <div className="sticky top-0 z-10 flex items-center justify-between gap-3 border-b border-line bg-white px-4 py-3 print:hidden">
        <p className="text-sm">
          <b>{q.data?.slips.length ?? 0}</b> {tr("bordereau(x) · 2 par feuille A4")}
        </p>
        <div className="flex gap-2">
          <button type="button" onClick={() => history.back()} className="h-9 rounded-lg border border-line px-3.5 text-sm font-semibold">
            {tr("Retour")}
          </button>
          <button type="button" onClick={() => window.print()} className="inline-flex h-9 items-center gap-2 rounded-lg bg-plum-600 px-3.5 text-sm font-semibold text-white">
            <Printer className="size-4" /> {tr("Imprimer")}
          </button>
        </div>
      </div>
      {q.error ? (
        <div className="p-6"><ErrorState error={q.error} onRetry={q.refetch} /></div>
      ) : !q.data ? (
        <div className="p-6"><ListSkeleton rows={3} /></div>
      ) : (
        <div className="mx-auto max-w-[210mm] py-6 print:max-w-none print:py-0">
          {q.data.slips.map((s) => (
            <SlipCard key={s.id} s={s} store={q.data.store} />
          ))}
        </div>
      )}
    </div>
  );
}

function SlipCard({ s, store }: { s: Slip; store: SlipsData["store"] }) {
  const units = s.items.reduce((n, i) => n + i.qty, 0);
  return (
    <section className="slip mb-6 border border-dashed border-ink/40 bg-white p-5 text-[12.5px] leading-snug text-ink print:mb-0">
      <header className="flex items-start justify-between gap-4 border-b border-ink/20 pb-3">
        <div className="flex items-center gap-2">
          <Blossom size={26} />
          <div>
            <p className="font-display text-lg italic font-bold text-plum-700">{store.name}</p>
            <p className="text-[11px] text-ink-soft">
              {[store.address, store.phone ? formatDzPhone(store.phone) : null].filter(Boolean).join(" · ")}
            </p>
          </div>
        </div>
        <div className="text-end">
          <p className="font-mono text-xl font-bold tracking-wider">{s.public_code}</p>
          <p className="text-[11px] text-ink-soft">{tr("Commande du")} {date(s.created_at)}{s.tracking_number ? tr(" · Suivi {0}", { 0: s.tracking_number }) : ""}</p>
        </div>
      </header>

      <div className="mt-3 grid grid-cols-[1.4fr_1fr] gap-4">
        <div>
          <p className="text-[10px] font-semibold uppercase tracking-widest text-ink-soft">{tr("Destinataire")}</p>
          <p className="mt-0.5 text-base font-bold">{s.name}</p>
          <p className="font-mono text-base font-semibold" dir="ltr">{formatDzPhone(s.phone)}</p>
          <p className="mt-1">
            <b>{s.wilaya_code} - {s.wilaya_fr}</b>
            {s.wilaya_ar ? <span dir="rtl"> · {s.wilaya_ar}</span> : null}
          </p>
          {s.commune_fr && (
            <p>
              {s.commune_fr}
              {s.commune_ar && s.commune_ar !== s.commune_fr ? <span dir="rtl"> · {s.commune_ar}</span> : null}
            </p>
          )}
          {s.address && <p className="mt-0.5">{s.address}</p>}
        </div>
        <div className="space-y-2">
          <p className={`rounded-md px-2 py-1 text-center font-bold ${s.delivery_type === "bureau" ? "bg-ink text-white" : "border border-ink"}`}>
            {s.delivery_type === "bureau" ? tr("STOP-DESK (bureau)") : tr("À DOMICILE")}
          </p>
          <div className="rounded-md border-2 border-ink p-2 text-center">
            <p className="text-[10px] font-semibold uppercase tracking-widest">{tr("Montant à encaisser")}</p>
            <p className="text-2xl font-extrabold tabular-nums">{da(s.total)}</p>
          </div>
        </div>
      </div>

      <table className="mt-3 w-full border-collapse">
        <thead>
          <tr className="border-y border-ink/30 text-[10px] uppercase tracking-wider text-ink-soft">
            <th className="py-1 text-start font-semibold">{tr("Article")}</th>
            <th className="py-1 text-start font-semibold">{tr("Taille / couleur")}</th>
            <th className="py-1 text-center font-semibold">{tr("Qté")}</th>
            <th className="py-1 text-end font-semibold">{tr("Prix")}</th>
          </tr>
        </thead>
        <tbody>
          {s.items.map((i, k) => (
            <tr key={k} className="border-b border-ink/10">
              <td className="py-1 pe-2">
                <span className="me-1.5 inline-block size-3 border border-ink align-middle" aria-hidden="true" />
                {i.name_fr}
                {i.sku ? <span className="ms-1 font-mono text-[10px] text-ink-soft">{i.sku}</span> : null}
              </td>
              <td className="py-1 pe-2">{i.options_label ?? "—"}</td>
              <td className="py-1 text-center font-bold">{i.qty}</td>
              <td className="py-1 text-end tabular-nums">{da(i.unit_price * i.qty)}</td>
            </tr>
          ))}
        </tbody>
      </table>

      <div className="mt-2 flex items-end justify-between gap-4">
        <div className="min-w-0 text-[11px]">
          <p><b>{units}</b> {tr("pièce(s) dans le colis")}</p>
          {s.customer_note && <p className="mt-1 rounded bg-ivory-deep px-2 py-1">📝 {s.customer_note}</p>}
        </div>
        <dl className="grid shrink-0 grid-cols-[auto_auto] gap-x-4 text-end tabular-nums">
          <dt className="text-ink-soft">{tr("Sous-total")}</dt><dd>{da(s.subtotal)}</dd>
          {s.discount_total > 0 && (<><dt className="text-ink-soft">{tr("Remise")}</dt><dd>−{da(s.discount_total)}</dd></>)}
          <dt className="text-ink-soft">{tr("Livraison")}</dt><dd>{s.shipping_price ? da(s.shipping_price) : tr("Offerte")}</dd>
          <dt className="font-bold">{tr("Total")}</dt><dd className="font-bold">{da(s.total)}</dd>
        </dl>
      </div>
      <p className="mt-3 border-t border-ink/20 pt-2 text-center text-[11px] text-ink-soft">
        {tr("Merci pour votre confiance 🌸")} <span dir="rtl">شكرا لثقتك</span> {tr("· Échange possible sous 48 h")}
      </p>
    </section>
  );
}
