import { describe, expect, it } from "vitest";
import type { Env } from "../../env";
import { quote } from "../../lib/orders";
import { member, OWNER, seedShop, testApp, testDb } from "../../test/db";
import { systemRoutes } from "./system";

describe("commune delivery settings (Contenu → Livraison → communes)", () => {
  it("lists a wilaya's communes and the checkout uses their own home price and availability", async () => {
    const db = testDb();
    seedShop(db);
    const app = testApp(systemRoutes, db, OWNER);
    const list = await app.call<{ id: number; name_fr: string; home_price: number | null; home_supported: number }[]>("GET", "/content/wilayas/35/communes");
    expect(list.status).toBe(200);
    expect(list.body.length).toBeGreaterThan(5);
    const commune = list.body[0]!;
    const env = { DB: db } as unknown as Env;
    const ask = () => quote(env, { lines: [{ variantId: 1, qty: 1 }], wilaya: 35, communeId: commune.id, deliveryType: "domicile" });

    const wilayaPrice = (await ask()).shipping;
    expect((await app.call("PUT", "/content/communes", { ids: [commune.id], homePrice: 900 })).status).toBe(200);
    expect((await ask()).shipping).toBe(900);

    // back to the wilaya's price
    await app.call("PUT", "/content/communes", { ids: [commune.id], homePrice: null });
    expect((await ask()).shipping).toBe(wilayaPrice);

    // no home delivery in this commune: only the stop-desk remains
    await app.call("PUT", "/content/communes", { ids: [commune.id], homeSupported: false });
    expect((await ask()).deliveryAvailable).toBe(false);
  });

  it("needs the delivery permission", async () => {
    const db = testDb();
    const app = testApp(systemRoutes, db, member(["orders.view"]));
    expect((await app.call("PUT", "/content/communes", { ids: [1], homePrice: 500 })).status).toBe(403);
  });
});
