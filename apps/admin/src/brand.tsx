/**
 * Henine Boutique brand assets, same as the storefront: the five-petal blossom and the
 * Playfair Display italic wordmark. In the admin the wordmark is "written" in on load,
 * then a slow flow of pink, rose, gold, lavender and peach runs through the letters,
 * with a few gold sparkles (CSS only, see .wordmark in styles.css).
 */

export function Blossom({ size = 28, className = "" }: { size?: number; className?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" aria-hidden="true" className={className}>
      <g fill="var(--color-rose-300)" stroke="var(--color-rose-500)" strokeWidth="0.8">
        {[0, 72, 144, 216, 288].map((deg) => (
          <ellipse key={deg} cx="16" cy="8.5" rx="5.2" ry="7" transform={`rotate(${deg} 16 16)`} />
        ))}
      </g>
      <circle cx="16" cy="16" r="3.2" fill="var(--color-gold)" />
    </svg>
  );
}

const SIZES = {
  sm: { text: "text-xl", blossom: 24, gap: "gap-1.5", sub: "text-[10px]" },
  md: { text: "text-[1.4rem]", blossom: 30, gap: "gap-2", sub: "text-[11px]" },
  // phones: must fit a ~310 px card (no wrapping, the word is one mark)
  lg: { text: "text-[1.7rem] min-[400px]:text-3xl sm:text-[2.6rem]", blossom: 38, gap: "gap-2.5", sub: "text-[11px] sm:text-xs" },
} as const;

export function Wordmark({
  size = "md",
  subtitle,
  iconOnly = false,
  className = "",
}: {
  size?: keyof typeof SIZES;
  subtitle?: string;
  iconOnly?: boolean;
  className?: string;
}) {
  const s = SIZES[size];
  return (
    <span className={`relative inline-flex items-center ${s.gap} ${className}`} aria-label="Henine Boutique">
      <Blossom size={s.blossom} className="wordmark-blossom shrink-0" />
      {!iconOnly && (
        <span className="relative flex min-w-0 flex-col" aria-hidden="true">
          <span className={`wordmark whitespace-nowrap ${s.text}`} dir="ltr">
            Henine Boutique
          </span>
          {subtitle && <span className={`${s.sub} font-semibold uppercase tracking-[0.22em] text-ink-soft`}>{subtitle}</span>}
          {/* twinkles just past the end of the word, never over the letters */}
          <span className="wordmark-sparkle -end-3 -top-1.5 text-[10px]" style={{ animationDelay: "1.4s" }}>
            ✦
          </span>
          <span className="wordmark-sparkle -end-4.5 top-[38%] text-[7px]" style={{ animationDelay: "2.6s" }}>
            ✦
          </span>
        </span>
      )}
    </span>
  );
}
