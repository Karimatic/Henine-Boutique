import { describe, expect, it } from "vitest";
import type { Env } from "../../env";
import { createOrder } from "../../lib/orders";
import { addOrder, member, seedShop, testApp, testDb, type TestDb } from "../../test/db";
import { orderRoutes } from "./orders";
import { sourceRoutes } from "./sources";

const envOf = (db: TestDb) => ({ DB: db, ENVIRONMENT: "development", PUBLIC_ORIGIN: "http://localhost:8787", MEDIA_ORIGIN: "" }) as unknown as Env;
const SETTINGS = {
  builtIn: { tiktok: { hidden: true }, instagram: { name: "Page Insta" } },
  custom: [{ key: "lina", name: "Influenceuse Lina", emoji: "💄" }],
  ask: true,
};

function shop() {
  const db = testDb();
  seedShop(db);
  db.sqlite.exec("UPDATE wilayas SET home_price = 500, desk_price = 300, is_active = 1 WHERE code = 35");
  return db;
}
let n = 10;
// a different phone each time: the shop's per-phone hourly limit is not what is tested here
const base = () => ({ idempotencyKey: crypto.randomUUID(), name: "Amina", phone: `05546507${n++}`, wilaya: 35, communeId: null, communeText: "Dellys", deliveryType: "domicile" as const, address: "Cité 200 logements", lines: [{ variantId: 1, qty: 1 }], channel: "web" as const, locale: "ar" as const });

describe("where customers come from (Statistiques → Sources)", () => {
  it("the shop's own link, the checkout answer and the visit's own source each count", async () => {
    const db = shop();
    const app = testApp(sourceRoutes, db);
    expect((await app.call("PUT", "/sources/settings", SETTINGS)).status).toBe(200);

    const viaLink = await createOrder(envOf(db), { ...base(), utm: { source: "Lina" } });
    const told = await createOrder(envOf(db), { ...base(), heardFrom: "word_of_mouth" });
    // the visit says Instagram: her answer doesn't replace it
    const tracked = await createOrder(envOf(db), { ...base(), utm: { referrer: "l.instagram.com" }, heardFrom: "word_of_mouth" });
    // an answer that is not in the shop's list is ignored
    const unknown = await createOrder(envOf(db), { ...base(), heardFrom: "tiktok" });
    const src = async (id: number) => (await db.prepare("SELECT source FROM orders WHERE id = ?").bind(id).first("source")) as string;
    expect(await src(viaLink.id)).toBe("lina");
    expect(await src(told.id)).toBe("word_of_mouth");
    expect(await src(tracked.id)).toBe("instagram");
    expect(await src(unknown.id)).toBe("direct");

    const r = await app.call<{ rows: { source: string; orders: number }[]; settings: typeof SETTINGS }>("GET", "/sources?range=30");
    expect(r.body.rows.find((x) => x.source === "lina")?.orders).toBe(1);
    expect(r.body.settings.custom[0]?.name).toBe("Influenceuse Lina");
  });

  it("refuses a link code that is a built-in name or used twice", async () => {
    const app = testApp(sourceRoutes, testDb());
    expect((await app.call("PUT", "/sources/settings", { ...SETTINGS, custom: [{ key: "instagram", name: "x", emoji: "" }] })).status).toBe(422);
    expect((await app.call("PUT", "/sources/settings", { ...SETTINGS, custom: [SETTINGS.custom[0], SETTINGS.custom[0]] })).status).toBe(422);
    expect((await app.call("PUT", "/sources/settings", { ...SETTINGS, custom: [{ key: "a b", name: "x", emoji: "" }] })).status).toBe(422);
  });

  it("the team corrects an order's source; the orders list filters by source", async () => {
    const db = shop();
    const id = addOrder(db, { status: "nouvelle", source: "direct" });
    addOrder(db, { status: "nouvelle", source: "facebook" });
    const app = testApp(sourceRoutes, db);
    expect((await app.call("PATCH", `/orders/${id}/source`, { source: "instagram" })).status).toBe(200);
    expect((await app.call("PATCH", `/orders/${id}/source`, { source: "nimporte" })).status).toBe(422);
    expect((await app.as(member(["orders.view"])).call("PATCH", `/orders/${id}/source`, { source: "facebook" })).status).toBe(403);
    const list = await testApp(orderRoutes, db).call<{ rows: { id: number; source: string }[] }>("GET", "/orders?status=all&source=instagram");
    expect(list.body.rows.map((o) => o.id)).toEqual([id]);
  });
});
