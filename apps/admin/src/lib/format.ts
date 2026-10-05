import { formatDA, formatDzPhone, STATUS_LABELS, toE164, type OrderStatus } from "@henine/shared";
import { isAr, tr } from "../i18n";

const LOCALE = isAr ? "ar-DZ" : "fr-DZ";

export { formatDA, formatDzPhone };

/** Keeps "−3 600 DA" or "41 %" in one piece: Arabic (right-to-left) text would otherwise swap the digits, the sign and "DA". */
export const ltr = (s: string) => (isAr ? `⁦${s}⁩` : s);

export const da = (n: number | null | undefined) => (n == null ? "—" : ltr(formatDA(n)));

/** an amount taken off: "−500 DA" */
export const daMinus = (n: number | null | undefined) => (n == null ? "—" : ltr(`−${formatDA(n)}`));

export function dateTime(ts: number | null | undefined): string {
  if (!ts) return "—";
  return new Date(ts).toLocaleString(LOCALE, { timeZone: "Africa/Algiers", day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" });
}

export function date(ts: number | null | undefined): string {
  if (!ts) return "—";
  return new Date(ts).toLocaleDateString(LOCALE, { timeZone: "Africa/Algiers", day: "2-digit", month: "short", year: "numeric" });
}

export function ago(ts: number | null | undefined): string {
  if (!ts) return "—";
  const s = Math.round((Date.now() - ts) / 1000);
  if (s < 60) return tr("à l'instant");
  if (s < 3600) return tr("il y a {n} min", { n: Math.floor(s / 60) });
  if (s < 86400) return tr("il y a {n} h", { n: Math.floor(s / 3600) });
  if (s < 7 * 86400) return tr("il y a {n} j", { n: Math.floor(s / 86400) });
  return date(ts);
}

export const statusLabel = (s: string) => (isAr ? STATUS_LABELS[s as OrderStatus]?.ar : STATUS_LABELS[s as OrderStatus]?.fr) ?? s;

export const STATUS_TONE: Record<string, string> = {
  nouvelle: "bg-blue-100 text-blue-800",
  injoignable: "bg-amber-100 text-amber-800",
  confirmee: "bg-emerald-100 text-emerald-800",
  en_preparation: "bg-violet-100 text-violet-800",
  expediee: "bg-sky-100 text-sky-800",
  en_livraison: "bg-sky-100 text-sky-800",
  livree: "bg-green-100 text-green-800",
  retour: "bg-orange-100 text-orange-800",
  retour_recu: "bg-orange-100 text-orange-800",
  annulee: "bg-stone-200 text-stone-700",
  doublon: "bg-stone-200 text-stone-700",
  fausse: "bg-red-100 text-red-800",
};

export const CHANNEL_LABEL: Record<string, string> = {
  web: tr("Site"),
  express: tr("Express"),
  instagram: "Instagram",
  whatsapp: "WhatsApp",
  boutique: tr("Boutique"),
  telephone: tr("Téléphone"),
};

export function waLink(phone: string, text: string): string {
  const e164 = toE164(phone)?.replace("+", "") ?? phone;
  return `https://wa.me/${e164}?text=${encodeURIComponent(text)}`;
}

export function telLink(phone: string): string {
  return `tel:${toE164(phone) ?? phone}`;
}

export function downloadUrl(url: string) {
  const a = document.createElement("a");
  a.href = url;
  a.rel = "noopener";
  document.body.appendChild(a);
  a.click();
  a.remove();
}
