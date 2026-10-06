import { useEffect, useRef } from "react";

/**
 * Cloudflare Turnstile (free, privacy-friendly anti-bot). Renders in "managed" mode:
 * usually invisible, sometimes a single click. The token is handed to the parent form.
 */
declare global {
  interface Window {
    turnstile?: {
      render: (el: HTMLElement, opts: Record<string, unknown>) => string;
      reset: (id?: string) => void;
      remove: (id: string) => void;
    };
    __turnstileLoading?: Promise<void>;
  }
}

function loadScript(): Promise<void> {
  if (window.turnstile) return Promise.resolve();
  window.__turnstileLoading ??= new Promise<void>((resolve, reject) => {
    const s = document.createElement("script");
    s.src = "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";
    s.async = true;
    s.onload = () => resolve();
    s.onerror = () => reject(new Error("turnstile_unavailable"));
    document.head.appendChild(s);
  });
  return window.__turnstileLoading;
}

export function Turnstile({ siteKey, onToken, locale }: { siteKey: string; onToken: (token: string) => void; locale: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const onTokenRef = useRef(onToken);
  useEffect(() => {
    onTokenRef.current = onToken;
  });

  useEffect(() => {
    if (!siteKey) {
      onTokenRef.current("no-site-key"); // development without keys: the server skips verification
      return;
    }
    let widgetId: string | undefined;
    let cancelled = false;
    loadScript()
      .then(() => {
        if (cancelled || !ref.current || !window.turnstile) return;
        widgetId = window.turnstile.render(ref.current, {
          sitekey: siteKey,
          language: locale,
          appearance: "interaction-only",
          callback: (t: string) => onTokenRef.current(t),
          "expired-callback": () => onTokenRef.current(""),
        });
      })
      .catch(() => onTokenRef.current("unavailable"));
    return () => {
      cancelled = true;
      if (widgetId && window.turnstile) window.turnstile.remove(widgetId);
    };
  }, [siteKey, locale]);

  return <div ref={ref} className="min-h-0" />;
}

export function newIdempotencyKey(): string {
  return crypto.randomUUID();
}
