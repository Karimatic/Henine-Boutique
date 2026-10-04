import { Hono } from "hono";
import { describe, expect, it } from "vitest";
import type { AppEnv } from "../env";
import { apiHeaders, httpsOnly, sameOriginWrites } from "./security";

const env = { PUBLIC_ORIGIN: "https://henine.example" } as AppEnv["Bindings"];

function makeApp() {
  const app = new Hono<AppEnv>();
  app.use("*", apiHeaders, sameOriginWrites);
  app.get("/x", (c) => c.json({ ok: true }));
  app.post("/x", (c) => c.json({ ok: true }));
  return app;
}

const post = (headers: Record<string, string>) =>
  makeApp().request("https://henine.example/x", { method: "POST", headers, body: "{}" }, env);

describe("sameOriginWrites", () => {
  it("allows same-origin JSON writes", async () => {
    const res = await post({ Origin: "https://henine.example", "Content-Type": "application/json" });
    expect(res.status).toBe(200);
  });

  it("rejects cross-origin writes", async () => {
    const res = await post({ Origin: "https://evil.example", "Content-Type": "application/json" });
    expect(res.status).toBe(403);
  });

  it("rejects writes without Origin", async () => {
    const res = await post({ "Content-Type": "application/json" });
    expect(res.status).toBe(403);
  });

  it("rejects form posts (classic CSRF vector)", async () => {
    const res = await post({ Origin: "https://henine.example", "Content-Type": "application/x-www-form-urlencoded" });
    expect(res.status).toBe(415);
  });

  it("lets reads through", async () => {
    const res = await makeApp().request("https://henine.example/x", {}, env);
    expect(res.status).toBe(200);
  });
});

describe("apiHeaders", () => {
  it("sets security headers and no-store by default", async () => {
    const res = await makeApp().request("https://henine.example/x", {}, env);
    expect(res.headers.get("Cache-Control")).toBe("no-store");
    expect(res.headers.get("X-Content-Type-Options")).toBe("nosniff");
    expect(res.headers.get("Content-Security-Policy")).toContain("frame-ancestors 'none'");
    expect(res.headers.get("Strict-Transport-Security")).toContain("max-age=");
  });
});

describe("httpsOnly", () => {
  const app = new Hono<AppEnv>();
  app.use("*", httpsOnly);
  app.get("/x", (c) => c.text("ok"));

  it("sends plain http to https in production", async () => {
    const res = await app.request("http://henine.example/x?a=1", {}, env);
    expect(res.status).toBe(301);
    expect(res.headers.get("Location")).toBe("https://henine.example/x?a=1");
  });

  it("leaves https alone, and http on the local dev server", async () => {
    expect((await app.request("https://henine.example/x", {}, env)).status).toBe(200);
    expect((await app.request("http://127.0.0.1:8787/x", {}, { ...env, ENVIRONMENT: "development" })).status).toBe(200);
  });
});
