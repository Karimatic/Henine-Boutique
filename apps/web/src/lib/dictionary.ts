import type { Locale } from "@henine/shared";
import { ar } from "./i18n/ar";
import { fr, type Dictionary } from "./i18n/fr";

/**
 * Both languages, for server-side code (page metadata, the <html> shell). Client components
 * get their texts from useLocale(): each layout provides only its own language (locale-ar /
 * locale-fr), so a page never downloads the other one.
 */
const dictionaries: Record<Locale, Dictionary> = { fr, ar };

export function getDictionary(locale: Locale): Dictionary {
  return dictionaries[locale];
}

export { arCount } from "./i18n/count";
export type { Dictionary };
