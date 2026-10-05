/**
 * Operational alerts for the team (Admin → bell): orders waiting past their SLA, orders
 * ready to ship, critically low stock, customer problems, exchange requests.
 *
 * One alert per situation (`dedupe_key`): the 5-minute cron refreshes the counts, reopens an
 * alert when the situation comes back, and resolves it by itself once it's gone.
 */
import { slaLimitMinutes, type SlaSettings } from "@henine/shared";
import type { Env } from "../env";
import { liveEvent } from "./live";
import { getSettings } from "./settings";

export type AlertPriority = "high" | "medium" | "low";

export interface AlertInput {
  kind: string;
  priority: AlertPriority;
  entity?: string | null;
  entityId?: string | number | null;
  message: string;
  dedupeKey: string;
}

const UPSERT = `INSERT INTO alerts (kind, priority, entity, entity_id, message, dedupe_key, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(dedupe_key) DO UPDATE SET
       message = excluded.message, priority = excluded.priority,
       created_at = CASE WHEN alerts.resolved_at IS NOT NULL THEN excluded.created_at ELSE alerts.created_at END,
       read_at = CASE WHEN alerts.resolved_at IS NOT NULL THEN NULL ELSE alerts.read_at END,
       resolved_by = CASE WHEN alerts.resolved_at IS NOT NULL THEN NULL ELSE alerts.resolved_by END,
       resolved_at = NULL
     RETURNING id, created_at`;

function upsertStmt(env: Env, a: AlertInput, now: number) {
  return env.DB.prepare(UPSERT).bind(a.kind, a.priority, a.entity ?? null, a.entityId == null ? null : String(a.entityId), a.message, a.dedupeKey, now);
}

const toEvent = (a: AlertInput, id: number, at: number) =>
  ({ id, kind: a.kind, priority: a.priority, message: a.message, entity: a.entity ?? null, entityId: a.entityId == null ? null : String(a.entityId), at });

/**
 * Creates the alert, or refreshes its message. A resolved alert whose situation is back is
 * reopened (unread). New and reopened alerts are pushed live to the admin.
 */
export async function raiseAlert(env: Env, a: AlertInput): Promise<void> {
  const now = Date.now();
  const row = await upsertStmt(env, a, now).first<{ id: number; created_at: number }>();
  if (row && row.created_at === now) await liveEvent(env, { type: "alert", ...toEvent(a, row.id, now) });
}

/** Resolves the alerts of one kind whose situation is over (keys not in `stillOpen`). */
function resolveGoneStmt(env: Env, kind: string, stillOpen: string[], now: number) {
  const ph = stillOpen.map(() => "?").join(",");
  return env.DB.prepare(
    `UPDATE alerts SET resolved_at = ?, resolved_by = 'system' WHERE kind = ? AND resolved_at IS NULL${stillOpen.length ? ` AND dedupe_key NOT IN (${ph})` : ""}`,
  ).bind(now, kind, ...stillOpen);
}

export function resolveAlertStmt(env: Env, dedupeKey: string, by: string) {
  return env.DB.prepare("UPDATE alerts SET resolved_at = ?, resolved_by = ? WHERE dedupe_key = ? AND resolved_at IS NULL").bind(Date.now(), by, dedupeKey);
}

const STAGE_FR = { confirm: "confirmation", prepare: "préparation", ship: "expédition" } as const;

/** SQL: when the order entered its current status (its last status event, else its creation). */
const SINCE_SQL = `COALESCE((SELECT MAX(e.created_at) FROM order_events e WHERE e.order_id = o.id AND e.kind = 'status' AND e.to_status = o.status), o.created_at)`;

/** Orders past their SLA right now (same rule as the "En retard" filter of the orders list). */
export function lateOrdersSql(now: number, sla: SlaSettings): string {
  const m = 60_000;
  return `((o.status = 'nouvelle' AND ${SINCE_SQL} < ${now - sla.confirmMinutes * m})
        OR (o.status = 'confirmee' AND ${SINCE_SQL} < ${now - sla.prepareMinutes * m})
        OR (o.status = 'en_preparation' AND ${SINCE_SQL} < ${now - sla.shipMinutes * m}))`;
}

/** The 5-minute cron: refresh every automatic alert. */
export async function scanAlerts(env: Env): Promise<void> {
  const { operations } = await getSettings(env, ["operations"]);
  const sla = operations.sla;
  const now = Date.now();
  const [late, ready, low] = await env.DB.batch([
    env.DB.prepare(
      `SELECT o.id, o.public_code, o.status, ${SINCE_SQL} AS since FROM orders o WHERE ${lateOrdersSql(now, sla)} ORDER BY since LIMIT 50`,
    ),
    env.DB.prepare("SELECT COUNT(*) AS n FROM orders WHERE status = 'en_preparation' AND packed_at IS NOT NULL"),
    env.DB.prepare(
      `SELECT v.id, v.sku, p.name_fr, v.stock_on_hand - v.stock_reserved AS available
         FROM variants v JOIN products p ON p.id = v.product_id
        WHERE v.is_active = 1 AND p.status = 'published' AND v.stock_on_hand - v.stock_reserved <= 1
          AND EXISTS (SELECT 1 FROM order_items oi JOIN orders o ON o.id = oi.order_id WHERE oi.variant_id = v.id AND o.created_at > ?)
        LIMIT 30`,
    ).bind(now - 30 * 86400_000),
  ]);

  const raise: AlertInput[] = [];
  const open: Record<string, string[]> = { late_order: [], unconfirmed: [], ready_to_ship: [], low_stock: [] };
  const add = (a: AlertInput) => {
    raise.push(a);
    open[a.kind]!.push(a.dedupeKey);
  };

  // late orders: one alert per order and step (the oldest first, a few per run)
  const lateRows = late!.results as { id: number; public_code: string; status: "nouvelle" | "confirmee" | "en_preparation"; since: number }[];
  for (const r of lateRows.slice(0, 15)) {
    const stage = r.status === "nouvelle" ? "confirm" : r.status === "confirmee" ? "prepare" : "ship";
    const over = Math.floor((now - r.since) / 60_000) - slaLimitMinutes(stage, sla);
    add({
      kind: "late_order", priority: stage === "confirm" ? "high" : "medium", entity: "order", entityId: r.id, dedupeKey: `late:${r.id}:${r.status}`,
      message: `Commande ${r.public_code} en retard (${STAGE_FR[stage]}) de ${duration(over)}.`,
    });
  }
  // keep the alerts of late orders beyond the first 15 open too
  for (const r of lateRows.slice(15)) open.late_order!.push(`late:${r.id}:${r.status}`);

  // all orders waiting for their confirmation call, as one line
  const unconfirmed = lateRows.filter((r) => r.status === "nouvelle").length;
  if (unconfirmed >= 2) {
    add({
      kind: "unconfirmed", priority: "high", entity: "orders", entityId: "a_confirmer", dedupeKey: "unconfirmed",
      message: `${unconfirmed} commandes ne sont pas confirmées depuis plus de ${duration(sla.confirmMinutes)}.`,
    });
  }

  // parcels packed and waiting for the carrier
  const readyN = (ready!.results[0] as { n: number }).n;
  if (readyN > 0) {
    add({
      kind: "ready_to_ship", priority: "low", entity: "orders", entityId: "en_cours", dedupeKey: "ready_to_ship",
      message: `${readyN} commande${readyN > 1 ? "s sont prêtes" : " est prête"} à expédier.`,
    });
  }

  // sizes at 0 or 1 piece that sold in the last 30 days
  for (const v of low!.results as { id: number; sku: string; name_fr: string; available: number }[]) {
    add({
      kind: "low_stock", priority: v.available <= 0 ? "medium" : "low", entity: "variant", entityId: v.id, dedupeKey: `stock:${v.id}`,
      message: v.available <= 0 ? `Rupture : ${v.name_fr} (${v.sku}) est épuisé.` : `Stock critique : ${v.name_fr} (${v.sku}), plus qu'une pièce.`,
    });
  }

  // one batch for everything, then one live message with what is new
  const res = await env.DB.batch([
    ...raise.map((a) => upsertStmt(env, a, now)),
    ...Object.entries(open).map(([kind, keys]) => resolveGoneStmt(env, kind, keys, now)),
  ]);
  const fresh = raise
    .map((a, i) => ({ a, row: res[i]!.results[0] as { id: number; created_at: number } | undefined }))
    .filter((x) => x.row && x.row.created_at === now)
    .map((x) => toEvent(x.a, x.row!.id, now));
  if (fresh.length) await liveEvent(env, { type: "alerts", items: fresh });
}

function duration(minutes: number): string {
  if (minutes < 60) return `${minutes} min`;
  const h = Math.floor(minutes / 60);
  if (h < 48) return `${h} h${minutes % 60 ? ` ${String(minutes % 60).padStart(2, "0")}` : ""}`;
  return `${Math.floor(h / 24)} j`;
}

/** A customer reported a problem with her delivery. */
export function receiptIssueAlert(env: Env, o: { id: number; public_code: string }, issue: string) {
  return raiseAlert(env, {
    kind: "receipt_issue", priority: "high", entity: "order", entityId: o.id, dedupeKey: `receipt:${o.id}`,
    message: `Problème signalé par la cliente sur ${o.public_code} : ${issue}`,
  });
}

/** A customer asked for an exchange. */
export function exchangeAlert(env: Env, x: { id: number; orderId: number; code: string; product: string; from: string | null; to: string }) {
  return raiseAlert(env, {
    kind: "exchange", priority: "medium", entity: "order", entityId: x.orderId, dedupeKey: `exchange:${x.id}`,
    message: `Demande d'échange ${x.code} : ${x.product} ${x.from ?? ""} → ${x.to}`,
  });
}

