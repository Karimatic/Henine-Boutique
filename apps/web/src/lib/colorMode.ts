import { useEffect, useState } from "react";
import { MODE_KEY as KEY } from "./boot";

/** Light / dark: "auto" follows the phone's setting; a choice is kept on this phone. */
export type ColorMode = "auto" | "light" | "dark";
const EVENT = "henine:mode";

export function getColorMode(): ColorMode {
  try {
    const m = localStorage.getItem(KEY);
    return m === "light" || m === "dark" ? m : "auto";
  } catch {
    return "auto";
  }
}

export function setColorMode(mode: ColorMode) {
  try {
    if (mode === "auto") localStorage.removeItem(KEY);
    else localStorage.setItem(KEY, mode);
  } catch {
    /* private mode: this page only */
  }
  if (mode === "auto") document.documentElement.removeAttribute("data-theme");
  else document.documentElement.setAttribute("data-theme", mode);
  window.dispatchEvent(new Event(EVENT));
}

export function useColorMode(): [ColorMode, (m: ColorMode) => void] {
  const [mode, setMode] = useState<ColorMode>("auto");
  useEffect(() => {
    const sync = () => setMode(getColorMode());
    sync();
    window.addEventListener(EVENT, sync);
    return () => window.removeEventListener(EVENT, sync);
  }, []);
  return [mode, setColorMode];
}
