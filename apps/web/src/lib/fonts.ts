import {
  Almarai,
  Amiri,
  Cairo,
  Cormorant_Garamond,
  DM_Sans,
  El_Messiri,
  Inter,
  Jost,
  Lora,
  Montserrat,
  Noto_Kufi_Arabic,
  Nunito,
  Playfair_Display,
  Reem_Kufi,
  Tajawal,
} from "next/font/google";

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

/*
 * The other font choices of Admin → Page d'accueil → Apparence, self-hosted the same way
 * (no request to Google, nothing to allow in the CSP). Not preloaded: a phone only
 * downloads a font file once the chosen preset actually uses it (see lib/fontPresets.ts).
 */
const cormorant = Cormorant_Garamond({ display: "swap", preload: false, subsets: ["latin"], variable: "--font-p-cormorant" });
const jost = Jost({ display: "swap", preload: false, subsets: ["latin"], variable: "--font-p-jost" });
const notoKufi = Noto_Kufi_Arabic({ display: "swap", preload: false, subsets: ["arabic"], variable: "--font-p-noto-kufi" });
const amiri = Amiri({ display: "swap", preload: false, subsets: ["arabic"], weight: ["400", "700"], variable: "--font-p-amiri" });
const montserrat = Montserrat({ display: "swap", preload: false, subsets: ["latin"], variable: "--font-p-montserrat" });
const inter = Inter({ display: "swap", preload: false, subsets: ["latin"], variable: "--font-p-inter" });
const cairo = Cairo({ display: "swap", preload: false, subsets: ["arabic"], variable: "--font-p-cairo" });
const lora = Lora({ display: "swap", preload: false, subsets: ["latin"], variable: "--font-p-lora" });
const nunito = Nunito({ display: "swap", preload: false, subsets: ["latin"], variable: "--font-p-nunito" });
const almarai = Almarai({ display: "swap", preload: false, subsets: ["arabic"], weight: ["400", "700"], variable: "--font-p-almarai" });
const reemKufi = Reem_Kufi({ display: "swap", preload: false, subsets: ["arabic"], variable: "--font-p-reem-kufi" });

/** Class names declaring the preset fonts' CSS variables (on <html>). */
export const presetFontVariables = [cormorant, jost, notoKufi, amiri, montserrat, inter, cairo, lora, nunito, almarai, reemKufi]
  .map((f) => f.variable)
  .join(" ");
