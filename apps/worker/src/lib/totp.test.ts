import { describe, expect, it } from "vitest";
import { base32Decode, base32Encode, newTotpSecret, totpCode, verifyTotp } from "./totp";

// RFC 6238 test vector: ASCII "12345678901234567890" as the SHA-1 key
const RFC_SECRET = base32Encode(new TextEncoder().encode("12345678901234567890"));

describe("authenticator codes (TOTP)", () => {
  it("matches the RFC 6238 test vectors (last 6 digits)", async () => {
    expect(await totpCode(RFC_SECRET, Math.floor(59 / 30))).toBe("287082");
    expect(await totpCode(RFC_SECRET, Math.floor(1111111109 / 30))).toBe("081804");
    expect(await totpCode(RFC_SECRET, Math.floor(2000000000 / 30))).toBe("279037");
  });

  it("accepts the current code and one step of clock drift, never the same step twice", async () => {
    const s = newTotpSecret();
    const now = 1_791_300_000_000;
    const step = Math.floor(now / 30_000);
    expect(await verifyTotp(s, await totpCode(s, step), null, now)).toBe(step);
    expect(await verifyTotp(s, await totpCode(s, step - 1), null, now)).toBe(step - 1);
    expect(await verifyTotp(s, await totpCode(s, step - 3), null, now)).toBeNull();
    expect(await verifyTotp(s, await totpCode(s, step), step, now)).toBeNull(); // already used
    expect(await verifyTotp(s, "12345", null, now)).toBeNull();
  });

  it("base32 round trip", () => {
    const b = crypto.getRandomValues(new Uint8Array(20));
    expect([...base32Decode(base32Encode(b))]).toEqual([...b]);
  });
});
