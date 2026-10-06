import { useEffect } from "react";
import { DEFAULT_DESIGN, themeVars, themeVarsDark } from "@henine/shared";
import { presetFontVars } from "@/lib/fontPresets";
import { DESIGN_KEY as KEY } from "@/lib/boot";
import { useDesign } from "@/lib/site";

const rules = (vars: Record<string, string>) => Object.entries(vars).map(([k, v]) => `${k}:${v}`).join(";");

/**
 * Colours and fonts chosen in Admin → Page d'accueil → Apparence, as a small stylesheet
 * (light values, and their dark-mode versions). Remembered on the phone so the next page
 * paints with them straight away (see THEME_BOOT).
 */
export function ThemeStyle() {
  const design = useDesign();
  const { accent, soft } = design.colors;
  const font = design.font;
  useEffect(() => {
    const isDefault = accent.toLowerCase() === DEFAULT_DESIGN.colors.accent && soft.toLowerCase() === DEFAULT_DESIGN.colors.soft;
    const fonts = presetFontVars(font);
    let css = Object.keys(fonts).length ? `:root:root{${rules(fonts)}}` : "";
    if (!isDefault) {
      const dark = rules(themeVarsDark({ accent, soft }));
      css +=
        `:root:root{${rules(themeVars({ accent, soft }))}}` +
        `@media screen{:root:root[data-theme="dark"]{${dark}}@media (prefers-color-scheme: dark){:root:root:not([data-theme="light"]){${dark}}}}`;
    }
    let style = document.getElementById("henine-theme");
    if (css) {
      if (!style) {
        style = Object.assign(document.createElement("style"), { id: "henine-theme" });
        document.head.appendChild(style);
      }
      if (style.textContent !== css) style.textContent = css;
    } else style?.remove();
    try {
      localStorage.setItem(KEY, JSON.stringify({ css }));
      localStorage.removeItem("henine.design.v1");
      localStorage.removeItem("henine.design.v2"); // older format with a Google Fonts link
    } catch {
      /* private mode */
    }
  }, [accent, soft, font]);
  return null;
}
