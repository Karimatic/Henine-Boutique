/**
 * Where customers come from: the shop's names for the sources (Statistiques → Sources), used on
 * the orders screens and the sources page.
 */
import { DEFAULT_SOURCE_SETTINGS, ORDER_SOURCES, sourceLabel, type SourceSettings } from "@henine/shared";
import { useQuery } from "@tanstack/react-query";
import { api } from "../api";
import { isAr } from "../i18n";

export function useSourceSettings() {
  return useQuery({ queryKey: ["source-settings"], queryFn: () => api<SourceSettings>("/sources/settings"), staleTime: 5 * 60_000 });
}

/** "📸 Instagram", "💄 Influenceuse Lina"… in the admin's language */
export function sourceText(key: string | null | undefined, settings: SourceSettings | undefined, emoji = true): string {
  const l = sourceLabel(key || "direct", settings ?? DEFAULT_SOURCE_SETTINGS, isAr ? "ar" : "fr");
  return emoji ? `${l.emoji} ${l.name}` : l.name;
}

/** every source the team can pick: the shop's own first, then the built-in ones it shows */
export function pickableSources(settings: SourceSettings | undefined): string[] {
  const s = settings ?? DEFAULT_SOURCE_SETTINGS;
  return [...s.custom.map((c) => c.key), ...ORDER_SOURCES.filter((k) => !s.builtIn[k]?.hidden)];
}
