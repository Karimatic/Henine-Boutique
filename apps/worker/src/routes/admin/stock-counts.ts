/**
 * Admin → Stock → Inventaire: physical stock counts, on top of the normal stock. The team
 * counts (stock.edit), an authorised person approves (stock.approve); only then is the stock
 * corrected, through the usual stock history (reason "inventaire") and the audit log.
 */
import { Hono, type Context } from "hono";
import { z } from "zod";
import { canCountTransition, cleanText, COUNT_REASON_LABEL, COUNT_REASONS, countSummary, stockAfterCount, type CountReason, type CountStatus } from "@henine/shared";
import type { AppEnv } from "../../env";
import { auditStmt } from "../../lib/audit";
import { body, HttpError, intParam } from "../../lib/http";
import { bumpCatalogStmt } from "../../lib/settings";
import { notifyRestocked } from "../../lib/telegram";
import { sendRestockPushes } from "../../lib/webpush";
import { actorOf, requirePermission } from "../../middleware/access";

export const stockCountRoutes = new Hono<AppEnv>();

const MAX_LINES = 3000;

interface LineRow {
  variant_id: number;
  system_qty: number;
  counted_qty: number | null;
  reason: CountReason | null;
  note: string | null;
  counted_by: string | null;
  counted_at: number | null;
  applied_delta: number | null;
  sku: string;
  product_id: number;
  name_fr: string;
  name_ar: string;
  stock_on_hand: number;
  stock_reserved: number;
}

async function loadCount(c: { env: AppEnv["Bindings"] }, id: number) {
  const [count, lines] = await c.env.DB.batch([
    c.env.DB.prepare("SELECT * FROM stock_counts WHERE id = ?").bind(id),
    c.env.DB.prepare(
      `SELECT l.variant_id, l.system_qty, l.counted_qty, l.reason, l.note, l.counted_by, l.counted_at, l.applied_delta,
              v.sku, v.product_id, v.stock_on_hand, v.stock_reserved, p.name_fr, p.name_ar
         FROM stock_count_lines l JOIN variants v ON v.id = l.variant_id JOIN products p ON p.id = v.product_id
        WHERE l.count_id = ? ORDER BY p.name_fr, v.sku`,
    ).bind(id),
  ]);
  const row = count!.results[0] as ({ id: number; status: CountStatus } & Record<string, unknown>) | undefined;
  if (!row) throw new HttpError(404, "not_found");
  return { count: row, lines: lines!.results as unknown as LineRow[] };
}

stockCountRoutes.get("/stock-counts", requirePermission("stock.view"), async (c) => {
  const { results } = await c.env.DB.prepare(
    `SELECT s.id, s.title, s.scope, s.status, s.created_by, s.created_at, s.submitted_at, s.decided_by, s.decided_at,
            COUNT(l.variant_id) AS lines,
            SUM(CASE WHEN l.counted_qty IS NOT NULL THEN 1 ELSE 0 END) AS counted,
            SUM(CASE WHEN l.counted_qty IS NOT NULL AND l.counted_qty != l.system_qty THEN 1 ELSE 0 END) AS discrepancies
       FROM stock_counts s LEFT JOIN stock_count_lines l ON l.count_id = s.id
      GROUP BY s.id ORDER BY s.id DESC LIMIT 100`,
  ).all();
  return c.json(results);
});

/** Starts a count: the system's quantities are written down now, to compare with the shelves. */
stockCountRoutes.post("/stock-counts", requirePermission("stock.edit"), async (c) => {
  const input = await body(
    c,
    z.discriminatedUnion("scope", [
      z.object({ scope: z.literal("all"), title: cleanText(120).optional(), note: cleanText(500).optional() }),
      z.object({ scope: z.literal("category"), categoryId: z.number().int().positive(), title: cleanText(120).optional(), note: cleanText(500).optional() }),
      z.object({ scope: z.literal("product"), productId: z.number().int().positive(), title: cleanText(120).optional(), note: cleanText(500).optional() }),
      z.object({ scope: z.literal("variants"), variantIds: z.array(z.number().int().positive()).min(1).max(MAX_LINES), title: cleanText(120).optional(), note: cleanText(500).optional() }),
    ]),
  );
  // active sizes of products that aren't archived
  let where = "v.is_active = 1 AND p.status != 'archived'";
  const binds: unknown[] = [];
  let ref: string | null = null;
  let label: string;
  if (input.scope === "category") {
    where += " AND (p.category_id = ? OR p.category_id IN (SELECT id FROM categories WHERE parent_id = ?))";
    binds.push(input.categoryId, input.categoryId);
    ref = String(input.categoryId);
    const cat = await c.env.DB.prepare("SELECT name_fr FROM categories WHERE id = ?").bind(input.categoryId).first<{ name_fr: string }>();
    if (!cat) throw new HttpError(404, "not_found");
    label = `Inventaire · ${cat.name_fr}`;
  } else if (input.scope === "product") {
    where += " AND p.id = ?";
    binds.push(input.productId);
    ref = String(input.productId);
    const prod = await c.env.DB.prepare("SELECT name_fr FROM products WHERE id = ?").bind(input.productId).first<{ name_fr: string }>();
    if (!prod) throw new HttpError(404, "not_found");
    label = `Inventaire · ${prod.name_fr}`;
  } else if (input.scope === "variants") {
    const ids = [...new Set(input.variantIds)];
    where += ` AND v.id IN (${ids.map(() => "?").join(",")})`;
    binds.push(...ids);
    ref = ids.join(",");
    label = `Inventaire · ${ids.length} article(s)`;
  } else label = "Inventaire complet";
  const { results: variants } = await c.env.DB.prepare(`SELECT v.id, v.stock_on_hand FROM variants v JOIN products p ON p.id = v.product_id WHERE ${where} LIMIT ${MAX_LINES + 1}`)
    .bind(...binds)
    .all<{ id: number; stock_on_hand: number }>();
  if (!variants.length) throw new HttpError(422, "nothing_to_count");
  if (variants.length > MAX_LINES) throw new HttpError(422, "too_many_lines", { max: MAX_LINES });
  const actor = actorOf(c.get("member"));
  const now = Date.now();
  const title = input.title || label;
  const NEW_ID = "(SELECT MAX(id) FROM stock_counts)";
  // the count and its lines together (one transaction)
  const res = await c.env.DB.batch([
    c.env.DB.prepare(
      "INSERT INTO stock_counts (id, scope, scope_ref, title, status, note, created_by, created_at) VALUES ((SELECT COALESCE(MAX(id), 0) + 1 FROM stock_counts), ?, ?, ?, 'counting', ?, ?, ?)",
    ).bind(input.scope, ref, title, input.note ?? null, actor, now),
    ...variants.map((v) => c.env.DB.prepare(`INSERT INTO stock_count_lines (count_id, variant_id, system_qty) VALUES (${NEW_ID}, ?, ?)`).bind(v.id, v.stock_on_hand)),
    c.env.DB.prepare(`INSERT INTO audit_log (actor, action, entity, entity_id, diff, created_at) VALUES (?, 'create', 'stock_count', CAST(${NEW_ID} AS TEXT), ?, ?)`).bind(
      actor, JSON.stringify({ scope: input.scope, ref, lines: variants.length }), now,
    ),
    c.env.DB.prepare(`SELECT ${NEW_ID} AS id`),
  ]);
  return c.json({ id: (res.at(-1)!.results[0] as { id: number }).id, lines: variants.length }, 201);
});

stockCountRoutes.get("/stock-counts/:id", requirePermission("stock.view"), async (c) => {
  const { count, lines } = await loadCount(c, intParam(c, "id"));
  return c.json({
    ...count,
    summary: countSummary(lines.map((l) => ({ systemQty: l.system_qty, countedQty: l.counted_qty }))),
    lines: lines.map((l) => ({ ...l, difference: l.counted_qty == null ? null : l.counted_qty - l.system_qty })),
  });
});

/** Quantities found on the shelves (several lines at once; null = not counted). */
stockCountRoutes.put("/stock-counts/:id/lines", requirePermission("stock.edit"), async (c) => {
  const id = intParam(c, "id");
  const input = await body(
    c,
    z.object({
      lines: z
        .array(
          z.object({
            variantId: z.number().int().positive(),
            countedQty: z.number().int().min(0).max(100_000).nullable(),
            reason: z.enum(COUNT_REASONS).nullable().optional(),
            note: cleanText(300).optional(),
          }),
        )
        .min(1)
        .max(MAX_LINES),
    }),
  );
  const s = await c.env.DB.prepare("SELECT status FROM stock_counts WHERE id = ?").bind(id).first<{ status: CountStatus }>();
  if (!s) throw new HttpError(404, "not_found");
  if (s.status !== "counting") throw new HttpError(409, "count_locked");
  const actor = actorOf(c.get("member"));
  const now = Date.now();
  const res = await c.env.DB.batch(
    input.lines.map((l) =>
      c.env.DB.prepare(
        "UPDATE stock_count_lines SET counted_qty = ?, reason = ?, note = ?, counted_by = ?, counted_at = ? WHERE count_id = ? AND variant_id = ?",
      ).bind(l.countedQty, l.reason ?? null, l.note ?? null, l.countedQty == null ? null : actor, l.countedQty == null ? null : now, id, l.variantId),
    ),
  );
  const unknown = input.lines.filter((_, i) => !res[i]!.meta.changes).map((l) => l.variantId);
  if (unknown.length) throw new HttpError(422, "not_in_count", { variantIds: unknown });
  return c.json({ saved: input.lines.length });
});

/** Counting finished: sent for approval. Every difference needs its reason. */
stockCountRoutes.post("/stock-counts/:id/submit", requirePermission("stock.edit"), async (c) => {
  const id = intParam(c, "id");
  const { count, lines } = await loadCount(c, id);
  if (!canCountTransition(count.status, "submitted")) throw new HttpError(409, "invalid_transition");
  const counted = lines.filter((l) => l.counted_qty != null);
  if (!counted.length) throw new HttpError(422, "nothing_counted");
  const missing = counted.filter((l) => l.counted_qty !== l.system_qty && !l.reason).map((l) => l.variant_id);
  if (missing.length) throw new HttpError(422, "reason_required", { variantIds: missing });
  const actor = actorOf(c.get("member"));
  await c.env.DB.batch([
    c.env.DB.prepare("UPDATE stock_counts SET status = 'submitted', submitted_by = ?, submitted_at = ? WHERE id = ? AND status = 'counting'").bind(actor, Date.now(), id),
    auditStmt(c.env, actor, "submit", "stock_count", id, countSummary(lines.map((l) => ({ systemQty: l.system_qty, countedQty: l.counted_qty })))),
  ]);
  return c.json({ ok: true });
});

/**
 * Approval: the differences found are applied to today's stock (sales during the count are
 * kept), each one in the stock history; refused as a whole if it would leave pending orders
 * without their pieces.
 */
stockCountRoutes.post("/stock-counts/:id/approve", requirePermission("stock.approve"), async (c) => {
  const id = intParam(c, "id");
  const { note } = await body(c, z.object({ note: cleanText(500).optional() }));
  const { count, lines } = await loadCount(c, id);
  if (!canCountTransition(count.status, "approved")) throw new HttpError(409, "invalid_transition");
  // the difference found, applied to today's stock (shared rule: never below 0)
  const changes = lines
    .filter((l) => l.counted_qty != null && l.counted_qty !== l.system_qty)
    .map((l) => ({ ...l, ...stockAfterCount(l.stock_on_hand, l.stock_reserved, { systemQty: l.system_qty, countedQty: l.counted_qty }) }));
  const blocked = changes.filter((l) => l.belowReserved).map((l) => ({ variantId: l.variant_id, sku: l.sku, reserved: l.stock_reserved, after: l.target }));
  if (blocked.length) throw new HttpError(409, "stock_below_reserved", { lines: blocked });

  const actor = actorOf(c.get("member"));
  const now = Date.now();
  const restocked: number[] = [];
  const stmts: D1PreparedStatement[] = [];
  for (const l of changes) {
    const delta = l.delta;
    if (l.stock_on_hand - l.stock_reserved <= 0 && l.target - l.stock_reserved > 0) restocked.push(l.variant_id);
    const why = [`Inventaire #${id}`, COUNT_REASON_LABEL[l.reason as CountReason] ?? l.reason, l.note].filter(Boolean).join(" · ");
    if (delta !== 0)
      stmts.push(
        // relative: whatever was sold while counting stays sold (the CHECK refuses anything below the reserved pieces)
        c.env.DB.prepare("UPDATE variants SET stock_on_hand = stock_on_hand + ?, updated_at = ? WHERE id = ?").bind(delta, now, l.variant_id),
        c.env.DB.prepare("INSERT INTO stock_movements (variant_id, delta, reason, note, actor, created_at) VALUES (?, ?, 'inventaire', ?, ?, ?)").bind(l.variant_id, delta, why, actor, now),
      );
    stmts.push(c.env.DB.prepare("UPDATE stock_count_lines SET applied_delta = ? WHERE count_id = ? AND variant_id = ?").bind(delta, id, l.variant_id));
  }
  stmts.push(
    c.env.DB.prepare("UPDATE stock_counts SET status = 'approved', decided_by = ?, decided_at = ?, decision_note = ? WHERE id = ? AND status = 'submitted'").bind(actor, now, note ?? null, id),
    auditStmt(c.env, actor, "approve", "stock_count", id, { corrections: changes.map((l) => ({ variantId: l.variant_id, sku: l.sku, found: l.counted_qty! - l.system_qty, applied: l.delta, reason: l.reason })) }),
  );
  if (changes.length) stmts.push(bumpCatalogStmt(c.env));
  try {
    await c.env.DB.batch(stmts);
  } catch (err) {
    if (/CHECK constraint/i.test(String((err as Error).message))) throw new HttpError(409, "stock_below_reserved");
    throw err;
  }
  if (restocked.length) {
    c.executionCtx.waitUntil(notifyRestocked(c.env, restocked).catch(() => undefined));
    c.executionCtx.waitUntil(sendRestockPushes(c.env, restocked).catch(() => undefined));
  }
  return c.json({ ok: true, corrected: changes.length });
});

/** Not approved: nothing changes in the stock (the count can be reopened to correct it). */
stockCountRoutes.post("/stock-counts/:id/reject", requirePermission("stock.approve"), async (c) => {
  const id = intParam(c, "id");
  const { note } = await body(c, z.object({ note: cleanText(500).pipe(z.string().min(3)) }));
  return decide(c, id, "rejected", note);
});

stockCountRoutes.post("/stock-counts/:id/reopen", requirePermission("stock.edit"), async (c) => decide(c, intParam(c, "id"), "counting"));
stockCountRoutes.post("/stock-counts/:id/cancel", requirePermission("stock.edit"), async (c) => decide(c, intParam(c, "id"), "cancelled"));

async function decide(c: Context<AppEnv>, id: number, to: CountStatus, note?: string) {
  const s = await c.env.DB.prepare("SELECT status FROM stock_counts WHERE id = ?").bind(id).first<{ status: CountStatus }>();
  if (!s) throw new HttpError(404, "not_found");
  if (!canCountTransition(s.status, to)) throw new HttpError(409, "invalid_transition");
  const actor = actorOf(c.get("member"));
  const decided = to === "rejected" || to === "cancelled";
  await c.env.DB.batch([
    c.env.DB.prepare(
      `UPDATE stock_counts SET status = ?, ${decided ? "decided_by = ?, decided_at = ?, decision_note = ?" : "submitted_by = NULL, submitted_at = NULL, decided_by = ?, decided_at = ?, decision_note = ?"} WHERE id = ? AND status = ?`,
    ).bind(to, decided ? actor : null, decided ? Date.now() : null, note ?? null, id, s.status),
    auditStmt(c.env, actor, to === "counting" ? "reopen" : to === "rejected" ? "reject" : "cancel", "stock_count", id, note ? { note } : undefined),
  ]);
  return c.json({ ok: true });
}
