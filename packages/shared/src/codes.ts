/**
 * Random identifiers. Uses Web Crypto (available in Workers, browsers and Node ≥ 19).
 */

// Crockford base32 without I, L, O, U: nothing a customer can misread on the phone.
const CROCKFORD = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";

function randomChars(length: number, alphabet: string): string {
  // alphabet length is 32 → a byte & 31 is unbiased
  const bytes = crypto.getRandomValues(new Uint8Array(length));
  let out = "";
  for (const b of bytes) out += alphabet[b & 31];
  return out;
}

/** Public order code, e.g. "HN-7K3P9Q". ~1 billion combinations, non-sequential. */
export function newOrderCode(): string {
  return `HN-${randomChars(6, CROCKFORD)}`;
}

export function isOrderCode(value: string): boolean {
  return /^HN-[0-9A-HJKMNP-TV-Z]{6}$/.test(value.trim().toUpperCase());
}

/** 128-bit URL-safe secret (tracking links, review links). Only its hash is stored. */
export function newSecretToken(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  return base64url(bytes);
}

export function base64url(bytes: Uint8Array): string {
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/** SHA-256(pepper + value) as hex. Used for tokens and IP hashes. */
export async function sha256Hex(value: string, pepper = ""): Promise<string> {
  const data = new TextEncoder().encode(pepper + value);
  const digest = await crypto.subtle.digest("SHA-256", data);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/** Constant-time string comparison for secrets (webhook tokens, hashes). */
export function timingSafeEqual(a: string, b: string): boolean {
  const ea = new TextEncoder().encode(a);
  const eb = new TextEncoder().encode(b);
  let diff = ea.length ^ eb.length;
  const len = Math.max(ea.length, eb.length);
  for (let i = 0; i < len; i++) diff |= (ea[i] ?? 0) ^ (eb[i] ?? 0);
  return diff === 0;
}
