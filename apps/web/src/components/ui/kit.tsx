"use client";

import { formatDA, imageSrcSet, imageUrl, type ImageRef } from "@henine/shared";
import { useLocale } from "@/lib/locale";

export function Price({ value, compareAt, className = "" }: { value: number; compareAt?: number | null; className?: string }) {
  const { locale } = useLocale();
  const off = compareAt && compareAt > value ? Math.round(((compareAt - value) / compareAt) * 100) : null;
  return (
    <span className={`inline-flex flex-wrap items-baseline gap-x-2 ${className}`}>
      <span className="font-semibold text-ink" dir="ltr">
        {formatDA(value, locale)}
      </span>
      {off ? (
        <>
          <s className="text-sm text-ink-soft" dir="ltr">
            {formatDA(compareAt!, locale)}
          </s>
          <span className="rounded-full bg-rose-100 px-2 py-0.5 text-xs font-semibold text-rose-700" dir="ltr">
            -{off}%
          </span>
        </>
      ) : null}
    </span>
  );
}

export function Stars({ value, size = 14 }: { value: number; size?: number }) {
  return (
    <span className="inline-flex text-gold" aria-label={`${value}/5`} dir="ltr">
      {[1, 2, 3, 4, 5].map((i) => (
        <svg key={i} width={size} height={size} viewBox="0 0 20 20" aria-hidden="true" fill={i <= Math.round(value) ? "currentColor" : "none"} stroke="currentColor" strokeWidth="1.2">
          <path d="m10 1.8 2.5 5.2 5.7.8-4.1 4 1 5.6-5.1-2.7-5.1 2.7 1-5.6-4.1-4 5.7-.8L10 1.8Z" />
        </svg>
      ))}
    </span>
  );
}

/* ── Product imagery: real photo (blur-up) or an elegant silhouette placeholder ── */

const SILHOUETTES: Record<string, string> = {
  // dress
  robes: "M44 14c4 5 8 7 16 7s12-2 16-7l10 6-8 16 6 8c-2 22 4 44 14 62H22c10-18 16-40 14-62l6-8-8-16 10-6Z",
  // pyjama set (shirt + trousers)
  pyjamas: "M40 12h40l16 10-8 14-8-4v30H40V32l-8 4-8-14 16-10Zm0 64h40l4 42H66l-6-30-6 30H36l4-42Z",
  // nightie / lingerie
  lingerie: "M46 14v16c-6 8-10 16-10 26 0 16 6 34 0 58h48c-6-24 0-42 0-58 0-10-4-18-10-26V14h-4v14c-4 3-8 4-10 4s-6-1-10-4V14h-4Z",
};

export function ProductImage({
  image,
  alt,
  category,
  color,
  sizes = "(min-width: 768px) 33vw, 50vw",
  priority = false,
  className = "",
}: {
  image: ImageRef | null;
  alt: string;
  category?: string | null;
  color?: string | null;
  sizes?: string;
  priority?: boolean;
  className?: string;
}) {
  // callers may position the frame themselves ("absolute inset-0"); otherwise it is the positioning context
  const pos = className.split(/\s+/).some((c) => c === "absolute" || c === "fixed") ? "" : "relative";
  if (image) {
    return (
      <div className={`${pos} overflow-hidden bg-ivory-deep ${className}`} style={image.lqip ? { backgroundImage: `url(${image.lqip})`, backgroundSize: "cover" } : undefined}>
        <img
          src={imageUrl(image, 960)}
          srcSet={imageSrcSet(image)}
          sizes={sizes}
          alt={alt}
          width={image.width}
          height={image.height}
          loading={priority ? "eager" : "lazy"}
          fetchPriority={priority ? "high" : "auto"}
          decoding="async"
          className="absolute inset-0 size-full object-cover"
        />
      </div>
    );
  }
  const path = SILHOUETTES[category ?? ""] ?? SILHOUETTES.robes!;
  const fill = color ?? "#e8b4bc";
  return (
    <div className={`${pos} overflow-hidden bg-gradient-to-b from-ivory-deep to-rose-100 ${className}`} role="img" aria-label={alt}>
      <svg viewBox="0 0 120 130" className="absolute inset-0 m-auto h-[78%] w-[78%]" aria-hidden="true">
        <path d={path} fill={fill} stroke="rgb(42 26 36 / .18)" strokeWidth="1.2" strokeLinejoin="round" />
        <path d={path} fill="url(#sheen)" opacity=".35" />
        <defs>
          <linearGradient id="sheen" x1="0" x2="1" y1="0" y2="1">
            <stop offset="0" stopColor="#fff" />
            <stop offset=".5" stopColor="#fff" stopOpacity="0" />
          </linearGradient>
        </defs>
      </svg>
    </div>
  );
}

export function Spinner({ className = "size-5" }: { className?: string }) {
  return <span className={`inline-block animate-spin rounded-full border-2 border-current border-t-transparent ${className}`} aria-hidden="true" />;
}

export function ErrorBox({ onRetry }: { onRetry?: () => void }) {
  const { t } = useLocale();
  return (
    <div className="rounded-card border border-line bg-ivory p-6 text-center text-sm text-ink-soft">
      <p>{t.common.error}</p>
      {onRetry && (
        <button type="button" onClick={onRetry} className="mt-3 rounded-full border border-ink/15 px-4 py-2 font-semibold text-ink">
          {t.common.retry}
        </button>
      )}
    </div>
  );
}

export function PageTitle({ children }: { children: React.ReactNode }) {
  return <h1 className="heading-display mb-6 text-3xl md:text-4xl">{children}</h1>;
}

export const inputCls =
  "h-12 w-full rounded-xl border border-line bg-white px-4 text-ink shadow-[inset_0_1px_2px_rgb(42_26_36/0.04)] outline-none transition placeholder:text-ink-soft/60 focus:border-plum-600 focus:ring-2 focus:ring-plum-600/15";
