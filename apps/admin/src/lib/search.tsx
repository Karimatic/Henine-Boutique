/**
 * The search bar at the top of every admin page (also Ctrl + K or "/"): one box for orders
 * (code, name, phone, tracking number, promo code), products (name, reference, barcode),
 * customers, promo codes, categories, contact messages, reviews, pages and settings.
 * Filter tabs with counts, details on every line, quick actions, recently opened items and
 * recent searches (this device). Only what the member may open shows up.
 */
import { formatDzPhone, hasPermission, type OrderStatus, type Permission } from "@henine/shared";
import { useQuery } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import {
  Banknote,
  Clock,
  CornerDownLeft,
  FolderTree,
  History,
  LayoutList,
  MousePointerClick,
  PanelTop,
  SlidersHorizontal,
  MessageSquare,
  PackageCheck,
  PackagePlus,
  PhoneCall,
  Plus,
  Search,
  Settings,
  Shirt,
  ShoppingBag,
  Star,
  TicketPercent,
  User,
  X,
  Zap,
  type LucideIcon,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { api } from "../api";
import { isAr, tr } from "../i18n";
import { DASHBOARD, type NavGroup } from "../nav";
import { ago, da, daMinus, ltr, STATUS_TONE, statusLabel } from "./format";
import { fold, SETTINGS_INDEX, SETTINGS_TABS } from "./settingsIndex";

interface SearchResult {
  orders: {
    id: number; public_code: string; name: string; phone: string; status: OrderStatus; total: number; created_at: number;
    channel: string; wilaya_fr: string | null; wilaya_ar: string | null; items: number;
  }[];
  products: {
    id: number; name_fr: string; name_ar: string; status: string; price: number; compare_at_price: number | null; image: string | null;
    category_fr: string | null; category_ar: string | null; available: number; sizes_out: number; sku: string | null;
  }[];
  customers: {
    id: number; name: string; phone: string; orders_count: number; delivered_count: number; returned_count: number; total_spent: number;
    is_blacklisted: number; last_order_at: number | null; wilaya_fr: string | null; wilaya_ar: string | null;
  }[];
  coupons: { id: number; code: string; type: string; value: number; used_count: number; usage_limit: number | null; is_active: number; ends_at: number | null; influencer_name: string | null }[];
  categories: { id: number; name_fr: string; name_ar: string; parent_fr: string | null; parent_ar: string | null; products: number }[];
  messages: { id: number; name: string; phone: string | null; subject: string | null; snippet: string; status: string; created_at: number }[];
  reviews: { id: number; name: string; rating: number; snippet: string | null; status: string; product_fr: string; product_ar: string; created_at: number }[];
  totals: { orders: number; products: number; customers: number };
}

type Kind = "orders" | "products" | "customers" | "coupons" | "categories" | "messages" | "reviews" | "pages" | "settings" | "features";

/** One feature of the admin, from the build-time index (virtual:feature-index). */
type Feature = { p: string; s?: { tab: string }; f: string; k: "section" | "setting" | "tab" | "action" };
const FEATURE_ICON: Record<Feature["k"], LucideIcon> = { section: LayoutList, setting: SlidersHorizontal, tab: PanelTop, action: MousePointerClick };
const FEATURE_WEIGHT: Record<Feature["k"], number> = { setting: 3, section: 3, tab: 2, action: 1 };
type Filter = "all" | Kind;

interface Target {
  to: string;
  search?: Record<string, unknown>;
  params?: Record<string, string>;
}

const KINDS: Record<Kind, { label: string; icon: LucideIcon; inAll: number }> = {
  orders: { label: tr("Commandes"), icon: ShoppingBag, inAll: 4 },
  products: { label: tr("Produits"), icon: Shirt, inAll: 4 },
  customers: { label: tr("Clientes"), icon: User, inAll: 3 },
  coupons: { label: tr("Codes promo"), icon: TicketPercent, inAll: 3 },
  categories: { label: tr("Catégories"), icon: FolderTree, inAll: 3 },
  messages: { label: tr("Messages"), icon: MessageSquare, inAll: 3 },
  reviews: { label: tr("Avis"), icon: Star, inAll: 3 },
  pages: { label: tr("Pages"), icon: Zap, inAll: 4 },
  settings: { label: tr("Paramètres"), icon: Settings, inAll: 3 },
  features: { label: tr("Fonctionnalités"), icon: SlidersHorizontal, inAll: 5 },
};

/** Where the "open in the page" line of a section goes, with the search already typed in. */
const LIST_PAGE: Partial<Record<Kind, (q: string) => Target>> = {
  orders: (q) => ({ to: "/commandes", search: { status: "all", q } }),
  products: (q) => ({ to: "/produits", search: { q } }),
  customers: (q) => ({ to: "/clients", search: { q } }),
};

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

const QUICK_ACTIONS: { label: string; icon: LucideIcon; perm: Permission; target: Target }[] = [
  { label: tr("Commandes à confirmer"), icon: PhoneCall, perm: "orders.view", target: { to: "/commandes", search: { status: "a_confirmer" } } },
  { label: tr("Préparer les colis"), icon: PackageCheck, perm: "orders.ship", target: { to: "/preparation" } },
  { label: tr("Nouveau produit"), icon: Plus, perm: "products.edit", target: { to: "/produits/nouveau" } },
  { label: tr("Vente en boutique (caisse)"), icon: Banknote, perm: "sales.create", target: { to: "/caisse" } },
  { label: tr("Réception de stock"), icon: PackagePlus, perm: "stock.edit", target: { to: "/stock/reception" } },
  { label: tr("Codes promo"), icon: TicketPercent, perm: "promos.edit", target: { to: "/promos" } },
];

const MESSAGE_STATUS: Record<string, [string, string, string]> = {
  new: [tr("Nouveau"), "bg-blue-100 text-blue-800", "open"],
  in_progress: [tr("En cours"), "bg-amber-100 text-amber-900", "open"],
  done: [tr("Traité"), "bg-emerald-100 text-emerald-800", "done"],
  spam: [tr("Spam"), "bg-stone-200 text-stone-700", "spam"],
};
const REVIEW_STATUS: Record<string, [string, string]> = {
  pending: [tr("À valider"), "bg-amber-100 text-amber-900"],
  approved: [tr("Publié"), "bg-emerald-100 text-emerald-800"],
  rejected: [tr("Masqué"), "bg-stone-200 text-stone-700"],
};

interface Hit {
  key: string;
  kind: Kind | "more" | "action" | "recent";
  title: ReactNode;
  sub?: ReactNode;
  side?: ReactNode;
  icon: LucideIcon;
  image?: string | null;
  go: () => void;
}

/* ── This device's history: recent searches and recently opened results ── */

interface Remembered {
  key: string;
  kind: Kind;
  title: string;
  sub?: string;
  target: Target;
}
interface SearchHistory {
  queries: string[];
  opened: Remembered[];
}
const HISTORY_KEY = "henine.admin.search.v1";
function loadHistory(): SearchHistory {
  try {
    const h = JSON.parse(localStorage.getItem(HISTORY_KEY) ?? "{}") as Partial<SearchHistory>;
    return { queries: h.queries ?? [], opened: h.opened ?? [] };
  } catch {
    return { queries: [], opened: [] };
  }
}
function saveHistory(h: SearchHistory) {
  try {
    localStorage.setItem(HISTORY_KEY, JSON.stringify(h));
  } catch {
    /* private mode */
  }
}

const Badge = ({ tone, children }: { tone: string; children: ReactNode }) => (
  <span className={`whitespace-nowrap rounded-full px-2 py-0.5 text-[0.7rem] font-medium ${tone}`}>{children}</span>
);
const dot = <span className="text-ink-soft/50"> · </span>;

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
  const [filter, setFilter] = useState<Filter>("all");
  const [active, setActive] = useState(0);
  const [history, setHistory] = useState(loadHistory);
  // every feature of the admin: loaded when the search opens (≈ 30 KB), not with the page
  const [features, setFeatures] = useState<Feature[]>([]);
  useEffect(() => {
    void import("virtual:feature-index").then((m) => setFeatures(m.default as Feature[]));
  }, []);
  const can = (p: Permission) => hasPermission(permissions, p);
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

  /** Opens a result: remembers it (and the search) on this device, closes, goes there. */
  const open = (target: Target, remember?: Omit<Remembered, "target">) => () => {
    const typed = q.trim();
    const next: SearchHistory = {
      queries: typed.length >= 2 ? [typed, ...history.queries.filter((x) => fold(x) !== fold(typed))].slice(0, 6) : history.queries,
      opened: remember ? [{ ...remember, target }, ...history.opened.filter((x) => x.key !== remember.key)].slice(0, 6) : history.opened,
    };
    saveHistory(next);
    onClose();
    void navigate({ to: target.to, search: target.search as never, params: target.params as never });
  };

  // the words typed, highlighted in the results (case and accents ignored)
  const words = useMemo(() => fold(q).split(/\s+/).filter((w) => w.length >= 2), [q]);
  const hl = (text: string | null | undefined): ReactNode => {
    if (!text || !words.length) return text ?? "";
    const folded = fold(text);
    // positions only line up when folding kept one character per character
    if (folded.length !== text.length) return text;
    const marks: [number, number][] = [];
    for (const w of words) for (let i = folded.indexOf(w); i >= 0; i = folded.indexOf(w, i + w.length)) marks.push([i, i + w.length]);
    if (!marks.length) return text;
    marks.sort((a, b) => a[0] - b[0]);
    const out: ReactNode[] = [];
    let at = 0;
    for (const [s, e] of marks) {
      if (s < at) continue;
      out.push(text.slice(at, s), <mark key={s} className="rounded-sm bg-amber-400/30 px-0.5 text-ink">{text.slice(s, e)}</mark>);
      at = e;
    }
    out.push(text.slice(at));
    return out;
  };

  const { sections, counts } = useMemo(() => {
    const sections = new Map<Kind, Hit[]>();
    const add = (kind: Kind, hit: Omit<Hit, "kind">) => sections.set(kind, [...(sections.get(kind) ?? []), { ...hit, kind }]);
    const matches = (text: string) => words.length > 0 && words.every((w) => fold(text).includes(w));
    const pages = [{ ...DASHBOARD, group: "" }, ...groups.flatMap((g) => g.items.map((i) => ({ ...i, group: g.label })))];

    const live = debounced.length >= 2 && fold(debounced) === fold(q.trim()) ? remote.data : undefined;
    for (const o of live?.orders ?? []) {
      const wilaya = isAr ? o.wilaya_ar : o.wilaya_fr;
      add("orders", {
        key: `order${o.id}`,
        icon: ShoppingBag,
        title: (
          <>
            <bdi className="font-mono text-xs">{hl(o.public_code)}</bdi>
            {dot}
            <bdi>{hl(o.name)}</bdi>
          </>
        ),
        sub: (
          <>
            <bdi dir="ltr">{hl(formatDzPhone(o.phone))}</bdi>
            {wilaya && <>{dot}{wilaya}</>}
            {dot}
            {tr("{0} article(s)", { 0: o.items })}
            {dot}
            {ago(o.created_at)}
          </>
        ),
        side: (
          <span className="flex flex-col items-end gap-1">
            <Badge tone={STATUS_TONE[o.status] ?? "bg-stone-100 text-stone-700"}>{statusLabel(o.status)}</Badge>
            <span className="text-xs font-semibold tabular-nums">{da(o.total)}</span>
          </span>
        ),
        go: open({ to: "/commandes", search: { o: o.id } }, { key: `order${o.id}`, kind: "orders", title: `${o.public_code} · ${o.name}`, sub: statusLabel(o.status) }),
      });
    }
    for (const p of live?.products ?? []) {
      const name = isAr ? p.name_ar || p.name_fr : p.name_fr;
      const category = isAr ? p.category_ar : p.category_fr;
      const onSale = p.compare_at_price != null && p.compare_at_price > p.price;
      add("products", {
        key: `product${p.id}`,
        icon: Shirt,
        image: p.image,
        title: (
          <>
            {hl(name)}
            {p.sku && <span className="ms-2 rounded bg-ivory-deep px-1.5 py-0.5 font-mono text-[0.7rem] text-ink-soft">{hl(p.sku)}</span>}
          </>
        ),
        sub: (
          <>
            {category && <>{category}{dot}</>}
            <span className="tabular-nums">{da(p.price)}</span>
            {onSale && <s className="ms-1 tabular-nums text-ink-soft/70">{da(p.compare_at_price)}</s>}
            {dot}
            {p.available > 0 ? (
              <span className="text-emerald-700">{tr("{0} en stock", { 0: p.available })}</span>
            ) : (
              <span className="font-medium text-red-700">{tr("Rupture")}</span>
            )}
            {p.available > 0 && p.sizes_out > 0 && <>{dot}<span className="text-amber-800">{tr("{0} taille(s) épuisée(s)", { 0: p.sizes_out })}</span></>}
          </>
        ),
        side:
          p.status !== "published" ? (
            <Badge tone="bg-stone-200 text-stone-700">{p.status === "draft" ? tr("Brouillon") : tr("Programmé")}</Badge>
          ) : onSale ? (
            <Badge tone="bg-rose-100 text-rose-700">{tr("Promo")}</Badge>
          ) : undefined,
        go: open({ to: "/produits/$id", params: { id: String(p.id) } }, { key: `product${p.id}`, kind: "products", title: name, sub: da(p.price) }),
      });
    }
    for (const c of live?.customers ?? []) {
      const wilaya = isAr ? c.wilaya_ar : c.wilaya_fr;
      add("customers", {
        key: `customer${c.id}`,
        icon: User,
        title: (
          <>
            <bdi>{hl(c.name)}</bdi>
            {c.is_blacklisted ? <span className="ms-2"><Badge tone="bg-red-100 text-red-800">{tr("Liste noire")}</Badge></span> : null}
          </>
        ),
        sub: (
          <>
            <bdi dir="ltr">{hl(formatDzPhone(c.phone))}</bdi>
            {wilaya && <>{dot}{wilaya}</>}
            {dot}
            {tr("{0}/{1} livrées", { 0: c.delivered_count, 1: c.orders_count })}
            {c.returned_count > 0 && <>{dot}<span className="text-amber-800">{tr("{0} retour(s)", { 0: c.returned_count })}</span></>}
          </>
        ),
        side: (
          <span className="flex flex-col items-end gap-0.5 text-xs">
            <span className="font-semibold tabular-nums">{da(c.total_spent)}</span>
            {c.last_order_at && <span className="text-ink-soft">{ago(c.last_order_at)}</span>}
          </span>
        ),
        go: open({ to: "/clients", search: { c: c.id } }, { key: `customer${c.id}`, kind: "customers", title: c.name, sub: formatDzPhone(c.phone) }),
      });
    }
    for (const c of live?.coupons ?? []) {
      const expired = c.ends_at != null && c.ends_at < Date.now();
      const value = c.type === "percent" ? ltr(`−${c.value} %`) : c.type === "fixed" ? daMinus(c.value) : tr("Livraison offerte");
      add("coupons", {
        key: `coupon${c.id}`,
        icon: TicketPercent,
        title: <bdi className="font-mono">{hl(c.code)}</bdi>,
        sub: (
          <>
            {value}
            {dot}
            {c.usage_limit ? tr("utilisé {0}/{1}", { 0: c.used_count, 1: c.usage_limit }) : tr("utilisé {0} fois", { 0: c.used_count })}
            {c.influencer_name && <>{dot}{hl(c.influencer_name)}</>}
          </>
        ),
        side: expired ? (
          <Badge tone="bg-stone-200 text-stone-700">{tr("Expiré")}</Badge>
        ) : c.is_active ? (
          <Badge tone="bg-emerald-100 text-emerald-800">{tr("Actif")}</Badge>
        ) : (
          <Badge tone="bg-stone-200 text-stone-700">{tr("Inactif")}</Badge>
        ),
        go: open({ to: "/promos" }, { key: `coupon${c.id}`, kind: "coupons", title: c.code }),
      });
    }
    for (const k of live?.categories ?? []) {
      const name = isAr ? k.name_ar : k.name_fr;
      const parent = isAr ? k.parent_ar : k.parent_fr;
      add("categories", {
        key: `category${k.id}`,
        icon: FolderTree,
        title: hl(name),
        sub: (
          <>
            {parent && <>{parent} ›{" "}</>}
            {tr("{0} produit(s)", { 0: k.products })}
          </>
        ),
        go: open({ to: "/produits", search: { category: k.id } }, { key: `category${k.id}`, kind: "categories", title: name }),
      });
    }
    for (const m of live?.messages ?? []) {
      const [label, tone, tab] = MESSAGE_STATUS[m.status] ?? [m.status, "bg-stone-100 text-stone-700", "all"];
      add("messages", {
        key: `message${m.id}`,
        icon: MessageSquare,
        title: <bdi>{hl(m.name)}</bdi>,
        sub: (
          <>
            {m.subject && <b className="font-medium text-ink">{hl(m.subject)} — </b>}
            {hl(m.snippet)}
          </>
        ),
        side: (
          <span className="flex flex-col items-end gap-1">
            <Badge tone={tone}>{label}</Badge>
            <span className="text-xs text-ink-soft">{ago(m.created_at)}</span>
          </span>
        ),
        go: open({ to: "/contact", search: { status: tab } }, { key: `message${m.id}`, kind: "messages", title: m.name, sub: m.subject ?? undefined }),
      });
    }
    for (const r of live?.reviews ?? []) {
      const [label, tone] = REVIEW_STATUS[r.status] ?? [r.status, "bg-stone-100 text-stone-700"];
      const product = isAr ? r.product_ar || r.product_fr : r.product_fr;
      add("reviews", {
        key: `review${r.id}`,
        icon: Star,
        title: (
          <>
            <span className="text-amber-500" aria-label={tr("{0} sur 5", { 0: r.rating })}>
              {"★".repeat(r.rating)}
              <span className="text-ink-soft/30">{"★".repeat(Math.max(0, 5 - r.rating))}</span>
            </span>{" "}
            <bdi>{hl(r.name)}</bdi>
          </>
        ),
        sub: (
          <>
            {hl(product)}
            {r.snippet && <> — {hl(r.snippet)}</>}
          </>
        ),
        side: <Badge tone={tone}>{label}</Badge>,
        go: open({ to: "/avis", search: { status: r.status } }, { key: `review${r.id}`, kind: "reviews", title: `${r.name} · ${product}` }),
      });
    }
    for (const p of pages.filter((p) => matches(`${p.label} ${p.group} ${PAGE_WORDS[p.path] ?? ""}`)).slice(0, 6)) {
      add("pages", {
        key: `page${p.path}`,
        title: hl(p.label),
        sub: p.group || undefined,
        icon: p.icon,
        go: open({ to: p.path }, { key: `page${p.path}`, kind: "pages", title: p.label, sub: p.group || undefined }),
      });
    }
    const tabs = SETTINGS_TABS.filter((t) => can(t.perm));
    for (const s of SETTINGS_INDEX.filter((s) => tabs.some((t) => t.key === s.tab) && matches(`${s.label} ${s.find} ${s.words}`)).slice(0, 6)) {
      const tab = tabs.find((t) => t.key === s.tab)?.label;
      const target = { to: "/parametres", search: { tab: s.tab, ...(s.find ? { find: s.find } : {}) } };
      add("settings", { key: `setting${s.tab}${s.label}`, icon: Settings, title: hl(s.label), sub: tab, go: open(target, { key: `setting${s.label}`, kind: "settings", title: s.label, sub: tab }) });
    }

    // every feature of the admin (sections, settings, switches, tabs, buttons), on the pages this member may open
    if (words.length) {
      const navOf = (path: string) =>
        pages.filter((x) => x.path !== "/" && (path === x.path || path.startsWith(`${x.path}/`))).sort((a, b) => b.path.length - a.path.length)[0] ?? (path === "/" ? pages[0] : undefined);
      const shown = new Set([...(sections.get("settings") ?? []), ...(sections.get("pages") ?? [])].map((h) => h.key));
      const found: { e: Feature; score: number; where: string }[] = [];
      for (const e of features) {
        const nav = navOf(e.p);
        if (!nav) continue; // a page this member can't open
        const tab = e.s ? SETTINGS_TABS.find((t) => t.key === e.s!.tab) : undefined;
        if (tab && !can(tab.perm)) continue;
        const label = tr(e.f);
        const where = tab ? `${nav.label} › ${tab.label}` : nav.label;
        const text = fold(`${label} ${e.f}`);
        if (!words.every((w) => text.includes(w) || fold(where).includes(w))) continue;
        if (shown.has(`setting${e.s?.tab ?? ""}${label}`)) continue;
        const starts = words.some((w) => text.startsWith(w)) ? 2 : 0;
        const inTitle = words.every((w) => text.includes(w)) ? 2 : 0;
        found.push({ e, score: FEATURE_WEIGHT[e.k] + starts + inTitle, where });
      }
      found.sort((a, b) => b.score - a.score);
      for (const { e, where } of found.slice(0, 40)) {
        const label = tr(e.f);
        const target = { to: e.p, search: { ...(e.s ?? {}), find: e.f } };
        add("features", {
          key: `feature${e.p}${e.s?.tab ?? ""}${e.f}`,
          icon: FEATURE_ICON[e.k],
          title: hl(label),
          sub: where,
          go: open(target, { key: `feature${e.p}${e.f}`, kind: "features", title: label, sub: where }),
        });
      }
    }

    // orders, products and customers: the server's full count (the lists stop at 8)
    const counts = new Map<Kind, number>();
    for (const [kind, list] of sections) {
      const total = live && kind in live.totals ? live.totals[kind as keyof SearchResult["totals"]] : 0;
      counts.set(kind, Math.max(total, list.length));
    }
    return { sections, counts };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q, debounced, remote.data, groups, permissions, words, history, features]);

  useEffect(() => {
    if (filter !== "all" && !sections.has(filter)) setFilter("all");
  }, [sections, filter]);

  // the lines on screen, in order (headings are drawn in between)
  const hits = useMemo<Hit[]>(() => {
    const typed = q.trim();
    if (!typed) {
      const out: Hit[] = [];
      for (const r of history.opened) {
        const meta = KINDS[r.kind];
        out.push({ key: `recent${r.key}`, kind: "recent", icon: meta?.icon ?? History, title: r.title, sub: r.sub ?? meta?.label, go: open(r.target, r) });
      }
      for (const a of QUICK_ACTIONS.filter((a) => can(a.perm))) out.push({ key: `action${a.label}`, kind: "action", icon: a.icon, title: a.label, go: open(a.target) });
      return out;
    }
    const out: Hit[] = [];
    for (const [kind, list] of sections) {
      if (filter !== "all" && filter !== kind) continue;
      const shown = filter === "all" ? list.slice(0, KINDS[kind].inAll) : list;
      out.push(...shown);
      const total = counts.get(kind) ?? list.length;
      if (filter === "all" && total > shown.length) {
        out.push({ key: `more${kind}`, kind: "more", icon: KINDS[kind].icon, title: tr("Voir les {0} résultats : {1}", { 0: total, 1: KINDS[kind].label }), go: () => setFilter(kind) });
      } else if (filter === kind && total > list.length && LIST_PAGE[kind]) {
        out.push({ key: `page${kind}`, kind: "more", icon: KINDS[kind].icon, title: tr("Ouvrir les {0} résultats dans la page {1}", { 0: total, 1: KINDS[kind].label }), go: open(LIST_PAGE[kind]!(typed)) });
      }
    }
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sections, counts, filter, q, history]);

  useEffect(() => setActive(0), [hits.length, q, filter]);
  useEffect(() => {
    list.current?.querySelector(`[data-i="${active}"]`)?.scrollIntoView({ block: "nearest" });
  }, [active]);

  const kindsFound = [...sections.keys()];
  const onKey = (e: ReactKeyboardEvent) => {
    if (e.key === "Escape") {
      if (filter !== "all") setFilter("all");
      else onClose();
    } else if (e.key === "ArrowDown") {
      e.preventDefault();
      setActive((a) => Math.min(a + 1, hits.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive((a) => Math.max(a - 1, 0));
    } else if (e.key === "Enter" && hits[active]) {
      e.preventDefault();
      hits[active].go();
    } else if (e.key === "Tab" && kindsFound.length && q.trim()) {
      // Tab / Shift + Tab: next / previous filter
      e.preventDefault();
      const all: Filter[] = ["all", ...kindsFound];
      const i = all.indexOf(filter);
      setFilter(all[(i + (e.shiftKey ? all.length - 1 : 1)) % all.length]!);
    }
  };

  const searching = q.trim().length >= 2 && (remote.isFetching || debounced !== q.trim());
  const resultCount = [...counts.values()].reduce((s, n) => s + n, 0);
  const headingOf = (h: Hit): string => {
    if (h.kind === "recent") return tr("Récemment ouverts");
    if (h.kind === "action") return tr("Actions rapides");
    if (h.kind === "more") return "";
    return filter === "all" ? KINDS[h.kind].label : "";
  };
  let lastHeading = "";
  return createPortal(
    <div className="fixed inset-0 z-50" role="dialog" aria-modal="true" aria-label={tr("Rechercher")} onKeyDown={onKey}>
      <button type="button" aria-label={tr("Fermer")} className="animate-fade absolute inset-0 bg-noir/40 backdrop-blur-[2px]" onClick={onClose} />
      <div className="relative mx-auto mt-3 flex max-h-[min(40rem,calc(100dvh-1.5rem))] w-[calc(100%-1.5rem)] max-w-2xl flex-col overflow-hidden rounded-2xl border border-line bg-surface shadow-2xl sm:mt-[8vh]">
        <div className="flex items-center gap-2 border-b border-line ps-4 pe-2">
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
          {q && (
            <button
              type="button"
              onClick={() => {
                setQ("");
                input.current?.focus();
              }}
              className="shrink-0 rounded-md px-2 py-1 text-xs text-ink-soft hover:bg-ivory-deep"
            >
              {tr("Effacer")}
            </button>
          )}
          <button type="button" onClick={onClose} aria-label={tr("Fermer")} className="grid size-9 shrink-0 place-items-center rounded-lg text-ink-soft hover:bg-ivory-deep">
            <X className="size-5" />
          </button>
        </div>

        {q.trim() && kindsFound.length > 0 && (
          <div className="flex gap-1.5 overflow-x-auto border-b border-line px-3 py-2 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden" role="tablist" aria-label={tr("Filtrer les résultats")}>
            {(["all", ...kindsFound] as Filter[]).map((f) => {
              const on = filter === f;
              const Icon = f === "all" ? Search : KINDS[f].icon;
              return (
                <button
                  key={f}
                  type="button"
                  role="tab"
                  aria-selected={on}
                  onClick={() => setFilter(f)}
                  className={`flex h-8 shrink-0 items-center gap-1.5 rounded-full px-3 text-xs font-semibold transition ${on ? "bg-plum-600 text-white" : "bg-ivory-deep text-ink-soft hover:text-ink"}`}
                >
                  <Icon className="size-3.5" strokeWidth={2} />
                  {f === "all" ? tr("Tout") : KINDS[f].label}
                  <span className={`tabular-nums ${on ? "text-white/80" : "text-ink-soft/70"}`}>{f === "all" ? resultCount : counts.get(f)}</span>
                </button>
              );
            })}
          </div>
        )}

        <ul ref={list} id="admin-search-results" role="listbox" aria-label={tr("Résultats")} className="flex-1 overflow-y-auto p-2">
          {!q.trim() && history.queries.length > 0 && (
            <li role="presentation" className="px-3 pb-2 pt-1">
              <p className="mb-1.5 flex items-center justify-between text-[0.7rem] font-semibold uppercase tracking-[0.08em] text-ink-soft">
                {tr("Recherches récentes")}
                <button
                  type="button"
                  className="normal-case tracking-normal text-ink-soft hover:text-plum-700"
                  onClick={() => {
                    const h = { queries: [], opened: [] };
                    saveHistory(h);
                    setHistory(h);
                  }}
                >
                  {tr("Effacer l'historique")}
                </button>
              </p>
              <div className="flex flex-wrap gap-1.5">
                {history.queries.map((x) => (
                  <button key={x} type="button" onClick={() => setQ(x)} className="flex items-center gap-1 rounded-full border border-line px-2.5 py-1 text-xs hover:border-plum-600/40">
                    <Clock className="size-3 text-ink-soft" />
                    <bdi>{x}</bdi>
                  </button>
                ))}
              </div>
            </li>
          )}
          {hits.map((h, i) => {
            const title = headingOf(h);
            const show = title && title !== lastHeading;
            if (title) lastHeading = title;
            return (
              <li key={h.key} role="presentation">
                {show && <p className="px-3 pb-1 pt-3 text-[0.7rem] font-semibold uppercase tracking-[0.08em] text-ink-soft first:pt-1">{title}</p>}
                <button
                  type="button"
                  id={`admin-search-${i}`}
                  data-i={i}
                  role="option"
                  aria-selected={i === active}
                  onMouseMove={() => i !== active && setActive(i)}
                  onClick={h.go}
                  className={`flex w-full items-center gap-3 rounded-xl px-3 text-start transition ${h.kind === "more" ? "py-2" : "py-2.5"} ${i === active ? "bg-rose-100/60" : ""}`}
                >
                  {h.kind === "more" ? (
                    <span className="flex-1 text-sm font-medium text-plum-700">{h.title}</span>
                  ) : (
                    <>
                      {h.image ? (
                        <img src={h.image} alt="" className="h-11 w-9 shrink-0 rounded-md object-cover" />
                      ) : (
                        <span className="grid size-9 shrink-0 place-items-center rounded-lg bg-ivory-deep text-plum-700">
                          <h.icon className="size-[1.1rem]" strokeWidth={1.8} />
                        </span>
                      )}
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm font-medium">{h.title}</span>
                        {h.sub && <span className="line-clamp-2 block text-xs text-ink-soft sm:line-clamp-1">{h.sub}</span>}
                      </span>
                      {h.side && <span className="shrink-0">{h.side}</span>}
                    </>
                  )}
                  {i === active && <CornerDownLeft className="hidden size-4 shrink-0 text-ink-soft sm:block" aria-hidden="true" />}
                </button>
              </li>
            );
          })}
          {!q.trim() && (
            <li role="presentation" className="px-3 pb-1 pt-3 text-xs leading-relaxed text-ink-soft">
              {tr("Astuce : tapez un numéro de commande (HN-…), un téléphone, un nom, une référence de produit, un code promo ou un mot comme « son » ou « livraison ».")}
            </li>
          )}
          {q.trim() && !hits.length && (
            <li className="px-4 py-10 text-center text-sm text-ink-soft">
              {searching ? tr("Recherche…") : q.trim().length < 2 ? tr("Tapez au moins 2 caractères.") : tr("Rien trouvé pour « {0} ».", { 0: q.trim() })}
            </li>
          )}
        </ul>
        <p className="hidden items-center gap-4 border-t border-line px-4 py-2 text-xs text-ink-soft sm:flex">
          {q.trim().length >= 2 && !searching && <span className="me-auto">{tr("{0} résultat(s)", { 0: resultCount })}</span>}
          <span>
            <kbd className="font-sans">↑ ↓</kbd> {tr("choisir")}
          </span>
          <span>
            <kbd className="font-sans">Enter</kbd> {tr("ouvrir")}
          </span>
          {q.trim() && (
            <span>
              <kbd className="font-sans">Tab</kbd> {tr("filtre suivant")}
            </span>
          )}
          <span>
            <kbd className="font-sans">Esc</kbd> {tr("fermer")}
          </span>
        </p>
      </div>
    </div>,
    document.body,
  );
}
