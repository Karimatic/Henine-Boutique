/**
 * Admin authentication: email + password, then a 6-digit code: from the authenticator app
 * (TOTP) for members who set one up, else sent by email.
 *
 * Password handling (see team_members.password_hash):
 *   browser:  key  = PBKDF2-SHA256(password, "henine-admin|" + email, 600 000 it.) → hex
 *   server:   hash = SHA-256(AUTH_PEPPER | salt | key)   (salt: random per member)
 * Sessions: random 256-bit token in an HttpOnly/SameSite=Strict cookie; only its hash is stored.
 */
import type { Context } from "hono";
import { deleteCookie, getCookie, setCookie } from "hono/cookie";
import { timingSafeEqual } from "@henine/shared";
import type { AppEnv, Env } from "../env";
import { isDev } from "../env";
import { decryptSecret, randomCode, randomToken, sha256Hex } from "./crypto";
import { mailProvider } from "./mail";
import { verifyTotp } from "./totp";
import { HttpError, ipHash, uaShort } from "./http";

export const SESSION_TTL_SHORT = 12 * 3600_000; // 12 h
export const SESSION_TTL_LONG = 30 * 24 * 3600_000; // "Rester connectée": 30 days
export const CODE_TTL = 10 * 60_000;
export const INVITE_TTL = 7 * 24 * 3600_000;
const MAX_CODE_ATTEMPTS = 5;
const MAX_FAILED_LOGINS = 5;
const LOCK_MS = 15 * 60_000;

export function cookieName(env: Env): string {
  // __Host- requires Secure, which browsers only honour on https (and localhost in Chromium).
  return isDev(env) ? "henine_admin" : "__Host-henine_admin";
}

/* ── password hashes ── */

export async function hashPassword(env: Env, clientKey: string, salt?: string) {
  const s = salt ?? randomToken(16);
  return { hash: await sha256Hex(`${s}|${clientKey}`, `${env.AUTH_PEPPER}|`), salt: s };
}

export async function checkPassword(env: Env, clientKey: string, hash: string | null, salt: string | null): Promise<boolean> {
  if (!hash || !salt) {
    // equalise timing for unknown accounts
    await sha256Hex(`x|${clientKey}`, env.AUTH_PEPPER);
    return false;
  }
  const { hash: candidate } = await hashPassword(env, clientKey, salt);
  return timingSafeEqual(candidate, hash);
}

export const codeHash = (env: Env, challengeId: string, code: string) => sha256Hex(`${challengeId}|${code}`, `${env.AUTH_PEPPER}|code|`);

/* ── lockout ── */

export interface MemberAuthRow {
  id: number;
  email: string;
  name: string;
  is_active: number;
  password_hash: string | null;
  password_salt: string | null;
  failed_logins: number;
  locked_until: number | null;
  email_verified_at: number | null;
  totp_secret_enc: string | null;
}

export async function findMemberByEmail(env: Env, email: string): Promise<MemberAuthRow | null> {
  return env.DB.prepare(
    "SELECT id, email, name, is_active, password_hash, password_salt, failed_logins, locked_until, email_verified_at, totp_secret_enc FROM team_members WHERE email = ?",
  )
    .bind(email.trim().toLowerCase())
    .first<MemberAuthRow>();
}

export function assertNotLocked(m: MemberAuthRow) {
  if (m.locked_until && m.locked_until > Date.now()) throw new HttpError(429, "account_locked", { until: m.locked_until });
}

export async function registerFailure(env: Env, m: MemberAuthRow) {
  const failed = m.failed_logins + 1;
  const lock = failed >= MAX_FAILED_LOGINS ? Date.now() + LOCK_MS : null;
  await env.DB.prepare("UPDATE team_members SET failed_logins = ?, locked_until = ? WHERE id = ?")
    .bind(lock ? 0 : failed, lock, m.id)
    .run();
}

/* ── email challenges ── */

export async function createChallenge(
  env: Env,
  memberId: number,
  purpose: "login" | "reset" | "invite",
  opts: { remember?: boolean; pendingHash?: string; pendingSalt?: string; pendingTotp?: string } = {},
) {
  const id = randomToken(18);
  const code = randomCode();
  // one live challenge per member & purpose
  await env.DB.batch([
    env.DB.prepare("DELETE FROM auth_challenges WHERE member_id = ? AND purpose = ? AND consumed_at IS NULL").bind(memberId, purpose),
    env.DB.prepare(
      "INSERT INTO auth_challenges (id, member_id, purpose, code_hash, pending_hash, pending_salt, pending_totp, remember, expires_at, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
    ).bind(
      id, memberId, purpose, await codeHash(env, id, code), opts.pendingHash ?? null, opts.pendingSalt ?? null, opts.pendingTotp ?? null,
      opts.remember ? 1 : 0, Date.now() + CODE_TTL, Date.now(),
    ),
  ]);
  return { id, code };
}

interface ChallengeRow {
  id: string;
  member_id: number;
  purpose: string;
  code_hash: string;
  pending_hash: string | null;
  pending_salt: string | null;
  /** invitation without email: the authenticator secret being set up (encrypted) */
  pending_totp: string | null;
  remember: number;
  attempts: number;
  expires_at: number;
  consumed_at: number | null;
}

/** Verifies a code; consumes the challenge on success. Throws on failure. */
export async function consumeChallenge(env: Env, challengeId: string, code: string, purpose: string): Promise<ChallengeRow & { totp_step: number | null }> {
  const ch = await env.DB.prepare("SELECT * FROM auth_challenges WHERE id = ?").bind(challengeId).first<ChallengeRow>();
  if (!ch || ch.purpose !== purpose || ch.consumed_at || ch.expires_at < Date.now()) throw new HttpError(400, "code_expired");
  if (ch.attempts >= MAX_CODE_ATTEMPTS) throw new HttpError(429, "too_many_attempts");
  // the authenticator app's code (members who have one, or the invitation setting it up), else the emailed code
  const totp = await totpOf(env, ch);
  let step: number | null = null;
  if (totp) step = await verifyTotp(totp.secret, code.trim(), totp.lastStep);
  const ok = totp ? step != null : timingSafeEqual(await codeHash(env, ch.id, code.trim()), ch.code_hash);
  if (!ok) {
    await env.DB.prepare("UPDATE auth_challenges SET attempts = attempts + 1 WHERE id = ?").bind(ch.id).run();
    throw new HttpError(400, "code_invalid", { attemptsLeft: MAX_CODE_ATTEMPTS - ch.attempts - 1 });
  }
  const res = await env.DB.prepare("UPDATE auth_challenges SET consumed_at = ? WHERE id = ? AND consumed_at IS NULL").bind(Date.now(), ch.id).run();
  if (!res.meta.changes) throw new HttpError(400, "code_expired"); // lost a race with a parallel request
  // an authenticator code works once
  if (totp && !ch.pending_totp && step != null) await env.DB.prepare("UPDATE team_members SET totp_last_step = ? WHERE id = ?").bind(step, ch.member_id).run();
  return { ...ch, totp_step: step };
}

/** The authenticator secret that checks this challenge's code, if any. */
async function totpOf(env: Env, ch: ChallengeRow): Promise<{ secret: string; lastStep: number | null } | null> {
  if (ch.pending_totp) {
    const secret = await decryptSecret(env.SETTINGS_KEY, ch.pending_totp);
    return secret ? { secret, lastStep: null } : null;
  }
  if (ch.purpose !== "login" && ch.purpose !== "reset") return null;
  const m = await env.DB.prepare("SELECT totp_secret_enc, totp_last_step FROM team_members WHERE id = ?")
    .bind(ch.member_id)
    .first<{ totp_secret_enc: string | null; totp_last_step: number | null }>();
  if (!m?.totp_secret_enc) return null;
  const secret = await decryptSecret(env.SETTINGS_KEY, m.totp_secret_enc);
  return secret ? { secret, lastStep: m.totp_last_step } : null;
}

/** An email service is configured (Resend / Brevo with its key): codes can be emailed. */
export const mailReady = (env: Env) => mailProvider(env) !== "console";

/* ── sessions ── */

export async function createSession(c: Context<AppEnv>, memberId: number, remember: boolean) {
  const token = randomToken(32);
  const ttl = remember ? SESSION_TTL_LONG : SESSION_TTL_SHORT;
  const now = Date.now();
  await c.env.DB.batch([
    c.env.DB.prepare(
      "INSERT INTO admin_sessions (member_id, token_hash, user_agent, ip_hash, created_at, last_seen_at, expires_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
    ).bind(memberId, await sha256Hex(token), uaShort(c), await ipHash(c), now, now, now + ttl),
    c.env.DB.prepare("UPDATE team_members SET failed_logins = 0, locked_until = NULL, last_seen_at = ? WHERE id = ?").bind(now, memberId),
    // housekeeping
    c.env.DB.prepare("DELETE FROM admin_sessions WHERE expires_at < ?").bind(now),
    c.env.DB.prepare("DELETE FROM auth_challenges WHERE expires_at < ?").bind(now - 24 * 3600_000),
  ]);
  setCookie(c, cookieName(c.env), token, {
    httpOnly: true,
    secure: !isDev(c.env),
    sameSite: "Strict",
    path: "/",
    maxAge: Math.floor(ttl / 1000),
  });
}

export interface SessionMember {
  sessionId: number;
  id: number;
  email: string;
  name: string;
  role: string;
  roleName: string;
  permissions: string;
  lastSeenAt: number;
}

export async function readSession(c: Context<AppEnv>): Promise<SessionMember | null> {
  const token = getCookie(c, cookieName(c.env));
  if (!token || token.length > 100) return null;
  const row = await c.env.DB.prepare(
    `SELECT s.id AS sessionId, s.last_seen_at AS lastSeenAt, m.id, m.email, m.name, r.key AS role, r.name AS roleName, r.permissions
       FROM admin_sessions s
       JOIN team_members m ON m.id = s.member_id
       JOIN roles r ON r.id = m.role_id
      WHERE s.token_hash = ? AND s.expires_at > ? AND m.is_active = 1`,
  )
    .bind(await sha256Hex(token), Date.now())
    .first<SessionMember>();
  if (!row) return null;
  // refresh last-seen at most every 5 minutes (keeps D1 writes low)
  if (Date.now() - row.lastSeenAt > 5 * 60_000) {
    c.executionCtx.waitUntil(
      c.env.DB.batch([
        c.env.DB.prepare("UPDATE admin_sessions SET last_seen_at = ? WHERE id = ?").bind(Date.now(), row.sessionId),
        c.env.DB.prepare("UPDATE team_members SET last_seen_at = ? WHERE id = ?").bind(Date.now(), row.id),
      ]),
    );
  }
  return row;
}

export async function destroySession(c: Context<AppEnv>) {
  const token = getCookie(c, cookieName(c.env));
  if (token) await c.env.DB.prepare("DELETE FROM admin_sessions WHERE token_hash = ?").bind(await sha256Hex(token)).run();
  deleteCookie(c, cookieName(c.env), { path: "/", secure: !isDev(c.env) });
}

/** Only on localhost in development: lets you finish email flows without a mail provider. */
export function devEcho(c: Context<AppEnv>, value: string): string | undefined {
  const host = new URL(c.req.url).hostname;
  return isDev(c.env) && (host === "localhost" || host === "127.0.0.1") ? value : undefined;
}

export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

export function passwordKeyValid(key: string): boolean {
  return /^[0-9a-f]{64}$/.test(key);
}
