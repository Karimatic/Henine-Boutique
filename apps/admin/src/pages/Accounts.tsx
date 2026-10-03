import { PERMISSIONS, ROLE_PRESETS, type Permission } from "@henine/shared";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Check } from "lucide-react";
import { useState } from "react";
import { api, del, errorMessage, patch, post, put } from "../api";
import { tr } from "../i18n";
import { ago } from "../lib/format";
import { useMe } from "../Shell";
import { MemberOwnerPanel } from "./MemberDetails";
import { Badge, Button, Card, ErrorState, inputCls, ListSkeleton, PageHeader, Sheet, TextField, useToast } from "../ui";

/**
 * Comptes: every person who can open this admin. Each account has its own permissions
 * (ready-made level, or ticked one by one = "Sur mesure"); all accounts work the same way.
 */

interface Account {
  id: number;
  email: string;
  name: string;
  is_active: number;
  last_seen_at: number | null;
  has_password: number;
  role: string;
  role_name: string;
  permissions: string[];
  sessions: number;
}

/** Permissions by area, in the order of the menu. */
const GROUPS: { title: string; items: [Permission, string][] }[] = [
  { title: "Tableau de bord", items: [["dashboard.view", "Voir le tableau de bord"]] },
  {
    title: "Commandes",
    items: [
      ["orders.view", "Voir les commandes"],
      ["orders.confirm", "Confirmer / annuler"],
      ["orders.ship", "Préparer / expédier / livrer"],
      ["orders.edit", "Modifier une commande"],
      ["orders.export", "Exporter (CSV)"],
    ],
  },
  {
    title: "Clientes",
    items: [
      ["customers.view", "Voir les clientes"],
      ["customers.edit", "Modifier les fiches clientes"],
      ["customers.export", "Exporter les clientes"],
      ["carts.view", "Paniers abandonnés"],
      ["loyalty.edit", "Fidélité (points)"],
    ],
  },
  {
    title: "Catalogue",
    items: [
      ["products.view", "Voir les produits"],
      ["products.edit", "Créer / modifier les produits"],
      ["publish", "Mettre en ligne"],
      ["stock.view", "Voir le stock"],
      ["stock.edit", "Modifier le stock"],
      ["cost.view", "Voir les prix d'achat et marges"],
    ],
  },
  { title: "Ventes", items: [["sales.view", "Voir les ventes"], ["sales.create", "Enregistrer une vente manuelle"]] },
  {
    title: "Marketing",
    items: [
      ["promos.edit", "Codes promo"],
      ["marketing.edit", "Page d'accueil, collections, liens, notifications"],
      ["reviews.moderate", "Avis"],
      ["contact.view", "Messages de contact"],
    ],
  },
  { title: "Analyse", items: [["stats.view", "Statistiques"]] },
  {
    title: "Système",
    items: [
      ["content.edit", "Contenu (pages, catégories)"],
      ["delivery.edit", "Tarifs de livraison"],
      ["team.manage", "Équipe et comptes"],
      ["integrations.manage", "Connexions (Telegram, Instagram…)"],
      ["errors.view", "Erreurs"],
      ["audit.view", "Journal d'audit"],
    ],
  },
];

const ALL = PERMISSIONS as readonly Permission[];
const permsOf = (a: Pick<Account, "permissions">) => (a.permissions.includes("*") ? [...ALL] : (a.permissions as Permission[]));
const levelName = (a: Account) => (a.role.startsWith("custom-") ? tr("Sur mesure") : tr(ROLE_PRESETS[a.role]?.name ?? a.role_name));

function useSave<T>(fn: (v: T) => Promise<unknown>, ok: string) {
  const qc = useQueryClient();
  const toast = useToast();
  return useMutation({
    mutationFn: fn,
    onSuccess: () => {
      toast(tr(ok));
      void qc.invalidateQueries({ queryKey: ["team"] });
    },
    onError: (e) => toast(errorMessage(e), "error"),
  });
}

export function AccountsPage() {
  const me = useMe();
  const q = useQuery({ queryKey: ["team"], queryFn: () => api<{ members: Account[] }>("/team") });
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState<Account | null>(null);
  return (
    <div className="space-y-4">
      <PageHeader
        group={tr("Système")}
        title={tr("Comptes")}
        subtitle={tr("Chaque personne qui ouvre l'administration a son compte, avec ses propres droits.")}
        actions={<Button variant="primary" onClick={() => setCreating(true)}>{tr("+ Nouveau compte")}</Button>}
      />
      {q.error ? (
        <ErrorState error={q.error} onRetry={q.refetch} />
      ) : !q.data ? (
        <ListSkeleton />
      ) : (
        <ul className="grid gap-3 md:grid-cols-2">
          {q.data.members.map((a) => {
            const perms = permsOf(a);
            const mine = a.id === me.data?.id;
            return (
              <li key={a.id}>
                <button
                  type="button"
                  onClick={() => setEditing(a)}
                  className={`w-full rounded-xl border border-line bg-surface p-4 text-start transition hover:border-plum-600/40 ${a.is_active ? "" : "opacity-55"}`}
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="truncate font-semibold">
                        {a.name}
                        {mine ? tr(" (vous)") : ""}
                      </p>
                      <p className="truncate text-sm text-ink-soft" dir="ltr">{a.email}</p>
                    </div>
                    <div className="flex shrink-0 flex-col items-end gap-1">
                      <Badge tone={a.role === "owner" ? "bg-plum-600 text-white" : undefined}>{levelName(a)}</Badge>
                      {!a.has_password && <Badge tone="bg-amber-100 text-amber-800">{tr("Invitation en attente")}</Badge>}
                      {!a.is_active && <Badge tone="bg-stone-200 text-stone-700">{tr("Désactivé")}</Badge>}
                    </div>
                  </div>
                  <div className="mt-3 flex items-center justify-between gap-2 text-xs text-ink-soft">
                    <span>
                      {a.permissions.includes("*") ? tr("Tous les droits") : tr("{0} droits sur {1}", { 0: perms.length, 1: ALL.length })}
                    </span>
                    <span>{tr("vu")} {ago(a.last_seen_at)}</span>
                  </div>
                  <span className="mt-2 block h-1.5 overflow-hidden rounded-full bg-ivory-deep">
                    <span className="block h-full rounded-full bg-plum-600" style={{ width: `${(perms.length / ALL.length) * 100}%` }} />
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      )}
      {creating && <NewAccountSheet onClose={() => setCreating(false)} />}
      {editing && <AccountSheet account={editing} isMe={editing.id === me.data?.id} onClose={() => setEditing(null)} />}
    </div>
  );
}

/** Ready-made levels + ticks, shared by "new account" and "edit". */
function PermissionPicker({ value, onChange, disabled }: { value: Permission[]; onChange: (v: Permission[]) => void; disabled?: boolean }) {
  const has = (p: Permission) => value.includes(p);
  const toggle = (p: Permission) => onChange(has(p) ? value.filter((x) => x !== p) : [...value, p]);
  return (
    <div className="space-y-4">
      <div>
        <p className="mb-2 text-sm font-medium">{tr("Partir d'un niveau tout prêt")}</p>
        <div className="flex flex-wrap gap-1.5">
          {Object.entries(ROLE_PRESETS).map(([k, r]) => (
            <button
              key={k}
              type="button"
              disabled={disabled}
              onClick={() => onChange(r.permissions.includes("*") ? [...ALL] : [...(r.permissions as Permission[])])}
              className="h-9 rounded-full border border-line bg-surface px-3.5 text-sm font-medium hover:border-plum-600 disabled:opacity-40"
            >
              {tr(r.name)}
            </button>
          ))}
        </div>
      </div>
      {GROUPS.map((g) => {
        const all = g.items.every(([p]) => has(p));
        return (
          <fieldset key={g.title} className="rounded-xl border border-line p-3" disabled={disabled}>
            <legend className="flex w-full items-center justify-between px-1 text-sm font-semibold">
              {tr(g.title)}
              <button
                type="button"
                onClick={() => onChange(all ? value.filter((p) => !g.items.some(([x]) => x === p)) : [...new Set([...value, ...g.items.map(([p]) => p)])])}
                className="text-xs font-semibold text-plum-600"
              >
                {all ? tr("Tout retirer") : tr("Tout cocher")}
              </button>
            </legend>
            <ul className="grid gap-1 sm:grid-cols-2">
              {g.items.map(([p, label]) => (
                <li key={p}>
                  <label className={`flex cursor-pointer items-center gap-2.5 rounded-lg px-2 py-2 text-sm transition ${has(p) ? "bg-rose-100/60" : "hover:bg-ivory-deep"}`}>
                    <span className={`grid size-5 shrink-0 place-items-center rounded-md border ${has(p) ? "border-plum-600 bg-plum-600 text-white" : "border-line bg-surface"}`}>
                      {has(p) && <Check className="size-3.5" strokeWidth={3} />}
                    </span>
                    <input type="checkbox" className="sr-only" checked={has(p)} onChange={() => toggle(p)} />
                    {tr(label)}
                  </label>
                </li>
              ))}
            </ul>
          </fieldset>
        );
      })}
    </div>
  );
}

function NewAccountSheet({ onClose }: { onClose: () => void }) {
  const [form, setForm] = useState({ name: "", email: "" });
  const [perms, setPerms] = useState<Permission[]>([...(ROLE_PRESETS.confirmation!.permissions as Permission[])]);
  const [result, setResult] = useState<{ inviteUrl: string; emailed: boolean } | null>(null);
  const create = useSave(
    () => post<{ inviteUrl: string; emailed: boolean }>("/team", { ...form, role: "custom", permissions: perms }).then(setResult),
    "Compte créé",
  );
  return (
    <Sheet
      open
      onClose={onClose}
      wide
      title={tr("Nouveau compte")}
      footer={
        !result && (
          <Button variant="primary" className="w-full" loading={create.isPending} disabled={form.name.trim().length < 2 || !form.email.includes("@")} onClick={() => create.mutate(undefined)}>
            {tr("Créer le compte et l'invitation")}
          </Button>
        )
      }
    >
      {result ? (
        <div className="space-y-3">
          <p className="text-sm">
            {result.emailed ? tr("✉️ L'invitation a été envoyée par email.") : tr("Envoyez ce lien à la personne (WhatsApp, Telegram…). Il est valable 7 jours et utilisable une seule fois :")}
          </p>
          <textarea readOnly dir="ltr" className={`${inputCls} h-24 py-2 font-mono text-xs`} value={result.inviteUrl} onFocus={(e) => e.target.select()} />
          <Button onClick={() => navigator.clipboard?.writeText(result.inviteUrl)}>{tr("Copier le lien")}</Button>
        </div>
      ) : (
        <div className="space-y-4">
          <div className="grid gap-3 sm:grid-cols-2">
            <TextField label={tr("Prénom / nom")} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
            <TextField label={tr("Email")} type="email" dir="ltr" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />
          </div>
          <p className="text-sm text-ink-soft">{tr("La personne reçoit un lien pour choisir son mot de passe. Elle ne verra que ce que vous cochez ci-dessous.")}</p>
          <PermissionPicker value={perms} onChange={setPerms} />
        </div>
      )}
    </Sheet>
  );
}

function AccountSheet({ account, isMe, onClose }: { account: Account; isMe: boolean; onClose: () => void }) {
  const [perms, setPerms] = useState<Permission[]>(permsOf(account));
  const [link, setLink] = useState<string | null>(null);
  const owner = account.permissions.includes("*");
  const changed = owner ? perms.length !== ALL.length : JSON.stringify([...perms].sort()) !== JSON.stringify([...permsOf(account)].sort());
  const savePerms = useSave(() => (perms.length === ALL.length ? patch(`/team/${account.id}`, { role: "owner" }) : put(`/team/${account.id}/permissions`, { permissions: perms })), "Droits enregistrés ✓");
  const toggleActive = useSave(() => patch(`/team/${account.id}`, { isActive: !account.is_active }), account.is_active ? "Accès désactivé" : "Accès réactivé");
  const reinvite = useSave(() => post<{ inviteUrl: string }>(`/team/${account.id}/invite`).then((r) => setLink(r.inviteUrl)), "Nouveau lien créé");
  const revoke = useSave(() => del(`/team/${account.id}/sessions`), "Déconnecté de tous les appareils");
  return (
    <Sheet
      open
      onClose={onClose}
      wide
      title={account.name}
      footer={
        !isMe && (
          <Button variant="primary" className="w-full" disabled={!changed} loading={savePerms.isPending} onClick={() => savePerms.mutate(undefined, { onSuccess: onClose })}>
            {tr("Enregistrer les droits")}
          </Button>
        )
      }
    >
      <div className="space-y-4">
        <p className="text-sm text-ink-soft" dir="auto">
          <span dir="ltr">{account.email}</span> · {account.sessions} {tr("appareil(s) connecté(s)")} · {tr("vu")} {ago(account.last_seen_at)}
        </p>
        {isMe ? (
          <Card>
            <p className="text-sm">{tr("C'est votre compte : vos propres droits ne peuvent être changés que par une autre propriétaire.")}</p>
          </Card>
        ) : (
          <PermissionPicker value={perms} onChange={setPerms} />
        )}
        <p className="text-xs text-ink-soft">{tr("Tout cocher = Propriétaire (tous les droits). Les changements s'appliquent tout de suite, sans nouvelle connexion.")}</p>
        {!isMe && (
          <div className="flex flex-wrap gap-2 border-t border-line pt-3">
            <Button size="sm" onClick={() => reinvite.mutate(undefined)}>{account.has_password ? tr("Lien de réinitialisation") : tr("Renvoyer l'invitation")}</Button>
            <Button size="sm" onClick={() => revoke.mutate(undefined)}>{tr("Déconnecter partout")}</Button>
            <Button
              size="sm"
              variant="danger"
              onClick={() => confirm(account.is_active ? tr("Désactiver l'accès de ce membre ?") : tr("Réactiver ce membre ?")) && toggleActive.mutate(undefined, { onSuccess: onClose })}
            >
              {account.is_active ? tr("Désactiver l'accès") : tr("Réactiver")}
            </Button>
          </div>
        )}
        {link && <textarea readOnly dir="ltr" className={`${inputCls} h-20 py-2 font-mono text-xs`} value={link} onFocus={(e) => e.target.select()} />}
        <MemberOwnerPanel id={account.id} onDeleted={onClose} />
      </div>
    </Sheet>
  );
}
