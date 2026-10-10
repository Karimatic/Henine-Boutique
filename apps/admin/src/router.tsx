import { createRootRoute, createRoute, createRouter, lazyRouteComponent, Outlet } from "@tanstack/react-router";
import { ForgotPage, InvitationPage, LoginPage } from "./pages/auth/AuthPages";
import { Dashboard } from "./pages/Dashboard";
import { RouteError } from "./lib/update";
import { MoreMenu, Shell } from "./Shell";

// Each screen is its own chunk: the phone only downloads the screens it opens.
type Loader = () => Promise<Record<string, unknown>>;
const lazy = (load: Loader, name: string) => lazyRouteComponent(load as () => Promise<Record<string, () => React.ReactNode>>, name);
const Products: Loader = () => import("./pages/Products");
const Customers: Loader = () => import("./pages/Customers");
const Marketing: Loader = () => import("./pages/Marketing");
const System: Loader = () => import("./pages/System");
const Settings: Loader = () => import("./pages/Settings");

// a page that fails to load (e.g. an old open tab after an update) reloads instead of a blank error
const rootRoute = createRootRoute({ component: Outlet, errorComponent: RouteError });

// Public (no session): login, invitation, password reset
const publicRoutes = [
  createRoute({ getParentRoute: () => rootRoute, path: "/connexion", component: LoginPage }),
  createRoute({ getParentRoute: () => rootRoute, path: "/invitation", component: InvitationPage }),
  createRoute({ getParentRoute: () => rootRoute, path: "/mot-de-passe-oublie", component: ForgotPage }),
];

// Printable pages: no sidebar / header around them
const printRoutes = [
  createRoute({ getParentRoute: () => rootRoute, path: "/bordereaux", component: lazy(() => import("./pages/Slips"), "SlipsPage") as () => React.ReactNode }),
  createRoute({ getParentRoute: () => rootRoute, path: "/facture", component: lazy(() => import("./pages/Invoice"), "InvoicePage") as () => React.ReactNode }),
  createRoute({ getParentRoute: () => rootRoute, path: "/manifeste", component: lazy(() => import("./pages/Logistics"), "ManifestPrintPage") as () => React.ReactNode }),
];

// Everything else lives inside the authenticated shell
const shellRoute = createRoute({ getParentRoute: () => rootRoute, id: "app", component: Shell });
const page = (path: string, component: unknown) => createRoute({ getParentRoute: () => shellRoute, path, component: component as () => React.ReactNode });

const appRoutes = [
  page("/", Dashboard),
  page("/plus", MoreMenu),
  page("/produits", lazy(Products, "ProductsPage")),
  page("/produits/nouveau", lazy(() => import("./pages/ProductWizard"), "ProductWizard")),
  page("/produits/nouveau-complet", lazy(Products, "ProductEditor")),
  page("/produits/$id", lazy(Products, "ProductEditor")),
  page("/stock", lazy(() => import("./pages/Stock"), "StockPage")),
  page("/stock/reception", lazy(() => import("./pages/Stock"), "ReceptionPage")),
  page("/stock/inventaire", lazy(() => import("./pages/StockCount"), "StockCountsPage")),
  page("/stock/inventaire/$id", lazy(() => import("./pages/StockCount"), "StockCountPage")),
  page("/ventes", lazy(() => import("./pages/Sales"), "SalesPage")),
  page("/caisse", lazy(() => import("./pages/Cashier"), "CashierPage")),
  page("/preparation", lazy(() => import("./pages/Packing"), "PackingPage")),
  page("/commandes", lazy(() => import("./pages/Orders"), "OrdersPage")),
  page("/expeditions", lazy(() => import("./pages/Logistics"), "LogisticsPage")),
  page("/clients", lazy(Customers, "CustomersPage")),
  page("/paniers", lazy(Customers, "CartsPage")),
  page("/promos", lazy(Marketing, "PromosPage")),
  page("/fidelite", lazy(Customers, "LoyaltyPage")),
  page("/accueil", lazy(Settings, "HomeSettingsPage")),
  page("/avis", lazy(Marketing, "ReviewsPage")),
  page("/notifier", lazy(Marketing, "NotifierPage")),
  page("/liens", lazy(Marketing, "LinksPage")),
  page("/collections", lazy(Marketing, "CollectionsPage")),
  page("/contact", lazy(Marketing, "ContactPage")),
  page("/marketing", lazy(() => import("./pages/SectionHub"), "SectionHub")),
  page("/analyse", lazy(() => import("./pages/SectionHub"), "SectionHub")),
  page("/statistiques", lazy(() => import("./pages/Stats"), "StatsPage")),
  page("/finance", lazy(() => import("./pages/Finance"), "FinancePage")),
  page("/sources", lazy(() => import("./pages/Sources"), "SourcesPage")),
  page("/equipe", lazy(System, "TeamPage")),
  page("/comptes", lazy(() => import("./pages/Accounts"), "AccountsPage")),
  page("/parametres", lazy(Settings, "SettingsPage")),
  page("/contenu", lazy(System, "ContentPage")),
  page("/erreurs", lazy(System, "ErrorsPage")),
];

export const router = createRouter({
  routeTree: rootRoute.addChildren([...publicRoutes, ...printRoutes, shellRoute.addChildren(appRoutes)]),
  basepath: "/admin",
  defaultErrorComponent: RouteError,
  defaultPreload: "intent",
  // ?o=12 style params: parse numbers so links like search={{ o: id }} round-trip
  parseSearch: (s) => Object.fromEntries([...new URLSearchParams(s)].map(([k, v]) => [k, /^\d+$/.test(v) ? Number(v) : v])),
  stringifySearch: (o) => {
    const p = new URLSearchParams();
    for (const [k, v] of Object.entries(o)) if (v !== undefined && v !== null && v !== "") p.set(k, String(v));
    const s = p.toString();
    return s ? `?${s}` : "";
  },
});
