import type { Metadata, Viewport } from "next";
import type { Locale } from "@henine/shared";
import { getDictionary } from "./dictionary";

/** The public address (set by next.config.ts from NEXT_PUBLIC_SITE_URL or the Worker's PUBLIC_ORIGIN). */
export const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL || "http://localhost:8787";

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#fdeef3" },
    { media: "(prefers-color-scheme: dark)", color: "#140c10" },
  ],
};

export function buildMetadata(locale: Locale): Metadata {
  const t = getDictionary(locale);
  return {
    metadataBase: new URL(SITE_URL),
    title: { default: t.meta.title, template: "%s · Henine Boutique" },
    description: t.meta.description,
    applicationName: "Henine Boutique",
    openGraph: openGraph(locale),
    formatDetection: { telephone: false },
    icons: { icon: "/icon.svg", apple: "/icons/apple-touch-icon.png" },
    // installable on the home screen (PWA)
    manifest: "/manifest.webmanifest",
    appleWebApp: { capable: true, title: "Henine", statusBarStyle: "default" },
  };
}

function openGraph(locale: Locale): NonNullable<Metadata["openGraph"]> {
  const t = getDictionary(locale);
  return {
    type: "website",
    siteName: "Henine Boutique",
    locale: locale === "fr" ? "fr_DZ" : "ar_DZ",
    title: t.meta.title,
    description: t.meta.description,
  };
}

/**
 * A page's own metadata + its canonical address and its Arabic / French twin, so search
 * engines index every page as itself (Arabic at "/…", French at "/fr/…").
 * `path` is the page's path without the language prefix ("/", "/boutique").
 */
export function pageMeta(locale: Locale, path: string, m: Metadata): Metadata {
  const ar = path;
  const fr = path === "/" ? "/fr" : `/fr${path}`;
  const og = openGraph(locale);
  return {
    ...m,
    alternates: { canonical: locale === "ar" ? ar : fr, languages: { ar, fr, "x-default": ar } },
    openGraph: {
      ...og,
      url: locale === "ar" ? ar : fr,
      ...(typeof m.title === "string" ? { title: `${m.title} · Henine Boutique` } : {}),
      ...(m.description ? { description: m.description } : {}),
    },
  };
}
