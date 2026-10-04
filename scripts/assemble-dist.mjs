#!/usr/bin/env node
/**
 * Merge the two static builds into the single asset directory the Worker serves:
 *   apps/web/out     → dist/
 *   apps/admin/dist  → dist/admin/
 * and write dist/_headers (security + caching headers for static files).
 */
import { cpSync, existsSync, mkdirSync, readdirSync, rmSync, writeFileSync } from "node:fs";
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
// Storefront CSP: scripts only from the site itself and Cloudflare Turnstile ('unsafe-inline' is
// needed by Next's inline page data), data only sent back to the site itself, frames only for
// Turnstile and the shop's Google Maps card. TODO: sha256 hashes instead of 'unsafe-inline'.
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

console.log("✓ dist assembled (storefront + admin + _headers)");
