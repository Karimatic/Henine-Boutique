#!/usr/bin/env node
/**
 * Merge the two static builds into the single asset directory the Worker serves:
 *   apps/web/out     → dist/
 *   apps/admin/dist  → dist/admin/
 * and write dist/_headers (security + caching headers for static files).
 */
import { createHash } from "node:crypto";
import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const web = join(root, "apps/web/out");
const admin = join(root, "apps/admin/dist");
const dist = join(root, "dist");

for (const [name, dir] of [["storefront", web], ["admin", admin]]) {
  if (!existsSync(dir)) {
    console.error(`✗ ${name} build missing: ${dir}`);
    process.exit(1);
  }
}

// Empty dist/ instead of deleting it: on Windows a running `wrangler dev` holds the directory open.
mkdirSync(dist, { recursive: true });
for (const entry of readdirSync(dist)) rmSync(join(dist, entry), { recursive: true, force: true });
cpSync(web, dist, { recursive: true });
cpSync(admin, join(dist, "admin"), { recursive: true });

// Static-asset headers. /api and /admin documents get their headers from the Worker.
// Storefront CSP: scripts only from the site itself and Cloudflare Turnstile, data only sent back
// to the site itself, frames only for Turnstile and the shop's Google Maps card.
// The header allows inline scripts (one header for every page), and each page then narrows it
// with its own <meta> policy listing the sha256 of exactly its inline scripts (see below):
// browsers enforce both, so only the page's own inline scripts can run.
const csp = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-inline' https://challenges.cloudflare.com",
  "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
  "font-src 'self' data: https://fonts.gstatic.com",
  "img-src 'self' data: blob: https:",
  "media-src 'self' blob: https:",
  "connect-src 'self'",
  "frame-src https://challenges.cloudflare.com https://www.google.com",
  "worker-src 'self'",
  "manifest-src 'self'",
  "object-src 'none'",
  "base-uri 'none'",
  "form-action 'self'",
  "frame-ancestors 'none'",
].join("; ");
const security = [
  "  Strict-Transport-Security: max-age=63072000; includeSubDomains; preload",
  "  X-Content-Type-Options: nosniff",
  "  Referrer-Policy: strict-origin-when-cross-origin",
  "  Cross-Origin-Opener-Policy: same-origin",
  "  X-Frame-Options: DENY",
  "  Permissions-Policy: camera=(), microphone=(), geolocation=(), payment=(), usb=()",
  `  Content-Security-Policy: ${csp}`,
].join("\n");

writeFileSync(
  join(dist, "_headers"),
  `/*
${security}

/_next/static/*
  Cache-Control: public, max-age=31536000, immutable

/admin/assets/*
  Cache-Control: public, max-age=31536000, immutable
`,
);

// Per-page script policy: the sha256 of each inline <script> (Next's page data, the theme and
// splash boot scripts), placed right after <meta charset>, before any script runs.
const SCRIPT_SRC = "script-src 'self' https://challenges.cloudflare.com";
const htmlFiles = (dir) =>
  readdirSync(dir).flatMap((name) => {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) return name === "admin" && dir === dist ? [] : htmlFiles(p);
    return name.endsWith(".html") ? [p] : [];
  });
let pages = 0;
for (const file of htmlFiles(dist)) {
  const html = readFileSync(file, "utf8");
  const hashes = new Set();
  for (const m of html.matchAll(/<script(?![^>]*\ssrc=)[^>]*>([\s\S]*?)<\/script>/g)) {
    hashes.add(`'sha256-${createHash("sha256").update(m[1], "utf8").digest("base64")}'`);
  }
  const meta = `<meta http-equiv="Content-Security-Policy" content="${[SCRIPT_SRC, ...hashes].join(" ")}"/>`;
  const charset = /<meta charSet="utf-8"\/?>/i;
  const out = charset.test(html) ? html.replace(charset, (c) => c + meta) : html.replace(/<head[^>]*>/i, (h) => h + meta);
  if (out === html) throw new Error(`no <head> in ${file}`);
  writeFileSync(file, out);
  pages++;
}
console.log(`✓ script hashes on ${pages} pages`);

// Canonical / hreflang links must carry the real public address, never the local one.
const canonical = /<link rel="canonical" href="([^"]+)"/.exec(readFileSync(join(dist, "index.html"), "utf8"))?.[1] ?? "";
if (!/^https:\/\//.test(canonical)) {
  const msg = `canonical links point to ${canonical || "nothing"}: set PUBLIC_ORIGIN in apps/worker/wrangler.jsonc (or NEXT_PUBLIC_SITE_URL)`;
  if (process.env.REQUIRE_SITE_URL) {
    console.error(`✗ ${msg}`);
    process.exit(1);
  }
  console.warn(`⚠ ${msg} — fine for local testing, not for production`);
}

console.log("✓ dist assembled (storefront + admin + _headers)");
