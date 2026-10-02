import type { Permission } from "@henine/shared";
import {
  BellRing,
  Boxes,
  ChartColumn,
  FileText,
  Gift,
  LayoutDashboard,
  Link,
  Menu,
  MessageSquare,
  Receipt,
  Settings,
  Shirt,
  ShoppingBag,
  ShoppingCart,
  Sparkles,
  Star,
  TicketPercent,
  TriangleAlert,
  Users,
  UsersRound,
  type LucideIcon,
} from "lucide-react";

export interface NavItem {
  path: string;
  label: string;
  permission: Permission;
  icon: LucideIcon;
}

export interface NavGroup {
  label: string;
  items: NavItem[];
}

export const DASHBOARD = { path: "/", label: "Tableau de bord", icon: LayoutDashboard };

/** Admin menu, grouped exactly as specified by Henine. */
export const NAV: NavGroup[] = [
  {
    label: "Catalogue",
    items: [
      { path: "/produits", label: "Produits", permission: "products.view", icon: Shirt },
      { path: "/stock", label: "Stock", permission: "stock.view", icon: Boxes },
      { path: "/ventes", label: "Ventes", permission: "sales.view", icon: Receipt },
    ],
  },
  {
    label: "Commandes",
    items: [
      { path: "/commandes", label: "Commandes", permission: "orders.view", icon: ShoppingBag },
      { path: "/clients", label: "Clients", permission: "customers.view", icon: Users },
      { path: "/paniers", label: "Paniers", permission: "carts.view", icon: ShoppingCart },
      { path: "/promos", label: "Promos", permission: "promos.edit", icon: TicketPercent },
      { path: "/fidelite", label: "Fidélité", permission: "loyalty.edit", icon: Gift },
    ],
  },
  {
    label: "Marketing",
    items: [
      { path: "/collections", label: "Collections", permission: "marketing.edit", icon: Sparkles },
      { path: "/avis", label: "Avis", permission: "reviews.moderate", icon: Star },
      { path: "/notifier", label: "Notifier", permission: "marketing.edit", icon: BellRing },
      { path: "/liens", label: "Liens", permission: "marketing.edit", icon: Link },
      { path: "/contact", label: "Contact", permission: "contact.view", icon: MessageSquare },
    ],
  },
  {
    label: "Analyse",
    items: [{ path: "/statistiques", label: "Statistiques", permission: "stats.view", icon: ChartColumn }],
  },
  {
    label: "Système",
    items: [
      { path: "/equipe", label: "Équipe", permission: "team.manage", icon: UsersRound },
      { path: "/parametres", label: "Paramètres", permission: "dashboard.view", icon: Settings },
      { path: "/contenu", label: "Contenu", permission: "content.edit", icon: FileText },
      { path: "/erreurs", label: "Erreurs", permission: "errors.view", icon: TriangleAlert },
    ],
  },
];

/** Mobile bottom tab bar: the four daily-use screens + "Plus". */
export const TABS: { path: string; label: string; icon: LucideIcon }[] = [
  { path: "/", label: "Accueil", icon: LayoutDashboard },
  { path: "/commandes", label: "Commandes", icon: ShoppingBag },
  { path: "/produits", label: "Produits", icon: Shirt },
  { path: "/clients", label: "Clients", icon: Users },
  { path: "/plus", label: "Plus", icon: Menu },
];
