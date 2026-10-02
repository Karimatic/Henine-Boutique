"use client";

import type { SiteConfigDTO } from "@henine/shared";
import { useApi } from "@/lib/api";
import { useLocale } from "@/lib/locale";

/**
 * Top banner: a slowly flowing rose gradient with the messages scrolling endlessly
 * (marquee, pauses on hover, static when the visitor prefers reduced motion).
 * Messages are built in (Arabic / French by page); Admin → Page d'accueil only shows or hides it.
 */
export function AnnouncementBar() {
  const { t } = useLocale();
  const { data } = useApi<SiteConfigDTO>("/site");
  if (data && !data.announcement.active) return null;
  const messages = t.announcement; // built-in, in the language of the page
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
