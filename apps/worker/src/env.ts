export interface Env {
  DB: D1Database;
  MEDIA: R2Bucket;
  ASSETS: Fetcher;
  RL_WRITE: RateLimit;
  RL_LOOKUP: RateLimit;
  RL_AUTH: RateLimit;

  ENVIRONMENT: "production" | "preview" | "development";
  PUBLIC_ORIGIN: string;
  MEDIA_ORIGIN: string;
  TURNSTILE_SITE_KEY: string;
  /** Optional extra gate: when set, /api/admin also requires a valid Cloudflare Access JWT. */
  ACCESS_TEAM_DOMAIN?: string;
  ACCESS_AUD?: string;

  // secrets
  TURNSTILE_SECRET: string;
  IP_HASH_SALT: string;
  TRACK_TOKEN_PEPPER: string;
  /** Server-side pepper for admin password hashes and email codes. */
  AUTH_PEPPER: string;
  /** base64 32-byte key: encrypts secrets stored in D1 settings (Telegram token…). */
  SETTINGS_KEY: string;

  /** "console" (dev: codes shown on screen/logs) | "resend" | "brevo" */
  MAIL_PROVIDER?: string;
  MAIL_API_KEY?: string;
  MAIL_FROM?: string;
}

export interface AdminMember {
  id: number;
  email: string;
  name: string;
  role: string;
  roleName: string;
  permissions: string[];
  sessionId: number;
}

export type AppEnv = {
  Bindings: Env;
  Variables: {
    member: AdminMember;
  };
};

export function isDev(env: Env): boolean {
  return env.ENVIRONMENT === "development";
}
