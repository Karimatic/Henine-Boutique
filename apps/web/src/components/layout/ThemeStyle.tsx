"use client";

import { useEffect } from "react";
import { DEFAULT_DESIGN, fontStylesheet, fontVars, themeVars } from "@henine/shared";
import { useDesign } from "@/lib/site";

const KEY = "henine.design.v1";

/**
 * Colours and fonts chosen in Admin → Page d'accueil → Apparence, applied as CSS variables
 * (every pink/plum shade of the store follows them). Remembered on the phone so the next
 * page paints with them straight away (see THEME_BOOT).
 */
export function ThemeStyle() {
  const design = useDesign();
  const { accent, soft } = design.colors;
  const font = design.font;
  useEffect(() => {
    const isDefault = accent.toLowerCase() === DEFAULT_DESIGN.colors.accent && soft.toLowerCase() === DEFAULT_DESIGN.colors.soft;
    const vars = { ...(isDefault ? {} : themeVars({ accent, soft })), ...fontVars(font) };
    const root = document.documentElement.style;
    for (const k of Object.keys(themeVars(DEFAULT_DESIGN.colors)).concat(Object.keys(fontVars("elegant")))) {
      if (!(k in vars)) root.removeProperty(k);
    }
    for (const [k, v] of Object.entries(vars)) root.setProperty(k, v);
    const href = fontStylesheet(font);
    let link = document.getElementById("henine-font") as HTMLLinkElement | null;
    if (href) {
      if (!link) {
        link = Object.assign(document.createElement("link"), { id: "henine-font", rel: "stylesheet" });
        document.head.appendChild(link);
      }
      if (link.href !== href) link.href = href;
    } else link?.remove();
    try {
      localStorage.setItem(KEY, JSON.stringify({ vars, font: href }));
    } catch {
      /* private mode */
    }
  }, [accent, soft, font]);
  return null;
}

/** Inline in <head>: the remembered theme before the first paint (no flash of the default colours). */
export const THEME_BOOT = `try{var d=JSON.parse(localStorage.getItem("${KEY}")||"null");if(d){var s=document.documentElement.style;for(var k in d.vars)s.setProperty(k,d.vars[k]);if(d.font){var l=document.createElement("link");l.id="henine-font";l.rel="stylesheet";l.href=d.font;document.head.appendChild(l)}}}catch(e){}`;
