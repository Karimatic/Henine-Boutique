/**
 * Admin → the search bar at the top of every page: orders, products, customers, promo codes,
 * categories, contact messages and reviews in one answer (one D1 round trip). Each part only
 * comes back when the member may see that section.
 */
import { Hono } from "hono";
import { hasPermission, type OrderStatus, type Permission } from "@henine/shared";
import type { AppEnv } from "../../env";
import { mediaUrl } from "../../lib/catalog";

export const searchRoutes = new Hono<AppEnv>();

export interface AdminSearchResult {
  orders: {
    id: number; public_code: string; name: string; phone: string; status: OrderStatus; total: number; created_at: number;
    channel: string; wilaya_fr: string | null; wilaya_ar: string | null; items: number;
  }[];
  products: {
    id: number; name_fr: string; name_ar: string; status: string; price: number; compare_at_price: number | null; image: string | null;
    category_fr: string | null; category_ar: string | null; available: number; sizes_out: number; sku: string | null;
  }[];
  customers: {
    id: number; name: string; phone: string; orders_count: number; delivered_count: number; returned_count: number; total_spent: number;
    is_blacklisted: number; last_order_at: number | null; wilaya_fr: string | null; wilaya_ar: string | null;
  }[];
  coupons: { id: number; code: string; type: string; value: number; used_count: number; usage_limit: number | null; is_active: number; ends_at: number | null; influencer_name: string | null }[];
  categories: { id: number; name_fr: string; name_ar: string; parent_fr: string | null; parent_ar: string | null; products: number }[];
  messages: { id: number; name: string; phone: string | null; subject: string | null; snippet: string; status: string; created_at: number }[];
  reviews: { id: number; name: string; rating: number; snippet: string | null; status: string; product_fr: string; product_ar: string; created_at: number }[];
  /** how many match in all (the lists stop at 8) */
  totals: { orders: number; products: number; customers: number };
}

const LIMIT = 8;
type Section = Exclude<keyof AdminSearchResult, "totals">;

searchRoutes.get("/search", async (c) => {
  const q = (c.req.query("q") ?? "").trim().slice(0, 60);
  const out: AdminSearchResult = { orders: [], products: [], customers: [], coupons: [], categories: [], messages: [], reviews: [], totals: { orders: 0, products: 0, customers: 0 } };
  if (q.length < 2) return c.json(out);
  const can = (p: Permission) => hasPermission(c.get("member")!.permissions, p);
  // "0554 65 07 18", "+213 554…" → the digits as stored (0XXXXXXXXX)
  const digits = q.replace(/\D/g, "").replace(/^213/, "0");
  // ?1 anywhere in the text · ?2 exactly · ?3 phone digits (or null) · ?4 upper case (codes)
  const binds = [`%${q}%`, q, digits.length >= 3 ? `%${digits}%` : null, `%${q.toUpperCase()}%`];

  const ORDER_WHERE = "o.public_code LIKE ?4 OR o.name LIKE ?1 OR (?3 IS NOT NULL AND o.phone LIKE ?3) OR o.tracking_number = ?2 OR o.coupon_code = UPPER(?2)";
  const PRODUCT_WHERE = `p.status != 'archived' AND (p.name_fr LIKE ?1 OR p.name_ar LIKE ?1 OR p.slug LIKE ?1
    OR EXISTS (SELECT 1 FROM variants v WHERE v.product_id = p.id AND (v.sku LIKE ?1 OR v.barcode = ?2)))`;
  const CUSTOMER_WHERE = "c.name LIKE ?1 OR (?3 IS NOT NULL AND c.phone LIKE ?3)";

  const queries: [Section | `${"orders" | "products" | "customers"}#`, string][] = [];
  if (can("orders.view")) {
    queries.push(
      ["orders", `SELECT o.id, o.public_code, o.name, o.phone, o.status, o.total, o.created_at, o.channel, w.name_fr AS wilaya_fr, w.name_ar AS wilaya_ar,
                (SELECT COALESCE(SUM(i.qty), 0) FROM order_items i WHERE i.order_id = o.id) AS items
         FROM orders o LEFT JOIN wilayas w ON w.code = o.wilaya_code WHERE ${ORDER_WHERE} ORDER BY o.created_at DESC LIMIT ${LIMIT}`],
      ["orders#", `SELECT COUNT(*) AS n FROM orders o WHERE ${ORDER_WHERE}`],
    );
  }
  if (can("products.view")) {
    queries.push(
      ["products", `SELECT p.id, p.name_fr, p.name_ar, p.status, p.price, p.compare_at_price, k.name_fr AS category_fr, k.name_ar AS category_ar,
                (SELECT base_key FROM product_images i WHERE i.product_id = p.id ORDER BY sort, id LIMIT 1) AS image_key,
                (SELECT COALESCE(SUM(v.stock_on_hand - v.stock_reserved), 0) FROM variants v WHERE v.product_id = p.id AND v.is_active = 1) AS available,
                (SELECT COUNT(*) FROM variants v WHERE v.product_id = p.id AND v.is_active = 1 AND v.stock_on_hand - v.stock_reserved <= 0) AS sizes_out,
                (SELECT v.sku FROM variants v WHERE v.product_id = p.id AND (v.sku LIKE ?1 OR v.barcode = ?2) LIMIT 1) AS sku
         FROM products p LEFT JOIN categories k ON k.id = p.category_id WHERE ${PRODUCT_WHERE} ORDER BY p.updated_at DESC LIMIT ${LIMIT}`],
      ["products#", `SELECT COUNT(*) AS n FROM products p WHERE ${PRODUCT_WHERE}`],
      ["categories", `SELECT k.id, k.name_fr, k.name_ar, pk.name_fr AS parent_fr, pk.name_ar AS parent_ar,
                (SELECT COUNT(*) FROM products p WHERE p.status != 'archived' AND (p.category_id = k.id OR p.category_id IN (SELECT id FROM categories s WHERE s.parent_id = k.id))) AS products
         FROM categories k LEFT JOIN categories pk ON pk.id = k.parent_id
         WHERE k.name_fr LIKE ?1 OR k.name_ar LIKE ?1 OR k.slug LIKE ?1 ORDER BY k.sort LIMIT 5`],
    );
  }
  if (can("customers.view")) {
    queries.push(
      ["customers", `SELECT c.id, c.name, c.phone, c.orders_count, c.delivered_count, c.returned_count, c.total_spent, c.is_blacklisted, c.last_order_at,
                w.name_fr AS wilaya_fr, w.name_ar AS wilaya_ar
         FROM customers c LEFT JOIN wilayas w ON w.code = c.wilaya_code WHERE ${CUSTOMER_WHERE} ORDER BY c.last_order_at DESC LIMIT ${LIMIT}`],
      ["customers#", `SELECT COUNT(*) AS n FROM customers c WHERE ${CUSTOMER_WHERE}`],
    );
  }
  if (can("promos.edit")) {
    queries.push(["coupons", `SELECT id, code, type, value, used_count, usage_limit, is_active, ends_at, influencer_name FROM coupons
       WHERE code LIKE ?4 OR influencer_name LIKE ?1 ORDER BY is_active DESC, id DESC LIMIT 5`]);
  }
  if (can("contact.view")) {
    queries.push(["messages", `SELECT id, name, phone, subject, SUBSTR(message, 1, 140) AS snippet, status, created_at FROM contact_messages
       WHERE name LIKE ?1 OR subject LIKE ?1 OR message LIKE ?1 OR (?3 IS NOT NULL AND phone LIKE ?3) ORDER BY created_at DESC LIMIT 5`]);
  }
  if (can("reviews.moderate")) {
    queries.push(["reviews", `SELECT r.id, r.name, r.rating, SUBSTR(r.text, 1, 140) AS snippet, r.status, r.created_at, p.name_fr AS product_fr, p.name_ar AS product_ar
       FROM reviews r JOIN products p ON p.id = r.product_id
       WHERE r.name LIKE ?1 OR r.text LIKE ?1 OR p.name_fr LIKE ?1 OR p.name_ar LIKE ?1 ORDER BY r.created_at DESC LIMIT 5`]);
  }
  if (!queries.length) return c.json(out);

  // each statement gets only the numbered parameters it uses
  const stmt = (sql: string) => {
    const used = Math.max(...[...sql.matchAll(/\?(\d)/g)].map((m) => Number(m[1])));
    return c.env.DB.prepare(sql).bind(...binds.slice(0, used));
  };
  const results = await c.env.DB.batch(queries.map(([, sql]) => stmt(sql)));
  queries.forEach(([key], i) => {
    const rows = results[i]!.results as Record<string, unknown>[];
    if (key.endsWith("#")) out.totals[key.slice(0, -1) as keyof AdminSearchResult["totals"]] = Number(rows[0]?.n ?? 0);
    else (out as unknown as Record<string, unknown[]>)[key] = rows;
  });
  out.products = out.products.map((p) => {
    const { image_key, ...rest } = p as typeof p & { image_key?: string | null };
    return { ...rest, image: image_key ? mediaUrl(c.env, image_key).replace("{w}", "160") : null };
  });
  return c.json(out);
});
