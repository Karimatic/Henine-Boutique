import { useEffect, useState } from "react";
import { boutiqueStatus, DAY_NAMES, DEFAULT_BOUTIQUE, type BoutiqueDTO } from "@henine/shared";
import { WhatsAppIcon } from "@/components/layout/FloatingHelp";
import { PageTitle } from "@/components/ui/kit";
import { useLocale } from "@/lib/locale";
import { useSite, whatsappLink } from "@/lib/site";

/** "Ouvert maintenant · ferme à 20:00" / "Fermé · ouvre demain à 09:30", refreshed every minute. */
export function BoutiqueOpenBadge({ boutique, className = "" }: { boutique: BoutiqueDTO; className?: string }) {
  const { t, ar } = useLocale();
  const B = t.plus.boutique;
  const [now, setNow] = useState<number | null>(null);
  useEffect(() => {
    setNow(Date.now());
    const id = setInterval(() => setNow(Date.now()), 60_000);
    return () => clearInterval(id);
  }, []);
  if (now == null) return null;
  const s = boutiqueStatus(boutique.hours, now);
  const when = s.next ? (s.next.today ? B.today : s.next.tomorrow ? B.tomorrow : DAY_NAMES[ar ? "ar" : "fr"][s.next.day]!) : "";
  return (
    <span className={`inline-flex items-center gap-2 rounded-full px-3 py-1 text-sm font-semibold ${s.open ? "bg-emerald-100 text-emerald-800" : "bg-ivory-deep text-ink-soft"} ${className}`}>
      <span className={`size-2 rounded-full ${s.open ? "animate-pulse bg-emerald-500" : "bg-ink-soft/60"}`} aria-hidden="true" />
      {s.open ? B.openNow(s.closesAt!) : s.next ? `${B.closedNow} · ${B.opensAt(when, s.next.time)}` : B.closedNow}
    </span>
  );
}

/** /boutique: map, address, opening hours, open now or not, call / WhatsApp / directions. */
export function BoutiqueView() {
  const { t, ar } = useLocale();
  const B = t.plus.boutique;
  const site = useSite();
  const b = site.data?.boutique ?? DEFAULT_BOUTIQUE;
  const contact = site.data?.contact;
  const q = encodeURIComponent(b.mapQuery || b.addressFr);
  const wa = whatsappLink(contact?.whatsapp, t.plus.whatsapp.hello);
  // today's row (Algiers time), on the phone only: the page itself is built in advance
  const [today, setToday] = useState<number | null>(null);
  useEffect(() => setToday(new Date(Date.now() + 3600_000).getUTCDay()), []);
  const address = ar ? b.addressAr || b.addressFr : b.addressFr || b.addressAr;
  const note = ar ? b.noteAr || b.noteFr : b.noteFr || b.noteAr;
  // Saturday first: the Algerian week
  const order = [6, 0, 1, 2, 3, 4, 5];

  return (
    <div className="mx-auto max-w-5xl px-4 py-8">
      <PageTitle>📍 {B.title}</PageTitle>
      <div className="grid gap-6 md:grid-cols-[1.2fr_1fr]">
        <div className="overflow-hidden rounded-card border border-line bg-ivory-deep">
          <iframe
            title={B.title}
            src={`https://www.google.com/maps?q=${q}&output=embed`}
            className="aspect-[4/3] w-full md:aspect-auto md:h-full md:min-h-[24rem]"
            loading="lazy"
            referrerPolicy="no-referrer-when-downgrade"
          />
        </div>
        <div className="space-y-5">
          {site.data && <BoutiqueOpenBadge boutique={b} />}
          <section>
            <h2 className="mb-1 text-sm font-semibold uppercase tracking-[0.12em] text-ink-soft">{B.address}</h2>
            <p className="text-lg font-medium">{address}</p>
            {note && <p className="mt-1 text-sm text-ink-soft">{note}</p>}
          </section>
          <div className="flex flex-wrap gap-2">
            <a
              href={`https://www.google.com/maps/dir/?api=1&destination=${q}`}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex h-11 items-center rounded-full bg-plum-600 px-5 text-sm font-semibold text-white"
            >
              {B.directions}
            </a>
            {contact?.phone && (
              <a href={`tel:${contact.phone.replace(/\s/g, "")}`} className="inline-flex h-11 items-center rounded-full border border-line bg-surface px-5 text-sm font-semibold">
                {B.call}
              </a>
            )}
            {wa && (
              <a href={wa} target="_blank" rel="noopener noreferrer" className="inline-flex h-11 items-center gap-2 rounded-full bg-[#25D366] px-5 text-sm font-semibold text-white">
                <WhatsAppIcon size={18} /> {B.whatsapp}
              </a>
            )}
          </div>
          <section>
            <h2 className="mb-2 text-sm font-semibold uppercase tracking-[0.12em] text-ink-soft">{B.hours}</h2>
            <ul className="divide-y divide-line rounded-2xl border border-line bg-surface">
              {order.map((d) => {
                const h = b.hours[d];
                return (
                  <li key={d} className={`flex justify-between px-4 py-2.5 text-sm ${d === today ? "font-bold text-plum-700" : ""}`}>
                    <span>{DAY_NAMES[ar ? "ar" : "fr"][d]}</span>
                    <span dir="ltr" className="tabular-nums">{h ? `${h.open} – ${h.close}` : B.closed}</span>
                  </li>
                );
              })}
            </ul>
          </section>
          <p className="rounded-2xl bg-rose-100 p-4 text-sm text-plum-700">🏪 {B.sameStock}</p>
        </div>
      </div>
    </div>
  );
}
