/**
 * Web Push (free, no third-party service): "back in stock" notifications on the customer's
 * phone. Standard VAPID (RFC 8292) + aes128gcm message encryption (RFC 8291), WebCrypto only.
 *
 * The VAPID key pair is created on first use and kept in D1 settings, the private half
 * encrypted with SETTINGS_KEY (nothing to configure). Push endpoints are restricted to the
 * browsers' own push services, so the Worker never posts to an arbitrary address.
 */
import { base64url, imageUrl, type ImageRef } from "@henine/shared";
import type { Env } from "../env";
import { recordError } from "./audit";
import { imageRef, variantLabels, type ImageRow } from "./catalog";
import { decryptSecret, encryptSecret } from "./crypto";

const enc = new TextEncoder();

export const PUSH_HOSTS = [/^fcm\.googleapis\.com$/, /^updates\.push\.services\.mozilla\.com$/, /(^|\.)push\.apple\.com$/, /(^|\.)notify\.windows\.com$/, /^push\.services\.mozilla\.com$/];

export function isPushEndpoint(url: string): boolean {
  try {
    const u = new URL(url);
    return u.protocol === "https:" && PUSH_HOSTS.some((re) => re.test(u.hostname));
  } catch {
    return false;
  }
}

export function unb64url(s: string): Uint8Array<ArrayBuffer> {
  const b = atob(s.replace(/-/g, "+").replace(/_/g, "/") + "=".repeat((4 - (s.length % 4)) % 4));
  const out = new Uint8Array(b.length);
  for (let i = 0; i < b.length; i++) out[i] = b.charCodeAt(i);
  return out;
}

function concat(...parts: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let o = 0;
  for (const p of parts) {
    out.set(p, o);
    o += p.length;
  }
  return out;
}

async function hmac(key: Uint8Array, data: Uint8Array): Promise<Uint8Array> {
  const k = await crypto.subtle.importKey("raw", key, { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return new Uint8Array(await crypto.subtle.sign("HMAC", k, data));
}

/* ───────────── VAPID keys ───────────── */

interface Vapid {
  publicKey: string; // base64url, 65-byte uncompressed point (what the browser needs)
  privateKey: CryptoKey;
}

let vapidCache: { pub: string; key: CryptoKey } | null = null;

export async function vapidKeys(env: Env): Promise<Vapid> {
  if (vapidCache) return { publicKey: vapidCache.pub, privateKey: vapidCache.key };
  let row = await env.DB.prepare("SELECT value FROM settings WHERE key = 'push_vapid'").first<{ value: string }>();
  if (!row) {
    const pair = (await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign", "verify"])) as CryptoKeyPair;
    const pub = base64url(new Uint8Array((await crypto.subtle.exportKey("raw", pair.publicKey)) as ArrayBuffer));
    const jwk = await crypto.subtle.exportKey("jwk", pair.privateKey);
    const value = JSON.stringify({ public: pub, private_enc: await encryptSecret(env.SETTINGS_KEY, JSON.stringify(jwk)) });
    // two first requests at once: the first insert wins, everyone reads it back
    await env.DB.prepare("INSERT INTO settings (key, value, updated_at) VALUES ('push_vapid', ?, ?) ON CONFLICT(key) DO NOTHING").bind(value, Date.now()).run();
    row = await env.DB.prepare("SELECT value FROM settings WHERE key = 'push_vapid'").first<{ value: string }>();
  }
  const stored = JSON.parse(row!.value) as { public: string; private_enc: string };
  const jwk = await decryptSecret(env.SETTINGS_KEY, stored.private_enc);
  if (!jwk) throw new Error("push: VAPID key unreadable (SETTINGS_KEY changed?)");
  const key = await crypto.subtle.importKey("jwk", JSON.parse(jwk) as JsonWebKey, { name: "ECDSA", namedCurve: "P-256" }, false, ["sign"]);
  vapidCache = { pub: stored.public, key };
  return { publicKey: stored.public, privateKey: key };
}

async function vapidHeader(env: Env, endpoint: string): Promise<string> {
  const { publicKey, privateKey } = await vapidKeys(env);
  const b64json = (o: object) => base64url(enc.encode(JSON.stringify(o)));
  const unsigned = `${b64json({ typ: "JWT", alg: "ES256" })}.${b64json({
    aud: new URL(endpoint).origin,
    exp: Math.floor(Date.now() / 1000) + 12 * 3600,
    sub: env.PUBLIC_ORIGIN.startsWith("https://") ? env.PUBLIC_ORIGIN : "mailto:contact@henine.boutique",
  })}`;
  const sig = new Uint8Array(await crypto.subtle.sign({ name: "ECDSA", hash: "SHA-256" }, privateKey, enc.encode(unsigned)));
  return `vapid t=${unsigned}.${base64url(sig)}, k=${publicKey}`;
}

/* ───────────── Message encryption (RFC 8291, aes128gcm) ───────────── */

/** `salt` / `local` are only passed by the tests (RFC 8291 test vector). */
export async function encryptPayload(
  p256dh: string,
  auth: string,
  payload: Uint8Array,
  salt = crypto.getRandomValues(new Uint8Array(16)),
  local?: CryptoKeyPair,
): Promise<Uint8Array> {
  const uaPublic = unb64url(p256dh);
  const authSecret = unb64url(auth);
  local ??= (await crypto.subtle.generateKey({ name: "ECDH", namedCurve: "P-256" }, true, ["deriveBits"])) as CryptoKeyPair;
  const asPublic = new Uint8Array((await crypto.subtle.exportKey("raw", local.publicKey)) as ArrayBuffer);
  const uaKey = await crypto.subtle.importKey("raw", uaPublic, { name: "ECDH", namedCurve: "P-256" }, false, []);
  // the standard field is "public" (Cloudflare's type definitions call it "$public")
  const ecdhParams = { name: "ECDH", public: uaKey } as unknown as SubtleCryptoDeriveKeyAlgorithm;
  const ecdh = new Uint8Array(await crypto.subtle.deriveBits(ecdhParams, local.privateKey, 256));

  // IKM = HKDF(auth_secret, ecdh_secret, "WebPush: info\0" || ua_public || as_public, 32)
  const prkKey = await hmac(authSecret, ecdh);
  const ikm = (await hmac(prkKey, concat(enc.encode("WebPush: info\0"), uaPublic, asPublic, new Uint8Array([1])))).slice(0, 32);
  // CEK / nonce = HKDF(salt, IKM, …)
  const prk = await hmac(salt, ikm);
  const cek = (await hmac(prk, concat(enc.encode("Content-Encoding: aes128gcm\0"), new Uint8Array([1])))).slice(0, 16);
  const nonce = (await hmac(prk, concat(enc.encode("Content-Encoding: nonce\0"), new Uint8Array([1])))).slice(0, 12);

  const key = await crypto.subtle.importKey("raw", cek, "AES-GCM", false, ["encrypt"]);
  const cipher = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv: nonce }, key, concat(payload, new Uint8Array([2])))); // 0x02: last record
  const rs = new Uint8Array([0, 0, 16, 0]); // record size 4096
  return concat(salt, rs, new Uint8Array([asPublic.length]), asPublic, cipher);
}

export interface PushMessage {
  title: string;
  body: string;
  url: string;
  icon?: string;
  tag?: string;
}

/** Sends one notification. "gone" = the browser unsubscribed: forget this subscription. */
export async function sendPush(env: Env, sub: { endpoint: string; p256dh: string; auth: string }, msg: PushMessage): Promise<"ok" | "gone" | "error"> {
  if (!isPushEndpoint(sub.endpoint)) return "gone";
  const body = await encryptPayload(sub.p256dh, sub.auth, enc.encode(JSON.stringify(msg)));
  const res = await fetch(sub.endpoint, {
    method: "POST",
    headers: {
      Authorization: await vapidHeader(env, sub.endpoint),
      "Content-Encoding": "aes128gcm",
      "Content-Type": "application/octet-stream",
      TTL: String(3 * 86400),
      Urgency: "normal",
    },
    body,
  });
  if (res.status === 404 || res.status === 410) return "gone";
  if (!res.ok) {
    await recordError(env, "push", `push ${res.status}: ${(await res.text()).slice(0, 200)}`);
    return "error";
  }
  return "ok";
}

/* ───────────── Back in stock ───────────── */

/**
 * Notifies the customers who asked for a push when a variant is available again.
 * `variantIds` = just restocked (admin); without it, every waiting variant that has stock
 * (cron catch-up). Capped per run: the free plan allows 50 outgoing requests per invocation.
 */
export async function sendRestockPushes(env: Env, variantIds?: number[], max = 40): Promise<number> {
  const only = variantIds?.length ? `AND a.variant_id IN (${variantIds.map(Number).join(",")})` : "";
  const { results } = await env.DB.prepare(
    `SELECT a.id AS alert_id, a.variant_id, s.id AS sub_id, s.endpoint, s.p256dh, s.auth, s.locale, p.id AS product_id, p.slug, p.name_fr, p.name_ar
       FROM stock_alerts a
       JOIN push_subscriptions s ON s.id = a.push_subscription_id
       JOIN variants v ON v.id = a.variant_id
       JOIN products p ON p.id = v.product_id
      WHERE a.notified_at IS NULL AND v.is_active = 1 AND v.stock_on_hand - v.stock_reserved > 0 AND p.status = 'published' ${only}
      ORDER BY a.created_at LIMIT ?`,
  )
    .bind(max)
    .all<{ alert_id: number; variant_id: number; sub_id: number; endpoint: string; p256dh: string; auth: string; locale: string; product_id: number; slug: string; name_fr: string; name_ar: string }>();
  if (!results.length) return 0;

  const productIds = [...new Set(results.map((r) => r.product_id))];
  const [labels, images] = await Promise.all([
    variantLabels(env, [...new Set(results.map((r) => r.variant_id))]),
    env.DB.prepare(`SELECT * FROM product_images WHERE product_id IN (${productIds.join(",")}) ORDER BY product_id, sort, id`).all<ImageRow>(),
  ]);
  const firstImage = new Map<number, ImageRef>();
  for (const r of images.results) if (!firstImage.has(r.product_id)) firstImage.set(r.product_id, imageRef(env, r));

  let sent = 0;
  const now = Date.now();
  for (const r of results) {
    const ar = r.locale === "ar";
    const name = ar ? r.name_ar : r.name_fr;
    const label = labels.get(r.variant_id)?.[ar ? "ar" : "fr"];
    const img = firstImage.get(r.product_id);
    const outcome = await sendPush(env, r, {
      title: ar ? "عاد إلى المخزون 🌸" : "De retour en stock 🌸",
      body: ar ? `«${name}»${label ? ` (${label})` : ""} متوفر من جديد، أسرعي قبل نفاد الكمية 💕` : `« ${name} »${label ? ` (${label})` : ""} est de nouveau disponible. Faites vite 💕`,
      url: new URL(`${ar ? "" : "/fr"}/produit/${r.slug}?utm_source=push&utm_medium=restock`, env.PUBLIC_ORIGIN).toString(),
      icon: img ? new URL(imageUrl(img, 480), env.PUBLIC_ORIGIN).toString() : undefined,
      tag: `restock-${r.variant_id}`,
    }).catch(() => "error" as const);
    if (outcome === "ok") sent++;
    if (outcome !== "error") {
      // delivered, or the browser is gone: either way this alert is done
      await env.DB.batch([
        env.DB.prepare("UPDATE stock_alerts SET notified_at = ? WHERE id = ?").bind(now, r.alert_id),
        ...(outcome === "gone"
          ? [
              env.DB.prepare("DELETE FROM stock_alerts WHERE push_subscription_id = ? AND notified_at IS NULL").bind(r.sub_id),
              env.DB.prepare("DELETE FROM push_subscriptions WHERE id = ?").bind(r.sub_id),
            ]
          : []),
      ]);
    }
  }
  return sent;
}
