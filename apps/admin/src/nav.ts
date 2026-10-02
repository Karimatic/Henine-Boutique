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
import { tr } from "./i18n";

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

export const DASHBOARD = { path: "/", label: tr("Tableau de bord"), icon: LayoutDashboard };

/** Admin menu, grouped exactly as specified by Henine. */
export const NAV: NavGroup[] = [
  {
    label: tr("Catalogue"),
    items: [
      { path: "/produits", label: tr("Produits"), permission: "products.view", icon: Shirt },
      { path: "/stock", label: tr("Stock"), permission: "stock.view", icon: Boxes },
      { path: "/ventes", label: tr("Ventes"), permission: "sales.view", icon: Receipt },
    ],
  },
  {
    label: tr("Commandes"),
    items: [
      { path: "/commandes", label: tr("Commandes"), permission: "orders.view", icon: ShoppingBag },
      { path: "/clients", label: tr("Clients"), permission: "customers.view", icon: Users },
      { path: "/paniers", label: tr("Paniers"), permission: "carts.view", icon: ShoppingCart },
      { path: "/promos", label: tr("Promos"), permission: "promos.edit", icon: TicketPercent },
      { path: "/fidelite", label: tr("Fidélité"), permission: "loyalty.edit", icon: Gift },
    ],
  },
  {
    label: tr("Marketing"),
    items: [
      { path: "/collections", label: tr("Collections"), permission: "marketing.edit", icon: Sparkles },
      { path: "/avis", label: tr("Avis"), permission: "reviews.moderate", icon: Star },
      { path: "/notifier", label: tr("Notifier"), permission: "marketing.edit", icon: BellRing },
      { path: "/liens", label: tr("Liens"), permission: "marketing.edit", icon: Link },
      { path: "/contact", label: tr("Contact"), permission: "contact.view", icon: MessageSquare },
    ],
  },
  {
    label: tr("Analyse"),
    items: [{ path: "/statistiques", label: tr("Statistiques"), permission: "stats.view", icon: ChartColumn }],
  },
  {
    label: tr("Système"),
    items: [
      { path: "/equipe", label: tr("Équipe"), permission: "team.manage", icon: UsersRound },
      { path: "/parametres", label: tr("Paramètres"), permission: "dashboard.view", icon: Settings },
      { path: "/contenu", label: tr("Contenu"), permission: "content.edit", icon: FileText },
      { path: "/erreurs", label: tr("Erreurs"), permission: "errors.view", icon: TriangleAlert },
    ],
  },
];

/** Mobile bottom tab bar: the four daily-use screens + "Plus". */
export const TABS: { path: string; label: string; icon: LucideIcon }[] = [
  { path: "/", label: tr("Accueil"), icon: LayoutDashboard },
  { path: "/commandes", label: tr("Commandes"), icon: ShoppingBag },
  { path: "/produits", label: tr("Produits"), icon: Shirt },
  { path: "/clients", label: tr("Clients"), icon: Users },
  { path: "/plus", label: tr("Plus"), icon: Menu },
];
