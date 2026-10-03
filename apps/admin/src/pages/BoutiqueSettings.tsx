import { boutiqueStatus, DAY_NAMES, DEFAULT_BOUTIQUE, type BoutiqueDTO } from "@henine/shared";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { api, errorMessage, put } from "../api";
import { lang, tr } from "../i18n";
import { Button, Card, ErrorState, inputCls, ListSkeleton, TextField, Toggle, useToast } from "../ui";

/** Paramètres → Contact: the shop page (/boutique) — address, map, opening hours. */
export function BoutiqueSettingsCard() {
  const qc = useQueryClient();
  const toast = useToast();
  const q = useQuery({ queryKey: ["boutique"], queryFn: () => api<BoutiqueDTO>("/boutique") });
  const [b, setB] = useState<BoutiqueDTO | null>(null);
  useEffect(() => {
    if (q.data) setB({ ...DEFAULT_BOUTIQUE, ...q.data });
  }, [q.data]);
  const save = useMutation({
    mutationFn: (v: BoutiqueDTO) => put("/boutique", v),
    onSuccess: () => {
      toast(tr("Boutique enregistrée ✓"));
      void qc.invalidateQueries({ queryKey: ["boutique"] });
    },
    onError: (e) => toast(errorMessage(e), "error"),
  });
  if (q.error) return <ErrorState error={q.error} onRetry={q.refetch} />;
  if (!b) return <ListSkeleton rows={3} />;
  const s = boutiqueStatus(b.hours);
  const days = DAY_NAMES[lang === "ar" ? "ar" : "fr"];
  const setDay = (d: number, v: BoutiqueDTO["hours"][number]) => setB({ ...b, hours: b.hours.map((h, i) => (i === d ? v : h)) });
  return (
    <Card title={tr("📍 La boutique (page « Visitez notre boutique »)")}>
      <p className="mb-3 text-sm text-ink-soft">
        {tr("Adresse, plan Google Maps, horaires et « ouvert / fermé » en direct sur la page /boutique. Le téléphone et WhatsApp viennent de la carte Contact.")}
      </p>
      <div className="grid gap-3 sm:grid-cols-2">
        <TextField label={tr("Adresse (français)")} value={b.addressFr} onChange={(e) => setB({ ...b, addressFr: e.target.value })} maxLength={200} />
        <TextField label={tr("Adresse (arabe)")} dir="rtl" value={b.addressAr} onChange={(e) => setB({ ...b, addressAr: e.target.value })} maxLength={200} />
        <TextField
          label={tr("Recherche Google Maps")}
          hint={tr("Le nom de la boutique tel qu'il apparaît sur Google Maps, l'adresse, ou « 36.7600,3.4700 ».")}
          value={b.mapQuery}
          onChange={(e) => setB({ ...b, mapQuery: e.target.value })}
          maxLength={200}
          className="sm:col-span-2"
        />
        <TextField label={tr("Petit mot (français)")} placeholder={tr("Parking juste devant…")} value={b.noteFr} onChange={(e) => setB({ ...b, noteFr: e.target.value })} maxLength={300} />
        <TextField label={tr("Petit mot (arabe)")} dir="rtl" value={b.noteAr} onChange={(e) => setB({ ...b, noteAr: e.target.value })} maxLength={300} />
      </div>
      <p className="mb-2 mt-5 text-sm font-medium">
        {tr("Horaires")} · <span className={s.open ? "text-emerald-700" : "text-ink-soft"}>{s.open ? tr("ouvert maintenant") : tr("fermé maintenant")}</span>
      </p>
      <ul className="space-y-1.5">
        {[6, 0, 1, 2, 3, 4, 5].map((d) => {
          const h = b.hours[d];
          return (
            <li key={d} className="flex flex-wrap items-center gap-2 text-sm">
              <label className="flex w-36 items-center gap-2">
                <input type="checkbox" className="size-4 accent-plum-600" checked={!!h} onChange={(e) => setDay(d, e.target.checked ? { open: "09:30", close: "20:00" } : null)} />
                {days[d]}
              </label>
              {h ? (
                <>
                  <input type="time" className={`${inputCls} h-9 w-28`} value={h.open} onChange={(e) => setDay(d, { ...h, open: e.target.value })} aria-label={tr("Ouverture")} />
                  <span>→</span>
                  <input type="time" className={`${inputCls} h-9 w-28`} value={h.close} onChange={(e) => setDay(d, { ...h, close: e.target.value })} aria-label={tr("Fermeture")} />
                </>
              ) : (
                <span className="text-ink-soft">{tr("Fermé")}</span>
              )}
            </li>
          );
        })}
      </ul>
      <div className="mt-4">
        <Toggle label={tr("Afficher la page boutique")} checked={b.enabled} onChange={(v) => setB({ ...b, enabled: v })} />
        <Toggle
          label={tr("« Disponible en boutique » sur les fiches produit")}
          hint={tr("Pour les pièces en stock : le stock du site et de la boutique est le même.")}
          checked={b.showOnProducts}
          onChange={(v) => setB({ ...b, showOnProducts: v })}
        />
      </div>
      <div className="mt-3 flex flex-wrap justify-end gap-2">
        <a href="/boutique" target="_blank" rel="noreferrer" className="inline-flex h-10 items-center rounded-lg border border-line bg-surface px-4 text-sm font-semibold">{tr("Voir la page ↗")}</a>
        <Button variant="primary" loading={save.isPending} onClick={() => save.mutate(b)}>{tr("Enregistrer")}</Button>
      </div>
    </Card>
  );
}
