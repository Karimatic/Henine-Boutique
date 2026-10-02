import { base64url } from "@henine/shared";
import { describe, expect, it } from "vitest";
import { encryptPayload, isPushEndpoint, unb64url } from "./webpush";

/** RFC 8291, Appendix A: the published example must come out byte for byte. */
describe("web push encryption (RFC 8291)", () => {
  it("matches the RFC test vector", async () => {
    const asPublic = unb64url("BP4z9KsN6nGRTbVYI_c7VJSPQTBtkgcy27mlmlMoZIIgDll6e3vCYLocInmYWAmS6TlzAC8wEqKK6PBru3jl7A8");
    const jwk: JsonWebKey = {
      kty: "EC",
      crv: "P-256",
      d: "yfWPiYE-n46HLnH0KqZOF1fJJU3MYrct3AELtAQ-oRw",
      x: base64url(asPublic.slice(1, 33)),
      y: base64url(asPublic.slice(33, 65)),
      ext: true,
    };
    const privateKey = await crypto.subtle.importKey("jwk", jwk, { name: "ECDH", namedCurve: "P-256" }, true, ["deriveBits"]);
    const publicKey = await crypto.subtle.importKey("raw", asPublic, { name: "ECDH", namedCurve: "P-256" }, true, []);
    const body = await encryptPayload(
      "BCVxsr7N_eNgVRqvHtD0zTZsEc6-VV-JvLexhqUzORcxaOzi6-AYWXvTBHm4bjyPjs7Vd8pZGH6SRpkNtoIAiw4",
      "BTBZMqHH6r4Tts7J_aSIgg",
      new TextEncoder().encode("When I grow up, I want to be a watermelon"),
      unb64url("DGv6ra1nlYgDCS1FRnbzlw"),
      { privateKey, publicKey },
    );
    expect(base64url(body)).toBe(
      "DGv6ra1nlYgDCS1FRnbzlwAAEABBBP4z9KsN6nGRTbVYI_c7VJSPQTBtkgcy27mlmlMoZIIgDll6e3vCYLocInmYWAmS6TlzAC8wEqKK6PBru3jl7A_yl95bQpu6cVPTpK4Mqgkf1CXztLVBSt2Ks3oZwbuwXPXLWyouBWLVWGNWQexSgSxsj_Qulcy4a-fN",
    );
  });

  it("only talks to the browsers' push services", () => {
    expect(isPushEndpoint("https://fcm.googleapis.com/fcm/send/abc")).toBe(true);
    expect(isPushEndpoint("https://web.push.apple.com/QGuQ")).toBe(true);
    expect(isPushEndpoint("https://updates.push.services.mozilla.com/wpush/v2/x")).toBe(true);
    expect(isPushEndpoint("https://evil.example.com/fcm.googleapis.com")).toBe(false);
    expect(isPushEndpoint("http://fcm.googleapis.com/x")).toBe(false);
    expect(isPushEndpoint("https://fcm.googleapis.com.evil.com/x")).toBe(false);
  });
});
