/**
 * Arabic counted noun: 1 → "رأي واحد", 2 → "رأيان", 3–10 → "5 آراء", 11–99 → "15 رأيًا",
 * 0 / 100 / 101… → "100 رأي" (the form depends on the last two digits).
 */
export function arCount(n: number, w: { one: string; two: string; few: string; many: string; other: string }): string {
  if (n === 1) return w.one;
  if (n === 2) return w.two;
  const r = n % 100;
  if (r >= 3 && r <= 10) return `${n} ${w.few}`;
  if (r >= 11 && r <= 99) return `${n} ${w.many}`;
  return `${n} ${w.other}`;
}
