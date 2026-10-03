import type { Context } from "hono";
import type { z } from "zod";
import type { AppEnv, Env } from "../env";
import { isDev } from "../env";
import { sha256Hex } from "./crypto";

export class HttpError extends Error {
  constructor(
    public status: 400 | 401 | 403 | 404 | 409 | 413 | 415 | 422 | 429 | 500 | 503,
    public code: string,
    public details?: unknown,
  ) {
    super(code);
  }
}

/** Parse + validate a JSON body; 422 with field errors on failure. */
export async function body<S extends z.ZodType>(c: Context<AppEnv>, schema: S): Promise<z.infer<S>> {
  let raw: unknown;
  try {
    raw = await c.req.json();
  } catch {
    throw new HttpError(400, "invalid_json");
  }
  return validate(raw, schema);
}

/** Same checks as body() on an already-read value (e.g. the JSON part of a form with files). */
export function validate<S extends z.ZodType>(raw: unknown, schema: S): z.infer<S> {
  const parsed = schema.safeParse(raw);
  if (!parsed.success) {
    const fields: Record<string, string> = {};
    for (const issue of parsed.error.issues) fields[issue.path.join(".") || "_"] ??= issue.message;
    throw new HttpError(422, "validation_failed", fields);
  }
  return parsed.data;
}

export function intParam(c: Context<AppEnv>, name: string): number {
  const v = Number(c.req.param(name));
  if (!Number.isInteger(v) || v <= 0) throw new HttpError(400, "invalid_id");
  return v;
}

export function clientIp(c: Context<AppEnv>): string {
  return c.req.header("CF-Connecting-IP") ?? c.req.header("X-Forwarded-For")?.split(",")[0]?.trim() ?? "0.0.0.0";
}

export async function ipHash(c: Context<AppEnv>): Promise<string> {
  const day = new Date().toISOString().slice(0, 10); // rotates daily: not linkable across days
  return (await sha256Hex(`${clientIp(c)}|${day}`, c.env.IP_HASH_SALT)).slice(0, 32);
}

/** Workers Rate Limiting binding; skipped gracefully if unavailable. */
export async function rateLimit(binding: RateLimit | undefined, key: string): Promise<void> {
  if (!binding) return;
  const { success } = await binding.limit({ key });
  if (!success) throw new HttpError(429, "rate_limited");
}

/** Cloudflare Turnstile verification. In development any token passes (test keys always pass anyway). */
export async function verifyTurnstile(env: Env, token: string, ip: string): Promise<void> {
  if (isDev(env)) return;
  const form = new FormData();
  form.append("secret", env.TURNSTILE_SECRET);
  form.append("response", token);
  form.append("remoteip", ip);
  const res = await fetch("https://challenges.cloudflare.com/turnstile/v0/siteverify", { method: "POST", body: form });
  const out = (await res.json().catch(() => ({ success: false }))) as { success: boolean };
  if (!out.success) throw new HttpError(403, "turnstile_failed");
}

export function uaShort(c: Context<AppEnv>): string {
  const ua = c.req.header("User-Agent") ?? "";
  const os = /Android/.test(ua) ? "Android" : /iPhone|iPad/.test(ua) ? "iOS" : /Windows/.test(ua) ? "Windows" : /Mac OS/.test(ua) ? "macOS" : "Autre";
  const br = /Edg\//.test(ua) ? "Edge" : /Chrome\//.test(ua) ? "Chrome" : /Firefox\//.test(ua) ? "Firefox" : /Safari\//.test(ua) ? "Safari" : "Autre";
  return `${br} · ${os}`;
}

export const now = () => Date.now();
