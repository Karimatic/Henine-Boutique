import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { NextConfig } from "next";

/**
 * The site's public address for canonical / hreflang / OpenGraph links: NEXT_PUBLIC_SITE_URL,
 * or else the Worker's PUBLIC_ORIGIN (apps/worker/wrangler.jsonc), so both always agree.
 * Never empty: a placeholder address falls back to localhost, which assemble-dist reports.
 */
function siteUrl(): string {
  let url = process.env.NEXT_PUBLIC_SITE_URL ?? "";
  if (!url) {
    try {
      const wrangler = readFileSync(join(process.cwd(), "../worker/wrangler.jsonc"), "utf8");
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

/**
 * Fully static export: every page is pre-rendered at build time and served by
 * Cloudflare as a static asset (free, unlimited, never touches the 10 ms CPU limit).
 * Live data (stock, cart, tracking) is fetched client-side from /api.
 */
const nextConfig: NextConfig = {
  output: "export",
  trailingSlash: false,
  reactStrictMode: true,
  poweredByHeader: false,
  transpilePackages: ["@henine/shared"],
  images: {
    // Images are pre-encoded (AVIF/WebP, 5 widths) in the admin and served from R2.
    unoptimized: true,
  },
  typescript: { ignoreBuildErrors: false },
  env: { NEXT_PUBLIC_SITE_URL: siteUrl() },
};

export default nextConfig;
