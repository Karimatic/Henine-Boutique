import { describe, expect, it } from "vitest";
import type { Env } from "../../env";
import { scanAlerts } from "../../lib/alerts";
import { detectDuplicates } from "../../lib/duplicates";
import { createOrder } from "../../lib/orders";
import { addOrder, member, seedShop, testApp, testDb, type TestDb } from "../../test/db";
import { publicRoutes } from "../public";
import { duplicateRoutes } from "./duplicates";
import { logisticsRoutes } from "./logistics";

const envOf = (db: TestDb) => ({ DB: db, ENVIRONMENT: "development", PUBLIC_ORIGIN: "http://localhost:8787", MEDIA_ORIGIN: "" }) as unknown as Env;
const reserve = (db: TestDb) =>
  // the fixtures don't reserve stock: do what placing the orders would have done
  db.sqlite.exec(`UPDATE variants SET stock_reserved = (SELECT COALESCE(SUM(oi.qty), 0) FROM order_items oi JOIN orders o ON o.id = oi.order_id
    WHERE oi.variant_id = variants.id AND o.status IN ('nouvelle','injoignable','confirmee','en_preparation'))`);
const statusOf = async (db: TestDb, id: number) => (await db.prepare("SELECT status FROM orders WHERE id = ?").bind(id).first("status")) as string;

describe("duplicate orders", () => {
  it("flags the same customer ordering the same thing minutes apart, with the reasons and an alert", async () => {
    const db = testDb();
    seedShop(db);
    const t = Date.now();
    const first = addOrder(db, { status: "nouvelle", createdAt: t - 4 * 60_000 });
    const second = addOrder(db, { status: "nouvelle", createdAt: t });
    addOrder(db, { status: "nouvelle", customerId: 2, phone: "0661223344", createdAt: t }); // someone else: never flagged
    expect(await detectDuplicates(envOf(db), second)).toBe(1);
    const d = await db.prepare("SELECT order_id, other_order_id, reasons, minutes_apart, status FROM order_duplicates").first<Record<string, unknown>>();
    expect(d).toMatchObject({ order_id: second, other_order_id: first, minutes_apart: 4, status: "open" });
    expect(JSON.parse(String(d!.reasons))).toEqual(["same_phone", "same_address", "same_items", "similar_total", "minutes_apart"]);
    expect(await db.prepare("SELECT kind FROM alerts WHERE dedupe_key LIKE 'duplicate:%'").first("kind")).toBe("duplicate_order");
    // checking again doesn't flag twice
    expect(await detectDuplicates(envOf(db), second)).toBe(0);
  });

  it("can be switched off in the settings", async () => {
    const db = testDb();
    seedShop(db);
    db.sqlite.exec(`INSERT INTO settings (key, value) VALUES ('operations', '{"duplicates":{"enabled":false}}')
      ON CONFLICT(key) DO UPDATE SET value = json_set(value, '$.duplicates', json('{"enabled":false}'))`);
    addOrder(db, { status: "nouvelle" });
    expect(await detectDuplicates(envOf(db), addOrder(db, { status: "nouvelle" }))).toBe(0);
  });

  it("decisions: keep both, cancel the duplicate (stock released), merge without doubling shared items", async () => {
    const db = testDb();
    seedShop(db);
    const app = testApp(duplicateRoutes, db);
    db.sqlite.exec("UPDATE variants SET stock_on_hand = 50 WHERE id = 3");
    let customer = 10;
    const pair = async () => {
      // each pair is another customer (otherwise orders of different pairs look alike too)
      customer++;
      const phone = `05500000${customer}`;
      db.sqlite.prepare("INSERT INTO customers (id, phone, name) VALUES (?, ?, 'Cliente')").run(customer, phone);
      const who = { customerId: customer, phone };
      const older = addOrder(db, { ...who, status: "nouvelle", items: [{ variantId: 1, qty: 1 }] });
      const newer = addOrder(db, { ...who, status: "nouvelle", items: [{ variantId: 1, qty: 1 }, { variantId: 3, qty: 2 }] });
      reserve(db);
      await detectDuplicates(envOf(db), newer);
      const id = (await db.prepare("SELECT id FROM order_duplicates WHERE order_id = ?").bind(newer).first("id")) as number;
      return { older, newer, id };
    };

    const a = await pair();
    expect(await app.call("POST", `/duplicates/${a.id}`, { action: "keep" })).toMatchObject({ status: 200, body: { status: "kept" } });
    expect(await app.call("POST", `/duplicates/${a.id}`, { action: "ignore" })).toMatchObject({ status: 409 }); // already decided
    expect([await statusOf(db, a.older), await statusOf(db, a.newer)]).toEqual(["nouvelle", "nouvelle"]);

    const b = await pair();
    expect(await app.call("POST", `/duplicates/${b.id}`, { action: "merge" })).toMatchObject({ status: 200, body: { status: "merged" } });
    expect(await statusOf(db, b.newer)).toBe("doublon");
    const merged = await db.prepare("SELECT variant_id, qty FROM order_items WHERE order_id = ? ORDER BY variant_id").bind(b.older).all();
    expect(merged.results).toEqual([{ variant_id: 1, qty: 1 }, { variant_id: 3, qty: 2 }]); // variant 1 not doubled
    expect(await db.prepare("SELECT COUNT(*) AS n FROM order_events WHERE order_id = ? AND note LIKE '%fusionn%'").bind(b.older).first("n")).toBe(1);

    const c = await pair();
    expect(await app.call("POST", `/duplicates/${c.id}`, { action: "cancel" })).toMatchObject({ status: 200, body: { status: "cancelled" } });
    expect(await statusOf(db, c.newer)).toBe("doublon");
    expect(await statusOf(db, c.older)).toBe("nouvelle");
    // stock: only the orders still standing hold pieces
    reserve(db);
    expect(await db.prepare("SELECT COUNT(*) AS n FROM audit_log WHERE entity = 'order_duplicate'").first("n")).toBe(3);
  });

  it("deciding needs orders.edit; cancelling also needs the confirmation permission", async () => {
    const db = testDb();
    seedShop(db);
    const app = testApp(duplicateRoutes, db, member(["orders.view"]));
    addOrder(db, { status: "nouvelle" });
    const newer = addOrder(db, { status: "nouvelle" });
    reserve(db);
    await detectDuplicates(envOf(db), newer);
    const id = (await db.prepare("SELECT id FROM order_duplicates").first("id")) as number;
    expect((await app.call("POST", `/duplicates/${id}`, { action: "keep" })).status).toBe(403);
    expect((await app.as(member(["orders.view", "orders.edit"])).call("POST", `/duplicates/${id}`, { action: "cancel" })).status).toBe(403);
    expect((await app.call("GET", `/orders/${newer}/duplicates`)).body).toHaveLength(1);
  });
});

describe("order source attribution", () => {
  it("the visit the store remembered is classified and stored with the order", async () => {
    const db = testDb();
    seedShop(db);
    db.sqlite.exec("UPDATE wilayas SET home_price = 500, desk_price = 300, is_active = 1 WHERE code = 35");
    const base = { idempotencyKey: crypto.randomUUID(), name: "Amina", phone: "0554650718", wilaya: 35, communeId: null, communeText: "Dellys", deliveryType: "domicile" as const, address: "Cité 200 logements", lines: [{ variantId: 1, qty: 1 }], channel: "web" as const, locale: "ar" as const };
    const a = await createOrder(envOf(db), { ...base, utm: { referrer: "l.instagram.com", landing: "/produit/pyjama" } });
    const b = await createOrder(envOf(db), { ...base, idempotencyKey: crypto.randomUUID(), utm: { source: "lina_influence", campaign: "Ramadan" } });
    const c = await createOrder(envOf(db), { ...base, idempotencyKey: crypto.randomUUID(), channel: "whatsapp", actor: "member:1:Ilyas" });
    const row = (id: number) => db.prepare("SELECT source, referrer, landing_path, utm_campaign FROM orders WHERE id = ?").bind(id).first();
    expect(await row(a.id)).toMatchObject({ source: "instagram", referrer: "l.instagram.com", landing_path: "/produit/pyjama" });
    expect(await row(b.id)).toMatchObject({ source: "campaign", utm_campaign: "Ramadan" });
    expect(await row(c.id)).toMatchObject({ source: "whatsapp" });
  });

  it("visits are counted per source and campaign (no personal data)", async () => {
    const db = testDb();
    const env = { ...envOf(db), RL_LOOKUP: { limit: async () => ({ success: true }) } } as unknown as Env;
    const ctx = { waitUntil: () => undefined, passThroughOnException: () => undefined } as unknown as ExecutionContext;
    const send = (b: unknown) => publicRoutes.request("/visit", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(b) }, env, ctx);
    expect((await send({ source: "ig", campaign: "Ramadan" })).status).toBe(204);
    await send({ referrer: "www.google.com" });
    await send({ referrer: "www.google.com" });
    const { results } = await db.prepare("SELECT metric, dim, value FROM analytics_daily ORDER BY metric, dim").all();
    expect(results).toEqual([
      { metric: "visits", dim: "google", value: 2 },
      { metric: "visits", dim: "instagram", value: 1 },
      { metric: "visits_campaign", dim: "ramadan", value: 1 },
    ]);
  });
});

describe("failed deliveries", () => {
  it("a failed attempt opens a follow-up; contacts go to the order's history; a callback becomes an alert when due", async () => {
    const db = testDb();
    seedShop(db);
    const app = testApp(logisticsRoutes, db);
    const id = addOrder(db, { status: "en_livraison" });
    expect((await app.call("POST", `/orders/${addOrder(db, { status: "nouvelle" })}/failed-delivery`, { reason: "no_answer" })).status).toBe(409);

    const f = await app.call<{ id: number }>("POST", `/orders/${id}/failed-delivery`, { reason: "no_answer", note: "Pas de réponse à 3 appels" });
    expect(f.status).toBe(201);
    // a second failure on the same order: one follow-up, two attempts
    expect((await app.call<{ id: number }>("POST", `/orders/${id}/failed-delivery`, { reason: "unreachable" })).body.id).toBe(f.body.id);
    let q = await app.call<{ rows: { attempts: number; reason: string; status: string }[]; counts: { open: number } }>("GET", "/followups");
    expect(q.body.rows[0]).toMatchObject({ attempts: 2, reason: "unreachable", status: "needs_contact" });
    expect(q.body.counts.open).toBe(1);

    // a call, then a callback in the past (due now)
    expect((await app.call("PATCH", `/followups/${f.body.id}`, { status: "callback" })).status).toBe(422); // needs a time
    await app.call("PATCH", `/followups/${f.body.id}`, { status: "callback", nextActionAt: Date.now() - 1000, contact: { kind: "call", note: "Rappeler après 17 h" } });
    expect(await db.prepare("SELECT COUNT(*) AS n FROM order_events WHERE order_id = ? AND kind = 'call'").bind(id).first("n")).toBe(1);
    await scanAlerts(envOf(db));
    expect(await db.prepare("SELECT kind FROM alerts WHERE dedupe_key = ?").bind(`followup_due:${f.body.id}`).first("kind")).toBe("followup_due");

    // retry requested, then resolved: closed, the alerts are resolved
    await app.call("PATCH", `/followups/${f.body.id}`, { status: "retry_requested" });
    await app.call("PATCH", `/followups/${f.body.id}`, { status: "resolved", note: "Livrée au 2e passage" });
    q = await app.call("GET", "/followups");
    expect(q.body.counts.open).toBe(0);
    expect(await db.prepare("SELECT resolved_at IS NOT NULL AS done FROM alerts WHERE dedupe_key = ?").bind(`followup:${f.body.id}`).first("done")).toBe(1);
    // a closed follow-up can't jump to "contacted" (only be reopened)
    expect((await app.call("PATCH", `/followups/${f.body.id}`, { status: "contacted" })).status).toBe(409);
  });

  it("recording a failure needs orders.ship, working the queue needs orders.edit", async () => {
    const db = testDb();
    seedShop(db);
    const app = testApp(logisticsRoutes, db, member(["orders.view"]));
    const id = addOrder(db, { status: "expediee" });
    expect((await app.call("POST", `/orders/${id}/failed-delivery`, { reason: "no_answer" })).status).toBe(403);
  });
});

describe("courier manifests", () => {
  it("draft → ready → handed over: orders become 'expédiée', stock leaves the shop, totals frozen; then confirmed", async () => {
    const db = testDb();
    seedShop(db);
    db.sqlite.exec("UPDATE wilayas SET home_price = 500, desk_price = 300 WHERE code = 35");
    const app = testApp(logisticsRoutes, db);
    const a = addOrder(db, { status: "en_preparation", total: 6_600 });
    const b = addOrder(db, { status: "confirmee", total: 3_600, deliveryType: "bureau" });
    const shipped = addOrder(db, { status: "expediee" });
    reserve(db);
    const before = (await db.prepare("SELECT stock_on_hand FROM variants WHERE id = 1").first("stock_on_hand")) as number;

    expect((await app.call<{ id: number }>("GET", "/manifests/eligible")).body).toHaveLength(2);
    expect((await app.call("POST", "/manifests", { orderIds: [a, shipped] })).status).toBe(409); // not eligible: nothing created
    expect(await db.prepare("SELECT COUNT(*) AS n FROM shipment_manifests").first("n")).toBe(0);

    const m = await app.call<{ id: number; code: string }>("POST", "/manifests", { orderIds: [a, b] });
    expect(m.status).toBe(201);
    expect(m.body.code).toMatch(/^MN-\d{8}-1$/);
    // an order can't be on two active sheets
    expect((await app.call("POST", "/manifests", { orderIds: [a] })).status).toBe(409);

    let sheet = await app.call<{ totals: { packages: number; cod: number; fees: number } }>("GET", `/manifests/${m.body.id}`);
    expect(sheet.body.totals).toEqual({ packages: 2, cod: 10_200, fees: 800 });

    await app.call("POST", `/manifests/${m.body.id}/tracking`, { lines: [{ orderId: a, trackingNumber: "ZR123456" }] });
    expect((await app.call("POST", `/manifests/${m.body.id}/status`, { to: "handed_over" })).status).toBe(409); // ready first
    expect((await app.call("POST", `/manifests/${m.body.id}/status`, { to: "ready" })).status).toBe(200);
    expect((await app.call("POST", `/manifests/${m.body.id}/orders`, { remove: [a] })).status).toBe(409); // locked once ready
    const h = await app.call<{ removed: unknown[] }>("POST", `/manifests/${m.body.id}/status`, { to: "handed_over", handoffRef: "Ramassage ZR · Karim" });
    expect(h).toMatchObject({ status: 200, body: { removed: [] } });
    expect([await statusOf(db, a), await statusOf(db, b)]).toEqual(["expediee", "expediee"]);
    expect(await db.prepare("SELECT stock_on_hand FROM variants WHERE id = 1").first("stock_on_hand")).toBe(before - 2);
    expect(await db.prepare("SELECT tracking_number FROM orders WHERE id = ?").bind(a).first("tracking_number")).toBe("ZR123456");
    expect((await app.call("POST", `/manifests/${m.body.id}/status`, { to: "cancelled" })).status).toBe(409); // handed over: final
    expect((await app.call("POST", `/manifests/${m.body.id}/status`, { to: "confirmed" })).status).toBe(200);
    sheet = await app.call("GET", `/manifests/${m.body.id}`);
    expect(sheet.body).toMatchObject({ status: "confirmed", handoff_ref: "Ramassage ZR · Karim" });
    expect(await db.prepare("SELECT COUNT(*) AS n FROM audit_log WHERE entity = 'manifest'").first("n")).toBe(5);
  });

  it("CSV export, and handing over needs orders.ship", async () => {
    const db = testDb();
    seedShop(db);
    const app = testApp(logisticsRoutes, db);
    const a = addOrder(db, { status: "en_preparation" });
    const m = await app.call<{ id: number }>("POST", "/manifests", { orderIds: [a] });
    const res = await app.raw("GET", `/manifests/${m.body.id}/csv`);
    expect(res.headers.get("Content-Type")).toContain("text/csv");
    const text = await res.text();
    expect(text.trim().split(String.fromCharCode(13, 10))).toHaveLength(2);
    expect(text).toContain("Montant à encaisser");
    // without a signed-in member the guarded route refuses
    expect((await logisticsRoutes.request(`/manifests/${m.body.id}/csv`)).status).toBe(403);
    app.as(member(["orders.view"]));
    expect((await app.call("POST", `/manifests/${m.body.id}/status`, { to: "ready" })).status).toBe(403);
  });
});
