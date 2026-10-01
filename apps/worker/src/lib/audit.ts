import type { Env } from "../env";
import { sha256Hex } from "./crypto";

/** Append-only record of admin writes. Diffs must never contain secrets or full PII. */
export function auditStmt(env: Env, actor: string, action: string, entity: string, entityId: string | number | null, diff?: unknown) {
  return env.DB.prepare("INSERT INTO audit_log (actor, action, entity, entity_id, diff, created_at) VALUES (?, ?, ?, ?, ?, ?)").bind(
    actor,
    action,
    entity,
    entityId == null ? null : String(entityId),
    diff === undefined ? null : JSON.stringify(diff),
    Date.now(),
  );
}

/** Grouped error feed (Système → Erreurs). One row per fingerprint, with a counter. */
export async function recordError(
  env: Env,
  source: "client" | "api" | "cron" | "telegram" | "carrier" | "push",
  message: string,
  extra: { stack?: string; url?: string } = {},
) {
  const clean = message.slice(0, 500);
  const fingerprint = (await sha256Hex(`${source}|${clean}|${(extra.url ?? "").split("?")[0]}`)).slice(0, 32);
  const now = Date.now();
  await env.DB.prepare(
    `INSERT INTO error_events (fingerprint, source, message, stack, url, count, status, first_seen, last_seen)
     VALUES (?, ?, ?, ?, ?, 1, 'open', ?, ?)
     ON CONFLICT(fingerprint) DO UPDATE SET count = count + 1, last_seen = excluded.last_seen,
       status = CASE WHEN error_events.status = 'resolved' THEN 'open' ELSE error_events.status END`,
  )
    .bind(fingerprint, source, clean, extra.stack?.slice(0, 4000) ?? null, extra.url?.slice(0, 500) ?? null, now, now)
    .run()
    .catch(() => undefined);
}
