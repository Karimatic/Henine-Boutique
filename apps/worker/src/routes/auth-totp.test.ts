import { Hono } from "hono";
import { describe, expect, it } from "vitest";
import type { Env } from "../env";
import { totpCode, totpStep } from "../lib/totp";
import { testDb } from "../test/db";
import { authRoutes, createInvite } from "./auth";

const KEY = "a".repeat(64); // what the browser derives from the password (PBKDF2, hex)
const env = (db: ReturnType<typeof testDb>) =>
  ({
    DB: db, ENVIRONMENT: "production", PUBLIC_ORIGIN: "https://shop.test", MAIL_PROVIDER: "console",
    AUTH_PEPPER: "pepper", IP_HASH_SALT: "salt", SETTINGS_KEY: btoa(String.fromCharCode(...new Uint8Array(32).fill(7))),
  }) as unknown as Env;
// the routes behind the app's error handler (HttpError → its status)
const app = new Hono();
app.onError((err, c) => {
  const e = err as { status?: number; code?: string };
  return c.json({ error: e.code ?? "error" }, (typeof e.status === "number" ? e.status : 500) as 400);
});
app.route("/", authRoutes);
const ctx = { waitUntil: () => undefined, passThroughOnException: () => undefined } as unknown as ExecutionContext;

async function call(e: Env, path: string, body: unknown) {
  const res = await app.request(path, { method: "POST", headers: { "Content-Type": "application/json", Origin: "https://shop.test" }, body: JSON.stringify(body) }, e, ctx);
  return { status: res.status, body: (await res.json()) as Record<string, unknown> & { totp?: { secret: string; uri: string } } };
}

describe("admin sign-in without an email service: authenticator app", () => {
  it("invitation sets up the app, its codes sign in, a code works once", async () => {
    const db = testDb();
    const e = env(db);
    db.sqlite.exec("INSERT INTO team_members (id, email, name, role_id, is_active) VALUES (1, 'ilyas@shop.test', 'Ilyas', (SELECT id FROM roles WHERE key = 'owner'), 1)");
    const token = await createInvite(e, 1);

    const accept = await call(e, "/invite/accept", { token, key: KEY });
    expect(accept.status).toBe(200);
    expect(accept.body.method).toBe("totp");
    const secret = accept.body.totp!.secret;
    expect(accept.body.totp!.uri).toMatch(/^otpauth:\/\/totp\/Henine%20Boutique%3Ailyas%40shop\.test\?secret=/);

    // a wrong code is refused, the app's code activates the account
    expect((await call(e, "/invite/verify", { token, challenge: accept.body.challenge, code: "000000" })).status).toBe(400);
    const step = totpStep();
    expect((await call(e, "/invite/verify", { token, challenge: accept.body.challenge, code: await totpCode(secret, step) })).status).toBe(200);
    const m = await db.prepare("SELECT totp_secret_enc IS NOT NULL AS has, totp_last_step, password_hash IS NOT NULL AS pw FROM team_members WHERE id = 1").first();
    expect(m).toEqual({ has: 1, totp_last_step: step, pw: 1 });

    // sign in: password, then the app's code (no email)
    const login = await call(e, "/login", { email: "ilyas@shop.test", key: KEY });
    expect(login.body.method).toBe("totp");
    // the code already used to activate is refused; the next one works
    expect((await call(e, "/verify", { challenge: login.body.challenge, code: await totpCode(secret, step) })).status).toBe(400);
    expect((await call(e, "/verify", { challenge: login.body.challenge, code: await totpCode(secret, step + 1) })).status).toBe(200);
    // wrong password: no challenge at all
    expect((await call(e, "/login", { email: "ilyas@shop.test", key: "b".repeat(64) })).status).toBe(401);
  });

  it("with an email service the invitation still uses emailed codes", async () => {
    const db = testDb();
    const e = { ...env(db), MAIL_PROVIDER: "resend", MAIL_API_KEY: "k", MAIL_FROM: "Shop <a@b.c>" } as unknown as Env;
    db.sqlite.exec("INSERT INTO team_members (id, email, name, role_id, is_active) VALUES (1, 'ilyas@shop.test', 'Ilyas', (SELECT id FROM roles WHERE key = 'owner'), 1)");
    const token = await createInvite(e, 1);
    const realFetch = globalThis.fetch;
    globalThis.fetch = (async () => new Response("{}", { status: 200 })) as typeof fetch;
    try {
      const accept = await call(e, "/invite/accept", { token, key: KEY });
      expect(accept.body.method).toBe("email");
      expect(accept.body.totp).toBeUndefined();
    } finally {
      globalThis.fetch = realFetch;
    }
  });
});
