import { useEffect, useState } from "react";
import { Blossom } from "@/components/ui/icons";
import { useLocale } from "@/lib/locale";

interface InstallEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}

const SEEN = "henine.visits.v1";
const DISMISSED = "henine.install.dismissed";

/**
 * "Installer Henine Boutique": the store as an app on the home screen (PWA). Offered from
 * the second visit, never again for 30 days once dismissed. Android/desktop use the browser's
 * own install prompt; iPhone gets the two-tap instructions (Safari has no prompt).
 */
export function InstallPrompt() {
  const { t } = useLocale();
  const I = t.plus.install;
  const [event, setEvent] = useState<InstallEvent | null>(null);
  const [ios, setIos] = useState(false);
  const [show, setShow] = useState(false);

  useEffect(() => {
    // the service worker: notifications + offline page + installable
    if ("serviceWorker" in navigator) navigator.serviceWorker.register("/sw.js", { scope: "/" }).catch(() => undefined);
    const standalone = matchMedia("(display-mode: standalone)").matches || (navigator as { standalone?: boolean }).standalone === true;
    if (standalone) return;
    let visits = 0;
    let dismissedAt = 0;
    try {
      visits = Number(localStorage.getItem(SEEN) ?? 0) + 1;
      localStorage.setItem(SEEN, String(visits));
      dismissedAt = Number(localStorage.getItem(DISMISSED) ?? 0);
    } catch {
      return;
    }
    if (visits < 2 || Date.now() - dismissedAt < 30 * 86400_000) return;
    const onPrompt = (e: Event) => {
      e.preventDefault();
      setEvent(e as InstallEvent);
      setTimeout(() => setShow(true), 4000);
    };
    window.addEventListener("beforeinstallprompt", onPrompt);
    const isIos = /iphone|ipad|ipod/i.test(navigator.userAgent) && !/crios|fxios/i.test(navigator.userAgent);
    if (isIos) {
      setIos(true);
      const id = setTimeout(() => setShow(true), 6000);
      return () => {
        clearTimeout(id);
        window.removeEventListener("beforeinstallprompt", onPrompt);
      };
    }
    return () => window.removeEventListener("beforeinstallprompt", onPrompt);
  }, []);

  const dismiss = () => {
    setShow(false);
    try {
      localStorage.setItem(DISMISSED, String(Date.now()));
    } catch {
      /* private mode */
    }
  };
  if (!show || (!event && !ios)) return null;
  return (
    <div className="toast-in fixed inset-x-3 top-[calc(0.75rem+env(safe-area-inset-top))] z-50 mx-auto max-w-md rounded-3xl bg-surface p-4 shadow-[0_18px_50px_-12px_rgb(23_10_16/0.4)] ring-1 ring-line" role="dialog" aria-label={I.title}>
      <div className="flex items-start gap-3">
        <span className="grid size-12 shrink-0 place-items-center rounded-2xl bg-rose-100">
          <Blossom size={30} />
        </span>
        <div className="min-w-0 flex-1">
          <p className="font-semibold">{I.title}</p>
          <p className="mt-0.5 text-sm text-ink-soft">{ios ? I.ios : I.text}</p>
        </div>
      </div>
      <div className="mt-3 flex justify-end gap-2">
        <button type="button" onClick={dismiss} className="h-10 rounded-full px-4 text-sm font-semibold text-ink-soft">
          {I.later}
        </button>
        {event && (
          <button
            type="button"
            onClick={async () => {
              await event.prompt();
              await event.userChoice.catch(() => undefined);
              dismiss();
            }}
            className="h-10 rounded-full bg-plum-600 px-5 text-sm font-semibold text-white"
          >
            {I.cta}
          </button>
        )}
      </div>
    </div>
  );
}
