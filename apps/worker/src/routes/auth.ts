/**
 * /api/auth: admin login (email + password → emailed 6-digit code), password reset,
 * team invitations. Every response is deliberately vague about whether an email exists.
 */
import { Hono } from "hono";
import { z } from "zod";
import type { AppEnv } from "../env";
import { auditStmt } from "../lib/audit";
import {
  assertNotLocked,
  checkPassword,
  consumeChallenge,
  createChallenge,
  createSession,
  destroySession,
  devEcho,
  findMemberByEmail,
  mailReady,
  hashPassword,
  INVITE_TTL,
  passwordKeyValid,
  readSession,
  registerFailure,
} from "../lib/auth";
import { encryptSecret, sha256Hex } from "../lib/crypto";
import { newTotpSecret, totpUri } from "../lib/totp";
import { body, clientIp, HttpError, rateLimit } from "../lib/http";
import { mailLayout, sendMail } from "../lib/mail";

export const authRoutes = new Hono<AppEnv>();

const email = z.string().trim().toLowerCase().email().max(120);
const key = z.string().refine(passwordKeyValid, "invalid_key");
const code = z.string().trim().regex(/^\d{6}$/, "code_format");

async function sendCode(c: Parameters<typeof devEcho>[0], to: string, name: string, purpose: "login" | "reset" | "invite", value: string) {
  const subject =
    purpose === "login" ? `Votre code de connexion : ${value}` : purpose === "reset" ? `Réinitialisation du mot de passe : ${value}` : `Activez votre compte : ${value}`;
  const intro =
    purpose === "login"
      ? "Voici votre code pour vous connecter à l'administration Henine Boutique."
      : purpose === "reset"
        ? "Voici votre code pour choisir un nouveau mot de passe."
        : "Voici votre code pour activer votre compte d'équipe.";
  const res = await sendMail(c.env, {
    to,
    subject,
    text: `Bonjour ${name},\n\n${intro}\n\n${value}\n\nCe code expire dans 10 minutes.`,
    html: mailLayout(subject.split(":")[0]!, [`Bonjour ${name},`, intro, "Ce code expire dans 10 minutes."], value),
  });
  if (!res.delivered && !devEcho(c, "1")) throw new HttpError(503, "mail_unavailable", { provider: res.provider });
  return res;
}

/* ── Step 1: email + password ── */
authRoutes.post("/login", async (c) => {
  await rateLimit(c.env.RL_AUTH, `login:${clientIp(c)}`);
  const input = await body(c, z.object({ email, key, remember: z.boolean().default(false) }));
  const m = await findMemberByEmail(c.env, input.email);
  if (m) assertNotLocked(m);
  const ok = await checkPassword(c.env, input.key, m?.password_hash ?? null, m?.password_salt ?? null);
  if (!m || !ok || !m.is_active) {
    if (m) await registerFailure(c.env, m);
    throw new HttpError(401, "invalid_credentials");
  }
  const ch = await createChallenge(c.env, m.id, "login", { remember: input.remember });
  const emailHint = m.email.replace(/^(.).*(@.*)$/, "$1•••$2");
  // set up with an authenticator app: its code, no email needed
  if (m.totp_secret_enc) return c.json({ challenge: ch.id, method: "totp", emailHint });
  const mail = await sendCode(c, m.email, m.name, "login", ch.code);
  return c.json({ challenge: ch.id, method: "email", emailHint, devCode: devEcho(c, ch.code), provider: mail.provider });
});

/* ── Step 2: emailed code ── */
authRoutes.post("/verify", async (c) => {
  await rateLimit(c.env.RL_AUTH, `verify:${clientIp(c)}`);
  const input = await body(c, z.object({ challenge: z.string().min(10).max(64), code }));
  const ch = await consumeChallenge(c.env, input.challenge, input.code, "login");
  await createSession(c, ch.member_id, !!ch.remember);
  await c.env.DB.batch([auditStmt(c.env, `member:${ch.member_id}`, "login", "session", null)]);
  return c.json({ ok: true });
});

authRoutes.post("/logout", async (c) => {
  await destroySession(c);
  return c.json({ ok: true });
});

authRoutes.get("/session", async (c) => {
  const s = await readSession(c);
  return c.json({ authenticated: !!s });
});

/* ── Forgotten password: email → code → new password ── */
authRoutes.post("/forgot", async (c) => {
  await rateLimit(c.env.RL_AUTH, `forgot:${clientIp(c)}`);
  const input = await body(c, z.object({ email, key }));
  const m = await findMemberByEmail(c.env, input.email);
  // same response whether or not the account exists
  if (!m || !m.is_active) return c.json({ challenge: (await sha256Hex(input.email + Date.now())).slice(0, 24), method: mailReady(c.env) ? "email" : "totp" });
  const { hash, salt } = await hashPassword(c.env, input.key);
  const ch = await createChallenge(c.env, m.id, "reset", { pendingHash: hash, pendingSalt: salt });
  if (m.totp_secret_enc) return c.json({ challenge: ch.id, method: "totp" });
  await sendCode(c, m.email, m.name, "reset", ch.code);
  return c.json({ challenge: ch.id, method: "email", devCode: devEcho(c, ch.code) });
});

authRoutes.post("/reset", async (c) => {
  await rateLimit(c.env.RL_AUTH, `reset:${clientIp(c)}`);
  const input = await body(c, z.object({ challenge: z.string().min(10).max(64), code }));
  const ch = await consumeChallenge(c.env, input.challenge, input.code, "reset");
  await c.env.DB.batch([
    c.env.DB.prepare(
      "UPDATE team_members SET password_hash = ?, password_salt = ?, email_verified_at = COALESCE(email_verified_at, ?), failed_logins = 0, locked_until = NULL WHERE id = ?",
    ).bind(ch.pending_hash, ch.pending_salt, Date.now(), ch.member_id),
    // a password reset signs out every device
    c.env.DB.prepare("DELETE FROM admin_sessions WHERE member_id = ?").bind(ch.member_id),
    auditStmt(c.env, `member:${ch.member_id}`, "password_reset", "team_member", ch.member_id),
  ]);
  await createSession(c, ch.member_id, false);
  return c.json({ ok: true });
});

/* ── Invitations: link → choose password → emailed code ── */

async function inviteRow(c: Parameters<typeof devEcho>[0], token: string) {
  const id = await sha256Hex(token);
  const row = await c.env.DB.prepare(
    `SELECT ch.id, ch.member_id, ch.expires_at, ch.consumed_at, m.email, m.name, r.name AS role_name
       FROM auth_challenges ch JOIN team_members m ON m.id = ch.member_id JOIN roles r ON r.id = m.role_id
      WHERE ch.id = ? AND ch.purpose = 'invite_link'`,
  )
    .bind(id)
    .first<{ id: string; member_id: number; expires_at: number; consumed_at: number | null; email: string; name: string; role_name: string }>();
  if (!row || row.consumed_at || row.expires_at < Date.now()) throw new HttpError(404, "invite_invalid");
  return row;
}

authRoutes.get("/invite/:token", async (c) => {
  await rateLimit(c.env.RL_AUTH, `invite:${clientIp(c)}`);
  const row = await inviteRow(c, c.req.param("token"));
  return c.json({ email: row.email, name: row.name, role: row.role_name });
});

authRoutes.post("/invite/accept", async (c) => {
  await rateLimit(c.env.RL_AUTH, `invite:${clientIp(c)}`);
  const input = await body(c, z.object({ token: z.string().min(20).max(100), key }));
  const row = await inviteRow(c, input.token);
  const { hash, salt } = await hashPassword(c.env, input.key);
  if (!mailReady(c.env) && !devEcho(c, "1")) {
    // no email service: the account is secured with an authenticator app instead (its first code confirms it)
    const secret = newTotpSecret();
    const ch = await createChallenge(c.env, row.member_id, "invite", {
      pendingHash: hash, pendingSalt: salt, remember: true, pendingTotp: await encryptSecret(c.env.SETTINGS_KEY, secret),
    });
    return c.json({ challenge: ch.id, method: "totp", totp: { secret, uri: totpUri(secret, row.email) } });
  }
  const ch = await createChallenge(c.env, row.member_id, "invite", { pendingHash: hash, pendingSalt: salt, remember: true });
  await sendCode(c, row.email, row.name, "invite", ch.code);
  return c.json({ challenge: ch.id, method: "email", devCode: devEcho(c, ch.code) });
});

authRoutes.post("/invite/verify", async (c) => {
  await rateLimit(c.env.RL_AUTH, `invite:${clientIp(c)}`);
  const input = await body(c, z.object({ token: z.string().min(20).max(100), challenge: z.string().min(10).max(64), code }));
  const row = await inviteRow(c, input.token);
  const ch = await consumeChallenge(c.env, input.challenge, input.code, "invite");
  if (ch.member_id !== row.member_id) throw new HttpError(400, "code_invalid");
  await c.env.DB.batch([
    c.env.DB.prepare(
      "UPDATE team_members SET password_hash = ?, password_salt = ?, email_verified_at = ?, is_active = 1, totp_secret_enc = COALESCE(?, totp_secret_enc), totp_last_step = COALESCE(?, totp_last_step) WHERE id = ?",
    ).bind(ch.pending_hash, ch.pending_salt, Date.now(), ch.pending_totp, ch.pending_totp ? ch.totp_step : null, row.member_id),
    c.env.DB.prepare("UPDATE auth_challenges SET consumed_at = ? WHERE id = ?").bind(Date.now(), row.id),
    auditStmt(c.env, `member:${row.member_id}`, "invite_accepted", "team_member", row.member_id),
  ]);
  await createSession(c, row.member_id, true);
  return c.json({ ok: true });
});

/** Creates an invitation link (used by Admin → Équipe and the CLI bootstrap). */
export async function createInvite(env: AppEnv["Bindings"], memberId: number): Promise<string> {
  const token = crypto.getRandomValues(new Uint8Array(32)).reduce((s, b) => s + b.toString(16).padStart(2, "0"), "");
  await env.DB.batch([
    env.DB.prepare("DELETE FROM auth_challenges WHERE member_id = ? AND purpose = 'invite_link'").bind(memberId),
    env.DB.prepare("INSERT INTO auth_challenges (id, member_id, purpose, code_hash, expires_at, created_at) VALUES (?, ?, 'invite_link', '', ?, ?)").bind(
      await sha256Hex(token), memberId, Date.now() + INVITE_TTL, Date.now(),
    ),
  ]);
  return token;
}

