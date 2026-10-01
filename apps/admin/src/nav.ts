import type { Permission } from "@henine/shared";

export interface NavItem {
  path: string;
  label: string;
  permission: Permission;
}

export interface NavGroup {
  label: string;
  items: NavItem[];
}

/** Admin menu, grouped exactly as specified by Henine. */
export const NAV: NavGroup[] = [
  {
    label: "Catalogue",
    items: [
      { path: "/produits", label: "Produits", permission: "products.view" },
      { path: "/stock", label: "Stock", permission: "stock.view" },
      { path: "/ventes", label: "Ventes", permission: "sales.view" },
    ],
  },
  {
    label: "Commandes",
    items: [
      { path: "/commandes", label: "Commandes", permission: "orders.view" },
      { path: "/clients", label: "Clients", permission: "customers.view" },
      { path: "/paniers", label: "Paniers", permission: "carts.view" },
      { path: "/promos", label: "Promos", permission: "promos.edit" },
      { path: "/fidelite", label: "Fidélité", permission: "loyalty.edit" },
    ],
  },
  {
    label: "Marketing",
    items: [
      { path: "/accueil", label: "Page d'accueil", permission: "marketing.edit" },
      { path: "/collections", label: "Collections", permission: "marketing.edit" },
      { path: "/avis", label: "Avis", permission: "reviews.moderate" },
      { path: "/notifier", label: "Notifier", permission: "marketing.edit" },
      { path: "/liens", label: "Liens", permission: "marketing.edit" },
      { path: "/contact", label: "Contact", permission: "contact.view" },
    ],
  },
  {
    label: "Analyse",
    items: [{ path: "/statistiques", label: "Statistiques", permission: "stats.view" }],
  },
  {
    label: "Système",
    items: [
      { path: "/equipe", label: "Équipe", permission: "team.manage" },
      { path: "/comptes", label: "Comptes", permission: "dashboard.view" },
      { path: "/contenu", label: "Contenu", permission: "content.edit" },
      { path: "/erreurs", label: "Erreurs", permission: "errors.view" },
    ],
  },
];

/** Mobile bottom tab bar: the four daily-use screens + "Plus". */
export const TABS = [
  { path: "/", label: "Accueil", icon: "⌂" },
  { path: "/commandes", label: "Commandes", icon: "🛍" },
  { path: "/produits", label: "Produits", icon: "👗" },
  { path: "/clients", label: "Clients", icon: "👤" },
] as const;
