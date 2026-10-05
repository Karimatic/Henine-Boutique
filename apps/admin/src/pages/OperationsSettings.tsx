/**
 * Paramètres → Alertes & délais: new-order sound and notifications (this device), the order
 * SLA (how long each step may take) and the packaging cost used in the real profit.
 */
import { DEFAULT_SLA, type SlaSettings } from "@henine/shared";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { api, del, errorMessage, put, upload } from "../api";
import { tr } from "../i18n";
import { loadPrefs, playTone, savePrefs, setShopSound, SOUNDS, unlockSound, type SoundKey, type SoundPrefs } from "../lib/live";
import { useCan } from "../Shell";
import { Button, Card, inputCls, Toggle, useToast } from "../ui";

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
        <Toggle checked={p.sound} onChange={(v) => update({ sound: v })} label={tr("Son")} hint={tr("Un seul son par commande, même avec plusieurs onglets ouverts.")} />
        {p.sound && (
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
        )}
        <ShopSound onSent={() => update({ tone: "boutique", sound: true })} volume={p.volume} />
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

/** One sound file for the whole team: every admin plays it for a new order (instead of the chime). */
function ShopSound({ onSent, volume }: { onSent: () => void; volume: number }) {
  const qc = useQueryClient();
  const toast = useToast();
  const can = useCan();
  const q = useQuery({ queryKey: ["operations-settings"], queryFn: () => api<{ soundUrl: string | null }>("/operations/settings") });
  const url = q.data?.soundUrl ?? null;
  const done = (soundUrl: string | null, message: string) => {
    setShopSound(soundUrl);
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
    onSuccess: () => done(null, tr("Son retiré : le carillon reprend")),
    onError: (e) => toast(errorMessage(e), "error"),
  });
  async function listen() {
    await unlockSound();
    if (!playTone("boutique", volume)) toast(tr("Le navigateur bloque le son : cliquez d'abord sur la page, puis réessayez."), "error");
  }
  return (
    <div className="rounded-xl border border-line bg-ivory-deep/40 p-3.5">
      <p className="text-sm font-semibold">{tr("🎵 Son de la boutique (pour toute l'équipe)")}</p>
      <p className="mt-0.5 text-xs text-ink-soft">
        {url ? tr("Votre fichier sonne à chaque nouvelle commande, sur tous les appareils de l'équipe.") : tr("Aucun fichier : le carillon intégré est utilisé.")}{" "}
        {tr("MP3, WAV, OGG ou M4A, 1 Mo au plus ; joué 1,5 seconde au maximum.")}
      </p>
      <div className="mt-2.5 flex flex-wrap gap-2">
        {url && <Button onClick={() => void listen()}>{tr("▶ Écouter")}</Button>}
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
  const q = useQuery({ queryKey: ["operations-settings"], queryFn: () => api<{ sla: SlaSettings; packaging_cost: number }>("/operations/settings") });
  const [sla, setSla] = useState<SlaSettings>(DEFAULT_SLA);
  const [packaging, setPackaging] = useState("0");
  useEffect(() => {
    if (!q.data) return;
    setSla(q.data.sla);
    setPackaging(String(q.data.packaging_cost));
  }, [q.data]);
  const save = useMutation({
    mutationFn: () => put("/operations/settings", { sla, packagingCost: Math.max(0, Math.round(Number(packaging) || 0)) }),
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
      <Button variant="primary" className="mt-4" loading={save.isPending} disabled={Object.values(sla).some((v) => v < 5)} onClick={() => save.mutate()}>
        {tr("Enregistrer")}
      </Button>
    </Card>
  );
}
