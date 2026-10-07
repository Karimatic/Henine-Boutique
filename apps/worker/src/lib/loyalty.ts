/**
 * Points that expire (Admin → Fidélité → Validité des points). Points are spent oldest first:
 * what a customer earned before the cut-off and has not spent since (orders paid with points,
 * reversals, earlier expiries) expires, and is written in her points history as "expiry".
 * Runs every evening with the daily cron; validity 0 = points never expire.
 */
import type { Env } from "../env";
import { getSettings } from "./settings";

const DAY = 86_400_000;

/** Points to remove now: old points not consumed by anything going out, never more than the balance. */
export function pointsToExpire(oldIn: number, totalOut: number, balance: number): number {
  return Math.max(0, Math.min(balance, oldIn - totalOut));
}

export async function expirePoints(env: Env, now = Date.now()): Promise<number> {
  const { loyalty } = await getSettings(env, ["loyalty"]);
  if (!loyalty.expiry_days || loyalty.expiry_days <= 0) return 0;
  const cutoff = now - loyalty.expiry_days * DAY;
  const { results } = await env.DB.prepare(
    `SELECT c.id, c.points_balance AS balance,
            COALESCE((SELECT SUM(l.delta) FROM loyalty_ledger l WHERE l.customer_id = c.id AND l.delta > 0 AND l.created_at < ?), 0) AS old_in,
            COALESCE((SELECT -SUM(l.delta) FROM loyalty_ledger l WHERE l.customer_id = c.id AND l.delta < 0), 0) AS total_out
       FROM customers c
      WHERE c.points_balance > 0
        AND EXISTS (SELECT 1 FROM loyalty_ledger l WHERE l.customer_id = c.id AND l.delta > 0 AND l.created_at < ?)
      LIMIT 500`,
  )
    .bind(cutoff, cutoff)
    .all<{ id: number; balance: number; old_in: number; total_out: number }>();
  const stmts: D1PreparedStatement[] = [];
  let expired = 0;
  for (const r of results) {
    const n = pointsToExpire(r.old_in, r.total_out, r.balance);
    if (!n) continue;
    expired += n;
    stmts.push(
      env.DB.prepare("UPDATE customers SET points_balance = MAX(points_balance - ?, 0) WHERE id = ?").bind(n, r.id),
      env.DB.prepare("INSERT INTO loyalty_ledger (customer_id, delta, reason, actor, created_at) VALUES (?, ?, 'expiry', 'system', ?)").bind(r.id, -n, now),
    );
  }
  for (let i = 0; i < stmts.length; i += 100) await env.DB.batch(stmts.slice(i, i + 100));
  return expired;
}
