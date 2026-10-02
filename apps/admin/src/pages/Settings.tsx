import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useNavigate, useSearch } from "@tanstack/react-router";
import { KeyRound, Plug, Phone, ShoppingBag, Store, Type, type LucideIcon } from "lucide-react";
import { useEffect, useState, type ReactNode } from "react";
import { api, errorMessage, put } from "../api";
import { da } from "../lib/format";
import { useCan } from "../Shell";
import { Badge, Button, ErrorState, inputCls, ListSkeleton, PageHeader, useToast } from "../ui";
import { ContactSettingsCard, StoreTextsEditor, type ContactSettings, type Overrides } from "./Marketing";
import { IntegrationsSection, MyAccount } from "./System";

/**
 * Every store setting in one place, one topic per tab (like the template's settings page):
 * on the left what it is, in plain words; on the right the switch or the box.
 * Switches save the moment they're flipped; boxes have their own "Enregistrer".
 */

interface HomeSettings {
  announcement: { active: boolean };
  checkout: { express_on_product: boolean; desk_enabled: boolean; free_shipping_over: number | null; max_orders_per_phone_per_hour: number };
  maintenance: { active: boolean };
  store: { name: string };
  contact: ContactSettings;
  texts?: { ar?: Overrides; fr?: Overrides };
}

type TabKey = "boutique" | "commandes" | "textes" | "contact" | "compte" | "connexions";

const TABS: { key: TabKey; label: string; icon: LucideIcon; perm: Parameters<ReturnType<typeof useCan>>[0] }[] = [
  { key: "boutique", label: "Boutique", icon: Store, perm: "marketing.edit" },
  { key: "commandes", label: "Commandes & livraison", icon: ShoppingBag, perm: "marketing.edit" },
  { key: "textes", label: "Textes", icon: Type, perm: "marketing.edit" },
  { key: "contact", label: "Contact & réseaux", icon: Phone, perm: "marketing.edit" },
  { key: "compte", label: "Mon compte", icon: KeyRound, perm: "dashboard.view" },
  { key: "connexions", label: "Connexions", icon: Plug, perm: "integrations.manage" },
];

export function SettingsPage() {
  const can = useCan();
  const navigate = useNavigate();
  const search = useSearch({ strict: false }) as { tab?: string };
  const tabs = TABS.filter((t) => can(t.perm));
  const tab = tabs.find((t) => t.key === search.tab)?.key ?? tabs[0]?.key ?? "compte";
  const setTab = (k: TabKey) => void navigate({ to: "/parametres", search: { tab: k } });

  return (
    <div>
      <PageHeader group="Système" title="Paramètres" subtitle="Tous les réglages de la boutique au même endroit. Les changements s'appliquent tout de suite sur la boutique." />
      <div className="-mx-4 mb-6 overflow-x-auto border-b border-line px-4 md:mx-0 md:px-0" role="tablist" aria-label="Rubriques des paramètres">
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
      ) : tab === "connexions" ? (
        <div className="space-y-4">
          <IntegrationsSection />
        </div>
      ) : (
        <StoreSettings tab={tab} goTo={setTab} />
      )}
    </div>
  );
}

/* ───────────── Layout helpers ───────────── */

function Panel({ children }: { children: ReactNode }) {
  return <div className="divide-y divide-line rounded-xl border border-line bg-white px-4 shadow-[0_1px_2px_rgb(43_22_32/0.04)] md:px-6">{children}</div>;
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
        checked ? (warn ? "border-amber-300 bg-amber-50" : "border-plum-600/30 bg-rose-100/50") : "border-line bg-white hover:bg-ivory-deep/60"
      }`}
    >
      <span className={`relative h-6 w-11 shrink-0 rounded-full transition ${checked ? (warn ? "bg-amber-500" : "bg-plum-600") : "bg-stone-300"}`}>
        <span className={`absolute top-0.5 size-5 rounded-full bg-white shadow-sm transition-all ${checked ? "start-[1.4rem]" : "start-0.5"}`} />
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
        Enregistrer
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
      toast(ok);
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
      {label} →
    </button>
  );

  if (tab === "boutique")
    return (
      <Panel>
        <Row title="Nom de la boutique" help="Affiché dans l'onglet du navigateur, les messages et les partages sur les réseaux.">
          {can("content.edit") ? (
            <SaveBox value={name} saved={h.store.name} onChange={setName} busy={saveName.isPending} onSave={() => saveName.mutate(name.trim())} />
          ) : (
            <p className="font-medium">{h.store.name}</p>
          )}
        </Row>
        <Row title="Bandeau d'annonces" help="La petite bande rose tout en haut de la boutique (livraison 69 wilayas, paiement à la livraison…).">
          <Switch checked={h.announcement.active} onChange={(v) => apply({ announcement: { active: v } })} on="Affiché sur la boutique" off="Masqué" />
          {textsLink("Modifier les messages du bandeau")}
        </Row>
        <Row
          title="Mettre les commandes en pause"
          help="Pour les vacances ou un inventaire : la boutique reste visible, mais les clientes ne peuvent plus commander et voient un message poli."
        >
          <Switch checked={h.maintenance.active} onChange={(v) => apply({ maintenance: { active: v } })} on="Commandes en pause" off="Commandes ouvertes ✓" warn />
          {h.maintenance.active && <p className="mt-2 text-sm text-amber-800">⚠️ Aucune nouvelle commande n'est possible tant que c'est activé.</p>}
          {textsLink("Modifier le message de pause")}
        </Row>
      </Panel>
    );

  if (tab === "commandes") {
    const free = freeOver.trim() === "" ? null : Math.max(0, Math.round(Number(freeOver)));
    const max = Math.max(1, Math.min(20, Math.round(Number(maxOrders) || 3)));
    return (
      <Panel>
        <Row title="Commande rapide sur la fiche produit" help="La cliente remplit son nom, son téléphone et sa wilaya directement sur la page du produit, sans passer par le panier. Recommandé : plus de commandes.">
          <Switch checked={h.checkout.express_on_product} onChange={(v) => apply({ checkout: { express_on_product: v } })} on="Activée" off="Désactivée (passage par le panier)" />
        </Row>
        <Row title="Livraison au bureau (stop-desk)" help="Proposer le retrait au bureau ZR Express, moins cher que la livraison à domicile.">
          <Switch checked={h.checkout.desk_enabled} onChange={(v) => apply({ checkout: { desk_enabled: v } })} on="Proposée aux clientes" off="Non proposée (domicile seulement)" />
        </Row>
        <Row
          title="Livraison offerte"
          help={
            <>
              La livraison devient gratuite à partir de ce montant de panier. Laissez vide pour ne jamais l'offrir.
              {h.checkout.free_shipping_over != null && <Badge tone="ms-1 bg-emerald-100 text-emerald-800">actuellement dès {da(h.checkout.free_shipping_over)}</Badge>}
            </>
          }
        >
          <SaveBox
            type="number"
            suffix="DA"
            width="w-48"
            placeholder="ex : 10000"
            value={freeOver}
            saved={h.checkout.free_shipping_over == null ? "" : String(h.checkout.free_shipping_over)}
            onChange={setFreeOver}
            busy={saveHome.isPending}
            onSave={() => apply({ checkout: { free_shipping_over: free } })}
          />
        </Row>
        <Row title="Protection contre les fausses commandes" help="Nombre maximum de commandes qu'un même numéro de téléphone peut passer en une heure (entre 1 et 20).">
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
          Prix de livraison par wilaya : <Link to="/contenu" className="font-semibold text-plum-600">Contenu → Livraison</Link> · Codes promo : <Link to="/promos" className="font-semibold text-plum-600">Promos</Link>
        </p>
      </Panel>
    );
  }

  if (tab === "textes") return <StoreTextsEditor saved={{ ar: h.texts?.ar ?? {}, fr: h.texts?.fr ?? {} }} />;

  return (
    <div className="space-y-3">
      <p className="text-sm text-ink-soft">Ces coordonnées apparaissent sur la page Contact et en bas de la boutique. Laissez une case vide pour la cacher.</p>
      <ContactSettingsCard key={JSON.stringify(h.contact)} contact={h.contact} />
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
