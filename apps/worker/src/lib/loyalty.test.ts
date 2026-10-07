import { describe, expect, it } from "vitest";
import type { Env } from "../env";
import { seedShop, testDb } from "../test/db";
import { expirePoints, pointsToExpire } from "./loyalty";

const DAY = 86_400_000;
const NOW = Date.UTC(2026, 9, 7);

function shop(expiryDays: number) {
  const db = testDb();
  seedShop(db);
  db.sqlite.exec(
    `INSERT OR REPLACE INTO settings (key, value, updated_at) VALUES ('loyalty', '${JSON.stringify({ enabled: true, points_per_100da: 1, redeem_value_da: 5, min_redeem: 100, expiry_days: expiryDays })}', 0)`,
  );
  const ledger = (customer: number, delta: number, daysAgo: number, reason = delta > 0 ? "order" : "redeem") =>
    db.sqlite.exec(`INSERT INTO loyalty_ledger (customer_id, delta, reason, actor, created_at) VALUES (${customer}, ${delta}, '${reason}', 'test', ${NOW - daysAgo * DAY})`);
  const balance = (customer: number, points: number) => db.sqlite.exec(`UPDATE customers SET points_balance = ${points} WHERE id = ${customer}`);
  const get = (customer: number) =>
    (db.sqlite.prepare(`SELECT points_balance AS b FROM customers WHERE id = ${customer}`).get() as { b: number }).b;
  return { env: { DB: db } as unknown as Env, db, ledger, balance, get };
}

describe("loyalty points expiry", () => {
  it("expires old points not yet spent, oldest first", () => {
    expect(pointsToExpire(100, 0, 150)).toBe(100);
    expect(pointsToExpire(100, 30, 150)).toBe(70); // 30 spent came from the old points
    expect(pointsToExpire(100, 120, 150)).toBe(0); // all old points already spent
    expect(pointsToExpire(100, 0, 40)).toBe(40); // never more than the balance
  });

  it("removes them from the balance and writes them in the history", async () => {
    const s = shop(365);
    s.ledger(1, 100, 400); // earned more than a year ago
    s.ledger(1, -30, 200); // 30 of them spent
    s.ledger(1, 50, 10); // recent points stay
    s.balance(1, 120);
    expect(await expirePoints(s.env, NOW)).toBe(70);
    expect(s.get(1)).toBe(50);
    const row = s.db.sqlite.prepare("SELECT delta, reason FROM loyalty_ledger WHERE customer_id = 1 ORDER BY id DESC LIMIT 1").get() as { delta: number; reason: string };
    expect(row).toEqual({ delta: -70, reason: "expiry" });
    // the next evening: nothing more to expire
    expect(await expirePoints(s.env, NOW + DAY)).toBe(0);
    expect(s.get(1)).toBe(50);
  });

  it("does nothing when points never expire", async () => {
    const s = shop(0);
    s.ledger(1, 100, 4000);
    s.balance(1, 100);
    expect(await expirePoints(s.env, NOW)).toBe(0);
    expect(s.get(1)).toBe(100);
  });
});
