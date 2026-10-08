import { CheckTokens, retryOnCheckFailure } from "@henine/shared";
import { useCallback, useEffect, useRef } from "react";
import { ApiError } from "@/lib/api";

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

export function Turnstile({
  siteKey,
  onToken,
  locale,
  onReady,
}: {
  siteKey: string;
  onToken: (token: string) => void;
  locale: string;
  /** receives a function asking the widget for a new token (each token works once) */
  onReady?: (reset: () => void) => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const onTokenRef = useRef(onToken);
  const onReadyRef = useRef(onReady);
  useEffect(() => {
    onTokenRef.current = onToken;
    onReadyRef.current = onReady;
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
          "error-callback": () => onTokenRef.current(""),
        });
        const id = widgetId;
        onReadyRef.current?.(() => window.turnstile?.reset(id));
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

/**
 * The form's side of Turnstile (see CheckTokens): `submit(send)` gives `send` a fresh token,
 * and sends once more with a new one if the server says the check failed (late or expired
 * token), so the customer does not see "verification failed" for nothing.
 */
export function useTurnstileToken() {
  const box = useRef<CheckTokens | null>(null);
  box.current ??= new CheckTokens();
  const onToken = useCallback((t: string) => box.current!.set(t), []);
  const onReady = useCallback((reset: () => void) => box.current!.onRefresh(reset), []);
  const submit = useCallback(
    <T,>(send: (token: string) => Promise<T>) =>
      retryOnCheckFailure(
        async () => send(await box.current!.take()),
        (err) => err instanceof ApiError && err.code === "turnstile_failed",
      ),
    [],
  );
  return { onToken, onReady, submit };
}
