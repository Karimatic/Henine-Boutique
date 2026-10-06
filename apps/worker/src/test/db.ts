/// <reference types="node" />
/**
 * Tests only: a real SQLite database (Node's built-in node:sqlite, in memory) with every
 * migration and the base + geography seeds applied, behind the subset of the D1 API the Worker
 * uses. Route tests run their real SQL against it; nothing touches the local or remote D1.
 */
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { DatabaseSync, type StatementSync } from "node:sqlite";
import { Hono } from "hono";
import type { AdminMember, AppEnv, Env } from "../env";

const DB_DIR = join(__dirname, "../../../../packages/db");

type Value = string | number | bigint | null | Uint8Array;
const toSql = (v: unknown): Value => (v === undefined ? null : typeof v === "boolean" ? (v ? 1 : 0) : (v as Value));

function exec(db: DatabaseSync, st: StatementSync, params: Value[]) {
  // reading statements (SELECT, … RETURNING) give rows; the others their effect
  if (st.columns().length) return { results: st.all(...params) as Record<string, unknown>[], meta: { changes: 0, last_row_id: 0 } };
  const r = st.run(...params);
  return { results: [] as Record<string, unknown>[], meta: { changes: Number(r.changes), last_row_id: Number(r.lastInsertRowid) } };
}

class Stmt {
  constructor(
    readonly db: DatabaseSync,
    readonly sql: string,
    readonly params: Value[] = [],
  ) {}
  bind(...values: unknown[]) {
    return new Stmt(this.db, this.sql, values.map(toSql));
  }
  private go() {
    return exec(this.db, this.db.prepare(this.sql), this.params);
  }
  async all<T = Record<string, unknown>>() {
    const r = this.go();
    return { results: r.results as T[], success: true, meta: r.meta };
  }
  async first<T = Record<string, unknown>>(col?: string) {
    const row = this.go().results[0] as Record<string, unknown> | undefined;
    if (!row) return null;
    return (col ? row[col] : row) as T;
  }
  async run() {
    const r = this.go();
    return { results: r.results, success: true, meta: r.meta };
  }
  async raw() {
    return this.go().results.map((r) => Object.values(r));
  }
}

export interface TestDb extends Pick<D1Database, "prepare" | "batch" | "exec"> {
  sqlite: DatabaseSync;
}

/** A fresh database: migrations + base roles/settings + wilayas/communes. */
export function testDb(): TestDb {
  const db = new DatabaseSync(":memory:");
  db.exec("PRAGMA foreign_keys = ON;");
  const migrations = readdirSync(join(DB_DIR, "migrations")).filter((f) => f.endsWith(".sql")).sort();
  for (const f of migrations as string[]) for (const part of readFileSync(join(DB_DIR, "migrations", f), "utf8").split("--> statement-breakpoint")) if (part.trim()) db.exec(part);
  for (const f of ["base.sql", "geo.sql"]) db.exec(readFileSync(join(DB_DIR, "seed", f), "utf8"));
  const api = {
    sqlite: db,
    prepare: (sql: string) => new Stmt(db, sql),
    // D1 runs a batch as one transaction: all or nothing
    batch: async (stmts: Stmt[]) => {
      db.exec("BEGIN");
      try {
        const out = stmts.map((s) => ({ ...exec(db, db.prepare(s.sql), s.params), success: true }));
        db.exec("COMMIT");
        return out;
      } catch (err) {
        db.exec("ROLLBACK");
        throw err;
      }
    },
    exec: async (sql: string) => {
      db.exec(sql);
      return { count: 1, duration: 0 };
    },
  };
  return api as unknown as TestDb;
}

export const OWNER: AdminMember = { id: 1, email: "owner@test", name: "Ilyas", role: "owner", roleName: "Propriétaire", permissions: ["*"], sessionId: 1 };
export const member = (permissions: string[], id = 2): AdminMember => ({ id, email: `m${id}@test`, name: `Membre ${id}`, role: "custom", roleName: "Test", permissions, sessionId: id });

/**
 * A route module behind a signed-in member (the session check itself is tested elsewhere).
 * `call` returns the status and the JSON body.
 */
export function testApp(routes: Hono<AppEnv>, db: TestDb, as: AdminMember = OWNER) {
  const app = new Hono<AppEnv>();
  let who = as;
  app.use("*", async (c, next) => {
    c.set("member", who);
    await next();
  });
  app.onError((err, c) => {
    const e = err as { status?: number; code?: string; details?: unknown };
    if (typeof e.status === "number" && e.code) return c.json({ error: e.code, ...(e.details ? { details: e.details } : {}) }, e.status as 400);
    throw err;
  });
  app.route("/", routes);
  const env = { DB: db, ENVIRONMENT: "development", PUBLIC_ORIGIN: "http://localhost:8787", MEDIA_ORIGIN: "" } as unknown as Env;
  const ctx = { waitUntil: () => undefined, passThroughOnException: () => undefined, props: {} } as unknown as ExecutionContext;
  return {
    as(m: AdminMember) {
      who = m;
      return this;
    },
    /** the raw response (CSV, files) */
    raw(method: string, path: string) {
      return app.request(path, { method }, env, ctx);
    },
    async call<T = Record<string, unknown>>(method: string, path: string, body?: unknown) {
      const res = await app.request(path, { method, headers: { "Content-Type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) }, env, ctx);
      const text = await res.text();
      return { status: res.status, body: (text ? JSON.parse(text) : null) as T };
    },
  };
}

/** Test fixtures: a product with variants, a customer and orders in any status. */
export function seedShop(db: TestDb) {
  const s = db.sqlite;
  s.exec(`INSERT INTO categories (id, slug, name_fr, name_ar) VALUES (900, 'test-pyjamas', 'Pyjamas test', 'بيجامات');`);
  s.exec(`INSERT INTO products (id, slug, name_fr, name_ar, status, category_id, price, cost_price) VALUES (1, 'pyjama', 'Pyjama', 'بيجامة', 'published', 900, 3000, 1200);`);
  s.exec(`INSERT INTO variants (id, product_id, sku, option_value_ids, stock_on_hand, stock_reserved) VALUES (1, 1, 'PJ-S', '[]', 20, 0), (2, 1, 'PJ-M', '[]', 10, 2), (3, 1, 'PJ-L', '[]', 5, 0);`);
  s.exec(`INSERT INTO customers (id, phone, name, wilaya_code) VALUES (1, '0554650718', 'Amina', 35), (2, '0661223344', 'Lina', 16);`);
}

let orderSeq = 0;
/** An order (status, total…); returns its id. Times are epoch ms. */
export function addOrder(
  db: TestDb,
  o: { status?: string; total?: number; shipping?: number; customerId?: number; phone?: string; createdAt?: number; channel?: string; wilaya?: number; deliveryType?: string; source?: string; items?: { variantId: number; qty: number; price?: number }[] },
): number {
  orderSeq++;
  const items = o.items ?? [{ variantId: 1, qty: 1, price: 3000 }];
  const subtotal = items.reduce((s, i) => s + (i.price ?? 3000) * i.qty, 0);
  const shipping = o.shipping ?? 600;
  const total = o.total ?? subtotal + shipping;
  const r = db.sqlite
    .prepare(
      `INSERT INTO orders (public_code, track_token_hash, idempotency_key, status, channel, customer_id, name, phone, wilaya_code, delivery_type, address, subtotal, shipping_price, total, source, created_at, updated_at)
       VALUES (?, 'x', ?, ?, ?, ?, 'Amina', ?, ?, ?, 'Cité 200 logements', ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      `HN-T${orderSeq}`, `key-${orderSeq}-${Math.random()}`, o.status ?? "livree", o.channel ?? "web", o.customerId ?? 1, o.phone ?? "0554650718", o.wilaya ?? 35,
      o.deliveryType ?? "domicile", subtotal, shipping, total, o.source ?? null, o.createdAt ?? Date.now(), o.createdAt ?? Date.now(),
    );
  const id = Number(r.lastInsertRowid);
  for (const i of items)
    db.sqlite
      .prepare("INSERT INTO order_items (order_id, variant_id, product_id, name_fr, name_ar, sku, unit_price, qty) VALUES (?, ?, 1, 'Pyjama', 'بيجامة', 'PJ', ?, ?)")
      .run(id, i.variantId, i.price ?? 3000, i.qty);
  return id;
}
