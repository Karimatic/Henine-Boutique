import { Cormorant_Garamond, DM_Sans, IBM_Plex_Sans_Arabic } from "next/font/google";

// next/font downloads and self-hosts these at build time (no Google request at runtime),
// subsets them and generates metric-matched fallbacks (no layout shift on swap).

export const cormorant = Cormorant_Garamond({
  subsets: ["latin"],
  weight: ["600"],
  display: "swap",
  variable: "--font-cormorant",
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
