/**
 * Categories as a tree in the admin: main categories and their sub-categories
 * (Lingerie › Ensembles), the same order as on the store.
 */
export interface CategoryLite {
  id: number;
  name_fr: string;
  name_ar?: string;
  parent_id?: number | null;
  sort?: number;
  season?: "summer" | "winter" | null;
}

export function mainsOf<T extends CategoryLite>(cats: T[]): T[] {
  return cats.filter((c) => c.parent_id == null);
}

export function subsOf<T extends CategoryLite>(cats: T[], id: number): T[] {
  return cats.filter((c) => c.parent_id === id);
}

/** "Lingerie › Ensembles" (or just the name of a main category). */
export function categoryPath(cats: CategoryLite[], id: number | null | undefined): string | null {
  const c = cats.find((x) => x.id === id);
  if (!c) return null;
  const parent = c.parent_id != null ? cats.find((x) => x.id === c.parent_id) : undefined;
  return parent ? `${parent.name_fr} › ${c.name_fr}` : c.name_fr;
}

/** Sort key keeping sub-categories right after their main category. */
export function categoryOrder(cats: CategoryLite[], id: number | null | undefined): number {
  const c = cats.find((x) => x.id === id);
  if (!c) return 1e6;
  const parent = c.parent_id != null ? cats.find((x) => x.id === c.parent_id) : undefined;
  return parent ? (parent.sort ?? 0) * 1000 + 1 + (c.sort ?? 0) : (c.sort ?? 0) * 1000;
}

const seasonMark = (c: CategoryLite) => (c.season === "summer" ? " ☀️" : c.season === "winter" ? " ❄️" : "");

/** <option>s for a category <select>: sub-categories grouped under their main category. */
export function CategoryOptions({ cats }: { cats: CategoryLite[] }) {
  return (
    <>
      {mainsOf(cats).map((m) => {
        const subs = subsOf(cats, m.id);
        return subs.length ? (
          <optgroup key={m.id} label={m.name_fr}>
            {subs.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name_fr}
                {seasonMark(s)}
              </option>
            ))}
          </optgroup>
        ) : (
          <option key={m.id} value={m.id}>
            {m.name_fr}
          </option>
        );
      })}
    </>
  );
}
