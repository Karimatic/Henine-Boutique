/**
 * The physical shop in Boumerdès: where it is, when it is open, and whether it is open now
 * (Algiers time, UTC+1, no daylight saving). Edited in Admin → Paramètres → Contact & réseaux.
 */

export interface DayHours {
  open: string; // "09:00"
  close: string; // "20:00"
}

export interface BoutiqueDTO {
  enabled: boolean;
  addressFr: string;
  addressAr: string;
  /** what Google Maps searches for (address or "lat,lng") */
  mapQuery: string;
  /** Sunday = 0 … Saturday = 6; null = closed that day */
  hours: (DayHours | null)[];
  noteFr: string;
  noteAr: string;
  /** product pages say "Disponible en boutique" for pieces in stock */
  showOnProducts: boolean;
}

export const DEFAULT_BOUTIQUE: BoutiqueDTO = {
  enabled: true,
  addressFr: "Dellys, Laqhaoui · à côté du tribunal",
  addressAr: "دلس، لقهاوي · بجانب المحكمة",
  /** Google plus code of the shop's door */
  mapQuery: "WV9Q+4RW, Dellys",
  hours: Array.from({ length: 7 }, () => ({ open: "09:30", close: "20:00" })),
  noteFr: "",
  noteAr: "",
  showOnProducts: true,
};

export const DAY_NAMES = {
  fr: ["Dimanche", "Lundi", "Mardi", "Mercredi", "Jeudi", "Vendredi", "Samedi"],
  ar: ["الأحد", "الإثنين", "الثلاثاء", "الأربعاء", "الخميس", "الجمعة", "السبت"],
};

const minutes = (hhmm: string) => {
  const [h, m] = hhmm.split(":").map(Number);
  return (h ?? 0) * 60 + (m ?? 0);
};

export interface BoutiqueStatus {
  open: boolean;
  /** open now: closing time today */
  closesAt: string | null;
  /** closed now: next opening (day 0-6 and time); null if never open */
  next: { day: number; time: string; today: boolean; tomorrow: boolean } | null;
  /** day of week in Algiers */
  today: number;
}

export function boutiqueStatus(hours: (DayHours | null)[], now = Date.now()): BoutiqueStatus {
  const d = new Date(now + 3600_000); // Africa/Algiers
  const today = d.getUTCDay();
  const nowMin = d.getUTCHours() * 60 + d.getUTCMinutes();
  const h = hours[today];
  if (h && nowMin >= minutes(h.open) && nowMin < minutes(h.close)) {
    return { open: true, closesAt: h.close, next: null, today };
  }
  for (let k = 0; k < 8; k++) {
    const day = (today + k) % 7;
    const dh = hours[day];
    if (!dh) continue;
    if (k === 0 && nowMin >= minutes(dh.open)) continue; // already past today's opening
    return { open: false, closesAt: null, next: { day, time: dh.open, today: k === 0, tomorrow: k === 1 }, today };
  }
  return { open: false, closesAt: null, next: null, today };
}
