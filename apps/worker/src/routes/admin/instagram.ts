/**
 * Instagram (official API, free): connect the shop's account once, then pick photos of its
 * posts straight from the product editor. Uses "Instagram API with Instagram Login"
 * (professional account + a long-lived token, refreshed by the daily cron).
 *
 * The admin never loads Instagram's CDN directly (strict CSP): thumbnails and full photos
 * go through /instagram/image, which only fetches Instagram/Facebook CDN addresses.
 */
import { Hono } from "hono";
import { z } from "zod";
import type { AppEnv } from "../../env";
import type { Env } from "../../env";
import { auditStmt } from "../../lib/audit";
import { decryptSecret, encryptSecret } from "../../lib/crypto";
import { body, HttpError } from "../../lib/http";
import { bumpCatalogStmt, getSetting, setSetting, setSettingStmt } from "../../lib/settings";
import { actorOf, requirePermission } from "../../middleware/access";

export const instagramRoutes = new Hono<AppEnv>();

const GRAPH = "https://graph.instagram.com";

interface IgError {
  error?: { message?: string; code?: number };
}

async function graph<T>(path: string, token: string, params: Record<string, string> = {}): Promise<T> {
  const url = new URL(`${GRAPH}${path}`);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  url.searchParams.set("access_token", token);
  const res = await fetch(url, { headers: { Accept: "application/json" } });
  const data = (await res.json().catch(() => ({}))) as T & IgError;
  if (!res.ok || data.error) {
    const code = data.error?.code;
    // 190 = token expired / revoked (409, not 401: a 401 would log the admin out)
    throw new HttpError(code === 190 ? 409 : 422, code === 190 ? "instagram_token_expired" : "instagram_error", { message: data.error?.message?.slice(0, 200) });
  }
  return data;
}

async function igToken(env: Env): Promise<string> {
  const ig = await getSetting(env, "instagram");
  const token = await decryptSecret(env.SETTINGS_KEY, ig.token_enc);
  if (!token) throw new HttpError(409, "instagram_not_connected");
  return token;
}

/** Instagram / Facebook CDN only: the proxy can't be used to reach anything else. */
export function isInstagramCdn(raw: string): boolean {
  try {
    const u = new URL(raw);
    return u.protocol === "https:" && (/(^|\.)cdninstagram\.com$/.test(u.hostname) || /(^|\.)fbcdn\.net$/.test(u.hostname));
  } catch {
    return false;
  }
}

/* ───────────── Connection (Paramètres → Connexions) ───────────── */

instagramRoutes.get("/integrations/instagram", requirePermission("products.edit"), async (c) => {
  const ig = await getSetting(c.env, "instagram");
  return c.json({ connected: !!ig.token_enc, username: ig.username, refreshedAt: ig.refreshed_at });
});

instagramRoutes.post("/integrations/instagram", requirePermission("integrations.manage"), async (c) => {
  const { token } = await body(c, z.object({ token: z.string().trim().min(40).max(600).regex(/^[A-Za-z0-9_|-]+$/, "token_format") }));
  const me = await graph<{ user_id?: string; id?: string; username: string; media_count?: number; followers_count?: number }>("/me", token, {
    fields: "user_id,username,media_count,followers_count",
  });
  await setSetting(c.env, "instagram", {
    token_enc: await encryptSecret(c.env.SETTINGS_KEY, token),
    username: me.username,
    user_id: String(me.user_id ?? me.id ?? ""),
    refreshed_at: Date.now(),
    followers: me.followers_count ?? null,
    followers_at: me.followers_count != null ? Date.now() : null,
  });
  await c.env.DB.batch([auditStmt(c.env, actorOf(c.get("member")), "update", "integration", "instagram"), bumpCatalogStmt(c.env)]);
  return c.json({ username: me.username, mediaCount: me.media_count ?? null });
});

instagramRoutes.delete("/integrations/instagram", requirePermission("integrations.manage"), async (c) => {
  await setSetting(c.env, "instagram", { token_enc: null, username: null, user_id: null, refreshed_at: null, followers: null, followers_at: null });
  await c.env.DB.batch([auditStmt(c.env, actorOf(c.get("member")), "delete", "integration", "instagram"), bumpCatalogStmt(c.env)]);
  return c.json({ ok: true });
});

/* ───────────── Posts & photos (product editor) ───────────── */

interface IgMedia {
  id: string;
  caption?: string;
  media_type: "IMAGE" | "VIDEO" | "CAROUSEL_ALBUM";
  media_url?: string;
  thumbnail_url?: string;
  permalink: string;
  timestamp: string;
  children?: { data: { id: string; media_type: string; media_url?: string; thumbnail_url?: string }[] };
}

const proxied = (url: string) => `/api/admin/instagram/image?u=${encodeURIComponent(url)}`;

instagramRoutes.get("/instagram/media", requirePermission("products.edit"), async (c) => {
  const token = await igToken(c.env);
  const after = c.req.query("after");
  const data = await graph<{ data: IgMedia[]; paging?: { cursors?: { after?: string }; next?: string } }>("/me/media", token, {
    fields: "id,caption,media_type,media_url,thumbnail_url,permalink,timestamp,children{id,media_type,media_url,thumbnail_url}",
    limit: "18",
    ...(after && /^[A-Za-z0-9_=-]{1,400}$/.test(after) ? { after } : {}),
  });
  const posts = data.data.map((m) => {
    // photos only: a video's cover is not a product photo
    const parts = m.media_type === "CAROUSEL_ALBUM" ? (m.children?.data ?? []) : [m];
    const photos = parts.filter((p) => p.media_type === "IMAGE" && p.media_url && isInstagramCdn(p.media_url)).map((p) => ({ id: p.id, src: proxied(p.media_url!) }));
    return {
      id: m.id,
      caption: (m.caption ?? "").slice(0, 300),
      permalink: m.permalink,
      takenAt: Date.parse(m.timestamp) || null,
      type: m.media_type,
      cover: m.media_type === "VIDEO" ? (m.thumbnail_url && isInstagramCdn(m.thumbnail_url) ? proxied(m.thumbnail_url) : null) : (photos[0]?.src ?? null),
      photos,
    };
  });
  return c.json({ posts: posts.filter((p) => p.photos.length), next: data.paging?.next ? (data.paging.cursors?.after ?? null) : null });
});

instagramRoutes.get("/instagram/image", requirePermission("products.edit"), async (c) => {
  const url = c.req.query("u") ?? "";
  if (!isInstagramCdn(url)) throw new HttpError(400, "invalid_url");
  const res = await fetch(url, { redirect: "follow" });
  const type = res.headers.get("Content-Type") ?? "";
  if (!res.ok || !/^image\/(jpeg|png|webp|heic|avif)/.test(type)) throw new HttpError(404, "not_found");
  return new Response(res.body, {
    headers: { "Content-Type": type, "Cache-Control": "private, max-age=3600", "X-Content-Type-Options": "nosniff", "Content-Security-Policy": "default-src 'none'; sandbox" },
  });
});

/** Daily cron: the account's real follower count, for the home page's Instagram card. */
export async function syncInstagramFollowers(env: Env): Promise<void> {
  const ig = await getSetting(env, "instagram");
  const token = await decryptSecret(env.SETTINGS_KEY, ig.token_enc);
  if (!token) return;
  const me = await graph<{ followers_count?: number }>("/me", token, { fields: "followers_count" });
  if (me.followers_count == null || me.followers_count === ig.followers) return;
  await env.DB.batch([
    setSettingStmt(env, "instagram", { ...ig, followers: me.followers_count, followers_at: Date.now() }),
    bumpCatalogStmt(env),
  ]);
}

/** Daily cron: long-lived tokens last 60 days; refreshing weekly keeps the connection alive. */
export async function refreshInstagramToken(env: Env): Promise<void> {
  const ig = await getSetting(env, "instagram");
  const token = await decryptSecret(env.SETTINGS_KEY, ig.token_enc);
  if (!token || (ig.refreshed_at && Date.now() - ig.refreshed_at < 7 * 86400_000)) return;
  const r = await graph<{ access_token: string }>("/refresh_access_token", token, { grant_type: "ig_refresh_token" });
  await setSetting(env, "instagram", { ...ig, token_enc: await encryptSecret(env.SETTINGS_KEY, r.access_token), refreshed_at: Date.now() });
}
