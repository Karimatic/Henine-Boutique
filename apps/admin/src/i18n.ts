/**
 * Admin language: French (default) or Arabic, chosen per browser in Paramètres → Mon compte.
 * gettext style: the French text is the key, `tr()` returns the Arabic version when the admin
 * is in Arabic (falls back to French for anything not translated yet). `{name}` placeholders
 * are filled from `vars`. Switching language reloads the page, so module-level labels
 * (menus, tabs) are translated once at start-up.
 */
import { AR } from "./i18n-ar";

export type AdminLang = "fr" | "ar";
const KEY = "henine.admin.lang";

export const lang: AdminLang = (() => {
  try {
    return localStorage.getItem(KEY) === "ar" ? "ar" : "fr";
  } catch {
    return "fr";
  }
})();

export const isAr = lang === "ar";

export function setLang(next: AdminLang) {
  try {
    localStorage.setItem(KEY, next);
  } catch {
    /* private mode: stays for this page only */
  }
  location.reload();
}

type Vars = Record<string, string | number | null | undefined>;
export function tr(fr: string, vars?: Vars): string;
export function tr(fr: string | null | undefined, vars?: Vars): string | undefined;
export function tr(fr: string | null | undefined, vars?: Vars): string | undefined {
  if (fr == null) return undefined;
  let s = lang === "ar" ? (AR[fr] ?? fr) : fr;
  if (vars) for (const [k, v] of Object.entries(vars)) s = s.split(`{${k}}`).join(String(v ?? ""));
  return s;
}

/** <html lang/dir> before the first render. */
export function applyLangToDocument() {
  document.documentElement.lang = lang;
  document.documentElement.dir = lang === "ar" ? "rtl" : "ltr";
}
