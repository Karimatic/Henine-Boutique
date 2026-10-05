/** Permission keys, shared by the API (enforcement) and the admin UI (what to show). */
export const PERMISSIONS = [
  "dashboard.view",
  "orders.view",
  "orders.edit",
  "orders.confirm",
  "orders.ship",
  "orders.export",
  /** give a manual discount on an order */
  "orders.discount",
  "customers.view",
  "customers.edit",
  "customers.export",
  "carts.view",
  "products.view",
  "products.edit",
  "stock.view",
  "stock.edit",
  "cost.view",
  "sales.view",
  "sales.create",
  "promos.edit",
  "loyalty.edit",
  "marketing.edit",
  "reviews.moderate",
  "contact.view",
  "stats.view",
  "content.edit",
  "delivery.edit",
  "publish",
  "errors.view",
  "audit.view",
  "team.manage",
  "integrations.manage",
] as const;

export type Permission = (typeof PERMISSIONS)[number];

export const ROLE_PRESETS: Record<string, { name: string; permissions: readonly (Permission | "*")[] }> = {
  owner: { name: "Propriétaire", permissions: ["*"] },
  manager: {
    name: "Gérante",
    permissions: PERMISSIONS.filter((p) => p !== "team.manage" && p !== "integrations.manage"),
  },
  confirmation: {
    name: "Confirmatrice",
    permissions: ["dashboard.view", "orders.view", "orders.edit", "orders.confirm", "customers.view", "carts.view", "products.view", "stock.view"],
  },
  fulfilment: {
    name: "Préparation / Stock",
    permissions: ["dashboard.view", "orders.view", "orders.ship", "products.view", "stock.view", "stock.edit", "sales.create"],
  },
  marketing: {
    name: "Marketing",
    permissions: [
      "dashboard.view", "products.view", "products.edit", "promos.edit", "loyalty.edit", "marketing.edit",
      "reviews.moderate", "contact.view", "stats.view", "content.edit", "publish",
    ],
  },
  readonly: { name: "Lecture seule", permissions: ["dashboard.view", "stats.view", "orders.view", "products.view"] },
};

export function hasPermission(granted: readonly string[], needed: Permission): boolean {
  return granted.includes("*") || granted.includes(needed);
}
