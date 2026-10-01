import type { Metadata, Viewport } from "next";
import type { Locale } from "@henine/shared";
import { getDictionary } from "./dictionary";

export const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:8787";

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: "#fbf7f3",
};

export function buildMetadata(locale: Locale): Metadata {
  const t = getDictionary(locale);
  return {
    metadataBase: new URL(SITE_URL),
    title: { default: t.meta.title, template: "%s · Henine Boutique" },
    description: t.meta.description,
    applicationName: "Henine Boutique",
    alternates: {
      canonical: locale === "ar" ? "/" : "/fr",
      languages: { ar: "/", fr: "/fr", "x-default": "/" },
    },
    openGraph: {
      type: "website",
      siteName: "Henine Boutique",
      locale: locale === "fr" ? "fr_DZ" : "ar_DZ",
      title: t.meta.title,
      description: t.meta.description,
    },
    formatDetection: { telephone: false },
    icons: { icon: "/icon.svg" },
  };
}
