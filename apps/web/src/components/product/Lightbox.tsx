"use client";

import { useEffect, useRef, useState } from "react";
import { imageSrcSet, imageUrl, type ImageRef } from "@henine/shared";
import { useLocale } from "@/lib/locale";

/**
 * Full-screen gallery: swipe between photos (and the video), pinch or double-tap to zoom,
 * drag to look around a zoomed photo. Esc / arrows on a computer.
 */
export function Lightbox({ images, video, start, name, onClose }: { images: ImageRef[]; video: string | null; start: number; name: string; onClose: () => void }) {
  const { t, ar } = useLocale();
  const G = t.plus.gallery;
  const count = images.length + (video ? 1 : 0);
  const [index, setIndex] = useState(start);
  const track = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = track.current;
    if (el) el.scrollTo({ left: (ar ? -1 : 1) * start * el.clientWidth, behavior: "instant" as ScrollBehavior });
    document.body.style.overflow = "hidden";
    const keys = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
      if (e.key === "ArrowRight") go(ar ? -1 : 1);
      if (e.key === "ArrowLeft") go(ar ? 1 : -1);
    };
    window.addEventListener("keydown", keys);
    return () => {
      document.body.style.overflow = "";
      window.removeEventListener("keydown", keys);
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  function go(step: number) {
    const el = track.current;
    if (!el) return;
    const next = Math.min(count - 1, Math.max(0, Math.round(Math.abs(el.scrollLeft) / el.clientWidth) + step));
    el.scrollTo({ left: (ar ? -1 : 1) * next * el.clientWidth, behavior: "smooth" });
  }

  return (
    <div className="fixed inset-0 z-[60] flex flex-col bg-black text-white" role="dialog" aria-modal="true" aria-label={name}>
      <div className="flex items-center justify-between px-4 pb-2 pt-[calc(0.75rem+env(safe-area-inset-top))]">
        <span className="text-sm tabular-nums text-white/80" dir="ltr">
          {index + 1} / {count}
        </span>
        <span className="hidden text-xs text-white/60 sm:block">{G.zoom}</span>
        <button type="button" onClick={onClose} className="grid size-11 place-items-center rounded-full bg-white/15 text-xl" aria-label={G.close}>
          ✕
        </button>
      </div>
      <div
        ref={track}
        onScroll={(e) => setIndex(Math.round(Math.abs(e.currentTarget.scrollLeft) / e.currentTarget.clientWidth))}
        className="swipe-row flex min-h-0 flex-1 snap-x snap-mandatory overflow-x-auto"
      >
        {images.map((img, i) => (
          <ZoomSlide key={img.src} image={img} alt={i === 0 ? name : ""} active={i === index} />
        ))}
        {video && (
          <div className="grid w-full shrink-0 snap-center place-items-center">
            {index === images.length && <video src={video} controls autoPlay playsInline className="max-h-full max-w-full" />}
          </div>
        )}
      </div>
      {count > 1 && (
        <>
          <button type="button" onClick={() => go(-1)} className="absolute start-3 top-1/2 hidden size-12 -translate-y-1/2 place-items-center rounded-full bg-white/15 text-2xl md:grid" aria-label={G.prev}>
            <span className="rtl:rotate-180">‹</span>
          </button>
          <button type="button" onClick={() => go(1)} className="absolute end-3 top-1/2 hidden size-12 -translate-y-1/2 place-items-center rounded-full bg-white/15 text-2xl md:grid" aria-label={G.next}>
            <span className="rtl:rotate-180">›</span>
          </button>
          <div className="flex justify-center gap-1.5 pb-[calc(1rem+env(safe-area-inset-bottom))] pt-3" aria-hidden="true">
            {Array.from({ length: count }, (_, i) => (
              <span key={i} className={`h-1.5 rounded-full transition-all ${i === index ? "w-5 bg-surface" : "w-1.5 bg-surface/40"}`} />
            ))}
          </div>
        </>
      )}
    </div>
  );
}

/** One photo: double-tap / double-click zooms where tapped, two fingers pinch, one finger pans when zoomed. */
function ZoomSlide({ image, alt, active }: { image: ImageRef; alt: string; active: boolean }) {
  const [z, setZ] = useState({ s: 1, x: 0, y: 0 });
  const box = useRef<HTMLDivElement>(null);
  const pointers = useRef(new Map<number, { x: number; y: number }>());
  const pinch = useRef<{ d: number; s: number } | null>(null);
  const lastTap = useRef(0);
  useEffect(() => {
    if (!active) setZ({ s: 1, x: 0, y: 0 });
  }, [active]);

  const clamp = (s: number, x: number, y: number) => {
    const el = box.current;
    if (!el || s <= 1) return { s: 1, x: 0, y: 0 };
    const mx = (el.clientWidth * (s - 1)) / 2;
    const my = (el.clientHeight * (s - 1)) / 2;
    return { s, x: Math.max(-mx, Math.min(mx, x)), y: Math.max(-my, Math.min(my, y)) };
  };
  const zoomAt = (clientX: number, clientY: number) => {
    const el = box.current!;
    const r = el.getBoundingClientRect();
    if (z.s > 1) return setZ({ s: 1, x: 0, y: 0 });
    const s = 2.5;
    setZ(clamp(s, -(clientX - r.left - r.width / 2) * (s - 1), -(clientY - r.top - r.height / 2) * (s - 1)));
  };

  return (
    <div
      ref={box}
      className="relative grid w-full shrink-0 snap-center place-items-center overflow-hidden"
      style={{ touchAction: z.s > 1 ? "none" : "pan-x" }}
      onDoubleClick={(e) => Date.now() - lastTap.current > 500 && zoomAt(e.clientX, e.clientY)}
      onPointerDown={(e) => {
        pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
        if (pointers.current.size === 2) {
          const [a, b] = [...pointers.current.values()];
          pinch.current = { d: Math.hypot(a!.x - b!.x, a!.y - b!.y), s: z.s };
        }
      }}
      onPointerMove={(e) => {
        const prev = pointers.current.get(e.pointerId);
        if (!prev) return;
        pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
        if (pointers.current.size === 2 && pinch.current) {
          const [a, b] = [...pointers.current.values()];
          const s = Math.min(4, Math.max(1, (pinch.current.s * Math.hypot(a!.x - b!.x, a!.y - b!.y)) / pinch.current.d));
          setZ((c) => clamp(s, c.x, c.y));
        } else if (pointers.current.size === 1 && z.s > 1) {
          setZ((c) => clamp(c.s, c.x + e.clientX - prev.x, c.y + e.clientY - prev.y));
        }
      }}
      onPointerUp={(e) => {
        pointers.current.delete(e.pointerId);
        if (pointers.current.size < 2) pinch.current = null;
        if (e.pointerType === "touch") {
          const now = Date.now();
          if (now - lastTap.current < 280) zoomAt(e.clientX, e.clientY);
          lastTap.current = now;
        }
      }}
      onPointerCancel={(e) => {
        pointers.current.delete(e.pointerId);
        pinch.current = null;
      }}
    >
      <img
        src={imageUrl(image, 1600)}
        srcSet={imageSrcSet(image)}
        sizes="100vw"
        alt={alt}
        draggable={false}
        className="max-h-full max-w-full select-none object-contain transition-transform duration-150 ease-out"
        style={{ transform: `translate(${z.x}px, ${z.y}px) scale(${z.s})` }}
      />
    </div>
  );
}
