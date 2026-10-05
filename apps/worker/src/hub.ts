/**
 * AdminHub (Durable Object, free plan, SQLite-backed): the admin pages' live connections.
 * Admin tabs connect over a WebSocket (/api/admin/live); when something happens (a new order,
 * an alert) the Worker posts it here and it reaches every open admin tab at once.
 *
 * Hibernatable WebSockets: idle connections cost nothing, and the keep-alive "ping" is answered
 * by the runtime without waking the object.
 */
import { DurableObject } from "cloudflare:workers";
import type { Env } from "./env";

export class AdminHub extends DurableObject<Env> {
  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    ctx.setWebSocketAutoResponse(new WebSocketRequestResponsePair("ping", "pong"));
  }

  override async fetch(req: Request): Promise<Response> {
    const url = new URL(req.url);
    if (url.pathname === "/connect") {
      if (req.headers.get("Upgrade") !== "websocket") return new Response("expected websocket", { status: 426 });
      const { 0: client, 1: server } = new WebSocketPair();
      // tags = what this member may receive (e.g. "orders" with orders.view)
      const tags = (url.searchParams.get("tags") ?? "").split(",").filter((t) => /^[a-z]{1,20}$/.test(t));
      this.ctx.acceptWebSocket(server, ["member:" + (url.searchParams.get("member") ?? "0"), ...tags]);
      return new Response(null, { status: 101, webSocket: client });
    }
    if (url.pathname === "/broadcast" && req.method === "POST") {
      const { tag, event } = (await req.json()) as { tag: string; event: unknown };
      const msg = JSON.stringify(event);
      let sent = 0;
      for (const ws of this.ctx.getWebSockets(tag)) {
        try {
          ws.send(msg);
          sent++;
        } catch {
          /* closing socket */
        }
      }
      return Response.json({ sent });
    }
    if (url.pathname === "/disconnect" && req.method === "POST") {
      // a member signed out / was deactivated: close their open tabs
      const { member } = (await req.json()) as { member: number };
      for (const ws of this.ctx.getWebSockets("member:" + member)) ws.close(4001, "signed out");
      return Response.json({ ok: true });
    }
    return new Response("not found", { status: 404 });
  }

  override async webSocketClose(ws: WebSocket, code: number): Promise<void> {
    try {
      ws.close(code === 1005 ? 1000 : code, "bye");
    } catch {
      /* already closed */
    }
  }
}
