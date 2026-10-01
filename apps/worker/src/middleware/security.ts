import type { MiddlewareHandler } from "hono";
import type { AppEnv } from "../env";

const BASE_HEADERS: Record<string, string> = {
  "Strict-Transport-Security": "max-age=63072000; includeSubDomains; preload",
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "strict-origin-when-cross-origin",
  "Cross-Origin-Opener-Policy": "same-origin",
  "X-Frame-Options": "DENY",
};

/** API responses: JSON only, never framed, never cached unless a route opts in. */
export const apiHeaders: MiddlewareHandler<AppEnv> = async (c, next) => {
  await next();
  for (const [k, v] of Object.entries(BASE_HEADERS)) c.res.headers.set(k, v);
  c.res.headers.set("Content-Security-Policy", "default-src 'none'; frame-ancestors 'none'");
  if (!c.res.headers.has("Cache-Control")) c.res.headers.set("Cache-Control", "no-store");
};

/**
 * CSRF defence for state-changing requests: same-origin only, JSON bodies only.
 * (Browsers always send Origin on cross-site POST/PUT/PATCH/DELETE.)
 */
export const sameOriginWrites: MiddlewareHandler<AppEnv> = async (c, next) => {
  const method = c.req.method;
  if (method === "GET" || method === "HEAD" || method === "OPTIONS") return next();
  // server-to-server webhooks authenticate with their own secret instead
  if (new URL(c.req.url).pathname.startsWith("/api/tg/")) return next();

  const origin = c.req.header("Origin");
  const self = new URL(c.req.url).origin;
  if (!origin || (origin !== self && origin !== c.env.PUBLIC_ORIGIN)) {
    return c.json({ error: "forbidden_origin" }, 403);
  }
  const type = c.req.header("Content-Type") ?? "";
  if (!type.startsWith("application/json") && !type.startsWith("multipart/form-data")) {
    return c.json({ error: "unsupported_media_type" }, 415);
  }
  return next();
};

/** Admin SPA document: strict CSP (Vite emits no inline scripts, so no nonce is needed). */
export function adminDocumentHeaders(headers: Headers, mediaOrigin: string): void {
  for (const [k, v] of Object.entries(BASE_HEADERS)) headers.set(k, v);
  const img = ["'self'", "data:", "blob:", mediaOrigin].filter(Boolean).join(" ");
  headers.set(
    "Content-Security-Policy",
    [
      "default-src 'self'",
      "script-src 'self'",
      "style-src 'self' 'unsafe-inline'",
      `img-src ${img}`,
      `media-src 'self' blob: ${mediaOrigin}`.trim(),
      "connect-src 'self'",
      "font-src 'self'",
      "worker-src 'self' blob:",
      "object-src 'none'",
      "base-uri 'none'",
      "form-action 'self'",
      "frame-ancestors 'none'",
    ].join("; "),
  );
  headers.set("Permissions-Policy", "camera=(self), microphone=(), geolocation=(), payment=()");
  headers.set("Cache-Control", "no-store");
  headers.set("X-Robots-Tag", "noindex, nofollow");
}
