import { describe, expect, it } from "vitest";
import { addOrder, member, seedShop, testApp, testDb } from "../../test/db";
import { financeRoutes } from "./finance";
import { operationRoutes } from "./operations";

const SLA = { confirmMinutes: 30, prepareMinutes: 120, shipMinutes: 1440 };

describe("per-parcel costs named by the shop (Paramètres → Coûts de chaque commande)", () => {
  it("saves the lines, their total comes off each order's real profit", async () => {
    const db = testDb();
    seedShop(db);
    db.sqlite.exec("UPDATE wilayas SET home_price = 500, desk_price = 300 WHERE code = 35;");
    const ops = testApp(operationRoutes, db);
    const costs = [
      { label: "Sachet", amount: 40 },
      { label: "Carte de remerciement", amount: 25 },
      { label: "Sticker", amount: 10 },
    ];
    expect((await ops.call("PUT", "/operations/settings", { sla: SLA, orderCosts: costs })).status).toBe(200);
    const saved = await ops.call<{ packaging_cost: number; order_costs: typeof costs }>("GET", "/operations/settings");
    expect(saved.body.order_costs).toEqual(costs);
    expect(saved.body.packaging_cost).toBe(75);

    // two delivered parcels → 150 DA of parcel costs in the result
    addOrder(db, { status: "livree", items: [{ variantId: 1, qty: 1, price: 3_000 }], shipping: 500 });
    addOrder(db, { status: "livree", items: [{ variantId: 1, qty: 1, price: 3_000 }], shipping: 500 });
    const fin = await testApp(financeRoutes, db).call<{ pnl: { packaging: number } }>("GET", "/finance/summary?range=30");
    expect(fin.body.pnl.packaging).toBe(150);
  });

  it("someone who can't see costs can't change them", async () => {
    const db = testDb();
    seedShop(db);
    const ops = testApp(operationRoutes, db, member(["orders.view", "orders.edit"]));
    await ops.call("PUT", "/operations/settings", { sla: SLA, orderCosts: [{ label: "Sachet", amount: 999 }] });
    const saved = await testApp(operationRoutes, db).call<{ packaging_cost: number }>("GET", "/operations/settings");
    expect(saved.body.packaging_cost).not.toBe(999);
  });
});
