import type { FontPreset } from "@henine/shared";

/**
 * Font presets → the self-hosted fonts' CSS variables (declared in lib/fonts.ts). A plain
 * module: the theme code only needs these names, not the font loader.
 */
const VARS: Record<Exclude<FontPreset, "classic">, { display: string; sans: string; arabic: string; arabicDisplay: string }> = {
  elegant: { display: "--font-p-cormorant", sans: "--font-p-jost", arabic: "--font-p-noto-kufi", arabicDisplay: "--font-p-amiri" },
  modern: { display: "--font-p-montserrat", sans: "--font-p-inter", arabic: "--font-p-cairo", arabicDisplay: "--font-p-cairo" },
  soft: { display: "--font-p-lora", sans: "--font-p-nunito", arabic: "--font-p-almarai", arabicDisplay: "--font-p-reem-kufi" },
};

/** The CSS variables a preset overrides (empty for the classic fonts). */
export function presetFontVars(font: FontPreset): Record<string, string> {
  const v = font === "classic" ? null : VARS[font];
  if (!v) return {};
  return {
    "--font-display": `var(${v.display}), Georgia, serif`,
    "--font-sans": `var(${v.sans}), system-ui, sans-serif`,
    "--font-arabic": `var(${v.arabic}), "Segoe UI", Tahoma, sans-serif`,
    "--font-arabic-display": `var(${v.arabicDisplay}), var(${v.arabic}), serif`,
  };
}
