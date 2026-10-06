/**
 * "?find=…" on any admin address: scrolls to that section / setting / button and makes it glow
 * (the search bar's results open features this way). A tab or filter pill with that name is
 * switched to first. The text is the French source; it is matched in the admin's language.
 */
import { useSearch } from "@tanstack/react-router";
import { useEffect } from "react";
import { tr } from "../i18n";

const clean = (s: string | null | undefined) => (s ?? "").replace(/\s+/g, " ").trim();

export function useFindOnPage() {
  const { find } = useSearch({ strict: false }) as { find?: string };
  useEffect(() => {
    if (!find) return;
    const targets = [clean(tr(find)), clean(find)];
    const matches = (el: Element) => {
      const t = clean(el.textContent);
      return targets.some((x) => x && (t === x || (t.startsWith(x) && t.length < x.length + 60)));
    };
    let tries = 0;
    const id = setInterval(() => {
      tries++;
      const main = document.querySelector("main");
      if (!main || tries > 40) return clearInterval(id);
      // a tab or a filter pill: switch to it (only changes what is shown)
      const pill = [...main.querySelectorAll("[role=tab], button[aria-pressed]")].find((b) => clean(b.textContent) === targets[0] || clean(b.textContent) === targets[1]) as HTMLButtonElement | undefined;
      const el = pill ?? [...main.querySelectorAll("h1, h2, h3, h4, legend, label, dt, p, span, button")].find((x) => matches(x) && (x as HTMLElement).offsetParent !== null);
      if (!el) return;
      clearInterval(id);
      if (pill && pill.getAttribute("aria-pressed") !== "true" && pill.getAttribute("aria-selected") !== "true") pill.click();
      const box = (el.closest("section, [class*='rounded-2xl'], [class*='rounded-xl'], label") as HTMLElement | null) ?? (el as HTMLElement);
      box.scrollIntoView({ behavior: "smooth", block: "center" });
      box.classList.add("find-glow");
      setTimeout(() => box.classList.remove("find-glow"), 2600);
    }, 120);
    return () => clearInterval(id);
  }, [find]);
}
