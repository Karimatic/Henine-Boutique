import { describe, expect, it } from "vitest";
import { addOrder, seedShop, testDb } from "./db";

describe("test database", () => {
  it("has every migration, the seeds and the new tables", async () => {
    const db = testDb();
    seedShop(db);
    const id = addOrder(db, { status: "livree" });
    expect(await db.prepare("SELECT COUNT(*) AS n FROM wilayas").first("n")).toBeGreaterThanOrEqual(58);
    expect(await db.prepare("SELECT status FROM orders WHERE id = ?").bind(id).first("status")).toBe("livree");
    const r = await db.batch([db.prepare("INSERT INTO expenses (spent_on, amount, category, description, created_by) VALUES ('2026-10-01', 500, 'rent', 'Loyer', 'member:1')"), db.prepare("SELECT COUNT(*) AS n FROM expenses")]);
    expect(r[1]!.results[0]).toEqual({ n: 1 });
    // the manager role got the new permissions
    expect(String(await db.prepare("SELECT permissions FROM roles WHERE key = 'manager'").first("permissions"))).toContain("finance.view");
  });
});
