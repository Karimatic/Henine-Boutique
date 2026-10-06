import { describe, expect, it } from "vitest";
import { addOrder, member, OWNER, seedShop, testApp, testDb } from "../../test/db";
import { financeRoutes } from "./finance";

function setup() {
  const db = testDb();
  seedShop(db);
  // known courier rates for the tests: Boumerdès 500 at home, 300 at the desk
  db.sqlite.exec("UPDATE wilayas SET home_price = 500, desk_price = 300 WHERE code = 35; UPDATE settings SET value = json_set(value, '$.packaging_cost', 0) WHERE key = 'operations';");
  return { db, app: testApp(financeRoutes, db) };
}

describe("finance: cash on delivery", () => {
  it("brief example end to end: 10000 collected, fee 500, 9500 paid → reconciled, nothing outstanding", async () => {
    const { db, app } = setup();
    const id = addOrder(db, { status: "livree", total: 10_000, items: [{ variantId: 1, qty: 1, price: 9_400 }], shipping: 600 });

    let r = await app.call<{ rows: { id: number; outstanding: number; status: string; estimated: boolean }[] }>("GET", "/finance/cod?range=30");
    expect(r.body.rows.find((x) => x.id === id)).toMatchObject({ outstanding: 9_500, status: "pending", estimated: true });

    expect((await app.call("PUT", `/finance/cod/${id}`, { collected: 10_000, carrierFee: 500, returnFee: null, disputed: false })).status).toBe(200);
    const pay = await app.call<{ id: number; amount: number }>("POST", "/finance/remittances", { receivedOn: "2026-10-06", reference: "ZR-0042", allocations: [{ orderId: id, amount: 9_500 }] });
    expect(pay).toMatchObject({ status: 201, body: { amount: 9_500 } });

    r = await app.call("GET", "/finance/cod?range=30");
    expect(r.body.rows.find((x) => x.id === id)).toMatchObject({ outstanding: 0, status: "reconciled", estimated: false });

    // the payment, its line and the audit trail were saved together
    expect(await db.prepare("SELECT order_id, amount FROM cod_allocations WHERE remittance_id = ?").bind(pay.body.id).all()).toMatchObject({ results: [{ order_id: id, amount: 9_500 }] });
    expect(await db.prepare("SELECT COUNT(*) AS n FROM audit_log WHERE entity = 'cod_remittance' AND entity_id = ?").bind(String(pay.body.id)).first("n")).toBe(1);
  });

  it("partial payment, then a voided payment makes the order owed again", async () => {
    const { db, app } = setup();
    const id = addOrder(db, { status: "livree", total: 6_000 });
    const pay = await app.call<{ id: number }>("POST", "/finance/remittances", { receivedOn: "2026-10-06", allocations: [{ orderId: id, amount: 2_000 }] });
    let row = (await app.call<{ rows: { id: number; status: string; outstanding: number }[] }>("GET", "/finance/cod?range=30")).body.rows.find((x) => x.id === id);
    expect(row).toMatchObject({ status: "partial", outstanding: 3_500 });
    expect((await app.call("POST", `/finance/remittances/${pay.body.id}/void`, { reason: "saisie en double" })).status).toBe(200);
    row = (await app.call<{ rows: { id: number; status: string; outstanding: number }[] }>("GET", "/finance/cod?range=30")).body.rows.find((x) => x.id === id);
    expect(row).toMatchObject({ status: "pending", outstanding: 5_500 });
    // a voided payment can't be voided twice
    expect((await app.call("POST", `/finance/remittances/${pay.body.id}/void`, { reason: "encore" })).status).toBe(409);
  });

  it("returned parcels owe the return fee; boutique sales are not courier parcels", async () => {
    const { db, app } = setup();
    const back = addOrder(db, { status: "retour_recu", total: 4_000 });
    const shop = addOrder(db, { status: "livree", channel: "boutique", total: 3_000, shipping: 0 });
    const r = await app.call<{ rows: { id: number; netExpected: number; returnFee: number }[]; totals: { orders: number } }>("GET", "/finance/cod?range=30");
    expect(r.body.rows.find((x) => x.id === back)).toMatchObject({ returnFee: 500, netExpected: -500 });
    expect(r.body.rows.some((x) => x.id === shop)).toBe(false);
    expect((await app.call("PUT", `/finance/cod/${shop}`, { collected: 3_000, carrierFee: null, returnFee: null, disputed: false })).status).toBe(409);
  });

  it("refuses a payment for an order not delivered yet, twice the same order, a zero line, a dispute without a note", async () => {
    const { db, app } = setup();
    const open = addOrder(db, { status: "confirmee" });
    const done = addOrder(db, { status: "livree" });
    expect((await app.call<{ error: string }>("POST", "/finance/remittances", { receivedOn: "2026-10-06", allocations: [{ orderId: open, amount: 100 }] })).body.error).toBe("not_settled");
    expect((await app.call<{ error: string }>("POST", "/finance/remittances", { receivedOn: "2026-10-06", allocations: [{ orderId: done, amount: 100 }, { orderId: done, amount: 5 }] })).body.error).toBe("order_twice");
    expect((await app.call<{ error: string }>("POST", "/finance/remittances", { receivedOn: "2026-10-06", allocations: [{ orderId: done, amount: 0 }] })).body.error).toBe("zero_amount");
    expect((await app.call<{ error: string }>("PUT", `/finance/cod/${done}`, { collected: 1, carrierFee: null, returnFee: null, disputed: true })).body.error).toBe("dispute_needs_note");
    expect((await app.call("POST", "/finance/remittances", { receivedOn: "06/10/2026", allocations: [{ orderId: done, amount: 100 }] })).status).toBe(422);
    expect(await db.prepare("SELECT COUNT(*) AS n FROM cod_remittances").first("n")).toBe(0);
  });
});

describe("finance: business result", () => {
  it("revenue, gross profit, order-level profit, expenses and net profit, with the recorded courier fee", async () => {
    const { db, app } = setup();
    // delivered: 2 × 3000 (cost 1200 each), customer paid 300 for delivery, courier fee 500 recorded → shop pays 200
    const a = addOrder(db, { status: "livree", items: [{ variantId: 1, qty: 2, price: 3_000 }], shipping: 300 });
    await app.call("PUT", `/finance/cod/${a}`, { collected: null, carrierFee: 500, returnFee: null, disputed: false });
    // returned: the courier's fee (rate 500) is lost
    addOrder(db, { status: "retour", items: [{ variantId: 1, qty: 1, price: 3_000 }] });
    // cancelled orders don't count
    addOrder(db, { status: "annulee" });
    await app.call("POST", "/expenses", { spentOn: new Date().toISOString().slice(0, 10), amount: 1_000, category: "advertising", description: "Pub Instagram" });

    const r = await app.call<{ pnl: Record<string, number> }>("GET", "/finance/summary?range=30");
    expect(r.body.pnl).toMatchObject({
      revenue: 6_000, discounts: 0, cogs: 2_400, grossProfit: 3_600, deliveryCosts: 200, returnCosts: 500, packaging: 0,
      orderProfit: 2_900, operatingExpenses: 1_000, netProfit: 1_900, delivered: 1, returned: 1, missingCost: 0, estimatedFees: 1,
    });
  });
});

describe("finance: expenses", () => {
  it("create, edit, filter, void (kept, out of the totals), and only the owner deletes", async () => {
    const { app } = setup();
    const today = new Date().toISOString().slice(0, 10);
    const e = await app.call<{ id: number }>("POST", "/expenses", { spentOn: today, amount: 25_000, category: "rent", description: "Loyer octobre", paymentMethod: "cash" });
    await app.call("POST", "/expenses", { spentOn: today, amount: 4_000, category: "utilities", description: "Électricité" });
    expect((await app.call("PATCH", `/expenses/${e.body.id}`, { spentOn: today, amount: 26_000, category: "rent", description: "Loyer octobre", paymentMethod: "ccp" })).status).toBe(200);

    let list = await app.call<{ total: number; count: number; rows: { category: string }[] }>("GET", "/expenses?category=rent");
    expect(list.body).toMatchObject({ total: 26_000, count: 1 });
    list = await app.call("GET", "/expenses?q=lectri");
    expect(list.body.count).toBe(1);

    expect((await app.call("POST", `/expenses/${e.body.id}/void`, { reason: "doublon" })).status).toBe(200);
    expect((await app.call<{ total: number }>("GET", "/expenses")).body.total).toBe(4_000);
    expect((await app.call<{ total: number; count: number }>("GET", "/expenses?voided=1")).body).toMatchObject({ total: 4_000, count: 2 });
    expect((await app.call("PATCH", `/expenses/${e.body.id}`, { spentOn: today, amount: 1, category: "rent", description: "x2" })).status).toBe(409);

    // a manager can void but not erase
    expect((await app.as(member(["finance.view", "finance.edit"])).call("DELETE", `/expenses/${e.body.id}`)).status).toBe(403);
    expect((await app.as(OWNER).call("DELETE", `/expenses/${e.body.id}`)).status).toBe(200);
  });

  it("validates amounts, dates and categories", async () => {
    const { app } = setup();
    for (const bad of [
      { spentOn: "2026-10-06", amount: 0, category: "rent", description: "Loyer" },
      { spentOn: "2026-10-06", amount: 10.5, category: "rent", description: "Loyer" },
      { spentOn: "hier", amount: 100, category: "rent", description: "Loyer" },
      { spentOn: "2026-10-06", amount: 100, category: "voyage", description: "Loyer" },
    ])
      expect((await app.call("POST", "/expenses", bad)).status).toBe(422);
  });
});

describe("finance: permissions (enforced by the API)", () => {
  it("viewing needs finance.view, recording needs finance.edit", async () => {
    const { db, app } = setup();
    const id = addOrder(db, { status: "livree" });
    app.as(member(["orders.view", "stats.view"]));
    for (const [m, p] of [["GET", "/finance/summary"], ["GET", "/finance/cod"], ["GET", "/expenses"], ["GET", "/finance/remittances"]] as const) expect((await app.call(m, p)).status).toBe(403);
    app.as(member(["finance.view"]));
    expect((await app.call("GET", "/finance/summary")).status).toBe(200);
    expect((await app.call("POST", "/expenses", { spentOn: "2026-10-06", amount: 100, category: "rent", description: "Loyer" })).status).toBe(403);
    expect((await app.call("PUT", `/finance/cod/${id}`, { collected: 1, carrierFee: null, returnFee: null, disputed: false })).status).toBe(403);
    expect((await app.call("POST", "/finance/remittances", { receivedOn: "2026-10-06", allocations: [{ orderId: id, amount: 1 }] })).status).toBe(403);
  });
});
