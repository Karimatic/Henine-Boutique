"use client";

import type { SiteConfigDTO } from "@henine/shared";
import { useApi } from "@/lib/api";
import { useStoreTexts } from "@/lib/storeTexts";

/**
 * Top banner: a slowly flowing rose gradient with the messages scrolling endlessly
 * (marquee, pauses on hover, static when the visitor prefers reduced motion).
 * Messages: built in for each language, editable in Admin → Page d'accueil → Textes.
 */
export function AnnouncementBar() {
  const { data } = useApi<SiteConfigDTO>("/site");
  const messages = useStoreTexts().announcement; // built-in or edited in the admin, in the language of the page
  if (data && !data.announcement.active) return null;
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
