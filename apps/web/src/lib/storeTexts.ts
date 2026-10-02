"use client";

import { resolveStoreTexts, type SiteConfigDTO, type StoreTexts } from "@henine/shared";
import { useApi } from "./api";
import { useLocale } from "./locale";

/**
 * Hero, banner, FAQ and pause texts in the language of the page: the team's edits from
 * Admin → Page d'accueil if any, otherwise the built-in text (shown immediately, before /site loads).
 */
export function useStoreTexts(): StoreTexts {
  const { locale } = useLocale();
  const site = useApi<SiteConfigDTO>("/site");
  return resolveStoreTexts(locale, site.data?.texts?.[locale]);
}
