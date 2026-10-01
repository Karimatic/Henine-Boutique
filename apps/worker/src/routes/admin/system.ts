/**
 * Admin → Tableau de bord, Analyse, Système (Équipe, Comptes, Contenu, Erreurs) + /me.
 */
import { Hono } from "hono";
import { z } from "zod";
import { cleanText, ROLE_PRESETS } from "@henine/shared";
import type { AppEnv } from "../../env";
import { isDev } from "../../env";
import { auditStmt } from "../../lib/audit";
import { checkPassword, devEcho, hashPassword, passwordKeyValid } from "../../lib/auth";
import { decryptSecret, encryptSecret, maskSecret, randomToken } from "../../lib/crypto";
import { body, HttpError, intParam } from "../../lib/http";
import { mailLayout, mailProvider, sendMail } from "../../lib/mail";
import { algiersDayStart, periodStats } from "../../lib/orders";
import { bumpCatalogStmt, getSetting, getSettings, patchSetting, setSettingStmt } from "../../lib/settings";
import { pollUpdates, processOutbox, sendTelegramText, telegramConfig, tgCall } from "../../lib/telegram";
import { actorOf, requirePermission } from "../../middleware/access";
import { createInvite } from "../auth";

export const systemRoutes = new Hono<AppEnv>();

/* ───────────── Me ───────────── */

systemRoutes.get("/me", async (c) => {
  const m = c.get("member");
  const tg = await getSetting(c.env, "telegram");
  return c.json({
    id: m.id, email: m.email, name: m.name, role: m.role, roleName: m.roleName, permissions: m.permissions,
    dev: isDev(c.env), telegramConfigured: !!(tg.token_enc && tg.chat_id),
  });
});

/** Development only: the admin panel calls this every few seconds to receive Telegram button presses. */
systemRoutes.post("/dev/telegram-poll", async (c) => {
  if (!isDev(c.env)) throw new HttpError(404, "not_found");
  const updates = await pollUpdates(c.env);
  const sent = await processOutbox(c.env, 5);
  return c.json({ updates, sent });
});

/* ───────────── Dashboard ───────────── */

systemRoutes.get("/dashboard", requirePermission("dashboard.view"), async (c) => {
  const dayStart = algiersDayStart();
  const [today, week, month] = await Promise.all([
    periodStats(c.env, dayStart),
    periodStats(c.env, dayStart - 6 * 86400_000),
    periodStats(c.env, dayStart - 29 * 86400_000),
  ]);
  const [pending, lowStock, recent, reviews, messages, callbacks, outbox] = await c.env.DB.batch([
    c.env.DB.prepare("SELECT status, COUNT(*) AS n FROM orders WHERE status IN ('nouvelle','injoignable','confirmee','en_preparation','expediee','en_livraison','retour') GROUP BY status"),
    c.env.DB.prepare(
      `SELECT v.id, v.sku, p.name_fr, v.stock_on_hand - v.stock_reserved AS available FROM variants v JOIN products p ON p.id = v.product_id
        WHERE v.is_active = 1 AND p.status = 'published' AND v.stock_on_hand - v.stock_reserved <= v.low_stock_threshold
        ORDER BY available ASC LIMIT 8`,
    ),
    c.env.DB.prepare(
      `SELECT o.id, o.public_code, o.status, o.name, o.total, o.created_at, w.name_fr AS wilaya FROM orders o LEFT JOIN wilayas w ON w.code = o.wilaya_code
        ORDER BY o.id DESC LIMIT 8`,
    ),
    c.env.DB.prepare("SELECT COUNT(*) AS n FROM reviews WHERE status = 'pending'"),
    c.env.DB.prepare("SELECT COUNT(*) AS n FROM contact_messages WHERE status = 'new'"),
    c.env.DB.prepare("SELECT COUNT(*) AS n FROM orders WHERE status = 'injoignable' AND next_callback_at <= ?").bind(Date.now()),
    c.env.DB.prepare("SELECT COUNT(*) AS n FROM outbox WHERE done_at IS NULL AND attempts > 0"),
  ]);
  // cancelled orders (annulée / doublon / fausse) are never counted as orders or revenue
  return c.json({
    kpis: {
      ordersToday: today.orders,
      revenueToday: today.revenue,
      revenue7: week.revenue,
      revenue30: month.revenue,
      orders7: week.orders,
      cancelledToday: today.cancelled,
      confirmRate7: week.confirmRate,
      avgBasket30: month.orders ? Math.round(month.revenue / month.orders) : null,
    },
    pipeline: Object.fromEntries((pending!.results as { status: string; n: number }[]).map((r) => [r.status, r.n])),
    lowStock: lowStock!.results,
    recent: recent!.results,
    pendingReviews: (reviews!.results[0] as { n: number }).n,
    newMessages: (messages!.results[0] as { n: number }).n,
    callbacksDue: (callbacks!.results[0] as { n: number }).n,
    telegramBacklog: (outbox!.results[0] as { n: number }).n,
  });
});

/* ───────────── Statistiques ───────────── */

systemRoutes.get("/stats", requirePermission("stats.view"), async (c) => {
  const days = Math.min(365, Math.max(7, Number(c.req.query("days") ?? 30)));
  const since = Date.now() - days * 86400_000;
  const valid = "status NOT IN ('annulee','doublon','fausse')";
  const [daily, statusRows, wilayas, channels, hours, top, totals] = await c.env.DB.batch([
    c.env.DB.prepare(
      `SELECT strftime('%Y-%m-%d', (created_at + 3600000) / 1000, 'unixepoch') AS date, COUNT(*) AS orders, COALESCE(SUM(total), 0) AS revenue
         FROM orders WHERE created_at > ? AND ${valid} GROUP BY date ORDER BY date`,
    ).bind(since),
    c.env.DB.prepare("SELECT status, COUNT(*) AS n, COALESCE(SUM(total), 0) AS revenue FROM orders WHERE created_at > ? GROUP BY status").bind(since),
    c.env.DB.prepare(
      `SELECT o.wilaya_code AS code, w.name_fr AS name, COUNT(*) AS orders, COALESCE(SUM(o.total), 0) AS revenue,
              SUM(CASE WHEN o.status IN ('retour','retour_recu') THEN 1 ELSE 0 END) AS returns
         FROM orders o LEFT JOIN wilayas w ON w.code = o.wilaya_code WHERE o.created_at > ? AND o.${valid}
        GROUP BY o.wilaya_code ORDER BY orders DESC LIMIT 20`,
    ).bind(since),
    c.env.DB.prepare(`SELECT channel, COUNT(*) AS orders, COALESCE(SUM(total), 0) AS revenue FROM orders WHERE created_at > ? AND ${valid} GROUP BY channel`).bind(since),
    c.env.DB.prepare(
      `SELECT CAST(strftime('%H', (created_at + 3600000) / 1000, 'unixepoch') AS INTEGER) AS hour, COUNT(*) AS orders
         FROM orders WHERE created_at > ? AND ${valid} GROUP BY hour`,
    ).bind(since),
    c.env.DB.prepare(
      `SELECT oi.product_id, oi.name_fr, SUM(oi.qty) AS units, SUM(oi.unit_price * oi.qty) AS revenue FROM order_items oi JOIN orders o ON o.id = oi.order_id
        WHERE o.created_at > ? AND o.${valid} GROUP BY oi.product_id, oi.name_fr ORDER BY units DESC LIMIT 10`,
    ).bind(since),
    c.env.DB.prepare(
      `SELECT COUNT(*) AS orders, COALESCE(SUM(total), 0) AS revenue, COUNT(DISTINCT customer_id) AS customers,
              SUM(CASE WHEN customer_id IN (SELECT id FROM customers WHERE orders_count > 1) THEN 1 ELSE 0 END) AS repeat_orders
         FROM orders WHERE created_at > ? AND ${valid}`,
    ).bind(since),
  ]);
  const byStatus = Object.fromEntries((statusRows!.results as { status: string; n: number }[]).map((r) => [r.status, r.n]));
  const all = Object.values(byStatus).reduce((s, n) => s + n, 0);
  const reached = (list: string[]) => list.reduce((s, k) => s + (byStatus[k] ?? 0), 0);
  const confirmed = reached(["confirmee", "en_preparation", "expediee", "en_livraison", "livree", "retour", "retour_recu"]);
  const shipped = reached(["expediee", "en_livraison", "livree", "retour", "retour_recu"]);
  const delivered = reached(["livree"]);
  const returned = reached(["retour", "retour_recu"]);
  const t = totals!.results[0] as { orders: number; revenue: number; customers: number; repeat_orders: number };
  return c.json({
    days,
    totals: {
      orders: t.orders,
      revenue: t.revenue,
      avgBasket: t.orders ? Math.round(t.revenue / t.orders) : 0,
      customers: t.customers,
      repeatRate: t.orders ? Math.round((t.repeat_orders / t.orders) * 100) : 0,
      confirmRate: all ? Math.round((confirmed / all) * 100) : null,
      deliveryRate: shipped ? Math.round((delivered / shipped) * 100) : null,
      returnRate: shipped ? Math.round((returned / shipped) * 100) : null,
    },
    funnel: { placed: all, confirmed, shipped, delivered, returned, cancelled: reached(["annulee", "doublon", "fausse"]) },
    daily: daily!.results,
    byStatus,
    wilayas: wilayas!.results,
    channels: channels!.results,
    hours: hours!.results,
    topProducts: top!.results,
  });
});

/* ───────────── Équipe ───────────── */

systemRoutes.get("/team", requirePermission("team.manage"), async (c) => {
  const [members, roles] = await c.env.DB.batch([
    c.env.DB.prepare(
      `SELECT m.id, m.email, m.name, m.phone, m.telegram_user_id, m.is_active, m.last_seen_at, m.created_at, m.email_verified_at,
              (m.password_hash IS NOT NULL) AS has_password, r.key AS role, r.name AS role_name,
              (SELECT COUNT(*) FROM admin_sessions s WHERE s.member_id = m.id AND s.expires_at > ?) AS sessions
         FROM team_members m JOIN roles r ON r.id = m.role_id ORDER BY m.is_active DESC, m.created_at`,
    ).bind(Date.now()),
    c.env.DB.prepare("SELECT key, name, permissions FROM roles ORDER BY id"),
  ]);
  return c.json({ members: members!.results, roles: (roles!.results as { key: string; name: string; permissions: string }[]).map((r) => ({ ...r, permissions: JSON.parse(r.permissions) })) });
});

async function sendInvite(c: Parameters<typeof body>[0], memberId: number, email: string, name: string) {
  const token = await createInvite(c.env, memberId);
  const origin = new URL(c.req.url).origin;
  const url = `${origin}/admin/invitation?token=${token}`;
  const mail = await sendMail(c.env, {
    to: email,
    subject: "Invitation à l'équipe Henine Boutique",
    text: `Bonjour ${name},\n\nVous êtes invitée à rejoindre l'administration de Henine Boutique.\nChoisissez votre mot de passe ici (lien valable 7 jours) :\n${url}`,
    html: mailLayout("Invitation à l'équipe Henine Boutique", [`Bonjour ${name},`, "Vous êtes invitée à rejoindre l'administration de Henine Boutique.", "Ce lien est valable 7 jours."], undefined, { label: "Choisir mon mot de passe", url }),
  });
  return { inviteUrl: url, emailed: mail.delivered && mailProvider(c.env) !== "console", provider: mail.provider };
}

systemRoutes.post("/team", requirePermission("team.manage"), async (c) => {
  const input = await body(c, z.object({ email: z.string().trim().toLowerCase().email().max(120), name: cleanText(60).pipe(z.string().min(2)), role: z.enum(Object.keys(ROLE_PRESETS) as [string, ...string[]]) }));
  const role = await c.env.DB.prepare("SELECT id FROM roles WHERE key = ?").bind(input.role).first<{ id: number }>();
  if (!role) throw new HttpError(422, "unknown_role");
  let member: { id: number } | null;
  try {
    member = await c.env.DB.prepare("INSERT INTO team_members (email, name, role_id, is_active, created_at) VALUES (?, ?, ?, 1, ?) RETURNING id")
      .bind(input.email, input.name, role.id, Date.now())
      .first<{ id: number }>();
  } catch (err) {
    if (String((err as Error).message).includes("UNIQUE")) throw new HttpError(409, "email_taken");
    throw err;
  }
  await c.env.DB.batch([auditStmt(c.env, actorOf(c.get("member")), "invite", "team_member", member!.id, { email: input.email, role: input.role })]);
  return c.json({ id: member!.id, ...(await sendInvite(c, member!.id, input.email, input.name)) }, 201);
});

systemRoutes.post("/team/:id/invite", requirePermission("team.manage"), async (c) => {
  const id = intParam(c, "id");
  const m = await c.env.DB.prepare("SELECT email, name FROM team_members WHERE id = ?").bind(id).first<{ email: string; name: string }>();
  if (!m) throw new HttpError(404, "not_found");
  return c.json(await sendInvite(c, id, m.email, m.name));
});

systemRoutes.patch("/team/:id", requirePermission("team.manage"), async (c) => {
  const id = intParam(c, "id");
  const input = await body(
    c,
    z.object({
      name: cleanText(60).pipe(z.string().min(2)).optional(),
      role: z.enum(Object.keys(ROLE_PRESETS) as [string, ...string[]]).optional(),
      isActive: z.boolean().optional(),
      telegramUserId: z.number().int().positive().nullable().optional(),
      phone: cleanText(20).nullable().optional(),
    }),
  );
  const me = c.get("member");
  if (id === me.id && (input.isActive === false || (input.role && input.role !== me.role))) throw new HttpError(409, "cannot_demote_self");
  if (input.isActive === false || (input.role && input.role !== "owner")) {
    // never leave the shop without an active owner
    const owners = await c.env.DB.prepare(
      "SELECT COUNT(*) AS n FROM team_members m JOIN roles r ON r.id = m.role_id WHERE r.key = 'owner' AND m.is_active = 1 AND m.id != ?",
    )
      .bind(id)
      .first<{ n: number }>();
    const target = await c.env.DB.prepare("SELECT r.key FROM team_members m JOIN roles r ON r.id = m.role_id WHERE m.id = ?").bind(id).first<{ key: string }>();
    if (target?.key === "owner" && !owners?.n) throw new HttpError(409, "last_owner");
  }
  const stmts = [
    c.env.DB.prepare(
      `UPDATE team_members SET name = COALESCE(?, name), role_id = COALESCE((SELECT id FROM roles WHERE key = ?), role_id),
         is_active = COALESCE(?, is_active), telegram_user_id = CASE WHEN ? THEN ? ELSE telegram_user_id END,
         phone = CASE WHEN ? THEN ? ELSE phone END WHERE id = ?`,
    ).bind(
      input.name ?? null, input.role ?? null, input.isActive == null ? null : input.isActive ? 1 : 0,
      "telegramUserId" in input ? 1 : 0, input.telegramUserId ?? null, "phone" in input ? 1 : 0, input.phone ?? null, id,
    ),
    auditStmt(c.env, actorOf(me), "update", "team_member", id, input),
  ];
  if (input.isActive === false) stmts.push(c.env.DB.prepare("DELETE FROM admin_sessions WHERE member_id = ?").bind(id));
  try {
    await c.env.DB.batch(stmts);
  } catch (err) {
    if (String((err as Error).message).includes("telegram_user_id")) throw new HttpError(409, "telegram_id_taken");
    throw err;
  }
  return c.json({ ok: true });
});

systemRoutes.delete("/team/:id/sessions", requirePermission("team.manage"), async (c) => {
  const id = intParam(c, "id");
  await c.env.DB.batch([c.env.DB.prepare("DELETE FROM admin_sessions WHERE member_id = ?").bind(id), auditStmt(c.env, actorOf(c.get("member")), "revoke_sessions", "team_member", id)]);
  return c.json({ ok: true });
});

/* ───────────── Comptes: my account + integrations ───────────── */

systemRoutes.get("/account", async (c) => {
  const m = c.get("member");
  const { results } = await c.env.DB.prepare(
    "SELECT id, user_agent, created_at, last_seen_at, expires_at FROM admin_sessions WHERE member_id = ? AND expires_at > ? ORDER BY last_seen_at DESC",
  )
    .bind(m.id, Date.now())
    .all<{ id: number }>();
  return c.json({ member: { id: m.id, email: m.email, name: m.name, roleName: m.roleName }, sessions: results.map((s) => ({ ...s, current: s.id === m.sessionId })) });
});

systemRoutes.post("/account/password", async (c) => {
  const m = c.get("member");
  const input = await body(c, z.object({ currentKey: z.string().refine(passwordKeyValid), newKey: z.string().refine(passwordKeyValid) }));
  const row = await c.env.DB.prepare("SELECT password_hash, password_salt FROM team_members WHERE id = ?").bind(m.id).first<{ password_hash: string | null; password_salt: string | null }>();
  if (!(await checkPassword(c.env, input.currentKey, row?.password_hash ?? null, row?.password_salt ?? null))) throw new HttpError(403, "wrong_password");
  const { hash, salt } = await hashPassword(c.env, input.newKey);
  await c.env.DB.batch([
    c.env.DB.prepare("UPDATE team_members SET password_hash = ?, password_salt = ? WHERE id = ?").bind(hash, salt, m.id),
    // sign out every other device
    c.env.DB.prepare("DELETE FROM admin_sessions WHERE member_id = ? AND id != ?").bind(m.id, m.sessionId),
    auditStmt(c.env, actorOf(m), "password_change", "team_member", m.id),
  ]);
  return c.json({ ok: true });
});

systemRoutes.delete("/account/sessions/:id", async (c) => {
  await c.env.DB.prepare("DELETE FROM admin_sessions WHERE id = ? AND member_id = ?").bind(intParam(c, "id"), c.get("member").id).run();
  return c.json({ ok: true });
});

systemRoutes.get("/integrations", requirePermission("integrations.manage"), async (c) => {
  const tg = await telegramConfig(c.env);
  const s = await getSettings(c.env, ["integrations", "notifications"]);
  const zrId = await decryptSecret(c.env.SETTINGS_KEY, s.integrations.zr_id_enc);
  return c.json({
    telegram: {
      tokenMasked: maskSecret(tg.token), botUsername: tg.bot_username, chatId: tg.chat_id, chatTitle: tg.chat_title,
      webhookUrl: tg.webhook_url, mode: isDev(c.env) ? "poll" : tg.webhook_url ? "webhook" : "none", trustGroup: s.notifications.trust_group_members,
    },
    mail: { provider: mailProvider(c.env), from: c.env.MAIL_FROM ?? null },
    zr: { configured: !!zrId, idMasked: maskSecret(zrId) },
    pixels: { metaPixelId: s.integrations.meta_pixel_id, tiktokPixelId: s.integrations.tiktok_pixel_id },
    turnstile: { siteKey: c.env.TURNSTILE_SITE_KEY, testKeys: c.env.TURNSTILE_SITE_KEY.startsWith("1x000") },
    publicOrigin: c.env.PUBLIC_ORIGIN,
  });
});

systemRoutes.post("/integrations/telegram/token", requirePermission("integrations.manage"), async (c) => {
  const { token } = await body(c, z.object({ token: z.string().trim().regex(/^\d{5,12}:[A-Za-z0-9_-]{30,50}$/, "token_format") }));
  const me = await tgCall<{ username: string }>(token, "getMe");
  if (!me.ok) throw new HttpError(422, "telegram_token_rejected", { description: me.description });
  await patchSetting(c.env, "telegram", { token_enc: await encryptSecret(c.env.SETTINGS_KEY, token), bot_username: me.result!.username, last_update_id: 0 });
  await c.env.DB.batch([auditStmt(c.env, actorOf(c.get("member")), "update", "integration", "telegram_token")]);
  return c.json({ botUsername: me.result!.username });
});

systemRoutes.post("/integrations/telegram/detect", requirePermission("integrations.manage"), async (c) => {
  const cfg = await telegramConfig(c.env);
  if (!cfg.token) throw new HttpError(409, "telegram_token_missing");
  const res = await tgCall<{ message?: { chat: { id: number; title?: string; type: string; first_name?: string } }; my_chat_member?: { chat: { id: number; title?: string; type: string } } }[]>(
    cfg.token,
    "getUpdates",
    { limit: 100, timeout: 0 },
  );
  if (!res.ok) throw new HttpError(409, "telegram_error", { description: res.description });
  const chats = new Map<number, { id: number; title: string; type: string }>();
  for (const u of res.result ?? []) {
    const chat = u.message?.chat ?? u.my_chat_member?.chat;
    if (chat) chats.set(chat.id, { id: chat.id, title: chat.title ?? (u.message?.chat.first_name ?? "Discussion privée"), type: chat.type });
  }
  return c.json([...chats.values()]);
});

systemRoutes.post("/integrations/telegram/chat", requirePermission("integrations.manage"), async (c) => {
  const input = await body(c, z.object({ chatId: z.string().trim().regex(/^-?\d{3,20}$/), chatTitle: cleanText(80).optional() }));
  await patchSetting(c.env, "telegram", { chat_id: input.chatId, chat_title: input.chatTitle ?? null });
  await c.env.DB.batch([auditStmt(c.env, actorOf(c.get("member")), "update", "integration", "telegram_chat")]);
  return c.json({ ok: true });
});

systemRoutes.post("/integrations/telegram/test", requirePermission("integrations.manage"), async (c) => {
  const ok = await sendTelegramText(c.env, `🌸 Test Henine Boutique : les commandes arriveront ici.\nEnvoyé par ${c.get("member").name.replace(/[<>&]/g, "")}.`);
  if (!ok) throw new HttpError(409, "telegram_test_failed");
  return c.json({ ok: true });
});

systemRoutes.post("/integrations/telegram/webhook", requirePermission("integrations.manage"), async (c) => {
  const cfg = await telegramConfig(c.env);
  if (!cfg.token) throw new HttpError(409, "telegram_token_missing");
  if (!c.env.PUBLIC_ORIGIN.startsWith("https://")) throw new HttpError(409, "https_required");
  const secret = randomToken(24);
  const url = `${c.env.PUBLIC_ORIGIN}/api/tg/webhook`;
  const res = await tgCall(cfg.token, "setWebhook", { url, secret_token: secret, allowed_updates: ["message", "callback_query"], drop_pending_updates: false });
  if (!res.ok) throw new HttpError(409, "telegram_error", { description: res.description });
  await patchSetting(c.env, "telegram", { webhook_secret_enc: await encryptSecret(c.env.SETTINGS_KEY, secret), webhook_url: url });
  return c.json({ webhookUrl: url });
});

systemRoutes.delete("/integrations/telegram", requirePermission("integrations.manage"), async (c) => {
  const cfg = await telegramConfig(c.env);
  if (cfg.token && cfg.webhook_url) await tgCall(cfg.token, "deleteWebhook");
  await patchSetting(c.env, "telegram", { token_enc: null, chat_id: null, chat_title: null, bot_username: null, webhook_secret_enc: null, webhook_url: null, last_update_id: 0 });
  await c.env.DB.batch([auditStmt(c.env, actorOf(c.get("member")), "delete", "integration", "telegram")]);
  return c.json({ ok: true });
});

systemRoutes.put("/integrations/zr", requirePermission("integrations.manage"), async (c) => {
  const input = await body(c, z.object({ id: z.string().trim().min(3).max(120), token: z.string().trim().min(8).max(300) }));
  await patchSetting(c.env, "integrations", {
    zr_id_enc: await encryptSecret(c.env.SETTINGS_KEY, input.id),
    zr_token_enc: await encryptSecret(c.env.SETTINGS_KEY, input.token),
  });
  await c.env.DB.batch([auditStmt(c.env, actorOf(c.get("member")), "update", "integration", "zr_express")]);
  return c.json({ ok: true });
});

systemRoutes.put("/integrations/pixels", requirePermission("integrations.manage"), async (c) => {
  const input = await body(c, z.object({ metaPixelId: z.string().regex(/^\d{5,20}$/).nullable(), tiktokPixelId: z.string().regex(/^[A-Z0-9]{5,30}$/).nullable() }));
  await patchSetting(c.env, "integrations", { meta_pixel_id: input.metaPixelId, tiktok_pixel_id: input.tiktokPixelId });
  return c.json({ ok: true });
});

systemRoutes.post("/integrations/mail/test", requirePermission("integrations.manage"), async (c) => {
  const m = c.get("member");
  const res = await sendMail(c.env, {
    to: m.email,
    subject: "Test d'envoi Henine Boutique",
    text: "Si vous lisez ceci, l'envoi d'emails fonctionne.",
    html: mailLayout("Test d'envoi", ["Si vous lisez ceci, l'envoi d'emails fonctionne. 🌸"]),
  });
  return c.json({ ...res, devNote: devEcho(c, "Mode développement : aucun email réel n'est envoyé (voir la console du serveur).") });
});

/* ───────────── Contenu: delivery prices, pages, store identity ───────────── */

systemRoutes.get("/content/wilayas", requirePermission("delivery.edit"), async (c) => {
  const [rows, verified] = await Promise.all([
    c.env.DB.prepare(
      "SELECT w.*, (SELECT COUNT(*) FROM communes cm WHERE cm.wilaya_code = w.code) AS communes, (SELECT COUNT(*) FROM orders o WHERE o.wilaya_code = w.code) AS orders FROM wilayas w ORDER BY w.code",
    ).all(),
    getSetting(c.env, "shipping.prices_verified"),
  ]);
  return c.json({ rows: rows.results, verified });
});

const priceField = z.number().int().min(0).max(20000).nullable();
systemRoutes.put("/content/wilayas", requirePermission("delivery.edit"), async (c) => {
  const input = await body(
    c,
    z.object({
      codes: z.array(z.number().int().min(1).max(69)).min(1).max(69),
      homePrice: priceField.optional(),
      deskPrice: priceField.optional(),
      delayDays: z.string().trim().max(10).nullable().optional(),
      isActive: z.boolean().optional(),
      markVerified: z.boolean().optional(),
    }),
  );
  const sets: string[] = [];
  const vals: unknown[] = [];
  if ("homePrice" in input) (sets.push("home_price = ?"), vals.push(input.homePrice));
  if ("deskPrice" in input) (sets.push("desk_price = ?"), vals.push(input.deskPrice));
  if ("delayDays" in input) (sets.push("delay_days = ?"), vals.push(input.delayDays));
  if ("isActive" in input) (sets.push("is_active = ?"), vals.push(input.isActive ? 1 : 0));
  const stmts: D1PreparedStatement[] = [];
  if (sets.length) {
    stmts.push(c.env.DB.prepare(`UPDATE wilayas SET ${sets.join(", ")}, updated_at = ? WHERE code IN (${input.codes.map(() => "?").join(",")})`).bind(...vals, Date.now(), ...input.codes));
  }
  if (input.markVerified) stmts.push(setSettingStmt(c.env, "shipping.prices_verified", true));
  stmts.push(bumpCatalogStmt(c.env), auditStmt(c.env, actorOf(c.get("member")), "update", "wilayas", input.codes.join(","), { ...input, codes: undefined }));
  await c.env.DB.batch(stmts);
  return c.json({ ok: true });
});

systemRoutes.get("/content/pages", requirePermission("content.edit"), async (c) => {
  const { results } = await c.env.DB.prepare("SELECT * FROM pages ORDER BY id").all();
  return c.json(results);
});

const pageInput = z.object({
  slug: z.string().trim().regex(/^[a-z0-9-]{2,60}$/),
  titleFr: cleanText(120).pipe(z.string().min(2)),
  titleAr: cleanText(120),
  bodyFr: z.string().max(20000),
  bodyAr: z.string().max(20000),
  isActive: z.boolean().default(true),
});

systemRoutes.post("/content/pages", requirePermission("content.edit"), async (c) => {
  const p = await body(c, pageInput);
  try {
    const row = await c.env.DB.prepare("INSERT INTO pages (slug, title_fr, title_ar, body_fr, body_ar, is_active, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?) RETURNING id")
      .bind(p.slug, p.titleFr, p.titleAr || p.titleFr, p.bodyFr, p.bodyAr, p.isActive ? 1 : 0, Date.now())
      .first<{ id: number }>();
    await c.env.DB.batch([bumpCatalogStmt(c.env), auditStmt(c.env, actorOf(c.get("member")), "create", "page", row!.id)]);
    return c.json({ id: row!.id }, 201);
  } catch (err) {
    if (String((err as Error).message).includes("UNIQUE")) throw new HttpError(409, "slug_taken");
    throw err;
  }
});

systemRoutes.put("/content/pages/:id", requirePermission("content.edit"), async (c) => {
  const id = intParam(c, "id");
  const p = await body(c, pageInput);
  await c.env.DB.batch([
    c.env.DB.prepare("UPDATE pages SET slug = ?, title_fr = ?, title_ar = ?, body_fr = ?, body_ar = ?, is_active = ?, updated_at = ? WHERE id = ?").bind(
      p.slug, p.titleFr, p.titleAr || p.titleFr, p.bodyFr, p.bodyAr, p.isActive ? 1 : 0, Date.now(), id,
    ),
    bumpCatalogStmt(c.env),
    auditStmt(c.env, actorOf(c.get("member")), "update", "page", id),
  ]);
  return c.json({ ok: true });
});

systemRoutes.delete("/content/pages/:id", requirePermission("content.edit"), async (c) => {
  const id = intParam(c, "id");
  await c.env.DB.batch([c.env.DB.prepare("DELETE FROM pages WHERE id = ?").bind(id), bumpCatalogStmt(c.env), auditStmt(c.env, actorOf(c.get("member")), "delete", "page", id)]);
  return c.json({ ok: true });
});

systemRoutes.put("/content/store", requirePermission("content.edit"), async (c) => {
  const input = await body(
    c,
    z.object({ name: cleanText(60).pipe(z.string().min(2)), tagline_fr: cleanText(120), tagline_ar: cleanText(120), city_fr: cleanText(60), city_ar: cleanText(60) }),
  );
  const store = await getSetting(c.env, "store");
  await c.env.DB.batch([setSettingStmt(c.env, "store", { ...store, ...input }), bumpCatalogStmt(c.env), auditStmt(c.env, actorOf(c.get("member")), "update", "settings", "store")]);
  return c.json({ ok: true });
});

/* ───────────── Erreurs, journal, outbox ───────────── */

systemRoutes.get("/errors", requirePermission("errors.view"), async (c) => {
  const status = c.req.query("status") ?? "open";
  const [errors, outbox, audit] = await c.env.DB.batch([
    c.env.DB.prepare(`SELECT * FROM error_events ${status === "all" ? "" : "WHERE status = ?"} ORDER BY last_seen DESC LIMIT 100`).bind(...(status === "all" ? [] : [status])),
    c.env.DB.prepare("SELECT id, kind, payload, attempts, last_error, next_attempt_at, created_at FROM outbox WHERE done_at IS NULL ORDER BY id DESC LIMIT 50"),
    c.env.DB.prepare("SELECT * FROM audit_log ORDER BY id DESC LIMIT 100"),
  ]);
  return c.json({ errors: errors!.results, outbox: outbox!.results, audit: audit!.results });
});

systemRoutes.patch("/errors/:id", requirePermission("errors.view"), async (c) => {
  const input = await body(c, z.object({ status: z.enum(["open", "resolved", "ignored"]) }));
  await c.env.DB.prepare("UPDATE error_events SET status = ? WHERE id = ?").bind(input.status, intParam(c, "id")).run();
  return c.json({ ok: true });
});

systemRoutes.post("/outbox/:id/retry", requirePermission("errors.view"), async (c) => {
  await c.env.DB.prepare("UPDATE outbox SET next_attempt_at = 0, attempts = MIN(attempts, 7) WHERE id = ? AND done_at IS NULL").bind(intParam(c, "id")).run();
  const sent = await processOutbox(c.env, 5);
  return c.json({ sent });
});
