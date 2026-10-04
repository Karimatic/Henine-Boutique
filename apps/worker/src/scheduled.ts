import { formatDA } from "@henine/shared";
import type { Env } from "./env";
import { recordError } from "./lib/audit";
import { algiersDate, algiersDayStart, periodStats } from "./lib/orders";
import { processOutbox, sendTelegramText } from "./lib/telegram";
import { sendCampaignBatch, sendRestockPushes } from "./lib/webpush";
import { refreshInstagramToken, syncInstagramFollowers } from "./routes/admin/instagram";

/**
 * Cron dispatcher (3 triggers on the free plan, see wrangler.jsonc).
 * Each job must stay small: ≤ 10 ms CPU and ≤ 50 subrequests per invocation.
 */
export async function scheduled(controller: ScheduledController, env: Env, ctx: ExecutionContext) {
  const run = (name: string, job: Promise<unknown>) =>
    ctx.waitUntil(job.catch((err: Error) => recordError(env, "cron", `${name}: ${err.message}`)));
  switch (controller.cron) {
    case "*/5 * * * *":
      run("outbox", processOutbox(env, 10));
      // back-in-stock pushes not sent at restock time (more than one batch, or a network error)
      run("restock_push", sendRestockPushes(env, undefined, 25)); // 10 + 25 + 10 ≤ 50 sub-requests
      // store news to subscribers, next batch
      run("campaign_push", sendCampaignBatch(env, 10));
      break;
    case "*/30 * * * *":
      run("callbacks", callbackReminder(env));
      break;
    case "0 20 * * *":
      run("daily_report", dailyReport(env));
      run("purge", purgeExpired(env));
      run("instagram_token", refreshInstagramToken(env));
      run("instagram_followers", syncInstagramFollowers(env));
      break;
  }
}

async function callbackReminder(env: Env) {
  const due = await env.DB.prepare(
    "SELECT public_code, name FROM orders WHERE status = 'injoignable' AND next_callback_at BETWEEN ? AND ? ORDER BY next_callback_at LIMIT 10",
  )
    .bind(Date.now() - 30 * 60_000, Date.now())
    .all<{ public_code: string; name: string }>();
  if (due.results.length) {
    await sendTelegramText(env, `📞 À rappeler maintenant : ${due.results.map((o) => `${o.public_code} (${o.name.replace(/[<>&]/g, "")})`).join(", ")}`);
  }
}

async function dailyReport(env: Env) {
  const s = await periodStats(env, algiersDayStart());
  const pending = await env.DB.prepare("SELECT COUNT(*) AS n FROM orders WHERE status IN ('nouvelle','injoignable')").first<{ n: number }>();
  await sendTelegramText(
    env,
    [
      `📊 <b>Bilan du ${algiersDate()}</b>`,
      `🛍 Commandes : ${s.orders} <i>(hors annulées)</i>`,
      `💰 Chiffre d'affaires : ${formatDA(s.revenue)}`,
      `✅ Confirmées : ${s.confirmed}${s.confirmRate != null ? ` · taux ${s.confirmRate} %` : ""}`,
      `🎉 Livrées : ${s.delivered} · ↩️ Retours : ${s.returned}`,
      `❌ Annulées : ${s.cancelled}`,
      `⏳ Encore à confirmer (toutes dates) : ${pending?.n ?? 0}`,
    ].join("\n"),
  );
}

async function purgeExpired(env: Env) {
  const now = Date.now();
  await env.DB.batch([
    env.DB.prepare("DELETE FROM rate_hits WHERE expires_at < ?").bind(now),
    env.DB.prepare("DELETE FROM admin_sessions WHERE expires_at < ?").bind(now),
    env.DB.prepare("DELETE FROM auth_challenges WHERE expires_at < ?").bind(now - 86400_000),
    env.DB.prepare("DELETE FROM outbox WHERE done_at IS NOT NULL AND done_at < ?").bind(now - 30 * 86400_000),
    // privacy: drop IP hashes / user agents after 90 days
    env.DB.prepare("UPDATE orders SET ip_hash = NULL, ua_short = NULL WHERE created_at < ? AND ip_hash IS NOT NULL").bind(now - 90 * 86400_000),
    // abandoned checkouts (phone, name) are kept 30 days, then deleted
    env.DB.prepare("DELETE FROM carts WHERE updated_at < ?").bind(now - 30 * 86400_000),
  ]);
}
