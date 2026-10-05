/**
 * The search bar at the top of every admin page (also Ctrl + K or "/"): one box for orders
 * (code, name, phone, tracking number), products (name, reference), customers, pages and
 * settings. Only what the member may open shows up.
 */
import { formatDzPhone, hasPermission, type OrderStatus } from "@henine/shared";
import { useQuery } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { CornerDownLeft, Search, Settings, Shirt, ShoppingBag, User, X, type LucideIcon } from "lucide-react";
import { useEffect, useMemo, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { api } from "../api";
import { isAr, tr } from "../i18n";
import { DASHBOARD, type NavGroup } from "../nav";
import { ago, da, STATUS_TONE, statusLabel } from "./format";
import { fold, SETTINGS_INDEX, SETTINGS_TABS } from "./settingsIndex";

interface SearchResult {
  orders: { id: number; public_code: string; name: string; phone: string; status: OrderStatus; total: number; created_at: number }[];
  products: { id: number; name_fr: string; name_ar: string; status: string; price: number; image: string | null }[];
  customers: { id: number; name: string; phone: string; orders_count: number }[];
}

/** Other words for each page, so "طلبات", "commande" or "orders" all find Commandes. */
const PAGE_WORDS: Record<string, string> = {
  "/": "accueil tableau bord dashboard الرئيسية لوحة",
  "/produits": "produits articles vêtements catalogue المنتجات السلع الملابس",
  "/stock": "stock inventaire quantité réception المخزون الكمية",
  "/ventes": "ventes chiffre recettes المبيعات",
  "/caisse": "caisse vente boutique magasin الصندوق البيع في المحل",
  "/commandes": "commandes orders طلبات طلبيات الطلبيات كوموند",
  "/clients": "clientes clients زبائن الزبونات الزبائن",
  "/paniers": "paniers abandonnés السلات المتروكة",
  "/promos": "promos codes coupons réduction remise كوبون تخفيض",
  "/fidelite": "fidélité points الوفاء النقاط",
  "/preparation": "préparation colis emballage تحضير الطرود",
  "/accueil": "page d'accueil vitrine bannière الصفحة الرئيسية",
  "/avis": "avis commentaires notes التقييمات الآراء",
  "/notifier": "notifier notifications push إشعارات",
  "/liens": "liens instagram bio الروابط",
  "/contact": "contact messages رسائل اتصال",
  "/collections": "collections sélections المجموعات",
  "/statistiques": "statistiques stats bénéfice profit الإحصائيات الربح",
  "/equipe": "équipe employés membres الفريق",
  "/comptes": "comptes accès الحسابات",
  "/contenu": "contenu pages faq المحتوى",
  "/parametres": "paramètres réglages settings الإعدادات",
  "/erreurs": "erreurs bugs الأخطاء",
};

const QUICK = ["/commandes", "/produits", "/clients", "/stock", "/statistiques", "/parametres"];

interface Hit {
  key: string;
  group: string;
  title: ReactNode;
  sub?: ReactNode;
  side?: ReactNode;
  icon: LucideIcon;
  image?: string | null;
  go: () => void;
}

/** The button in the header + the keyboard shortcuts. */
export function GlobalSearch({ groups, permissions }: { groups: NavGroup[]; permissions: string[] }) {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      const typing = !!t && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName));
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setOpen(true);
      } else if (e.key === "/" && !typing && !e.ctrlKey && !e.metaKey) {
        e.preventDefault();
        setOpen(true);
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, []);
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label={tr("Rechercher")}
        title={tr("Rechercher (Ctrl + K)")}
        className="flex h-9 items-center gap-2 rounded-lg text-ink-soft transition hover:bg-ivory-deep hover:text-plum-700 max-lg:w-9 max-lg:justify-center lg:w-64 lg:rounded-full lg:border lg:border-line lg:bg-ivory-deep/60 lg:px-3.5"
      >
        <Search className="size-[1.15rem] shrink-0" strokeWidth={1.9} />
        <span className="hidden flex-1 truncate text-start text-sm lg:block">{tr("Commande, produit, cliente…")}</span>
        <kbd className="hidden rounded border border-line bg-surface px-1.5 py-0.5 font-sans text-[0.65rem] text-ink-soft lg:block" dir="ltr">Ctrl K</kbd>
      </button>
      {open && <SearchDialog groups={groups} permissions={permissions} onClose={() => setOpen(false)} />}
    </>
  );
}

function SearchDialog({ groups, permissions, onClose }: { groups: NavGroup[]; permissions: string[]; onClose: () => void }) {
  const navigate = useNavigate();
  const input = useRef<HTMLInputElement>(null);
  const list = useRef<HTMLUListElement>(null);
  const [q, setQ] = useState("");
  const [debounced, setDebounced] = useState("");
  const [active, setActive] = useState(0);
  useEffect(() => {
    const t = setTimeout(() => setDebounced(q.trim()), 220);
    return () => clearTimeout(t);
  }, [q]);
  useEffect(() => {
    input.current?.focus();
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, []);

  const remote = useQuery({
    queryKey: ["admin-search", debounced],
    queryFn: () => api<SearchResult>(`/search?q=${encodeURIComponent(debounced)}`),
    enabled: debounced.length >= 2,
    placeholderData: (p) => p,
    staleTime: 15_000,
  });

  const hits = useMemo<Hit[]>(() => {
    const go = (fn: () => void) => () => {
      onClose();
      fn();
    };
    const words = fold(q).split(/\s+/).filter(Boolean);
    const matches = (text: string) => words.every((w) => fold(text).includes(w));
    const pages = [{ ...DASHBOARD, group: "" }, ...groups.flatMap((g) => g.items.map((i) => ({ ...i, group: g.label })))];
    const out: Hit[] = [];

    if (!words.length) {
      for (const p of pages.filter((p) => QUICK.includes(p.path))) {
        out.push({ key: `page${p.path}`, group: tr("Accès rapide"), title: p.label, icon: p.icon, go: go(() => void navigate({ to: p.path })) });
      }
      return out;
    }

    const live = debounced.length >= 2 && fold(debounced) === fold(q.trim()) ? remote.data : undefined;
    for (const o of live?.orders ?? []) {
      out.push({
        key: `order${o.id}`,
        group: tr("Commandes"),
        icon: ShoppingBag,
        title: (
          <>
            <bdi className="font-mono text-xs">{o.public_code}</bdi> · <bdi>{o.name}</bdi>
          </>
        ),
        sub: (
          <>
            <span dir="ltr">{formatDzPhone(o.phone)}</span> · {ago(o.created_at)}
          </>
        ),
        side: (
          <span className="flex flex-col items-end gap-1">
            <span className={`rounded-full px-2 py-0.5 text-[0.7rem] font-medium ${STATUS_TONE[o.status] ?? "bg-stone-100 text-stone-700"}`}>{statusLabel(o.status)}</span>
            <span className="text-xs tabular-nums text-ink-soft">{da(o.total)}</span>
          </span>
        ),
        go: go(() => void navigate({ to: "/commandes", search: { o: o.id } as never })),
      });
    }
    for (const p of live?.products ?? []) {
      out.push({
        key: `product${p.id}`,
        group: tr("Produits"),
        icon: Shirt,
        image: p.image,
        title: isAr ? p.name_ar || p.name_fr : p.name_fr,
        sub: p.status === "published" ? da(p.price) : `${da(p.price)} · ${p.status === "draft" ? tr("Brouillon") : tr("Programmé")}`,
        go: go(() => void navigate({ to: "/produits/$id", params: { id: String(p.id) } })),
      });
    }
    for (const c of live?.customers ?? []) {
      out.push({
        key: `customer${c.id}`,
        group: tr("Clientes"),
        icon: User,
        title: <bdi>{c.name}</bdi>,
        sub: <span dir="ltr">{formatDzPhone(c.phone)}</span>,
        side: <span className="text-xs text-ink-soft">{tr("{0} commande(s)", { 0: c.orders_count })}</span>,
        go: go(() => void navigate({ to: "/clients", search: { c: c.id } as never })),
      });
    }
    for (const p of pages.filter((p) => matches(`${p.label} ${p.group} ${PAGE_WORDS[p.path] ?? ""}`)).slice(0, 5)) {
      out.push({ key: `page${p.path}`, group: tr("Pages"), title: p.label, sub: p.group || undefined, icon: p.icon, go: go(() => void navigate({ to: p.path })) });
    }
    const tabs = SETTINGS_TABS.filter((t) => hasPermission(permissions, t.perm));
    for (const s of SETTINGS_INDEX.filter((s) => tabs.some((t) => t.key === s.tab) && matches(`${s.label} ${s.find} ${s.words}`)).slice(0, 5)) {
      out.push({
        key: `setting${s.tab}${s.label}`,
        group: tr("Paramètres"),
        icon: Settings,
        title: s.label,
        sub: tabs.find((t) => t.key === s.tab)?.label,
        go: go(() => void navigate({ to: "/parametres", search: { tab: s.tab, ...(s.find ? { find: s.find } : {}) } as never })),
      });
    }
    return out;
  }, [q, debounced, remote.data, groups, permissions, navigate, onClose]);

  useEffect(() => setActive(0), [hits.length, q]);
  useEffect(() => {
    list.current?.querySelector(`[data-i="${active}"]`)?.scrollIntoView({ block: "nearest" });
  }, [active]);

  const onKey = (e: ReactKeyboardEvent) => {
    if (e.key === "Escape") onClose();
    else if (e.key === "ArrowDown") {
      e.preventDefault();
      setActive((a) => Math.min(a + 1, hits.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive((a) => Math.max(a - 1, 0));
    } else if (e.key === "Enter" && hits[active]) {
      e.preventDefault();
      hits[active].go();
    }
  };

  const searching = q.trim().length >= 2 && (remote.isFetching || debounced !== q.trim());
  let lastGroup = "";
  return createPortal(
    <div className="fixed inset-0 z-50" role="dialog" aria-modal="true" aria-label={tr("Rechercher")} onKeyDown={onKey}>
      <button type="button" aria-label={tr("Fermer")} className="animate-fade absolute inset-0 bg-noir/40 backdrop-blur-[2px]" onClick={onClose} />
      <div className="relative mx-auto mt-3 flex max-h-[min(36rem,calc(100dvh-1.5rem))] w-[calc(100%-1.5rem)] max-w-2xl flex-col overflow-hidden rounded-2xl border border-line bg-surface shadow-2xl sm:mt-[10vh]">
        <div className="flex items-center gap-3 border-b border-line px-4">
          <Search className={`size-5 shrink-0 ${searching ? "animate-pulse text-plum-600" : "text-ink-soft"}`} />
          <input
            ref={input}
            type="text"
            inputMode="search"
            enterKeyHint="go"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder={tr("Code de commande, nom, téléphone, produit, réglage…")}
            aria-label={tr("Rechercher")}
            aria-controls="admin-search-results"
            aria-activedescendant={hits[active] ? `admin-search-${active}` : undefined}
            className="h-14 min-w-0 flex-1 bg-transparent text-base outline-none placeholder:text-ink-soft/70"
            autoComplete="off"
            spellCheck={false}
          />
          <button type="button" onClick={onClose} aria-label={tr("Fermer")} className="grid size-9 shrink-0 place-items-center rounded-lg text-ink-soft hover:bg-ivory-deep">
            <X className="size-5" />
          </button>
        </div>
        <ul ref={list} id="admin-search-results" role="listbox" aria-label={tr("Résultats")} className="flex-1 overflow-y-auto p-2">
          {hits.map((h, i) => {
            const heading = h.group !== lastGroup ? h.group : null;
            lastGroup = h.group;
            return (
              <li key={h.key} role="presentation">
                {heading && <p className="px-3 pb-1 pt-3 text-[0.7rem] font-semibold uppercase tracking-[0.08em] text-ink-soft first:pt-1">{heading}</p>}
                <button
                  type="button"
                  id={`admin-search-${i}`}
                  data-i={i}
                  role="option"
                  aria-selected={i === active}
                  onMouseMove={() => i !== active && setActive(i)}
                  onClick={h.go}
                  className={`flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-start transition ${i === active ? "bg-rose-100/60 dark:bg-plum-600/20" : ""}`}
                >
                  {h.image ? (
                    <img src={h.image} alt="" className="h-10 w-8 shrink-0 rounded-md object-cover" />
                  ) : (
                    <span className="grid size-9 shrink-0 place-items-center rounded-lg bg-ivory-deep text-plum-700">
                      <h.icon className="size-[1.1rem]" strokeWidth={1.8} />
                    </span>
                  )}
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-medium">{h.title}</span>
                    {h.sub && <span className="block truncate text-xs text-ink-soft">{h.sub}</span>}
                  </span>
                  {h.side}
                  {i === active && <CornerDownLeft className="hidden size-4 shrink-0 text-ink-soft sm:block" aria-hidden="true" />}
                </button>
              </li>
            );
          })}
          {q.trim() && !hits.length && (
            <li className="px-4 py-10 text-center text-sm text-ink-soft">
              {searching ? tr("Recherche…") : tr("Rien trouvé pour « {0} ».", { 0: q.trim() })}
            </li>
          )}
        </ul>
        <p className="hidden items-center gap-4 border-t border-line px-4 py-2 text-xs text-ink-soft sm:flex">
          <span>
            <kbd className="font-sans">↑ ↓</kbd> {tr("choisir")}
          </span>
          <span>
            <kbd className="font-sans">Enter</kbd> {tr("ouvrir")}
          </span>
          <span>
            <kbd className="font-sans">Esc</kbd> {tr("fermer")}
          </span>
        </p>
      </div>
    </div>,
    document.body,
  );
}
