/**
 * Live admin: a WebSocket to /api/admin/live (Durable Object hub). A new order rings (once,
 * whatever the number of open tabs), shows a notification card, updates the "new orders"
 * counter and refreshes the lists. Operational alerts arrive the same way.
 *
 * Browsers only let a page play sound after a click on it: until then a small
 * "🔊 Activer les sons" button is shown; the visual notification always works.
 */
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { api } from "../api";
import { tr } from "../i18n";
import { da } from "./format";

/* ── Device preferences (Paramètres → Notifications) ── */

export const SOUNDS = {
  chime: { label: "Carillon", notes: [[880, 0, 0.18], [1318.5, 0.16, 0.32]] },
  bell: { label: "Cloche", notes: [[1046.5, 0, 0.6], [1568, 0, 0.45]] },
  pop: { label: "Bulle", notes: [[660, 0, 0.09], [990, 0.1, 0.12]] },
  cash: { label: "Caisse", notes: [[1318.5, 0, 0.08], [1760, 0.09, 0.08], [2093, 0.18, 0.25]] },
} as const;
export type SoundKey = keyof typeof SOUNDS;

export interface SoundPrefs {
  sound: boolean;
  volume: number; // 0–1
  tone: SoundKey;
  /** blink the tab title while the admin is in another tab */
  flash: boolean;
  /** system notification (when allowed by the browser) */
  browser: boolean;
}

const PREFS_KEY = "henine.admin.orderAlerts";
export const DEFAULT_PREFS: SoundPrefs = { sound: true, volume: 0.8, tone: "chime", flash: true, browser: false };

export function loadPrefs(): SoundPrefs {
  try {
    return { ...DEFAULT_PREFS, ...(JSON.parse(localStorage.getItem(PREFS_KEY) ?? "{}") as Partial<SoundPrefs>) };
  } catch {
    return DEFAULT_PREFS;
  }
}

export function savePrefs(p: SoundPrefs) {
  try {
    localStorage.setItem(PREFS_KEY, JSON.stringify(p));
  } catch {
    /* private mode */
  }
  window.dispatchEvent(new Event("henine:prefs"));
}

/* ── Sound (Web Audio: no file to download, nothing to allow in the CSP) ── */

let audio: AudioContext | null = null;
function ctx(): AudioContext | null {
  if (!audio) {
    const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctor) return null;
    audio = new Ctor();
  }
  return audio;
}

export function soundReady(): boolean {
  return audio?.state === "running";
}

/** Must run inside a click / key press: browsers block sound before the first interaction. */
export async function unlockSound(): Promise<boolean> {
  const c = ctx();
  if (!c) return false;
  if (c.state !== "running") await c.resume().catch(() => undefined);
  return c.state === "running";
}

export function playTone(tone: SoundKey, volume: number) {
  const c = ctx();
  if (!c || c.state !== "running") return false;
  const t0 = c.currentTime + 0.02;
  for (const [freq, start, dur] of SOUNDS[tone].notes) {
    const osc = c.createOscillator();
    const gain = c.createGain();
    osc.type = "sine";
    osc.frequency.value = freq;
    gain.gain.setValueAtTime(0.0001, t0 + start);
    gain.gain.exponentialRampToValueAtTime(Math.max(volume, 0.01) * 0.5, t0 + start + 0.015);
    gain.gain.exponentialRampToValueAtTime(0.0001, t0 + start + dur);
    osc.connect(gain).connect(c.destination);
    osc.start(t0 + start);
    osc.stop(t0 + start + dur + 0.05);
  }
  return true;
}

/* ── One ring per order, whatever the number of open tabs ── */

/** True for exactly one tab of this browser (Web Locks when available, else a storage flag). */
async function claim(key: string): Promise<boolean> {
  const flag = () => {
    try {
      const k = `henine.live.${key}`;
      if (localStorage.getItem(k)) return false;
      localStorage.setItem(k, String(Date.now()));
      return true;
    } catch {
      return true;
    }
  };
  if (navigator.locks?.request) return navigator.locks.request(`henine-live-${key}`, () => flag());
  return flag();
}

/** Forget old flags (keeps localStorage small). */
function sweepFlags() {
  try {
    const old = Date.now() - 2 * 86400_000;
    for (let i = localStorage.length - 1; i >= 0; i--) {
      const k = localStorage.key(i);
      if (k?.startsWith("henine.live.") && Number(localStorage.getItem(k)) < old) localStorage.removeItem(k);
    }
  } catch {
    /* ignore */
  }
}

/* ── Events ── */

interface OrderEvent {
  type: "order";
  id: number;
  code: string;
  name: string;
  total: number;
  wilaya: string | null;
  at: number;
}
interface AlertItem {
  id: number;
  kind: string;
  priority: "high" | "medium" | "low";
  message: string;
  entity: string | null;
  entityId: string | null;
  at: number;
}
type LiveMessage = OrderEvent | ({ type: "alert" } & AlertItem) | { type: "alerts"; items: AlertItem[] };

interface Card {
  key: string;
  kind: "order" | "alert";
  title: string;
  text: string;
  priority?: AlertItem["priority"];
  orderId?: number;
}

interface LiveState {
  connected: boolean;
  unseen: number;
  needsUnlock: boolean;
  unlock: () => Promise<void>;
  markSeen: () => void;
}

const Ctx = createContext<LiveState>({ connected: false, unseen: 0, needsUnlock: false, unlock: async () => undefined, markSeen: () => undefined });
export const useLive = () => useContext(Ctx);

export function LiveProvider({ enabled, children }: { enabled: boolean; children: ReactNode }) {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const [connected, setConnected] = useState(false);
  const [cards, setCards] = useState<Card[]>([]);
  const [prefs, setPrefs] = useState(loadPrefs);
  const [needsUnlock, setNeedsUnlock] = useState(false);
  const prefsRef = useRef(prefs);
  prefsRef.current = prefs;

  const unseen = useQuery({
    queryKey: ["unseen"],
    queryFn: () => api<{ count: number; last: number | null }>("/orders/unseen"),
    enabled,
    // a safety net only: the WebSocket updates it instantly
    refetchInterval: 5 * 60_000,
  });

  useEffect(() => {
    const onPrefs = () => setPrefs(loadPrefs());
    window.addEventListener("henine:prefs", onPrefs);
    return () => window.removeEventListener("henine:prefs", onPrefs);
  }, []);

  // sound: needs one click on the page; the first click anywhere unlocks it
  useEffect(() => {
    if (!enabled || !prefs.sound) return setNeedsUnlock(false);
    setNeedsUnlock(!soundReady());
    const onFirst = () => void unlockSound().then((ok) => setNeedsUnlock(!ok));
    window.addEventListener("pointerdown", onFirst, { once: true });
    window.addEventListener("keydown", onFirst, { once: true });
    return () => {
      window.removeEventListener("pointerdown", onFirst);
      window.removeEventListener("keydown", onFirst);
    };
  }, [enabled, prefs.sound]);

  // the tab title blinks while the admin looks elsewhere
  const flashTitle = useCallback((text: string) => {
    if (!prefsRef.current.flash || !document.hidden) return;
    const original = document.title;
    let on = false;
    const id = setInterval(() => {
      document.title = (on = !on) ? text : original;
    }, 1000);
    const stop = () => {
      clearInterval(id);
      document.title = original;
      document.removeEventListener("visibilitychange", stop);
    };
    document.addEventListener("visibilitychange", stop);
  }, []);

  const pushCard = useCallback((c: Card) => {
    setCards((list) => [c, ...list.filter((x) => x.key !== c.key)].slice(0, 4));
    if (c.priority !== "high") setTimeout(() => setCards((list) => list.filter((x) => x.key !== c.key)), c.kind === "order" ? 15_000 : 10_000);
  }, []);

  const openOrder = useCallback(
    (id: number) => void navigate({ to: "/commandes", search: (s: Record<string, unknown>) => ({ ...s, o: id }) }),
    [navigate],
  );

  const onOrder = useCallback(
    async (e: OrderEvent) => {
      void qc.invalidateQueries({ queryKey: ["unseen"] });
      void qc.invalidateQueries({ queryKey: ["orders"] });
      void qc.invalidateQueries({ queryKey: ["dashboard"] });
      const title = tr("🔔 Nouvelle commande {0}", { 0: e.code });
      const text = `${e.name} · ${da(e.total)}${e.wilaya ? ` · ${e.wilaya}` : ""}`;
      pushCard({ key: `o${e.id}`, kind: "order", title, text, orderId: e.id });
      flashTitle(title);
      // sound + system notification: one tab only
      if (!(await claim(`o${e.id}`))) return;
      const p = prefsRef.current;
      if (p.sound && !playTone(p.tone, p.volume)) setNeedsUnlock(true);
      if (p.browser && "Notification" in window && Notification.permission === "granted" && document.hidden) {
        try {
          const n = new Notification(tr("🛍️ Nouvelle commande {0}", { 0: e.code }), { body: text, tag: `order-${e.id}`, icon: "/icon.svg" });
          n.onclick = () => {
            window.focus();
            openOrder(e.id);
            n.close();
          };
        } catch {
          /* some browsers only allow notifications from a service worker */
        }
      }
    },
    [qc, pushCard, flashTitle, openOrder],
  );

  const onAlerts = useCallback(
    async (items: AlertItem[]) => {
      void qc.invalidateQueries({ queryKey: ["alerts"] });
      for (const a of items) {
        pushCard({ key: `a${a.id}-${a.at}`, kind: "alert", title: a.priority === "high" ? tr("🔴 Alerte") : tr("⚠️ Alerte"), text: a.message, priority: a.priority, orderId: a.entity === "order" && a.entityId ? Number(a.entityId) : undefined });
      }
      const urgent = items.find((a) => a.priority === "high");
      if (urgent && (await claim(`a${urgent.id}-${urgent.at}`))) {
        const p = prefsRef.current;
        if (p.sound) playTone("bell", p.volume * 0.7);
      }
    },
    [qc, pushCard],
  );

  // the connection: reconnects with a growing delay, keep-alive ping every 30 s
  useEffect(() => {
    if (!enabled) return;
    sweepFlags();
    let ws: WebSocket | null = null;
    let stopped = false;
    let retry = 0;
    let ping: ReturnType<typeof setInterval> | undefined;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const connect = () => {
      if (stopped) return;
      ws = new WebSocket(`${location.protocol === "https:" ? "wss" : "ws"}://${location.host}/api/admin/live`);
      ws.onopen = () => {
        retry = 0;
        setConnected(true);
        // anything missed while disconnected
        void qc.invalidateQueries({ queryKey: ["unseen"] });
        void qc.invalidateQueries({ queryKey: ["alerts"] });
        ping = setInterval(() => ws?.readyState === WebSocket.OPEN && ws.send("ping"), 30_000);
      };
      ws.onmessage = (m) => {
        if (m.data === "pong") return;
        let msg: LiveMessage;
        try {
          msg = JSON.parse(String(m.data)) as LiveMessage;
        } catch {
          return;
        }
        if (msg.type === "order") void onOrder(msg);
        else if (msg.type === "alert") void onAlerts([msg]);
        else if (msg.type === "alerts") void onAlerts(msg.items);
      };
      ws.onclose = (e) => {
        setConnected(false);
        clearInterval(ping);
        if (stopped || e.code === 4001) return; // signed out elsewhere
        timer = setTimeout(connect, Math.min(30_000, 1000 * 2 ** retry++));
      };
    };
    connect();
    return () => {
      stopped = true;
      clearInterval(ping);
      clearTimeout(timer);
      ws?.close();
    };
  }, [enabled, qc, onOrder, onAlerts]);

  const value = useMemo<LiveState>(
    () => ({
      connected,
      unseen: unseen.data?.count ?? 0,
      needsUnlock: enabled && prefs.sound && needsUnlock,
      unlock: async () => setNeedsUnlock(!(await unlockSound())),
      markSeen: () => {
        if (!unseen.data?.count) return;
        qc.setQueryData(["unseen"], { count: 0, last: unseen.data.last });
        void api("/orders/seen", { method: "POST", body: "{}" }).catch(() => undefined);
      },
    }),
    [connected, unseen.data, enabled, prefs.sound, needsUnlock, qc],
  );

  return (
    <Ctx.Provider value={value}>
      {children}
      {cards.length > 0 && (
        <div className="pointer-events-none fixed inset-x-3 top-16 z-[60] flex flex-col items-end gap-2 sm:inset-x-auto sm:end-4 sm:top-20 sm:w-96" aria-live="polite">
          {cards.map((c) => (
            <div
              key={c.key}
              className={`animate-pop pointer-events-auto w-full rounded-2xl border bg-surface p-3.5 shadow-xl ${
                c.kind === "order" ? "border-plum-600/40 ring-2 ring-plum-600/15" : c.priority === "high" ? "border-red-300" : "border-line"
              }`}
              role={c.priority === "high" ? "alert" : "status"}
            >
              <div className="flex items-start gap-3">
                <div className="min-w-0 flex-1">
                  <p className="font-semibold">{c.title}</p>
                  <p className="mt-0.5 text-sm text-ink-soft">{c.text}</p>
                </div>
                <button
                  type="button"
                  aria-label={tr("Fermer")}
                  onClick={() => setCards((l) => l.filter((x) => x.key !== c.key))}
                  className="grid size-8 shrink-0 place-items-center rounded-lg text-ink-soft hover:bg-ivory-deep"
                >
                  ✕
                </button>
              </div>
              {c.orderId != null && (
                <button
                  type="button"
                  onClick={() => {
                    openOrder(c.orderId!);
                    setCards((l) => l.filter((x) => x.key !== c.key));
                  }}
                  className="mt-2.5 inline-flex h-10 w-full items-center justify-center rounded-xl bg-plum-600 text-sm font-semibold text-white sm:w-auto sm:px-4"
                >
                  {tr("Voir la commande")}
                </button>
              )}
            </div>
          ))}
        </div>
      )}
    </Ctx.Provider>
  );
}

/** Topbar button shown until the browser allows sound. */
export function SoundUnlock() {
  const { needsUnlock, unlock } = useLive();
  if (!needsUnlock) return null;
  return (
    <button
      type="button"
      onClick={() => void unlock()}
      className="inline-flex h-9 items-center gap-1.5 whitespace-nowrap rounded-lg bg-amber-100 px-2.5 text-xs font-semibold text-amber-900 hover:bg-amber-200"
      title={tr("Les navigateurs n'autorisent le son qu'après un clic sur la page.")}
    >
      🔊 <span className="hidden sm:inline">{tr("Activer les sons")}</span>
    </button>
  );
}
