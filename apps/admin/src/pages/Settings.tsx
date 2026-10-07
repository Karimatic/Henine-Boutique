import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useNavigate, useSearch } from "@tanstack/react-router";
import { useEffect, useState, type ReactNode } from "react";
import { api, errorMessage, put } from "../api";
import { da } from "../lib/format";
import { useCan } from "../Shell";
import { Badge, Button, ErrorState, inputCls, ListSkeleton, PageHeader, SearchBox, useToast } from "../ui";
import { ContactSettingsCard, StoreTextsEditor, type ContactSettings, type Overrides } from "./Marketing";
import { BoutiqueSettingsCard } from "./BoutiqueSettings";
import { DesignEditor } from "./Design";
import { IntegrationsSection, MyAccount } from "./System";
import { OperationsSettings } from "./OperationsSettings";
import { tr } from "../i18n";
import { fold, SETTINGS_INDEX, SETTINGS_TABS as TABS, type TabKey } from "../lib/settingsIndex";

/**
 * Every store setting in one place, one topic per tab (like the template's settings page):
 * on the left what it is, in plain words; on the right the switch or the box.
 * Switches save the moment they're flipped; boxes have their own "Enregistrer".
 */

interface HomeSettings {
  announcement: { active: boolean };
  checkout: { express_on_product: boolean; desk_enabled: boolean; free_shipping_over: number | null; max_orders_per_phone_per_hour: number };
  maintenance: { active: boolean };
  store: { name: string; season?: "auto" | "summer" | "winter" };
  contact: ContactSettings;
  texts?: { ar?: Overrides; fr?: Overrides };
}

/** Search box: matching settings, one tap opens the right tab on that setting. */
function SettingsSearch({ tabs, onPick }: { tabs: { key: TabKey; label: string }[]; onPick: (tab: TabKey, find: string) => void }) {
  const [q, setQ] = useState("");
  const allowed = new Set(tabs.map((t) => t.key));
  const words = fold(q).split(/\s+/).filter(Boolean);
  const hits = words.length
    ? SETTINGS_INDEX.filter((e) => allowed.has(e.tab) && words.every((w) => fold(`${e.label} ${e.find} ${e.words}`).includes(w))).slice(0, 8)
    : [];
  const tabLabel = (k: TabKey) => tabs.find((t) => t.key === k)?.label ?? k;
  return (
    <div className="relative mb-4">
      <SearchBox value={q} onChange={setQ} placeholder={tr("Rechercher un réglage : son, livraison, Telegram, mot de passe…")} />
      {q.trim() && (
        <ul className="absolute inset-x-0 top-full z-20 mt-1 overflow-hidden rounded-xl border border-line bg-surface shadow-xl" role="listbox" aria-label={tr("Réglages trouvés")}>
          {hits.length === 0 ? (
            <li className="px-4 py-3 text-sm text-ink-soft">{tr("Aucun réglage ne correspond.")}</li>
          ) : (
            hits.map((h) => (
              <li key={h.tab + h.label}>
                <button
                  type="button"
                  role="option"
                  aria-selected={false}
                  onClick={() => {
                    setQ("");
                    onPick(h.tab, h.find);
                  }}
                  className="flex w-full items-center justify-between gap-3 px-4 py-3 text-start text-sm hover:bg-rose-100/40"
                >
                  <span className="font-medium">{h.label}</span>
                  <span className="shrink-0 text-xs text-ink-soft">{tabLabel(h.tab)}</span>
                </button>
              </li>
            ))
          )}
        </ul>
      )}
    </div>
  );
}

export function SettingsPage() {
  const can = useCan();
  const navigate = useNavigate();
  const search = useSearch({ strict: false }) as { tab?: string; find?: string };
  const tabs = TABS.filter((t) => can(t.perm));
  const tab = tabs.find((t) => t.key === search.tab)?.key ?? tabs[0]?.key ?? "compte";
  const setTab = (k: TabKey) => void navigate({ to: "/parametres", search: { tab: k } });
  // the store's texts live on Page d'accueil only (one place per setting)
  const toTexts = () => void navigate({ to: "/accueil", hash: "textes" });
  useEffect(() => {
    if (search.tab === "textes") toTexts();
  }, [search.tab]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div>
      <PageHeader group={tr("Système")} title={tr("Paramètres")} subtitle={tr("Tous les réglages de la boutique au même endroit. Les changements s'appliquent tout de suite sur la boutique.")} />
      <SettingsSearch tabs={tabs} onPick={(k, find) => void navigate({ to: "/parametres", search: { tab: k, ...(find ? { find } : {}) } as never })} />
      <div className="-mx-4 mb-6 overflow-x-auto border-b border-line px-4 md:mx-0 md:px-0" role="tablist" aria-label={tr("Rubriques des paramètres")}>
        <div className="flex w-max gap-1">
          {tabs.map((t) => (
            <button
              key={t.key}
              type="button"
              role="tab"
              aria-selected={tab === t.key}
              onClick={() => setTab(t.key)}
              className={`-mb-px flex h-11 items-center gap-2 border-b-2 px-3 text-sm font-medium whitespace-nowrap transition ${
                tab === t.key ? "border-plum-600 text-plum-700" : "border-transparent text-ink-soft hover:border-line hover:text-ink"
              }`}
            >
              <t.icon className="size-4" strokeWidth={1.9} />
              {t.label}
            </button>
          ))}
        </div>
      </div>
      {tab === "compte" ? (
        <MyAccount />
      ) : tab === "alertes" ? (
        <OperationsSettings />
      ) : tab === "connexions" ? (
        <div className="space-y-4">
          <IntegrationsSection />
        </div>
      ) : (
        <StoreSettings tab={tab} goTo={(k) => (k === "textes" ? toTexts() : setTab(k))} />
      )}
    </div>
  );
}

/* ───────────── Layout helpers ───────────── */

function Panel({ children }: { children: ReactNode }) {
  return <div className="divide-y divide-line rounded-xl border border-line bg-surface px-4 shadow-[0_1px_2px_rgb(43_22_32/0.04)] md:px-6">{children}</div>;
}

/** One setting: title + plain explanation on the left, the control on the right. */
function Row({ title, help, children }: { title: string; help: ReactNode; children: ReactNode }) {
  return (
    <div className="grid gap-3 py-5 md:grid-cols-[minmax(0,1fr)_minmax(0,1.3fr)] md:gap-10 md:py-6">
      <div>
        <h3 className="font-semibold">{title}</h3>
        <p className="mt-1 text-sm text-ink-soft">{help}</p>
      </div>
      <div className="md:pt-0.5">{children}</div>
    </div>
  );
}

/** Big, clear on/off switch with its current state written next to it. */
function Switch({ checked, onChange, on, off, warn = false }: { checked: boolean; onChange: (v: boolean) => void; on: string; off: string; warn?: boolean }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      onClick={() => onChange(!checked)}
      className={`flex w-full items-center gap-3 rounded-xl border px-4 py-3 text-start transition ${
        checked ? (warn ? "border-amber-300 bg-amber-50" : "border-plum-600/30 bg-rose-100/50") : "border-line bg-surface hover:bg-ivory-deep/60"
      }`}
    >
      <span className={`relative h-6 w-11 shrink-0 rounded-full transition ${checked ? (warn ? "bg-amber-500" : "bg-plum-600") : "bg-stone-300"}`}>
        <span className={`absolute top-0.5 size-5 rounded-full bg-surface shadow-sm transition-all ${checked ? "start-[1.4rem]" : "start-0.5"}`} />
      </span>
      <span className="text-sm font-semibold">{checked ? on : off}</span>
    </button>
  );
}

/** A box + its own save button, enabled only once something changed. */
function SaveBox({ value, saved, onChange, onSave, busy, suffix, type = "text", placeholder, width = "w-full" }: {
  value: string; saved: string; onChange: (v: string) => void; onSave: () => void; busy: boolean; suffix?: string; type?: "text" | "number"; placeholder?: string; width?: string;
}) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <div className={`relative ${width}`}>
        <input className={`${inputCls} ${suffix ? "pe-12" : ""}`} type={type} inputMode={type === "number" ? "numeric" : undefined} min={0} value={value} placeholder={placeholder} onChange={(e) => onChange(e.target.value)} />
        {suffix && <span className="pointer-events-none absolute inset-y-0 end-3 grid place-items-center text-sm text-ink-soft">{suffix}</span>}
      </div>
      <Button variant="primary" disabled={value === saved} loading={busy} onClick={onSave}>
        {tr("Enregistrer")}
      </Button>
    </div>
  );
}

/* ───────────── Store settings (boutique, commandes, textes, contact) ───────────── */

function StoreSettings({ tab, goTo }: { tab: TabKey; goTo: (t: TabKey) => void }) {
  const can = useCan();
  const qc = useQueryClient();
  const toast = useToast();
  const q = useQuery({ queryKey: ["home"], queryFn: () => api<HomeSettings>("/home") });
  const [name, setName] = useState("");
  const [freeOver, setFreeOver] = useState("");
  const [maxOrders, setMaxOrders] = useState("");
  useEffect(() => {
    if (!q.data) return;
    setName(q.data.store.name);
    setFreeOver(q.data.checkout.free_shipping_over == null ? "" : String(q.data.checkout.free_shipping_over));
    setMaxOrders(String(q.data.checkout.max_orders_per_phone_per_hour));
  }, [q.data]);

  const done = (ok: string) => ({
    onSuccess: () => {
      toast(tr(ok));
      void qc.invalidateQueries({ queryKey: ["home"] });
      void qc.invalidateQueries({ queryKey: ["coupons"] });
    },
    onError: (e: unknown) => {
      toast(errorMessage(e), "error");
      void qc.invalidateQueries({ queryKey: ["home"] });
    },
  });
  const saveHome = useMutation({ mutationFn: (v: Pick<HomeSettings, "announcement" | "checkout" | "maintenance">) => put("/home", v), ...done("Enregistré ✓ visible tout de suite sur la boutique") });
  const saveName = useMutation({ mutationFn: (n: string) => put("/content/store", { name: n }), ...done("Nom de la boutique enregistré ✓") });
  const saveSeason = useMutation({ mutationFn: (season: string) => put("/content/store", { season }), ...done("Saison enregistrée ✓") });

  if (q.error) return <ErrorState error={q.error} onRetry={q.refetch} />;
  if (!q.data) return <ListSkeleton rows={4} />;
  const h = q.data;

  // switches: show the new state at once, then save
  function apply(patch: Partial<Pick<HomeSettings, "announcement" | "maintenance">> & { checkout?: Partial<HomeSettings["checkout"]> }) {
    const next = { announcement: patch.announcement ?? h.announcement, maintenance: patch.maintenance ?? h.maintenance, checkout: { ...h.checkout, ...patch.checkout } };
    qc.setQueryData<HomeSettings>(["home"], { ...h, ...next });
    saveHome.mutate(next);
  }
  const textsLink = (label: string) => (
    <button type="button" onClick={() => goTo("textes")} className="mt-2 text-sm font-semibold text-plum-600 hover:underline">
      {tr(label)} →
    </button>
  );

  if (tab === "boutique")
    return (
      <Panel>
        <Row title={tr("Nom de la boutique")} help={tr("Affiché dans l'onglet du navigateur, les messages et les partages sur les réseaux.")}>
          {can("content.edit") ? (
            <SaveBox value={name} saved={h.store.name} onChange={setName} busy={saveName.isPending} onSave={() => saveName.mutate(name.trim())} />
          ) : (
            <p className="font-medium">{h.store.name}</p>
          )}
        </Row>
        <Row
          title={tr("Saison")}
          help={tr("Les sous-catégories de saison (pyjamas d'été / d'hiver) passent en premier. « Automatique » : été d'avril à septembre, hiver d'octobre à mars.")}
        >
          <select
            className={`${inputCls} h-11 w-full sm:w-64`}
            value={h.store.season ?? "auto"}
            disabled={!can("content.edit")}
            onChange={(e) => {
              qc.setQueryData<HomeSettings>(["home"], { ...h, store: { ...h.store, season: e.target.value as "auto" } });
              saveSeason.mutate(e.target.value);
            }}
          >
            <option value="auto">{tr("Automatique (selon le mois)")}</option>
            <option value="summer">{tr("☀️ Été")}</option>
            <option value="winter">{tr("❄️ Hiver")}</option>
          </select>
        </Row>
        <Row title={tr("Bandeau d'annonces")} help={tr("La petite bande rose tout en haut de la boutique (livraison 69 wilayas, paiement à la livraison…).")}>
          <Switch checked={h.announcement.active} onChange={(v) => apply({ announcement: { active: v } })} on={tr("Affiché sur la boutique")} off={tr("Masqué")} />
          {textsLink("Modifier les messages du bandeau")}
        </Row>
        <Row
          title={tr("Mettre les commandes en pause")}
          help={tr("Pour les vacances ou un inventaire : la boutique reste visible, mais les clientes ne peuvent plus commander et voient un message poli.")}
        >
          <Switch checked={h.maintenance.active} onChange={(v) => apply({ maintenance: { active: v } })} on={tr("Commandes en pause")} off={tr("Commandes ouvertes ✓")} warn />
          {h.maintenance.active && <p className="mt-2 text-sm text-amber-800">{tr("⚠️ Aucune nouvelle commande n'est possible tant que c'est activé.")}</p>}
          {textsLink("Modifier le message de pause")}
        </Row>
      </Panel>
    );

  if (tab === "commandes") {
    const free = freeOver.trim() === "" ? null : Math.max(0, Math.round(Number(freeOver)));
    const max = Math.max(1, Math.min(20, Math.round(Number(maxOrders) || 3)));
    return (
      <Panel>
        <Row title={tr("Livraison au bureau (stop-desk)")} help={tr("Proposer le retrait au bureau ZR Express, moins cher que la livraison à domicile.")}>
          <Switch checked={h.checkout.desk_enabled} onChange={(v) => apply({ checkout: { desk_enabled: v } })} on={tr("Proposée aux clientes")} off={tr("Non proposée (domicile seulement)")} />
        </Row>
        <Row
          title={tr("Livraison offerte")}
          help={
            <>
              {tr("La livraison devient gratuite à partir de ce montant de panier. Laissez vide pour ne jamais l'offrir.")}
              {h.checkout.free_shipping_over != null && <Badge tone="ms-1 bg-emerald-100 text-emerald-800">{tr("actuellement dès")} {da(h.checkout.free_shipping_over)}</Badge>}
            </>
          }
        >
          <SaveBox
            type="number"
            suffix={tr("DA")}
            width="w-48"
            placeholder={tr("ex : 10000")}
            value={freeOver}
            saved={h.checkout.free_shipping_over == null ? "" : String(h.checkout.free_shipping_over)}
            onChange={setFreeOver}
            busy={saveHome.isPending}
            onSave={() => apply({ checkout: { free_shipping_over: free } })}
          />
        </Row>
        <Row title={tr("Protection contre les fausses commandes")} help={tr("Nombre maximum de commandes qu'un même numéro de téléphone peut passer en une heure (entre 1 et 20).")}>
          <SaveBox
            type="number"
            suffix="/ h"
            width="w-32"
            value={maxOrders}
            saved={String(h.checkout.max_orders_per_phone_per_hour)}
            onChange={setMaxOrders}
            busy={saveHome.isPending}
            onSave={() => {
              setMaxOrders(String(max));
              apply({ checkout: { max_orders_per_phone_per_hour: max } });
            }}
          />
        </Row>
        <p className="py-4 text-sm text-ink-soft">
          {tr("Prix de livraison par wilaya :")} <Link to="/contenu" className="font-semibold text-plum-600">{tr("Contenu → Livraison")}</Link> {tr("· Codes promo :")} <Link to="/promos" className="font-semibold text-plum-600">{tr("Promos")}</Link>
        </p>
      </Panel>
    );
  }

  if (tab === "textes") return <StoreTextsEditor saved={{ ar: h.texts?.ar ?? {}, fr: h.texts?.fr ?? {} }} />;

  return (
    <div className="space-y-3">
      <p className="text-sm text-ink-soft">{tr("Ces coordonnées apparaissent sur la page Contact et en bas de la boutique. Laissez une case vide pour la cacher.")}</p>
      <ContactSettingsCard key={JSON.stringify(h.contact)} contact={h.contact} />
      <BoutiqueSettingsCard />
    </div>
  );
}

/** Old addresses (/accueil, /comptes) open the matching tab here. */
export function SettingsRedirect({ tab }: { tab: TabKey }) {
  const navigate = useNavigate();
  useEffect(() => void navigate({ to: "/parametres", search: { tab }, replace: true }), [navigate, tab]);
  return null;
}
export const HomeRedirect = () => <SettingsRedirect tab="boutique" />;
export const AccountRedirect = () => <SettingsRedirect tab="compte" />;

/**
 * Page d'accueil: what customers see on the home page (logo, photos, sections, banners) and
 * every text of the store (title, banner messages, questions, pause message). The switches
 * (banner on/off, order pause, store name, season) are in Paramètres → Boutique.
 */
export function HomeSettingsPage() {
  const toTexts = () => document.getElementById("textes")?.scrollIntoView({ behavior: "smooth", block: "start" });
  useEffect(() => {
    if (location.hash === "#textes") setTimeout(toTexts, 300);
  }, []);
  return (
    <div className="space-y-4">
      <PageHeader
        group={tr("Marketing")}
        title={tr("Page d'accueil")}
        subtitle={tr("Ce que les clientes voient en arrivant sur la boutique. Tout s'applique tout de suite.")}
        actions={
          <a href="/" target="_blank" rel="noreferrer" className="inline-flex h-9 items-center rounded-lg border border-line bg-surface px-3.5 text-sm font-semibold">
            {tr("Voir la boutique ↗")}
          </a>
        }
      />
      <DesignEditor />
      <div id="textes" className="scroll-mt-20">
        <StoreSettings tab="textes" goTo={toTexts} />
      </div>
    </div>
  );
}
