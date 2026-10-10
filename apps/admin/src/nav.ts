import type { Permission } from "@henine/shared";
import {
  BellRing,
  Boxes,
  ChartColumn,
  FileText,
  Gift,
  House,
  KeyRound,
  LayoutDashboard,
  Link,
  Menu,
  MessageSquare,
  Receipt,
  Shirt,
  ShoppingBag,
  ShoppingCart,
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
  /** pages opened from inside this tab (no tab of their own): the tab stays highlighted */
  also?: string[];
}

export interface NavGroup {
  label: string;
  items: NavItem[];
}

export const DASHBOARD = { path: "/", label: tr("Tableau de bord"), icon: LayoutDashboard };

/**
 * Admin menu: exactly the owner's list of tabs (2026-10-07). Pages without a tab open from
 * inside the related one: Préparation / Expéditions from Commandes, Collections from Promos,
 * Finance from Statistiques, the in-store sale is in Ventes, Paramètres in the top bar.
 */
export const NAV: NavGroup[] = [
  {
    label: tr("Catalogue"),
    items: [
      { path: "/produits", label: tr("Produits"), permission: "products.view", icon: Shirt },
      { path: "/stock", label: tr("Stock"), permission: "stock.view", icon: Boxes },
      { path: "/ventes", label: tr("Ventes"), permission: "sales.view", icon: Receipt, also: ["/caisse"] },
    ],
  },
  {
    label: tr("Commandes"),
    items: [
      { path: "/commandes", label: tr("Commandes"), permission: "orders.view", icon: ShoppingBag, also: ["/expeditions", "/preparation"] },
      { path: "/clients", label: tr("Clients"), permission: "customers.view", icon: Users },
      { path: "/paniers", label: tr("Paniers"), permission: "carts.view", icon: ShoppingCart },
      { path: "/promos", label: tr("Promos"), permission: "promos.edit", icon: TicketPercent, also: ["/collections"] },
      { path: "/fidelite", label: tr("Fidélité"), permission: "loyalty.edit", icon: Gift },
    ],
  },
  {
    label: tr("Marketing"),
    items: [
      { path: "/accueil", label: tr("Page d'accueil"), permission: "marketing.edit", icon: House },
      { path: "/avis", label: tr("Avis"), permission: "reviews.moderate", icon: Star },
      { path: "/notifier", label: tr("Notifier"), permission: "marketing.edit", icon: BellRing },
      { path: "/liens", label: tr("Liens"), permission: "marketing.edit", icon: Link },
      { path: "/contact", label: tr("Contact"), permission: "contact.view", icon: MessageSquare },
    ],
  },
  {
    label: tr("Analyse"),
    items: [
      { path: "/statistiques", label: tr("Statistiques"), permission: "stats.view", icon: ChartColumn, also: ["/finance", "/sources"] },
    ],
  },
  {
    label: tr("Système"),
    items: [
      { path: "/equipe", label: tr("Équipe"), permission: "team.manage", icon: UsersRound },
      { path: "/comptes", label: tr("Comptes"), permission: "team.manage", icon: KeyRound },
      { path: "/contenu", label: tr("Contenu"), permission: "content.edit", icon: FileText },
      { path: "/erreurs", label: tr("Erreurs"), permission: "errors.view", icon: TriangleAlert },
    ],
  },
];

/** Pages without a tab of their own (breadcrumb + search); see NAV. */
export const INNER_PAGES: { path: string; label: string; group: string; parent: string }[] = [
  { path: "/caisse", label: tr("Vente au magasin"), group: tr("Catalogue"), parent: "/ventes" },
  { path: "/preparation", label: tr("Préparation"), group: tr("Commandes"), parent: "/commandes" },
  { path: "/expeditions", label: tr("Expéditions"), group: tr("Commandes"), parent: "/commandes" },
  { path: "/collections", label: tr("Collections"), group: tr("Commandes"), parent: "/promos" },
  { path: "/finance", label: tr("Finance"), group: tr("Analyse"), parent: "/statistiques" },
  { path: "/sources", label: tr("Sources"), group: tr("Analyse"), parent: "/statistiques" },
  { path: "/parametres", label: tr("Paramètres"), group: tr("Système"), parent: "/parametres" },
];

/** Mobile bottom tab bar: the four daily-use screens + "Plus". */
export const TABS: { path: string; label: string; icon: LucideIcon }[] = [
  { path: "/", label: tr("Accueil"), icon: LayoutDashboard },
  { path: "/commandes", label: tr("Commandes"), icon: ShoppingBag },
  { path: "/produits", label: tr("Produits"), icon: Shirt },
  { path: "/clients", label: tr("Clients"), icon: Users },
  { path: "/plus", label: tr("Plus"), icon: Menu },
];
