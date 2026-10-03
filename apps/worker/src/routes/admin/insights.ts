/**
 * Admin → packing mode, returns analysis, product profitability, A/B tests and the shop
 * (boutique) page settings.
 */
import { Hono } from "hono";
import { z } from "zod";
import { abVerdict, cleanText, DEFAULT_BOUTIQUE, EXPERIMENT_EVENTS, OUTCOME_REASON_LABEL, type OutcomeReason } from "@henine/shared";
import type { AppEnv } from "../../env";
import { auditStmt } from "../../lib/audit";
import { mediaUrl, variantLabels } from "../../lib/catalog";
import { body, HttpError, intParam } from "../../lib/http";
import { putImage } from "../../lib/media";
import { applyStatusChange } from "../../lib/orders";
import { bumpCatalogStmt, getSetting, setSettingStmt } from "../../lib/settings";
import { syncOrderMessage } from "../../lib/telegram";
import { actorOf, requirePermission } from "../../middleware/access";
import { statsRange } from "./system";

export const insightRoutes = new Hono<AppEnv>();

/* ───────────── Packing mode: pick → verify → pack → label → ship ───────────── */

/** Orders to prepare (confirmed or being prepared), oldest first, with everything to check. */
insightRoutes.get("/packing", requirePermission("orders.ship"), async (c) => {
  const { results: orders } = await c.env.DB.prepare(
    `SELECT o.id, o.public_code, o.status, o.name, o.phone, o.wilaya_code, w.name_fr AS wilaya, COALESCE(cm.name_fr, o.commune_text) AS commune,
            o.delivery_type, o.address, o.customer_note, o.internal_note, o.total, o.created_at, o.confirmed_at, o.verified_at, o.packed_at, o.pack_photo,
            o.tracking_number, o.channel
       FROM orders o LEFT JOIN wilayas w ON w.code = o.wilaya_code LEFT JOIN communes cm ON cm.id = o.commune_id
      WHERE o.status IN ('confirmee','en_preparation')
      ORDER BY COALESCE(o.confirmed_at, o.created_at) ASC LIMIT 60`,
  ).all<{ id: number; pack_photo: string | null } & Record<string, unknown>>();
  if (!orders.length) return c.json([]);
  const ids = orders.map((o) => o.id);
  const { results: items } = await c.env.DB.prepare(
    `SELECT oi.id, oi.order_id, oi.variant_id, oi.product_id, oi.name_fr, oi.sku, oi.options_label, oi.qty, oi.unit_price, oi.image
       FROM order_items oi WHERE oi.order_id IN (${ids.join(",")}) ORDER BY oi.id`,
  ).all<{ order_id: number; variant_id: number | null } & Record<string, unknown>>();
  const labels = await variantLabels(c.env, [...new Set(items.map((i) => i.variant_id).filter((v): v is number => v != null))]);
  return c.json(
    orders.map((o) => ({
      ...o,
      pack_photo_url: o.pack_photo ? mediaUrl(c.env, o.pack_photo) : null,
      items: items.filter((i) => i.order_id === o.id).map((i) => ({ ...i, options: (i.variant_id != null ? labels.get(i.variant_id)?.fr : null) ?? i.options_label })),
    })),
  );
});

/**
 * One packing step. "start" moves a confirmed order to "en préparation"; "verified" records
 * that every item was checked; "packed" (form, optional photo of the parcel) records the packing.
 */
insightRoutes.post("/orders/:id/packing", requirePermission("orders.ship"), async (c) => {
  const id = intParam(c, "id");
  const actor = actorOf(c.get("member"));
  const isForm = (c.req.header("Content-Type") ?? "").startsWith("multipart/form-data");
  let step: string;
  let photo: File | null = null;
  if (isForm) {
    const form = await c.req.formData().catch(() => null);
    step = String(form?.get("step") ?? "");
    const f = form?.get("photo");
    photo = f && typeof f !== "string" ? f : null;
  } else {
    step = (await body(c, z.object({ step: z.enum(["start", "verified", "packed"]) }))).step;
  }
  const o = await c.env.DB.prepare("SELECT id, status, pack_photo FROM orders WHERE id = ?").bind(id).first<{ id: number; status: string; pack_photo: string | null }>();
  if (!o) throw new HttpError(404, "not_found");
  const now = Date.now();
  if (step === "start") {
    if (o.status === "confirmee") {
      await applyStatusChange(c.env, id, "en_preparation", actor, "admin", "Mode préparation");
      c.executionCtx.waitUntil(syncOrderMessage(c.env, id).catch(() => undefined));
    }
    return c.json({ ok: true });
  }
  if (!["confirmee", "en_preparation"].includes(o.status)) throw new HttpError(409, "not_preparing");
  if (step === "verified") {
    const n = await c.env.DB.prepare("SELECT COALESCE(SUM(qty), 0) AS n FROM order_items WHERE order_id = ?").bind(id).first<{ n: number }>();
    await c.env.DB.batch([
      c.env.DB.prepare("UPDATE orders SET verified_at = ?, updated_at = ? WHERE id = ?").bind(now, now, id),
      c.env.DB.prepare("INSERT INTO order_events (order_id, kind, actor, source, note, created_at) VALUES (?, 'note', ?, 'admin', ?, ?)").bind(
        id, actor, `✅ Colis vérifié : ${n?.n ?? 0} article(s) contrôlé(s) un par un`, now,
      ),
    ]);
    return c.json({ ok: true });
  }
  if (step === "packed") {
    const key = photo ? await putImage(c.env, `packing/${id}`, photo, 3_000_000) : null;
    await c.env.DB.batch([
      c.env.DB.prepare("UPDATE orders SET packed_at = ?, pack_photo = COALESCE(?, pack_photo), updated_at = ? WHERE id = ?").bind(now, key, now, id),
      c.env.DB.prepare("INSERT INTO order_events (order_id, kind, actor, source, note, created_at) VALUES (?, 'note', ?, 'admin', ?, ?)").bind(
        id, actor, key ? "📦 Colis emballé (photo enregistrée)" : "📦 Colis emballé", now,
      ),
    ]);
    if (key && o.pack_photo) c.executionCtx.waitUntil(c.env.MEDIA.delete(o.pack_photo).catch(() => undefined));
    return c.json({ ok: true, photo: key ? mediaUrl(c.env, key) : null });
  }
  throw new HttpError(422, "validation_failed");
});

/* ───────────── Returns analysis ───────────── */

const SHIPPED = "('expediee','en_livraison','livree','retour','retour_recu')";
const RETURNED = "('retour','retour_recu')";

insightRoutes.get("/stats/returns", requirePermission("stats.view"), async (c) => {
  const { since, until } = statsRange((k) => c.req.query(k));
  const range = "o.created_at >= ?1 AND o.created_at < ?2";
  const [reasons, totals, sizes, products] = await c.env.DB.batch([
    c.env.DB.prepare(`SELECT COALESCE(o.outcome_reason, 'unknown') AS reason, COUNT(*) AS n FROM orders o WHERE ${range} AND o.status IN ${RETURNED} GROUP BY 1 ORDER BY n DESC`).bind(since, until),
    c.env.DB.prepare(
      `SELECT COUNT(*) AS shipped, SUM(CASE WHEN o.status IN ${RETURNED} THEN 1 ELSE 0 END) AS returned FROM orders o WHERE ${range} AND o.status IN ${SHIPPED}`,
    ).bind(since, until),
    // pieces shipped / returned per size (the size option of the variant)
    c.env.DB.prepare(
      `SELECT ov.label_fr AS size, SUM(oi.qty) AS shipped,
              SUM(CASE WHEN o.status IN ${RETURNED} THEN oi.qty ELSE 0 END) AS returned,
              SUM(CASE WHEN o.status IN ${RETURNED} AND o.outcome_reason = 'too_small' THEN oi.qty ELSE 0 END) AS too_small,
              SUM(CASE WHEN o.status IN ${RETURNED} AND o.outcome_reason = 'too_large' THEN oi.qty ELSE 0 END) AS too_large
         FROM order_items oi JOIN orders o ON o.id = oi.order_id JOIN variants v ON v.id = oi.variant_id, json_each(v.option_value_ids) je
         JOIN option_values ov ON ov.id = je.value JOIN product_options po ON po.id = ov.option_id AND po.kind = 'taille'
        WHERE ${range} AND o.status IN ${SHIPPED} GROUP BY ov.label_fr ORDER BY MIN(ov.sort), ov.label_fr`,
    ).bind(since, until),
    c.env.DB.prepare(
      `SELECT oi.product_id, MAX(oi.name_fr) AS name, SUM(oi.qty) AS shipped,
              SUM(CASE WHEN o.status IN ${RETURNED} THEN oi.qty ELSE 0 END) AS returned,
              SUM(CASE WHEN o.status IN ${RETURNED} AND o.outcome_reason IN ('too_small','too_large','size_issue') THEN oi.qty ELSE 0 END) AS size_returns,
              SUM(CASE WHEN o.status IN ${RETURNED} AND o.outcome_reason IN ('defect','product_issue') THEN oi.qty ELSE 0 END) AS defects
         FROM order_items oi JOIN orders o ON o.id = oi.order_id
        WHERE ${range} AND o.status IN ${SHIPPED} AND oi.product_id IS NOT NULL GROUP BY oi.product_id HAVING returned > 0 ORDER BY returned DESC LIMIT 20`,
    ).bind(since, until),
  ]);
  const t = (totals!.results[0] ?? { shipped: 0, returned: 0 }) as { shipped: number; returned: number };
  const reasonRows = reasons!.results as { reason: string; n: number }[];
  const returnedOrders = reasonRows.reduce((s, r) => s + r.n, 0);
  const sizeRows = sizes!.results as { size: string; shipped: number; returned: number; too_small: number; too_large: number }[];
  const allShipped = sizeRows.reduce((s, r) => s + r.shipped, 0);
  const allReturned = sizeRows.reduce((s, r) => s + r.returned, 0);
  const avg = allShipped ? allReturned / allShipped : 0;
  // a size stands out: at least 3 returned pieces and 1.5× the average return rate
  const alerts = sizeRows
    .filter((r) => r.returned >= 3 && r.shipped > 0 && r.returned / r.shipped >= Math.max(avg * 1.5, 0.05))
    .map((r) => ({
      size: r.size,
      rate: r.returned / r.shipped,
      average: avg,
      hint: r.too_small > r.too_large && r.too_small >= r.returned / 2 ? "too_small" : r.too_large > r.too_small && r.too_large >= r.returned / 2 ? "too_large" : null,
    }));
  return c.json({
    shippedOrders: t.shipped ?? 0,
    returnedOrders,
    rate: t.shipped ? (t.returned ?? 0) / t.shipped : 0,
    reasons: reasonRows.map((r) => ({
      reason: r.reason,
      label: OUTCOME_REASON_LABEL[r.reason as OutcomeReason] ?? "Non précisé",
      n: r.n,
      share: returnedOrders ? r.n / returnedOrders : 0,
    })),
    sizes: sizeRows.map((r) => ({ ...r, rate: r.shipped ? r.returned / r.shipped : 0 })),
    averageRate: avg,
    alerts,
    products: (products!.results as { product_id: number; name: string; shipped: number; returned: number; size_returns: number; defects: number }[]).map((p) => ({
      ...p,
      rate: p.shipped ? p.returned / p.shipped : 0,
    })),
  });
});

/* ───────────── Product profitability ───────────── */

/**
 * Per product, for orders placed in the period:
 * revenue and cost of delivered pieces; discounts and free delivery the shop paid, shared
 * across the order's items by value; returns = the delivery the shop pays on a returned
 * parcel (wilaya rate), shared the same way. Delivery costs are estimated from the rates
 * in Contenu → Livraison.
 */
insightRoutes.get("/stats/profit", requirePermission("stats.view"), async (c) => {
  const perms = c.get("member").permissions;
  if (!perms.includes("*") && !perms.includes("cost.view")) throw new HttpError(403, "forbidden");
  const { since, until } = statsRange((k) => c.req.query(k));
  const { results } = await c.env.DB.prepare(
    `SELECT oi.product_id, oi.qty, oi.unit_price, o.id AS order_id, o.status, o.subtotal, o.discount_total, o.shipping_price, o.delivery_type, o.channel,
            w.home_price, w.desk_price, p.name_fr, p.cost_price, p.slug,
            (SELECT base_key FROM product_images i WHERE i.product_id = oi.product_id ORDER BY sort, id LIMIT 1) AS image_key
       FROM order_items oi JOIN orders o ON o.id = oi.order_id LEFT JOIN wilayas w ON w.code = o.wilaya_code LEFT JOIN products p ON p.id = oi.product_id
      WHERE o.created_at >= ? AND o.created_at < ? AND o.status IN ('livree','retour','retour_recu') AND oi.product_id IS NOT NULL
      LIMIT 20000`,
  )
    .bind(since, until)
    .all<{
      product_id: number; qty: number; unit_price: number; order_id: number; status: string; subtotal: number; discount_total: number; shipping_price: number;
      delivery_type: string; channel: string; home_price: number | null; desk_price: number | null; name_fr: string | null; cost_price: number | null; slug: string | null;
      image_key: string | null;
    }>();
  type Row = { id: number; name: string; image: string | null; units: number; revenue: number; cost: number; delivery: number; returns: number; discounts: number; missingCost: boolean; returnedUnits: number };
  const byProduct = new Map<number, Row>();
  for (const r of results) {
    const p = byProduct.get(r.product_id) ?? {
      id: r.product_id, name: r.name_fr ?? `#${r.product_id}`, image: r.image_key ? mediaUrl(c.env, r.image_key).replace("{w}", "480") : null,
      units: 0, revenue: 0, cost: 0, delivery: 0, returns: 0, discounts: 0, missingCost: false, returnedUnits: 0,
    };
    const line = r.unit_price * r.qty;
    const share = r.subtotal > 0 ? line / r.subtotal : 0;
    const rate = r.channel === "boutique" ? 0 : ((r.delivery_type === "bureau" ? r.desk_price : r.home_price) ?? 0);
    if (r.status === "livree") {
      p.units += r.qty;
      p.revenue += line;
      if (r.cost_price == null) p.missingCost = true;
      else p.cost += r.cost_price * r.qty;
      p.discounts += Math.round(r.discount_total * share);
      p.delivery += Math.round(Math.max(rate - r.shipping_price, 0) * share); // free / cheaper delivery paid by the shop
    } else {
      p.returnedUnits += r.qty;
      p.returns += Math.round(rate * share); // delivery paid for nothing
    }
    byProduct.set(r.product_id, p);
  }
  const rows = [...byProduct.values()].map((p) => {
    const profit = p.revenue - p.cost - p.delivery - p.returns - p.discounts;
    return { ...p, profit, margin: p.revenue ? profit / p.revenue : 0 };
  });
  const sum = (k: "revenue" | "cost" | "delivery" | "returns" | "discounts" | "profit") => rows.reduce((s, r) => s + r[k], 0);
  return c.json({
    rows: rows.sort((a, b) => b.profit - a.profit),
    totals: { revenue: sum("revenue"), cost: sum("cost"), delivery: sum("delivery"), returns: sum("returns"), discounts: sum("discounts"), profit: sum("profit") },
    missingCost: rows.filter((r) => r.missingCost).length,
  });
});

/* ───────────── A/B tests ───────────── */

const labelPair = z.object({ fr: cleanText(40).pipe(z.string().min(2)), ar: cleanText(40).pipe(z.string().min(2)) });
const experimentInput = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("buy_label"), name: cleanText(80).pipe(z.string().min(2)), a: labelPair, b: labelPair }),
  z.object({ kind: z.literal("grid"), name: cleanText(80).pipe(z.string().min(2)) }),
]);

insightRoutes.get("/experiments", requirePermission("stats.view"), async (c) => {
  const [exps, stats] = await c.env.DB.batch([
    c.env.DB.prepare("SELECT * FROM experiments ORDER BY (status = 'running') DESC, id DESC LIMIT 50"),
    c.env.DB.prepare("SELECT experiment_id, variant, event, SUM(n) AS n FROM experiment_stats GROUP BY experiment_id, variant, event"),
  ]);
  const counts = stats!.results as { experiment_id: number; variant: string; event: string; n: number }[];
  return c.json(
    (exps!.results as ({ id: number; config: string } & Record<string, unknown>)[]).map((e) => {
      const funnel = (v: string) => Object.fromEntries(EXPERIMENT_EVENTS.map((ev) => [ev, counts.find((x) => x.experiment_id === e.id && x.variant === v && x.event === ev)?.n ?? 0]));
      const a = funnel("a");
      const b = funnel("b");
      return { ...e, config: JSON.parse(e.config), funnel: { a, b }, verdict: abVerdict({ seen: a.seen!, converted: a.order! }, { seen: b.seen!, converted: b.order! }) };
    }),
  );
});

insightRoutes.post("/experiments", requirePermission("marketing.edit"), async (c) => {
  const input = await body(c, experimentInput);
  const config = input.kind === "buy_label" ? { a: input.a, b: input.b } : { a: { layout: "grid" }, b: { layout: "large" } };
  const row = await c.env.DB.prepare("INSERT INTO experiments (name, kind, config, status, created_at) VALUES (?, ?, ?, 'draft', ?) RETURNING id")
    .bind(input.name, input.kind, JSON.stringify(config), Date.now())
    .first<{ id: number }>();
  await auditStmt(c.env, actorOf(c.get("member")), "create", "experiment", row!.id, { kind: input.kind }).run();
  return c.json({ id: row!.id }, 201);
});

/** start / stop (one running test per kind), or note the version kept. */
insightRoutes.patch("/experiments/:id", requirePermission("marketing.edit"), async (c) => {
  const id = intParam(c, "id");
  const input = await body(c, z.object({ status: z.enum(["running", "stopped"]).optional(), winner: z.enum(["a", "b"]).nullable().optional() }));
  const e = await c.env.DB.prepare("SELECT id, kind, status FROM experiments WHERE id = ?").bind(id).first<{ id: number; kind: string; status: string }>();
  if (!e) throw new HttpError(404, "not_found");
  const now = Date.now();
  const stmts: D1PreparedStatement[] = [];
  if (input.status === "running") {
    const other = await c.env.DB.prepare("SELECT id FROM experiments WHERE kind = ? AND status = 'running' AND id != ?").bind(e.kind, id).first();
    if (other) throw new HttpError(409, "experiment_running");
    stmts.push(c.env.DB.prepare("UPDATE experiments SET status = 'running', started_at = COALESCE(started_at, ?), ended_at = NULL WHERE id = ?").bind(now, id));
  } else if (input.status === "stopped") {
    stmts.push(c.env.DB.prepare("UPDATE experiments SET status = 'stopped', ended_at = ? WHERE id = ?").bind(now, id));
  }
  if (input.winner !== undefined) stmts.push(c.env.DB.prepare("UPDATE experiments SET winner = ? WHERE id = ?").bind(input.winner, id));
  if (stmts.length) await c.env.DB.batch([...stmts, bumpCatalogStmt(c.env), auditStmt(c.env, actorOf(c.get("member")), "update", "experiment", id, input)]);
  return c.json({ ok: true });
});

insightRoutes.delete("/experiments/:id", requirePermission("marketing.edit"), async (c) => {
  const id = intParam(c, "id");
  await c.env.DB.batch([
    c.env.DB.prepare("DELETE FROM experiment_stats WHERE experiment_id = ?").bind(id),
    c.env.DB.prepare("DELETE FROM experiments WHERE id = ?").bind(id),
    bumpCatalogStmt(c.env),
    auditStmt(c.env, actorOf(c.get("member")), "delete", "experiment", id),
  ]);
  return c.json({ ok: true });
});

/* ───────────── The shop (boutique) page ───────────── */

const hhmm = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/);
const boutiqueInput = z.object({
  enabled: z.boolean(),
  addressFr: cleanText(200),
  addressAr: cleanText(200),
  mapQuery: cleanText(200),
  hours: z.array(z.object({ open: hhmm, close: hhmm }).nullable()).length(7),
  noteFr: cleanText(300).default(""),
  noteAr: cleanText(300).default(""),
  showOnProducts: z.boolean(),
});

insightRoutes.get("/boutique", requirePermission("marketing.edit"), async (c) => c.json({ ...DEFAULT_BOUTIQUE, ...(await getSetting(c.env, "boutique")) }));

insightRoutes.put("/boutique", requirePermission("marketing.edit"), async (c) => {
  const input = await body(c, boutiqueInput);
  await c.env.DB.batch([setSettingStmt(c.env, "boutique", input), bumpCatalogStmt(c.env), auditStmt(c.env, actorOf(c.get("member")), "update", "settings", "boutique")]);
  return c.json(input);
});
