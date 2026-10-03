import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { api, del, errorMessage, put } from "../api";
import { derivePasswordKey, passwordProblems } from "../lib/password";
import { tr } from "../i18n";
import { ago, date } from "../lib/format";
import { useMe } from "../Shell";
import { Badge, Button, ListSkeleton, useToast } from "../ui";
import { PERMISSION_LABEL } from "./System";

interface Details {
  member: {
    id: number; email: string; name: string; phone: string | null; telegram_user_id: number | null; is_active: number; last_seen_at: number | null;
    created_at: number; email_verified_at: number | null; failed_logins: number; locked_until: number | null; has_password: number; role: string;
    role_name: string; permissions: string[];
  };
  sessions: { id: number; user_agent: string | null; created_at: number; last_seen_at: number; expires_at: number }[];
  actions: { action: string; entity: string; entity_id: string | null; created_at: number }[];
  counts: { order_changes: number; confirmed: number; stock_moves: number };
}

/** "Chrome · Android" from a browser's user agent. */
function device(ua: string | null): string {
  if (!ua) return tr("Appareil inconnu");
  const browser = /Edg\//.test(ua) ? "Edge" : /OPR\//.test(ua) ? "Opera" : /Chrome\//.test(ua) ? "Chrome" : /Firefox\//.test(ua) ? "Firefox" : /Safari\//.test(ua) ? "Safari" : tr("Navigateur");
  const os = /Android/.test(ua) ? "Android" : /iPhone|iPad/.test(ua) ? "iPhone" : /Windows/.test(ua) ? "Windows" : /Mac OS/.test(ua) ? "Mac" : /Linux/.test(ua) ? "Linux" : "";
  return [browser, os].filter(Boolean).join(" · ");
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex justify-between gap-3 py-1.5 text-sm">
      <span className="text-ink-soft">{label}</span>
      <span className="text-end font-medium">{children}</span>
    </div>
  );
}

/**
 * The owner sees everything about an account (identity, access, devices, recent actions)
 * and can delete it. Nothing is shown to other roles.
 */
export function MemberOwnerPanel({ id, onDeleted }: { id: number; onDeleted: () => void }) {
  const me = useMe();
  const qc = useQueryClient();
  const toast = useToast();
  const owner = me.data?.role === "owner";
  const q = useQuery({ queryKey: ["team-details", id], queryFn: () => api<Details>(`/team/${id}/details`), enabled: owner });
  const remove = useMutation({
    mutationFn: () => del(`/team/${id}`),
    onSuccess: () => {
      toast(tr("Compte supprimé"));
      void qc.invalidateQueries({ queryKey: ["team"] });
      void qc.invalidateQueries({ queryKey: ["accounts"] });
      onDeleted();
    },
    onError: (e) => toast(errorMessage(e), "error"),
  });
  if (!owner) return null;
  if (!q.data) return <ListSkeleton rows={3} />;
  const { member: m, sessions, actions, counts } = q.data;
  const locked = m.locked_until != null && m.locked_until > Date.now();
  const all = m.permissions.includes("*");
  return (
    <section className="space-y-4 rounded-xl border border-line bg-ivory-deep/50 p-4">
      <p className="text-xs font-semibold uppercase tracking-[0.12em] text-ink-soft">{tr("👑 Fiche complète (visible par la propriétaire)")}</p>
      <div className="divide-y divide-line">
        <Row label={tr("Nom")}>{m.name}</Row>
        <Row label={tr("Email")}><span dir="ltr">{m.email}</span></Row>
        <Row label={tr("Téléphone")}><bdi dir="ltr">{m.phone ?? "—"}</bdi></Row>
        <Row label={tr("ID Telegram")}>{m.telegram_user_id ?? "—"}</Row>
        <Row label={tr("Rôle")}>{tr(m.role_name)}</Row>
        <Row label={tr("Statut")}>
          <Badge tone={!m.is_active ? "bg-stone-200 text-stone-700" : locked ? "bg-amber-100 text-amber-800" : "bg-emerald-100 text-emerald-800"}>
            {!m.is_active ? tr("Désactivé") : locked ? tr("Bloqué (trop d'essais)") : tr("Actif")}
          </Badge>
        </Row>
        <Row label={tr("Mot de passe")}>{m.has_password ? tr("Défini") : tr("Invitation pas encore acceptée")}</Row>
        <Row label={tr("Email vérifié")}>{m.email_verified_at ? date(m.email_verified_at) : tr("Non")}</Row>
        <Row label={tr("Essais de connexion ratés")}>{m.failed_logins}</Row>
        <Row label={tr("Compte créé")}>{date(m.created_at)}</Row>
        <Row label={tr("Dernière activité")}>{m.last_seen_at ? ago(m.last_seen_at) : tr("Jamais connecté")}</Row>
        <Row label={tr("Activité")}>{tr("{0} changement(s) de statut · {1} confirmation(s) · {2} mouvement(s) de stock", { 0: counts.order_changes, 1: counts.confirmed, 2: counts.stock_moves })}</Row>
      </div>
      <div>
        <p className="mb-1.5 text-sm font-semibold">{tr("Droits")}</p>
        {all ? (
          <p className="text-sm">{tr("Tous les droits")}</p>
        ) : (
          <div className="flex flex-wrap gap-1.5">
            {m.permissions.map((p) => (
              <span key={p} className="rounded-full bg-surface px-2.5 py-1 text-xs ring-1 ring-line">{PERMISSION_LABEL[p] ?? p}</span>
            ))}
          </div>
        )}
      </div>
      <div>
        <p className="mb-1.5 text-sm font-semibold">{tr("Appareils connectés ({0})", { 0: sessions.length })}</p>
        {sessions.length === 0 ? (
          <p className="text-sm text-ink-soft">{tr("Aucun")}</p>
        ) : (
          <ul className="space-y-1 text-sm">
            {sessions.map((s) => (
              <li key={s.id} className="flex justify-between gap-3">
                <span>{device(s.user_agent)}</span>
                <span className="text-xs text-ink-soft">{tr("vu {0} · connecté le {1}", { 0: ago(s.last_seen_at), 1: date(s.created_at) })}</span>
              </li>
            ))}
          </ul>
        )}
      </div>
      {actions.length > 0 && (
        <div>
          <p className="mb-1.5 text-sm font-semibold">{tr("Dernières actions")}</p>
          <ul className="space-y-1 text-xs text-ink-soft">
            {actions.map((a, i) => (
              <li key={i}>
                {ago(a.created_at)} · {a.action} · {a.entity}{a.entity_id ? ` #${a.entity_id}` : ""}
              </li>
            ))}
          </ul>
        </div>
      )}
      {m.id !== me.data?.id && <SetPassword id={m.id} email={m.email} name={m.name} />}
      {m.id !== me.data?.id && (
        <div className="border-t border-line pt-3">
          <Button
            variant="danger"
            loading={remove.isPending}
            onClick={() => confirm(tr("Supprimer définitivement le compte de {0} ? Ses actions restent dans l'historique.", { 0: m.name })) && remove.mutate()}
          >
            {tr("🗑 Supprimer ce compte")}
          </Button>
        </div>
      )}
    </section>
  );
}

/** A readable password: 3 words-like chunks and digits, e.g. "Rose-Lune-48Kp". */
function generatePassword(): string {
  const parts = ["Rose", "Lune", "Soie", "Perle", "Fleur", "Satin", "Ambre", "Iris", "Jade", "Opale"];
  const r = crypto.getRandomValues(new Uint32Array(4));
  const tail = (r[2]! % 90) + 10;
  const letters = "ABCDEFGHJKMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz";
  return `${parts[r[0]! % parts.length]}-${parts[r[1]! % parts.length]}-${tail}${letters[r[3]! % letters.length]}${letters[(r[3]! >> 8) % letters.length]}`;
}

/**
 * Passwords are never stored readable (nobody can see them, not even the owner). The owner
 * can give an account a new one instead, and then knows it.
 */
function SetPassword({ id, email, name }: { id: number; email: string; name: string }) {
  const toast = useToast();
  const [pw, setPw] = useState("");
  const [show, setShow] = useState(true);
  const [done, setDone] = useState<string | null>(null);
  const problem = pw ? passwordProblems(pw, email) : null;
  const save = useMutation({
    mutationFn: async () => put(`/team/${id}/password`, { newKey: await derivePasswordKey(email, pw) }),
    onSuccess: () => {
      setDone(pw);
      setPw("");
      toast(tr("Nouveau mot de passe enregistré ✓"));
    },
    onError: (e) => toast(errorMessage(e), "error"),
  });
  return (
    <div className="border-t border-line pt-3">
      <p className="text-sm font-semibold">{tr("🔑 Mot de passe")}</p>
      <p className="mb-2 text-xs text-ink-soft">
        {tr("Les mots de passe ne sont jamais enregistrés en clair : personne ne peut les lire, même pas vous. Vous pouvez en donner un nouveau à {0} (ses appareils seront déconnectés).", { 0: name })}
      </p>
      {done ? (
        <div className="rounded-lg bg-emerald-50 p-3 text-sm text-emerald-800">
          {tr("Nouveau mot de passe de {0} :", { 0: name })} <b className="font-mono" dir="ltr">{done}</b>
          <button type="button" className="ms-2 underline" onClick={() => navigator.clipboard?.writeText(done)}>{tr("Copier")}</button>
        </div>
      ) : (
        <>
          <div className="flex flex-wrap gap-2">
            <input
              type={show ? "text" : "password"}
              dir="ltr"
              autoComplete="new-password"
              className="h-10 min-w-0 flex-1 rounded-lg border border-line bg-surface px-3 font-mono text-sm"
              placeholder={tr("Nouveau mot de passe")}
              value={pw}
              onChange={(e) => setPw(e.target.value)}
            />
            <Button size="sm" onClick={() => setShow(!show)}>{show ? tr("Masquer") : tr("Afficher")}</Button>
            <Button size="sm" onClick={() => setPw(generatePassword())}>{tr("Générer")}</Button>
          </div>
          {problem && <p className="mt-1 text-xs text-red-700">{problem}</p>}
          <Button size="sm" variant="primary" className="mt-2" disabled={!pw || !!problem} loading={save.isPending} onClick={() => save.mutate()}>
            {tr("Enregistrer ce mot de passe")}
          </Button>
        </>
      )}
    </div>
  );
}
