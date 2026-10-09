import { describe, expect, it } from "vitest";
import {
  canTransition,
  createOrderInput,
  formatDA,
  formatFollowers,
  formatDzPhone,
  isOrderCode,
  isSafeLink,
  localePath,
  maskDzPhone,
  newOrderCode,
  normalizeDzPhone,
  stockEffect,
  timingSafeEqual,
  toE164,
} from "./index";

describe("phone", () => {
  it.each([
    ["0550123456", "0550123456"],
    ["0550 12 34 56", "0550123456"],
    ["+213 550 12 34 56", "0550123456"],
    ["00213-661-234-567", "0661234567"],
    ["213771234567", "0771234567"],
    ["550123456", "0550123456"],
  ])("normalizes %s", (input, expected) => {
    expect(normalizeDzPhone(input)).toBe(expected);
  });

  it.each(["0450123456", "021123456", "05501234", "055012345678", "abc", ""])("rejects %s", (input) => {
    expect(normalizeDzPhone(input)).toBeNull();
  });

  it("formats, masks and converts", () => {
    expect(formatDzPhone("0550123456")).toBe("0550 12 34 56");
    expect(maskDzPhone("0550123456")).toBe("05•• •• •• 56");
    expect(toE164("0550123456")).toBe("+213550123456");
  });
});

describe("money", () => {
  it("formats dinars", () => {
    expect(formatDA(4900)).toBe("4 900 DA");
    expect(formatDA(12500, "ar")).toBe("12 500 DA");
    expect(formatDA(0)).toBe("0 DA");
  });
});

describe("i18n", () => {
  it("builds locale paths", () => {
    expect(localePath("ar", "/")).toBe("/");
    expect(localePath("ar", "/suivi")).toBe("/suivi");
    expect(localePath("fr", "/")).toBe("/fr");
    expect(localePath("fr", "/suivi")).toBe("/fr/suivi");
  });
});

describe("order status machine", () => {
  it("allows the happy path", () => {
    expect(canTransition("nouvelle", "confirmee")).toBe(true);
    expect(canTransition("confirmee", "en_preparation")).toBe(true);
    expect(canTransition("en_preparation", "expediee")).toBe(true);
    expect(canTransition("expediee", "livree")).toBe(true);
  });

  it("blocks impossible jumps", () => {
    expect(canTransition("nouvelle", "livree")).toBe(false);
    expect(canTransition("livree", "nouvelle")).toBe(false);
    expect(canTransition("fausse", "confirmee")).toBe(false);
  });

  it("maps stock effects", () => {
    expect(stockEffect("nouvelle", "annulee")).toBe("release");
    expect(stockEffect("en_preparation", "expediee")).toBe("commit");
    expect(stockEffect("retour", "retour_recu")).toBe("restock");
    expect(stockEffect("annulee", "nouvelle")).toBe("reserve");
    expect(stockEffect("nouvelle", "confirmee")).toBeNull();
  });
});

describe("codes", () => {
  it("generates valid, unique order codes", () => {
    const codes = new Set(Array.from({ length: 500 }, newOrderCode));
    expect(codes.size).toBe(500);
    for (const c of codes) expect(isOrderCode(c)).toBe(true);
    expect(isOrderCode("HN-ILOU00")).toBe(false);
  });

  it("compares secrets in constant time", () => {
    expect(timingSafeEqual("abc", "abc")).toBe(true);
    expect(timingSafeEqual("abc", "abd")).toBe(false);
    expect(timingSafeEqual("abc", "abcd")).toBe(false);
  });
});

describe("createOrderInput", () => {
  const base = {
    idempotencyKey: "4b7e8c1e-2f6a-4d7b-9a1c-3e5f7a9b1c2d",
    name: "Amina B.",
    phone: "+213 550 12 34 56",
    wilaya: 16,
    communeId: 554,
    deliveryType: "domicile" as const,
    address: "Cité 500 logements, bt 12",
    lines: [{ variantId: 1, qty: 2 }],
  };

  it("accepts a valid order and normalizes the phone", () => {
    const r = createOrderInput.parse(base);
    expect(r.phone).toBe("0550123456");
    expect(r.channel).toBe("web");
  });

  it("requires an address for home delivery", () => {
    const r = createOrderInput.safeParse({ ...base, address: "" });
    expect(r.success).toBe(false);
  });

  it("does not require an address for stop-desk", () => {
    const r = createOrderInput.safeParse({ ...base, deliveryType: "bureau", address: undefined });
    expect(r.success).toBe(true);
  });

  it("rejects bad phones and unknown wilayas", () => {
    expect(createOrderInput.safeParse({ ...base, phone: "0212345678" }).success).toBe(false);
    expect(createOrderInput.safeParse({ ...base, wilaya: 70 }).success).toBe(false);
  });

  it("ignores any price the client tries to send", () => {
    const r = createOrderInput.parse({ ...base, total: 1, lines: [{ variantId: 1, qty: 1, price: 1 }] });
    expect("total" in r).toBe(false);
    expect("price" in r.lines[0]!).toBe(false);
  });
});

describe("isSafeLink", () => {
  it("accepts site pages and https addresses", () => {
    for (const l of ["/boutique", "/fr/c/robes?x=1", "https://wa.me/213555000000", "https://www.instagram.com/henine"]) expect(isSafeLink(l)).toBe(true);
  });
  it("refuses other websites in disguise and other schemes", () => {
    for (const l of ["//evil.example", "/\\evil.example", "http://evil.example", "javascript:alert(1)", "data:text/html,x", "https://", " /x"]) expect(isSafeLink(l)).toBe(false);
  });
});

describe("formatFollowers", () => {
  it("rounds down to K / M", () => {
    expect(formatFollowers(640)).toBe("640");
    expect(formatFollowers(89_345)).toBe("+89K");
    expect(formatFollowers(1_000)).toBe("+1K");
    expect(formatFollowers(1_250_000)).toBe("+1.2M");
    expect(formatFollowers(2_000_000)).toBe("+2M");
  });
});
