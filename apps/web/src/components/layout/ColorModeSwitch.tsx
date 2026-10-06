import { useColorMode, type ColorMode } from "@/lib/colorMode";
import { useLocale } from "@/lib/locale";

/** ☀️ Clair · 🌙 Sombre · Auto (follows the phone). `tone="dark"` on the dark footer. */
export function ColorModeSwitch({ tone = "light", className = "" }: { tone?: "light" | "dark"; className?: string }) {
  const { t } = useLocale();
  const M = t.plus.mode;
  const [mode, setMode] = useColorMode();
  const options: [ColorMode, string, string][] = [
    ["light", "☀️", M.light],
    ["dark", "🌙", M.dark],
    ["auto", "◐", M.auto],
  ];
  const box = tone === "dark" ? "bg-white/10" : "bg-ivory-deep";
  const on = tone === "dark" ? "bg-white text-noir" : "bg-surface text-ink shadow-sm";
  const off = tone === "dark" ? "text-white/75" : "text-ink-soft";
  return (
    <div role="radiogroup" aria-label={M.label} className={`inline-flex rounded-full p-1 ${box} ${className}`}>
      {options.map(([value, icon, label]) => (
        <button
          key={value}
          type="button"
          role="radio"
          aria-checked={mode === value}
          onClick={() => setMode(value)}
          className={`flex h-9 items-center gap-1.5 rounded-full px-3 text-xs font-semibold transition ${mode === value ? on : off}`}
        >
          <span aria-hidden="true">{icon}</span>
          {label}
        </button>
      ))}
    </div>
  );
}
