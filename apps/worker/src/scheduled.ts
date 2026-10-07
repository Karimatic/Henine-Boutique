import { formatDA } from "@henine/shared";
import { expirePoints } from "./lib/loyalty";
import type { Env } from "./env";
import { recordError } from "./lib/audit";
import { scanAlerts } from "./lib/alerts";
import { algiersDate, algiersDayStart } from "./lib/orders";
import { dailyReport as buildDailyReport } from "./lib/reports";
import { processOutbox, sendTelegramText } from "./lib/telegram";
import { sendCampaignBatch, sendRestockPushes } from "./lib/webpush";

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
      // late orders (SLA), parcels ready, critical stock → Admin alerts (one D1 batch)
      run("alerts", scanAlerts(env));
      break;
    case "*/30 * * * *":
      run("callbacks", callbackReminder(env));
      break;
    case "0 20 * * *":
      run("daily_report", dailyReport(env));
      run("purge", purgeExpired(env));
      run("points_expiry", expirePoints(env));
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
  const r = await buildDailyReport(env, algiersDayStart());
  const diff = r.previous.orders ? Math.round(((r.orders - r.previous.orders) / r.previous.orders) * 100) : null;
  await sendTelegramText(
    env,
    [
      `📊 <b>Bilan du ${algiersDate()}</b>`,
      `🛍 Commandes : ${r.orders}${diff != null ? ` (${diff >= 0 ? "+" : ""}${diff} % vs hier)` : ""} · 💰 ${formatDA(r.revenue)}`,
      ...(r.profit != null ? [`💸 Bénéfice estimé : ${formatDA(r.profit)}${r.profitMissingCost ? " <i>(coûts incomplets)</i>" : ""}`] : []),
      `✅ Confirmées : ${r.confirmed}${r.confirmRate != null ? ` · taux ${r.confirmRate} %` : ""} · ❌ Annulées : ${r.cancelled}`,
      `🚚 Expédiées : ${r.shipped} · 🎉 Livrées : ${r.delivered} · ↩️ Retours : ${r.returned}`,
      ...(r.topProduct ? [`🏆 Produit du jour : ${r.topProduct.name} (${r.topProduct.units})`] : []),
      ...(r.topWilaya ? [`📍 Wilaya du jour : ${r.topWilaya.name} (${r.topWilaya.orders})`] : []),
      `⏳ À confirmer : ${r.pending}${r.late ? ` · 🔴 en retard : ${r.late}` : ""}`,
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
