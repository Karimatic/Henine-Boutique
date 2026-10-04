import { Hono, type Context } from "hono";
import {
  assistantInput,
  cartSaveInput,
  cleanText,
  CUSTOMER_CANCEL_REASONS,
  DEFAULT_BOUTIQUE,
  experimentEventInput,
  type ExperimentDTO,
  clientErrorInput,
  contactInput,
  createOrderInput,
  formatFollowers,
  maskDzPhone,
  pushSubscribeInput,
  quoteInput,
  reviewInput,
  sha256Hex,
  stockAlertInput,
  timingSafeEqual,
  trackLookupInput,
  type CommuneDTO,
  type ActivityDTO,
  type CreatedOrderDTO,
  type LinkDTO,
  type PageDTO,
  type ReviewWallDTO,
  type SiteConfigDTO,
  type TrackedOrderDTO,
} from "@henine/shared";
import type { AppEnv } from "../env";
import { recordError } from "../lib/audit";
import { answer } from "../lib/assistant-intents";
import { activeFlash, featuredDrop, getCollection, getProductDetail, imageRef, listCategories, listProductCards, reviewPhotos, variantLabels, type ImageRow } from "../lib/catalog";
import { cached } from "../lib/edge-cache";
import { body, clientIp, HttpError, ipHash, rateLimit, uaShort, validate, verifyTurnstile } from "../lib/http";
import { designOut, putImage } from "../lib/media";
import { applyStatusChange, createOrder, quote } from "../lib/orders";
import { bumpCatalogStmt, getSetting, getSettings } from "../lib/settings";
import { notifyNewOrder, sendTelegramText, syncOrderMessage } from "../lib/telegram";
import { isPushEndpoint, sendRestockPushes, vapidKeys } from "../lib/webpush";
import { z } from "zod";

export const publicRoutes = new Hono<AppEnv>();

/**
 * Edge cache keyed on the catalogue version (admin edits are visible immediately) and on
 * how many drop start/end times have passed (a drop's products appear the moment it launches).
 */
async function versioned(c: Context<AppEnv>, ttl: number, produce: () => Promise<Response>) {
  const { catalog_version: v, drop_times: drops } = await getSettings(c.env, ["catalog_version", "drop_times"]);
  const now = Date.now();
  const url = new URL(c.req.url);
  url.searchParams.set("__v", `${v}.${drops.filter((t) => t <= now).length}`);
  return cached(new Request(url), c.executionCtx, ttl, produce);
}

publicRoutes.get("/health", async (c) => {
  const row = await c.env.DB.prepare("SELECT count(*) AS n FROM wilayas").first<{ n: number }>();
  return c.json({ ok: true, env: c.env.ENVIRONMENT, wilayas: row?.n ?? 0, time: Date.now() });
});

/* ───────── Site config ───────── */

publicRoutes.get("/site", (c) =>
  versioned(c, 300, async () => {
    const [s, drop, flash, experiments] = await Promise.all([
      getSettings(c.env, ["store", "announcement", "contact", "checkout", "maintenance", "texts", "design", "boutique", "instagram"]),
      featuredDrop(c.env),
      activeFlash(c.env),
      runningExperiments(c),
    ]);
    const dto: SiteConfigDTO = {
      store: { name: s.store.name },
      announcement: { active: s.announcement.active },
      contact: {
        phone: s.contact.phone, whatsapp: s.contact.whatsapp, instagram: s.contact.instagram, tiktok: s.contact.tiktok,
        facebook: s.contact.facebook, maps: s.contact.maps,
        // the real count when Instagram is connected (daily), otherwise what the shop wrote
        followers: s.instagram.followers != null ? formatFollowers(s.instagram.followers) : s.contact.followers,
      },
      // quick order on the product page: always on
      checkout: { freeShippingOver: s.checkout.free_shipping_over, expressOnProduct: true, deskEnabled: s.checkout.desk_enabled },
      turnstileSiteKey: c.env.TURNSTILE_SITE_KEY,
      maintenance: { active: s.maintenance.active },
      texts: { ar: s.texts.ar ?? {}, fr: s.texts.fr ?? {} },
      drop,
      flash: flash.sales[0] ?? null,
      design: designOut(c.env, s.design),
      boutique: { ...DEFAULT_BOUTIQUE, ...s.boutique },
      experiments,
    };
    return c.json(dto);
  }),
);

/** A/B tests running now (none if the table isn't there yet: older database). */
async function runningExperiments(c: Context<AppEnv>): Promise<ExperimentDTO[]> {
  try {
    const { results } = await c.env.DB.prepare("SELECT id, kind, config FROM experiments WHERE status = 'running' ORDER BY id").all<{ id: number; kind: ExperimentDTO["kind"]; config: string }>();
    return results.map((r) => ({ id: r.id, kind: r.kind, config: JSON.parse(r.config) as ExperimentDTO["config"] }));
  } catch {
    return [];
  }
}

/**
 * A/B test step (seen → product → checkout → order), sent once per visitor and day by the
 * page. One small counter row per test, version, step and day.
 */
publicRoutes.post("/ab", async (c) => {
  await rateLimit(c.env.RL_LOOKUP, `ab:${clientIp(c)}`);
  const input = await body(c, experimentEventInput);
  const day = new Date(Date.now() + 3600_000).toISOString().slice(0, 10);
  await c.env.DB.prepare(
    `INSERT INTO experiment_stats (experiment_id, variant, event, day, n)
     SELECT ?1, ?2, ?3, ?4, 1 WHERE EXISTS (SELECT 1 FROM experiments WHERE id = ?1 AND status = 'running')
     ON CONFLICT(experiment_id, variant, event, day) DO UPDATE SET n = n + 1`,
  )
    .bind(input.id, input.variant, input.event, day)
    .run();
  return c.json({ ok: true });
});

/* ───────── Catalogue ───────── */

publicRoutes.get("/catalog", (c) => versioned(c, 120, async () => c.json(await listProductCards(c.env))));

publicRoutes.get("/categories", (c) => versioned(c, 600, async () => c.json(await listCategories(c.env))));

publicRoutes.get("/products/:slug", (c) =>
  versioned(c, 120, async () => {
    const p = await getProductDetail(c.env, c.req.param("slug"));
    return p ? c.json(p) : c.json({ error: "not_found" }, 404);
  }),
);

/** Collection / drop page. The payload is edge-cached; `now` is always fresh for the countdown. */
publicRoutes.get("/collections/:slug", async (c) => {
  const res = await versioned(c, 30, async () => {
    const col = await getCollection(c.env, c.req.param("slug"));
    return col ? c.json(col) : c.json({ error: "not_found" }, 404);
  });
  if (!res.ok) return res;
  const data = (await res.json()) as Record<string, unknown>;
  return c.json({ ...data, now: Date.now() }, 200, { "Cache-Control": "no-cache" });
});

publicRoutes.get("/pages/:slug", (c) =>
  versioned(c, 600, async () => {
    const p = await c.env.DB.prepare("SELECT slug, title_fr, title_ar, body_fr, body_ar FROM pages WHERE slug = ? AND is_active = 1")
      .bind(c.req.param("slug"))
      .first<{ slug: string; title_fr: string; title_ar: string; body_fr: string; body_ar: string }>();
    if (!p) return c.json({ error: "not_found" }, 404);
    const dto: PageDTO = { slug: p.slug, titleFr: p.title_fr, titleAr: p.title_ar, bodyFr: p.body_fr, bodyAr: p.body_ar };
    return c.json(dto);
  }),
);

publicRoutes.get("/links", (c) =>
  versioned(c, 600, async () => {
    const { results } = await c.env.DB.prepare(
      "SELECT id, label_fr, label_ar, target, icon FROM links WHERE kind = 'bio' AND is_active = 1 ORDER BY sort, id",
    ).all<{ id: number; label_fr: string | null; label_ar: string | null; target: string; icon: string | null }>();
    return c.json(results.map((l): LinkDTO => ({ id: l.id, labelFr: l.label_fr, labelAr: l.label_ar, target: l.target, icon: l.icon })));
  }),
);

/* ───────── Geography ───────── */

publicRoutes.get("/geo/wilayas", (c) =>
  versioned(c, 600, async () => {
    const { results } = await c.env.DB.prepare(
      "SELECT code, name_fr AS fr, name_ar AS ar, home_price AS home, desk_price AS desk, delay_days AS delay FROM wilayas WHERE is_active = 1 ORDER BY sort, code",
    ).all();
    return c.json(results);
  }),
);

publicRoutes.get("/geo/wilayas/:code/communes", (c) => {
  const code = Number(c.req.param("code"));
  if (!Number.isInteger(code) || code < 1 || code > 69) return c.json({ error: "invalid_wilaya" }, 400);
  return versioned(c, 3600, async () => {
    const { results } = await c.env.DB.prepare(
      "SELECT id, name_fr, name_ar, home_price, home_supported FROM communes WHERE wilaya_code = ? AND is_active = 1 ORDER BY name_fr",
    )
      .bind(code)
      .all<{ id: number; name_fr: string; name_ar: string; home_price: number | null; home_supported: number }>();
    return c.json(results.map((r): CommuneDTO => ({ id: r.id, fr: r.name_fr, ar: r.name_ar, home: r.home_price, homeOk: !!r.home_supported })));
  });
});

/* ───────── Checkout ───────── */

publicRoutes.post("/quote", async (c) => {
  await rateLimit(c.env.RL_LOOKUP, `quote:${clientIp(c)}`);
  const input = await body(c, quoteInput);
  const { couponRow: _, pointsUsed: __, pointsDiscount: ___, ...dto } = await quote(c.env, input);
  return c.json(dto);
});

publicRoutes.post("/orders", async (c) => {
  await rateLimit(c.env.RL_WRITE, `order:${clientIp(c)}`);
  const input = await body(c, createOrderInput);
  await verifyTurnstile(c.env, input.turnstileToken, clientIp(c));
  const maintenance = await getSetting(c.env, "maintenance");
  if (maintenance.active) throw new HttpError(503, "maintenance");

  const order = await createOrder(c.env, {
    ...input,
    communeId: input.communeId ?? null,
    cartId: input.cartId,
    ipHash: await ipHash(c),
    uaShort: uaShort(c),
  });
  // post to Telegram in the background; the outbox + cron retries if it fails
  c.executionCtx.waitUntil(
    notifyNewOrder(c.env, order.code)
      .then(() => c.env.DB.prepare("UPDATE outbox SET done_at = ?, attempts = attempts + 1 WHERE kind = 'telegram' AND json_extract(payload, '$.code') = ?").bind(Date.now(), order.code).run())
      .catch((err: Error) =>
        c.env.DB.prepare("UPDATE outbox SET attempts = attempts + 1, last_error = ?, next_attempt_at = ? WHERE kind = 'telegram' AND json_extract(payload, '$.code') = ?")
          .bind(err.message.slice(0, 300), Date.now() + 60_000, order.code)
          .run(),
      ),
  );
  const dto: CreatedOrderDTO = { code: order.code, token: order.token, total: order.total, status: order.status };
  return c.json(dto, 201);
});

/**
 * Checkout autosave (abandoned checkouts). Called by the checkout form, debounced, once the
 * phone number is valid. Separate (looser) rate-limit bucket so it can never block ordering.
 */
publicRoutes.post("/carts", async (c) => {
  await rateLimit(c.env.RL_LOOKUP, `cart:${clientIp(c)}`);
  const input = await body(c, cartSaveInput);
  const q = await quote(c.env, { lines: input.lines, wilaya: input.wilaya, communeId: input.communeId, deliveryType: input.deliveryType });
  const now = Date.now();
  await c.env.DB.prepare(
    `INSERT INTO carts (id, items, phone, name, wilaya_code, commune_id, delivery_type, channel, locale, value, step, consent, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?)
     ON CONFLICT(id) DO UPDATE SET items = excluded.items, phone = excluded.phone, name = excluded.name,
       wilaya_code = excluded.wilaya_code, commune_id = excluded.commune_id, delivery_type = excluded.delivery_type,
       channel = excluded.channel, locale = excluded.locale, value = excluded.value, step = excluded.step, updated_at = excluded.updated_at
     WHERE carts.recovered_order_id IS NULL`,
  )
    .bind(
      input.id, JSON.stringify(input.lines), input.phone, input.name ?? null, input.wilaya ?? null, input.communeId ?? null,
      input.deliveryType ?? null, input.channel, input.locale, q.shipping != null ? q.total : q.subtotal, input.step, now, now,
    )
    .run();
  return c.json({ ok: true });
});

/**
 * Reminder link sent to a customer who left her checkout ("نسيت شيئًا في سلتك 🛒"): opens
 * her cart again on any phone. Only the items, never the phone number or address.
 */
publicRoutes.get("/carts/:id", async (c) => {
  await rateLimit(c.env.RL_LOOKUP, `cartget:${clientIp(c)}`);
  const id = c.req.param("id");
  if (!/^[0-9a-f-]{36}$/i.test(id)) throw new HttpError(404, "not_found");
  const row = await c.env.DB.prepare("SELECT items, recovered_order_id FROM carts WHERE id = ?").bind(id).first<{ items: string; recovered_order_id: number | null }>();
  if (!row) throw new HttpError(404, "not_found");
  return c.json({ lines: JSON.parse(row.items) as { variantId: number; qty: number }[], ordered: row.recovered_order_id != null });
});

/* ───────── Shopping assistant ───────── */

publicRoutes.post("/assistant", async (c) => {
  await rateLimit(c.env.RL_LOOKUP, `assistant:${clientIp(c)}`);
  const input = await body(c, assistantInput);
  return c.json(await answer(c.env, input));
});

/* ───────── Tracking ───────── */

async function trackedOrders(c: Context<AppEnv>, where: string, binds: unknown[], withDetails: boolean): Promise<TrackedOrderDTO[]> {
  const { results: orders } = await c.env.DB.prepare(
    `SELECT o.id, o.public_code, o.status, o.created_at, o.subtotal, o.discount_total, o.shipping_price, o.total, o.delivery_type,
            o.tracking_number, o.name, o.phone, o.address, o.wilaya_code, o.commune_text,
            w.name_fr AS wilaya_fr, w.name_ar AS wilaya_ar, cm.name_fr AS commune_fr, cm.name_ar AS commune_ar
       FROM orders o LEFT JOIN wilayas w ON w.code = o.wilaya_code LEFT JOIN communes cm ON cm.id = o.commune_id
      WHERE ${where} ORDER BY o.created_at DESC LIMIT 10`,
  )
    .bind(...binds)
    .all<{
      id: number; public_code: string; status: TrackedOrderDTO["status"]; created_at: number; subtotal: number; discount_total: number;
      shipping_price: number; total: number; delivery_type: "domicile" | "bureau"; tracking_number: string | null; name: string; phone: string;
      address: string | null; wilaya_code: number; commune_text: string | null; wilaya_fr: string; wilaya_ar: string; commune_fr: string | null; commune_ar: string | null;
    }>();
  if (!orders.length) return [];
  const ids = orders.map((o) => o.id);
  const ph = ids.map(() => "?").join(",");
  const [items, events, images, reviewed] = await c.env.DB.batch([
    c.env.DB.prepare(
      `SELECT oi.order_id, oi.name_fr, oi.name_ar, oi.options_label, oi.qty, oi.unit_price, oi.product_id, oi.variant_id, p.slug
         FROM order_items oi LEFT JOIN products p ON p.id = oi.product_id WHERE oi.order_id IN (${ph}) ORDER BY oi.id`,
    ).bind(...ids),
    c.env.DB.prepare(`SELECT order_id, to_status, created_at FROM order_events WHERE kind = 'status' AND order_id IN (${ph}) ORDER BY id`).bind(...ids),
    c.env.DB.prepare(
      `SELECT * FROM product_images WHERE product_id IN (SELECT product_id FROM order_items WHERE order_id IN (${ph})) ORDER BY product_id, sort, id`,
    ).bind(...ids),
    c.env.DB.prepare(`SELECT order_id, product_id FROM reviews WHERE order_id IN (${ph})`).bind(...ids),
  ]);
  const imgRows = images!.results as unknown as ImageRow[];
  const variantIds = [...new Set((items!.results as { variant_id: number | null }[]).map((i) => i.variant_id).filter((v): v is number => v != null))];
  const labels = await variantLabels(c.env, variantIds);
  const done = new Set((reviewed!.results as { order_id: number; product_id: number }[]).map((r) => `${r.order_id}:${r.product_id}`));
  return orders.map((o) => ({
    code: o.public_code,
    status: o.status,
    createdAt: o.created_at,
    subtotal: o.subtotal,
    discount: o.discount_total,
    shipping: o.shipping_price,
    total: o.total,
    wilayaCode: o.wilaya_code,
    wilayaFr: o.wilaya_fr,
    wilayaAr: o.wilaya_ar,
    // the commune only with the private link (phone lookups show less)
    communeFr: withDetails ? (o.commune_fr ?? o.commune_text) : null,
    communeAr: withDetails ? (o.commune_ar ?? o.commune_text) : null,
    deliveryType: o.delivery_type,
    trackingNumber: o.tracking_number,
    items: (
      items!.results as {
        order_id: number; name_fr: string; name_ar: string; options_label: string | null; qty: number; unit_price: number; product_id: number | null;
        variant_id: number | null; slug: string | null;
      }[]
    )
      .filter((i) => i.order_id === o.id)
      .map((i) => {
        const img = imgRows.find((r) => r.product_id === i.product_id);
        return {
          productId: i.product_id,
          slug: i.slug,
          nameFr: i.name_fr,
          nameAr: i.name_ar,
          options: i.options_label,
          optionsAr: (i.variant_id != null ? labels.get(i.variant_id)?.ar : null) ?? i.options_label,
          qty: i.qty,
          unitPrice: i.unit_price,
          image: img ? imageRef(c.env, img) : null,
          canReview: withDetails && o.status === "livree" && i.product_id != null && !done.has(`${o.id}:${i.product_id}`),
        };
      }),
    events: (events!.results as { order_id: number; to_status: string; created_at: number }[])
      .filter((e) => e.order_id === o.id)
      .map((e) => ({ status: e.to_status, at: e.created_at })),
    details: withDetails ? { name: o.name, phoneMasked: maskDzPhone(o.phone), address: o.address } : null,
    canChange: withDetails && CHANGEABLE.includes(o.status),
  }));
}

/** Until the team confirms it, the customer can still fix her address or cancel (private link only). */
const CHANGEABLE: string[] = ["nouvelle", "injoignable"];

async function orderByToken(c: Context<AppEnv>, code: string, token: string) {
  const o = await c.env.DB.prepare("SELECT id, public_code, status, address, track_token_hash FROM orders WHERE public_code = ?")
    .bind(code.toUpperCase())
    .first<{ id: number; public_code: string; status: string; address: string | null; track_token_hash: string }>();
  if (!o || !token || !timingSafeEqual(await sha256Hex(token, c.env.TRACK_TOKEN_PEPPER), o.track_token_hash)) throw new HttpError(404, "not_found");
  if (!CHANGEABLE.includes(o.status)) throw new HttpError(409, "already_confirmed");
  return o;
}

const tokenField = z.string().min(10).max(200);

publicRoutes.post("/track/:code/cancel", async (c) => {
  await rateLimit(c.env.RL_WRITE, `selfcancel:${clientIp(c)}`);
  const input = await body(c, z.object({ t: tokenField, reason: z.enum(CUSTOMER_CANCEL_REASONS).default("changed_mind") }));
  const o = await orderByToken(c, c.req.param("code"), input.t);
  await applyStatusChange(c.env, o.id, "annulee", "customer", "customer", "Annulée par la cliente depuis son lien de suivi", input.reason);
  c.executionCtx.waitUntil(
    Promise.all([
      syncOrderMessage(c.env, o.id).catch(() => undefined),
      sendTelegramText(c.env, `🚫 La cliente a annulé la commande ${o.public_code} depuis son lien de suivi.`).catch(() => undefined),
    ]),
  );
  return c.json({ ok: true });
});

publicRoutes.post("/track/:code/edit", async (c) => {
  await rateLimit(c.env.RL_WRITE, `selfedit:${clientIp(c)}`);
  const input = await body(c, z.object({ t: tokenField, address: cleanText(300).pipe(z.string().min(3)), note: cleanText(300).optional() }));
  const o = await orderByToken(c, c.req.param("code"), input.t);
  const now = Date.now();
  const [upd] = await c.env.DB.batch([
    c.env.DB.prepare(`UPDATE orders SET address = ?, customer_note = COALESCE(?, customer_note), updated_at = ? WHERE id = ? AND status IN ('nouvelle','injoignable')`).bind(
      input.address, input.note || null, now, o.id,
    ),
    c.env.DB.prepare("INSERT INTO order_events (order_id, kind, actor, source, note, created_at) VALUES (?, 'edit', 'customer', 'customer', ?, ?)").bind(
      o.id, `Adresse modifiée par la cliente : « ${o.address ?? "—"} » → « ${input.address} »${input.note ? ` · note : ${input.note}` : ""}`, now,
    ),
  ]);
  if (!upd!.meta.changes) throw new HttpError(409, "already_confirmed");
  c.executionCtx.waitUntil(
    Promise.all([
      syncOrderMessage(c.env, o.id).catch(() => undefined),
      sendTelegramText(c.env, `✏️ La cliente a modifié l'adresse de la commande ${o.public_code}.`).catch(() => undefined),
    ]),
  );
  return c.json({ ok: true });
});

/** By phone number (+ optional order code). Limited info: no name, no address. */
publicRoutes.post("/track", async (c) => {
  await rateLimit(c.env.RL_LOOKUP, `track:${clientIp(c)}`);
  const input = await body(c, trackLookupInput);
  await verifyTurnstile(c.env, input.turnstileToken, clientIp(c));
  const orders = input.code
    ? await trackedOrders(c, "o.phone = ? AND o.public_code = ?", [input.phone, input.code], false)
    : await trackedOrders(c, "o.phone = ? AND o.created_at > ?", [input.phone, Date.now() - 180 * 86400_000], false);
  return c.json(orders);
});

/** By private link (code + token from the thank-you page): full details. */
publicRoutes.get("/track/:code", async (c) => {
  await rateLimit(c.env.RL_LOOKUP, `trackcode:${clientIp(c)}`);
  const code = c.req.param("code").toUpperCase();
  const token = c.req.query("t") ?? "";
  const row = await c.env.DB.prepare("SELECT track_token_hash FROM orders WHERE public_code = ?").bind(code).first<{ track_token_hash: string }>();
  if (!row || !token || !timingSafeEqual(await sha256Hex(token, c.env.TRACK_TOKEN_PEPPER), row.track_token_hash)) {
    return c.json({ error: "not_found" }, 404);
  }
  const [order] = await trackedOrders(c, "o.public_code = ?", [code], true);
  return c.json(order);
});

/* ───────── Home: review wall + recent activity ───────── */

publicRoutes.get("/reviews", (c) =>
  versioned(c, 600, async () => {
    const [list, agg] = await c.env.DB.batch([
      c.env.DB.prepare(
        `SELECT r.id, r.name, r.rating, r.text, r.verified, r.reply, r.photos, r.created_at, p.slug, p.name_fr, p.name_ar
           FROM reviews r JOIN products p ON p.id = r.product_id
          WHERE r.status = 'approved' AND p.status = 'published'
          ORDER BY r.is_featured DESC, (r.text IS NOT NULL) DESC, r.created_at DESC LIMIT 12`,
      ),
      c.env.DB.prepare("SELECT AVG(r.rating) AS avg, COUNT(*) AS n FROM reviews r JOIN products p ON p.id = r.product_id WHERE r.status = 'approved' AND p.status = 'published'"),
    ]);
    const a = (agg!.results as { avg: number | null; n: number }[])[0];
    const dto: ReviewWallDTO = {
      avg: a?.avg != null ? Math.round(a.avg * 10) / 10 : null,
      count: a?.n ?? 0,
      reviews: (
        list!.results as {
          id: number; name: string; rating: number; text: string | null; verified: number; reply: string | null; photos: string | null; created_at: number;
          slug: string; name_fr: string; name_ar: string;
        }[]
      ).map((r) => ({
        id: r.id, name: r.name, rating: r.rating, text: r.text, verified: !!r.verified, reply: r.reply, createdAt: r.created_at, photos: reviewPhotos(c.env, r.photos),
        productSlug: r.slug, productFr: r.name_fr, productAr: r.name_ar,
      })),
    };
    return c.json(dto);
  }),
);

/** Last real orders (48 h, not cancelled): product + wilaya + how long ago. Cached 2 min. */
publicRoutes.get("/activity", (c) =>
  cached(new Request(new URL(c.req.url)), c.executionCtx, 120, async () => {
    const now = Date.now();
    const { results } = await c.env.DB.prepare(
      `SELECT o.created_at, w.name_fr AS wf, w.name_ar AS wa,
              (SELECT p.slug FROM order_items oi JOIN products p ON p.id = oi.product_id WHERE oi.order_id = o.id AND p.status = 'published' ORDER BY oi.id LIMIT 1) AS slug,
              (SELECT p.name_fr FROM order_items oi JOIN products p ON p.id = oi.product_id WHERE oi.order_id = o.id AND p.status = 'published' ORDER BY oi.id LIMIT 1) AS nf,
              (SELECT p.name_ar FROM order_items oi JOIN products p ON p.id = oi.product_id WHERE oi.order_id = o.id AND p.status = 'published' ORDER BY oi.id LIMIT 1) AS na
         FROM orders o JOIN wilayas w ON w.code = o.wilaya_code
        WHERE o.created_at > ? AND o.status NOT IN ('annulee','doublon','fausse')
        ORDER BY o.created_at DESC LIMIT 8`,
    )
      .bind(now - 48 * 3600_000)
      .all<{ created_at: number; wf: string; wa: string; slug: string | null; nf: string | null; na: string | null }>();
    const list: ActivityDTO[] = results
      .filter((r) => r.slug)
      .map((r) => ({ productSlug: r.slug!, productFr: r.nf!, productAr: r.na!, wilayaFr: r.wf, wilayaAr: r.wa, minutesAgo: Math.max(1, Math.round((now - r.created_at) / 60_000)) }));
    return c.json(list);
  }),
);

/* ───────── Reviews, contact, back-in-stock ───────── */

/** "Amira Benali" → "Amira B." (reviews never show full names) */
function reviewerName(full: string): string {
  const parts = full.trim().split(/\s+/);
  return parts.length > 1 ? `${parts[0]} ${parts[parts.length - 1]!.charAt(0).toUpperCase()}.` : parts[0]!;
}

/**
 * Verified reviews only: the customer proves a *delivered* order containing the product,
 * with the private tracking token (from her link) or the phone number used to order.
 */
publicRoutes.post("/reviews", async (c) => {
  await rateLimit(c.env.RL_WRITE, `review:${clientIp(c)}`);
  // JSON, or a form: "data" (the same JSON) + up to 3 photos ("photo")
  let input: ReturnType<typeof reviewInput.parse>;
  let photos: File[] = [];
  if ((c.req.header("Content-Type") ?? "").startsWith("multipart/form-data")) {
    const form = await c.req.formData().catch(() => null);
    if (!form) throw new HttpError(400, "invalid_form");
    let raw: unknown;
    try {
      raw = JSON.parse(String(form.get("data") ?? ""));
    } catch {
      throw new HttpError(400, "invalid_json");
    }
    input = validate(raw, reviewInput);
    photos = form.getAll("photo").filter((f): f is File => typeof f !== "string").slice(0, 3);
  } else {
    input = await body(c, reviewInput);
  }
  await verifyTurnstile(c.env, input.turnstileToken, clientIp(c));
  const o = await c.env.DB.prepare("SELECT id, status, phone, name, track_token_hash FROM orders WHERE public_code = ?")
    .bind(input.code)
    .first<{ id: number; status: string; phone: string; name: string; track_token_hash: string }>();
  const proven =
    !!o && (input.token ? timingSafeEqual(await sha256Hex(input.token, c.env.TRACK_TOKEN_PEPPER), o.track_token_hash) : input.phone === o.phone);
  // same answer for "no such order" and "wrong proof": nothing to learn by guessing
  if (!o || !proven) throw new HttpError(404, "order_not_found");
  if (o.status !== "livree") throw new HttpError(409, "not_delivered");
  const item = await c.env.DB.prepare("SELECT 1 AS ok FROM order_items WHERE order_id = ? AND product_id = ?").bind(o.id, input.productId).first();
  if (!item) throw new HttpError(422, "product_not_in_order");

  const { reviews: cfg, notifications: notif } = await getSettings(c.env, ["reviews", "notifications"]);
  // photos are always checked by the team first: a review with photos waits for approval
  const status = cfg.auto_approve_verified && !photos.length ? "approved" : "pending";
  const name = reviewerName(o.name);
  const keys: string[] = [];
  for (const [i, f] of photos.entries()) keys.push(await putImage(c.env, `reviews/${o.id}-${input.productId}-${i}`, f));
  try {
    await c.env.DB.batch([
      c.env.DB.prepare("INSERT INTO reviews (product_id, order_id, name, rating, text, photos, verified, status, created_at) VALUES (?, ?, ?, ?, ?, ?, 1, ?, ?)").bind(
        input.productId, o.id, name, input.rating, input.text ?? null, keys.length ? JSON.stringify(keys) : null, status, Date.now(),
      ),
      ...(status === "approved" ? [bumpCatalogStmt(c.env)] : []),
    ]);
  } catch (err) {
    if (keys.length) c.executionCtx.waitUntil(c.env.MEDIA.delete(keys).catch(() => undefined));
    if (String((err as Error).message).includes("UNIQUE")) throw new HttpError(409, "already_reviewed");
    throw err;
  }
  if (notif.telegram_review) {
    const what = status === "approved" ? "publié (vous pouvez le masquer dans Admin → Avis)" : "à valider dans Admin → Avis";
    const withPhotos = keys.length ? ` avec ${keys.length} photo(s)` : "";
    c.executionCtx.waitUntil(sendTelegramText(c.env, `⭐ Avis vérifié (${input.rating}/5)${withPhotos} de ${name.replace(/[<>&]/g, "")}, ${what}.`));
  }
  return c.json({ ok: true, status }, 201);
});


publicRoutes.post("/contact", async (c) => {
  await rateLimit(c.env.RL_WRITE, `contact:${clientIp(c)}`);
  const input = await body(c, contactInput);
  await verifyTurnstile(c.env, input.turnstileToken, clientIp(c));
  await c.env.DB.prepare("INSERT INTO contact_messages (name, phone, subject, message, status, created_at) VALUES (?, ?, ?, ?, 'new', ?)")
    .bind(input.name, input.phone ?? null, input.subject ?? null, input.message, Date.now())
    .run();
  const notif = await getSetting(c.env, "notifications");
  if (notif.telegram_contact) {
    c.executionCtx.waitUntil(sendTelegramText(c.env, `✉️ Nouveau message de ${input.name.replace(/[<>&]/g, "")} — Admin → Contact.`));
  }
  return c.json({ ok: true }, 201);
});

publicRoutes.post("/stock-alert", async (c) => {
  await rateLimit(c.env.RL_WRITE, `alert:${clientIp(c)}`);
  const input = await body(c, stockAlertInput);
  await verifyTurnstile(c.env, input.turnstileToken, clientIp(c));
  await c.env.DB.prepare(
    `INSERT INTO stock_alerts (variant_id, phone, created_at)
     SELECT ?, ?, ? WHERE NOT EXISTS (SELECT 1 FROM stock_alerts WHERE variant_id = ? AND phone = ? AND notified_at IS NULL)`,
  )
    .bind(input.variantId, input.phone, Date.now(), input.variantId, input.phone)
    .run();
  return c.json({ ok: true }, 201);
});

/* ───────── Back-in-stock notifications (Web Push) ───────── */

publicRoutes.get("/push/key", async (c) => c.json({ publicKey: (await vapidKeys(c.env)).publicKey }, 200, { "Cache-Control": "public, max-age=86400" }));

publicRoutes.post("/push/subscribe", async (c) => {
  await rateLimit(c.env.RL_WRITE, `push:${clientIp(c)}`);
  const input = await body(c, pushSubscribeInput);
  if (!isPushEndpoint(input.subscription.endpoint)) throw new HttpError(422, "push_endpoint");
  // which sizes to watch: the one chosen, or every sold-out size of a product (wishlist)
  let variantIds: number[] = [];
  if (input.variantId) {
    const variant = await c.env.DB.prepare("SELECT id FROM variants WHERE id = ? AND is_active = 1").bind(input.variantId).first();
    if (!variant) throw new HttpError(404, "not_found");
    variantIds = [input.variantId];
  } else if (input.productId) {
    const { results } = await c.env.DB.prepare("SELECT id FROM variants WHERE product_id = ? AND is_active = 1 AND stock_on_hand - stock_reserved <= 0 LIMIT 40")
      .bind(input.productId)
      .all<{ id: number }>();
    variantIds = results.map((r) => r.id);
  } else if (input.topic !== "news") {
    throw new HttpError(422, "validation_failed");
  }
  const now = Date.now();
  const { endpoint, keys } = input.subscription;
  const tag = input.topic === "news" ? "news" : "restock";
  await c.env.DB.batch([
    c.env.DB.prepare(
      `INSERT INTO push_subscriptions (endpoint, p256dh, auth, locale, tags, created_at) VALUES (?, ?, ?, ?, json_array(?), ?)
       ON CONFLICT(endpoint) DO UPDATE SET p256dh = excluded.p256dh, auth = excluded.auth, locale = excluded.locale,
         tags = CASE WHEN EXISTS (SELECT 1 FROM json_each(push_subscriptions.tags) WHERE value = ?) THEN push_subscriptions.tags
                     ELSE json_insert(push_subscriptions.tags, '$[#]', ?) END`,
    ).bind(endpoint, keys.p256dh, keys.auth, input.locale, tag, now, tag, tag),
    ...variantIds.map((variantId) =>
      c.env.DB.prepare(
        `INSERT INTO stock_alerts (variant_id, push_subscription_id, created_at)
         SELECT ?, s.id, ? FROM push_subscriptions s WHERE s.endpoint = ?
           AND NOT EXISTS (SELECT 1 FROM stock_alerts a WHERE a.variant_id = ? AND a.push_subscription_id = s.id AND a.notified_at IS NULL)`,
      ).bind(variantId, now, endpoint, variantId),
    ),
  ]);
  // already back (stock changed while the page was open): tell her right away
  if (variantIds.length) c.executionCtx.waitUntil(sendRestockPushes(c.env, variantIds, 5).catch(() => undefined));
  return c.json({ ok: true, watching: variantIds.length }, 201);
});

/** Client-side JS errors (sampled by the page). */
publicRoutes.post("/log", async (c) => {
  await rateLimit(c.env.RL_LOOKUP, `log:${clientIp(c)}`);
  const input = await body(c, clientErrorInput);
  c.executionCtx.waitUntil(recordError(c.env, "client", input.message, { stack: input.stack, url: input.url }));
  return c.json({ ok: true });
});
