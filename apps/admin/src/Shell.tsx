import { hasPermission } from "@henine/shared";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, Outlet, useRouterState } from "@tanstack/react-router";
import { ChevronRight, ExternalLink, KeyRound, LogOut, Menu, Moon, PanelLeft, Settings, Store, Sun, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { api, ApiError, auth, post, type Me } from "./api";
import { Wordmark } from "./brand";
import { DASHBOARD, INNER_PAGES, NAV, TABS, type NavGroup } from "./nav";
import { useColorMode } from "./lib/colorMode";
import { UpdateBar } from "./lib/update";
import { LiveProvider, useLive } from "./lib/live";
import { AlertsBell } from "./lib/alerts";
import { GlobalSearch } from "./lib/search";
import { useFindOnPage } from "./lib/find";
import { tr } from "./i18n";
import { installAutoTranslate } from "./lib/autoTranslate";
import { OwnerCtx, useToast } from "./ui";

export function useMe() {
  return useQuery({ queryKey: ["me"], queryFn: () => api<Me>("/me"), staleTime: 5 * 60_000, retry: false });
}

export function useCan() {
  const me = useMe();
  return (permission: Parameters<typeof hasPermission>[1]) => !!me.data && hasPermission(me.data.permissions, permission);
}

export function visibleNav(me: Me | undefined): NavGroup[] {
  if (!me) return [];
  return NAV.map((g) => ({ ...g, items: g.items.filter((i) => hasPermission(me.permissions, i.permission)) })).filter((g) => g.items.length > 0);
}

async function logout() {
  await auth("/logout", {}).catch(() => undefined);
  location.href = "/admin/connexion";
}

/**
 * Development only: there's no public URL for Telegram to call, so while the admin is open we
 * pull button presses from Telegram every few seconds (production uses a webhook instead).
 */
function useDevTelegramPolling(me: Me | undefined) {
  const qc = useQueryClient();
  useEffect(() => {
    if (!me?.dev || !me.telegramConfigured) return;
    let stop = false;
    const tick = async () => {
      if (stop || document.hidden) return;
      try {
        const r = await post<{ updates: number }>("/dev/telegram-poll");
        if (r.updates > 0) void qc.invalidateQueries();
      } catch {
        /* ignore */
      }
    };
    const id = setInterval(tick, 4000);
    void tick();
    return () => {
      stop = true;
      clearInterval(id);
    };
  }, [me?.dev, me?.telegramConfigured, qc]);
}

/** Current path inside the admin ("/commandes"), whatever the router reports for the basepath. */
function useAdminPath(): string {
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  return pathname.replace(/^\/admin(?=\/|$)/, "") || "/";
}

/** Breadcrumb for the current screen: "Commandes › Clients", "Catalogue › Produits"… */
function useCrumbs(path: string): string[] {
  if (path === "/") return [DASHBOARD.label];
  if (path === "/plus") return [tr("Menu")];
  const section = NAV.find((g) => g.path === path);
  if (section) return [section.label];
  const inner = INNER_PAGES.find((i) => path === i.path || path.startsWith(`${i.path}/`));
  if (inner) {
    const parent = NAV.flatMap((g) => g.items).find((i) => i.path === inner.parent);
    return parent ? [inner.group, parent.label, inner.label] : [inner.group, inner.label];
  }
  for (const g of NAV) {
    const item = [...g.items].sort((a, b) => b.path.length - a.path.length).find((i) => path === i.path || path.startsWith(`${i.path}/`));
    if (item) return path === item.path ? [g.label, item.label] : [g.label, item.label, path.endsWith("/nouveau") ? tr("Nouveau") : tr("Fiche")];
  }
  return [];
}

const initials = (name: string) =>
  name
    .replace(/[^\p{L}\s]/gu, " ") // "Design (temporaire)" → D T, never "D("
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]!.toUpperCase())
    .join("");

const SIDEBAR_KEY = "henine.admin.sidebar";

/* ───────────── Sidebar ───────────── */

/** Red counter of new storefront orders (live). */
function NewBadge({ className = "" }: { className?: string }) {
  const { unseen } = useLive();
  if (!unseen) return null;
  return (
    <span className={`grid min-w-5 place-items-center rounded-full bg-red-600 px-1 text-[10px] font-bold leading-5 text-white ${className}`} aria-label={tr("{0} nouvelle(s) commande(s)", { 0: unseen })}>
      {unseen > 99 ? "99+" : unseen}
    </span>
  );
}

function SidebarNav({ groups, collapsed, onNavigate }: { groups: NavGroup[]; collapsed: boolean; onNavigate?: () => void }) {
  const path = useAdminPath();
  const item = (to: string, label: string, Icon: typeof DASHBOARD.icon, exact = false, also: string[] = []) => (
    <Link
      key={to}
      to={to}
      onClick={onNavigate}
      activeOptions={{ exact }}
      title={collapsed ? label : undefined}
      // pages opened from inside this tab keep it highlighted
      className={`${also.some((a) => path === a || path.startsWith(`${a}/`)) ? "active " : ""}group flex h-9 items-center gap-2.5 rounded-lg text-sm text-ink hover:bg-ivory-deep [&.active]:bg-plum-600/10 [&.active]:text-plum-700 ${collapsed ? "justify-center px-0" : "px-2.5"}`}
    >
      <span className="relative">
        {/* icon and text change together, at once: no fade of one before the other */}
        <Icon className="size-[18px] shrink-0 text-ink-soft group-hover:text-plum-600 group-[.active]:text-plum-600" strokeWidth={1.8} />
        {collapsed && to === "/commandes" && <NewBadge className="absolute -end-2.5 -top-2" />}
      </span>
      {!collapsed && <span className="truncate">{label}</span>}
      {!collapsed && to === "/commandes" && <NewBadge className="ms-auto" />}
    </Link>
  );
  return (
    <nav className="space-y-5" aria-label={tr("Menu de l'administration")}>
      <div>{item(DASHBOARD.path, DASHBOARD.label, DASHBOARD.icon, true)}</div>
      {groups.map((g) => (
        <div key={g.label}>
          {collapsed ? (
            <div className="mx-auto mb-2 h-px w-6 bg-line" aria-hidden="true" />
          ) : (
            g.path ? (
              // a section that is a tab too (Marketing, Analyse)
              <Link
                to={g.path}
                className="mb-1.5 flex items-center justify-between rounded-md px-2.5 py-0.5 text-xs font-medium uppercase tracking-wider text-ink-soft/70 hover:text-plum-600 [&.active]:text-plum-600"
              >
                {g.label}
                <ChevronRight className="size-3.5 rtl:rotate-180" />
              </Link>
            ) : (
              <p className="mb-1.5 px-2.5 text-xs font-medium uppercase tracking-wider text-ink-soft/70">{g.label}</p>
            )
          )}
          <div className="space-y-0.5">{g.items.map((i) => item(i.path, i.label, i.icon, false, i.also))}</div>
        </div>
      ))}
    </nav>
  );
}

/* ───────────── Profile menu ───────────── */

function ProfileMenu({ me }: { me: Me }) {
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent | KeyboardEvent) => {
      if (e instanceof KeyboardEvent ? e.key === "Escape" : !box.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", close);
    document.addEventListener("keydown", close);
    return () => {
      document.removeEventListener("mousedown", close);
      document.removeEventListener("keydown", close);
    };
  }, [open]);
  const avatar = (cls: string) => (
    <span className={`relative grid shrink-0 place-items-center rounded-full bg-gradient-to-br from-rose-500 via-plum-600 to-plum-700 font-semibold text-white ${cls}`}>
      {initials(me.name)}
      <span className="absolute bottom-0 end-0 block size-2.5 rounded-full bg-emerald-500 ring-2 ring-white" />
    </span>
  );
  return (
    <div ref={box} className="relative">
      <button type="button" onClick={() => setOpen((o) => !o)} aria-haspopup="menu" aria-expanded={open} aria-label={tr("Mon profil")} className="rounded-full">
        {avatar("size-9 text-sm")}
      </button>
      {open && (
        <div role="menu" className="animate-pop absolute end-0 top-11 z-50 w-64 overflow-hidden rounded-xl border border-line bg-surface p-1.5 shadow-lg">
          <div className="flex items-center gap-3 px-2.5 py-2.5">
            {avatar("size-10 text-sm")}
            <div className="min-w-0">
              <p className="truncate font-semibold">{me.name}</p>
              <p className="truncate text-xs text-ink-soft">{me.email}</p>
              <p className="mt-0.5 inline-block rounded-md bg-rose-100 px-1.5 text-[11px] font-semibold text-plum-700">{me.roleName}</p>
            </div>
          </div>
          <div className="my-1 h-px bg-line" />
          <Link to="/parametres" search={{ tab: "compte" }} role="menuitem" onClick={() => setOpen(false)} className="flex h-9 items-center gap-2.5 rounded-lg px-2.5 text-sm hover:bg-rose-100/70">
            <KeyRound className="size-4 text-ink-soft" /> {tr("Mon compte")}
          </Link>
          <Link to="/parametres" role="menuitem" onClick={() => setOpen(false)} className="flex h-9 items-center gap-2.5 rounded-lg px-2.5 text-sm hover:bg-rose-100/70">
            <Settings className="size-4 text-ink-soft" /> {tr("Paramètres")}
          </Link>
          <a href="/" target="_blank" rel="noreferrer" role="menuitem" className="flex h-9 items-center gap-2.5 rounded-lg px-2.5 text-sm hover:bg-rose-100/70">
            <ExternalLink className="size-4 text-ink-soft" /> {tr("Voir la boutique")}
          </a>
          <div className="my-1 h-px bg-line" />
          <button type="button" role="menuitem" onClick={logout} className="flex h-9 w-full items-center gap-2.5 rounded-lg px-2.5 text-sm text-red-700 hover:bg-red-50">
            <LogOut className="size-4" /> {tr("Déconnexion")}
          </button>
        </div>
      )}
    </div>
  );
}

/* ───────────── Shell ───────────── */

/**
 * On a phone, tab rows scroll sideways: bring the chosen tab into view (Paramètres → Mon compte,
 * Finance → Dépenses…) instead of leaving it hidden past the edge.
 */
function useRevealSelectedTabs() {
  const where = useRouterState({ select: (s) => s.location.href });
  useEffect(() => {
    const reveal = () => {
      for (const el of document.querySelectorAll<HTMLElement>('main [aria-selected="true"], main [aria-current="page"], main [aria-pressed="true"]')) {
        const box = el.closest<HTMLElement>(".overflow-x-auto");
        if (!box) continue;
        const b = box.getBoundingClientRect();
        const r = el.getBoundingClientRect();
        if (r.left < b.left) box.scrollLeft -= b.left - r.left + 16;
        else if (r.right > b.right) box.scrollLeft += r.right - b.right + 16;
      }
    };
    // again once the page's data (and its tabs) have loaded
    const timers = [50, 400, 1200].map((ms) => setTimeout(reveal, ms));
    return () => timers.forEach(clearTimeout);
  }, [where]);
}

export function Shell() {
  const me = useMe();
  useDevTelegramPolling(me.data);
  const path = useAdminPath();
  const crumbs = useCrumbs(path);
  // ?find=… (from the search bar): scroll to that feature and make it glow
  useFindOnPage();
  useRevealSelectedTabs();
  // French ↔ Arabic fields fill each other (lib/autoTranslate.ts)
  const toast = useToast();
  useEffect(
    () =>
      installAutoTranslate(
        (to) => toast(to === "ar" ? tr("✨ Traduit automatiquement en arabe") : tr("✨ Traduit automatiquement en français")),
        () => toast(tr("Traduction automatique indisponible pour le moment : remplissez l'autre langue à la main."), "error"),
      ),
    [], // eslint-disable-line react-hooks/exhaustive-deps
  );
  const [collapsed, setCollapsed] = useState(() => {
    try {
      return localStorage.getItem(SIDEBAR_KEY) === "collapsed";
    } catch {
      return false;
    }
  });
  const [drawer, setDrawer] = useState(false);
  useEffect(() => setDrawer(false), [path]);
  useEffect(() => {
    if (!drawer) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setDrawer(false);
    document.addEventListener("keydown", onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = prev;
    };
  }, [drawer]);

  if (me.isPending) return <ShellSkeleton />;
  if (me.error) {
    if (me.error instanceof ApiError && me.error.status === 401) return <ShellSkeleton />; // redirecting to login
    return <AccessProblem error={me.error} />;
  }
  const groups = visibleNav(me.data);
  const canOrders = hasPermission(me.data.permissions, "orders.view");
  const toggle = () => {
    // desktop: rail ↔ full sidebar; phones: slide-in sidebar
    if (window.matchMedia("(min-width: 768px)").matches) {
      setCollapsed((c) => {
        try {
          localStorage.setItem(SIDEBAR_KEY, c ? "open" : "collapsed");
        } catch {
          /* private mode */
        }
        return !c;
      });
    } else setDrawer(true);
  };

  return (
    <OwnerCtx.Provider value={me.data.role === "owner"}>
    <LiveProvider enabled={canOrders}>
    <div className="flex min-h-dvh">
      {/* Desktop sidebar (full or icon rail) */}
      <aside
        className={`sticky top-0 hidden h-dvh shrink-0 flex-col border-e border-line bg-sidebar md:flex ${collapsed ? "w-[4.25rem]" : "w-64"}`}
      >
        <Link to="/" className={`flex h-16 shrink-0 items-center ${collapsed ? "justify-center" : "px-4"}`}>
          <Wordmark size="sm" subtitle={tr("Administration")} iconOnly={collapsed} badge />
        </Link>
        <div className={`flex-1 overflow-y-auto py-4 ${collapsed ? "px-2" : "px-3"}`}>
          <SidebarNav groups={groups} collapsed={collapsed} />
        </div>
        {me.data.dev && !collapsed && (
          <p className="m-3 rounded-lg bg-amber-100 px-2.5 py-1.5 text-xs font-medium text-amber-900">{tr("Mode développement")}</p>
        )}
      </aside>

      {/* Phone sidebar */}
      {drawer &&
        createPortal(
          <div className="fixed inset-0 z-50 md:hidden" role="dialog" aria-modal="true" aria-label={tr("Menu")}>
            <button type="button" aria-label={tr("Fermer")} className="animate-fade absolute inset-0 bg-noir/40" onClick={() => setDrawer(false)} />
            <aside className="animate-drawer absolute inset-y-0 start-0 flex w-[min(18rem,86vw)] flex-col bg-surface shadow-2xl">
              <div className="flex h-16 shrink-0 items-center justify-between border-b border-line/60 px-4">
                <Wordmark size="sm" subtitle={tr("Administration")} />
                <button type="button" onClick={() => setDrawer(false)} aria-label={tr("Fermer")} className="grid size-9 place-items-center rounded-lg hover:bg-rose-100">
                  <X className="size-5" />
                </button>
              </div>
              <div className="flex-1 overflow-y-auto px-3 py-4">
                <SidebarNav groups={groups} collapsed={false} onNavigate={() => setDrawer(false)} />
              </div>
            </aside>
          </div>,
          document.body,
        )}

      <div className="flex min-w-0 flex-1 flex-col pb-[calc(4rem+env(safe-area-inset-bottom))] md:pb-0">
        <header className="sticky top-0 z-30 border-b border-line bg-surface/90 backdrop-blur">
          <div className="mx-auto flex h-14 max-w-[90rem] items-center justify-between gap-3 px-3 sm:px-6 md:h-16">
            <div className="flex min-w-0 items-center gap-2 sm:gap-3">
              <button type="button" onClick={toggle} aria-label={tr("Afficher / masquer le menu")} className="grid size-9 shrink-0 place-items-center rounded-lg text-ink-soft hover:bg-rose-100 hover:text-plum-700">
                <PanelLeft className="hidden size-5 md:block" />
                <Menu className="size-5 md:hidden" />
              </button>
              <span className="hidden h-4 w-px bg-line sm:block" aria-hidden="true" />
              {/* narrow phones: the flower only, so the buttons on the other side keep their room */}
              <Link to="/" className="md:hidden" aria-label={tr("Tableau de bord")}>
                <span className="min-[480px]:hidden">
                  <Wordmark size="sm" iconOnly />
                </span>
                <span className="hidden min-[480px]:block">
                  <Wordmark size="sm" />
                </span>
              </Link>
              <ol className="hidden min-w-0 items-center gap-1.5 text-sm sm:flex" aria-label={tr("Fil d'Ariane")}>
                {crumbs.map((c, i) => (
                  <li key={c + i} className="flex min-w-0 items-center gap-1.5">
                    {i > 0 && <ChevronRight className="size-3.5 shrink-0 text-ink-soft/60" />}
                    <span className={`truncate ${i === crumbs.length - 1 ? "font-medium text-ink" : "text-ink-soft"}`}>{c}</span>
                  </li>
                ))}
              </ol>
            </div>
            {/* phones: the shop link is in the profile menu, the light / dark switch in Mon compte */}
            <div className="flex shrink-0 items-center gap-1 sm:gap-2">
              <GlobalSearch groups={groups} permissions={me.data.permissions} />
              {canOrders && <AlertsBell />}
              <Link
                to="/parametres"
                title={tr("Paramètres")}
                aria-label={tr("Paramètres")}
                className="grid size-9 place-items-center rounded-lg text-ink-soft transition hover:bg-ivory-deep hover:text-plum-700 [&.active]:text-plum-700"
              >
                <Settings className="size-5" strokeWidth={1.8} />
              </Link>
              <DarkToggle />
              <a
                href="/"
                target="_blank"
                rel="noreferrer"
                title={tr("Voir la boutique")}
                aria-label={tr("Voir la boutique")}
                className="hidden size-9 place-items-center rounded-lg text-ink-soft transition hover:bg-ivory-deep hover:text-plum-700 sm:grid"
              >
                <Store className="size-5" strokeWidth={1.8} />
              </a>
              <ProfileMenu me={me.data} />
            </div>
          </div>
        </header>
        <main className="mx-auto w-full min-w-0 max-w-[90rem] flex-1 px-4 py-6 sm:px-6">
          <Outlet />
          <UpdateBar />
        </main>
        <footer className="mx-auto hidden w-full max-w-[90rem] items-center justify-between px-6 pb-6 text-xs text-ink-soft md:flex">
          <span>© {new Date().getFullYear()} {tr("Henine Boutique · Administration")}</span>
          <span>{tr("Boumerdès · 69 wilayas")}</span>
        </footer>
      </div>

      {/* Phone tab bar */}
      <nav className="fixed inset-x-0 bottom-0 z-40 border-t border-line bg-surface/95 pb-[env(safe-area-inset-bottom)] shadow-[0_-6px_24px_rgb(23_10_16/0.06)] backdrop-blur md:hidden">
        <ul className="grid grid-cols-5 text-[11px] font-medium">
          {TABS.map((t) => (
            <li key={t.path}>
              <Link to={t.path} activeOptions={{ exact: t.path === "/" }} className="group flex h-16 flex-col items-center justify-center gap-1 text-ink-soft [&.active]:text-ink">
                <span className="relative grid h-7 w-12 place-items-center rounded-full transition group-[.active]:bg-ink group-[.active]:text-on-ink">
                  <t.icon className="size-5" strokeWidth={1.8} />
                  {t.path === "/commandes" && <NewBadge className="absolute -top-1.5 end-0.5 ring-2 ring-surface" />}
                </span>
                {t.label}
              </Link>
            </li>
          ))}
        </ul>
      </nav>
    </div>
    </LiveProvider>
    </OwnerCtx.Provider>
  );
}

export function MoreMenu() {
  const me = useMe();
  return (
    <div className="space-y-6">
      {visibleNav(me.data).map((g) => (
        <section key={g.label}>
          {g.path ? (
            <Link to={g.path} className="mb-2 flex items-center justify-between text-[11px] font-semibold uppercase tracking-[0.12em] text-ink-soft">
              {g.label}
              <ChevronRight className="size-3.5 rtl:rotate-180" />
            </Link>
          ) : (
            <h2 className="mb-2 text-[11px] font-semibold uppercase tracking-[0.12em] text-ink-soft">{g.label}</h2>
          )}
          <ul className="divide-y divide-line/70 overflow-hidden rounded-xl border border-line/70 bg-surface shadow-[0_1px_2px_rgb(43_22_32/0.04)]">
            {g.items.map((i) => (
              <li key={i.path}>
                <Link to={i.path} className="flex h-13 items-center gap-3 px-4 font-medium active:bg-rose-100">
                  <span className="grid size-8 place-items-center rounded-lg bg-plum-600/10 text-plum-600">
                    <i.icon className="size-4" />
                  </span>
                  <span className="flex-1">{i.label}</span>
                  <ChevronRight className="size-4 text-ink-soft" />
                </Link>
              </li>
            ))}
          </ul>
        </section>
      ))}
      <Link to="/parametres" className="flex h-13 items-center gap-3 rounded-xl border border-line/70 bg-surface px-4 font-medium active:bg-rose-100">
        <span className="grid size-8 place-items-center rounded-lg bg-plum-600/10 text-plum-600">
          <Settings className="size-4" />
        </span>
        <span className="flex-1">{tr("Paramètres")}</span>
        <ChevronRight className="size-4 text-ink-soft" />
      </Link>
      <div className="flex gap-3">
        <a href="/" target="_blank" rel="noreferrer" className="flex h-11 flex-1 items-center justify-center gap-2 rounded-lg border border-line bg-surface font-semibold">
          <ExternalLink className="size-4" /> {tr("Voir la boutique")}
        </a>
        <button type="button" onClick={logout} className="flex h-11 flex-1 items-center justify-center gap-2 rounded-lg border border-red-200 bg-surface font-semibold text-red-700">
          <LogOut className="size-4" /> {tr("Déconnexion")}
        </button>
      </div>
    </div>
  );
}

function ShellSkeleton() {
  return (
    <div className="flex min-h-dvh" aria-busy="true">
      <div className="hidden w-64 space-y-3 border-e border-line bg-surface p-4 md:block">
        <div className="skeleton mb-6 h-9" />
        {Array.from({ length: 12 }, (_, i) => (
          <div key={i} className="skeleton h-8" />
        ))}
      </div>
      <div className="flex-1 space-y-4 p-4 md:p-8">
        <div className="skeleton h-8 w-48" />
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
          {Array.from({ length: 4 }, (_, i) => (
            <div key={i} className="skeleton h-28" />
          ))}
        </div>
      </div>
    </div>
  );
}

function AccessProblem({ error }: { error: Error }) {
  return (
    <div className="grid min-h-dvh place-items-center p-6 text-center">
      <div className="max-w-sm">
        <Wordmark size="lg" className="mb-6" />
        <p className="text-lg font-semibold">{tr("Connexion au serveur impossible")}</p>
        <p className="mt-2 text-sm text-ink-soft">{error.message}</p>
        <button type="button" onClick={() => location.reload()} className="mt-6 h-10 rounded-lg bg-plum-600 px-5 font-semibold text-white">
          {tr("Réessayer")}
        </button>
      </div>
    </div>
  );
}

/** Top bar ☀️ / 🌙: switches to the other look (Paramètres → Mon compte also has "Auto"). */
function DarkToggle() {
  const { dark, setMode } = useColorMode();
  const label = dark ? tr("Mode clair") : tr("Mode sombre");
  return (
    <button
      type="button"
      onClick={() => setMode(dark ? "light" : "dark")}
      title={label}
      aria-label={label}
      className="hidden size-9 place-items-center rounded-lg text-ink-soft transition hover:bg-ivory-deep hover:text-plum-700 sm:grid"
    >
      {dark ? <Sun className="size-5" strokeWidth={1.8} /> : <Moon className="size-5" strokeWidth={1.8} />}
    </button>
  );
}
