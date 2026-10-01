import { Hono, type Context } from "hono";
import {
  cartSaveInput,
  clientErrorInput,
  contactInput,
  createOrderInput,
  maskDzPhone,
  quoteInput,
  reviewInput,
  sha256Hex,
  stockAlertInput,
  timingSafeEqual,
  trackLookupInput,
  type CreatedOrderDTO,
  type LinkDTO,
  type PageDTO,
  type SiteConfigDTO,
  type TrackedOrderDTO,
} from "@henine/shared";
import type { AppEnv } from "../env";
import { recordError } from "../lib/audit";
import { getProductDetail, imageRef, listCategories, listProductCards, type ImageRow } from "../lib/catalog";
import { cached } from "../lib/edge-cache";
import { body, clientIp, HttpError, ipHash, rateLimit, uaShort, verifyTurnstile } from "../lib/http";
import { createOrder, quote } from "../lib/orders";
import { getSetting, getSettings } from "../lib/settings";
import { notifyNewOrder, sendTelegramText } from "../lib/telegram";

export const publicRoutes = new Hono<AppEnv>();

/** Edge cache keyed on the catalogue version: admin edits are visible immediately. */
async function versioned(c: Context<AppEnv>, ttl: number, produce: () => Promise<Response>) {
  const v = await getSetting(c.env, "catalog_version");
  const url = new URL(c.req.url);
  url.searchParams.set("__v", String(v));
  return cached(new Request(url), c.executionCtx, ttl, produce);
}

publicRoutes.get("/health", async (c) => {
  const row = await c.env.DB.prepare("SELECT count(*) AS n FROM wilayas").first<{ n: number }>();
  return c.json({ ok: true, env: c.env.ENVIRONMENT, wilayas: row?.n ?? 0, time: Date.now() });
});

/* ───────── Site config ───────── */

publicRoutes.get("/site", (c) =>
  versioned(c, 300, async () => {
    const s = await getSettings(c.env, ["store", "announcement", "hero", "contact", "checkout", "maintenance", "faq"]);
    const dto: SiteConfigDTO = {
      store: {
        name: s.store.name, taglineFr: s.store.tagline_fr, taglineAr: s.store.tagline_ar,
        cityFr: s.store.city_fr, cityAr: s.store.city_ar, hoursFr: s.store.hours_fr, hoursAr: s.store.hours_ar,
      },
      announcement: { active: s.announcement.active, messagesFr: s.announcement.messages_fr, messagesAr: s.announcement.messages_ar },
      hero: {
        eyebrowFr: s.hero.eyebrow_fr, eyebrowAr: s.hero.eyebrow_ar, titleFr: s.hero.title_fr, titleAr: s.hero.title_ar,
        subtitleFr: s.hero.subtitle_fr, subtitleAr: s.hero.subtitle_ar,
      },
      contact: {
        phone: s.contact.phone, whatsapp: s.contact.whatsapp, instagram: s.contact.instagram, tiktok: s.contact.tiktok,
        facebook: s.contact.facebook, maps: s.contact.maps, addressFr: s.contact.address_fr, addressAr: s.contact.address_ar,
      },
      checkout: { freeShippingOver: s.checkout.free_shipping_over, expressOnProduct: s.checkout.express_on_product, deskEnabled: s.checkout.desk_enabled },
      turnstileSiteKey: c.env.TURNSTILE_SITE_KEY,
      maintenance: { active: s.maintenance.active, messageFr: s.maintenance.message_fr, messageAr: s.maintenance.message_ar },
      faq: s.faq.map((x) => ({ qFr: x.q_fr, aFr: x.a_fr, qAr: x.q_ar, aAr: x.a_ar })),
    };
    return c.json(dto);
  }),
);

/* ───────── Catalogue ───────── */

publicRoutes.get("/catalog", (c) => versioned(c, 120, async () => c.json(await listProductCards(c.env))));

publicRoutes.get("/categories", (c) => versioned(c, 600, async () => c.json(await listCategories(c.env))));

publicRoutes.get("/products/:slug", (c) =>
  versioned(c, 120, async () => {
    const p = await getProductDetail(c.env, c.req.param("slug"));
    return p ? c.json(p) : c.json({ error: "not_found" }, 404);
  }),
);

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
  return cached(c.req.raw, c.executionCtx, 3600, async () => {
    const { results } = await c.env.DB.prepare(
      "SELECT id, name_fr AS fr, name_ar AS ar FROM communes WHERE wilaya_code = ? AND is_active = 1 ORDER BY name_fr",
    )
      .bind(code)
      .all();
    return c.json(results);
  });
});

/* ───────── Checkout ───────── */

publicRoutes.post("/quote", async (c) => {
  await rateLimit(c.env.RL_LOOKUP, `quote:${clientIp(c)}`);
  const input = await body(c, quoteInput);
  const { couponRow: _, ...dto } = await quote(c.env, input);
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

publicRoutes.post("/carts", async (c) => {
  await rateLimit(c.env.RL_WRITE, `cart:${clientIp(c)}`);
  const input = await body(c, cartSaveInput);
  const q = await quote(c.env, { lines: input.lines });
  await c.env.DB.prepare(
    `INSERT INTO carts (id, items, phone, name, wilaya_code, value, step, consent, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, 'checkout', 1, ?, ?)
     ON CONFLICT(id) DO UPDATE SET items = excluded.items, phone = excluded.phone, name = excluded.name,
       wilaya_code = excluded.wilaya_code, value = excluded.value, updated_at = excluded.updated_at
     WHERE carts.recovered_order_id IS NULL`,
  )
    .bind(input.id, JSON.stringify(input.lines), input.phone, input.name ?? null, input.wilaya ?? null, q.subtotal, Date.now(), Date.now())
    .run();
  return c.json({ ok: true });
});

/* ───────── Tracking ───────── */

async function trackedOrders(c: Context<AppEnv>, where: string, binds: unknown[], withDetails: boolean): Promise<TrackedOrderDTO[]> {
  const { results: orders } = await c.env.DB.prepare(
    `SELECT o.id, o.public_code, o.status, o.created_at, o.total, o.delivery_type, o.tracking_number, o.name, o.phone, o.address,
            w.name_fr AS wilaya_fr, w.name_ar AS wilaya_ar, cm.name_fr AS commune_fr
       FROM orders o LEFT JOIN wilayas w ON w.code = o.wilaya_code LEFT JOIN communes cm ON cm.id = o.commune_id
      WHERE ${where} ORDER BY o.created_at DESC LIMIT 10`,
  )
    .bind(...binds)
    .all<{
      id: number; public_code: string; status: TrackedOrderDTO["status"]; created_at: number; total: number; delivery_type: "domicile" | "bureau";
      tracking_number: string | null; name: string; phone: string; address: string | null; wilaya_fr: string; wilaya_ar: string; commune_fr: string | null;
    }>();
  if (!orders.length) return [];
  const ids = orders.map((o) => o.id);
  const ph = ids.map(() => "?").join(",");
  const [items, events, images] = await c.env.DB.batch([
    c.env.DB.prepare(`SELECT order_id, name_fr, name_ar, options_label, qty, product_id FROM order_items WHERE order_id IN (${ph})`).bind(...ids),
    c.env.DB.prepare(`SELECT order_id, to_status, created_at FROM order_events WHERE kind = 'status' AND order_id IN (${ph}) ORDER BY id`).bind(...ids),
    c.env.DB.prepare(
      `SELECT * FROM product_images WHERE product_id IN (SELECT product_id FROM order_items WHERE order_id IN (${ph})) ORDER BY product_id, sort, id`,
    ).bind(...ids),
  ]);
  const imgRows = images!.results as unknown as ImageRow[];
  return orders.map((o) => ({
    code: o.public_code,
    status: o.status,
    createdAt: o.created_at,
    total: o.total,
    wilayaFr: o.wilaya_fr,
    wilayaAr: o.wilaya_ar,
    deliveryType: o.delivery_type,
    trackingNumber: o.tracking_number,
    items: (items!.results as { order_id: number; name_fr: string; name_ar: string; options_label: string | null; qty: number; product_id: number | null }[])
      .filter((i) => i.order_id === o.id)
      .map((i) => {
        const img = imgRows.find((r) => r.product_id === i.product_id);
        return { nameFr: i.name_fr, nameAr: i.name_ar, options: i.options_label, qty: i.qty, image: img ? imageRef(c.env, img) : null };
      }),
    events: (events!.results as { order_id: number; to_status: string; created_at: number }[])
      .filter((e) => e.order_id === o.id)
      .map((e) => ({ status: e.to_status, at: e.created_at })),
    details: withDetails ? { name: o.name, phoneMasked: maskDzPhone(o.phone), address: o.address, communeFr: o.commune_fr } : null,
  }));
}

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

/* ───────── Reviews, contact, back-in-stock ───────── */

publicRoutes.post("/reviews", async (c) => {
  await rateLimit(c.env.RL_WRITE, `review:${clientIp(c)}`);
  const input = await body(c, reviewInput);
  await verifyTurnstile(c.env, input.turnstileToken, clientIp(c));
  const exists = await c.env.DB.prepare("SELECT id FROM products WHERE id = ? AND status = 'published'").bind(input.productId).first();
  if (!exists) throw new HttpError(404, "product_not_found");
  await c.env.DB.prepare("INSERT INTO reviews (product_id, name, rating, text, status, created_at) VALUES (?, ?, ?, ?, 'pending', ?)")
    .bind(input.productId, input.name, input.rating, input.text ?? null, Date.now())
    .run();
  const notif = await getSetting(c.env, "notifications");
  if (notif.telegram_review) {
    c.executionCtx.waitUntil(sendTelegramText(c.env, `⭐ Nouvel avis (${input.rating}/5) de ${input.name.replace(/[<>&]/g, "")} — à valider dans Admin → Avis.`));
  }
  return c.json({ ok: true }, 201);
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

/** Client-side JS errors (sampled by the page). */
publicRoutes.post("/log", async (c) => {
  await rateLimit(c.env.RL_LOOKUP, `log:${clientIp(c)}`);
  const input = await body(c, clientErrorInput);
  c.executionCtx.waitUntil(recordError(c.env, "client", input.message, { stack: input.stack, url: input.url }));
  return c.json({ ok: true });
});
