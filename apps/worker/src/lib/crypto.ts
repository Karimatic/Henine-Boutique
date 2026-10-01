import { base64url, sha256Hex } from "@henine/shared";

export { sha256Hex };

export function randomToken(bytes = 32): string {
  return base64url(crypto.getRandomValues(new Uint8Array(bytes)));
}

/** 6-digit numeric code, uniformly distributed. */
export function randomCode(): string {
  const buf = new Uint32Array(1);
  let n: number;
  do {
    crypto.getRandomValues(buf);
    n = buf[0]!;
  } while (n >= 4_294_000_000); // reject the tail so n % 1e6 is unbiased
  return String(n % 1_000_000).padStart(6, "0");
}

/* ── AES-GCM for secrets stored in D1 (bot tokens, API keys) ── */

let keyCache: { raw: string; key: CryptoKey } | null = null;

async function settingsKey(raw: string): Promise<CryptoKey> {
  if (keyCache?.raw === raw) return keyCache.key;
  if (!raw) throw new Error("SETTINGS_KEY is not configured");
  const bytes = Uint8Array.from(atob(raw), (c) => c.charCodeAt(0));
  if (bytes.length !== 32) throw new Error("SETTINGS_KEY must be 32 bytes (base64)");
  const key = await crypto.subtle.importKey("raw", bytes, "AES-GCM", false, ["encrypt", "decrypt"]);
  keyCache = { raw, key };
  return key;
}

const b64 = (u: Uint8Array) => btoa(String.fromCharCode(...u));
const unb64 = (s: string) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));

export async function encryptSecret(rawKey: string, plaintext: string): Promise<string> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, await settingsKey(rawKey), new TextEncoder().encode(plaintext));
  return `v1.${b64(iv)}.${b64(new Uint8Array(ct))}`;
}

export async function decryptSecret(rawKey: string, sealed: string | null | undefined): Promise<string | null> {
  if (!sealed) return null;
  const [v, iv, ct] = sealed.split(".");
  if (v !== "v1" || !iv || !ct) return null;
  try {
    const pt = await crypto.subtle.decrypt({ name: "AES-GCM", iv: unb64(iv) }, await settingsKey(rawKey), unb64(ct));
    return new TextDecoder().decode(pt);
  } catch {
    return null;
  }
}

/** "••••1234" for display of write-only secrets. */
export function maskSecret(value: string | null): string | null {
  return value ? `••••${value.slice(-4)}` : null;
}
