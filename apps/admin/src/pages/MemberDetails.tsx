import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api, del, errorMessage } from "../api";
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
