import type { NextConfig } from "next";

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
};

export default nextConfig;
