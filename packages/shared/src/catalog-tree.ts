/**
 * The category tree (main categories and their sub-categories), the season (summer / winter
 * pyjamas first) and which drawing stands in for a product without photos.
 */
import type { CategoryDTO } from "./api";

export type Season = "summer" | "winter";
export type SeasonSetting = "auto" | Season;

/** Summer from April to September (Algiers time), unless the shop forces a season. */
export function currentSeason(setting: SeasonSetting = "auto", now = Date.now()): Season {
  if (setting !== "auto") return setting;
  const month = new Date(now + 3600_000).getUTCMonth() + 1;
  return month >= 4 && month <= 9 ? "summer" : "winter";
}

export function mainCategories(all: CategoryDTO[]): CategoryDTO[] {
  return all.filter((c) => c.parentId == null);
}

/** Sub-categories of a category, the current season's first. */
export function subCategories(all: CategoryDTO[], parentId: number, season?: Season): CategoryDTO[] {
  const subs = all.filter((c) => c.parentId === parentId);
  return season ? [...subs].sort((a, b) => Number(b.season === season) - Number(a.season === season)) : subs;
}

/** The category's slug and those of its sub-categories (a main category shows all of them). */
export function categorySlugs(all: CategoryDTO[], slug: string): Set<string> {
  const c = all.find((x) => x.slug === slug);
  if (!c) return new Set([slug]);
  return new Set([c.slug, ...all.filter((x) => x.parentId === c.id).map((x) => x.slug)]);
}

export function parentOf(all: CategoryDTO[], c: CategoryDTO | undefined): CategoryDTO | undefined {
  return c?.parentId != null ? all.find((x) => x.id === c.parentId) : undefined;
}

/** The silhouette drawn when a product has no photo yet, from its category's slug. */
export type ArtKey = "robes" | "pyjamas" | "lingerie" | "djebba" | "set" | "sport" | "gown";

export function artKey(slug: string | null | undefined): ArtKey {
  const s = slug ?? "";
  if (/pyjama/.test(s)) return "pyjamas";
  if (/sport|surv/.test(s)) return "sport";
  if (/ensemble|soutien|culotte|gaine|trousseau/.test(s)) return "set";
  if (/nuisette|chambre|lingerie/.test(s)) return "lingerie";
  if (/gandoura|djebba|jubba|jebba/.test(s)) return "djebba";
  if (/gown|soiree/.test(s)) return "gown";
  return "robes";
}
