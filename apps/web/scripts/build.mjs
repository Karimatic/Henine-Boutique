#!/usr/bin/env node
/**
 * Builds the store into apps/web/out:
 *  1. the browser code (vite build): one small entry per page and language + shared chunks;
 *  2. a build-time renderer (vite build --ssr), used once here and then deleted;
 *  3. every page pre-rendered to its HTML file (out/index.html, out/fr/boutique.html,
 *     out/produit/_.html…), linking only the scripts and styles that page needs.
 */
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { build } from "vite";

const web = join(dirname(fileURLToPath(import.meta.url)), "..");
const out = join(web, "out");
const ssrDir = join(web, ".ssr");
process.chdir(web);

/**
 * The public address for canonical / hreflang / link-preview tags: SITE_URL (or NEXT_PUBLIC_SITE_URL,
 * the old name), else the Worker's PUBLIC_ORIGIN, so both always agree. A missing or placeholder
 * address falls back to localhost, which scripts/assemble-dist.mjs reports.
 */
function siteUrl() {
  let url = process.env.SITE_URL || process.env.NEXT_PUBLIC_SITE_URL || "";
  if (!url) {
    try {
      const wrangler = readFileSync(join(web, "../worker/wrangler.jsonc"), "utf8");
      url = /"PUBLIC_ORIGIN"\s*:\s*"([^"]*)"/.exec(wrangler)?.[1] ?? "";
    } catch {
      /* no worker config: local build */
    }
  }
  try {
    return new URL(url).origin;
  } catch {
    return "http://localhost:8787";
  }
}

const quiet = { logLevel: "warn" };

// 1. browser code
const client = await build({ ...quiet, configFile: join(web, "vite.config.ts") });
const chunks = new Map();
for (const o of [client].flat().flatMap((r) => r.output)) if (o.type === "chunk") chunks.set(o.fileName, o);
const entryOf = new Map([...chunks.values()].filter((c) => c.isEntry).map((c) => [c.name, c]));

/** An entry's script, the chunks it imports (preloaded together) and its stylesheets. */
function assetsOf(name) {
  const entry = entryOf.get(name);
  if (!entry) throw new Error(`no entry ${name}`);
  const js = new Set();
  const css = new Set();
  const walk = (c) => {
    for (const f of c.viteMetadata?.importedCss ?? []) css.add(f);
    for (const i of c.imports) {
      if (js.has(i)) continue;
      js.add(i);
      walk(chunks.get(i));
    }
  };
  walk(entry);
  return { entry: entry.fileName, preload: [...js], css: [...css] };
}

// 2. build-time renderer
await build({ ...quiet, configFile: join(web, "vite.config.ts"), build: { ssr: "src/server.tsx" } });
const { renderPage, PAGES, NOT_FOUND, APP_CLASS, BOOT_SCRIPT } = await import(pathToFileURL(join(ssrDir, "server.js")).href);

// 3. pages
const site = siteUrl();
const fonts = JSON.parse(readFileSync(join(web, "src/styles/font-preload.json"), "utf8"));
const localePath = (locale, path) => (locale === "ar" ? path : path === "/" ? "/fr" : `/fr${path}`);

function writePage(page, locale, file) {
  const { lang, dir, head, body } = renderPage(page, locale, site);
  const a = assetsOf(`${locale}-${page.view}`);
  const html =
    `<!DOCTYPE html><html lang="${lang}" dir="${dir}"><head>` +
    `<meta charset="utf-8"/><meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover"/>` +
    // light / dark choice and the store's colours before the first paint (no flash)
    `<script>${BOOT_SCRIPT}</script>` +
    head +
    fonts.map((f) => `<link rel="preload" href="${f}" as="font" type="font/woff2" crossorigin=""/>`).join("") +
    a.css.map((f) => `<link rel="stylesheet" href="/${f}"/>`).join("") +
    a.preload.map((f) => `<link rel="modulepreload" href="/${f}"/>`).join("") +
    `<script type="module" src="/${a.entry}"></script>` +
    `</head><body><noscript><style>.reveal{opacity:1!important;transform:none!important}</style></noscript>` +
    `<div id="app" class="${APP_CLASS}">${body}</div></body></html>`;
  const target = join(out, file);
  mkdirSync(dirname(target), { recursive: true });
  writeFileSync(target, html);
}

let n = 0;
for (const page of PAGES) {
  for (const locale of ["ar", "fr"]) {
    const address = localePath(locale, page.path);
    writePage(page, locale, address === "/" ? "index.html" : `${address.slice(1)}.html`);
    n++;
  }
}
// unknown addresses: Cloudflare serves the nearest 404.html (French under /fr)
writePage(NOT_FOUND, "ar", "404.html");
writePage(NOT_FOUND, "fr", "fr/404.html");
rmSync(ssrDir, { recursive: true, force: true });

// what a phone downloads for the home page (gzip), the number to keep low
const { gzipSync } = await import("node:zlib");
const home = assetsOf("ar-HomePage");
const size = (f) => gzipSync(readFileSync(join(out, f))).length;
const jsKb = ([home.entry, ...home.preload].reduce((s, f) => s + size(f), 0) / 1024).toFixed(1);
const cssKb = (home.css.reduce((s, f) => s + size(f), 0) / 1024).toFixed(1);
// eslint-disable-next-line no-console -- the build report
console.log(`✓ store: ${n + 2} pages · home page ${jsKb} KB JS + ${cssKb} KB CSS (gzip)`);
