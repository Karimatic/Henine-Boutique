/**
 * Telegram bot: new orders are posted to the team group with one-tap status buttons.
 * Button presses arrive as callback queries (production: webhook; development: the admin
 * panel polls getUpdates) and go through the same applyStatusChange as the admin panel.
 */
import { formatDA, formatDzPhone, hasPermission, nextStatuses, timingSafeEqual, type OrderStatus, type Permission } from "@henine/shared";
import type { Env } from "../env";
import { recordError } from "./audit";
import { decryptSecret } from "./crypto";
import { HttpError } from "./http";
import { algiersDate, algiersDayStart, applyStatusChange, CANCELLED_SQL, periodStats, type PeriodStats } from "./orders";
import { getSetting, patchSetting } from "./settings";

const API = "https://api.telegram.org";

interface TgResponse<T> {
  ok: boolean;
  result?: T;
  description?: string;
  error_code?: number;
  parameters?: { retry_after?: number };
}

export async function tgCall<T = unknown>(token: string, method: string, payload: Record<string, unknown> = {}): Promise<TgResponse<T>> {
  const res = await fetch(`${API}/bot${token}/${method}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  return (await res.json().catch(() => ({ ok: false, description: `HTTP ${res.status}` }))) as TgResponse<T>;
}

export async function telegramConfig(env: Env) {
  const tg = await getSetting(env, "telegram");
  const token = await decryptSecret(env.SETTINGS_KEY, tg.token_enc);
  return { ...tg, token, ready: !!(token && tg.chat_id) };
}

const esc = (s: string | number | null | undefined) => String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

export const STATUS_EMOJI: Record<OrderStatus, string> = {
  nouvelle: "🆕 Nouvelle",
  injoignable: "📵 Injoignable",
  confirmee: "✅ Confirmée",
  en_preparation: "📦 En préparation",
  expediee: "🚚 Expédiée",
  en_livraison: "🛵 En livraison",
  livree: "🎉 Livrée",
  retour: "↩️ Retour",
  retour_recu: "📥 Retour reçu",
  annulee: "❌ Annulée",
  doublon: "♊ Doublon",
  fausse: "🚫 Fausse commande",
};

const BUTTON_LABEL: Partial<Record<OrderStatus, string>> = {
  confirmee: "✅ Confirmer",
  injoignable: "📵 Injoignable",
  annulee: "❌ Annuler",
  en_preparation: "📦 Préparer",
  expediee: "🚚 Expédiée",
  en_livraison: "🛵 En livraison",
  livree: "🎉 Livrée",
  retour: "↩️ Retour",
  retour_recu: "📥 Retour reçu",
};

/** Which permission a status button needs. */
export function permissionFor(to: OrderStatus) {
  return to === "confirmee" || to === "injoignable" || to === "annulee" || to === "doublon" || to === "fausse" ? "orders.confirm" : "orders.ship";
}

interface OrderForMessage {
  id: number;
  public_code: string;
  status: OrderStatus;
  channel: string;
  name: string;
  phone: string;
  wilaya_code: number;
  wilaya_fr: string | null;
  commune_fr: string | null;
  commune_text: string | null;
  delivery_type: string;
  address: string | null;
  subtotal: number;
  discount_total: number;
  shipping_price: number;
  total: number;
  coupon_code: string | null;
  customer_note: string | null;
  risk_score: number;
  telegram_message_id: number | null;
  orders_count: number | null;
  returned_count: number | null;
  delivered_count: number | null;
  is_blacklisted: number | null;
  prev_orders: number;
  prev_cancelled: number;
  tracking_number: string | null;
  internal_note: string | null;
  locale: string;
}

async function loadOrder(env: Env, orderId: number) {
  const o = await env.DB.prepare(
    `SELECT o.*, w.name_fr AS wilaya_fr, cm.name_fr AS commune_fr, c.orders_count, c.returned_count, c.delivered_count, c.is_blacklisted,
            (SELECT COUNT(*) FROM orders x WHERE x.customer_id = o.customer_id AND x.id != o.id AND x.status NOT IN ${CANCELLED_SQL}) AS prev_orders,
            (SELECT COUNT(*) FROM orders x WHERE x.customer_id = o.customer_id AND x.id != o.id AND x.status IN ${CANCELLED_SQL}) AS prev_cancelled
       FROM orders o
       LEFT JOIN wilayas w ON w.code = o.wilaya_code
       LEFT JOIN communes cm ON cm.id = o.commune_id
       LEFT JOIN customers c ON c.id = o.customer_id
      WHERE o.id = ?`,
  )
    .bind(orderId)
    .first<OrderForMessage>();
  if (!o) return null;
  const { results: items } = await env.DB.prepare("SELECT name_fr, options_label, qty, unit_price, variant_id FROM order_items WHERE order_id = ?")
    .bind(orderId)
    .all<{ name_fr: string; options_label: string | null; qty: number; unit_price: number; variant_id: number | null }>();
  const { results: lastEvent } = await env.DB.prepare(
    "SELECT actor, created_at FROM order_events WHERE order_id = ? AND kind = 'status' ORDER BY id DESC LIMIT 1",
  )
    .bind(orderId)
    .all<{ actor: string; created_at: number }>();
  return { o, items, last: lastEvent[0] ?? null };
}

function actorName(actor: string): string {
  // "member:3:Sarah" | "telegram:12345:Sarah" | "customer" | "system"
  const parts = actor.split(":");
  return parts.length >= 3 ? parts.slice(2).join(":") : actor === "customer" ? "la cliente" : actor;
}

function algiersTime(ts: number): string {
  return new Date(ts + 3600_000).toISOString().slice(11, 16);
}

type Button = { text: string; callback_data?: string; url?: string };

/** wa.me link with a ready-to-send confirmation message in the customer's language. */
function whatsappUrl(o: OrderForMessage): string {
  const phone = `213${o.phone.slice(1)}`;
  const text =
    o.locale === "fr"
      ? `Bonjour ${o.name} 🌸 Ici Henine Boutique. Nous confirmons votre commande ${o.public_code} (${formatDA(o.total)}), livraison ${o.delivery_type === "bureau" ? "au bureau" : "à domicile"} à ${o.wilaya_fr ?? ""}. Merci !`
      : `مرحبا ${o.name} 🌸 معك Henine Boutique. نؤكد طلبك ${o.public_code} (${formatDA(o.total)})، التوصيل ${o.delivery_type === "bureau" ? "إلى المكتب" : "إلى المنزل"}. شكرا!`;
  return `https://wa.me/${phone}?text=${encodeURIComponent(text)}`;
}

export async function buildOrderMessage(env: Env, orderId: number, view: "main" | "more" = "main") {
  const data = await loadOrder(env, orderId);
  if (!data) return null;
  const { o, items, last } = data;

  // customer history: cancelled orders are never counted as orders
  const risk: string[] = [];
  if (o.is_blacklisted) risk.push("⛔ LISTE NOIRE");
  if (o.returned_count) risk.push(`⚠️ ${o.returned_count} retour(s)`);
  if (o.prev_cancelled) risk.push(`🚫 ${o.prev_cancelled} annulée(s) avant`);
  if ((o.delivered_count ?? 0) > 0) risk.push(`💎 cliente fidèle (${o.delivered_count} livrée(s))`);
  else if (o.prev_orders > 0) risk.push(`🔁 ${o.prev_orders} autre(s) commande(s) en cours`);
  else if (!o.prev_cancelled && !o.returned_count) risk.push("🆕 première commande");

  const channel = o.channel === "express" ? "site · express" : o.channel === "web" ? "site" : o.channel;
  const lines = [
    `🛍 <b>Commande ${esc(o.public_code)}</b> <i>(${esc(channel)})</i>`,
    `👤 ${esc(o.name)} · 📞 <code>${esc(formatDzPhone(o.phone))}</code>`,
    ...(risk.length ? [risk.join(" · ")] : []),
    `📍 ${o.wilaya_code} - ${esc(o.wilaya_fr)} › ${esc(o.commune_fr ?? o.commune_text ?? "?")} · ${o.delivery_type === "bureau" ? "🏢 Bureau (stop-desk)" : "🏠 Domicile"}`,
    ...(o.address ? [`🏠 ${esc(o.address)}`] : []),
    "",
    ...items.map((i) => `• ${esc(i.name_fr)}${i.options_label ? ` — ${esc(i.options_label)}` : ""} × ${i.qty} … ${esc(formatDA(i.unit_price * i.qty))}`),
    "",
    `🚚 Livraison ${esc(formatDA(o.shipping_price))}${o.coupon_code ? ` · 🏷 ${esc(o.coupon_code)} −${esc(formatDA(o.discount_total))}` : ""}`,
    `💰 <b>Total ${esc(formatDA(o.total))}</b> (paiement à la livraison)`,
    ...(o.customer_note ? [`📝 Cliente : ${esc(o.customer_note)}`] : []),
    ...(o.internal_note ? [`🔒 Équipe : ${esc(o.internal_note.slice(-300))}`] : []),
    ...(o.tracking_number ? [`📦 Suivi ZR : <code>${esc(o.tracking_number)}</code>`] : []),
    "",
    `Statut : <b>${STATUS_EMOJI[o.status]}</b>${last && o.status !== "nouvelle" ? ` par ${esc(actorName(last.actor))} à ${algiersTime(last.created_at)}` : ""}`,
  ];

  // Every available action is shown directly on the message (no sub-menu), two per row.
  const next = nextStatuses(o.status);
  const STATUS_ORDER: OrderStatus[] = ["confirmee", "injoignable", "en_preparation", "expediee", "en_livraison", "livree", "retour", "retour_recu", "annulee", "doublon", "fausse"];
  const EXTRA_LABEL: Partial<Record<OrderStatus, string>> = { doublon: "♊ Doublon", fausse: "🚫 Fausse commande" };
  const buttons: Button[] = STATUS_ORDER.filter((s) => next.includes(s) && (BUTTON_LABEL[s] || EXTRA_LABEL[s])).map((s) => ({
    text: BUTTON_LABEL[s] ?? EXTRA_LABEL[s]!,
    callback_data: `s:${o.id}:${s}`,
  }));
  buttons.push(
    { text: "💬 WhatsApp", url: whatsappUrl(o) },
    { text: "📝 Note", callback_data: `h:${o.id}:note` },
    { text: "📦 N° de suivi", callback_data: `h:${o.id}:track` },
    { text: "🔄 Actualiser", callback_data: `r:${o.id}` },
  );
  const rows: Button[][] = [];
  for (let i = 0; i < buttons.length; i += 2) rows.push(buttons.slice(i, i + 2));
  void view; // older messages may still send "v:" (former Plus menu): they now get this full keyboard
  if (env.PUBLIC_ORIGIN.startsWith("https://")) rows.push([{ text: "🔗 Ouvrir dans l'admin", url: `${env.PUBLIC_ORIGIN}/admin/commandes?o=${o.id}` }]);

  return { text: lines.join("\n"), reply_markup: { inline_keyboard: rows }, messageId: o.telegram_message_id, code: o.public_code };
}

/** Posts a new order to the group. Returns false when Telegram isn't configured or fails. */
export async function notifyNewOrder(env: Env, code: string): Promise<boolean> {
  const cfg = await telegramConfig(env);
  const notif = await getSetting(env, "notifications");
  const order = await env.DB.prepare("SELECT id FROM orders WHERE public_code = ?").bind(code).first<{ id: number }>();
  if (!order) return true; // nothing to do
  if (!notif.telegram_new_order) return true;
  if (!cfg.ready) throw new Error("telegram_not_configured");

  const msg = await buildOrderMessage(env, order.id);
  if (!msg) return true;
  if (msg.messageId) return true; // already posted (outbox retry after success)

  const lowStock = await env.DB.prepare(
    `SELECT v.sku, v.stock_on_hand - v.stock_reserved AS available FROM variants v
      WHERE v.id IN (SELECT variant_id FROM order_items WHERE order_id = ?) AND v.stock_on_hand - v.stock_reserved <= v.low_stock_threshold`,
  )
    .bind(order.id)
    .all<{ sku: string; available: number }>();
  const extra =
    notif.telegram_low_stock && lowStock.results.length
      ? `\n\n📉 Stock bas : ${lowStock.results.map((r) => `${esc(r.sku)} (reste ${r.available})`).join(", ")}`
      : "";

  const res = await tgCall<{ message_id: number }>(cfg.token!, "sendMessage", {
    chat_id: cfg.chat_id,
    text: msg.text + extra,
    parse_mode: "HTML",
    reply_markup: msg.reply_markup,
    link_preview_options: { is_disabled: true },
  });
  if (!res.ok) throw new Error(`telegram: ${res.description ?? "send failed"}`);
  await env.DB.prepare("UPDATE orders SET telegram_message_id = ? WHERE id = ?").bind(res.result!.message_id, order.id).run();
  return true;
}

/** Re-renders the group message after a status change (from admin, bot or carrier). */
export async function syncOrderMessage(env: Env, orderId: number): Promise<void> {
  const cfg = await telegramConfig(env);
  if (!cfg.ready) return;
  const msg = await buildOrderMessage(env, orderId);
  if (!msg?.messageId) return;
  const res = await tgCall(cfg.token!, "editMessageText", {
    chat_id: cfg.chat_id,
    message_id: msg.messageId,
    text: msg.text,
    parse_mode: "HTML",
    reply_markup: msg.reply_markup,
    link_preview_options: { is_disabled: true },
  });
  if (!res.ok && !String(res.description).includes("not modified")) {
    await recordError(env, "telegram", `editMessageText: ${res.description}`);
  }
}

/** Free-form alert to the group (low stock, reviews, contact messages, daily report). */
export async function sendTelegramText(env: Env, html: string): Promise<boolean> {
  const cfg = await telegramConfig(env);
  if (!cfg.ready) return false;
  const res = await tgCall(cfg.token!, "sendMessage", { chat_id: cfg.chat_id, text: html, parse_mode: "HTML", link_preview_options: { is_disabled: true } });
  if (!res.ok) await recordError(env, "telegram", `sendMessage: ${res.description}`);
  return res.ok;
}

/* ───────────── Outbox (retries) ───────────── */

export async function processOutbox(env: Env, limit = 10): Promise<number> {
  const { results } = await env.DB.prepare(
    "SELECT id, kind, payload, attempts FROM outbox WHERE done_at IS NULL AND next_attempt_at <= ? AND attempts < 8 ORDER BY id LIMIT ?",
  )
    .bind(Date.now(), limit)
    .all<{ id: number; kind: string; payload: string; attempts: number }>();
  let done = 0;
  for (const job of results) {
    try {
      const payload = JSON.parse(job.payload) as { type: string; code?: string };
      if (job.kind === "telegram" && payload.type === "new_order" && payload.code) await notifyNewOrder(env, payload.code);
      await env.DB.prepare("UPDATE outbox SET done_at = ?, attempts = attempts + 1, last_error = NULL WHERE id = ?").bind(Date.now(), job.id).run();
      done++;
    } catch (err) {
      const msg = (err as Error).message;
      const backoff = Math.min(60, 2 ** job.attempts) * 60_000; // 1, 2, 4 … 60 min
      await env.DB.prepare("UPDATE outbox SET attempts = attempts + 1, last_error = ?, next_attempt_at = ? WHERE id = ?")
        .bind(msg.slice(0, 300), Date.now() + backoff, job.id)
        .run();
      if (msg !== "telegram_not_configured") await recordError(env, "telegram", msg);
    }
  }
  return done;
}

/* ───────────── Incoming updates (buttons + commands) ───────────── */

interface TgUser {
  id: number;
  first_name?: string;
  username?: string;
}
interface TgMessage {
  message_id: number;
  chat: { id: number; title?: string; type: string };
  from?: TgUser;
  text?: string;
  reply_to_message?: { message_id: number; from?: TgUser };
}
interface TgUpdate {
  update_id: number;
  callback_query?: { id: string; from: TgUser; data?: string; message?: { chat: { id: number }; message_id: number } };
  message?: TgMessage;
}

async function answer(token: string, callbackId: string, text: string, alert = false) {
  await tgCall(token, "answerCallbackQuery", { callback_query_id: callbackId, text, show_alert: alert });
}

/**
 * Who is acting? A team member whose Telegram ID is set in Admin → Équipe (their role applies),
 * or — if allowed in Notifier — anyone in the team group.
 */
async function resolveActor(env: Env, from: TgUser, chat: number | undefined, chatId: string | null, permission: Permission | null) {
  const member = await env.DB.prepare(
    "SELECT m.id, m.name, r.permissions FROM team_members m JOIN roles r ON r.id = m.role_id WHERE m.telegram_user_id = ? AND m.is_active = 1",
  )
    .bind(from.id)
    .first<{ id: number; name: string; permissions: string }>();
  if (member) {
    if (permission && !hasPermission(JSON.parse(member.permissions) as string[], permission)) return { error: "⛔ Votre rôle ne permet pas cette action." };
    return { actor: `member:${member.id}:${member.name}` };
  }
  const notif = await getSetting(env, "notifications");
  const inTeamGroup = chatId != null && String(chat) === chatId;
  if (!notif.trust_group_members || !inTeamGroup) return { error: "⛔ Compte Telegram non relié à l'équipe (Admin → Équipe)." };
  return { actor: `telegram:${from.id}:${from.first_name ?? from.username ?? "Telegram"}` };
}

async function showView(env: Env, token: string, chatId: string | number, messageId: number, orderId: number, view: "main" | "more") {
  const msg = await buildOrderMessage(env, orderId, view);
  if (!msg) return;
  const res = await tgCall(token, "editMessageText", {
    chat_id: chatId,
    message_id: messageId,
    text: msg.text,
    parse_mode: "HTML",
    reply_markup: msg.reply_markup,
    link_preview_options: { is_disabled: true },
  });
  if (!res.ok && !String(res.description).includes("not modified")) await recordError(env, "telegram", `editMessageText: ${res.description}`);
}

async function handleCallback(env: Env, token: string, cq: NonNullable<TgUpdate["callback_query"]>, chatId: string | null) {
  const data = cq.data ?? "";
  const chat = cq.message?.chat.id;
  const messageId = cq.message?.message_id;

  // ⋯ Plus / ⬅️ Retour: switch the button set on this message
  const view = /^v:(\d+):(main|more)$/.exec(data);
  if (view && chat != null && messageId != null) {
    await showView(env, token, chat, messageId, Number(view[1]), "main");
    return answer(token, cq.id, "");
  }
  // 🔄 Actualiser
  const refresh = /^r:(\d+)$/.exec(data);
  if (refresh && chat != null && messageId != null) {
    await showView(env, token, chat, messageId, Number(refresh[1]), "main");
    return answer(token, cq.id, "🔄 À jour");
  }
  // 📝 / 📦 help pop-ups
  const help = /^h:(\d+):(note|track)$/.exec(data);
  if (help) {
    return answer(
      token,
      cq.id,
      help[2] === "note"
        ? "📝 Pour ajouter une note : répondez (glisser ↩️) à ce message avec votre texte. Exemple : « rappeler après 18h »."
        : "📦 Pour le n° de suivi ZR : répondez (glisser ↩️) à ce message avec « suivi 123456789 ».",
      true,
    );
  }

  const m = /^s:(\d+):([a-z_]+)$/.exec(data);
  if (!m) return answer(token, cq.id, "Action inconnue");
  const orderId = Number(m[1]);
  const to = m[2] as OrderStatus;
  const who = await resolveActor(env, cq.from, chat, chatId, permissionFor(to));
  if (who.error) return answer(token, cq.id, who.error, true);
  const actor = who.actor!;

  try {
    await applyStatusChange(env, orderId, to, actor, "telegram");
    await syncOrderMessage(env, orderId);
    await answer(token, cq.id, `${STATUS_EMOJI[to]} ✓`);
  } catch (err) {
    const code = err instanceof HttpError ? err.code : "error";
    const text =
      code === "invalid_transition" || code === "status_changed_meanwhile"
        ? "Cette commande a déjà changé de statut."
        : code === "stock_insufficient"
          ? "Stock insuffisant pour rouvrir cette commande."
          : "Erreur, réessayez depuis l'admin.";
    await syncOrderMessage(env, orderId).catch(() => undefined);
    await answer(token, cq.id, text, true);
    if (!(err instanceof HttpError)) await recordError(env, "telegram", (err as Error).message);
  }
}

/** Commands shown in Telegram's "/" menu. */
export const BOT_COMMANDS = [
  { command: "attente", description: "Commandes à confirmer" },
  { command: "jour", description: "Bilan d'aujourd'hui" },
  { command: "semaine", description: "Bilan des 7 derniers jours" },
  { command: "stock", description: "Articles en stock bas ou épuisés" },
  { command: "chercher", description: "Chercher une cliente (téléphone ou nom)" },
  { command: "cmd", description: "Afficher une commande : /cmd HN-XXXXXX" },
  { command: "id", description: "Mon ID Telegram (à relier dans Équipe)" },
  { command: "aide", description: "Tout ce que le bot sait faire" },
];

const registeredFor = new Set<string>();
/** Registers the command menu once per token per Worker instance (cheap, idempotent). */
async function ensureCommands(token: string) {
  if (registeredFor.has(token)) return;
  registeredFor.add(token);
  await tgCall(token, "setMyCommands", { commands: BOT_COMMANDS }).catch(() => registeredFor.delete(token));
}

function statsMessage(title: string, s: PeriodStats): string {
  return [
    `📊 <b>${esc(title)}</b>`,
    `🛍 Commandes : <b>${s.orders}</b> <i>(hors annulées)</i>`,
    `💰 Chiffre d'affaires : <b>${esc(formatDA(s.revenue))}</b>`,
    `✅ Confirmées : ${s.confirmed}${s.confirmRate != null ? ` · taux ${s.confirmRate} %` : ""}`,
    `🎉 Livrées : ${s.delivered}${s.returned ? ` · ↩️ retours : ${s.returned}` : ""}`,
    `⏳ À confirmer : ${s.pending}`,
    `❌ Annulées : ${s.cancelled}`,
  ].join("\n");
}

async function handleCommand(env: Env, token: string, msg: TgMessage) {
  const text = (msg.text ?? "").trim();
  const reply = (html: string, extra: Record<string, unknown> = {}) =>
    tgCall(token, "sendMessage", { chat_id: msg.chat.id, text: html, parse_mode: "HTML", link_preview_options: { is_disabled: true }, ...extra });
  const cmd = text.split(/[\s@]/)[0]?.toLowerCase();
  const arg = text.split(/\s+/).slice(1).join(" ").trim();

  switch (cmd) {
    case "/start":
    case "/id":
      return reply(
        `🌸 Henine Boutique\nID de ce chat : <code>${msg.chat.id}</code>\nVotre ID Telegram : <code>${msg.from?.id ?? "?"}</code>\n` +
          "Ajoutez votre ID dans Admin → Équipe pour signer vos actions avec votre nom.",
      );
    case "/aide":
    case "/help":
      return reply(
        [
          "🌸 <b>Bot Henine Boutique</b>",
          "",
          "<b>Sur chaque commande</b>",
          "✅ Confirmer · 📵 Injoignable · ❌ Annuler, puis 📦 Préparer → 🚚 Expédiée → 🎉 Livrée",
          "💬 WhatsApp : message de confirmation prêt à envoyer",
          "⋯ Plus : doublon, fausse commande, actualiser",
          "↩️ Répondre au message : ajoute une note pour l'équipe",
          "↩️ Répondre « suivi 123… » : enregistre le n° ZR Express",
          "",
          "<b>Commandes</b>",
          ...BOT_COMMANDS.map((c) => `/${c.command} : ${esc(c.description)}`),
        ].join("\n"),
      );
    case "/jour":
      return reply(statsMessage(`Aujourd'hui (${algiersDate()})`, await periodStats(env, algiersDayStart())));
    case "/semaine":
      return reply(statsMessage("7 derniers jours", await periodStats(env, algiersDayStart() - 6 * 86400_000)));
    case "/attente": {
      const { results } = await env.DB.prepare(
        `SELECT o.public_code, o.name, o.total, o.status, o.created_at, o.confirm_attempts, w.name_fr AS wilaya
           FROM orders o LEFT JOIN wilayas w ON w.code = o.wilaya_code
          WHERE o.status IN ('nouvelle','injoignable') ORDER BY o.created_at LIMIT 15`,
      ).all<{ public_code: string; name: string; total: number; status: string; created_at: number; confirm_attempts: number; wilaya: string }>();
      if (!results.length) return reply("✅ Aucune commande à confirmer. Bravo !");
      return reply(
        [
          `⏳ <b>${results.length} commande(s) à confirmer</b>`,
          "",
          ...results.map(
            (o) =>
              `${o.status === "injoignable" ? `📵×${o.confirm_attempts}` : "🆕"} <code>${o.public_code}</code> · ${esc(o.name)} · ${esc(o.wilaya)} · ${esc(formatDA(o.total))} · ${algiersTime(o.created_at)}`,
          ),
          "",
          "Ouvrir une commande : /cmd HN-XXXXXX",
        ].join("\n"),
      );
    }
    case "/stock": {
      const { results } = await env.DB.prepare(
        `SELECT p.name_fr, v.sku, v.stock_on_hand - v.stock_reserved AS available,
                (SELECT COUNT(*) FROM stock_alerts a WHERE a.variant_id = v.id AND a.notified_at IS NULL) AS waiting
           FROM variants v JOIN products p ON p.id = v.product_id
          WHERE v.is_active = 1 AND p.status = 'published' AND v.stock_on_hand - v.stock_reserved <= v.low_stock_threshold
          ORDER BY available, p.name_fr LIMIT 25`,
      ).all<{ name_fr: string; sku: string; available: number; waiting: number }>();
      if (!results.length) return reply("📦 Stock : tout va bien ✓");
      return reply(
        [
          "📉 <b>Stock bas / épuisé</b>",
          "",
          ...results.map((r) => `${r.available <= 0 ? "🔴" : "🟠"} ${esc(r.name_fr)} <code>${esc(r.sku)}</code> : ${r.available}${r.waiting ? ` · 🔔 ${r.waiting} en attente` : ""}`),
        ].join("\n"),
      );
    }
    case "/chercher": {
      if (arg.length < 3) return reply("Exemple : <code>/chercher 0550123456</code> ou <code>/chercher Amina</code>");
      const digits = arg.replace(/\D/g, "");
      const { results } = await env.DB.prepare(
        `SELECT c.name, c.phone, c.delivered_count, c.returned_count, c.cancelled_count, c.orders_count, c.is_blacklisted,
                (SELECT GROUP_CONCAT(public_code || ' ' || status, ', ') FROM (SELECT public_code, status FROM orders WHERE customer_id = c.id ORDER BY id DESC LIMIT 3)) AS last_orders
           FROM customers c WHERE c.phone LIKE ? OR c.name LIKE ? ORDER BY c.last_order_at DESC LIMIT 5`,
      )
        .bind(digits.length >= 4 ? `%${digits}%` : "__none__", `%${arg}%`)
        .all<{ name: string; phone: string; delivered_count: number; returned_count: number; cancelled_count: number; orders_count: number; is_blacklisted: number; last_orders: string | null }>();
      if (!results.length) return reply("Aucune cliente trouvée.");
      return reply(
        results
          .map(
            (c) =>
              `👤 <b>${esc(c.name)}</b> · <code>${esc(formatDzPhone(c.phone))}</code>${c.is_blacklisted ? " ⛔" : ""}\n` +
              `   ${c.orders_count} cmd · ${c.delivered_count} livrée(s) · ${c.returned_count} retour(s) · ${c.cancelled_count} annulée(s)\n` +
              `   ${esc((c.last_orders ?? "").replace(/ (\w+)/g, (_, s: string) => ` ${STATUS_EMOJI[s as OrderStatus]?.split(" ")[0] ?? s}`))}`,
          )
          .join("\n\n"),
      );
    }
    case "/cmd": {
      const code = arg.toUpperCase();
      const o = code ? await env.DB.prepare("SELECT id FROM orders WHERE public_code = ?").bind(code).first<{ id: number }>() : null;
      if (!o) return reply("Commande introuvable. Exemple : <code>/cmd HN-7K3P9Q</code>");
      const m = await buildOrderMessage(env, o.id);
      return reply(m!.text, { reply_markup: m!.reply_markup });
    }
  }
}

/** A reply to an order message: internal note, or "suivi 123…" to save the ZR tracking number. */
async function handleReply(env: Env, token: string, msg: TgMessage, chatId: string | null): Promise<boolean> {
  const replyTo = msg.reply_to_message?.message_id;
  if (!replyTo || chatId == null || String(msg.chat.id) !== chatId || !msg.from) return false;
  const order = await env.DB.prepare("SELECT id, internal_note FROM orders WHERE telegram_message_id = ?").bind(replyTo).first<{ id: number; internal_note: string | null }>();
  if (!order) return false;
  const text = (msg.text ?? "").trim().slice(0, 500);
  if (!text) return true;

  const tracking = /^(?:\/?suivi|tracking|#)\s*:?\s*([A-Za-z0-9-]{4,40})$/i.exec(text);
  const who = await resolveActor(env, msg.from, msg.chat.id, chatId, tracking ? "orders.ship" : "orders.edit");
  if (who.error) {
    await tgCall(token, "sendMessage", { chat_id: msg.chat.id, text: who.error, reply_parameters: { message_id: msg.message_id } });
    return true;
  }
  const now = Date.now();
  if (tracking) {
    await env.DB.batch([
      env.DB.prepare("UPDATE orders SET tracking_number = ?, updated_at = ? WHERE id = ?").bind(tracking[1]!.toUpperCase(), now, order.id),
      env.DB.prepare("INSERT INTO order_events (order_id, kind, actor, source, note, created_at) VALUES (?, 'edit', ?, 'telegram', ?, ?)").bind(
        order.id, who.actor, `N° de suivi : ${tracking[1]!.toUpperCase()}`, now,
      ),
    ]);
  } else {
    const note = order.internal_note ? `${order.internal_note}\n${text}` : text;
    await env.DB.batch([
      env.DB.prepare("UPDATE orders SET internal_note = ?, updated_at = ? WHERE id = ?").bind(note.slice(-1000), now, order.id),
      env.DB.prepare("INSERT INTO order_events (order_id, kind, actor, source, note, created_at) VALUES (?, 'note', ?, 'telegram', ?, ?)").bind(order.id, who.actor, text, now),
    ]);
  }
  await syncOrderMessage(env, order.id);
  await tgCall(token, "setMessageReaction", { chat_id: msg.chat.id, message_id: msg.message_id, reaction: [{ type: "emoji", emoji: "👌" }] });
  return true;
}

export async function handleUpdate(env: Env, update: TgUpdate): Promise<void> {
  const cfg = await telegramConfig(env);
  if (!cfg.token) return;
  await ensureCommands(cfg.token);
  if (update.callback_query) await handleCallback(env, cfg.token, update.callback_query, cfg.chat_id);
  else if (update.message?.reply_to_message && (await handleReply(env, cfg.token, update.message, cfg.chat_id))) return;
  else if (update.message?.text?.startsWith("/")) await handleCommand(env, cfg.token, update.message);
}

export async function verifyWebhookSecret(env: Env, header: string | undefined): Promise<boolean> {
  const tg = await getSetting(env, "telegram");
  const secret = await decryptSecret(env.SETTINGS_KEY, tg.webhook_secret_enc);
  return !!secret && !!header && timingSafeEqual(secret, header);
}

/** Development only: pull pending updates (no public URL for a webhook on localhost). */
export async function pollUpdates(env: Env): Promise<number> {
  const cfg = await telegramConfig(env);
  if (!cfg.token) return 0;
  await ensureCommands(cfg.token);
  const res = await tgCall<TgUpdate[]>(cfg.token, "getUpdates", { offset: cfg.last_update_id + 1, timeout: 0, allowed_updates: ["message", "callback_query"] });
  if (!res.ok || !res.result?.length) return 0;
  for (const u of res.result) {
    try {
      await handleUpdate(env, u);
    } catch (err) {
      await recordError(env, "telegram", (err as Error).message);
    }
  }
  await patchSetting(env, "telegram", { last_update_id: res.result[res.result.length - 1]!.update_id });
  return res.result.length;
}

