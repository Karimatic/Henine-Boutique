import { describe, expect, it } from "vitest";
import { Hono } from "hono";
import type { AppEnv } from "../../env";
import { ownerOnlyDeletes } from "../../middleware/access";
import { member, OWNER, testApp, testDb } from "../../test/db";

// the rule mounted on every admin route (routes/admin/index.ts)
const routes = new Hono<AppEnv>();
routes.use("*", ownerOnlyDeletes);
routes.delete("/coupons/:id", (c) => c.json({ ok: true }));
routes.post("/orders/bulk-delete", (c) => c.json({ ok: true }));
routes.delete("/account/sessions/:id", (c) => c.json({ ok: true }));

describe("deleting is for the owner only", () => {
  it("lets the owner delete", async () => {
    const app = testApp(routes, testDb(), OWNER);
    expect((await app.call("DELETE", "/coupons/1")).status).toBe(200);
    expect((await app.call("POST", "/orders/bulk-delete", { ids: [1] })).status).toBe(200);
  });
  it("refuses everyone else, but lets them sign out their own devices", async () => {
    const app = testApp(routes, testDb(), member(["*"]));
    expect((await app.call("DELETE", "/coupons/1")).status).toBe(403);
    expect((await app.call("POST", "/orders/bulk-delete", { ids: [1] })).status).toBe(403);
    expect((await app.call("DELETE", "/account/sessions/3")).status).toBe(200);
  });
});
