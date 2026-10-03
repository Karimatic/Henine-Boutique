/**
 * D1 (SQLite) schema. Conventions:
 * - money: integer DA
 * - time: integer epoch milliseconds (UTC); displayed in Africa/Algiers
 * - bilingual customer-facing text: *_fr / *_ar
 * - flexible settings/config: JSON text columns
 */
import { sql } from "drizzle-orm";
import { check, index, integer, primaryKey, real, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";

const now = sql`(unixepoch() * 1000)`;
const createdAt = () => integer("created_at").notNull().default(now);
const updatedAt = () => integer("updated_at").notNull().default(now);
const bool = (name: string) => integer(name, { mode: "boolean" });

/* ───────────────────────────── Geography & delivery ───────────────────────────── */

export const wilayas = sqliteTable("wilayas", {
  code: integer("code").primaryKey(), // 1–69, official numbering (decree 26-206)
  nameFr: text("name_fr").notNull(),
  nameAr: text("name_ar").notNull(),
  /** For wilayas 59–69: the wilaya they were carved out of. Carriers still on 58 use this. */
  parentCode: integer("parent_code"),
  isActive: bool("is_active").notNull().default(true),
  homePrice: integer("home_price"), // null = home delivery unavailable
  deskPrice: integer("desk_price"), // null = stop-desk unavailable
  delayDays: text("delay_days"), // "1-2"
  sort: integer("sort").notNull().default(0),
  updatedAt: updatedAt(),
});

export const communes = sqliteTable(
  "communes",
  {
    id: integer("id").primaryKey(),
    wilayaCode: integer("wilaya_code").notNull().references(() => wilayas.code),
    nameFr: text("name_fr").notNull(),
    nameAr: text("name_ar").notNull(),
    dairaFr: text("daira_fr"),
    dairaAr: text("daira_ar"),
    homeSupported: bool("home_supported").notNull().default(true),
    /** home-delivery price for this commune when it differs from the wilaya's (remote communes) */
    homePrice: integer("home_price"),
    isActive: bool("is_active").notNull().default(true),
  },
  (t) => [index("communes_wilaya_idx").on(t.wilayaCode)],
);

export const carriers = sqliteTable("carriers", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  slug: text("slug").notNull().unique(), // "zr-express"
  name: text("name").notNull(),
  adapter: text("adapter").notNull(), // "zr" | "procolis" | "yalidine" | "ecotrack" …
  isDefault: bool("is_default").notNull().default(false),
  isActive: bool("is_active").notNull().default(true),
  /** Non-secret options (tenant id, default parcel type…). Secrets live in Worker secrets. */
  config: text("config", { mode: "json" }).$type<Record<string, unknown>>(),
  createdAt: createdAt(),
});

export const stopDesks = sqliteTable(
  "stop_desks",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    carrierId: integer("carrier_id").notNull().references(() => carriers.id),
    externalId: text("external_id"),
    wilayaCode: integer("wilaya_code").notNull().references(() => wilayas.code),
    communeId: integer("commune_id").references(() => communes.id),
    name: text("name").notNull(),
    address: text("address"),
    phone: text("phone"),
    lat: real("lat"),
    lng: real("lng"),
    isActive: bool("is_active").notNull().default(true),
  },
  (t) => [index("stop_desks_wilaya_idx").on(t.wilayaCode)],
);

/* ───────────────────────────── Catalogue ───────────────────────────── */

export const categories = sqliteTable("categories", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  parentId: integer("parent_id"),
  slug: text("slug").notNull().unique(),
  nameFr: text("name_fr").notNull(),
  nameAr: text("name_ar").notNull(),
  descriptionFr: text("description_fr"),
  descriptionAr: text("description_ar"),
  image: text("image"),
  sort: integer("sort").notNull().default(0),
  isActive: bool("is_active").notNull().default(true),
  seoTitle: text("seo_title"),
  seoDescription: text("seo_description"),
  updatedAt: updatedAt(),
});

export const sizeGuides = sqliteTable("size_guides", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  name: text("name").notNull(),
  table: text("table", { mode: "json" }).$type<{ headers: string[]; rows: string[][] }>().notNull(),
  tipsFr: text("tips_fr"),
  tipsAr: text("tips_ar"),
});

export const products = sqliteTable(
  "products",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    slug: text("slug").notNull().unique(),
    nameFr: text("name_fr").notNull(),
    nameAr: text("name_ar").notNull(),
    descriptionFr: text("description_fr"), // markdown
    descriptionAr: text("description_ar"),
    status: text("status", { enum: ["draft", "published", "scheduled", "archived"] })
      .notNull()
      .default("draft"),
    publishAt: integer("publish_at"),
    categoryId: integer("category_id").references(() => categories.id),
    tags: text("tags", { mode: "json" }).$type<string[]>().notNull().default(sql`'[]'`),
    price: integer("price").notNull(),
    compareAtPrice: integer("compare_at_price"),
    costPrice: integer("cost_price"),
    sizeGuideId: integer("size_guide_id").references(() => sizeGuides.id),
    videoKey: text("video_key"),
    instagramUrl: text("instagram_url"),
    seoTitle: text("seo_title"),
    seoDescription: text("seo_description"),
    sort: integer("sort").notNull().default(0),
    /** first time the product went online ("Nouveautés" order) */
    publishedAt: integer("published_at"),
    /** hand-picked "Complétez le look" products */
    relatedIds: text("related_ids", { mode: "json" }).$type<number[]>().notNull().default(sql`'[]'`),
    createdBy: integer("created_by"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index("products_status_cat_idx").on(t.status, t.categoryId)],
);

export const collections = sqliteTable("collections", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  slug: text("slug").notNull().unique(),
  nameFr: text("name_fr").notNull(),
  nameAr: text("name_ar").notNull(),
  /** null = manual (collection_products), otherwise a rule evaluated at build time */
  rule: text("rule", { mode: "json" }).$type<{ kind: "new" | "bestsellers" | "promo" | "tag"; value?: string; limit?: number }>(),
  /** published = visible at /collection/<slug> */
  isActive: bool("is_active").notNull().default(true),
  descriptionFr: text("description_fr"),
  descriptionAr: text("description_ar"),
  /** launch time of a drop (null = always open) */
  startsAt: integer("starts_at"),
  endsAt: integer("ends_at"),
  showCountdown: bool("show_countdown").notNull().default(true),
  /** hide the drop's products everywhere (and refuse orders) until startsAt */
  lockProducts: bool("lock_products").notNull().default(false),
  sort: integer("sort").notNull().default(0),
  createdAt: integer("created_at"),
});

export const collectionProducts = sqliteTable(
  "collection_products",
  {
    collectionId: integer("collection_id").notNull().references(() => collections.id, { onDelete: "cascade" }),
    productId: integer("product_id").notNull().references(() => products.id, { onDelete: "cascade" }),
    sort: integer("sort").notNull().default(0),
  },
  (t) => [primaryKey({ columns: [t.collectionId, t.productId] })],
);

export const productImages = sqliteTable(
  "product_images",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    productId: integer("product_id").notNull().references(() => products.id, { onDelete: "cascade" }),
    /** Option value this image belongs to (a colour), null = all */
    optionValueId: integer("option_value_id"),
    /** R2 key prefix, e.g. "p/12/9f2c1a" → p/12/9f2c1a-720.avif */
    baseKey: text("base_key").notNull(),
    widths: text("widths", { mode: "json" }).$type<number[]>().notNull(),
    width: integer("width").notNull(),
    height: integer("height").notNull(),
    /** tiny blurred data: URL shown while the real image loads */
    lqip: text("lqip"),
    altFr: text("alt_fr"),
    altAr: text("alt_ar"),
    sort: integer("sort").notNull().default(0),
  },
  (t) => [index("product_images_product_idx").on(t.productId)],
);

export const productOptions = sqliteTable("product_options", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  productId: integer("product_id").notNull().references(() => products.id, { onDelete: "cascade" }),
  kind: text("kind", { enum: ["taille", "couleur", "autre"] }).notNull(),
  nameFr: text("name_fr").notNull(),
  nameAr: text("name_ar").notNull(),
  sort: integer("sort").notNull().default(0),
});

export const optionValues = sqliteTable("option_values", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  optionId: integer("option_id").notNull().references(() => productOptions.id, { onDelete: "cascade" }),
  labelFr: text("label_fr").notNull(),
  labelAr: text("label_ar").notNull(),
  hex: text("hex"),
  sort: integer("sort").notNull().default(0),
});

export const variants = sqliteTable(
  "variants",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    productId: integer("product_id").notNull().references(() => products.id, { onDelete: "cascade" }),
    sku: text("sku").notNull().unique(),
    barcode: text("barcode"),
    optionValueIds: text("option_value_ids", { mode: "json" }).$type<number[]>().notNull(),
    priceOverride: integer("price_override"),
    stockOnHand: integer("stock_on_hand").notNull().default(0),
    stockReserved: integer("stock_reserved").notNull().default(0),
    lowStockThreshold: integer("low_stock_threshold").notNull().default(2),
    weightG: integer("weight_g"),
    isActive: bool("is_active").notNull().default(true),
    updatedAt: updatedAt(),
  },
  (t) => [
    index("variants_product_idx").on(t.productId),
    // Overselling is impossible at the database level: an order batch that would reserve more
    // than is on hand violates this constraint and the whole transaction rolls back.
    check("variants_stock_ok", sql`${t.stockOnHand} >= 0 AND ${t.stockReserved} >= 0 AND ${t.stockReserved} <= ${t.stockOnHand}`),
  ],
);

export const stockMovements = sqliteTable(
  "stock_movements",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    variantId: integer("variant_id").notNull().references(() => variants.id),
    delta: integer("delta").notNull(),
    reason: text("reason", {
      enum: ["reception", "vente", "retour", "ajustement", "casse", "reservation", "liberation", "inventaire"],
    }).notNull(),
    orderId: integer("order_id"),
    note: text("note"),
    actor: text("actor").notNull(), // "member:3" | "telegram:12345" | "system"
    createdAt: createdAt(),
  },
  (t) => [index("stock_movements_variant_idx").on(t.variantId, t.createdAt)],
);

/* ───────────────────────────── Customers & orders ───────────────────────────── */

export const customers = sqliteTable("customers", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  phone: text("phone").notNull().unique(), // normalized 0XXXXXXXXX
  name: text("name").notNull(),
  wilayaCode: integer("wilaya_code"),
  communeId: integer("commune_id"),
  address: text("address"),
  tags: text("tags", { mode: "json" }).$type<string[]>().notNull().default(sql`'[]'`),
  notes: text("notes"),
  isBlacklisted: bool("is_blacklisted").notNull().default(false),
  blacklistReason: text("blacklist_reason"),
  ordersCount: integer("orders_count").notNull().default(0),
  deliveredCount: integer("delivered_count").notNull().default(0),
  returnedCount: integer("returned_count").notNull().default(0),
  cancelledCount: integer("cancelled_count").notNull().default(0),
  /** orders marked "fausse commande" (also counted in cancelled_count) */
  fakeCount: integer("fake_count").notNull().default(0),
  totalSpent: integer("total_spent").notNull().default(0),
  pointsBalance: integer("points_balance").notNull().default(0),
  tier: text("tier"),
  referralCode: text("referral_code").unique(),
  referredBy: integer("referred_by"),
  firstOrderAt: integer("first_order_at"),
  lastOrderAt: integer("last_order_at"),
  createdAt: createdAt(),
});

export const orders = sqliteTable(
  "orders",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    publicCode: text("public_code").notNull().unique(),
    trackTokenHash: text("track_token_hash").notNull(),
    idempotencyKey: text("idempotency_key").notNull().unique(),
    status: text("status").notNull().default("nouvelle"), // see @henine/shared ORDER_STATUSES
    channel: text("channel", { enum: ["web", "express", "instagram", "whatsapp", "boutique", "telephone"] })
      .notNull()
      .default("web"),
    locale: text("locale").notNull().default("fr"),
    customerId: integer("customer_id").notNull().references(() => customers.id),
    // snapshot at order time
    name: text("name").notNull(),
    phone: text("phone").notNull(),
    wilayaCode: integer("wilaya_code").notNull(),
    communeId: integer("commune_id"),
    communeText: text("commune_text"),
    deliveryType: text("delivery_type", { enum: ["domicile", "bureau"] }).notNull(),
    stopDeskId: integer("stop_desk_id"),
    address: text("address"),
    // money
    subtotal: integer("subtotal").notNull(),
    discountTotal: integer("discount_total").notNull().default(0),
    shippingPrice: integer("shipping_price").notNull(),
    total: integer("total").notNull(),
    couponCode: text("coupon_code"),
    pointsUsed: integer("points_used").notNull().default(0),
    pointsEarned: integer("points_earned").notNull().default(0),
    paymentMethod: text("payment_method", { enum: ["cod", "chargily", "baridimob"] }).notNull().default("cod"),
    paymentStatus: text("payment_status", { enum: ["pending", "paid", "refunded"] }).notNull().default("pending"),
    // fulfilment
    carrierId: integer("carrier_id"),
    trackingNumber: text("tracking_number"),
    carrierStatus: text("carrier_status"),
    labelUrl: text("label_url"),
    assignedTo: integer("assigned_to"),
    confirmAttempts: integer("confirm_attempts").notNull().default(0),
    nextCallbackAt: integer("next_callback_at"),
    customerNote: text("customer_note"),
    internalNote: text("internal_note"),
    riskScore: integer("risk_score").notNull().default(0),
    /** order-level risk signals captured at creation (see RISK_FLAGS in @henine/shared) */
    riskFlags: text("risk_flags", { mode: "json" }).$type<string[]>(),
    /** why it was cancelled / returned (OUTCOME_REASONS) */
    outcomeReason: text("outcome_reason"),
    /** packing mode: items checked against the order, parcel photo (R2 key) */
    verifiedAt: integer("verified_at"),
    packedAt: integer("packed_at"),
    packPhoto: text("pack_photo"),
    telegramMessageId: integer("telegram_message_id"),
    /** random value written by each status change; follow-up statements in the same batch check it (optimistic concurrency) */
    opNonce: text("op_nonce"),
    // attribution / abuse
    utmSource: text("utm_source"),
    utmMedium: text("utm_medium"),
    utmCampaign: text("utm_campaign"),
    referrer: text("referrer"),
    ipHash: text("ip_hash"),
    uaShort: text("ua_short"),
    // timeline
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    confirmedAt: integer("confirmed_at"),
    shippedAt: integer("shipped_at"),
    deliveredAt: integer("delivered_at"),
    returnedAt: integer("returned_at"),
  },
  (t) => [
    index("orders_status_created_idx").on(t.status, t.createdAt),
    index("orders_customer_idx").on(t.customerId),
    index("orders_phone_idx").on(t.phone),
    index("orders_tracking_idx").on(t.trackingNumber),
    index("orders_callback_idx").on(t.nextCallbackAt),
    index("orders_created_idx").on(t.createdAt),
    index("orders_wilaya_created_idx").on(t.wilayaCode, t.createdAt),
  ],
);

export const orderItems = sqliteTable(
  "order_items",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    orderId: integer("order_id").notNull().references(() => orders.id, { onDelete: "cascade" }),
    variantId: integer("variant_id").references(() => variants.id),
    productId: integer("product_id"),
    nameFr: text("name_fr").notNull(),
    nameAr: text("name_ar").notNull(),
    sku: text("sku").notNull(),
    optionsLabel: text("options_label"), // "Rose / M"
    image: text("image"),
    unitPrice: integer("unit_price").notNull(),
    qty: integer("qty").notNull(),
    lineDiscount: integer("line_discount").notNull().default(0),
  },
  (t) => [index("order_items_order_idx").on(t.orderId), index("order_items_product_idx").on(t.productId)],
);

export const orderEvents = sqliteTable(
  "order_events",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    orderId: integer("order_id").notNull().references(() => orders.id, { onDelete: "cascade" }),
    fromStatus: text("from_status"),
    toStatus: text("to_status"),
    kind: text("kind", { enum: ["status", "note", "call", "edit", "carrier", "whatsapp"] }).notNull().default("status"),
    actor: text("actor").notNull(),
    source: text("source", { enum: ["admin", "telegram", "carrier", "system", "customer"] }).notNull(),
    note: text("note"),
    createdAt: createdAt(),
  },
  (t) => [index("order_events_order_idx").on(t.orderId, t.createdAt)],
);

export const carts = sqliteTable(
  "carts",
  {
    id: text("id").primaryKey(), // client-generated uuid
    items: text("items", { mode: "json" }).$type<{ variantId: number; qty: number }[]>().notNull(),
    phone: text("phone"),
    name: text("name"),
    wilayaCode: integer("wilaya_code"),
    communeId: integer("commune_id"),
    deliveryType: text("delivery_type"),
    channel: text("channel"),
    locale: text("locale"),
    value: integer("value").notNull().default(0),
    /** details | address | delivery | ready */
    step: text("step"),
    consent: bool("consent").notNull().default(false),
    recoveredOrderId: integer("recovered_order_id"),
    lastContactedAt: integer("last_contacted_at"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index("carts_updated_idx").on(t.updatedAt)],
);

/* ───────────────────────────── Marketing ───────────────────────────── */

export const coupons = sqliteTable("coupons", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  code: text("code").notNull().unique(),
  type: text("type", { enum: ["percent", "fixed", "free_shipping"] }).notNull(),
  value: integer("value").notNull().default(0),
  minSubtotal: integer("min_subtotal"),
  appliesTo: text("applies_to", { mode: "json" }).$type<{ productIds?: number[]; categoryIds?: number[] }>(),
  wilayaCodes: text("wilaya_codes", { mode: "json" }).$type<number[]>(),
  firstOrderOnly: bool("first_order_only").notNull().default(false),
  perCustomerLimit: integer("per_customer_limit"),
  usageLimit: integer("usage_limit"),
  usedCount: integer("used_count").notNull().default(0),
  startsAt: integer("starts_at"),
  endsAt: integer("ends_at"),
  isActive: bool("is_active").notNull().default(true),
  influencerName: text("influencer_name"),
  commissionPct: integer("commission_pct"),
  createdAt: createdAt(),
}, (t) => [check("coupons_usage_ok", sql`${t.usageLimit} IS NULL OR ${t.usedCount} <= ${t.usageLimit}`)]);

export const promotions = sqliteTable("promotions", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  name: text("name").notNull(),
  kind: text("kind", { enum: ["category_percent", "buy_x_get_y", "bundle_price", "free_shipping_over", "flash_sale"] }).notNull(),
  config: text("config", { mode: "json" }).$type<Record<string, unknown>>().notNull(),
  priority: integer("priority").notNull().default(0),
  stackable: bool("stackable").notNull().default(false),
  startsAt: integer("starts_at"),
  endsAt: integer("ends_at"),
  isActive: bool("is_active").notNull().default(true),
});

export const loyaltyLedger = sqliteTable(
  "loyalty_ledger",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    customerId: integer("customer_id").notNull().references(() => customers.id),
    delta: integer("delta").notNull(),
    reason: text("reason", { enum: ["order", "redeem", "referral", "birthday", "manual", "expiry", "reversal"] }).notNull(),
    orderId: integer("order_id"),
    actor: text("actor").notNull(),
    note: text("note"),
    createdAt: createdAt(),
  },
  (t) => [index("loyalty_customer_idx").on(t.customerId)],
);

export const reviews = sqliteTable(
  "reviews",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    productId: integer("product_id").notNull().references(() => products.id, { onDelete: "cascade" }),
    orderId: integer("order_id"),
    name: text("name").notNull(),
    rating: integer("rating").notNull(),
    text: text("text"),
    photos: text("photos", { mode: "json" }).$type<string[]>(),
    verified: bool("verified").notNull().default(false),
    status: text("status", { enum: ["pending", "approved", "rejected"] }).notNull().default("pending"),
    reply: text("reply"),
    isFeatured: bool("is_featured").notNull().default(false),
    createdAt: createdAt(),
  },
  (t) => [
    index("reviews_product_status_idx").on(t.productId, t.status),
    // one verified review per product per order
    uniqueIndex("reviews_order_product_uq").on(t.orderId, t.productId),
  ],
);

export const homeBlocks = sqliteTable("home_blocks", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  type: text("type").notNull(), // hero | announcement | categories | products | reels | countdown | reviews | trust | html
  config: text("config", { mode: "json" }).$type<Record<string, unknown>>().notNull(),
  sort: integer("sort").notNull().default(0),
  startsAt: integer("starts_at"),
  endsAt: integer("ends_at"),
  isActive: bool("is_active").notNull().default(true),
  updatedAt: updatedAt(),
});

export const links = sqliteTable("links", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  kind: text("kind", { enum: ["bio", "short"] }).notNull(),
  slug: text("slug").unique(), // short links: /l/<slug>
  labelFr: text("label_fr"),
  labelAr: text("label_ar"),
  target: text("target").notNull(),
  icon: text("icon"),
  sort: integer("sort").notNull().default(0),
  isActive: bool("is_active").notNull().default(true),
  clicks: integer("clicks").notNull().default(0),
  createdAt: createdAt(),
});

export const pushSubscriptions = sqliteTable("push_subscriptions", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  endpoint: text("endpoint").notNull().unique(),
  p256dh: text("p256dh").notNull(),
  auth: text("auth").notNull(),
  locale: text("locale").notNull().default("fr"),
  tags: text("tags", { mode: "json" }).$type<string[]>().notNull().default(sql`'[]'`),
  createdAt: createdAt(),
});

export const campaigns = sqliteTable("campaigns", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  kind: text("kind", { enum: ["push", "announcement", "popup"] }).notNull(),
  title: text("title").notNull(),
  config: text("config", { mode: "json" }).$type<Record<string, unknown>>().notNull(),
  segment: text("segment", { mode: "json" }).$type<Record<string, unknown>>(),
  scheduledAt: integer("scheduled_at"),
  status: text("status", { enum: ["draft", "scheduled", "sending", "sent", "cancelled"] }).notNull().default("draft"),
  stats: text("stats", { mode: "json" }).$type<Record<string, number>>(),
  createdAt: createdAt(),
});

export const stockAlerts = sqliteTable(
  "stock_alerts",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    variantId: integer("variant_id").notNull().references(() => variants.id, { onDelete: "cascade" }),
    phone: text("phone"),
    pushSubscriptionId: integer("push_subscription_id"),
    notifiedAt: integer("notified_at"),
    createdAt: createdAt(),
  },
  (t) => [index("stock_alerts_variant_idx").on(t.variantId, t.notifiedAt)],
);

export const contactMessages = sqliteTable("contact_messages", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  name: text("name").notNull(),
  phone: text("phone"),
  subject: text("subject"),
  message: text("message").notNull(),
  status: text("status", { enum: ["new", "in_progress", "done", "spam"] }).notNull().default("new"),
  handledBy: integer("handled_by"),
  createdAt: createdAt(),
});

/* ───────────────────────────── Content & system ───────────────────────────── */

export const pages = sqliteTable("pages", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  slug: text("slug").notNull().unique(),
  titleFr: text("title_fr").notNull(),
  titleAr: text("title_ar").notNull(),
  bodyFr: text("body_fr").notNull().default(""),
  bodyAr: text("body_ar").notNull().default(""),
  seoDescription: text("seo_description"),
  isActive: bool("is_active").notNull().default(true),
  updatedAt: updatedAt(),
});

export const settings = sqliteTable("settings", {
  key: text("key").primaryKey(),
  value: text("value", { mode: "json" }).notNull(),
  updatedAt: updatedAt(),
});

export const messageTemplates = sqliteTable("message_templates", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  key: text("key").notNull().unique(), // confirm_order, shipped, cart_recovery, review_request…
  channel: text("channel", { enum: ["whatsapp", "telegram", "push"] }).notNull(),
  bodyFr: text("body_fr").notNull(),
  bodyAr: text("body_ar").notNull(),
});

export const redirects = sqliteTable("redirects", {
  from: text("from").primaryKey(),
  to: text("to").notNull(),
  code: integer("code").notNull().default(301),
});

export const roles = sqliteTable("roles", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  key: text("key").notNull().unique(),
  name: text("name").notNull(),
  permissions: text("permissions", { mode: "json" }).$type<string[]>().notNull(),
});

export const teamMembers = sqliteTable("team_members", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  email: text("email").notNull().unique(),
  name: text("name").notNull(),
  roleId: integer("role_id").notNull().references(() => roles.id),
  telegramUserId: integer("telegram_user_id").unique(),
  phone: text("phone"),
  isActive: bool("is_active").notNull().default(true),
  /**
   * Password storage: the browser stretches the password with PBKDF2-SHA256 (600k iterations,
   * salt derived from the email) and sends only that derived key. The server stores
   * SHA-256(pepper | salt | key). Brute-forcing a leaked hash still costs 600k iterations per
   * guess, while each login costs the Worker microseconds (free plan: 10 ms CPU per request).
   */
  passwordHash: text("password_hash"),
  passwordSalt: text("password_salt"),
  emailVerifiedAt: integer("email_verified_at"),
  failedLogins: integer("failed_logins").notNull().default(0),
  lockedUntil: integer("locked_until"),
  lastSeenAt: integer("last_seen_at"),
  createdAt: createdAt(),
});

export const adminSessions = sqliteTable(
  "admin_sessions",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    memberId: integer("member_id").notNull().references(() => teamMembers.id, { onDelete: "cascade" }),
    tokenHash: text("token_hash").notNull().unique(), // SHA-256 of the cookie value; the token itself is never stored
    userAgent: text("user_agent"),
    ipHash: text("ip_hash"),
    createdAt: createdAt(),
    lastSeenAt: integer("last_seen_at").notNull().default(now),
    expiresAt: integer("expires_at").notNull(),
  },
  (t) => [index("admin_sessions_member_idx").on(t.memberId)],
);

/** One-time email codes and links: login 2nd factor, password reset, team invitations. */
export const authChallenges = sqliteTable(
  "auth_challenges",
  {
    id: text("id").primaryKey(), // random, sent to the browser
    memberId: integer("member_id").notNull().references(() => teamMembers.id, { onDelete: "cascade" }),
    purpose: text("purpose", { enum: ["login", "reset", "invite", "invite_link"] }).notNull(),
    codeHash: text("code_hash").notNull(),
    /** For reset/invite: the new password hash, applied only once the email code is verified. */
    pendingHash: text("pending_hash"),
    pendingSalt: text("pending_salt"),
    remember: bool("remember").notNull().default(false),
    attempts: integer("attempts").notNull().default(0),
    expiresAt: integer("expires_at").notNull(),
    consumedAt: integer("consumed_at"),
    createdAt: createdAt(),
  },
  (t) => [index("auth_challenges_member_idx").on(t.memberId)],
);

export const auditLog = sqliteTable(
  "audit_log",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    actor: text("actor").notNull(),
    action: text("action").notNull(),
    entity: text("entity").notNull(),
    entityId: text("entity_id"),
    diff: text("diff", { mode: "json" }),
    ipHash: text("ip_hash"),
    createdAt: createdAt(),
  },
  (t) => [index("audit_entity_idx").on(t.entity, t.entityId), index("audit_created_idx").on(t.createdAt)],
);

export const errorEvents = sqliteTable(
  "error_events",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    fingerprint: text("fingerprint").notNull().unique(),
    source: text("source", { enum: ["client", "api", "cron", "telegram", "carrier", "push"] }).notNull(),
    message: text("message").notNull(),
    stack: text("stack"),
    url: text("url"),
    count: integer("count").notNull().default(1),
    status: text("status", { enum: ["open", "resolved", "ignored"] }).notNull().default("open"),
    firstSeen: integer("first_seen").notNull().default(now),
    lastSeen: integer("last_seen").notNull().default(now),
  },
  (t) => [index("error_status_idx").on(t.status, t.lastSeen)],
);

export const notFoundLog = sqliteTable("not_found_log", {
  path: text("path").primaryKey(),
  count: integer("count").notNull().default(1),
  referrer: text("referrer"),
  lastSeen: integer("last_seen").notNull().default(now),
});

export const outbox = sqliteTable(
  "outbox",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    kind: text("kind", { enum: ["telegram", "carrier", "push", "capi", "rebuild"] }).notNull(),
    payload: text("payload", { mode: "json" }).notNull(),
    attempts: integer("attempts").notNull().default(0),
    nextAttemptAt: integer("next_attempt_at").notNull().default(now),
    lastError: text("last_error"),
    doneAt: integer("done_at"),
    createdAt: createdAt(),
  },
  (t) => [index("outbox_pending_idx").on(t.doneAt, t.nextAttemptAt)],
);

export const analyticsDaily = sqliteTable(
  "analytics_daily",
  {
    date: text("date").notNull(), // YYYY-MM-DD, Africa/Algiers
    metric: text("metric").notNull(), // product_view, add_to_cart, checkout_start, order…
    dim: text("dim").notNull().default(""), // product id, wilaya, source…
    value: integer("value").notNull().default(0),
  },
  (t) => [primaryKey({ columns: [t.date, t.metric, t.dim] })],
);

export const rateHits = sqliteTable("rate_hits", {
  key: text("key").primaryKey(), // "<bucket>:<subject>:<window>"
  count: integer("count").notNull().default(0),
  expiresAt: integer("expires_at").notNull(),
});

/* ───────────────────────────── A/B tests ───────────────────────────── */

/** One storefront test: two versions shown 50/50, from first visit to order. */
export const experiments = sqliteTable("experiments", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  name: text("name").notNull(),
  /** what changes: the buy button's words, or the product grid */
  kind: text("kind", { enum: ["buy_label", "grid"] }).notNull(),
  /** { a: {...}, b: {...} } settings of each version */
  config: text("config", { mode: "json" }).$type<Record<string, unknown>>().notNull(),
  status: text("status", { enum: ["draft", "running", "stopped"] }).notNull().default("draft"),
  winner: text("winner"),
  startedAt: integer("started_at"),
  endedAt: integer("ended_at"),
  createdAt: createdAt(),
});

/** Daily counts per version and step (seen → product → checkout → order). */
export const experimentStats = sqliteTable(
  "experiment_stats",
  {
    experimentId: integer("experiment_id").notNull().references(() => experiments.id, { onDelete: "cascade" }),
    variant: text("variant").notNull(),
    event: text("event").notNull(),
    day: text("day").notNull(),
    n: integer("n").notNull().default(0),
  },
  (t) => [primaryKey({ columns: [t.experimentId, t.variant, t.event, t.day] })],
);
