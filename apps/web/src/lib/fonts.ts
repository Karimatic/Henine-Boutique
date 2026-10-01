import { DM_Sans, IBM_Plex_Sans_Arabic, Playfair_Display } from "next/font/google";

// next/font downloads and self-hosts these at build time (no Google request at runtime),
// subsets them and generates metric-matched fallbacks (no layout shift on swap).

/** Luxury editorial serif (the brand wordmark, section headings, hero titles). */
export const playfair = Playfair_Display({
  subsets: ["latin"],
  weight: ["500", "600", "700"],
  style: ["normal", "italic"],
  display: "swap",
  variable: "--font-playfair",
});

export const dmSans = DM_Sans({
  subsets: ["latin"],
  display: "swap",
  variable: "--font-dm-sans",
});

export const plexArabic = IBM_Plex_Sans_Arabic({
  subsets: ["arabic"],
  weight: ["400", "600"],
  display: "swap",
  variable: "--font-plex-arabic",
  preload: false, // only preloaded on Arabic pages (see RootDocument)
});
