/**
 * Admin → the search bar at the top of every page: orders, products and customers in one
 * answer. Each part only comes back when the member may see that section.
 */
import { Hono } from "hono";
import { hasPermission, type OrderStatus } from "@henine/shared";
import type { AppEnv } from "../../env";
import { mediaUrl } from "../../lib/catalog";

export const searchRoutes = new Hono<AppEnv>();

export interface AdminSearchResult {
  orders: { id: number; public_code: string; name: string; phone: string; status: OrderStatus; total: number; created_at: number }[];
  products: { id: number; name_fr: string; name_ar: string; status: string; price: number; image: string | null }[];
  customers: { id: number; name: string; phone: string; orders_count: number }[];
}

searchRoutes.get("/search", async (c) => {
  const q = (c.req.query("q") ?? "").trim().slice(0, 60);
  const out: AdminSearchResult = { orders: [], products: [], customers: [] };
  if (q.length < 2) return c.json(out);
  const can = (p: Parameters<typeof hasPermission>[1]) => hasPermission(c.get("member")!.permissions, p);
  const like = `%${q}%`;
  // "0554 65 07 18", "+213 554…" → the digits as stored (0XXXXXXXXX)
  const digits = q.replace(/\D/g, "").replace(/^213/, "0");
  const phone = digits.length >= 3 ? `%${digits}%` : null;

  const [orders, products, customers] = await Promise.all([
    can("orders.view")
      ? c.env.DB.prepare(
          `SELECT id, public_code, name, phone, status, total, created_at FROM orders
           WHERE public_code LIKE ? OR name LIKE ? OR (? IS NOT NULL AND phone LIKE ?) OR tracking_number = ?
           ORDER BY created_at DESC LIMIT 6`,
        )
          .bind(`%${q.toUpperCase()}%`, like, phone, phone, q)
          .all<AdminSearchResult["orders"][number]>()
      : null,
    can("products.view")
      ? c.env.DB.prepare(
          `SELECT p.id, p.name_fr, p.name_ar, p.status, p.price,
                  (SELECT base_key FROM product_images i WHERE i.product_id = p.id ORDER BY sort, id LIMIT 1) AS image_key
           FROM products p
           WHERE p.status != 'archived'
             AND (p.name_fr LIKE ? OR p.name_ar LIKE ? OR p.slug LIKE ? OR EXISTS (SELECT 1 FROM variants v WHERE v.product_id = p.id AND v.sku LIKE ?))
           ORDER BY p.updated_at DESC LIMIT 6`,
        )
          .bind(like, like, like, like)
          .all<Omit<AdminSearchResult["products"][number], "image"> & { image_key: string | null }>()
      : null,
    can("customers.view")
      ? c.env.DB.prepare(
          `SELECT c.id, c.name, c.phone, (SELECT COUNT(*) FROM orders o WHERE o.customer_id = c.id) AS orders_count
           FROM customers c WHERE c.name LIKE ? OR (? IS NOT NULL AND c.phone LIKE ?)
           ORDER BY c.id DESC LIMIT 5`,
        )
          .bind(like, phone, phone)
          .all<AdminSearchResult["customers"][number]>()
      : null,
  ]);
  out.orders = orders?.results ?? [];
  out.products = (products?.results ?? []).map(({ image_key, ...p }) => ({
    ...p,
    image: image_key ? mediaUrl(c.env, image_key).replace("{w}", "160") : null,
  }));
  out.customers = customers?.results ?? [];
  return c.json(out);
});
