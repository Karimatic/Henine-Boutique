import { hasPermission } from "@henine/shared";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, Outlet } from "@tanstack/react-router";
import { useEffect } from "react";
import { api, ApiError, auth, post, type Me } from "./api";
import { NAV, TABS } from "./nav";

export function useMe() {
  return useQuery({ queryKey: ["me"], queryFn: () => api<Me>("/me"), staleTime: 5 * 60_000, retry: false });
}

export function useCan() {
  const me = useMe();
  return (permission: Parameters<typeof hasPermission>[1]) => !!me.data && hasPermission(me.data.permissions, permission);
}

export function visibleNav(me: Me | undefined) {
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

export function Shell() {
  const me = useMe();
  useDevTelegramPolling(me.data);

  if (me.isPending) return <ShellSkeleton />;
  if (me.error) {
    if (me.error instanceof ApiError && me.error.status === 401) return <ShellSkeleton />; // redirecting to login
    return <AccessProblem error={me.error} />;
  }
  const groups = visibleNav(me.data);

  return (
    <div className="min-h-dvh md:grid md:grid-cols-[15rem_1fr]">
      <aside className="sticky top-0 hidden h-dvh flex-col overflow-y-auto border-e border-line bg-ivory-deep px-3 py-5 md:flex">
        <Link to="/" className="mb-6 flex items-center gap-2 px-3 text-xl font-semibold text-plum-700">
          🌸 Henine Boutique
        </Link>
        <Link to="/" activeOptions={{ exact: true }} className="mb-4 block rounded-lg px-3 py-2 text-sm font-medium hover:bg-rose-100 [&.active]:bg-plum-600 [&.active]:text-ivory">
          Tableau de bord
        </Link>
        {groups.map((g) => (
          <div key={g.label} className="mb-4">
            <p className="px-3 pb-1 text-[11px] font-semibold uppercase tracking-wider text-ink-soft">{g.label}</p>
            {g.items.map((i) => (
              <Link key={i.path} to={i.path} className="block rounded-lg px-3 py-2 text-sm hover:bg-rose-100 [&.active]:bg-plum-600 [&.active]:text-ivory">
                {i.label}
              </Link>
            ))}
          </div>
        ))}
        <div className="mt-auto space-y-2 border-t border-line px-3 pt-4 text-xs text-ink-soft">
          <p className="truncate font-medium text-ink">{me.data.name}</p>
          <p className="truncate">{me.data.roleName}</p>
          <div className="flex gap-3">
            <a href="/" target="_blank" rel="noreferrer" className="font-semibold text-plum-600">Voir la boutique ↗</a>
            <button type="button" onClick={logout} className="font-semibold text-plum-600">Déconnexion</button>
          </div>
          {me.data.dev && <p className="rounded-lg bg-amber-100 px-2 py-1 text-amber-900">Mode développement</p>}
        </div>
      </aside>

      <div className="flex min-w-0 flex-col pb-[calc(4rem+env(safe-area-inset-bottom))] md:pb-0">
        <header className="sticky top-0 z-30 flex h-14 items-center justify-between border-b border-line bg-ivory/90 px-4 backdrop-blur md:hidden">
          <Link to="/" className="text-lg font-semibold text-plum-700">🌸 Henine Boutique</Link>
          <span className="max-w-[55%] truncate text-xs text-ink-soft">{me.data.name}</span>
        </header>
        <main className="mx-auto w-full max-w-6xl flex-1 p-4 md:p-8">
          <Outlet />
        </main>
      </div>

      <nav className="fixed inset-x-0 bottom-0 z-40 border-t border-line bg-ivory/95 pb-[env(safe-area-inset-bottom)] backdrop-blur md:hidden">
        <ul className="grid grid-cols-5 text-[11px] font-medium">
          {[...TABS, { path: "/plus", label: "Plus", icon: "☰" }].map((t) => (
            <li key={t.path}>
              <Link to={t.path} activeOptions={{ exact: t.path === "/" }} className="flex h-16 flex-col items-center justify-center gap-0.5 text-ink-soft [&.active]:text-plum-600">
                <span className="text-lg leading-none">{t.icon}</span>
                {t.label}
              </Link>
            </li>
          ))}
        </ul>
      </nav>
    </div>
  );
}

export function MoreMenu() {
  const me = useMe();
  return (
    <div className="space-y-6">
      {visibleNav(me.data).map((g) => (
        <section key={g.label}>
          <h2 className="mb-2 text-xs font-semibold uppercase tracking-wider text-ink-soft">{g.label}</h2>
          <ul className="divide-y divide-line overflow-hidden rounded-2xl border border-line bg-white/70">
            {g.items.map((i) => (
              <li key={i.path}>
                <Link to={i.path} className="flex h-14 items-center justify-between px-4 font-medium active:bg-rose-100">
                  {i.label}
                  <span aria-hidden="true" className="text-ink-soft">›</span>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      ))}
      <div className="flex gap-3">
        <a href="/" target="_blank" rel="noreferrer" className="flex h-12 flex-1 items-center justify-center rounded-full border border-line bg-white font-semibold">
          Voir la boutique ↗
        </a>
        <button type="button" onClick={logout} className="h-12 flex-1 rounded-full border border-red-200 bg-white font-semibold text-red-700">
          Déconnexion
        </button>
      </div>
    </div>
  );
}

function ShellSkeleton() {
  return (
    <div className="grid min-h-dvh md:grid-cols-[15rem_1fr]" aria-busy="true">
      <div className="hidden space-y-3 border-e border-line p-5 md:block">
        {Array.from({ length: 12 }, (_, i) => <div key={i} className="skeleton h-8" />)}
      </div>
      <div className="space-y-4 p-4 md:p-8">
        <div className="skeleton h-8 w-48" />
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
          {Array.from({ length: 4 }, (_, i) => <div key={i} className="skeleton h-24" />)}
        </div>
      </div>
    </div>
  );
}

function AccessProblem({ error }: { error: Error }) {
  return (
    <div className="grid min-h-dvh place-items-center p-6 text-center">
      <div className="max-w-sm">
        <p className="mb-2 text-4xl">🌸</p>
        <p className="text-lg font-semibold">Connexion au serveur impossible</p>
        <p className="mt-2 text-sm text-ink-soft">{error.message}</p>
        <button type="button" onClick={() => location.reload()} className="mt-6 h-11 rounded-full bg-plum-600 px-6 font-semibold text-ivory">
          Réessayer
        </button>
      </div>
    </div>
  );
}
