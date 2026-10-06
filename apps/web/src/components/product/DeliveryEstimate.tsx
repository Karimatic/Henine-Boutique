import { useEffect, useState } from "react";
import { dateLocale, formatDA, type WilayaDTO } from "@henine/shared";
import { WhatsAppIcon } from "@/components/layout/FloatingHelp";
import { useApi } from "@/lib/api";
import { useLocale } from "@/lib/locale";
import { useSite, whatsappLink } from "@/lib/site";
import { checkoutMemory } from "@/lib/stores";

const KEY = "henine.wilaya.v1";

/** Today + n delivery days, skipping Fridays (no deliveries). */
function addDeliveryDays(n: number): Date {
  const d = new Date();
  let left = n;
  while (left > 0) {
    d.setDate(d.getDate() + 1);
    if (d.getDay() !== 5) left--;
  }
  return d;
}

/**
 * "Livraison estimée : entre le jeu. 9 et le sam. 11 oct." for the customer's wilaya (the one
 * she ordered with before, or picked here), with the delivery prices. Delays from Admin → Contenu.
 */
export function DeliveryEstimate() {
  const { t, ar, locale } = useLocale();
  const D = t.plus.delivery;
  const wilayas = useApi<WilayaDTO[]>("/geo/wilayas");
  const [code, setCode] = useState<number | null>(null);
  useEffect(() => {
    let saved: number | null = null;
    try {
      saved = Number(localStorage.getItem(KEY)) || null;
    } catch {
      /* private mode */
    }
    setCode(saved ?? checkoutMemory.get()?.wilaya ?? null);
  }, []);
  const w = wilayas.data?.find((x) => x.code === code);
  const [min, max] = (w?.delay ?? "").split("-").map((n) => Number(n.trim()));
  const fmt = (d: Date) => d.toLocaleDateString(dateLocale(locale), { weekday: "short", day: "numeric", month: "short" });

  return (
    <section className="rounded-2xl border border-line bg-surface p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="flex items-center gap-2 font-semibold">
          <span aria-hidden="true">🚚</span> {D.title}
        </h2>
        <span className="relative">
        <select
          className="h-10 max-w-[13rem] appearance-none rounded-xl border border-line bg-ivory pe-9 ps-3 text-sm"
          value={code ?? ""}
          aria-label={D.choose}
          onChange={(e) => {
            const v = Number(e.target.value) || null;
            setCode(v);
            try {
              if (v) localStorage.setItem(KEY, String(v));
            } catch {
              /* private mode */
            }
          }}
        >
          <option value="">{D.choose}</option>
          {(wilayas.data ?? []).map((x) => (
            <option key={x.code} value={x.code}>
              {String(x.code).padStart(2, "0")} · {ar ? x.ar : x.fr}
            </option>
          ))}
        </select>
          <span aria-hidden="true" className="pointer-events-none absolute end-3 top-1/2 -translate-y-1/2 text-ink-soft">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="m6 9 6 6 6-6" /></svg>
          </span>
        </span>
      </div>
      {w &&
        (w.home == null && w.desk == null ? (
          <p className="mt-3 text-sm text-ink-soft">{D.unavailable}</p>
        ) : (
          <div className="mt-3 space-y-1.5 text-sm">
            {Number.isFinite(min) && (
              <p className="font-semibold text-success">
                {D.between(fmt(addDeliveryDays(min!)), fmt(addDeliveryDays(Number.isFinite(max) ? max! : min!)))}
              </p>
            )}
            <p className="flex flex-wrap gap-x-4 gap-y-1 text-ink-soft">
              {w.home != null && (
                <span>
                  🏠 {D.home} · <b dir="ltr">{formatDA(w.home, locale)}</b>
                </span>
              )}
              {w.desk != null && (
                <span>
                  🏢 {D.desk} · <b dir="ltr">{formatDA(w.desk, locale)}</b>
                </span>
              )}
            </p>
          </div>
        ))}
    </section>
  );
}

/** "Une question ? Demandez sur WhatsApp" with the product's name and link already written. */
export function AskWhatsApp({ name }: { name: string }) {
  const { t } = useLocale();
  const site = useSite();
  const [url, setUrl] = useState("");
  useEffect(() => setUrl(location.href.split("?")[0]!), []);
  const link = whatsappLink(site.data?.contact.whatsapp, t.plus.whatsapp.askProduct(name, url));
  if (!link) return null;
  return (
    <a
      href={link}
      target="_blank"
      rel="noopener noreferrer"
      className="flex h-12 items-center justify-center gap-2 rounded-full border-2 border-[#25D366] font-semibold text-[#128C7E] transition hover:bg-[#25D366]/10"
    >
      <WhatsAppIcon size={20} /> {t.plus.whatsapp.ask}
    </a>
  );
}
