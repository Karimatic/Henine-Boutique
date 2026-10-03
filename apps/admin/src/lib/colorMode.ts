import { useEffect, useState } from "react";

/**
 * Light / dark for the admin, per device. "auto" follows the phone / computer (pure CSS,
 * no flash); a choice is applied before the first render (see main.tsx).
 */
export type ColorMode = "auto" | "light" | "dark";
const KEY = "henine.admin.mode";
const EVENT = "henine:mode";

export function getColorMode(): ColorMode {
  try {
    const m = localStorage.getItem(KEY);
    return m === "light" || m === "dark" ? m : "auto";
  } catch {
    return "auto";
  }
}

export function applyColorMode(mode = getColorMode()) {
  if (mode === "auto") document.documentElement.removeAttribute("data-theme");
  else document.documentElement.setAttribute("data-theme", mode);
}

export function setColorMode(mode: ColorMode) {
  try {
    if (mode === "auto") localStorage.removeItem(KEY);
    else localStorage.setItem(KEY, mode);
  } catch {
    /* private mode: this page only */
  }
  applyColorMode(mode);
  window.dispatchEvent(new Event(EVENT));
}

/** The mode chosen, and whether the screen is dark right now (auto resolved). */
export function useColorMode(): { mode: ColorMode; dark: boolean; setMode: (m: ColorMode) => void } {
  const media = typeof matchMedia === "function" ? matchMedia("(prefers-color-scheme: dark)") : null;
  const [mode, setMode] = useState<ColorMode>(getColorMode);
  const [systemDark, setSystemDark] = useState(!!media?.matches);
  useEffect(() => {
    const sync = () => setMode(getColorMode());
    const sys = (e: MediaQueryListEvent) => setSystemDark(e.matches);
    window.addEventListener(EVENT, sync);
    media?.addEventListener("change", sys);
    return () => {
      window.removeEventListener(EVENT, sync);
      media?.removeEventListener("change", sys);
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  return { mode, dark: mode === "dark" || (mode === "auto" && systemDark), setMode: setColorMode };
}
