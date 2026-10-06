/**
 * Authenticator-app codes (TOTP, RFC 6238: Google Authenticator, Microsoft Authenticator…),
 * the second step of the admin sign-in when no email service is configured: free, works
 * offline on the phone, no message to wait for. 6 digits, 30-second steps, ±1 step tolerated
 * for phone clocks; a step already used can't be used again.
 */
const ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

export function base32Encode(bytes: Uint8Array): string {
  let bits = 0;
  let value = 0;
  let out = "";
  for (const b of bytes) {
    value = (value << 8) | b;
    bits += 8;
    while (bits >= 5) {
      out += ALPHABET[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += ALPHABET[(value << (5 - bits)) & 31];
  return out;
}

export function base32Decode(text: string): Uint8Array {
  const clean = text.toUpperCase().replace(/[^A-Z2-7]/g, "");
  let bits = 0;
  let value = 0;
  const out: number[] = [];
  for (const ch of clean) {
    value = (value << 5) | ALPHABET.indexOf(ch);
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  return new Uint8Array(out);
}

/** A new secret (160 bits), base32 as authenticator apps expect. */
export function newTotpSecret(): string {
  return base32Encode(crypto.getRandomValues(new Uint8Array(20)));
}

/** The 6-digit code of one 30-second step. */
export async function totpCode(secret: string, step: number): Promise<string> {
  const key = await crypto.subtle.importKey("raw", base32Decode(secret), { name: "HMAC", hash: "SHA-1" }, false, ["sign"]);
  const counter = new ArrayBuffer(8);
  const view = new DataView(counter);
  view.setUint32(0, Math.floor(step / 2 ** 32));
  view.setUint32(4, step >>> 0);
  const mac = new Uint8Array(await crypto.subtle.sign("HMAC", key, counter));
  const offset = mac[mac.length - 1]! & 15;
  const n = ((mac[offset]! & 127) << 24) | (mac[offset + 1]! << 16) | (mac[offset + 2]! << 8) | mac[offset + 3]!;
  return String(n % 1_000_000).padStart(6, "0");
}

export const totpStep = (now = Date.now()) => Math.floor(now / 30_000);

/**
 * The step the code belongs to (current, previous or next), or null. `after`: the last step
 * already used by this person (a code is accepted once).
 */
export async function verifyTotp(secret: string, code: string, after: number | null = null, now = Date.now()): Promise<number | null> {
  if (!/^\d{6}$/.test(code)) return null;
  const step = totpStep(now);
  for (const s of [step, step - 1, step + 1]) {
    if (after != null && s <= after) continue;
    if ((await totpCode(secret, s)) === code) return s;
  }
  return null;
}

/** What the authenticator app reads (QR code or a tap on the phone). */
export function totpUri(secret: string, account: string): string {
  const label = encodeURIComponent(`Henine Boutique:${account}`);
  return `otpauth://totp/${label}?secret=${secret}&issuer=${encodeURIComponent("Henine Boutique")}&algorithm=SHA1&digits=6&period=30`;
}
