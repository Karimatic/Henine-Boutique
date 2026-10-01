import { describe, expect, it } from "vitest";
import type { Env } from "../env";
import { buildOrderMessage, permissionFor } from "./telegram";

/** Minimal D1 stand-in: answers queries in order from a script of results. */
function fakeEnv(order: Record<string, unknown>): Env {
  const script: unknown[] = [
    order, // loadOrder: order row (first)
    { results: [{ name_fr: "Nuisette Amira", options_label: "Rose poudré / S", qty: 1, unit_price: 2500, variant_id: 1 }] }, // items (all)
    { results: [{ actor: "member:1:Sarah", created_at: Date.UTC(2026, 9, 1, 13, 32) }] }, // last event (all)
  ];
  let i = 0;
  const stmt = {
    bind: () => stmt,
    first: async () => script[i++],
    all: async () => script[i++],
  };
  return { DB: { prepare: () => stmt } as unknown as D1Database, PUBLIC_ORIGIN: "http://127.0.0.1:8787" } as Env;
}

const base = {
  id: 7, public_code: "HN-PHYVGE", status: "nouvelle", channel: "express", name: "Karim", phone: "0793672479", wilaya_code: 35,
  wilaya_fr: "Boumerdès", commune_fr: "Dellys", commune_text: null, delivery_type: "domicile", address: "Sidi El Medjni",
  subtotal: 2500, discount_total: 0, shipping_price: 400, total: 2900, coupon_code: null, customer_note: null, risk_score: 0,
  telegram_message_id: 55, orders_count: 0, returned_count: 0, delivered_count: 0, is_blacklisted: 0, prev_orders: 0, prev_cancelled: 6,
  tracking_number: null, internal_note: null, locale: "ar",
};

describe("Telegram order message", () => {
  it("never presents cancelled orders as a loyal customer's orders", async () => {
    const m = await buildOrderMessage(fakeEnv(base), 7);
    expect(m!.text).toContain("🚫 6 annulée(s) avant");
    expect(m!.text).not.toContain("fidèle");
    expect(m!.text).not.toMatch(/\d+ cmd/);
  });

  it("calls a customer loyal only from delivered orders", async () => {
    const m = await buildOrderMessage(fakeEnv({ ...base, prev_cancelled: 0, delivered_count: 3, prev_orders: 3 }), 7);
    expect(m!.text).toContain("💎 cliente fidèle (3 livrée(s))");
    const first = await buildOrderMessage(fakeEnv({ ...base, prev_cancelled: 0 }), 7);
    expect(first!.text).toContain("🆕 première commande");
  });

  it("shows every action directly, two per row, with no sub-menu", async () => {
    const m = await buildOrderMessage(fakeEnv(base), 7);
    const rows = m!.reply_markup.inline_keyboard;
    expect(rows.every((r) => r.length <= 2)).toBe(true);
    const data = rows.flat().map((b) => b.callback_data ?? b.text);
    expect(data).toEqual([
      "s:7:confirmee", "s:7:injoignable",
      "s:7:annulee", "s:7:doublon",
      "s:7:fausse", "💬 WhatsApp",
      "h:7:note", "h:7:track",
      "r:7",
    ]);
    expect(rows.flat().some((b) => b.callback_data?.startsWith("v:"))).toBe(false);
    const wa = rows.flat().find((b) => b.url)!;
    expect(wa.url!.startsWith("https://wa.me/213793672479?text=")).toBe(true);
    expect(decodeURIComponent(wa.url!.split("text=")[1]!)).toContain("HN-PHYVGE");
    // no admin link button on a non-https origin (Telegram rejects such URLs)
    expect(rows.flat().some((b) => b.url?.includes("/admin/"))).toBe(false);
  });

  it("shows the team note and ZR tracking number", async () => {
    const m = await buildOrderMessage(fakeEnv({ ...base, status: "expediee", tracking_number: "ZR123456", internal_note: "rappeler après 18h" }), 7);
    expect(m!.text).toContain("📦 Suivi ZR : <code>ZR123456</code>");
    expect(m!.text).toContain("🔒 Équipe : rappeler après 18h");
    expect(m!.reply_markup.inline_keyboard.flat().map((b) => b.callback_data).slice(0, 3)).toEqual(["s:7:en_livraison", "s:7:livree", "s:7:retour"]);
  });

  it("maps button permissions by role", () => {
    expect(permissionFor("confirmee")).toBe("orders.confirm");
    expect(permissionFor("expediee")).toBe("orders.ship");
  });
});
