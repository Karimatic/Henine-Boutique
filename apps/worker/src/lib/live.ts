/**
 * Live events for the admin (see hub.ts): new orders, alerts. Fire-and-forget: a lost event
 * is never a problem, since the admin also refreshes its lists in the background.
 */
import type { Env } from "../env";

export type LiveEvent =
  | { type: "order"; id: number; code: string; name: string; total: number; wilaya: string | null; at: number }
  | ({ type: "alert" } & LiveAlert)
  | { type: "alerts"; items: LiveAlert[] };

export interface LiveAlert {
  id: number;
  kind: string;
  priority: "high" | "medium" | "low";
  message: string;
  entity: string | null;
  entityId: string | null;
  at: number;
}

/** Who receives what: order and alert events go to members allowed to see orders. */
export const LIVE_TAG = "orders";

function hub(env: Env) {
  return env.HUB.get(env.HUB.idFromName("admin"));
}

export async function liveEvent(env: Env, event: LiveEvent): Promise<void> {
  if (!env.HUB) return;
  await hub(env)
    .fetch("https://hub/broadcast", { method: "POST", body: JSON.stringify({ tag: LIVE_TAG, event }) })
    .catch(() => undefined);
}

/** Forwards an admin's WebSocket upgrade to the hub. */
export function liveConnect(env: Env, memberId: number, tags: string[]): Promise<Response> {
  const url = `https://hub/connect?member=${memberId}&tags=${encodeURIComponent(tags.join(","))}`;
  return hub(env).fetch(url, { headers: { Upgrade: "websocket" } });
}

/** Closes a member's live connections (signed out, deactivated, deleted). */
export async function liveDisconnect(env: Env, memberId: number): Promise<void> {
  if (!env.HUB) return;
  await hub(env)
    .fetch("https://hub/disconnect", { method: "POST", body: JSON.stringify({ member: memberId }) })
    .catch(() => undefined);
}
