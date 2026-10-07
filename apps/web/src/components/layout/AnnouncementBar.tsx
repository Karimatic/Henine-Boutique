import { useEffect, useState } from "react";
import type { SiteConfigDTO } from "@henine/shared";
import { useApi } from "@/lib/api";
import { useStoreTexts } from "@/lib/storeTexts";

/**
 * Top banner: a slowly flowing rose gradient with the messages. How they move is chosen in
 * Admin → Page d'accueil → Textes: scrolling endlessly (marquee, pauses on hover), one at a
 * time fading or sliding up, or still. Static when the visitor prefers reduced motion.
 * Messages: built in for each language, editable in Admin → Page d'accueil → Textes.
 */
export function AnnouncementBar() {
  const { data } = useApi<SiteConfigDTO>("/site");
  const messages = useStoreTexts().announcement; // built-in or edited in the admin, in the language of the page
  const animation = data?.announcement.animation ?? "scroll";
  if (data && !data.announcement.active) return null;
  if (animation === "fade" || animation === "slide") return <OneAtATime messages={messages} slide={animation === "slide"} />;
  if (animation === "static") {
    return (
      <div className="announce overflow-hidden px-4 py-2 text-center text-[13px] font-medium text-white" role="region" aria-label={messages.join(" · ")}>
        <p className="truncate">{messages.join("  ✦  ")}</p>
      </div>
    );
  }
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

/** One message at a time, changing every few seconds (fading, or sliding up). */
function OneAtATime({ messages, slide }: { messages: string[]; slide: boolean }) {
  const [i, setI] = useState(0);
  useEffect(() => {
    if (messages.length < 2) return;
    const t = setInterval(() => setI((n) => (n + 1) % messages.length), 3800);
    return () => clearInterval(t);
  }, [messages.length]);
  return (
    <div className="announce overflow-hidden text-[13px] font-medium text-white" role="region" aria-label={messages.join(" · ")}>
      <p key={i} aria-hidden="true" className={`truncate px-4 py-2 text-center ${slide ? "announce-slide" : "announce-fade"}`}>
        {messages[i % messages.length]}
      </p>
    </div>
  );
}
