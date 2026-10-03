import { useEffect, useState } from "react";
import { tr } from "../i18n";

/** The admin build this tab runs (its entry file name changes with every new version). */
const current = (() => {
  const el = document.querySelector<HTMLScriptElement>('script[type="module"][src*="/assets/index-"]');
  return el?.src.match(/index-[^/]+\.js/)?.[0] ?? null;
})();

async function latest(): Promise<string | null> {
  try {
    const html = await (await fetch("/admin/", { cache: "no-store" })).text();
    return html.match(/index-[^"/]+\.js/)?.[0] ?? null;
  } catch {
    return null;
  }
}

/**
 * A tab left open keeps running the version it loaded. When a newer one is online (checked
 * when the tab comes back and every 5 minutes), a bar offers to reload it.
 */
export function UpdateBar() {
  const [stale, setStale] = useState(false);
  useEffect(() => {
    if (!current) return;
    const check = () => void latest().then((v) => v && v !== current && setStale(true));
    const onShow = () => document.visibilityState === "visible" && check();
    document.addEventListener("visibilitychange", onShow);
    const id = setInterval(check, 5 * 60_000);
    return () => {
      document.removeEventListener("visibilitychange", onShow);
      clearInterval(id);
    };
  }, []);
  if (!stale) return null;
  return (
    <div className="fixed inset-x-3 top-3 z-[70] mx-auto flex max-w-lg items-center gap-3 rounded-xl bg-plum-600 px-4 py-3 text-sm text-white shadow-lg">
      <span className="flex-1">{tr("✨ Une nouvelle version de l'administration est disponible.")}</span>
      <button type="button" onClick={() => location.reload()} className="shrink-0 rounded-lg bg-white px-3 py-1.5 font-semibold text-plum-700">
        {tr("Recharger")}
      </button>
    </div>
  );
}

/**
 * Page that couldn't load (usually an older open tab after an update): reload once by
 * itself, otherwise a clear message with a button instead of a blank "Something went wrong".
 */
export function RouteError({ error }: { error: unknown }) {
  const message = error instanceof Error ? error.message : String(error);
  useEffect(() => {
    try {
      const last = Number(sessionStorage.getItem("henine.admin.autoReload") ?? 0);
      if (Date.now() - last > 30_000) {
        sessionStorage.setItem("henine.admin.autoReload", String(Date.now()));
        location.reload();
      }
    } catch {
      /* private mode: the button below */
    }
  }, []);
  return (
    <div className="grid min-h-dvh place-items-center p-6">
      <div className="max-w-md rounded-2xl border border-line bg-surface p-6 text-center">
        <p className="text-3xl" aria-hidden="true">🌸</p>
        <p className="mt-2 text-lg font-semibold">{tr("Cette page n'a pas pu s'afficher")}</p>
        <p className="mt-1 text-sm text-ink-soft">{tr("Rechargez la page. Si le problème revient, envoyez une capture de ce message.")}</p>
        <button type="button" onClick={() => location.reload()} className="mt-4 h-11 rounded-full bg-plum-600 px-6 font-semibold text-white">
          {tr("Recharger")}
        </button>
        <p className="mt-4 break-words font-mono text-[11px] text-ink-soft" dir="ltr">{message}</p>
      </div>
    </div>
  );
}
