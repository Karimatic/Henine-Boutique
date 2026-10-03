import { ROLE_PRESETS, SIZE_GUIDE_TEMPLATE } from "@henine/shared";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate, useSearch } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { api, del, errorMessage, patch, post, put } from "../api";
import { ago, da, dateTime } from "../lib/format";
import { derivePasswordKey, passwordProblems } from "../lib/password";
import { useCan, useMe } from "../Shell";
import {
  Badge, Button, Card, Empty, ErrorState, inputCls, ListSkeleton, NumberField, PageHeader, Pills, Select, Sheet, TextArea, TextField, Toggle, useToast,
} from "../ui";
import { lang, setLang, tr } from "../i18n";
import { useColorMode, type ColorMode } from "../lib/colorMode";
import { MemberOwnerPanel } from "./MemberDetails";

function useSave<T>(fn: (v: T) => Promise<unknown>, keys: string[], ok = "Enregistré ✓") {
  const qc = useQueryClient();
  const toast = useToast();
  return useMutation({
    mutationFn: fn,
    onSuccess: () => {
      toast(tr(ok));
      for (const k of keys) void qc.invalidateQueries({ queryKey: [k] });
    },
    onError: (e) => toast(errorMessage(e), "error"),
  });
}

/* ───────────── Équipe ───────────── */

interface Member {
  id: number;
  email: string;
  name: string;
  phone: string | null;
  telegram_user_id: number | null;
  is_active: number;
  last_seen_at: number | null;
  has_password: number;
  role: string;
  role_name: string;
  sessions: number;
}

export const PERMISSION_LABEL: Record<string, string> = {
  "orders.confirm": tr("Confirmer / annuler"), "orders.ship": tr("Préparer / expédier"), "orders.edit": tr("Modifier commandes"), "orders.export": tr("Exporter"),
  "customers.edit": tr("Fiches clientes"), "products.edit": tr("Produits"), "stock.edit": tr("Stock"), "cost.view": tr("Prix d'achat"), "sales.create": tr("Ventes manuelles"),
  "promos.edit": tr("Promos"), "loyalty.edit": tr("Fidélité"), "marketing.edit": tr("Marketing"), "reviews.moderate": tr("Avis"), "stats.view": tr("Statistiques"),
  "content.edit": tr("Contenu"), "delivery.edit": tr("Tarifs livraison"), "team.manage": tr("Équipe"), "integrations.manage": tr("Intégrations"),
};

export function TeamPage() {
  const me = useMe();
  const q = useQuery({ queryKey: ["team"], queryFn: () => api<{ members: Member[]; roles: { key: string; name: string; permissions: string[] }[] }>("/team") });
  const [invite, setInvite] = useState(false);
  const [edit, setEdit] = useState<Member | null>(null);
  return (
    <div className="space-y-4">
      <PageHeader group={tr("Système")} title={tr("Équipe")} subtitle={tr("Chaque membre se connecte avec son email + mot de passe + code reçu par email.")} actions={<Button variant="primary" onClick={() => setInvite(true)}>{tr("+ Inviter")}</Button>} />
      {q.error ? <ErrorState error={q.error} onRetry={q.refetch} /> : !q.data ? <ListSkeleton /> : (
        <>
          <ul className="divide-y divide-line overflow-hidden rounded-xl border border-line bg-surface">
            {q.data.members.map((m) => (
              <li key={m.id}>
                <button type="button" onClick={() => setEdit(m)} className={`flex w-full items-center justify-between gap-3 px-4 py-3 text-start hover:bg-rose-100/30 ${m.is_active ? "" : "opacity-50"}`}>
                  <span className="min-w-0">
                    <span className="block truncate font-medium">{m.name}{m.id === me.data?.id ? tr(" (vous)") : ""}</span>
                    <span className="block truncate text-xs text-ink-soft">{m.email} {tr("· vu")} {ago(m.last_seen_at)}</span>
                  </span>
                  <span className="flex shrink-0 flex-col items-end gap-1">
                    <Badge>{m.role_name}</Badge>
                    {!m.has_password && <Badge tone="bg-amber-100 text-amber-800">{tr("Invitation en attente")}</Badge>}
                    {m.telegram_user_id ? <span className="text-xs text-ink-soft">{tr("📱 Telegram lié")}</span> : null}
                  </span>
                </button>
              </li>
            ))}
          </ul>
          <Card title={tr("Rôles et droits")}>
            <ul className="space-y-3 text-sm">
              {q.data.roles.map((r) => (
                <li key={r.key}>
                  <p className="font-semibold">{r.name}</p>
                  <p className="text-xs text-ink-soft">{r.permissions.includes("*") ? tr("Tous les droits") : r.permissions.filter((p) => tr(PERMISSION_LABEL[p])).map((p) => tr(PERMISSION_LABEL[p])).join(" · ") || tr("Consultation")}</p>
                </li>
              ))}
            </ul>
          </Card>
        </>
      )}
      {invite && <InviteSheet onClose={() => setInvite(false)} />}
      {edit && <MemberSheet member={edit} onClose={() => setEdit(null)} />}
    </div>
  );
}

function InviteSheet({ onClose }: { onClose: () => void }) {
  const [form, setForm] = useState({ email: "", name: "", role: "confirmation" });
  const [result, setResult] = useState<{ inviteUrl: string; emailed: boolean } | null>(null);
  const save = useSave(() => post<{ inviteUrl: string; emailed: boolean }>("/team", form).then(setResult), ["team"], tr("Invitation créée"));
  return (
    <Sheet open onClose={onClose} title={tr("Inviter un membre")}>
      {result ? (
        <div className="space-y-3">
          <p className="text-sm">{result.emailed ? tr("✉️ L'invitation a été envoyée par email.") : tr("Envoyez ce lien à la personne (WhatsApp, Telegram…). Il est valable 7 jours et utilisable une seule fois :")}</p>
          <textarea readOnly className={`${inputCls} h-24 py-2 font-mono text-xs`} value={result.inviteUrl} onFocus={(e) => e.target.select()} />
          <Button onClick={() => navigator.clipboard?.writeText(result.inviteUrl)}>{tr("Copier le lien")}</Button>
        </div>
      ) : (
        <div className="space-y-3">
          <TextField label={tr("Prénom / nom")} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
          <TextField label={tr("Email")} type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />
          <Select label={tr("Rôle")} value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value })}>
            {Object.entries(ROLE_PRESETS).map(([k, r]) => <option key={k} value={k}>{r.name}</option>)}
          </Select>
          <Button variant="primary" className="w-full" loading={save.isPending} onClick={() => save.mutate(undefined)}>{tr("Créer l'invitation")}</Button>
        </div>
      )}
    </Sheet>
  );
}

function MemberSheet({ member, onClose }: { member: Member; onClose: () => void }) {
  const [role, setRole] = useState(member.role);
  const [name, setName] = useState(member.name);
  const [tg, setTg] = useState<number | null>(member.telegram_user_id);
  const [link, setLink] = useState<string | null>(null);
  // the level only changes if a different ready-made level is picked ("Sur mesure" is edited in Comptes)
  const save = useSave(() => patch(`/team/${member.id}`, { name, telegramUserId: tg, ...(role !== member.role ? { role } : {}) }), ["team"]);
  const toggleActive = useSave(() => patch(`/team/${member.id}`, { isActive: !member.is_active }), ["team"], member.is_active ? tr("Accès désactivé") : tr("Accès réactivé"));
  const reinvite = useSave(() => post<{ inviteUrl: string }>(`/team/${member.id}/invite`).then((r) => setLink(r.inviteUrl)), [], tr("Nouveau lien créé"));
  const revoke = useSave(() => del(`/team/${member.id}/sessions`), ["team"], tr("Déconnecté de tous les appareils"));
  return (
    <Sheet open onClose={onClose} title={member.name} footer={<Button variant="primary" className="w-full" loading={save.isPending} onClick={() => save.mutate(undefined, { onSuccess: onClose })}>{tr("Enregistrer")}</Button>}>
      <div className="space-y-3">
        <p className="text-sm text-ink-soft">{member.email} · {member.sessions} {tr("appareil(s) connecté(s)")}</p>
        <TextField label={tr("Nom")} value={name} onChange={(e) => setName(e.target.value)} />
        <Select label={tr("Rôle")} value={role} onChange={(e) => setRole(e.target.value)}>
          {member.role.startsWith("custom-") && <option value={member.role}>{tr("Sur mesure (droits réglés dans Comptes)")}</option>}
          {Object.entries(ROLE_PRESETS).map(([k, r]) => <option key={k} value={k}>{tr(r.name)}</option>)}
        </Select>
        <p className="text-xs text-ink-soft">
          {tr("Pour choisir les droits un par un :")} <a href="/admin/comptes" className="font-semibold text-plum-600">{tr("Comptes")}</a>
        </p>
        <NumberField label={tr("ID Telegram")} hint={tr("envoyez /id au bot pour l'obtenir")} value={tg} onChange={setTg} />
        <div className="flex flex-wrap gap-2 border-t border-line pt-3">
          <Button size="sm" onClick={() => reinvite.mutate(undefined)}>{member.has_password ? tr("Lien de réinitialisation") : tr("Renvoyer l'invitation")}</Button>
          <Button size="sm" onClick={() => revoke.mutate(undefined)}>{tr("Déconnecter partout")}</Button>
          <Button size="sm" variant="danger" onClick={() => confirm(member.is_active ? tr("Désactiver l'accès de ce membre ?") : tr("Réactiver ce membre ?")) && toggleActive.mutate(undefined, { onSuccess: onClose })}>
            {member.is_active ? tr("Désactiver l'accès") : tr("Réactiver")}
          </Button>
        </div>
        {link && <textarea readOnly className={`${inputCls} h-20 py-2 font-mono text-xs`} value={link} onFocus={(e) => e.target.select()} />}
        <MemberOwnerPanel id={member.id} onDeleted={onClose} />
      </div>
    </Sheet>
  );
}

/* ───────────── Comptes (my account + integrations) ───────────── */

interface Integrations {
  telegram: { tokenMasked: string | null; botUsername: string | null; chatId: string | null; chatTitle: string | null; webhookUrl: string | null; mode: string; trustGroup: boolean };
  mail: { provider: string; from: string | null };
  zr: { configured: boolean; idMasked: string | null };
  pixels: { metaPixelId: string | null; tiktokPixelId: string | null };
  turnstile: { siteKey: string; testKeys: boolean };
  publicOrigin: string;
}

export function MyAccount() {
  const me = useMe();
  const toast = useToast();
  const q = useQuery({ queryKey: ["account"], queryFn: () => api<{ member: { email: string; name: string; roleName: string }; sessions: { id: number; user_agent: string; created_at: number; last_seen_at: number; current: boolean }[] }>("/account") });
  const [pw, setPw] = useState({ current: "", next: "", confirm: "" });
  const [busy, setBusy] = useState(false);
  const revoke = useSave((id: number) => del(`/account/sessions/${id}`), ["account"], tr("Appareil déconnecté"));
  async function changePassword() {
    const email = me.data!.email;
    const problem = passwordProblems(pw.next, email);
    if (problem) return toast(problem, "error");
    if (pw.next !== pw.confirm) return toast(tr("Les deux mots de passe ne correspondent pas."), "error");
    setBusy(true);
    try {
      await post("/account/password", { currentKey: await derivePasswordKey(email, pw.current), newKey: await derivePasswordKey(email, pw.next) });
      toast(tr("Mot de passe changé ✓ (autres appareils déconnectés)"));
      setPw({ current: "", next: "", confirm: "" });
    } catch (e) {
      toast(errorMessage(e), "error");
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
    <Card title={tr("🌐 Langue de l'administration")}>
      <p className="mb-3 text-sm text-ink-soft">{tr("Choisissez la langue de ce panneau sur cet appareil. La boutique garde ses deux langues.")}</p>
      <div className="inline-grid grid-cols-2 gap-2">
        {(
          [
            ["fr", "Français"],
            ["ar", "العربية"],
          ] as const
        ).map(([code, label]) => (
          <button
            key={code}
            type="button"
            onClick={() => code !== lang && setLang(code)}
            aria-pressed={lang === code}
            className={`h-11 min-w-32 rounded-xl border px-5 text-sm font-semibold transition ${lang === code ? "border-plum-600 bg-plum-600 text-white" : "border-line bg-surface hover:border-plum-600"}`}
            lang={code}
          >
            {label}
          </button>
        ))}
      </div>
    </Card>
    <ColorModeCard />
    <Card title={tr("👤 Mon compte")}>
      {q.data && <p className="mb-3 text-sm">{q.data.member.name} · {q.data.member.email} · <Badge>{q.data.member.roleName}</Badge></p>}
      <div className="grid gap-3 sm:grid-cols-3">
        <TextField label={tr("Mot de passe actuel")} type="password" autoComplete="current-password" value={pw.current} onChange={(e) => setPw({ ...pw, current: e.target.value })} />
        <TextField label={tr("Nouveau")} type="password" autoComplete="new-password" value={pw.next} onChange={(e) => setPw({ ...pw, next: e.target.value })} />
        <TextField label={tr("Confirmer")} type="password" autoComplete="new-password" value={pw.confirm} onChange={(e) => setPw({ ...pw, confirm: e.target.value })} />
      </div>
      <Button className="mt-3" loading={busy} disabled={!pw.current || !pw.next} onClick={changePassword}>{tr("Changer le mot de passe")}</Button>
      <h3 className="mb-2 mt-5 text-sm font-semibold">{tr("Appareils connectés")}</h3>
      <ul className="space-y-2 text-sm">
        {q.data?.sessions.map((s) => (
          <li key={s.id} className="flex items-center justify-between gap-2">
            <span>{s.user_agent}{s.current ? tr(" · cet appareil") : ""} <span className="text-ink-soft">· {ago(s.last_seen_at)}</span></span>
            {!s.current && <Button size="sm" variant="ghost" onClick={() => revoke.mutate(s.id)}>{tr("Déconnecter")}</Button>}
          </li>
        ))}
      </ul>
    </Card>
    </>
  );
}

export function IntegrationsSection() {
  const toast = useToast();
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ["integrations"], queryFn: () => api<Integrations>("/integrations") });
  const [token, setToken] = useState("");
  const [chats, setChats] = useState<{ id: number; title: string; type: string }[] | null>(null);
  const [zr, setZr] = useState({ id: "", token: "" });
  const [pixels, setPixels] = useState({ meta: "", tiktok: "" });
  useEffect(() => {
    if (q.data) setPixels({ meta: q.data.pixels.metaPixelId ?? "", tiktok: q.data.pixels.tiktokPixelId ?? "" });
  }, [q.data]);
  const refresh = () => {
    void qc.invalidateQueries({ queryKey: ["integrations"] });
    void qc.invalidateQueries({ queryKey: ["me"] });
  };
  const run = async (fn: () => Promise<unknown>, ok: string) => {
    try {
      await fn();
      toast(tr(ok));
      refresh();
    } catch (e) {
      toast(errorMessage(e), "error");
    }
  };
  if (q.error) return <ErrorState error={q.error} onRetry={q.refetch} />;
  if (!q.data) return <ListSkeleton rows={3} />;
  const t = q.data.telegram;
  return (
    <>
      <Card title={tr("📱 Telegram : commandes dans le groupe de l'équipe")}>
        <ol className="mb-4 list-decimal space-y-1 ps-5 text-sm text-ink-soft">
          <li>{tr("Sur Telegram, ouvrez")} <b>{tr("@BotFather")}</b> → <code>/newbot</code> {tr("→ copiez le")} <b>{tr("token")}</b>.</li>
          <li>{tr("Ajoutez ce bot dans le groupe de l'équipe, puis envoyez")} <code>/start</code> {tr("dans le groupe.")}</li>
          <li>{tr("Collez le token ci-dessous, puis « Détecter le groupe ».")}</li>
        </ol>
        <div className="space-y-3">
          <div className="flex gap-2">
            <input className={inputCls} placeholder={t.tokenMasked ? tr("Token enregistré {0}", { 0: t.tokenMasked }) : tr("123456789:AA…")} value={token} onChange={(e) => setToken(e.target.value.trim())} aria-label={tr("Token du bot")} />
            <Button onClick={() => run(() => post("/integrations/telegram/token", { token }).then(() => setToken("")), tr("Bot connecté ✓"))} disabled={!token}>{tr("Enregistrer")}</Button>
          </div>
          {t.botUsername && <p className="text-sm">{tr("Bot :")} <b>@{t.botUsername}</b></p>}
          {t.botUsername && (
            <div>
              <Button size="sm" onClick={() => run(() => post<{ id: number; title: string; type: string }[]>("/integrations/telegram/detect").then(setChats), tr("Recherche terminée"))}>{tr("Détecter le groupe")}</Button>
              {chats && (chats.length === 0 ? (
                <p className="mt-2 text-sm text-amber-700">{tr("Aucun groupe trouvé : envoyez un message (ex : /start) dans le groupe après y avoir ajouté le bot, puis réessayez.")}</p>
              ) : (
                <ul className="mt-2 space-y-1">
                  {chats.map((c) => (
                    <li key={c.id}>
                      <button type="button" className="w-full rounded-xl border border-line bg-surface px-3 py-2 text-start text-sm hover:border-plum-600" onClick={() => run(() => post("/integrations/telegram/chat", { chatId: String(c.id), chatTitle: c.title }), `Groupe « ${c.title} » sélectionné`)}>
                        {c.type === "private" ? "👤" : "👥"} {c.title} <span className="text-xs text-ink-soft">({c.id})</span>
                      </button>
                    </li>
                  ))}
                </ul>
              ))}
            </div>
          )}
          {t.chatId && (
            <div className="rounded-xl bg-emerald-50 p-3 text-sm">
              {tr("✅ Les commandes sont envoyées dans")} <b>{t.chatTitle ?? t.chatId}</b>.
              <div className="mt-2 flex flex-wrap gap-2">
                <Button size="sm" variant="primary" onClick={() => run(() => post("/integrations/telegram/test"), tr("Message test envoyé"))}>{tr("Envoyer un message test")}</Button>
                {t.mode !== "poll" && <Button size="sm" onClick={() => run(() => post("/integrations/telegram/webhook"), tr("Boutons activés (webhook)"))}>{t.webhookUrl ? tr("Réactiver les boutons") : tr("Activer les boutons")}</Button>}
                <Button size="sm" variant="danger" onClick={() => confirm(tr("Déconnecter le bot ?")) && run(() => del("/integrations/telegram"), tr("Bot déconnecté"))}>{tr("Déconnecter")}</Button>
              </div>
              <p className="mt-2 text-xs text-ink-soft">
                {t.mode === "poll" ? tr("Mode développement : les boutons Telegram fonctionnent tant que cet admin est ouvert.") : t.webhookUrl ? tr("Boutons actifs via {0}", { 0: t.webhookUrl }) : tr("Activez les boutons après le déploiement en ligne.")}
              </p>
            </div>
          )}
        </div>
      </Card>

      <InstagramCard />

      <Card title={tr("✉️ Emails (codes de connexion, invitations)")}>
        <p className="text-sm">
          {tr("Fournisseur :")} <b>{q.data.mail.provider === "console" ? tr("aucun (mode développement : codes affichés à l'écran)") : q.data.mail.provider}</b>
          {q.data.mail.from && q.data.mail.provider !== "console" ? tr(" · expéditeur {0}", { 0: q.data.mail.from }) : ""}
        </p>
        {q.data.mail.provider === "console" && (
          <p className="mt-2 text-xs text-ink-soft">{tr("En ligne : créez un compte gratuit Brevo (300 emails/jour) ou Resend, puis ajoutez la clé comme secret Cloudflare (MAIL_PROVIDER, MAIL_API_KEY, MAIL_FROM). Voir README.")}</p>
        )}
        <Button size="sm" className="mt-2" onClick={() => run(() => post("/integrations/mail/test"), tr("Email de test envoyé (vérifiez votre boîte)"))}>{tr("M'envoyer un email de test")}</Button>
      </Card>

      <Card title={tr("🚚 ZR Express")}>
        <p className="mb-3 text-sm text-ink-soft">
          {q.data.zr.configured ? tr("Identifiants enregistrés ({0}).", { 0: q.data.zr.idMasked }) : tr("Non connecté.")} {tr("La création automatique des colis et le suivi ZR arrivent dans une prochaine étape ; en attendant, saisissez le n° de suivi dans la commande.")}
        </p>
        <div className="grid gap-2 sm:grid-cols-[1fr_1fr_auto]">
          <input className={inputCls} placeholder={tr("ID / Tenant ZR")} value={zr.id} onChange={(e) => setZr({ ...zr, id: e.target.value })} aria-label={tr("ID ZR Express")} />
          <input className={inputCls} placeholder={tr("Clé API / token ZR")} type="password" value={zr.token} onChange={(e) => setZr({ ...zr, token: e.target.value })} aria-label={tr("Clé API ZR Express")} />
          <Button disabled={!zr.id || !zr.token} onClick={() => run(() => put("/integrations/zr", zr).then(() => setZr({ id: "", token: "" })), tr("Identifiants ZR enregistrés (chiffrés)"))}>{tr("Enregistrer")}</Button>
        </div>
      </Card>

      <Card title={tr("📈 Pixels publicitaires")}>
        <div className="grid gap-2 sm:grid-cols-[1fr_1fr_auto] sm:items-end">
          <TextField label={tr("Meta (Facebook/Instagram) Pixel ID")} value={pixels.meta} onChange={(e) => setPixels({ ...pixels, meta: e.target.value.replace(/\D/g, "") })} />
          <TextField label={tr("TikTok Pixel ID")} value={pixels.tiktok} onChange={(e) => setPixels({ ...pixels, tiktok: e.target.value.toUpperCase() })} />
          <Button onClick={() => run(() => put("/integrations/pixels", { metaPixelId: pixels.meta || null, tiktokPixelId: pixels.tiktok || null }), tr("Pixels enregistrés"))}>{tr("Enregistrer")}</Button>
        </div>
        <p className="mt-2 text-xs text-ink-soft">{tr("L'activation des pixels sur la boutique (avec consentement) arrive avec la mise en ligne.")}</p>
      </Card>

      <Card title={tr("🛡 Anti-robots (Cloudflare Turnstile)")}>
        <p className="text-sm">{q.data.turnstile.testKeys ? tr("Clés de test (développement). Créez un widget Turnstile gratuit avant la mise en ligne.") : tr("Clés de production actives ✓")}</p>
      </Card>
    </>
  );
}

/** Instagram: one-time connection, then "📸 Depuis Instagram" in the product editor. */
function InstagramCard() {
  const toast = useToast();
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ["instagram-status"], queryFn: () => api<{ connected: boolean; username: string | null; refreshedAt: number | null }>("/integrations/instagram") });
  const [token, setToken] = useState("");
  const [busy, setBusy] = useState(false);
  async function connect() {
    setBusy(true);
    try {
      const r = await post<{ username: string; mediaCount: number | null }>("/integrations/instagram", { token });
      toast(tr("Instagram connecté ✓ @{0}{1}", { 0: r.username, 1: r.mediaCount != null ? ` · ${r.mediaCount} publications` : "" }));
      setToken("");
      void qc.invalidateQueries({ queryKey: ["instagram-status"] });
      void qc.invalidateQueries({ queryKey: ["instagram-media"] });
    } catch (e) {
      toast(errorMessage(e), "error");
    } finally {
      setBusy(false);
    }
  }
  return (
    <Card title={tr("📸 Instagram : photos des produits depuis vos publications")}>
      {q.data?.connected ? (
        <div className="space-y-3">
          <p className="rounded-xl bg-emerald-50 p-3 text-sm">
            {tr("✅ Connecté à")} <b>@{q.data.username}</b>{tr(". Dans une fiche produit, « 📸 Depuis Instagram » affiche vos publications : cochez les photos, elles sont ajoutées en pleine qualité. La connexion se renouvelle toute seule.")}
          </p>
          <Button size="sm" variant="danger" onClick={() => confirm(tr("Déconnecter Instagram ?")) && del("/integrations/instagram").then(() => qc.invalidateQueries({ queryKey: ["instagram-status"] }))}>
            {tr("Déconnecter")}
          </Button>
        </div>
      ) : (
        <>
          <p className="mb-2 text-sm text-ink-soft">{tr("Gratuit, à faire une seule fois (10 minutes) :")}</p>
          <ol className="mb-4 list-decimal space-y-1.5 ps-5 text-sm text-ink-soft">
            <li>{tr("Sur Instagram, le compte de la boutique doit être un")} <b>{tr("compte professionnel")}</b> {tr("(Paramètres → Type de compte → Passer à un compte professionnel).")}</li>
            <li>
              {tr("Sur")} <b>{tr("developers.facebook.com")}</b> {tr("→ « Mes apps » → « Créer une app » (type")} <i>{tr("Entreprise")}</i>{tr(") → ajoutez le produit")} <b>{tr("Instagram")}</b> {tr("→ « Configuration de l'API avec la connexion Instagram ».")}
            </li>
            <li>{tr("Dans « Générer des jetons d'accès », ajoutez le compte de la boutique puis cliquez sur « Générer le jeton ».")}</li>
            <li>{tr("Copiez le jeton et collez-le ici.")}</li>
          </ol>
          <div className="flex gap-2">
            <input className={inputCls} placeholder={tr("IGAA…")} value={token} onChange={(e) => setToken(e.target.value.trim())} aria-label={tr("Jeton Instagram")} autoComplete="off" />
            <Button variant="primary" loading={busy} disabled={token.length < 40} onClick={connect}>
              {tr("Connecter")}
            </Button>
          </div>
        </>
      )}
    </Card>
  );
}

/* ───────────── Contenu ───────────── */

type ContentTab = "livraison" | "pages" | "categories" | "tailles" | "boutique";

export function ContentPage() {
  const can = useCan();
  const navigate = useNavigate();
  const search = useSearch({ strict: false }) as { tab?: string };
  const tabs: ContentTab[] = ["livraison", "pages", "categories", "tailles", "boutique"];
  const tab: ContentTab = tabs.includes(search.tab as ContentTab) ? (search.tab as ContentTab) : can("delivery.edit") ? "livraison" : "pages";
  const setTab = (t: ContentTab) => void navigate({ to: "/contenu", search: { tab: t } });
  return (
    <div>
      <PageHeader group={tr("Système")} title={tr("Contenu")} subtitle={tr("Tarifs de livraison, pages d'information, catégories et identité de la boutique.")} />
      <Pills
        value={tab}
        onChange={setTab}
        options={[
          ...(can("delivery.edit") ? [{ value: "livraison" as const, label: tr("🚚 Livraison") }] : []),
          { value: "pages", label: tr("📄 Pages") },
          { value: "categories", label: tr("🗂 Catégories") },
          ...(can("products.edit") ? [{ value: "tailles" as const, label: tr("📏 Guides des tailles") }] : []),
          { value: "boutique", label: tr("🌸 Boutique") },
        ]}
      />
      {tab === "livraison" && <DeliveryPrices />}
      {tab === "pages" && <PagesEditor />}
      {tab === "categories" && <CategoriesEditor />}
      {tab === "tailles" && <SizeGuidesEditor />}
      {tab === "boutique" && <StoreIdentity />}
    </div>
  );
}

interface WilayaRow {
  code: number;
  name_fr: string;
  name_ar: string;
  parent_code: number | null;
  home_price: number | null;
  desk_price: number | null;
  delay_days: string | null;
  is_active: number;
  communes: number;
  orders: number;
}

function DeliveryPrices() {
  const q = useQuery({ queryKey: ["wilayas-admin"], queryFn: () => api<{ rows: WilayaRow[]; verified: boolean }>("/content/wilayas") });
  const [selected, setSelected] = useState<number[]>([]);
  const [bulk, setBulk] = useState<{ home: number | null; desk: number | null; delay: string }>({ home: null, desk: null, delay: "" });
  const [filter, setFilter] = useState("");
  const save = useSave((body: Record<string, unknown>) => put("/content/wilayas", body), ["wilayas-admin"], tr("Tarifs mis à jour ✓"));
  if (q.error) return <ErrorState error={q.error} onRetry={q.refetch} />;
  if (!q.data) return <ListSkeleton />;
  const rows = q.data.rows.filter((w) => !filter || `${w.code} ${w.name_fr}`.toLowerCase().includes(filter.toLowerCase()));
  return (
    <div className="space-y-4">
      {!q.data.verified && (
        <div className="rounded-xl border border-amber-300 bg-amber-50 p-4 text-sm text-amber-900">
          {tr("⚠️ Ces tarifs sont des")} <b>{tr("estimations par zone")}</b> {tr("depuis Boumerdès. Remplacez-les par la grille ZR Express d'Ilyas, puis confirmez.")}
          <Button size="sm" className="ms-2 mt-2" onClick={() => save.mutate({ codes: [35], markVerified: true })}>{tr("Les tarifs sont vérifiés")}</Button>
        </div>
      )}
      <Card title={tr("Modifier {0}", { 0: selected.length ? `${selected.length} wilaya(s) sélectionnée(s)` : "plusieurs wilayas à la fois" })}>
        <div className="grid gap-2 sm:grid-cols-[1fr_1fr_1fr_auto] sm:items-end">
          <NumberField label={tr("Domicile")} suffix={tr("DA")} value={bulk.home} onChange={(v) => setBulk({ ...bulk, home: v })} />
          <NumberField label={tr("Bureau")} suffix={tr("DA")} value={bulk.desk} onChange={(v) => setBulk({ ...bulk, desk: v })} />
          <TextField label={tr("Délai (jours)")} placeholder="2-3" value={bulk.delay} onChange={(e) => setBulk({ ...bulk, delay: e.target.value })} />
          <Button
            variant="primary"
            disabled={!selected.length}
            onClick={() =>
              save.mutate(
                { codes: selected, ...(bulk.home != null ? { homePrice: bulk.home } : {}), ...(bulk.desk != null ? { deskPrice: bulk.desk } : {}), ...(bulk.delay ? { delayDays: bulk.delay } : {}) },
                { onSuccess: () => setSelected([]) },
              )
            }
          >
            {tr("Appliquer")}
          </Button>
        </div>
      </Card>
      <input className={inputCls} placeholder={tr("Filtrer (ex : Alger, 16)…")} value={filter} onChange={(e) => setFilter(e.target.value)} aria-label={tr("Filtrer les wilayas")} />
      <div className="overflow-x-auto rounded-xl border border-line bg-surface">
        <table className="w-full min-w-[34rem] text-sm">
          <thead className="text-xs text-ink-soft">
            <tr className="border-b border-line">
              <th className="w-10 px-3 py-2"><input type="checkbox" className="size-4 accent-plum-600" aria-label={tr("Tout sélectionner")} checked={selected.length === rows.length && rows.length > 0} onChange={(e) => setSelected(e.target.checked ? rows.map((r) => r.code) : [])} /></th>
              <th className="py-2 text-start font-medium">{tr("Wilaya")}</th>
              <th className="px-2 text-end font-medium">{tr("Domicile")}</th>
              <th className="px-2 text-end font-medium">{tr("Bureau")}</th>
              <th className="px-2 text-end font-medium">{tr("Délai")}</th>
              <th className="px-3 text-end font-medium">{tr("Active")}</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((w) => (
              <tr key={w.code} className={`border-b border-line/60 last:border-0 ${w.is_active ? "" : "opacity-50"}`}>
                <td className="px-3"><input type="checkbox" className="size-4 accent-plum-600" aria-label={tr("Sélectionner {0}", { 0: w.name_fr })} checked={selected.includes(w.code)} onChange={(e) => setSelected(e.target.checked ? [...selected, w.code] : selected.filter((c) => c !== w.code))} /></td>
                <td className="py-2">
                  {w.code} - {w.name_fr}
                  {w.parent_code ? <span className="block text-xs text-ink-soft">{tr("nouvelle wilaya (ex-")}{w.parent_code}) · {w.communes} {tr("communes")}</span> : null}
                </td>
                <td className="px-1 text-end">
                  <CellInput value={w.home_price} suffix={tr("DA")} label={tr("Domicile {0}", { 0: w.name_fr })} onSave={(v) => save.mutate({ codes: [w.code], homePrice: v })} />
                </td>
                <td className="px-1 text-end">
                  <CellInput value={w.desk_price} suffix={tr("DA")} label={tr("Bureau {0}", { 0: w.name_fr })} onSave={(v) => save.mutate({ codes: [w.code], deskPrice: v })} />
                </td>
                <td className="px-1 text-end">
                  <CellInput text value={w.delay_days} suffix={tr("j")} label={tr("Délai {0}", { 0: w.name_fr })} onSave={(v) => save.mutate({ codes: [w.code], delayDays: v })} />
                </td>
                <td className="px-3 text-end">
                  <input type="checkbox" className="size-4 accent-plum-600" aria-label={tr("Livrer {0}", { 0: w.name_fr })} checked={!!w.is_active} onChange={(e) => save.mutate({ codes: [w.code], isActive: e.target.checked })} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

/** A price or delay typed right in the table: saved when leaving the box (or Enter) if it changed. */
function CellInput({ value, onSave, suffix, label, text = false }: { value: number | string | null; onSave: (v: never) => void; suffix: string; label: string; text?: boolean }) {
  const [v, setV] = useState(value == null ? "" : String(value));
  useEffect(() => setV(value == null ? "" : String(value)), [value]);
  const commit = () => {
    const raw = v.trim().replace(/[٠-٩]/g, (d) => String(d.charCodeAt(0) - 0x0660));
    if (raw === (value == null ? "" : String(value))) return;
    if (text) {
      if (/^\d{1,2}(-\d{1,2})?$/.test(raw)) onSave(raw as never);
      else setV(value == null ? "" : String(value));
      return;
    }
    const n = Math.round(Number(raw));
    if (raw !== "" && Number.isFinite(n) && n >= 0 && n <= 20000) onSave(n as never);
    else setV(value == null ? "" : String(value));
  };
  return (
    <span className="inline-flex items-center gap-1" dir="ltr">
      <input
        value={v}
        inputMode={text ? "text" : "numeric"}
        aria-label={label}
        onChange={(e) => setV(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLInputElement).blur()}
        className="h-9 w-20 rounded-lg border border-line bg-surface px-2 text-end tabular-nums focus:border-plum-600 focus:outline-none"
      />
      <span className="text-xs text-ink-soft">{suffix}</span>
    </span>
  );
}

interface PageRow {
  id: number;
  slug: string;
  title_fr: string;
  title_ar: string;
  body_fr: string;
  body_ar: string;
  is_active: number;
}

function PagesEditor() {
  const q = useQuery({ queryKey: ["pages"], queryFn: () => api<PageRow[]>("/content/pages") });
  const [edit, setEdit] = useState<Partial<PageRow> | null>(null);
  return (
    <div className="space-y-3">
      <div className="flex justify-end"><Button variant="primary" onClick={() => setEdit({ is_active: 1, body_fr: "", body_ar: "" })}>{tr("+ Nouvelle page")}</Button></div>
      {!q.data ? <ListSkeleton /> : (
        <ul className="divide-y divide-line overflow-hidden rounded-xl border border-line bg-surface">
          {q.data.map((p) => (
            <li key={p.id}>
              <button type="button" onClick={() => setEdit(p)} className="flex w-full items-center justify-between px-4 py-3 text-start hover:bg-rose-100/30">
                <span><span className="block font-medium">{p.title_fr}</span><span className="text-xs text-ink-soft">/p/{p.slug}</span></span>
                {!p.is_active && <Badge tone="bg-stone-200 text-stone-700">{tr("Masquée")}</Badge>}
              </button>
            </li>
          ))}
        </ul>
      )}
      {edit && <PageSheet page={edit} onClose={() => setEdit(null)} />}
    </div>
  );
}

function PageSheet({ page, onClose }: { page: Partial<PageRow>; onClose: () => void }) {
  const [f, setF] = useState(page);
  const body = () => ({ slug: f.slug ?? "", titleFr: f.title_fr ?? "", titleAr: f.title_ar ?? "", bodyFr: f.body_fr ?? "", bodyAr: f.body_ar ?? "", isActive: !!f.is_active });
  const save = useSave(() => (page.id ? put(`/content/pages/${page.id}`, body()) : post("/content/pages", body())), ["pages"]);
  const remove = useSave(() => del(`/content/pages/${page.id}`), ["pages"], tr("Page supprimée"));
  return (
    <Sheet
      open
      onClose={onClose}
      wide
      title={page.id ? f.title_fr : tr("Nouvelle page")}
      footer={
        <div className="flex justify-between gap-2">
          {page.id ? <Button variant="danger" onClick={() => confirm(tr("Supprimer cette page ?")) && remove.mutate(undefined, { onSuccess: onClose })}>{tr("Supprimer")}</Button> : <span />}
          <Button variant="primary" loading={save.isPending} onClick={() => save.mutate(undefined, { onSuccess: onClose })}>{tr("Enregistrer")}</Button>
        </div>
      }
    >
      <div className="grid gap-3 sm:grid-cols-2">
        <TextField label={tr("Titre (FR)")} value={f.title_fr ?? ""} onChange={(e) => setF({ ...f, title_fr: e.target.value })} />
        <TextField label={tr("Titre (AR)")} dir="rtl" value={f.title_ar ?? ""} onChange={(e) => setF({ ...f, title_ar: e.target.value })} />
        <TextField label={tr("Adresse")} hint="/p/…" value={f.slug ?? ""} onChange={(e) => setF({ ...f, slug: e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, "-") })} className="sm:col-span-2" />
        <TextArea label={tr("Texte (FR)")} hint="## titre · **gras** · - liste" rows={12} value={f.body_fr ?? ""} onChange={(e) => setF({ ...f, body_fr: e.target.value })} />
        <TextArea label={tr("Texte (AR)")} dir="rtl" rows={12} value={f.body_ar ?? ""} onChange={(e) => setF({ ...f, body_ar: e.target.value })} />
      </div>
      <Toggle label={tr("Visible sur la boutique")} checked={!!f.is_active} onChange={(v) => setF({ ...f, is_active: v ? 1 : 0 })} />
    </Sheet>
  );
}

interface CategoryRow {
  id: number;
  slug: string;
  name_fr: string;
  name_ar: string;
  description_fr: string | null;
  description_ar: string | null;
  sort: number;
  is_active: number;
  product_count: number;
}

function CategoriesEditor() {
  const q = useQuery({ queryKey: ["categories"], queryFn: () => api<CategoryRow[]>("/categories") });
  const [edit, setEdit] = useState<Partial<CategoryRow> | null>(null);
  return (
    <div className="space-y-3">
      <div className="flex justify-end"><Button variant="primary" onClick={() => setEdit({ is_active: 1, sort: (q.data?.length ?? 0) + 1 })}>{tr("+ Nouvelle catégorie")}</Button></div>
      {!q.data ? <ListSkeleton /> : q.data.length === 0 ? <Empty title={tr("Aucune catégorie")} /> : (
        <ul className="divide-y divide-line overflow-hidden rounded-xl border border-line bg-surface">
          {q.data.map((c) => (
            <li key={c.id}>
              <button type="button" onClick={() => setEdit(c)} className="flex w-full items-center justify-between px-4 py-3 text-start hover:bg-rose-100/30">
                <span><span className="block font-medium">{c.name_fr} · <span dir="rtl">{c.name_ar}</span></span><span className="text-xs text-ink-soft">/c/{c.slug} · {c.product_count} {tr("produit(s)")}</span></span>
                {!c.is_active && <Badge tone="bg-stone-200 text-stone-700">{tr("Masquée")}</Badge>}
              </button>
            </li>
          ))}
        </ul>
      )}
      {edit && <CategorySheet cat={edit} onClose={() => setEdit(null)} />}
    </div>
  );
}

function CategorySheet({ cat, onClose }: { cat: Partial<CategoryRow>; onClose: () => void }) {
  const [f, setF] = useState(cat);
  const body = () => ({ nameFr: f.name_fr ?? "", nameAr: f.name_ar ?? "", slug: f.slug || undefined, descriptionFr: f.description_fr || null, descriptionAr: f.description_ar || null, sort: f.sort ?? 0, isActive: !!f.is_active });
  const save = useSave(() => (cat.id ? put(`/categories/${cat.id}`, body()) : post("/categories", body())), ["categories"]);
  const remove = useSave(() => del(`/categories/${cat.id}`), ["categories"], tr("Catégorie supprimée"));
  return (
    <Sheet
      open
      onClose={onClose}
      title={cat.id ? f.name_fr : tr("Nouvelle catégorie")}
      footer={
        <div className="flex justify-between gap-2">
          {cat.id ? <Button variant="danger" onClick={() => confirm(tr("Supprimer cette catégorie (elle doit être vide) ?")) && remove.mutate(undefined, { onSuccess: onClose })}>{tr("Supprimer")}</Button> : <span />}
          <Button variant="primary" loading={save.isPending} onClick={() => save.mutate(undefined, { onSuccess: onClose })}>{tr("Enregistrer")}</Button>
        </div>
      }
    >
      <div className="grid gap-3">
        <TextField label={tr("Nom (FR)")} value={f.name_fr ?? ""} onChange={(e) => setF({ ...f, name_fr: e.target.value })} />
        <TextField label={tr("Nom (AR)")} dir="rtl" value={f.name_ar ?? ""} onChange={(e) => setF({ ...f, name_ar: e.target.value })} />
        <TextField label={tr("Adresse")} hint="/c/…" value={f.slug ?? ""} onChange={(e) => setF({ ...f, slug: e.target.value })} />
        <NumberField label={tr("Ordre d'affichage")} value={f.sort ?? 0} onChange={(v) => setF({ ...f, sort: v ?? 0 })} />
        <Toggle label={tr("Visible")} checked={!!f.is_active} onChange={(v) => setF({ ...f, is_active: v ? 1 : 0 })} />
      </div>
    </Sheet>
  );
}

/* ── Guides des tailles ── */

interface SizeGuide {
  id?: number;
  name: string;
  headersFr: string[];
  headersAr: string[];
  rows: string[][];
  tipsFr: string | null;
  tipsAr: string | null;
  productCount?: number;
}

function SizeGuidesEditor() {
  const q = useQuery({ queryKey: ["size-guides"], queryFn: () => api<SizeGuide[]>("/size-guides") });
  const [edit, setEdit] = useState<SizeGuide | null>(null);
  const fresh = (): SizeGuide => ({ name: "Lingerie & pyjamas", ...SIZE_GUIDE_TEMPLATE, rows: SIZE_GUIDE_TEMPLATE.rows.map((r) => [...r]) });
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm text-ink-soft">{tr("Un tableau des mesures par taille, affiché sur la fiche produit (« 📏 Guide des tailles »). Choisissez le guide de chaque produit dans sa fiche.")}</p>
        <Button variant="primary" onClick={() => setEdit(fresh())}>{tr("+ Nouveau guide")}</Button>
      </div>
      {q.error ? (
        <ErrorState error={q.error} onRetry={q.refetch} />
      ) : !q.data ? (
        <ListSkeleton rows={2} />
      ) : q.data.length === 0 ? (
        <Empty title={tr("Aucun guide des tailles")} icon="📏">
          {tr("Créez-en un : il est déjà prérempli avec les tailles S à XXL, il suffit d’ajuster les mesures.")}
        </Empty>
      ) : (
        <ul className="divide-y divide-line overflow-hidden rounded-xl border border-line bg-surface">
          {q.data.map((g) => (
            <li key={g.id}>
              <button type="button" onClick={() => setEdit(g)} className="flex w-full items-center justify-between px-4 py-3 text-start hover:bg-rose-100/30">
                <span>
                  <span className="block font-medium">{g.name}</span>
                  <span className="text-xs text-ink-soft">{g.rows.map((r) => r[0]).join(" · ")}</span>
                </span>
                <Badge>{g.productCount} {tr("produit(s)")}</Badge>
              </button>
            </li>
          ))}
        </ul>
      )}
      {edit && <SizeGuideSheet guide={edit} onClose={() => setEdit(null)} />}
    </div>
  );
}

function SizeGuideSheet({ guide, onClose }: { guide: SizeGuide; onClose: () => void }) {
  const [g, setG] = useState(guide);
  const payload = () => ({
    name: g.name, headersFr: g.headersFr, headersAr: g.headersAr, rows: g.rows.filter((r) => r.some((x) => x.trim())), tipsFr: g.tipsFr || null, tipsAr: g.tipsAr || null,
  });
  const save = useSave(() => (guide.id ? put(`/size-guides/${guide.id}`, payload()) : post("/size-guides", payload())), ["size-guides"], tr("Guide des tailles enregistré ✓"));
  const remove = useSave(() => del(`/size-guides/${guide.id}`), ["size-guides"], tr("Guide supprimé"));
  const cols = g.headersFr.length;
  const setHeader = (lang: "headersFr" | "headersAr", i: number, v: string) => setG({ ...g, [lang]: g[lang].map((h, k) => (k === i ? v : h)) });
  const setCell = (r: number, col: number, v: string) => setG({ ...g, rows: g.rows.map((row, k) => (k === r ? row.map((x, j) => (j === col ? v : x)) : row)) });
  const addCol = () => setG({ ...g, headersFr: [...g.headersFr, ""], headersAr: [...g.headersAr, ""], rows: g.rows.map((r) => [...r, ""]) });
  const removeCol = (i: number) =>
    setG({ ...g, headersFr: g.headersFr.filter((_, k) => k !== i), headersAr: g.headersAr.filter((_, k) => k !== i), rows: g.rows.map((r) => r.filter((_, k) => k !== i)) });
  const cellCls = `${inputCls} h-9 min-w-20 px-2 text-center text-sm`;
  return (
    <Sheet
      open
      onClose={onClose}
      wide
      title={guide.id ? g.name : tr("Nouveau guide des tailles")}
      footer={
        <div className="flex justify-between gap-2">
          {guide.id ? (
            <Button variant="danger" onClick={() => confirm(tr("Supprimer ce guide ? Les produits qui l’utilisent n’auront plus de guide.")) && remove.mutate(undefined, { onSuccess: onClose })}>
              {tr("Supprimer")}
            </Button>
          ) : (
            <span />
          )}
          <Button variant="primary" loading={save.isPending} disabled={g.name.trim().length < 2 || g.headersFr.some((h) => !h.trim())} onClick={() => save.mutate(undefined, { onSuccess: onClose })}>
            {tr("Enregistrer")}
          </Button>
        </div>
      }
    >
      <div className="space-y-4">
        <TextField label={tr("Nom du guide (pour vous)")} placeholder={tr("ex : Lingerie, Robes, Chaussures")} value={g.name} onChange={(e) => setG({ ...g, name: e.target.value })} />
        <div>
          <p className="mb-2 text-sm font-medium">{tr("Tableau des mesures")}</p>
          <div className="overflow-x-auto rounded-xl border border-line">
            <table className="text-sm">
              <thead className="bg-ivory-deep/60">
                <tr>
                  {g.headersFr.map((h, i) => (
                    <th key={i} className="p-1.5 align-top font-normal">
                      <input className={`${cellCls} font-semibold`} placeholder={tr("Colonne (FR)")} value={h} onChange={(e) => setHeader("headersFr", i, e.target.value)} aria-label={tr("Colonne {0} en français", { 0: i + 1 })} />
                      <input className={`${cellCls} mt-1`} dir="rtl" placeholder="العمود" value={g.headersAr[i] ?? ""} onChange={(e) => setHeader("headersAr", i, e.target.value)} aria-label={tr("Colonne {0} en arabe", { 0: i + 1 })} />
                      {i > 0 && cols > 2 && (
                        <button type="button" onClick={() => removeCol(i)} className="mt-1 text-xs text-red-700 hover:underline">
                          {tr("retirer")}
                        </button>
                      )}
                    </th>
                  ))}
                  <th className="p-1.5 align-top">
                    {cols < 8 && (
                      <Button size="sm" onClick={addCol}>
                        {tr("+ colonne")}
                      </Button>
                    )}
                  </th>
                </tr>
              </thead>
              <tbody>
                {g.rows.map((row, r) => (
                  <tr key={r} className="border-t border-line/70">
                    {row.map((cell, col) => (
                      <td key={col} className="p-1.5">
                        <input
                          className={`${cellCls} ${col === 0 ? "font-semibold" : ""}`}
                          value={cell}
                          placeholder={col === 0 ? tr("Taille") : "cm"}
                          onChange={(e) => setCell(r, col, e.target.value)}
                          aria-label={tr("Ligne {0}, {1}", { 0: r + 1, 1: g.headersFr[col] || `colonne ${col + 1}` })}
                        />
                      </td>
                    ))}
                    <td className="p-1.5">
                      <button
                        type="button"
                        aria-label={tr("Supprimer la ligne")}
                        disabled={g.rows.length <= 1}
                        onClick={() => setG({ ...g, rows: g.rows.filter((_, k) => k !== r) })}
                        className="grid size-9 place-items-center rounded-lg text-red-700 hover:bg-red-50 disabled:opacity-30"
                      >
                        {tr("×")}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {g.rows.length < 30 && (
            <Button size="sm" className="mt-2" onClick={() => setG({ ...g, rows: [...g.rows, Array.from({ length: cols }, () => "")] })}>
              {tr("+ Ajouter une taille")}
            </Button>
          )}
          <p className="mt-2 text-xs text-ink-soft">{tr("La 1re colonne contient la taille écrite comme sur le produit (S, M, L…) : la taille choisie par la cliente est mise en avant.")}</p>
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <TextArea label={tr("Conseil (FR)")} rows={3} value={g.tipsFr ?? ""} onChange={(e) => setG({ ...g, tipsFr: e.target.value })} maxLength={600} />
          <TextArea label={tr("Conseil (AR)")} dir="rtl" rows={3} value={g.tipsAr ?? ""} onChange={(e) => setG({ ...g, tipsAr: e.target.value })} maxLength={600} />
        </div>
      </div>
    </Sheet>
  );
}

function StoreIdentity() {
  const q = useQuery({ queryKey: ["home"], queryFn: () => api<{ store: { name: string } }>("/home") });
  const [s, setS] = useState<{ name: string } | null>(null);
  useEffect(() => {
    if (q.data) setS({ name: q.data.store.name });
  }, [q.data]);
  const save = useSave(() => put("/content/store", s), ["home"]);
  if (!s) return <ListSkeleton rows={2} />;
  return (
    <Card title={tr("Identité de la boutique")}>
      <div className="grid gap-3 sm:grid-cols-2">
        <TextField label={tr("Nom")} value={s.name} onChange={(e) => setS({ ...s, name: e.target.value })} className="sm:col-span-2" />
      </div>
      <Button variant="primary" className="mt-3" loading={save.isPending} onClick={() => save.mutate(undefined)}>{tr("Enregistrer")}</Button>
    </Card>
  );
}

/* ───────────── Erreurs ───────────── */

interface ErrorsData {
  errors: { id: number; source: string; message: string; url: string | null; count: number; status: string; first_seen: number; last_seen: number; stack: string | null }[];
  outbox: { id: number; kind: string; payload: string; attempts: number; last_error: string | null; created_at: number }[];
  audit: { id: number; actor: string; action: string; entity: string; entity_id: string | null; created_at: number }[];
}

export function ErrorsPage() {
  const [tab, setTab] = useState<"errors" | "outbox" | "audit">("errors");
  const [status, setStatus] = useState("open");
  const q = useQuery({ queryKey: ["errors", status], queryFn: () => api<ErrorsData>(`/errors?status=${status}`), refetchInterval: 30_000 });
  const setErr = useSave(({ id, s }: { id: number; s: string }) => patch(`/errors/${id}`, { status: s }), ["errors"]);
  const retry = useSave((id: number) => post(`/outbox/${id}/retry`), ["errors"], tr("Nouvel essai lancé"));
  const [open, setOpen] = useState<number | null>(null);
  return (
    <div>
      <PageHeader group={tr("Système")} title={tr("Erreurs")} subtitle={tr("Problèmes techniques, envois Telegram en échec et journal des actions de l'équipe.")} />
      <Pills
        value={tab}
        onChange={setTab}
        options={[
          { value: "errors", label: tr("Erreurs{0}", { 0: q.data ? ` (${q.data.errors.length})` : "" }) },
          { value: "outbox", label: tr("Envois en attente{0}", { 0: q.data ? ` (${q.data.outbox.length})` : "" }) },
          { value: "audit", label: tr("Journal d'audit") },
        ]}
      />
      {q.error ? <ErrorState error={q.error} onRetry={q.refetch} /> : !q.data ? <ListSkeleton /> : tab === "errors" ? (
        <>
          <Pills value={status} onChange={setStatus} options={[{ value: "open", label: tr("Ouvertes") }, { value: "resolved", label: tr("Résolues") }, { value: "ignored", label: tr("Ignorées") }, { value: "all", label: tr("Toutes") }]} />
          {q.data.errors.length === 0 ? <Empty title={tr("Aucune erreur 🎉")} icon="✅" /> : (
            <ul className="space-y-2">
              {q.data.errors.map((e) => (
                <li key={e.id} className="rounded-xl border border-line bg-surface p-4">
                  <button type="button" className="w-full text-start" onClick={() => setOpen(open === e.id ? null : e.id)}>
                    <div className="flex items-center justify-between gap-2">
                      <Badge tone="bg-stone-100 text-stone-700">{e.source}</Badge>
                      <span className="text-xs text-ink-soft">{tr("×")}{e.count} · {ago(e.last_seen)}</span>
                    </div>
                    <p className="mt-1 break-words font-mono text-sm">{e.message}</p>
                    {e.url && <p className="text-xs text-ink-soft">{e.url}</p>}
                  </button>
                  {open === e.id && e.stack && <pre className="mt-2 max-h-48 overflow-auto rounded-lg bg-noir p-3 text-[11px] text-white">{e.stack}</pre>}
                  <div className="mt-2 flex gap-2">
                    {e.status !== "resolved" && <Button size="sm" onClick={() => setErr.mutate({ id: e.id, s: "resolved" })}>{tr("Résolue")}</Button>}
                    {e.status !== "ignored" && <Button size="sm" variant="ghost" onClick={() => setErr.mutate({ id: e.id, s: "ignored" })}>{tr("Ignorer")}</Button>}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </>
      ) : tab === "outbox" ? (
        q.data.outbox.length === 0 ? <Empty title={tr("Rien en attente")} icon="📭" /> : (
          <ul className="space-y-2">
            {q.data.outbox.map((o) => (
              <li key={o.id} className="rounded-xl border border-line bg-surface p-4 text-sm">
                <div className="flex items-center justify-between gap-2">
                  <span><Badge>{o.kind}</Badge> <span className="font-mono text-xs">{o.payload}</span></span>
                  <span className="text-xs text-ink-soft">{o.attempts} {tr("essai(s) ·")} {dateTime(o.created_at)}</span>
                </div>
                {o.last_error && <p className="mt-1 text-xs text-red-700">{o.last_error === "telegram_not_configured" ? tr("Telegram n'est pas encore configuré (Système → Comptes).") : o.last_error}</p>}
                <Button size="sm" className="mt-2" onClick={() => retry.mutate(o.id)}>{tr("Réessayer maintenant")}</Button>
              </li>
            ))}
          </ul>
        )
      ) : (
        <ul className="divide-y divide-line overflow-hidden rounded-xl border border-line bg-surface text-sm">
          {q.data.audit.map((a) => (
            <li key={a.id} className="flex items-center justify-between gap-2 px-4 py-2.5">
              <span className="min-w-0 truncate"><b>{a.actor.split(":").slice(2).join(":") || a.actor}</b> · {a.action} · {a.entity}{a.entity_id ? ` #${a.entity_id}` : ""}</span>
              <span className="shrink-0 text-xs text-ink-soft">{dateTime(a.created_at)}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/** Light / dark / auto for this device. */
function ColorModeCard() {
  const { mode, setMode } = useColorMode();
  const options: [ColorMode, string][] = [
    ["light", tr("☀️ Clair")],
    ["dark", tr("🌙 Sombre")],
    ["auto", tr("◐ Automatique")],
  ];
  return (
    <Card title={tr("🌗 Apparence")}>
      <p className="mb-3 text-sm text-ink-soft">{tr("Clair, sombre, ou automatique (suit le réglage du téléphone ou de l'ordinateur). Sur cet appareil uniquement.")}</p>
      <div className="inline-grid grid-cols-3 gap-2">
        {options.map(([value, label]) => (
          <button
            key={value}
            type="button"
            onClick={() => setMode(value)}
            aria-pressed={mode === value}
            className={`h-11 rounded-xl border px-4 text-sm font-semibold transition ${mode === value ? "border-plum-600 bg-plum-600 text-white" : "border-line bg-surface hover:border-plum-600"}`}
          >
            {label}
          </button>
        ))}
      </div>
    </Card>
  );
}
