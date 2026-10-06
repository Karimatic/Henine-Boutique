/**
 * "Install the administration as an app": once installed, the browser lets it play the
 * new-order sound as soon as it opens (no click needed), and it gets its own icon and window.
 * The browser's install offer arrives once, early: it is kept here until the button uses it.
 */
import { useSyncExternalStore } from "react";

interface InstallPrompt extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}

let offer: InstallPrompt | null = null;
const listeners = new Set<() => void>();
const changed = () => listeners.forEach((l) => l());

window.addEventListener("beforeinstallprompt", (e) => {
  e.preventDefault();
  offer = e as InstallPrompt;
  changed();
});
window.addEventListener("appinstalled", () => {
  offer = null;
  changed();
});

/** Running as the installed app (its own window). */
export const isInstalled = () => window.matchMedia("(display-mode: standalone)").matches;

/** The install offer, if the browser made one (Chrome / Edge / Android). */
export function useInstallOffer() {
  const current = useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => offer,
  );
  return current
    ? async () => {
        await current.prompt();
        const { outcome } = await current.userChoice;
        if (outcome === "accepted") {
          offer = null;
          changed();
        }
        return outcome === "accepted";
      }
    : null;
}
