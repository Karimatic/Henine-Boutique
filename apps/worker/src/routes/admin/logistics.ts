/**
 * Admin → Expéditions: failed deliveries to follow up, and the courier hand-over sheets
 * (manifests). Both sit on top of the order lifecycle: contacts go to the order's history (the
 * same log as Commandes → Contacter), and handing a manifest over marks its orders "expédiée"
 * through the normal transition (stock leaves the shop then).
 */
import { Hono } from "hono";
import { z } from "zod";
import {
  canFollowupTransition,
  canManifestTransition,
  cleanText,
  CONTACT_KIND_LABEL,
  CONTACT_KINDS,
  FAILABLE_ORDER_STATUSES,
  FAILED_DELIVERY_REASON_LABEL,
  FAILED_DELIVERY_REASONS,
  FOLLOWUP_OPEN,
  FOLLOWUP_STATUS_LABEL,
  FOLLOWUP_STATUSES,
  followupClosed,
  MANIFEST_ORDER_STATUSES,
  manifestEditable,
  type FollowupStatus,
  type ManifestStatus,
  type OrderStatus,
} from "@henine/shared";
import type { AppEnv } from "../../env";
import { raiseAlert, resolveAlertStmt } from "../../lib/alerts";
import { auditStmt } from "../../lib/audit";
import { body, HttpError, intParam } from "../../lib/http";
import { algiersDate, applyStatusChange } from "../../lib/orders";
import { syncOrderMessage } from "../../lib/telegram";
import { actorOf, requirePermission } from "../../middleware/access";

export const logisticsRoutes = new Hono<AppEnv>();

const MANIFEST_MAX = 200;
const OPEN_SQL = `(${FOLLOWUP_OPEN.map((s) => `'${s}'`).join(",")})`;
const event = (env: AppEnv["Bindings"], orderId: number, kind: string, actor: string, note: string, at = Date.now()) =>
  env.DB.prepare("INSERT INTO order_events (order_id, kind, actor, source, note, created_at) VALUES (?, ?, ?, 'admin', ?, ?)").bind(orderId, kind, actor, note, at);

/* ───────────── Failed deliveries ───────────── */

/** The courier couldn't deliver: one follow-up per order (a new failure adds an attempt). */
logisticsRoutes.post("/orders/:id/failed-delivery", requirePermission("orders.ship"), async (c) => {
  const orderId = intParam(c, "id");
  const input = await body(
    c,
    z.object({ reason: z.enum(FAILED_DELIVERY_REASONS), note: cleanText(500).optional(), nextActionAt: z.number().int().positive().optional() }),
  );
  const o = await c.env.DB.prepare("SELECT id, public_code, status FROM orders WHERE id = ?").bind(orderId).first<{ id: number; public_code: string; status: OrderStatus }>();
  if (!o) throw new HttpError(404, "not_found");
  if (!(FAILABLE_ORDER_STATUSES as readonly string[]).includes(o.status)) throw new HttpError(409, "not_out_for_delivery");
  const actor = actorOf(c.get("member"));
  const now = Date.now();
  const label = FAILED_DELIVERY_REASON_LABEL[input.reason];
  const open = await c.env.DB.prepare(`SELECT id, attempts FROM delivery_followups WHERE order_id = ? AND status IN ${OPEN_SQL}`).bind(orderId).first<{ id: number; attempts: number }>();
  let id: number;
  if (open) {
    await c.env.DB.batch([
      c.env.DB.prepare(
        "UPDATE delivery_followups SET attempts = attempts + 1, reason = ?, status = 'needs_contact', last_attempt_at = ?, next_action_at = ?, note = COALESCE(?, note), updated_at = ? WHERE id = ?",
      ).bind(input.reason, now, input.nextActionAt ?? now, input.note ?? null, now, open.id),
      event(c.env, orderId, "carrier", actor, `🚚 Échec de livraison (tentative ${open.attempts + 1}) : ${label}${input.note ? ` · ${input.note}` : ""}`, now),
    ]);
    id = open.id;
  } else {
    const r = await c.env.DB.prepare(
      `INSERT INTO delivery_followups (order_id, reason, status, attempts, last_attempt_at, next_action_at, note, created_by, created_at, updated_at)
       VALUES (?, ?, 'needs_contact', 1, ?, ?, ?, ?, ?, ?) RETURNING id`,
    )
      .bind(orderId, input.reason, now, input.nextActionAt ?? now, input.note ?? null, actor, now, now)
      .first<{ id: number }>();
    id = r!.id;
    await event(c.env, orderId, "carrier", actor, `🚚 Échec de livraison : ${label}${input.note ? ` · ${input.note}` : ""}`, now).run();
  }
  await raiseAlert(c.env, {
    kind: "failed_delivery",
    priority: "high",
    entity: "order",
    entityId: orderId,
    message: `Livraison échouée : ${o.public_code} (${label}). La cliente est à recontacter.`,
    dedupeKey: `followup:${id}`,
  });
  return c.json({ id }, 201);
});

logisticsRoutes.get("/followups", requirePermission("orders.view"), async (c) => {
  const status = c.req.query("status") ?? "open";
  const where: string[] = [];
  const binds: unknown[] = [];
  if (status === "open") where.push(`f.status IN ${OPEN_SQL}`);
  else if (status === "due") {
    where.push(`f.status IN ${OPEN_SQL} AND COALESCE(f.next_action_at, 0) <= ?`);
    binds.push(Date.now());
  } else if ((FOLLOWUP_STATUSES as readonly string[]).includes(status)) {
    where.push("f.status = ?");
    binds.push(status);
  }
  if (c.req.query("mine") === "1") {
    where.push("f.assigned_to = ?");
    binds.push(c.get("member").id);
  }
  const { results } = await c.env.DB.prepare(
    `SELECT f.id, f.order_id, f.reason, f.status, f.attempts, f.last_attempt_at, f.next_action_at, f.assigned_to, f.escalated, f.note,
            f.created_at, f.updated_at, f.closed_at, f.closed_by, m.name AS assigned_name,
            o.public_code, o.status AS order_status, o.name, o.phone, o.total, o.tracking_number, w.name_fr AS wilaya, w.name_ar AS wilaya_ar,
            (SELECT COUNT(*) FROM order_events e WHERE e.order_id = f.order_id AND e.kind IN ('call','whatsapp','sms') AND e.created_at >= f.created_at) AS contacts,
            (SELECT MAX(e.created_at) FROM order_events e WHERE e.order_id = f.order_id AND e.kind IN ('call','whatsapp','sms')) AS last_contact_at
       FROM delivery_followups f JOIN orders o ON o.id = f.order_id LEFT JOIN wilayas w ON w.code = o.wilaya_code LEFT JOIN team_members m ON m.id = f.assigned_to
      ${where.length ? `WHERE ${where.join(" AND ")}` : ""}
      ORDER BY f.escalated DESC, COALESCE(f.next_action_at, f.created_at) ASC LIMIT 200`,
  )
    .bind(...binds)
    .all();
  const counts = await c.env.DB.prepare(
    `SELECT SUM(CASE WHEN status IN ${OPEN_SQL} THEN 1 ELSE 0 END) AS open,
            SUM(CASE WHEN status IN ${OPEN_SQL} AND COALESCE(next_action_at, 0) <= ? THEN 1 ELSE 0 END) AS due,
            SUM(CASE WHEN status IN ${OPEN_SQL} AND escalated = 1 THEN 1 ELSE 0 END) AS escalated
       FROM delivery_followups`,
  )
    .bind(Date.now())
    .first<{ open: number | null; due: number | null; escalated: number | null }>();
  return c.json({ rows: results, counts: { open: counts?.open ?? 0, due: counts?.due ?? 0, escalated: counts?.escalated ?? 0 } });
});

/** Who a follow-up can be given to (names only, for anyone who sees the orders). */
logisticsRoutes.get("/followups/assignees", requirePermission("orders.view"), async (c) => {
  const { results } = await c.env.DB.prepare("SELECT id, name FROM team_members WHERE is_active = 1 ORDER BY name").all();
  return c.json(results);
});

/**
 * Working a follow-up: log a contact (call / WhatsApp / SMS, in the order's history), set the
 * result and the next call, assign it, escalate, or close it.
 */
logisticsRoutes.patch("/followups/:id", requirePermission("orders.edit"), async (c) => {
  const id = intParam(c, "id");
  const input = await body(
    c,
    z.object({
      status: z.enum(FOLLOWUP_STATUSES).optional(),
      nextActionAt: z.number().int().positive().nullable().optional(),
      assignedTo: z.number().int().positive().nullable().optional(),
      escalated: z.boolean().optional(),
      note: cleanText(500).optional(),
      contact: z.object({ kind: z.enum(CONTACT_KINDS), note: cleanText(500).optional() }).optional(),
    }),
  );
  const f = await c.env.DB.prepare("SELECT f.*, o.public_code FROM delivery_followups f JOIN orders o ON o.id = f.order_id WHERE f.id = ?")
    .bind(id)
    .first<{ id: number; order_id: number; status: FollowupStatus; public_code: string; escalated: number }>();
  if (!f) throw new HttpError(404, "not_found");
  const to = input.status ?? f.status;
  if (!canFollowupTransition(f.status, to)) throw new HttpError(409, "invalid_transition", { from: f.status, to });
  if (to === "callback" && !input.nextActionAt) throw new HttpError(422, "callback_needs_time");
  if (input.assignedTo) {
    const m = await c.env.DB.prepare("SELECT id FROM team_members WHERE id = ? AND is_active = 1").bind(input.assignedTo).first();
    if (!m) throw new HttpError(422, "unknown_member");
  }
  const actor = actorOf(c.get("member"));
  const now = Date.now();
  const sets = ["status = ?", "updated_at = ?"];
  const vals: unknown[] = [to, now];
  if (input.nextActionAt !== undefined) {
    sets.push("next_action_at = ?");
    vals.push(input.nextActionAt);
  }
  if (input.assignedTo !== undefined) {
    sets.push("assigned_to = ?");
    vals.push(input.assignedTo);
  }
  if (input.escalated !== undefined) {
    sets.push("escalated = ?");
    vals.push(input.escalated ? 1 : 0);
  }
  if (input.note) {
    sets.push("note = ?");
    vals.push(input.note);
  }
  const closing = followupClosed(to) && !followupClosed(f.status);
  if (closing) sets.push("closed_at = ?", "closed_by = ?"), vals.push(now, actor);
  if (!followupClosed(to) && followupClosed(f.status)) sets.push("closed_at = NULL", "closed_by = NULL");

  const stmts: D1PreparedStatement[] = [c.env.DB.prepare(`UPDATE delivery_followups SET ${sets.join(", ")} WHERE id = ?`).bind(...vals, id)];
  // the order's history tells the whole story (same contact log as the order page)
  if (input.contact) stmts.push(event(c.env, f.order_id, input.contact.kind, actor, input.contact.note || `${CONTACT_KIND_LABEL[input.contact.kind].fr} (livraison échouée)`, now));
  if (to !== f.status) stmts.push(event(c.env, f.order_id, "note", actor, `Suivi livraison : ${FOLLOWUP_STATUS_LABEL[to]}${input.note ? ` · ${input.note}` : ""}`, now));
  if (to === "retry_requested" && f.status !== "retry_requested") stmts.push(event(c.env, f.order_id, "carrier", actor, "🚚 Nouveau passage demandé au livreur", now));
  if (input.escalated && !f.escalated) stmts.push(event(c.env, f.order_id, "note", actor, "⚠️ Suivi livraison escaladé à la responsable", now));
  if (closing) stmts.push(resolveAlertStmt(c.env, `followup:${id}`, actor));
  stmts.push(auditStmt(c.env, actor, "update", "delivery_followup", id, { from: f.status, to, contact: input.contact?.kind, assignedTo: input.assignedTo, escalated: input.escalated }));
  await c.env.DB.batch(stmts);
  return c.json({ ok: true, status: to });
});

/* ───────────── Courier hand-over sheets (manifests) ───────────── */

interface ManifestRow {
  id: number;
  code: string;
  status: ManifestStatus;
}

/** Orders that can go on a sheet: confirmed or being prepared, not on another active sheet. */
const ELIGIBLE_SQL = `o.status IN (${MANIFEST_ORDER_STATUSES.map((s) => `'${s}'`).join(",")}) AND o.channel != 'boutique'
  AND NOT EXISTS (SELECT 1 FROM manifest_orders mo JOIN shipment_manifests m ON m.id = mo.manifest_id WHERE mo.order_id = o.id AND m.status != 'cancelled')`;
const FEE = "CASE WHEN o.delivery_type = 'bureau' THEN w.desk_price ELSE w.home_price END";

logisticsRoutes.get("/manifests", requirePermission("orders.view"), async (c) => {
  const status = c.req.query("status");
  const { results } = await c.env.DB.prepare(
    `SELECT m.id, m.code, m.status, m.carrier, m.handoff_ref, m.note, m.created_by, m.created_at, m.ready_at, m.handed_at, m.handed_by, m.confirmed_at,
            COUNT(mo.order_id) AS packages, COALESCE(SUM(mo.cod_amount), 0) AS cod_total, COALESCE(SUM(mo.fee), 0) AS fees_total
       FROM shipment_manifests m LEFT JOIN manifest_orders mo ON mo.manifest_id = m.id
      ${status ? "WHERE m.status = ?" : ""} GROUP BY m.id ORDER BY m.id DESC LIMIT 100`,
  )
    .bind(...(status ? [status] : []))
    .all();
  return c.json(results);
});

logisticsRoutes.get("/manifests/eligible", requirePermission("orders.view"), async (c) => {
  const { results } = await c.env.DB.prepare(
    `SELECT o.id, o.public_code, o.status, o.name, o.phone, o.total, o.delivery_type, o.tracking_number, o.packed_at, o.created_at,
            w.name_fr AS wilaya, w.name_ar AS wilaya_ar, ${FEE} AS fee, (SELECT SUM(qty) FROM order_items WHERE order_id = o.id) AS items
       FROM orders o LEFT JOIN wilayas w ON w.code = o.wilaya_code
      WHERE ${ELIGIBLE_SQL} ORDER BY o.packed_at IS NULL, o.created_at LIMIT 300`,
  ).all();
  return c.json(results);
});

async function loadManifest(env: AppEnv["Bindings"], id: number) {
  const [m, orders] = await env.DB.batch([
    env.DB.prepare("SELECT * FROM shipment_manifests WHERE id = ?").bind(id),
    env.DB.prepare(
      `SELECT mo.order_id, mo.cod_amount, mo.fee, o.public_code, o.status, o.name, o.phone, o.address, o.delivery_type, o.tracking_number,
              w.name_fr AS wilaya, w.name_ar AS wilaya_ar, COALESCE(cm.name_fr, o.commune_text) AS commune, (SELECT SUM(qty) FROM order_items WHERE order_id = o.id) AS items
         FROM manifest_orders mo JOIN orders o ON o.id = mo.order_id LEFT JOIN wilayas w ON w.code = o.wilaya_code LEFT JOIN communes cm ON cm.id = o.commune_id
        WHERE mo.manifest_id = ? ORDER BY w.code, o.public_code`,
    ).bind(id),
  ]);
  const row = m!.results[0] as (ManifestRow & Record<string, unknown>) | undefined;
  if (!row) throw new HttpError(404, "not_found");
  const list = orders!.results as { order_id: number; cod_amount: number; fee: number; status: OrderStatus; tracking_number: string | null }[];
  return {
    manifest: row,
    orders: list,
    totals: { packages: list.length, cod: list.reduce((s, o) => s + o.cod_amount, 0), fees: list.reduce((s, o) => s + o.fee, 0) },
  };
}

logisticsRoutes.get("/manifests/:id", requirePermission("orders.view"), async (c) => {
  const m = await loadManifest(c.env, intParam(c, "id"));
  return c.json({ ...m.manifest, orders: m.orders, totals: m.totals });
});

/** Adds orders to a draft sheet: refused (all of them) if one is not eligible any more. */
function addOrdersStmts(env: AppEnv["Bindings"], manifestRef: string, ids: number[], now: number) {
  return ids.map((id) =>
    env.DB.prepare(
      `INSERT INTO manifest_orders (manifest_id, order_id, cod_amount, fee, created_at)
       SELECT ${manifestRef}, o.id, o.total, COALESCE(${FEE}, 0), ? FROM orders o LEFT JOIN wilayas w ON w.code = o.wilaya_code WHERE o.id = ? AND ${ELIGIBLE_SQL}`,
    ).bind(now, id),
  );
}

logisticsRoutes.post("/manifests", requirePermission("orders.ship"), async (c) => {
  const input = await body(c, z.object({ orderIds: z.array(z.number().int().positive()).min(1).max(MANIFEST_MAX), note: cleanText(300).optional() }));
  const ids = [...new Set(input.orderIds)];
  const actor = actorOf(c.get("member"));
  const now = Date.now();
  // MN-20261006-1, -2… (one code per sheet of the day)
  const today = algiersDate(now).replace(/-/g, "");
  const n = await c.env.DB.prepare("SELECT COUNT(*) AS n FROM shipment_manifests WHERE code LIKE ?").bind(`MN-${today}-%`).first<{ n: number }>();
  const code = `MN-${today}-${(n?.n ?? 0) + 1}`;
  const NEW_ID = "(SELECT MAX(id) FROM shipment_manifests)";
  const res = await c.env.DB.batch([
    c.env.DB.prepare(
      "INSERT INTO shipment_manifests (id, code, status, note, created_by, created_at, updated_at) VALUES ((SELECT COALESCE(MAX(id), 0) + 1 FROM shipment_manifests), ?, 'draft', ?, ?, ?, ?)",
    ).bind(code, input.note ?? null, actor, now, now),
    ...addOrdersStmts(c.env, NEW_ID, ids, now),
    c.env.DB.prepare(`SELECT ${NEW_ID} AS id, (SELECT COUNT(*) FROM manifest_orders WHERE manifest_id = ${NEW_ID}) AS added`),
  ]);
  const { id, added } = res.at(-1)!.results[0] as { id: number; added: number };
  if (added !== ids.length) {
    // some orders weren't eligible (shipped, cancelled, on another sheet): nothing is kept
    await c.env.DB.prepare("DELETE FROM shipment_manifests WHERE id = ?").bind(id).run();
    throw new HttpError(409, "orders_not_eligible");
  }
  await auditStmt(c.env, actor, "create", "manifest", id, { code, orders: ids.length }).run();
  return c.json({ id, code }, 201);
});

logisticsRoutes.post("/manifests/:id/orders", requirePermission("orders.ship"), async (c) => {
  const id = intParam(c, "id");
  const input = await body(c, z.object({ add: z.array(z.number().int().positive()).max(MANIFEST_MAX).default([]), remove: z.array(z.number().int().positive()).max(MANIFEST_MAX).default([]) }));
  const { manifest, orders } = await loadManifest(c.env, id);
  if (!manifestEditable(manifest.status)) throw new HttpError(409, "manifest_locked");
  const add = [...new Set(input.add)].filter((o) => !orders.some((x) => x.order_id === o));
  if (orders.length - input.remove.length + add.length > MANIFEST_MAX) throw new HttpError(422, "too_many_orders", { max: MANIFEST_MAX });
  const now = Date.now();
  const res = await c.env.DB.batch([
    ...input.remove.map((o) => c.env.DB.prepare("DELETE FROM manifest_orders WHERE manifest_id = ? AND order_id = ?").bind(id, o)),
    ...addOrdersStmts(c.env, String(id), add, now),
    c.env.DB.prepare("UPDATE shipment_manifests SET updated_at = ? WHERE id = ?").bind(now, id),
  ]);
  const notAdded = add.filter((_, i) => !res[input.remove.length + i]!.meta.changes);
  return c.json({ ok: true, notAdded });
});

/** Tracking numbers of the parcels (from the courier's labels), several at once. */
logisticsRoutes.post("/manifests/:id/tracking", requirePermission("orders.ship"), async (c) => {
  const id = intParam(c, "id");
  const input = await body(c, z.object({ lines: z.array(z.object({ orderId: z.number().int().positive(), trackingNumber: cleanText(60).pipe(z.string().min(3)) })).min(1).max(MANIFEST_MAX) }));
  const { manifest, orders } = await loadManifest(c.env, id);
  if (manifest.status === "cancelled" || manifest.status === "confirmed") throw new HttpError(409, "manifest_locked");
  const inSheet = new Set(orders.map((o) => o.order_id));
  if (input.lines.some((l) => !inSheet.has(l.orderId))) throw new HttpError(422, "not_in_manifest");
  const now = Date.now();
  await c.env.DB.batch([
    ...input.lines.map((l) => c.env.DB.prepare("UPDATE orders SET tracking_number = ?, updated_at = ? WHERE id = ?").bind(l.trackingNumber, now, l.orderId)),
    auditStmt(c.env, actorOf(c.get("member")), "tracking", "manifest", id, { lines: input.lines.length }),
  ]);
  return c.json({ ok: true });
});

/**
 * Status of a sheet. Handing it over marks every order "expédiée" (through "en préparation"
 * if needed): an order that can't (cancelled meanwhile…) is taken off the sheet and reported.
 */
logisticsRoutes.post("/manifests/:id/status", requirePermission("orders.ship"), async (c) => {
  const id = intParam(c, "id");
  const input = await body(c, z.object({ to: z.enum(["draft", "ready", "handed_over", "confirmed", "cancelled"]), handoffRef: cleanText(120).optional(), note: cleanText(300).optional() }));
  const { manifest, orders } = await loadManifest(c.env, id);
  if (!canManifestTransition(manifest.status, input.to)) throw new HttpError(409, "invalid_transition", { from: manifest.status, to: input.to });
  if ((input.to === "ready" || input.to === "handed_over") && !orders.length) throw new HttpError(422, "manifest_empty");
  const actor = actorOf(c.get("member"));
  const now = Date.now();
  const removed: { orderId: number; error: string }[] = [];
  if (input.to === "handed_over") {
    for (const o of orders) {
      try {
        if (o.status === "confirmee") await applyStatusChange(c.env, o.order_id, "en_preparation", actor, "admin", `Bordereau ${manifest.code}`);
        await applyStatusChange(c.env, o.order_id, "expediee", actor, "admin", `Remis au livreur · bordereau ${manifest.code}${input.handoffRef ? ` · ${input.handoffRef}` : ""}`);
        c.executionCtx.waitUntil(syncOrderMessage(c.env, o.order_id).catch(() => undefined));
      } catch (err) {
        removed.push({ orderId: o.order_id, error: err instanceof HttpError ? err.code : "error" });
        await c.env.DB.prepare("DELETE FROM manifest_orders WHERE manifest_id = ? AND order_id = ?").bind(id, o.order_id).run();
      }
    }
  }
  const col: Partial<Record<typeof input.to, string>> = {
    ready: "ready_at = ?",
    handed_over: "handed_at = ?, handed_by = ?",
    confirmed: "confirmed_at = ?, confirmed_by = ?",
    cancelled: "cancelled_at = ?, cancelled_by = ?",
  };
  const extra = col[input.to];
  const extraVals = input.to === "ready" ? [now] : extra ? [now, actor] : [];
  await c.env.DB.batch([
    c.env.DB.prepare(
      `UPDATE shipment_manifests SET status = ?, updated_at = ?${extra ? `, ${extra}` : ""}${input.handoffRef ? ", handoff_ref = ?" : ""}${input.note ? ", note = ?" : ""} WHERE id = ? AND status = ?`,
    ).bind(input.to, now, ...extraVals, ...(input.handoffRef ? [input.handoffRef] : []), ...(input.note ? [input.note] : []), id, manifest.status),
    auditStmt(c.env, actor, input.to, "manifest", id, { code: manifest.code, from: manifest.status, handoffRef: input.handoffRef, removed }),
  ]);
  return c.json({ ok: true, status: input.to, removed });
});

/** The sheet as CSV (Excel), for the courier or the accounts. */
logisticsRoutes.get("/manifests/:id/csv", requirePermission("orders.view"), async (c) => {
  const { manifest, orders } = await loadManifest(c.env, intParam(c, "id"));
  const esc = (v: unknown) => `"${String(v ?? "").replace(/"/g, '""')}"`;
  const rows = (orders as unknown as Record<string, unknown>[]).map((o) =>
    [o.public_code, o.tracking_number, o.name, o.phone, o.wilaya, o.commune, o.delivery_type === "bureau" ? "Bureau" : "Domicile", o.address, o.items, o.cod_amount].map(esc).join(","),
  );
  const csv = ["﻿Commande,Suivi,Cliente,Téléphone,Wilaya,Commune,Livraison,Adresse,Articles,Montant à encaisser (DA)", ...rows].join("\r\n");
  return new Response(csv, {
    headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="${manifest.code}.csv"`, "Cache-Control": "no-store" },
  });
});
