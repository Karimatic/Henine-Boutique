import { useEffect } from "react";

/** Sends uncaught browser errors to Admin → Erreurs (sampled, capped per page view). */
export function ErrorReporter() {
  useEffect(() => {
    let sent = 0;
    const report = (message: string, stack?: string) => {
      if (sent >= 3 || Math.random() > 0.5) return;
      sent++;
      fetch("/api/log", {
        method: "POST",
        keepalive: true,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: message.slice(0, 500), stack: stack?.slice(0, 4000), url: location.pathname }),
      }).catch(() => undefined);
    };
    const onError = (e: ErrorEvent) => report(e.message, e.error?.stack);
    const onRejection = (e: PromiseRejectionEvent) => report(String(e.reason?.message ?? e.reason), e.reason?.stack);
    window.addEventListener("error", onError);
    window.addEventListener("unhandledrejection", onRejection);
    return () => {
      window.removeEventListener("error", onError);
      window.removeEventListener("unhandledrejection", onRejection);
    };
  }, []);
  return null;
}
