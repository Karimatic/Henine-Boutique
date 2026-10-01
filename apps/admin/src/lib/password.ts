/**
 * Password stretching happens here, in the browser (600 000 PBKDF2-SHA256 iterations,
 * ~0.3–1 s on a phone). Only the derived key leaves the device; the Worker then does a
 * cheap salted+peppered SHA-256, which fits Cloudflare's 10 ms CPU budget.
 * The salt is derived from the email so no "get salt" endpoint can leak which emails exist.
 */
export async function derivePasswordKey(email: string, password: string): Promise<string> {
  const material = await crypto.subtle.importKey("raw", new TextEncoder().encode(password), "PBKDF2", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits(
    { name: "PBKDF2", hash: "SHA-256", salt: new TextEncoder().encode(`henine-admin|${email.trim().toLowerCase()}`), iterations: 600_000 },
    material,
    256,
  );
  return [...new Uint8Array(bits)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

export function passwordProblems(password: string, email: string): string | null {
  if (password.length < 10) return "10 caractères minimum.";
  if (password.toLowerCase().includes(email.split("@")[0]!.toLowerCase())) return "Ne doit pas contenir votre email.";
  if (/^(.)\1+$/.test(password) || /^(0123456789|1234567890|azertyuiop|motdepasse)/i.test(password)) return "Trop simple.";
  return null;
}
