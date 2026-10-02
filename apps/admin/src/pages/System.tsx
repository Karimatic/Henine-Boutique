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

function useSave<T>(fn: (v: T) => Promise<unknown>, keys: string[], ok = "Enregistré ✓") {
  const qc = useQueryClient();
  const toast = useToast();
  return useMutation({
    mutationFn: fn,
    onSuccess: () => {
      toast(ok);
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

const PERMISSION_LABEL: Record<string, string> = {
  "orders.confirm": "Confirmer / annuler", "orders.ship": "Préparer / expédier", "orders.edit": "Modifier commandes", "orders.export": "Exporter",
  "customers.edit": "Fiches clientes", "products.edit": "Produits", "stock.edit": "Stock", "cost.view": "Prix d'achat", "sales.create": "Ventes manuelles",
  "promos.edit": "Promos", "loyalty.edit": "Fidélité", "marketing.edit": "Marketing", "reviews.moderate": "Avis", "stats.view": "Statistiques",
  "content.edit": "Contenu", "delivery.edit": "Tarifs livraison", "team.manage": "Équipe", "integrations.manage": "Intégrations",
};

export function TeamPage() {
  const me = useMe();
  const q = useQuery({ queryKey: ["team"], queryFn: () => api<{ members: Member[]; roles: { key: string; name: string; permissions: string[] }[] }>("/team") });
  const [invite, setInvite] = useState(false);
  const [edit, setEdit] = useState<Member | null>(null);
  return (
    <div className="space-y-4">
      <PageHeader group="Système" title="Équipe" subtitle="Chaque membre se connecte avec son email + mot de passe + code reçu par email." actions={<Button variant="primary" onClick={() => setInvite(true)}>+ Inviter</Button>} />
      {q.error ? <ErrorState error={q.error} onRetry={q.refetch} /> : !q.data ? <ListSkeleton /> : (
        <>
          <ul className="divide-y divide-line overflow-hidden rounded-xl border border-line bg-white">
            {q.data.members.map((m) => (
              <li key={m.id}>
                <button type="button" onClick={() => setEdit(m)} className={`flex w-full items-center justify-between gap-3 px-4 py-3 text-start hover:bg-rose-100/30 ${m.is_active ? "" : "opacity-50"}`}>
                  <span className="min-w-0">
                    <span className="block truncate font-medium">{m.name}{m.id === me.data?.id ? " (vous)" : ""}</span>
                    <span className="block truncate text-xs text-ink-soft">{m.email} · vu {ago(m.last_seen_at)}</span>
                  </span>
                  <span className="flex shrink-0 flex-col items-end gap-1">
                    <Badge>{m.role_name}</Badge>
                    {!m.has_password && <Badge tone="bg-amber-100 text-amber-800">Invitation en attente</Badge>}
                    {m.telegram_user_id ? <span className="text-xs text-ink-soft">📱 Telegram lié</span> : null}
                  </span>
                </button>
              </li>
            ))}
          </ul>
          <Card title="Rôles et droits">
            <ul className="space-y-3 text-sm">
              {q.data.roles.map((r) => (
                <li key={r.key}>
                  <p className="font-semibold">{r.name}</p>
                  <p className="text-xs text-ink-soft">{r.permissions.includes("*") ? "Tous les droits" : r.permissions.filter((p) => PERMISSION_LABEL[p]).map((p) => PERMISSION_LABEL[p]).join(" · ") || "Consultation"}</p>
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
  const save = useSave(() => post<{ inviteUrl: string; emailed: boolean }>("/team", form).then(setResult), ["team"], "Invitation créée");
  return (
    <Sheet open onClose={onClose} title="Inviter un membre">
      {result ? (
        <div className="space-y-3">
          <p className="text-sm">{result.emailed ? "✉️ L'invitation a été envoyée par email." : "Envoyez ce lien à la personne (WhatsApp, Telegram…). Il est valable 7 jours et utilisable une seule fois :"}</p>
          <textarea readOnly className={`${inputCls} h-24 py-2 font-mono text-xs`} value={result.inviteUrl} onFocus={(e) => e.target.select()} />
          <Button onClick={() => navigator.clipboard?.writeText(result.inviteUrl)}>Copier le lien</Button>
        </div>
      ) : (
        <div className="space-y-3">
          <TextField label="Prénom / nom" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
          <TextField label="Email" type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />
          <Select label="Rôle" value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value })}>
            {Object.entries(ROLE_PRESETS).map(([k, r]) => <option key={k} value={k}>{r.name}</option>)}
          </Select>
          <Button variant="primary" className="w-full" loading={save.isPending} onClick={() => save.mutate(undefined)}>Créer l'invitation</Button>
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
  const save = useSave(() => patch(`/team/${member.id}`, { name, role, telegramUserId: tg }), ["team"]);
  const toggleActive = useSave(() => patch(`/team/${member.id}`, { isActive: !member.is_active }), ["team"], member.is_active ? "Accès désactivé" : "Accès réactivé");
  const reinvite = useSave(() => post<{ inviteUrl: string }>(`/team/${member.id}/invite`).then((r) => setLink(r.inviteUrl)), [], "Nouveau lien créé");
  const revoke = useSave(() => del(`/team/${member.id}/sessions`), ["team"], "Déconnecté de tous les appareils");
  return (
    <Sheet open onClose={onClose} title={member.name} footer={<Button variant="primary" className="w-full" loading={save.isPending} onClick={() => save.mutate(undefined, { onSuccess: onClose })}>Enregistrer</Button>}>
      <div className="space-y-3">
        <p className="text-sm text-ink-soft">{member.email} · {member.sessions} appareil(s) connecté(s)</p>
        <TextField label="Nom" value={name} onChange={(e) => setName(e.target.value)} />
        <Select label="Rôle" value={role} onChange={(e) => setRole(e.target.value)}>
          {Object.entries(ROLE_PRESETS).map(([k, r]) => <option key={k} value={k}>{r.name}</option>)}
        </Select>
        <NumberField label="ID Telegram" hint="envoyez /id au bot pour l'obtenir" value={tg} onChange={setTg} />
        <div className="flex flex-wrap gap-2 border-t border-line pt-3">
          <Button size="sm" onClick={() => reinvite.mutate(undefined)}>{member.has_password ? "Lien de réinitialisation" : "Renvoyer l'invitation"}</Button>
          <Button size="sm" onClick={() => revoke.mutate(undefined)}>Déconnecter partout</Button>
          <Button size="sm" variant="danger" onClick={() => confirm(member.is_active ? "Désactiver l'accès de ce membre ?" : "Réactiver ce membre ?") && toggleActive.mutate(undefined, { onSuccess: onClose })}>
            {member.is_active ? "Désactiver l'accès" : "Réactiver"}
          </Button>
        </div>
        {link && <textarea readOnly className={`${inputCls} h-20 py-2 font-mono text-xs`} value={link} onFocus={(e) => e.target.select()} />}
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
  const revoke = useSave((id: number) => del(`/account/sessions/${id}`), ["account"], "Appareil déconnecté");
  async function changePassword() {
    const email = me.data!.email;
    const problem = passwordProblems(pw.next, email);
    if (problem) return toast(problem, "error");
    if (pw.next !== pw.confirm) return toast("Les deux mots de passe ne correspondent pas.", "error");
    setBusy(true);
    try {
      await post("/account/password", { currentKey: await derivePasswordKey(email, pw.current), newKey: await derivePasswordKey(email, pw.next) });
      toast("Mot de passe changé ✓ (autres appareils déconnectés)");
      setPw({ current: "", next: "", confirm: "" });
    } catch (e) {
      toast(errorMessage(e), "error");
    } finally {
      setBusy(false);
    }
  }
  return (
    <Card title="👤 Mon compte">
      {q.data && <p className="mb-3 text-sm">{q.data.member.name} · {q.data.member.email} · <Badge>{q.data.member.roleName}</Badge></p>}
      <div className="grid gap-3 sm:grid-cols-3">
        <TextField label="Mot de passe actuel" type="password" autoComplete="current-password" value={pw.current} onChange={(e) => setPw({ ...pw, current: e.target.value })} />
        <TextField label="Nouveau" type="password" autoComplete="new-password" value={pw.next} onChange={(e) => setPw({ ...pw, next: e.target.value })} />
        <TextField label="Confirmer" type="password" autoComplete="new-password" value={pw.confirm} onChange={(e) => setPw({ ...pw, confirm: e.target.value })} />
      </div>
      <Button className="mt-3" loading={busy} disabled={!pw.current || !pw.next} onClick={changePassword}>Changer le mot de passe</Button>
      <h3 className="mb-2 mt-5 text-sm font-semibold">Appareils connectés</h3>
      <ul className="space-y-2 text-sm">
        {q.data?.sessions.map((s) => (
          <li key={s.id} className="flex items-center justify-between gap-2">
            <span>{s.user_agent}{s.current ? " · cet appareil" : ""} <span className="text-ink-soft">· {ago(s.last_seen_at)}</span></span>
            {!s.current && <Button size="sm" variant="ghost" onClick={() => revoke.mutate(s.id)}>Déconnecter</Button>}
          </li>
        ))}
      </ul>
    </Card>
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
      toast(ok);
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
      <Card title="📱 Telegram : commandes dans le groupe de l'équipe">
        <ol className="mb-4 list-decimal space-y-1 ps-5 text-sm text-ink-soft">
          <li>Sur Telegram, ouvrez <b>@BotFather</b> → <code>/newbot</code> → copiez le <b>token</b>.</li>
          <li>Ajoutez ce bot dans le groupe de l'équipe, puis envoyez <code>/start</code> dans le groupe.</li>
          <li>Collez le token ci-dessous, puis « Détecter le groupe ».</li>
        </ol>
        <div className="space-y-3">
          <div className="flex gap-2">
            <input className={inputCls} placeholder={t.tokenMasked ? `Token enregistré ${t.tokenMasked}` : "123456789:AA…"} value={token} onChange={(e) => setToken(e.target.value.trim())} aria-label="Token du bot" />
            <Button onClick={() => run(() => post("/integrations/telegram/token", { token }).then(() => setToken("")), "Bot connecté ✓")} disabled={!token}>Enregistrer</Button>
          </div>
          {t.botUsername && <p className="text-sm">Bot : <b>@{t.botUsername}</b></p>}
          {t.botUsername && (
            <div>
              <Button size="sm" onClick={() => run(() => post<{ id: number; title: string; type: string }[]>("/integrations/telegram/detect").then(setChats), "Recherche terminée")}>Détecter le groupe</Button>
              {chats && (chats.length === 0 ? (
                <p className="mt-2 text-sm text-amber-700">Aucun groupe trouvé : envoyez un message (ex : /start) dans le groupe après y avoir ajouté le bot, puis réessayez.</p>
              ) : (
                <ul className="mt-2 space-y-1">
                  {chats.map((c) => (
                    <li key={c.id}>
                      <button type="button" className="w-full rounded-xl border border-line bg-white px-3 py-2 text-start text-sm hover:border-plum-600" onClick={() => run(() => post("/integrations/telegram/chat", { chatId: String(c.id), chatTitle: c.title }), `Groupe « ${c.title} » sélectionné`)}>
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
              ✅ Les commandes sont envoyées dans <b>{t.chatTitle ?? t.chatId}</b>.
              <div className="mt-2 flex flex-wrap gap-2">
                <Button size="sm" variant="primary" onClick={() => run(() => post("/integrations/telegram/test"), "Message test envoyé")}>Envoyer un message test</Button>
                {t.mode !== "poll" && <Button size="sm" onClick={() => run(() => post("/integrations/telegram/webhook"), "Boutons activés (webhook)")}>{t.webhookUrl ? "Réactiver les boutons" : "Activer les boutons"}</Button>}
                <Button size="sm" variant="danger" onClick={() => confirm("Déconnecter le bot ?") && run(() => del("/integrations/telegram"), "Bot déconnecté")}>Déconnecter</Button>
              </div>
              <p className="mt-2 text-xs text-ink-soft">
                {t.mode === "poll" ? "Mode développement : les boutons Telegram fonctionnent tant que cet admin est ouvert." : t.webhookUrl ? `Boutons actifs via ${t.webhookUrl}` : "Activez les boutons après le déploiement en ligne."}
              </p>
            </div>
          )}
        </div>
      </Card>

      <InstagramCard />

      <Card title="✉️ Emails (codes de connexion, invitations)">
        <p className="text-sm">
          Fournisseur : <b>{q.data.mail.provider === "console" ? "aucun (mode développement : codes affichés à l'écran)" : q.data.mail.provider}</b>
          {q.data.mail.from && q.data.mail.provider !== "console" ? ` · expéditeur ${q.data.mail.from}` : ""}
        </p>
        {q.data.mail.provider === "console" && (
          <p className="mt-2 text-xs text-ink-soft">En ligne : créez un compte gratuit Brevo (300 emails/jour) ou Resend, puis ajoutez la clé comme secret Cloudflare (MAIL_PROVIDER, MAIL_API_KEY, MAIL_FROM). Voir README.</p>
        )}
        <Button size="sm" className="mt-2" onClick={() => run(() => post("/integrations/mail/test"), "Email de test envoyé (vérifiez votre boîte)")}>M'envoyer un email de test</Button>
      </Card>

      <Card title="🚚 ZR Express">
        <p className="mb-3 text-sm text-ink-soft">
          {q.data.zr.configured ? `Identifiants enregistrés (${q.data.zr.idMasked}).` : "Non connecté."} La création automatique des colis et le suivi ZR arrivent dans une prochaine étape ; en attendant, saisissez le n° de suivi dans la commande.
        </p>
        <div className="grid gap-2 sm:grid-cols-[1fr_1fr_auto]">
          <input className={inputCls} placeholder="ID / Tenant ZR" value={zr.id} onChange={(e) => setZr({ ...zr, id: e.target.value })} aria-label="ID ZR Express" />
          <input className={inputCls} placeholder="Clé API / token ZR" type="password" value={zr.token} onChange={(e) => setZr({ ...zr, token: e.target.value })} aria-label="Clé API ZR Express" />
          <Button disabled={!zr.id || !zr.token} onClick={() => run(() => put("/integrations/zr", zr).then(() => setZr({ id: "", token: "" })), "Identifiants ZR enregistrés (chiffrés)")}>Enregistrer</Button>
        </div>
      </Card>

      <Card title="📈 Pixels publicitaires">
        <div className="grid gap-2 sm:grid-cols-[1fr_1fr_auto] sm:items-end">
          <TextField label="Meta (Facebook/Instagram) Pixel ID" value={pixels.meta} onChange={(e) => setPixels({ ...pixels, meta: e.target.value.replace(/\D/g, "") })} />
          <TextField label="TikTok Pixel ID" value={pixels.tiktok} onChange={(e) => setPixels({ ...pixels, tiktok: e.target.value.toUpperCase() })} />
          <Button onClick={() => run(() => put("/integrations/pixels", { metaPixelId: pixels.meta || null, tiktokPixelId: pixels.tiktok || null }), "Pixels enregistrés")}>Enregistrer</Button>
        </div>
        <p className="mt-2 text-xs text-ink-soft">L'activation des pixels sur la boutique (avec consentement) arrive avec la mise en ligne.</p>
      </Card>

      <Card title="🛡 Anti-robots (Cloudflare Turnstile)">
        <p className="text-sm">{q.data.turnstile.testKeys ? "Clés de test (développement). Créez un widget Turnstile gratuit avant la mise en ligne." : "Clés de production actives ✓"}</p>
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
      toast(`Instagram connecté ✓ @${r.username}${r.mediaCount != null ? ` · ${r.mediaCount} publications` : ""}`);
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
    <Card title="📸 Instagram : photos des produits depuis vos publications">
      {q.data?.connected ? (
        <div className="space-y-3">
          <p className="rounded-xl bg-emerald-50 p-3 text-sm">
            ✅ Connecté à <b>@{q.data.username}</b>. Dans une fiche produit, « 📸 Depuis Instagram » affiche vos publications : cochez les photos, elles sont
            ajoutées en pleine qualité. La connexion se renouvelle toute seule.
          </p>
          <Button size="sm" variant="danger" onClick={() => confirm("Déconnecter Instagram ?") && del("/integrations/instagram").then(() => qc.invalidateQueries({ queryKey: ["instagram-status"] }))}>
            Déconnecter
          </Button>
        </div>
      ) : (
        <>
          <p className="mb-2 text-sm text-ink-soft">Gratuit, à faire une seule fois (10 minutes) :</p>
          <ol className="mb-4 list-decimal space-y-1.5 ps-5 text-sm text-ink-soft">
            <li>Sur Instagram, le compte de la boutique doit être un <b>compte professionnel</b> (Paramètres → Type de compte → Passer à un compte professionnel).</li>
            <li>
              Sur <b>developers.facebook.com</b> → « Mes apps » → « Créer une app » (type <i>Entreprise</i>) → ajoutez le produit <b>Instagram</b> →
              « Configuration de l'API avec la connexion Instagram ».
            </li>
            <li>Dans « Générer des jetons d'accès », ajoutez le compte de la boutique puis cliquez sur « Générer le jeton ».</li>
            <li>Copiez le jeton et collez-le ici.</li>
          </ol>
          <div className="flex gap-2">
            <input className={inputCls} placeholder="IGAA…" value={token} onChange={(e) => setToken(e.target.value.trim())} aria-label="Jeton Instagram" autoComplete="off" />
            <Button variant="primary" loading={busy} disabled={token.length < 40} onClick={connect}>
              Connecter
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
      <PageHeader group="Système" title="Contenu" subtitle="Tarifs de livraison, pages d'information, catégories et identité de la boutique." />
      <Pills
        value={tab}
        onChange={setTab}
        options={[
          ...(can("delivery.edit") ? [{ value: "livraison" as const, label: "🚚 Livraison" }] : []),
          { value: "pages", label: "📄 Pages" },
          { value: "categories", label: "🗂 Catégories" },
          ...(can("products.edit") ? [{ value: "tailles" as const, label: "📏 Guides des tailles" }] : []),
          { value: "boutique", label: "🌸 Boutique" },
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
  const save = useSave((body: Record<string, unknown>) => put("/content/wilayas", body), ["wilayas-admin"], "Tarifs mis à jour ✓");
  if (q.error) return <ErrorState error={q.error} onRetry={q.refetch} />;
  if (!q.data) return <ListSkeleton />;
  const rows = q.data.rows.filter((w) => !filter || `${w.code} ${w.name_fr}`.toLowerCase().includes(filter.toLowerCase()));
  return (
    <div className="space-y-4">
      {!q.data.verified && (
        <div className="rounded-xl border border-amber-300 bg-amber-50 p-4 text-sm text-amber-900">
          ⚠️ Ces tarifs sont des <b>estimations par zone</b> depuis Boumerdès. Remplacez-les par la grille ZR Express d'Ilyas, puis confirmez.
          <Button size="sm" className="ms-2 mt-2" onClick={() => save.mutate({ codes: [35], markVerified: true })}>Les tarifs sont vérifiés</Button>
        </div>
      )}
      <Card title={`Modifier ${selected.length ? `${selected.length} wilaya(s) sélectionnée(s)` : "plusieurs wilayas à la fois"}`}>
        <div className="grid gap-2 sm:grid-cols-[1fr_1fr_1fr_auto] sm:items-end">
          <NumberField label="Domicile" suffix="DA" value={bulk.home} onChange={(v) => setBulk({ ...bulk, home: v })} />
          <NumberField label="Bureau" suffix="DA" value={bulk.desk} onChange={(v) => setBulk({ ...bulk, desk: v })} />
          <TextField label="Délai (jours)" placeholder="2-3" value={bulk.delay} onChange={(e) => setBulk({ ...bulk, delay: e.target.value })} />
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
            Appliquer
          </Button>
        </div>
      </Card>
      <input className={inputCls} placeholder="Filtrer (ex : Alger, 16)…" value={filter} onChange={(e) => setFilter(e.target.value)} aria-label="Filtrer les wilayas" />
      <div className="overflow-x-auto rounded-xl border border-line bg-white">
        <table className="w-full min-w-[34rem] text-sm">
          <thead className="text-xs text-ink-soft">
            <tr className="border-b border-line">
              <th className="w-10 px-3 py-2"><input type="checkbox" className="size-4 accent-plum-600" aria-label="Tout sélectionner" checked={selected.length === rows.length && rows.length > 0} onChange={(e) => setSelected(e.target.checked ? rows.map((r) => r.code) : [])} /></th>
              <th className="py-2 text-start font-medium">Wilaya</th>
              <th className="px-2 text-end font-medium">Domicile</th>
              <th className="px-2 text-end font-medium">Bureau</th>
              <th className="px-2 text-end font-medium">Délai</th>
              <th className="px-3 text-end font-medium">Active</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((w) => (
              <tr key={w.code} className={`border-b border-line/60 last:border-0 ${w.is_active ? "" : "opacity-50"}`}>
                <td className="px-3"><input type="checkbox" className="size-4 accent-plum-600" aria-label={`Sélectionner ${w.name_fr}`} checked={selected.includes(w.code)} onChange={(e) => setSelected(e.target.checked ? [...selected, w.code] : selected.filter((c) => c !== w.code))} /></td>
                <td className="py-2">
                  {w.code} - {w.name_fr}
                  {w.parent_code ? <span className="block text-xs text-ink-soft">nouvelle wilaya (ex-{w.parent_code}) · {w.communes} communes</span> : null}
                </td>
                <td className="px-2 text-end tabular-nums">{da(w.home_price)}</td>
                <td className="px-2 text-end tabular-nums">{da(w.desk_price)}</td>
                <td className="px-2 text-end">{w.delay_days ?? "—"} j</td>
                <td className="px-3 text-end">
                  <input type="checkbox" className="size-4 accent-plum-600" aria-label={`Livrer ${w.name_fr}`} checked={!!w.is_active} onChange={(e) => save.mutate({ codes: [w.code], isActive: e.target.checked })} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
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
      <div className="flex justify-end"><Button variant="primary" onClick={() => setEdit({ is_active: 1, body_fr: "", body_ar: "" })}>+ Nouvelle page</Button></div>
      {!q.data ? <ListSkeleton /> : (
        <ul className="divide-y divide-line overflow-hidden rounded-xl border border-line bg-white">
          {q.data.map((p) => (
            <li key={p.id}>
              <button type="button" onClick={() => setEdit(p)} className="flex w-full items-center justify-between px-4 py-3 text-start hover:bg-rose-100/30">
                <span><span className="block font-medium">{p.title_fr}</span><span className="text-xs text-ink-soft">/p/{p.slug}</span></span>
                {!p.is_active && <Badge tone="bg-stone-200 text-stone-700">Masquée</Badge>}
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
  const remove = useSave(() => del(`/content/pages/${page.id}`), ["pages"], "Page supprimée");
  return (
    <Sheet
      open
      onClose={onClose}
      wide
      title={page.id ? f.title_fr : "Nouvelle page"}
      footer={
        <div className="flex justify-between gap-2">
          {page.id ? <Button variant="danger" onClick={() => confirm("Supprimer cette page ?") && remove.mutate(undefined, { onSuccess: onClose })}>Supprimer</Button> : <span />}
          <Button variant="primary" loading={save.isPending} onClick={() => save.mutate(undefined, { onSuccess: onClose })}>Enregistrer</Button>
        </div>
      }
    >
      <div className="grid gap-3 sm:grid-cols-2">
        <TextField label="Titre (FR)" value={f.title_fr ?? ""} onChange={(e) => setF({ ...f, title_fr: e.target.value })} />
        <TextField label="Titre (AR)" dir="rtl" value={f.title_ar ?? ""} onChange={(e) => setF({ ...f, title_ar: e.target.value })} />
        <TextField label="Adresse" hint="/p/…" value={f.slug ?? ""} onChange={(e) => setF({ ...f, slug: e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, "-") })} className="sm:col-span-2" />
        <TextArea label="Texte (FR)" hint="## titre · **gras** · - liste" rows={12} value={f.body_fr ?? ""} onChange={(e) => setF({ ...f, body_fr: e.target.value })} />
        <TextArea label="Texte (AR)" dir="rtl" rows={12} value={f.body_ar ?? ""} onChange={(e) => setF({ ...f, body_ar: e.target.value })} />
      </div>
      <Toggle label="Visible sur la boutique" checked={!!f.is_active} onChange={(v) => setF({ ...f, is_active: v ? 1 : 0 })} />
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
      <div className="flex justify-end"><Button variant="primary" onClick={() => setEdit({ is_active: 1, sort: (q.data?.length ?? 0) + 1 })}>+ Nouvelle catégorie</Button></div>
      {!q.data ? <ListSkeleton /> : q.data.length === 0 ? <Empty title="Aucune catégorie" /> : (
        <ul className="divide-y divide-line overflow-hidden rounded-xl border border-line bg-white">
          {q.data.map((c) => (
            <li key={c.id}>
              <button type="button" onClick={() => setEdit(c)} className="flex w-full items-center justify-between px-4 py-3 text-start hover:bg-rose-100/30">
                <span><span className="block font-medium">{c.name_fr} · <span dir="rtl">{c.name_ar}</span></span><span className="text-xs text-ink-soft">/c/{c.slug} · {c.product_count} produit(s)</span></span>
                {!c.is_active && <Badge tone="bg-stone-200 text-stone-700">Masquée</Badge>}
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
  const remove = useSave(() => del(`/categories/${cat.id}`), ["categories"], "Catégorie supprimée");
  return (
    <Sheet
      open
      onClose={onClose}
      title={cat.id ? f.name_fr : "Nouvelle catégorie"}
      footer={
        <div className="flex justify-between gap-2">
          {cat.id ? <Button variant="danger" onClick={() => confirm("Supprimer cette catégorie (elle doit être vide) ?") && remove.mutate(undefined, { onSuccess: onClose })}>Supprimer</Button> : <span />}
          <Button variant="primary" loading={save.isPending} onClick={() => save.mutate(undefined, { onSuccess: onClose })}>Enregistrer</Button>
        </div>
      }
    >
      <div className="grid gap-3">
        <TextField label="Nom (FR)" value={f.name_fr ?? ""} onChange={(e) => setF({ ...f, name_fr: e.target.value })} />
        <TextField label="Nom (AR)" dir="rtl" value={f.name_ar ?? ""} onChange={(e) => setF({ ...f, name_ar: e.target.value })} />
        <TextField label="Adresse" hint="/c/…" value={f.slug ?? ""} onChange={(e) => setF({ ...f, slug: e.target.value })} />
        <NumberField label="Ordre d'affichage" value={f.sort ?? 0} onChange={(v) => setF({ ...f, sort: v ?? 0 })} />
        <Toggle label="Visible" checked={!!f.is_active} onChange={(v) => setF({ ...f, is_active: v ? 1 : 0 })} />
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
        <p className="text-sm text-ink-soft">Un tableau des mesures par taille, affiché sur la fiche produit (« 📏 Guide des tailles »). Choisissez le guide de chaque produit dans sa fiche.</p>
        <Button variant="primary" onClick={() => setEdit(fresh())}>+ Nouveau guide</Button>
      </div>
      {q.error ? (
        <ErrorState error={q.error} onRetry={q.refetch} />
      ) : !q.data ? (
        <ListSkeleton rows={2} />
      ) : q.data.length === 0 ? (
        <Empty title="Aucun guide des tailles" icon="📏">
          Créez-en un : il est déjà prérempli avec les tailles S à XXL, il suffit d’ajuster les mesures.
        </Empty>
      ) : (
        <ul className="divide-y divide-line overflow-hidden rounded-xl border border-line bg-white">
          {q.data.map((g) => (
            <li key={g.id}>
              <button type="button" onClick={() => setEdit(g)} className="flex w-full items-center justify-between px-4 py-3 text-start hover:bg-rose-100/30">
                <span>
                  <span className="block font-medium">{g.name}</span>
                  <span className="text-xs text-ink-soft">{g.rows.map((r) => r[0]).join(" · ")}</span>
                </span>
                <Badge>{g.productCount} produit(s)</Badge>
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
  const save = useSave(() => (guide.id ? put(`/size-guides/${guide.id}`, payload()) : post("/size-guides", payload())), ["size-guides"], "Guide des tailles enregistré ✓");
  const remove = useSave(() => del(`/size-guides/${guide.id}`), ["size-guides"], "Guide supprimé");
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
      title={guide.id ? g.name : "Nouveau guide des tailles"}
      footer={
        <div className="flex justify-between gap-2">
          {guide.id ? (
            <Button variant="danger" onClick={() => confirm("Supprimer ce guide ? Les produits qui l’utilisent n’auront plus de guide.") && remove.mutate(undefined, { onSuccess: onClose })}>
              Supprimer
            </Button>
          ) : (
            <span />
          )}
          <Button variant="primary" loading={save.isPending} disabled={g.name.trim().length < 2 || g.headersFr.some((h) => !h.trim())} onClick={() => save.mutate(undefined, { onSuccess: onClose })}>
            Enregistrer
          </Button>
        </div>
      }
    >
      <div className="space-y-4">
        <TextField label="Nom du guide (pour vous)" placeholder="ex : Lingerie, Robes, Chaussures" value={g.name} onChange={(e) => setG({ ...g, name: e.target.value })} />
        <div>
          <p className="mb-2 text-sm font-medium">Tableau des mesures</p>
          <div className="overflow-x-auto rounded-xl border border-line">
            <table className="text-sm">
              <thead className="bg-ivory-deep/60">
                <tr>
                  {g.headersFr.map((h, i) => (
                    <th key={i} className="p-1.5 align-top font-normal">
                      <input className={`${cellCls} font-semibold`} placeholder="Colonne (FR)" value={h} onChange={(e) => setHeader("headersFr", i, e.target.value)} aria-label={`Colonne ${i + 1} en français`} />
                      <input className={`${cellCls} mt-1`} dir="rtl" placeholder="العمود" value={g.headersAr[i] ?? ""} onChange={(e) => setHeader("headersAr", i, e.target.value)} aria-label={`Colonne ${i + 1} en arabe`} />
                      {i > 0 && cols > 2 && (
                        <button type="button" onClick={() => removeCol(i)} className="mt-1 text-xs text-red-700 hover:underline">
                          retirer
                        </button>
                      )}
                    </th>
                  ))}
                  <th className="p-1.5 align-top">
                    {cols < 8 && (
                      <Button size="sm" onClick={addCol}>
                        + colonne
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
                          placeholder={col === 0 ? "Taille" : "cm"}
                          onChange={(e) => setCell(r, col, e.target.value)}
                          aria-label={`Ligne ${r + 1}, ${g.headersFr[col] || `colonne ${col + 1}`}`}
                        />
                      </td>
                    ))}
                    <td className="p-1.5">
                      <button
                        type="button"
                        aria-label="Supprimer la ligne"
                        disabled={g.rows.length <= 1}
                        onClick={() => setG({ ...g, rows: g.rows.filter((_, k) => k !== r) })}
                        className="grid size-9 place-items-center rounded-lg text-red-700 hover:bg-red-50 disabled:opacity-30"
                      >
                        ×
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {g.rows.length < 30 && (
            <Button size="sm" className="mt-2" onClick={() => setG({ ...g, rows: [...g.rows, Array.from({ length: cols }, () => "")] })}>
              + Ajouter une taille
            </Button>
          )}
          <p className="mt-2 text-xs text-ink-soft">La 1re colonne contient la taille écrite comme sur le produit (S, M, L…) : la taille choisie par la cliente est mise en avant.</p>
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <TextArea label="Conseil (FR)" rows={3} value={g.tipsFr ?? ""} onChange={(e) => setG({ ...g, tipsFr: e.target.value })} maxLength={600} />
          <TextArea label="Conseil (AR)" dir="rtl" rows={3} value={g.tipsAr ?? ""} onChange={(e) => setG({ ...g, tipsAr: e.target.value })} maxLength={600} />
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
    <Card title="Identité de la boutique">
      <div className="grid gap-3 sm:grid-cols-2">
        <TextField label="Nom" value={s.name} onChange={(e) => setS({ ...s, name: e.target.value })} className="sm:col-span-2" />
      </div>
      <Button variant="primary" className="mt-3" loading={save.isPending} onClick={() => save.mutate(undefined)}>Enregistrer</Button>
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
  const retry = useSave((id: number) => post(`/outbox/${id}/retry`), ["errors"], "Nouvel essai lancé");
  const [open, setOpen] = useState<number | null>(null);
  return (
    <div>
      <PageHeader group="Système" title="Erreurs" subtitle="Problèmes techniques, envois Telegram en échec et journal des actions de l'équipe." />
      <Pills
        value={tab}
        onChange={setTab}
        options={[
          { value: "errors", label: `Erreurs${q.data ? ` (${q.data.errors.length})` : ""}` },
          { value: "outbox", label: `Envois en attente${q.data ? ` (${q.data.outbox.length})` : ""}` },
          { value: "audit", label: "Journal d'audit" },
        ]}
      />
      {q.error ? <ErrorState error={q.error} onRetry={q.refetch} /> : !q.data ? <ListSkeleton /> : tab === "errors" ? (
        <>
          <Pills value={status} onChange={setStatus} options={[{ value: "open", label: "Ouvertes" }, { value: "resolved", label: "Résolues" }, { value: "ignored", label: "Ignorées" }, { value: "all", label: "Toutes" }]} />
          {q.data.errors.length === 0 ? <Empty title="Aucune erreur 🎉" icon="✅" /> : (
            <ul className="space-y-2">
              {q.data.errors.map((e) => (
                <li key={e.id} className="rounded-xl border border-line bg-white p-4">
                  <button type="button" className="w-full text-start" onClick={() => setOpen(open === e.id ? null : e.id)}>
                    <div className="flex items-center justify-between gap-2">
                      <Badge tone="bg-stone-100 text-stone-700">{e.source}</Badge>
                      <span className="text-xs text-ink-soft">×{e.count} · {ago(e.last_seen)}</span>
                    </div>
                    <p className="mt-1 break-words font-mono text-sm">{e.message}</p>
                    {e.url && <p className="text-xs text-ink-soft">{e.url}</p>}
                  </button>
                  {open === e.id && e.stack && <pre className="mt-2 max-h-48 overflow-auto rounded-lg bg-ink p-3 text-[11px] text-ivory">{e.stack}</pre>}
                  <div className="mt-2 flex gap-2">
                    {e.status !== "resolved" && <Button size="sm" onClick={() => setErr.mutate({ id: e.id, s: "resolved" })}>Résolue</Button>}
                    {e.status !== "ignored" && <Button size="sm" variant="ghost" onClick={() => setErr.mutate({ id: e.id, s: "ignored" })}>Ignorer</Button>}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </>
      ) : tab === "outbox" ? (
        q.data.outbox.length === 0 ? <Empty title="Rien en attente" icon="📭" /> : (
          <ul className="space-y-2">
            {q.data.outbox.map((o) => (
              <li key={o.id} className="rounded-xl border border-line bg-white p-4 text-sm">
                <div className="flex items-center justify-between gap-2">
                  <span><Badge>{o.kind}</Badge> <span className="font-mono text-xs">{o.payload}</span></span>
                  <span className="text-xs text-ink-soft">{o.attempts} essai(s) · {dateTime(o.created_at)}</span>
                </div>
                {o.last_error && <p className="mt-1 text-xs text-red-700">{o.last_error === "telegram_not_configured" ? "Telegram n'est pas encore configuré (Système → Comptes)." : o.last_error}</p>}
                <Button size="sm" className="mt-2" onClick={() => retry.mutate(o.id)}>Réessayer maintenant</Button>
              </li>
            ))}
          </ul>
        )
      ) : (
        <ul className="divide-y divide-line overflow-hidden rounded-xl border border-line bg-white text-sm">
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
