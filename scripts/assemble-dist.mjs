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
// TODO(phase 6): per-page CSP with sha256 hashes of Next's inline scripts (injected as <meta>).
const security = [
  "  Strict-Transport-Security: max-age=63072000; includeSubDomains; preload",
  "  X-Content-Type-Options: nosniff",
  "  Referrer-Policy: strict-origin-when-cross-origin",
  "  Cross-Origin-Opener-Policy: same-origin",
  "  X-Frame-Options: DENY",
  "  Permissions-Policy: camera=(), microphone=(), geolocation=(), payment=(), usb=()",
  "  Content-Security-Policy: frame-ancestors 'none'; base-uri 'none'; object-src 'none'; form-action 'self'",
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
