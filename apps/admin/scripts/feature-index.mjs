/**
 * Builds the search bar's index of every feature of the administration, read from the code
 * itself at build time: each page's section titles, settings, switches, fields, tabs, filters
 * and buttons, with the page (and the Paramètres tab) where it lives. New features become
 * searchable without anyone maintaining a list.
 *
 * Only French source strings are stored (the search shows and matches them in the admin's
 * language through tr()).
 */
import { readFileSync, readdirSync } from "node:fs";
import { join, relative } from "node:path";

/** What a string is, from how it is written in the JSX. */
const PATTERNS = [
  ["section", /\btitle=\{tr\("((?:[^"\\]|\\.){3,140})"/g],
  ["setting", /\blabel=\{tr\("((?:[^"\\]|\\.){3,120})"/g],
  ["section", /<h[1-4][^>]*>\s*\{tr\("((?:[^"\\]|\\.){3,140})"/g],
  ["tab", /\blabel: tr\("((?:[^"\\]|\\.){2,80})"/g],
  ["action", /<Button\b[^>]*>\s*\{tr\("((?:[^"\\]|\\.){3,80})"/g],
  ["setting", /<Row\s+title=\{tr\("((?:[^"\\]|\\.){3,140})"/g],
  ["setting", /<label\b[^>]*>\s*\{tr\("((?:[^"\\]|\\.){3,120})"/g],
  ["setting", /\bfield\("\w+",\s*tr\("((?:[^"\\]|\\.){3,120})"/g],
  ["section", /<p className="[^"]*font-(?:semibold|bold)[^"]*">\s*\{tr\("((?:[^"\\]|\\.){3,120})"/g],
];

/** Words that are never a feature on their own. */
const SKIP = new Set(["Annuler", "Fermer", "Enregistrer", "OK", "Oui", "Non", "Retour", "Supprimer", "Modifier", "Tous", "Toutes", "Tout", "Réessayer"]);
/** Empty states and loading texts are not features. */
const NOISE = /^(Aucun|Aucune|Pas encore|Pas de|Rien|Chargement|Erreur)/;

/** Top-level functions / constants of a file: name → { code, refs } */
function blocks(file) {
  const src = readFileSync(file, "utf8");
  const starts = [...src.matchAll(/^(?:export\s+)?(?:async\s+)?(?:function\s+([A-Za-z0-9_]+)|const\s+([A-Za-z0-9_]+)\s*=)/gm)].map((m) => ({ name: m[1] ?? m[2], at: m.index }));
  return starts.map((s, i) => {
    const code = src.slice(s.at, starts[i + 1]?.at ?? src.length);
    return { name: s.name, code, refs: [...new Set([...code.matchAll(/<([A-Z][A-Za-z0-9]+)/g)].map((m) => m[1]))] };
  });
}

function stringsOf(code) {
  const out = [];
  for (const [kind, re] of PATTERNS)
    for (const m of code.matchAll(re)) {
      const f = JSON.parse(`"${m[1]}"`);
      if (!SKIP.has(f) && !NOISE.test(f) && !/\{\d\}/.test(f)) out.push({ kind, f });
    }
  return out;
}

export function featureIndex(srcDir) {
  const files = ["pages", "pages/auth", "lib"].flatMap((d) =>
    readdirSync(join(srcDir, d))
      .filter((f) => f.endsWith(".tsx"))
      .map((f) => join(srcDir, d, f)),
  );
  /** component name → its code (first definition wins) */
  const comps = new Map();
  for (const file of files) for (const b of blocks(file)) if (!comps.has(b.name)) comps.set(b.name, { ...b, file: relative(srcDir, file) });

  // routes: page("/stock", lazy(() => import("./pages/Stock"), "StockPage")) / lazy(Products, "ProductsPage") / page("/", Dashboard)
  const router = readFileSync(join(srcDir, "router.tsx"), "utf8");
  const routes = [...router.matchAll(/page\("([^"]+)",\s*(?:lazy\([^,]+,\s*"([A-Za-z0-9]+)"\)|([A-Z][A-Za-z0-9]+))\)/g)].map((m) => ({ path: m[1], comp: m[2] ?? m[3] }));

  const entries = new Map();
  const add = (path, search, s) => {
    const key = `${path}|${search?.tab ?? ""}|${s.f}`;
    if (!entries.has(key)) entries.set(key, { p: path, ...(search ? { s: search } : {}), f: s.f, k: s.kind });
  };
  /** every string of a component and of the components it shows (depth-limited) */
  const walk = (name, visit, depth = 0, seen = new Set()) => {
    const c = comps.get(name);
    if (!c || seen.has(name) || depth > 6) return;
    seen.add(name);
    visit(c.code);
    for (const r of c.refs) walk(r, visit, depth + 1, seen);
  };

  for (const { path, comp } of routes) {
    // Paramètres is indexed tab by tab below; /produits/$id needs a product (same fields as /produits/nouveau-complet)
    if (path === "/parametres" || path.includes("$")) continue;
    walk(comp, (code) => stringsOf(code).forEach((s) => add(path, undefined, s)));
  }

  // Paramètres: each string goes with its tab, so the search opens the right one
  const settings = comps.get("SettingsPage")?.code ?? "";
  const tabComponents = [...settings.matchAll(/tab === "(\w+)" \? \(\s*(?:<div[^>]*>\s*)?<([A-Z]\w+)/g)].map((m) => [m[1], m[2]]);
  for (const [tab, comp] of tabComponents) walk(comp, (code) => stringsOf(code).forEach((s) => add("/parametres", { tab }, s)));
  const store = comps.get("StoreSettings")?.code ?? "";
  const parts = store.split(/if \(tab === "(\w+)"\)/);
  for (let i = 1; i < parts.length; i += 2) {
    const tab = parts[i];
    const code = parts[i + 1];
    stringsOf(code).forEach((s) => add("/parametres", { tab }, s));
    for (const r of new Set([...code.matchAll(/<([A-Z][A-Za-z0-9]+)/g)].map((m) => m[1]))) walk(r, (c) => stringsOf(c).forEach((s) => add("/parametres", { tab }, s)));
  }
  return [...entries.values()];
}
