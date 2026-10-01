"use client";

import type { SiteConfigDTO } from "@henine/shared";
import { useApi } from "@/lib/api";
import { useLocale } from "@/lib/locale";

/**
 * Top banner: a slowly flowing rose gradient with the messages scrolling endlessly
 * (marquee, pauses on hover, static when the visitor prefers reduced motion).
 * Messages come from Admin → Marketing → Page d'accueil; built-in defaults render first.
 */
export function AnnouncementBar() {
  const { t, ar } = useLocale();
  const { data } = useApi<SiteConfigDTO>("/site");
  if (data && !data.announcement.active) return null;
  const fromAdmin = data ? (ar ? data.announcement.messagesAr : data.announcement.messagesFr).filter(Boolean) : null;
  const messages = fromAdmin?.length ? fromAdmin : t.announcement;
  // repeat so one copy is always wider than the screen, then double it for the seamless loop
  const lane = Array.from({ length: Math.max(2, Math.ceil(8 / messages.length)) }, () => messages).flat();

  return (
    <div className="announce overflow-hidden text-[13px] font-medium text-white" role="region" aria-label={messages.join(" · ")}>
      <div className="announce-track py-2" aria-hidden="true">
        {[0, 1].map((copy) => (
          <ul key={copy} className="flex shrink-0">
            {lane.map((m, i) => (
              <li key={`${copy}-${i}`} className="flex shrink-0 items-center whitespace-nowrap">
                <span className="px-5">{m}</span>
                <span className="announce-sparkle text-[10px] text-rose-300" style={{ animationDelay: `${(i % 4) * 0.5}s` }}>
                  ✦
                </span>
              </li>
            ))}
          </ul>
        ))}
      </div>
    </div>
  );
}
