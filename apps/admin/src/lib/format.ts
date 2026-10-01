import { formatDA, formatDzPhone, STATUS_LABELS, toE164, type OrderStatus } from "@henine/shared";

export { formatDA, formatDzPhone };

export const da = (n: number | null | undefined) => (n == null ? "—" : formatDA(n));

export function dateTime(ts: number | null | undefined): string {
  if (!ts) return "—";
  return new Date(ts).toLocaleString("fr-DZ", { timeZone: "Africa/Algiers", day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" });
}

export function date(ts: number | null | undefined): string {
  if (!ts) return "—";
  return new Date(ts).toLocaleDateString("fr-DZ", { timeZone: "Africa/Algiers", day: "2-digit", month: "short", year: "numeric" });
}

export function ago(ts: number | null | undefined): string {
  if (!ts) return "—";
  const s = Math.round((Date.now() - ts) / 1000);
  if (s < 60) return "à l'instant";
  if (s < 3600) return `il y a ${Math.floor(s / 60)} min`;
  if (s < 86400) return `il y a ${Math.floor(s / 3600)} h`;
  if (s < 7 * 86400) return `il y a ${Math.floor(s / 86400)} j`;
  return date(ts);
}

export const statusLabel = (s: string) => STATUS_LABELS[s as OrderStatus]?.fr ?? s;

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
  web: "Site",
  express: "Express",
  instagram: "Instagram",
  whatsapp: "WhatsApp",
  boutique: "Boutique",
  telephone: "Téléphone",
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
