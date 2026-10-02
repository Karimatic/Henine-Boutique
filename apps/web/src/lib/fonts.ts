import { DM_Sans, El_Messiri, Playfair_Display, Tajawal } from "next/font/google";

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

/** Arabic body text: refined, light and very readable on small screens. */
export const arabicSans = Tajawal({
  subsets: ["arabic"],
  weight: ["400", "500", "700"],
  display: "swap",
  variable: "--font-arabic-sans",
  preload: false,
});

/** Arabic headings: elegant, flowing display face (the Arabic counterpart of Playfair). */
export const arabicDisplay = El_Messiri({
  subsets: ["arabic"],
  weight: ["500", "600", "700"],
  display: "swap",
  variable: "--font-arabic-display-face",
  preload: false,
});
