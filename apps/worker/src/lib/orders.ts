/**
 * Order engine: quotes (authoritative prices), creation (atomic stock reservation) and
 * status changes (stock effects, customer counters, loyalty). Used by the storefront,
 * the admin (manual sales, status buttons) and the Telegram bot.
 */
import {
  assessRisk,
  canTransition,
  computeTotals,
  HIGH_VALUE_DA,
  imageUrl,
  newOrderCode,
  newSecretToken,
  pointsFor,
  sha256Hex,
  stockEffect,
  type CouponRule,
  type OrderStatus,
  type OutcomeReason,
  type RiskFlag,
  type QuoteDTO,
  type QuoteLineDTO,
} from "@henine/shared";
import type { Env } from "../env";
import { activeFlash, flashPrice, imageRef, lockedSql, variantLabels, type ImageRow } from "./catalog";
import { HttpError } from "./http";
import { getSetting, getSettings } from "./settings";

/* ───────────── Quote ───────────── */

export interface QuoteRequest {
  lines: { variantId: number; qty: number }[];
  wilaya?: number | null;
  /** commune-level home price override (remote communes) */
  communeId?: number | null;
  deliveryType?: "domicile" | "bureau";
  coupon?: string;
  phone?: string;
  /** spend the customer's loyalty points on this order */
  usePoints?: boolean;
  /** admin manual sales may sell drafts / ignore desk setting */
  admin?: boolean;
}

interface VariantRow {
  id: number;
  product_id: number;
  sku: string;
  price_override: number | null;
  stock_on_hand: number;
  stock_reserved: number;
  is_active: number;
  option_value_ids: string;
  slug: string;
  name_fr: string;
  name_ar: string;
  price: number;
  category_id: number | null;
  status: string;
  locked: number;
}

export interface QuoteResult extends QuoteDTO {
  couponRow: { id: number; code: string } | null;
  /** points spent and the DA they take off (already in `discount` and `total`) */
  pointsUsed: number;
  pointsDiscount: number;
}

function couponLabel(c: CouponRule): string {
  return c.type === "percent" ? `-${c.value} %` : c.type === "fixed" ? `-${c.value} DA` : "Livraison offerte";
}

export async function quote(env: Env, req: QuoteRequest): Promise<QuoteResult> {
  // merge duplicate variants
  const merged = new Map<number, number>();
  for (const l of req.lines) merged.set(l.variantId, Math.min(20, (merged.get(l.variantId) ?? 0) + l.qty));
  const ids = [...merged.keys()];
  const ph = ids.map(() => "?").join(",");

  const flashP = activeFlash(env);
  const [variantsRes, imagesRes, wilayaRes, communeRes] = await env.DB.batch([
    env.DB.prepare(
      `SELECT v.id, v.product_id, v.sku, v.price_override, v.stock_on_hand, v.stock_reserved, v.is_active, v.option_value_ids,
              p.slug, p.name_fr, p.name_ar, p.price, p.category_id, p.status, ${lockedSql("p", Date.now())} AS locked
         FROM variants v JOIN products p ON p.id = v.product_id WHERE v.id IN (${ph})`,
    ).bind(...ids),
    env.DB.prepare(
      `SELECT * FROM product_images WHERE product_id IN (SELECT product_id FROM variants WHERE id IN (${ph})) ORDER BY product_id, sort, id`,
    ).bind(...ids),
    env.DB.prepare("SELECT home_price, desk_price, is_active, delay_days FROM wilayas WHERE code = ?").bind(req.wilaya ?? 0),
    env.DB.prepare("SELECT home_price, home_supported FROM communes WHERE id = ? AND wilaya_code = ?").bind(req.communeId ?? 0, req.wilaya ?? 0),
  ]);
  const variants = new Map((variantsRes!.results as unknown as VariantRow[]).map((v) => [v.id, v]));
  const images = imagesRes!.results as unknown as ImageRow[];
  const [labels, { byProduct: flash }] = await Promise.all([variantLabels(env, ids), flashP]);

  const lines: QuoteLineDTO[] = [];
  for (const [variantId, qty] of merged) {
    const v = variants.get(variantId);
    if (!v) continue; // unknown variant: silently dropped from the cart
    const valueIds = JSON.parse(v.option_value_ids) as number[];
    const productImages = images.filter((i) => i.product_id === v.product_id);
    const img = productImages.find((i) => i.option_value_id != null && valueIds.includes(i.option_value_id)) ?? productImages[0];
    // products of a drop that hasn't launched yet can't be ordered from the storefront
    const sellable = v.is_active === 1 && (req.admin ? v.status !== "archived" : v.status === "published" && !v.locked);
    const available = Math.max(0, v.stock_on_hand - v.stock_reserved);
    // flash sale running: the sale price (the limit is checked by activeFlash)
    const sale = flash.get(v.product_id);
    const unitPrice = sale ? flashPrice(v.price_override ?? v.price, sale.percent) : (v.price_override ?? v.price);
    lines.push({
      variantId,
      productId: v.product_id,
      slug: v.slug,
      nameFr: v.name_fr,
      nameAr: v.name_ar,
      optionsFr: labels.get(variantId)?.fr ?? "",
      optionsAr: labels.get(variantId)?.ar ?? "",
      image: img ? imageRef(env, img) : null,
      unitPrice,
      qty,
      available,
      lineTotal: unitPrice * qty,
      problem: !sellable ? "unavailable" : available === 0 ? "out_of_stock" : available < qty ? "insufficient_stock" : null,
    });
  }

  const { checkout, loyalty } = await getSettings(env, ["checkout", "loyalty"]);
  const w = (wilayaRes!.results as { home_price: number | null; desk_price: number | null; is_active: number; delay_days: string | null }[])[0];
  const commune = (communeRes!.results as { home_price: number | null; home_supported: number }[])[0];
  let shippingPrice: number | null = null;
  if (w && w.is_active) {
    if (req.deliveryType === "bureau") shippingPrice = checkout.desk_enabled || req.admin ? w.desk_price : null;
    else if (req.deliveryType === "domicile") {
      // a commune may be stop-desk only, or cost more than the rest of its wilaya
      shippingPrice = commune && !commune.home_supported ? null : (commune?.home_price ?? w.home_price);
    }
  }

  // coupon
  let couponRule: CouponRule | null = null;
  let couponRow: QuoteResult["couponRow"] = null;
  let couponInvalid: string | null = null;
  let couponScope: ((productId: number, categoryId: number | null) => boolean) | null = null;
  if (req.coupon) {
    const c = await env.DB.prepare("SELECT * FROM coupons WHERE code = ?").bind(req.coupon.toUpperCase()).first<{
      id: number; code: string; type: CouponRule["type"]; value: number; min_subtotal: number | null; is_active: number;
      starts_at: number | null; ends_at: number | null; usage_limit: number | null; used_count: number;
      wilaya_codes: string | null; first_order_only: number; per_customer_limit: number | null; applies_to: string | null;
    }>();
    const now = Date.now();
    if (!c || !c.is_active) couponInvalid = "unknown";
    else if ((c.starts_at && c.starts_at > now) || (c.ends_at && c.ends_at < now)) couponInvalid = "expired";
    else if (c.usage_limit != null && c.used_count >= c.usage_limit) couponInvalid = "exhausted";
    else if (c.wilaya_codes && req.wilaya && !(JSON.parse(c.wilaya_codes) as number[]).includes(req.wilaya)) couponInvalid = "wilaya";
    else if (req.phone && (c.first_order_only || c.per_customer_limit)) {
      const used = await env.DB.prepare(
        "SELECT (SELECT orders_count FROM customers WHERE phone = ?1) AS orders, (SELECT COUNT(*) FROM orders WHERE phone = ?1 AND coupon_code = ?2 AND status NOT IN ('annulee','doublon','fausse')) AS uses",
      )
        .bind(req.phone, c.code)
        .first<{ orders: number | null; uses: number }>();
      if (c.first_order_only && (used?.orders ?? 0) > 0) couponInvalid = "first_order_only";
      else if (c.per_customer_limit && (used?.uses ?? 0) >= c.per_customer_limit) couponInvalid = "already_used";
    }
    if (c && !couponInvalid) {
      // limited to some products / categories: only their lines get the discount
      const scope = JSON.parse(c.applies_to ?? "null") as { productIds?: number[]; categoryIds?: number[] } | null;
      const productIds = scope?.productIds ?? [];
      const categoryIds = scope?.categoryIds ?? [];
      if (productIds.length || categoryIds.length) {
        couponScope = (productId, categoryId) => productIds.includes(productId) || (categoryId != null && categoryIds.includes(categoryId));
      }
      couponRule = { code: c.code, type: c.type, value: c.value, minSubtotal: c.min_subtotal, restricted: !!couponScope };
      couponRow = { id: c.id, code: c.code };
    }
  }

  const priced = lines.filter((l) => l.problem !== "unavailable");
  const totals = computeTotals({
    lines: priced.map((l) => ({
      unitPrice: l.unitPrice,
      qty: l.qty,
      eligible: couponScope ? couponScope(l.productId, variants.get(l.variantId)?.category_id ?? null) : true,
    })),
    shippingPrice,
    coupon: couponRule,
    freeShippingOver: checkout.free_shipping_over,
  });
  if (couponRule && !totals.couponApplied) {
    couponInvalid = totals.couponReason;
    couponRow = null;
  }

  // Loyalty: points pay part of the items (never the delivery), from `min_redeem` points up
  let points: QuoteDTO["points"] = null;
  let pointsUsed = 0;
  let pointsDiscount = 0;
  if (loyalty.enabled && req.phone && loyalty.redeem_value_da > 0) {
    const cust = await env.DB.prepare("SELECT points_balance FROM customers WHERE phone = ?").bind(req.phone).first<{ points_balance: number }>();
    const balance = cust?.points_balance ?? 0;
    if (balance >= loyalty.min_redeem) {
      const usable = Math.min(balance, Math.floor(Math.max(0, totals.subtotal - totals.discount) / loyalty.redeem_value_da));
      const applied = !!req.usePoints && usable > 0;
      if (applied) {
        pointsUsed = usable;
        pointsDiscount = usable * loyalty.redeem_value_da;
      }
      points = { balance, usable, value: usable * loyalty.redeem_value_da, applied };
    }
  }

  return {
    lines,
    subtotal: totals.subtotal,
    discount: totals.discount + pointsDiscount,
    shipping: totals.shipping,
    total: totals.total - pointsDiscount,
    points,
    pointsUsed,
    pointsDiscount,
    freeShipping: totals.freeShipping,
    deliveryAvailable: shippingPrice != null,
    delay: w?.is_active ? w.delay_days : null,
    coupon: req.coupon
      ? { code: req.coupon.toUpperCase(), valid: !couponInvalid, reason: couponInvalid, label: couponRule && !couponInvalid ? couponLabel(couponRule) : null }
      : null,
    couponRow,
  };
}

/* ───────────── Create ───────────── */

export interface NewOrder {
  idempotencyKey: string;
  name: string;
  phone: string;
  wilaya: number;
  communeId: number | null;
  communeText?: string;
  deliveryType: "domicile" | "bureau";
  stopDeskId?: number | null;
  address?: string;
  note?: string;
  coupon?: string;
  usePoints?: boolean;
  lines: { variantId: number; qty: number }[];
  channel: "web" | "express" | "instagram" | "whatsapp" | "boutique" | "telephone";
  locale: "fr" | "ar";
  utm?: { source?: string; medium?: string; campaign?: string };
  ipHash?: string;
  uaShort?: string;
  /** checkout autosave to mark as recovered */
  cartId?: string;
  /** admin manual sale: initial status + actor */
  initialStatus?: "nouvelle" | "confirmee" | "livree";
  actor?: string;
  internalNote?: string;
  shippingOverride?: number;
}

export interface CreatedOrder {
  id: number;
  code: string;
  token: string;
  total: number;
  status: OrderStatus;
}

export async function createOrder(env: Env, input: NewOrder): Promise<CreatedOrder> {
  const isAdmin = !!input.actor;
  const q = await quote(env, {
    lines: input.lines,
    wilaya: input.wilaya,
    communeId: input.communeId,
    deliveryType: input.deliveryType,
    coupon: input.coupon,
    phone: input.phone,
    usePoints: input.usePoints,
    admin: isAdmin,
  });
  const bad = q.lines.filter((l) => l.problem);
  if (!q.lines.length || bad.length) throw new HttpError(409, "stock_problem", { lines: bad.map((l) => ({ variantId: l.variantId, problem: l.problem, available: l.available })) });
  if (q.coupon && !q.coupon.valid) throw new HttpError(422, "coupon_invalid", { reason: q.coupon.reason });
  const shipping = input.shippingOverride ?? q.shipping;
  if (shipping == null) throw new HttpError(422, "delivery_unavailable");
  const total = q.subtotal - q.discount + shipping;

  // Storefront only: abuse limit + risk signals. The score is decision support for the team;
  // it never rejects an order (only the per-phone hourly limit does, against floods).
  let risk = 0;
  let riskFlags: RiskFlag[] | null = null;
  if (!isAdmin) {
    const { checkout } = await getSettings(env, ["checkout"]);
    const t = Date.now();
    const r = await env.DB.prepare(
      `SELECT (SELECT COUNT(*) FROM orders WHERE phone = ?1 AND created_at > ?2) AS last_hour,
              (SELECT COUNT(*) FROM orders WHERE phone = ?1 AND created_at > ?3 AND status NOT IN ${CANCELLED_SQL}) AS last_day,
              (SELECT COUNT(*) FROM orders WHERE phone = ?1 AND created_at > ?4 AND status IN ('annulee','fausse')) AS recent_cancel,
              (SELECT COUNT(DISTINCT phone) FROM orders WHERE ip_hash = ?5 AND created_at > ?6 AND phone != ?1) AS ip_phones,
              c.delivered_count, c.returned_count, c.cancelled_count, c.fake_count, c.is_blacklisted
         FROM (SELECT 1) LEFT JOIN customers c ON c.phone = ?1`,
    )
      .bind(input.phone, t - 3600_000, t - 86400_000, t - 7 * 86400_000, input.ipHash ?? "", t - 2 * 3600_000)
      .first<{
        last_hour: number; last_day: number; recent_cancel: number; ip_phones: number;
        delivered_count: number | null; returned_count: number | null; cancelled_count: number | null; fake_count: number | null; is_blacklisted: number | null;
      }>();
    if ((r?.last_hour ?? 0) >= checkout.max_orders_per_phone_per_hour) throw new HttpError(429, "too_many_orders");
    riskFlags = [];
    if (r?.recent_cancel) riskFlags.push("recent_cancel");
    if (r?.last_day) riskFlags.push("repeat_24h");
    // mobile operators share public IPs (CGNAT): only many different numbers in a short window count
    if (input.ipHash && (r?.ip_phones ?? 0) >= 3) riskFlags.push("ip_burst");
    if (input.communeId == null && input.communeText) riskFlags.push("commune_text");
    if (total >= HIGH_VALUE_DA) riskFlags.push("high_value");
    risk = assessRisk(
      {
        deliveredCount: r?.delivered_count ?? 0, returnedCount: r?.returned_count ?? 0, cancelledCount: r?.cancelled_count ?? 0,
        fakeCount: r?.fake_count ?? 0, isBlacklisted: !!r?.is_blacklisted,
      },
      riskFlags,
    ).score;
  }

  const status: OrderStatus = input.initialStatus ?? "nouvelle";
  const token = newSecretToken();
  const tokenHash = await sha256Hex(token, env.TRACK_TOKEN_PEPPER);
  const now = Date.now();
  const actor = input.actor ?? "customer";

  for (let attempt = 0; attempt < 2; attempt++) {
    const code = newOrderCode();
    const orderRef = `(SELECT id FROM orders WHERE public_code = '${code}')`; // code is [0-9A-Z-] only
    const stmts: D1PreparedStatement[] = [
      env.DB.prepare(
        `INSERT INTO customers (phone, name, wilaya_code, commune_id, address, orders_count, first_order_at, last_order_at, created_at)
         VALUES (?, ?, ?, ?, ?, 1, ?, ?, ?)
         ON CONFLICT(phone) DO UPDATE SET name = excluded.name, wilaya_code = excluded.wilaya_code, commune_id = excluded.commune_id,
           address = COALESCE(excluded.address, customers.address), orders_count = customers.orders_count + 1, last_order_at = excluded.last_order_at`,
      ).bind(input.phone, input.name, input.wilaya, input.communeId, input.address ?? null, now, now, now),
      env.DB.prepare(
        `INSERT INTO orders (public_code, track_token_hash, idempotency_key, status, channel, locale, customer_id, name, phone, wilaya_code,
            commune_id, commune_text, delivery_type, stop_desk_id, address, subtotal, discount_total, shipping_price, total, coupon_code, points_used,
            customer_note, internal_note, risk_score, risk_flags, utm_source, utm_medium, utm_campaign, ip_hash, ua_short, created_at, updated_at,
            confirmed_at, delivered_at)
         VALUES (?, ?, ?, ?, ?, ?, (SELECT id FROM customers WHERE phone = ?), ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ).bind(
        code, tokenHash, input.idempotencyKey, status, input.channel, input.locale, input.phone, input.name, input.phone, input.wilaya,
        input.communeId, input.communeText ?? null, input.deliveryType, input.stopDeskId ?? null, input.address ?? null,
        q.subtotal, q.discount, shipping, total, q.couponRow?.code ?? null, q.pointsUsed, input.note ?? null, input.internalNote ?? null, risk,
        riskFlags ? JSON.stringify(riskFlags) : null,
        input.utm?.source ?? null, input.utm?.medium ?? null, input.utm?.campaign ?? null, input.ipHash ?? null, input.uaShort ?? null,
        now, now, status === "confirmee" || status === "livree" ? now : null, status === "livree" ? now : null,
      ),
    ];
    for (const l of q.lines) {
      const img = l.image ? imageUrl(l.image, 480) : null;
      stmts.push(
        env.DB.prepare(
          `INSERT INTO order_items (order_id, variant_id, product_id, name_fr, name_ar, sku, options_label, image, unit_price, qty)
           VALUES (${orderRef}, ?, ?, ?, ?, (SELECT sku FROM variants WHERE id = ?), ?, ?, ?, ?)`,
        ).bind(l.variantId, l.productId, l.nameFr, l.nameAr, l.variantId, l.optionsFr || null, img, l.unitPrice, l.qty),
      );
      if (status === "livree") {
        // sold on the spot (boutique): stock leaves immediately
        stmts.push(
          env.DB.prepare("UPDATE variants SET stock_on_hand = stock_on_hand - ?, updated_at = ? WHERE id = ?").bind(l.qty, now, l.variantId),
          env.DB.prepare(
            `INSERT INTO stock_movements (variant_id, delta, reason, order_id, actor, created_at) VALUES (?, ?, 'vente', ${orderRef}, ?, ?)`,
          ).bind(l.variantId, -l.qty, actor, now),
        );
      } else {
        // the CHECK constraint on variants aborts the whole batch if this would oversell
        stmts.push(
          env.DB.prepare("UPDATE variants SET stock_reserved = stock_reserved + ?, updated_at = ? WHERE id = ?").bind(l.qty, now, l.variantId),
          env.DB.prepare(
            `INSERT INTO stock_movements (variant_id, delta, reason, order_id, actor, created_at) VALUES (?, ?, 'reservation', ${orderRef}, ?, ?)`,
          ).bind(l.variantId, -l.qty, actor, now),
        );
      }
    }
    stmts.push(
      env.DB.prepare(
        `INSERT INTO order_events (order_id, from_status, to_status, kind, actor, source, note, created_at) VALUES (${orderRef}, NULL, ?, 'status', ?, ?, ?, ?)`,
      ).bind(status, actor, isAdmin ? "admin" : "customer", input.channel === "express" ? "Commande express" : null, now),
    );
    if (q.couponRow) stmts.push(env.DB.prepare("UPDATE coupons SET used_count = used_count + 1 WHERE id = ?").bind(q.couponRow.id));
    if (q.pointsUsed > 0) {
      stmts.push(
        env.DB.prepare("UPDATE customers SET points_balance = MAX(points_balance - ?, 0) WHERE phone = ?").bind(q.pointsUsed, input.phone),
        env.DB.prepare(
          `INSERT INTO loyalty_ledger (customer_id, delta, reason, order_id, actor, note, created_at) VALUES ((SELECT id FROM customers WHERE phone = ?), ?, 'redeem', ${orderRef}, ?, ?, ?)`,
        ).bind(input.phone, -q.pointsUsed, actor, `−${q.pointsDiscount} DA`, now),
      );
    }
    if (input.cartId) {
      stmts.push(
        env.DB.prepare(`UPDATE carts SET recovered_order_id = ${orderRef}, step = 'ready', updated_at = ? WHERE id = ? AND recovered_order_id IS NULL`).bind(
          now, input.cartId,
        ),
      );
    }
    if (status === "livree") {
      stmts.push(
        env.DB.prepare("UPDATE customers SET delivered_count = delivered_count + 1, total_spent = total_spent + ? WHERE phone = ?").bind(total, input.phone),
      );
    }
    stmts.push(
      env.DB.prepare(`INSERT INTO outbox (kind, payload, next_attempt_at, created_at) VALUES ('telegram', json_object('type', 'new_order', 'code', ?), ?, ?)`).bind(
        code, now, now,
      ),
      ...analyticsStmts(env, now, [
        ["orders", ""],
        ["orders_wilaya", String(input.wilaya)],
        ["orders_channel", input.channel],
        ["orders_hour", String(new Date(now + 3600_000).getUTCHours())], // Africa/Algiers = UTC+1
      ], 1),
      ...analyticsStmts(env, now, [["revenue", ""]], total),
    );

    try {
      await env.DB.batch(stmts);
      const row = await env.DB.prepare("SELECT id FROM orders WHERE public_code = ?").bind(code).first<{ id: number }>();
      return { id: row!.id, code, token, total, status };
    } catch (err) {
      const msg = String((err as Error).message ?? err);
      if (msg.includes("variants_stock_ok")) {
        const again = await quote(env, { lines: input.lines, wilaya: input.wilaya, deliveryType: input.deliveryType, admin: isAdmin });
        throw new HttpError(409, "stock_problem", {
          lines: again.lines.filter((l) => l.problem || l.available < l.qty).map((l) => ({ variantId: l.variantId, problem: l.problem ?? "insufficient_stock", available: l.available })),
        });
      }
      if (msg.includes("coupons_usage_ok")) throw new HttpError(422, "coupon_invalid", { reason: "exhausted" });
      if (msg.includes("orders.idempotency_key")) {
        const existing = await env.DB.prepare("SELECT public_code, total, status FROM orders WHERE idempotency_key = ?").bind(input.idempotencyKey).first<{ public_code: string; total: number; status: OrderStatus }>();
        throw new HttpError(409, "duplicate_order", existing ? { code: existing.public_code } : undefined);
      }
      if (msg.includes("orders.public_code") && attempt === 0) continue; // astronomically rare collision
      throw err;
    }
  }
  throw new HttpError(500, "order_failed");
}

/** Local date in Africa/Algiers (UTC+1, no DST). */
export function algiersDate(ts = Date.now()): string {
  return new Date(ts + 3600_000).toISOString().slice(0, 10);
}

/** Midnight (Africa/Algiers) of the day containing `ts`, as epoch ms. */
export function algiersDayStart(ts = Date.now()): number {
  const d = new Date(ts + 3600_000);
  d.setUTCHours(0, 0, 0, 0);
  return d.getTime() - 3600_000;
}

/** SQL lists used everywhere so cancelled orders never count as sales. */
export const CANCELLED_SQL = "('annulee','doublon','fausse')";
export const CONFIRMED_PLUS_SQL = "('confirmee','en_preparation','expediee','en_livraison','livree','retour','retour_recu')";

export interface PeriodStats {
  orders: number; // excluding cancelled
  revenue: number; // excluding cancelled
  confirmed: number; // reached "confirmée" or later
  cancelled: number;
  delivered: number;
  returned: number;
  pending: number; // still to confirm
  discount: number; // coupon discounts granted (excluding cancelled)
  deliveredRevenue: number; // cash actually collected (delivered orders)
  confirmRate: number | null; // confirmed / (confirmed + cancelled)
}

/** Order statistics computed from real statuses (not from creation-time counters). */
export async function periodStats(env: Env, since: number, until = Date.now() + 1): Promise<PeriodStats> {
  const r = await env.DB.prepare(
    `SELECT
       SUM(CASE WHEN status NOT IN ${CANCELLED_SQL} THEN 1 ELSE 0 END) AS orders,
       COALESCE(SUM(CASE WHEN status NOT IN ${CANCELLED_SQL} THEN total ELSE 0 END), 0) AS revenue,
       SUM(CASE WHEN status IN ${CONFIRMED_PLUS_SQL} THEN 1 ELSE 0 END) AS confirmed,
       SUM(CASE WHEN status IN ${CANCELLED_SQL} THEN 1 ELSE 0 END) AS cancelled,
       SUM(CASE WHEN status = 'livree' THEN 1 ELSE 0 END) AS delivered,
       SUM(CASE WHEN status IN ('retour','retour_recu') THEN 1 ELSE 0 END) AS returned,
       SUM(CASE WHEN status IN ('nouvelle','injoignable') THEN 1 ELSE 0 END) AS pending,
       COALESCE(SUM(CASE WHEN status NOT IN ${CANCELLED_SQL} THEN discount_total ELSE 0 END), 0) AS discount,
       COALESCE(SUM(CASE WHEN status = 'livree' THEN total ELSE 0 END), 0) AS deliveredRevenue
     FROM orders WHERE created_at >= ? AND created_at < ?`,
  )
    .bind(since, until)
    .first<Record<keyof Omit<PeriodStats, "confirmRate">, number | null>>();
  const n = (k: keyof Omit<PeriodStats, "confirmRate">) => r?.[k] ?? 0;
  const decided = n("confirmed") + n("cancelled");
  return {
    orders: n("orders"),
    revenue: n("revenue"),
    confirmed: n("confirmed"),
    cancelled: n("cancelled"),
    delivered: n("delivered"),
    returned: n("returned"),
    pending: n("pending"),
    discount: n("discount"),
    deliveredRevenue: n("deliveredRevenue"),
    confirmRate: decided ? Math.round((n("confirmed") / decided) * 100) : null,
  };
}

export function analyticsStmts(env: Env, ts: number, metrics: [string, string][], value: number) {
  const date = algiersDate(ts);
  return metrics.map(([metric, dim]) =>
    env.DB.prepare(
      "INSERT INTO analytics_daily (date, metric, dim, value) VALUES (?, ?, ?, ?) ON CONFLICT(date, metric, dim) DO UPDATE SET value = value + excluded.value",
    ).bind(date, metric, dim, value),
  );
}

/* ───────────── Status changes ───────────── */

/** Statuses that record an outcome reason (why it was cancelled / returned). */
export const OUTCOME_STATUSES: readonly OrderStatus[] = ["annulee", "doublon", "fausse", "retour"];

const TIMESTAMP_COL: Partial<Record<OrderStatus, string>> = {
  confirmee: "confirmed_at",
  expediee: "shipped_at",
  livree: "delivered_at",
  retour: "returned_at",
};

export interface StatusChangeResult {
  id: number;
  code: string;
  from: OrderStatus;
  to: OrderStatus;
  pointsEarned: number;
}

export async function applyStatusChange(
  env: Env,
  orderId: number,
  to: OrderStatus,
  actor: string,
  source: "admin" | "telegram" | "carrier" | "system" | "customer",
  note?: string,
  reason?: OutcomeReason,
): Promise<StatusChangeResult> {
  const order = await env.DB.prepare("SELECT id, public_code, status, customer_id, total, points_used FROM orders WHERE id = ?")
    .bind(orderId)
    .first<{ id: number; public_code: string; status: OrderStatus; customer_id: number; total: number; points_used: number }>();
  if (!order) throw new HttpError(404, "order_not_found");
  const from = order.status;
  if (!canTransition(from, to)) throw new HttpError(409, "invalid_transition", { from, to });

  const { results: items } = await env.DB.prepare("SELECT variant_id, qty FROM order_items WHERE order_id = ? AND variant_id IS NOT NULL")
    .bind(orderId)
    .all<{ variant_id: number; qty: number }>();

  const now = Date.now();
  // every follow-up statement only applies if *this* request won the status update
  const nonce = [...crypto.getRandomValues(new Uint8Array(12))].map((b) => b.toString(16).padStart(2, "0")).join("");
  const guard = `(SELECT op_nonce FROM orders WHERE id = ${orderId}) = '${nonce}'`;
  const tsCol = TIMESTAMP_COL[to];
  // outcome reason: set when cancelled / returned, kept through "retour reçu", cleared when reopened
  const outcome = OUTCOME_STATUSES.includes(to) ? (reason ?? (to === "doublon" ? "duplicate" : null)) : to === "nouvelle" ? null : undefined;

  const stmts: D1PreparedStatement[] = [
    env.DB.prepare(
      `UPDATE orders SET status = ?, op_nonce = ?, updated_at = ?${tsCol ? `, ${tsCol} = COALESCE(${tsCol}, ?)` : ""}${to === "injoignable" ? ", confirm_attempts = confirm_attempts + 1, next_callback_at = ?" : ""}${to === "confirmee" ? ", next_callback_at = NULL" : ""}${outcome !== undefined ? ", outcome_reason = ?" : ""}
        WHERE id = ? AND status = ?`,
    ).bind(
      ...[to, nonce, now, ...(tsCol ? [now] : []), ...(to === "injoignable" ? [now + 2 * 3600_000] : []), ...(outcome !== undefined ? [outcome] : []), orderId, from],
    ),
  ];

  const effect = stockEffect(from, to);
  for (const it of items) {
    if (effect === "reserve") {
      stmts.push(env.DB.prepare(`UPDATE variants SET stock_reserved = stock_reserved + ? WHERE id = ? AND ${guard}`).bind(it.qty, it.variant_id));
    } else if (effect === "release") {
      stmts.push(env.DB.prepare(`UPDATE variants SET stock_reserved = MAX(stock_reserved - ?, 0) WHERE id = ? AND ${guard}`).bind(it.qty, it.variant_id));
    } else if (effect === "commit") {
      stmts.push(
        env.DB.prepare(`UPDATE variants SET stock_on_hand = stock_on_hand - ?, stock_reserved = MAX(stock_reserved - ?, 0) WHERE id = ? AND ${guard}`).bind(
          it.qty, it.qty, it.variant_id,
        ),
      );
    } else if (effect === "restock") {
      stmts.push(env.DB.prepare(`UPDATE variants SET stock_on_hand = stock_on_hand + ? WHERE id = ? AND ${guard}`).bind(it.qty, it.variant_id));
    }
    if (effect) {
      const reason = { reserve: "reservation", release: "liberation", commit: "vente", restock: "retour" }[effect];
      const delta = effect === "reserve" || effect === "commit" ? -it.qty : it.qty;
      stmts.push(
        env.DB.prepare(`INSERT INTO stock_movements (variant_id, delta, reason, order_id, actor, created_at) SELECT ?, ?, ?, ?, ?, ? WHERE ${guard}`).bind(
          it.variant_id, delta, reason, orderId, actor, now,
        ),
      );
    }
  }

  stmts.push(
    env.DB.prepare(
      `INSERT INTO order_events (order_id, from_status, to_status, kind, actor, source, note, created_at) SELECT ?, ?, ?, 'status', ?, ?, ?, ? WHERE ${guard}`,
    ).bind(orderId, from, to, actor, source, note ?? null, now),
  );

  if (to === "livree") {
    stmts.push(
      env.DB.prepare(`UPDATE customers SET delivered_count = delivered_count + 1, total_spent = total_spent + ? WHERE id = ? AND ${guard}`).bind(order.total, order.customer_id),
    );
  } else if (to === "retour") {
    stmts.push(env.DB.prepare(`UPDATE customers SET returned_count = returned_count + 1 WHERE id = ? AND ${guard}`).bind(order.customer_id));
  } else if (to === "annulee" || to === "doublon" || to === "fausse") {
    // cancelled orders don't count as orders (history, loyalty, "first order" coupons, Telegram badges)
    stmts.push(
      env.DB.prepare(
        `UPDATE customers SET cancelled_count = cancelled_count + 1, orders_count = MAX(orders_count - 1, 0)${to === "fausse" ? ", fake_count = fake_count + 1" : ""} WHERE id = ? AND ${guard}`,
      ).bind(order.customer_id),

    );
  } else if (from === "annulee" && to === "nouvelle") {
    stmts.push(
      env.DB.prepare(`UPDATE customers SET cancelled_count = MAX(cancelled_count - 1, 0), orders_count = orders_count + 1 WHERE id = ? AND ${guard}`).bind(order.customer_id),
    );
  }

  // points spent on an order that won't be paid come back; reopening spends them again
  const undone = (s: OrderStatus) => s === "annulee" || s === "doublon" || s === "fausse" || s === "retour" || s === "retour_recu";
  if (order.points_used > 0 && undone(to) !== undone(from)) {
    const delta = undone(to) ? order.points_used : -order.points_used;
    stmts.push(
      env.DB.prepare(`UPDATE customers SET points_balance = MAX(points_balance + ?, 0) WHERE id = ? AND ${guard}`).bind(delta, order.customer_id),
      env.DB.prepare(
        `INSERT INTO loyalty_ledger (customer_id, delta, reason, order_id, actor, note, created_at) SELECT ?, ?, ?, ?, ?, ?, ? WHERE ${guard}`,
      ).bind(order.customer_id, delta, delta > 0 ? "reversal" : "redeem", orderId, actor, delta > 0 ? "points rendus (commande annulée / retour)" : "points de nouveau utilisés", now),
    );
  }

  let pointsEarned = 0;
  if (to === "livree") {
    const loyalty = await getSetting(env, "loyalty");
    if (loyalty.enabled) {
      pointsEarned = pointsFor(order.total, loyalty.points_per_100da);
      if (pointsEarned > 0) {
        stmts.push(
          env.DB.prepare(`UPDATE customers SET points_balance = points_balance + ? WHERE id = ? AND ${guard}`).bind(pointsEarned, order.customer_id),
          env.DB.prepare(`UPDATE orders SET points_earned = ? WHERE id = ? AND ${guard}`).bind(pointsEarned, orderId),
          env.DB.prepare(
            `INSERT INTO loyalty_ledger (customer_id, delta, reason, order_id, actor, created_at) SELECT ?, ?, 'order', ?, ?, ? WHERE ${guard}`,
          ).bind(order.customer_id, pointsEarned, orderId, actor, now),
        );
      }
    }
    stmts.push(...analyticsStmts(env, now, [["delivered", ""]], 1));
  }
  if (to === "confirmee") stmts.push(...analyticsStmts(env, now, [["confirmed", ""]], 1));
  if (to === "retour") stmts.push(...analyticsStmts(env, now, [["returned", ""]], 1));

  let results: D1Result[];
  try {
    results = await env.DB.batch(stmts);
  } catch (err) {
    if (String((err as Error).message).includes("variants_stock_ok")) throw new HttpError(409, "stock_insufficient");
    throw err;
  }
  if (!results[0]!.meta.changes) throw new HttpError(409, "status_changed_meanwhile");
  return { id: orderId, code: order.public_code, from, to, pointsEarned };
}
