/**
 * Admin → Statistiques → Sources: where customers come from (Instagram, Facebook, the shop's own
 * links…), how many visits and orders each source brings, and the shop's own list of sources
 * (renamed / hidden built-in ones, its own sources with their links, the checkout question).
 */
import { Hono } from "hono";
import { z } from "zod";
import { askableSources, cleanText, CUSTOM_SOURCE_KEY, ORDER_SOURCES, type OrderSource } from "@henine/shared";
import type { AppEnv } from "../../env";
import { auditStmt } from "../../lib/audit";
import { body, HttpError, intParam } from "../../lib/http";
import { CANCELLED_SQL } from "../../lib/orders";
import { bumpCatalogStmt, getSettings, setSettingStmt } from "../../lib/settings";
import { actorOf, requirePermission } from "../../middleware/access";
import { statsRange } from "./system";

export const sourceRoutes = new Hono<AppEnv>();

/** conversion (orders / visits) only once there are enough visits to mean something */
const MIN_VISITS = 5;

sourceRoutes.get("/sources", requirePermission("stats.view"), async (c) => {
  const { since, until, label, days } = statsRange((k) => c.req.query(k));
  const valid = `o.status NOT IN ${CANCELLED_SQL}`;
  const day = (ts: number) => new Date(ts + 3600_000).toISOString().slice(0, 10);
  const [rows, campaigns, visits] = await c.env.DB.batch([
    c.env.DB.prepare(
      `SELECT COALESCE(o.source, 'direct') AS source, COUNT(*) AS placed,
              SUM(CASE WHEN ${valid} THEN 1 ELSE 0 END) AS orders,
              COALESCE(SUM(CASE WHEN ${valid} THEN o.total ELSE 0 END), 0) AS revenue,
              SUM(CASE WHEN o.status = 'livree' THEN 1 ELSE 0 END) AS delivered,
              COALESCE(SUM(CASE WHEN o.status = 'livree' THEN o.total ELSE 0 END), 0) AS delivered_revenue,
              COUNT(DISTINCT o.phone) AS customers
         FROM orders o WHERE o.created_at >= ?1 AND o.created_at < ?2 GROUP BY COALESCE(o.source, 'direct')`,
    ).bind(since, until),
    c.env.DB.prepare(
      `SELECT lower(o.utm_campaign) AS campaign, COUNT(*) AS placed,
              SUM(CASE WHEN ${valid} THEN 1 ELSE 0 END) AS orders, COALESCE(SUM(CASE WHEN ${valid} THEN o.total ELSE 0 END), 0) AS revenue,
              SUM(CASE WHEN o.status = 'livree' THEN 1 ELSE 0 END) AS delivered
         FROM orders o WHERE o.created_at >= ?1 AND o.created_at < ?2 AND o.utm_campaign IS NOT NULL AND o.utm_campaign != ''
        GROUP BY lower(o.utm_campaign) ORDER BY revenue DESC LIMIT 20`,
    ).bind(since, until),
    // visits per source and campaign (counted once per browser session by the store)
    c.env.DB.prepare(
      "SELECT metric, dim, SUM(value) AS n FROM analytics_daily WHERE metric IN ('visits','visits_campaign') AND date >= ? AND date <= ? GROUP BY metric, dim",
    ).bind(day(since), day(until - 1)),
  ]);
  const v = visits!.results as { metric: string; dim: string; n: number }[];
  const seen = (metric: string, dim: string) => v.find((x) => x.metric === metric && x.dim === dim)?.n ?? 0;
  const conv = (orders: number, n: number) => (n >= MIN_VISITS ? Math.round((orders / n) * 1000) / 10 : null);
  const byKey = new Map((rows!.results as { source: string; orders: number }[]).map((r) => [r.source, r]));
  // sources with visits but no order yet are listed too
  for (const x of v) if (x.metric === "visits" && !byKey.has(x.dim)) byKey.set(x.dim, { source: x.dim, orders: 0 });
  const { sources } = await getSettings(c.env, ["sources"]);
  return c.json({
    range: { since, until, label, days },
    settings: sources,
    visits: v.filter((x) => x.metric === "visits").reduce((t, x) => t + x.n, 0),
    rows: [...byKey.values()]
      .map((r) => ({ placed: 0, revenue: 0, delivered: 0, delivered_revenue: 0, customers: 0, ...r, visits: seen("visits", r.source), conversion: conv(r.orders, seen("visits", r.source)) }))
      .sort((a, b) => b.revenue - a.revenue || b.orders - a.orders || b.visits - a.visits),
    campaigns: (campaigns!.results as { campaign: string; orders: number }[]).map((s) => ({ ...s, visits: seen("visits_campaign", s.campaign), conversion: conv(s.orders, seen("visits_campaign", s.campaign)) })),
  });
});

/** The shop's list alone (names on the orders screens). */
sourceRoutes.get("/sources/settings", requirePermission("orders.view"), async (c) => {
  const { sources } = await getSettings(c.env, ["sources"]);
  return c.json(sources);
});

const emoji = z.string().trim().max(16);

sourceRoutes.put("/sources/settings", requirePermission("marketing.edit"), async (c) => {
  const input = await body(
    c,
    z.object({
      builtIn: z.partialRecord(z.enum(ORDER_SOURCES), z.object({ name: cleanText(40).optional(), emoji: emoji.optional(), hidden: z.boolean().optional() })),
      custom: z
        .array(z.object({ key: z.string().trim().toLowerCase().regex(CUSTOM_SOURCE_KEY), name: cleanText(40).pipe(z.string().min(1)), emoji }))
        .max(40),
      ask: z.boolean(),
    }),
  );
  const keys = input.custom.map((s) => s.key);
  if (new Set(keys).size !== keys.length) throw new HttpError(422, "duplicate_source");
  if (keys.some((k) => (ORDER_SOURCES as readonly string[]).includes(k))) throw new HttpError(422, "reserved_source");
  const next = { builtIn: input.builtIn as Partial<Record<OrderSource, { name?: string; emoji?: string; hidden?: boolean }>>, custom: input.custom, ask: input.ask };
  await c.env.DB.batch([
    setSettingStmt(c.env, "sources", next),
    // the store's checkout question reads it through the cached /site
    bumpCatalogStmt(c.env),
    auditStmt(c.env, actorOf(c.get("member")), "update", "settings", "sources", next),
  ]);
  return c.json(next);
});

/** The team corrects where an order came from (she said so on the phone). */
sourceRoutes.patch("/orders/:id/source", requirePermission("orders.edit"), async (c) => {
  const id = intParam(c, "id");
  const { source } = await body(c, z.object({ source: z.string().trim().max(30) }));
  const { sources } = await getSettings(c.env, ["sources"]);
  const allowed = new Set<string>([...ORDER_SOURCES, ...askableSources(sources), ...sources.custom.map((s) => s.key)]);
  if (!allowed.has(source)) throw new HttpError(422, "unknown_source");
  const before = await c.env.DB.prepare("SELECT source FROM orders WHERE id = ?").bind(id).first<{ source: string | null }>();
  if (!before) throw new HttpError(404, "not_found");
  await c.env.DB.batch([
    c.env.DB.prepare("UPDATE orders SET source = ? WHERE id = ?").bind(source, id),
    auditStmt(c.env, actorOf(c.get("member")), "update", "order", id, { source: { from: before.source, to: source } }),
  ]);
  return c.json({ ok: true, source });
});
