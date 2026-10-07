import { useEffect, useState } from "react";

/**
 * A muted video playing in a loop over a picture (home video, banners). Not played for visitors
 * who reduce motion or save data: they keep the picture, which also shows while it loads.
 */
export function LoopVideo({ src, className = "absolute inset-0 size-full object-cover", still = false }: { src: string; className?: string; /** no picture behind: show the first frame when it doesn't play */ still?: boolean }) {
  const [play, setPlay] = useState(false);
  useEffect(() => {
    const saveData = (navigator as Navigator & { connection?: { saveData?: boolean } }).connection?.saveData;
    setPlay(!matchMedia("(prefers-reduced-motion: reduce)").matches && !saveData);
  }, []);
  if (!play) return still ? <video src={`${src}#t=0.1`} muted playsInline preload="metadata" aria-hidden="true" className={className} /> : null;
  return (
    <video
      src={src}
      autoPlay
      loop
      playsInline
      preload="auto"
      aria-hidden="true"
      className={className}
      // phones only autoplay a video that is muted before it starts
      ref={(v) => {
        if (v && !v.muted) {
          v.muted = true;
          void v.play().catch(() => undefined);
        }
      }}
    />
  );
}
