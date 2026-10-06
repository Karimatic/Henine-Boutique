import { describe, expect, it } from "vitest";
import { member, OWNER, seedShop, testApp, testDb } from "../../test/db";
import { stockCountRoutes } from "./stock-counts";

const stock = async (db: ReturnType<typeof testDb>, id: number) => (await db.prepare("SELECT stock_on_hand AS n FROM variants WHERE id = ?").bind(id).first("n")) as number;

function setup() {
  const db = testDb();
  seedShop(db); // variants: 1 (20 on hand), 2 (10 on hand, 2 reserved), 3 (5 on hand)
  return { db, app: testApp(stockCountRoutes, db) };
}

describe("stock count", () => {
  it("brief example: system 20, counted 17 → −3, applied only after approval, with history and audit", async () => {
    const { db, app } = setup();
    const created = await app.call<{ id: number; lines: number }>("POST", "/stock-counts", { scope: "product", productId: 1 });
    expect(created).toMatchObject({ status: 201, body: { lines: 3 } });
    const id = created.body.id;

    await app.call("PUT", `/stock-counts/${id}/lines`, { lines: [{ variantId: 1, countedQty: 17, reason: "missing" }, { variantId: 3, countedQty: 5 }] });
    const view = await app.call<{ summary: Record<string, number>; lines: { variant_id: number; difference: number | null }[] }>("GET", `/stock-counts/${id}`);
    expect(view.body.summary).toEqual({ lines: 3, counted: 2, discrepancies: 1, missingPieces: 3, foundPieces: 0 });
    expect(view.body.lines.find((l) => l.variant_id === 1)?.difference).toBe(-3);
    expect(await stock(db, 1)).toBe(20); // nothing changes before approval

    expect((await app.call("POST", `/stock-counts/${id}/approve`, {})).status).toBe(409); // not submitted yet
    expect((await app.call("POST", `/stock-counts/${id}/submit`)).status).toBe(200);
    // while waiting for approval, 2 pieces are sold: the 3 missing ones are taken from today's stock
    db.sqlite.exec("UPDATE variants SET stock_on_hand = 18 WHERE id = 1");
    expect(await app.call("POST", `/stock-counts/${id}/approve`, { note: "ok" })).toMatchObject({ status: 200, body: { corrected: 1 } });
    expect(await stock(db, 1)).toBe(15);
    expect(await db.prepare("SELECT delta, reason, note FROM stock_movements WHERE variant_id = 1").first()).toMatchObject({ delta: -3, reason: "inventaire", note: `Inventaire #${id} · Manquant` });
    expect(await db.prepare("SELECT action FROM audit_log WHERE entity = 'stock_count' AND entity_id = ? ORDER BY id DESC").bind(String(id)).first("action")).toBe("approve");
    // an approved count is final
    expect((await app.call("PUT", `/stock-counts/${id}/lines`, { lines: [{ variantId: 1, countedQty: 1 }] })).status).toBe(409);
    expect((await app.call("POST", `/stock-counts/${id}/reopen`)).status).toBe(409);
  });

  it("every difference needs a reason before submitting", async () => {
    const { app } = setup();
    const { body } = await app.call<{ id: number }>("POST", "/stock-counts", { scope: "variants", variantIds: [1, 3] });
    await app.call("PUT", `/stock-counts/${body.id}/lines`, { lines: [{ variantId: 3, countedQty: 7 }] });
    expect(await app.call("POST", `/stock-counts/${body.id}/submit`)).toMatchObject({ status: 422, body: { error: "reason_required" } });
    await app.call("PUT", `/stock-counts/${body.id}/lines`, { lines: [{ variantId: 3, countedQty: 7, reason: "found" }] });
    expect((await app.call("POST", `/stock-counts/${body.id}/submit`)).status).toBe(200);
  });

  it("never leaves pending orders without their pieces", async () => {
    const { db, app } = setup();
    const { body } = await app.call<{ id: number }>("POST", "/stock-counts", { scope: "variants", variantIds: [2] });
    await app.call("PUT", `/stock-counts/${body.id}/lines`, { lines: [{ variantId: 2, countedQty: 1, reason: "theft" }] }); // 2 are reserved
    await app.call("POST", `/stock-counts/${body.id}/submit`);
    expect(await app.call("POST", `/stock-counts/${body.id}/approve`, {})).toMatchObject({ status: 409, body: { error: "stock_below_reserved" } });
    expect(await stock(db, 2)).toBe(10);
  });

  it("rejected or cancelled counts change nothing; a rejected count can't be approved", async () => {
    const { db, app } = setup();
    const { body } = await app.call<{ id: number }>("POST", "/stock-counts", { scope: "all" });
    await app.call("PUT", `/stock-counts/${body.id}/lines`, { lines: [{ variantId: 1, countedQty: 2, reason: "data_fix" }] });
    await app.call("POST", `/stock-counts/${body.id}/submit`);
    expect((await app.call("POST", `/stock-counts/${body.id}/reject`, { note: "recompter" })).status).toBe(200);
    expect((await app.call("POST", `/stock-counts/${body.id}/approve`, {})).status).toBe(409);
    expect(await stock(db, 1)).toBe(20);
    const other = await app.call<{ id: number }>("POST", "/stock-counts", { scope: "all" });
    expect((await app.call("POST", `/stock-counts/${other.body.id}/cancel`)).status).toBe(200);
  });

  it("counting needs stock.edit, approving needs stock.approve (checked by the API)", async () => {
    const { app } = setup();
    const counter = member(["stock.view", "stock.edit"]);
    app.as(counter);
    const { body } = await app.call<{ id: number }>("POST", "/stock-counts", { scope: "variants", variantIds: [3] });
    await app.call("PUT", `/stock-counts/${body.id}/lines`, { lines: [{ variantId: 3, countedQty: 4, reason: "damaged" }] });
    await app.call("POST", `/stock-counts/${body.id}/submit`);
    expect((await app.call("POST", `/stock-counts/${body.id}/approve`, {})).status).toBe(403);
    expect((await app.as(member(["stock.view"])).call("POST", "/stock-counts", { scope: "all" })).status).toBe(403);
    expect((await app.as(OWNER).call("POST", `/stock-counts/${body.id}/approve`, {})).status).toBe(200);
  });
});
