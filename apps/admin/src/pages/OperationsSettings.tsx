/**
 * Paramètres → Alertes & délais: new-order sound and notifications (this device), the order
 * SLA (how long each step may take) and the packaging cost used in the real profit.
 */
import { DEFAULT_DUPLICATE_SETTINGS, DEFAULT_SLA, type DuplicateSettings, type SlaSettings } from "@henine/shared";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { api, del, errorMessage, put, upload } from "../api";
import { tr } from "../i18n";
import { isInstalled, useInstallOffer } from "../lib/install";
import { loadPrefs, playTone, savePrefs, setShopSound, SHOP_SOUND_DEFAULT_SECONDS, SOUNDS, unlockSound, useSoundReady, type SoundKey, type SoundPrefs } from "../lib/live";
import { useCan } from "../Shell";
import { Button, Card, inputCls, Select, Toggle, useToast } from "../ui";

export function OperationsSettings() {
  const can = useCan();
  return (
    <div className="space-y-4">
      <OrderAlertsCard />
      {can("orders.edit") && <SlaCard />}
    </div>
  );
}

function OrderAlertsCard() {
  const toast = useToast();
  const [p, setP] = useState<SoundPrefs>(loadPrefs);
  const [perm, setPerm] = useState<NotificationPermission | "unsupported">(() => ("Notification" in window ? Notification.permission : "unsupported"));
  const update = (patch: Partial<SoundPrefs>) => {
    const next = { ...p, ...patch };
    setP(next);
    savePrefs(next);
  };
  async function test() {
    await unlockSound();
    if (!playTone(p.tone, p.volume)) toast(tr("Le navigateur bloque le son : cliquez d'abord sur la page, puis réessayez."), "error");
  }
  async function askBrowser(on: boolean) {
    if (!on) return update({ browser: false });
    if (perm === "unsupported") return toast(tr("Ce navigateur ne gère pas les notifications."), "error");
    const r = await Notification.requestPermission();
    setPerm(r);
    if (r === "granted") update({ browser: true });
    else toast(tr("Notifications refusées par le navigateur : autorisez-les dans les réglages du site."), "error");
  }
  return (
    <Card title={tr("🔔 Nouvelles commandes")}>
      <p className="mb-3 text-sm text-ink-soft">
        {tr("Quand une commande arrive, l'administration ouverte la signale tout de suite, sans recharger. Réglages propres à cet appareil.")}
      </p>
      <div className="space-y-4">
        <SoundStatus />
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="text-sm font-medium">
            {tr("Volume")}
            <input
              type="range"
              min={0.1}
              max={1}
              step={0.05}
              value={p.volume}
              onChange={(e) => update({ volume: Number(e.target.value) })}
              className="mt-2 block h-10 w-full accent-plum-600"
            />
          </label>
          <label className="text-sm font-medium">
            {tr("Son")}
            <select className={`${inputCls} mt-1`} value={p.tone} onChange={(e) => update({ tone: e.target.value as SoundKey })}>
              {Object.entries(SOUNDS).map(([k, s]) => (
                <option key={k} value={k}>{tr(s.label)}</option>
              ))}
            </select>
          </label>
          <div>
            <Button onClick={() => void test()}>{tr("🔊 Tester le son")}</Button>
          </div>
        </div>
        <ShopSound onSent={() => update({ tone: "boutique" })} volume={p.volume} />
        <Toggle checked={p.flash} onChange={(v) => update({ flash: v })} label={tr("Faire clignoter l'onglet")} hint={tr("Quand l'administration est ouverte dans un autre onglet.")} />
        <Toggle
          checked={p.browser && perm === "granted"}
          onChange={(v) => void askBrowser(v)}
          label={tr("Notification du système")}
          hint={
            perm === "denied"
              ? tr("Bloquée par le navigateur : autorisez les notifications pour ce site.")
              : perm === "unsupported"
                ? tr("Non disponible sur ce navigateur.")
                : tr("Une notification Windows / Android quand la page est en arrière-plan ; un clic ouvre la commande.")
          }
        />
      </div>
    </Card>
  );
}

/**
 * The sound is always on. Browsers only let a page play sound after the first click on it, so
 * the first touch of anything turns it on; installed as an app, it works from the start.
 */
function SoundStatus() {
  const ready = useSoundReady();
  const install = useInstallOffer();
  const toast = useToast();
  return (
    <div className={`rounded-xl p-3.5 text-sm ${ready ? "bg-emerald-50 text-emerald-900" : "bg-amber-50 text-amber-900"}`}>
      <p className="font-semibold">{ready ? tr("🔊 Son activé : chaque nouvelle commande sonne.") : tr("🔊 Le son s'active au premier clic sur la page.")}</p>
      <p className="mt-0.5 text-xs opacity-90">
        {isInstalled()
          ? tr("Administration installée comme application : le son marche dès l'ouverture.")
          : tr("Les navigateurs bloquent le son tant qu'on n'a pas touché la page. Installée comme application, l'administration sonne dès l'ouverture, sans clic.")}
      </p>
      {install && !isInstalled() && (
        <Button
          className="mt-2"
          onClick={() =>
            void install().then((ok) => ok && toast(tr("Application installée : ouvrez-la depuis son icône.")))
          }
        >
          {tr("📲 Installer l'administration comme application")}
        </Button>
      )}
    </div>
  );
}

/** One sound file for the whole team: every admin plays it for a new order (instead of the chime). */
function ShopSound({ onSent, volume }: { onSent: () => void; volume: number }) {
  const qc = useQueryClient();
  const toast = useToast();
  const can = useCan();
  const q = useQuery({ queryKey: ["operations-settings"], queryFn: () => api<{ soundUrl: string | null; soundSeconds?: number | null }>("/operations/settings") });
  const url = q.data?.soundUrl ?? null;
  const saved = q.data?.soundSeconds === undefined ? SHOP_SOUND_DEFAULT_SECONDS : q.data.soundSeconds;
  // the length being chosen (saved shortly after the slider stops)
  const [seconds, setSeconds] = useState<number | null>(saved);
  useEffect(() => setSeconds(saved), [saved]);
  const duration = useMutation({
    mutationFn: (s: number | null) => put<{ soundSeconds: number | null }>("/operations/sound/duration", { seconds: s }),
    onSuccess: (r) => {
      setShopSound(url, r.soundSeconds);
      void qc.invalidateQueries({ queryKey: ["operations-settings"] });
      toast(r.soundSeconds == null ? tr("Le fichier sonne en entier") : tr("Durée du son : {0} s", { 0: String(r.soundSeconds).replace(".", ",") }));
    },
    onError: (e) => toast(errorMessage(e), "error"),
  });
  useEffect(() => {
    if (seconds === saved) return;
    const t = setTimeout(() => duration.mutate(seconds), 600);
    return () => clearTimeout(t);
  }, [seconds]); // eslint-disable-line react-hooks/exhaustive-deps
  const done = (soundUrl: string | null, message: string) => {
    setShopSound(soundUrl, seconds);
    void qc.invalidateQueries({ queryKey: ["operations-settings"] });
    toast(message);
  };
  const send = useMutation({
    mutationFn: (file: File) => {
      const form = new FormData();
      form.append("file", file);
      return upload<{ soundUrl: string }>("/operations/sound", form);
    },
    onSuccess: async (r) => {
      done(r.soundUrl, tr("Son enregistré pour toute l'équipe"));
      onSent();
      await unlockSound();
      playTone("boutique", volume);
    },
    onError: (e) => toast(errorMessage(e), "error"),
  });
  const remove = useMutation({
    mutationFn: () => del<{ soundUrl: null }>("/operations/sound"),
    onSuccess: () => done(null, tr("Son retiré : le son « Annonce » reprend")),
    onError: (e) => toast(errorMessage(e), "error"),
  });
  async function listen() {
    setShopSound(url, seconds);
    await unlockSound();
    if (!playTone("boutique", volume)) toast(tr("Le navigateur bloque le son : cliquez d'abord sur la page, puis réessayez."), "error");
  }
  return (
    <div className="rounded-xl border border-line bg-ivory-deep/40 p-3.5">
      <p className="text-sm font-semibold">{tr("🎵 Son de la boutique (pour toute l'équipe)")}</p>
      <p className="mt-0.5 text-xs text-ink-soft">
        {url ? tr("Votre fichier sonne à chaque nouvelle commande, sur tous les appareils de l'équipe.") : tr("Aucun fichier envoyé : le son « Annonce » intégré sonne à chaque nouvelle commande.")}{" "}
        {tr("MP3, WAV, OGG ou M4A, 1 Mo au plus ; vous choisissez combien de temps il sonne.")}
      </p>
      <div className="mt-3 rounded-lg bg-surface p-3">
        <div className="flex flex-wrap items-center justify-between gap-2 text-sm font-medium">
          <span>{tr("Durée du son")}</span>
          <b className="tabular-nums text-plum-700">{seconds == null ? tr("Fichier entier") : tr("{0} s", { 0: String(seconds).replace(".", ",") })}</b>
        </div>
        <input
          type="range"
          min={0.5}
          max={30}
          step={0.5}
          value={seconds ?? 30}
          disabled={seconds == null || !can("orders.edit")}
          onChange={(e) => setSeconds(Number(e.target.value))}
          aria-label={tr("Durée du son")}
          className="mt-2 block h-10 w-full accent-plum-600 disabled:opacity-40"
        />
        <label className="mt-1 flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            className="size-4 accent-plum-600"
            checked={seconds == null}
            disabled={!can("orders.edit")}
            onChange={(e) => setSeconds(e.target.checked ? null : SHOP_SOUND_DEFAULT_SECONDS)}
          />
          {tr("Jouer le fichier en entier")}
        </label>
      </div>
      <div className="mt-2.5 flex flex-wrap gap-2">
        <Button onClick={() => void listen()}>{tr("▶ Écouter")}</Button>
        {can("orders.edit") && (
          <label className={`inline-flex h-11 cursor-pointer items-center rounded-xl border border-line bg-surface px-4 text-sm font-semibold transition hover:border-plum-600/40 ${send.isPending ? "pointer-events-none opacity-60" : ""}`}>
            {send.isPending ? tr("Envoi…") : url ? tr("Remplacer le fichier") : tr("Choisir un fichier son")}
            <input
              type="file"
              accept="audio/mpeg,audio/mp3,audio/wav,audio/x-wav,audio/ogg,audio/mp4,audio/x-m4a,.mp3,.wav,.ogg,.m4a"
              className="sr-only"
              onChange={(e) => {
                const f = e.target.files?.[0];
                e.target.value = "";
                if (f) send.mutate(f);
              }}
            />
          </label>
        )}
        {url && can("orders.edit") && (
          <Button variant="danger" loading={remove.isPending} onClick={() => remove.mutate()}>
            {tr("Retirer")}
          </Button>
        )}
      </div>
    </div>
  );
}

function SlaCard() {
  const qc = useQueryClient();
  const toast = useToast();
  const can = useCan();
  const q = useQuery({
    queryKey: ["operations-settings"],
    queryFn: () => api<{ sla: SlaSettings; packaging_cost: number; duplicates?: DuplicateSettings }>("/operations/settings"),
  });
  const [sla, setSla] = useState<SlaSettings>(DEFAULT_SLA);
  const [packaging, setPackaging] = useState("0");
  const [dup, setDup] = useState<DuplicateSettings>(DEFAULT_DUPLICATE_SETTINGS);
  useEffect(() => {
    if (!q.data) return;
    setSla(q.data.sla);
    setPackaging(String(q.data.packaging_cost));
    if (q.data.duplicates) setDup(q.data.duplicates);
  }, [q.data]);
  const save = useMutation({
    mutationFn: () => put("/operations/settings", { sla, packagingCost: Math.max(0, Math.round(Number(packaging) || 0)), duplicates: dup }),
    onSuccess: () => {
      toast(tr("Délais enregistrés"));
      void qc.invalidateQueries({ queryKey: ["operations-settings"] });
      void qc.invalidateQueries({ queryKey: ["dashboard"] });
    },
    onError: (e) => toast(errorMessage(e), "error"),
  });
  const field = (key: keyof SlaSettings, label: string, hint: string) => (
    <label className="text-sm font-medium">
      {label}
      <span className="mt-1 flex items-center gap-2">
        <input
          className={`${inputCls} w-28`}
          inputMode="numeric"
          value={sla[key]}
          onChange={(e) => setSla((s) => ({ ...s, [key]: Math.max(0, Number(e.target.value.replace(/\D/g, "")) || 0) }))}
        />
        <span className="text-ink-soft">{tr("minutes")}</span>
      </span>
      <span className="mt-1 block text-xs font-normal text-ink-soft">{hint}</span>
    </label>
  );
  return (
    <Card title={tr("⏰ Délais de traitement (SLA)")}>
      <p className="mb-3 text-sm text-ink-soft">
        {tr("Au-delà, la commande passe « en retard » : badge rouge, filtre « En retard », alerte dans la cloche.")}
      </p>
      <div className="grid gap-4 sm:grid-cols-3">
        {field("confirmMinutes", tr("Nouvelle → confirmée"), tr("ex. 30 min"))}
        {field("prepareMinutes", tr("Confirmée → en préparation"), tr("ex. 120 min (2 h)"))}
        {field("shipMinutes", tr("En préparation → expédiée"), tr("ex. 1440 min (24 h)"))}
      </div>
      {can("cost.view") && (
        <label className="mt-4 block text-sm font-medium">
          {tr("Coût d'emballage par colis")}
          <span className="mt-1 flex items-center gap-2">
            <input className={`${inputCls} w-28`} inputMode="numeric" value={packaging} onChange={(e) => setPackaging(e.target.value.replace(/\D/g, ""))} />
            <span className="text-ink-soft">{tr("DA")}</span>
          </span>
          <span className="mt-1 block text-xs font-normal text-ink-soft">{tr("Compté dans le bénéfice réel de chaque commande.")}</span>
        </label>
      )}
      <div className="mt-5 border-t border-line pt-4">
        <p className="text-sm font-semibold">{tr("⚠️ Doublons possibles")}</p>
        <p className="mb-3 text-xs text-ink-soft">{tr("Une commande qui ressemble à une autre de la même cliente (mêmes articles, même adresse, à quelques minutes d'écart) est signalée. Rien n'est annulé automatiquement.")}</p>
        <Toggle checked={dup.enabled} onChange={(v) => setDup((d) => ({ ...d, enabled: v }))} label={tr("Signaler les doublons possibles")} />
        {dup.enabled && (
          <div className="mt-3 grid gap-3 sm:grid-cols-2">
            <Select label={tr("Comparer avec les commandes des dernières")} value={String(dup.windowHours)} onChange={(e) => setDup((d) => ({ ...d, windowHours: Number(e.target.value) }))}>
              {[12, 24, 48, 72, 168].map((h) => (
                <option key={h} value={h}>
                  {h < 48 ? tr("{0} heures", { 0: h }) : tr("{0} jours", { 0: h / 24 })}
                </option>
              ))}
            </Select>
            <Select label={tr("Sensibilité")} value={String(dup.threshold)} onChange={(e) => setDup((d) => ({ ...d, threshold: Number(e.target.value) }))}>
              <option value="90">{tr("Prudente : seulement les doublons évidents")}</option>
              <option value="70">{tr("Normale (conseillée)")}</option>
              <option value="50">{tr("Sensible : plus d'alertes")}</option>
            </Select>
          </div>
        )}
      </div>
      <Button variant="primary" className="mt-4" loading={save.isPending} disabled={Object.values(sla).some((v) => v < 5)} onClick={() => save.mutate()}>
        {tr("Enregistrer")}
      </Button>
    </Card>
  );
}
