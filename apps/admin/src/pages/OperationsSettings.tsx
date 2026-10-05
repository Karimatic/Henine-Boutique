/**
 * Paramètres → Alertes & délais: new-order sound and notifications (this device), the order
 * SLA (how long each step may take) and the packaging cost used in the real profit.
 */
import { DEFAULT_SLA, type SlaSettings } from "@henine/shared";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { api, errorMessage, put } from "../api";
import { tr } from "../i18n";
import { loadPrefs, playTone, savePrefs, SOUNDS, unlockSound, type SoundKey, type SoundPrefs } from "../lib/live";
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
