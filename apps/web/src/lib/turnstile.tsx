import { useCallback, useEffect, useRef } from "react";

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

/** Values that stand for "no check possible here": never used up, never reset. */
const STANDING = new Set(["no-site-key", "unavailable"]);

/**
 * The form's side of Turnstile. A token works only once and expires after a few minutes, so
 * `take()` (at submit) waits for the check if it is still running, hands the token over once,
 * and asks the widget for a fresh one at once: a second try (after an error) has its own.
 */
export function useTurnstileToken() {
  const state = useRef({ token: "", waiters: [] as ((t: string) => void)[], reset: null as null | (() => void) });
  const onToken = useCallback((t: string) => {
    const s = state.current;
    s.token = t;
    if (t) for (const resolve of s.waiters.splice(0)) resolve(t);
  }, []);
  const onReady = useCallback((reset: () => void) => {
    state.current.reset = reset;
  }, []);
  const take = useCallback(async (): Promise<string> => {
    const s = state.current;
    const t =
      s.token ||
      (await new Promise<string>((resolve) => {
        s.waiters.push(resolve);
        // the server then answers "verification failed": the customer can simply try again
        setTimeout(() => resolve(s.token || "pending"), 15000);
      }));
    if (!STANDING.has(t)) {
      s.token = "";
      s.reset?.();
    }
    return t;
  }, []);
  return { onToken, onReady, take };
}
