import type { AbVerdict } from "@henine/shared";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { api, del, errorMessage, patch, post } from "../api";
import { tr } from "../i18n";
import { date } from "../lib/format";
import { Badge, Button, Card, Empty, ErrorState, ListSkeleton, PageHeader, Select, TextField, useToast } from "../ui";

type Funnel = { seen: number; product: number; checkout: number; order: number };

interface Experiment {
  id: number;
  name: string;
  kind: "buy_label" | "grid";
  config: { a?: { fr?: string; ar?: string; layout?: string }; b?: { fr?: string; ar?: string; layout?: string } };
  status: "draft" | "running" | "stopped";
  winner: "a" | "b" | null;
  started_at: number | null;
  ended_at: number | null;
  funnel: { a: Funnel; b: Funnel };
  verdict: AbVerdict;
}

const pct = (v: number) => `${(v * 100).toFixed(1)} %`;
const STEPS: [keyof Funnel, string][] = [
  ["seen", tr("Ont vu")],
  ["product", tr("Fiche produit")],
  ["checkout", tr("Commande commencée")],
  ["order", tr("Commandes")],
];

/**
 * Tests A/B: half the visitors see version A, half version B; each step is counted
 * (seen → product → checkout → order) and the page says which version sells more,
 * once there is enough data to be sure.
 */
export function ExperimentsPage() {
  const q = useQuery({ queryKey: ["experiments"], queryFn: () => api<Experiment[]>("/experiments"), refetchInterval: 60_000 });
  const [creating, setCreating] = useState(false);
  return (
    <div className="space-y-4">
      <PageHeader
        group={tr("Analyse")}
        title={tr("Tests A/B")}
        subtitle={tr("Comparez deux versions de la boutique sur de vraies clientes : la moitié voit A, l'autre B. On compte jusqu'à la commande.")}
        actions={<Button variant="primary" onClick={() => setCreating(true)}>{tr("+ Nouveau test")}</Button>}
      />
      {creating && <NewExperiment onDone={() => setCreating(false)} />}
      {q.error ? <ErrorState error={q.error} onRetry={q.refetch} /> : !q.data ? <ListSkeleton rows={3} /> : q.data.length === 0 ? (
        <Empty title={tr("Aucun test pour l'instant")} icon="🧪">{tr("Exemple : « Commander » contre « Acheter maintenant » sur le bouton d'achat.")}</Empty>
      ) : (
        q.data.map((e) => <ExperimentCard key={e.id} e={e} />)
      )}
    </div>
  );
}

function NewExperiment({ onDone }: { onDone: () => void }) {
  const qc = useQueryClient();
  const toast = useToast();
  const [kind, setKind] = useState<"buy_label" | "grid">("buy_label");
  const [name, setName] = useState(tr("Bouton d'achat"));
  const [a, setA] = useState({ fr: "Commander", ar: "اطلبي الآن" });
  const [b, setB] = useState({ fr: "Acheter maintenant", ar: "اشتري الآن" });
  const create = useMutation({
    mutationFn: () => post("/experiments", kind === "buy_label" ? { kind, name, a, b } : { kind, name }),
    onSuccess: () => {
      toast(tr("Test créé : démarrez-le quand vous voulez ✓"));
      void qc.invalidateQueries({ queryKey: ["experiments"] });
      onDone();
    },
    onError: (e) => toast(errorMessage(e), "error"),
  });
  return (
    <Card title={tr("🧪 Nouveau test")}>
      <div className="grid gap-3 sm:grid-cols-2">
        <Select
          label={tr("Ce qui change")}
          value={kind}
          onChange={(e) => {
            const k = e.target.value as "buy_label" | "grid";
            setKind(k);
            setName(k === "grid" ? tr("Grille des produits") : tr("Bouton d'achat"));
          }}
        >
          <option value="buy_label">{tr("Le texte du bouton d'achat")}</option>
          <option value="grid">{tr("La grille des produits (2 colonnes / grandes cartes)")}</option>
        </Select>
        <TextField label={tr("Nom du test")} value={name} onChange={(e) => setName(e.target.value)} maxLength={80} />
      </div>
      {kind === "buy_label" ? (
        <div className="mt-3 grid gap-3 sm:grid-cols-2">
          <div className="space-y-2 rounded-xl bg-ivory-deep p-3">
            <p className="text-sm font-bold">{tr("Version A")}</p>
            <TextField label={tr("Français")} value={a.fr} onChange={(e) => setA({ ...a, fr: e.target.value })} maxLength={40} />
            <TextField label={tr("Arabe")} dir="rtl" value={a.ar} onChange={(e) => setA({ ...a, ar: e.target.value })} maxLength={40} />
          </div>
          <div className="space-y-2 rounded-xl bg-ivory-deep p-3">
            <p className="text-sm font-bold">{tr("Version B")}</p>
            <TextField label={tr("Français")} value={b.fr} onChange={(e) => setB({ ...b, fr: e.target.value })} maxLength={40} />
            <TextField label={tr("Arabe")} dir="rtl" value={b.ar} onChange={(e) => setB({ ...b, ar: e.target.value })} maxLength={40} />
          </div>
        </div>
      ) : (
        <p className="mt-3 text-sm text-ink-soft">{tr("A : la grille actuelle (2 produits par ligne sur téléphone). B : de grandes cartes (1 produit par ligne sur téléphone).")}</p>
      )}
      <div className="mt-3 flex justify-end gap-2">
        <Button onClick={onDone}>{tr("Annuler")}</Button>
        <Button variant="primary" loading={create.isPending} onClick={() => create.mutate()}>{tr("Créer le test")}</Button>
      </div>
    </Card>
  );
}

function ExperimentCard({ e }: { e: Experiment }) {
  const qc = useQueryClient();
  const toast = useToast();
  const save = useMutation({
    mutationFn: (body: { status?: "running" | "stopped"; winner?: "a" | "b" | null }) => patch(`/experiments/${e.id}`, body),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ["experiments"] }),
    onError: (err) => toast(errorMessage(err), "error"),
  });
  const remove = useMutation({
    mutationFn: () => del(`/experiments/${e.id}`),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ["experiments"] }),
  });
  const v = e.verdict;
  const label = (k: "a" | "b") => (e.kind === "buy_label" ? `« ${e.config[k]?.fr} »` : k === "a" ? tr("2 colonnes") : tr("Grandes cartes"));
  const verdictText = v.needMoreData
    ? tr("⏳ Pas encore assez de visites (100 par version au minimum).")
    : v.winner
      ? tr("🏆 La version {0} vend plus : {1} de commandes en plus (confiance {2}).", {
          0: v.winner.toUpperCase(),
          1: v.lift == null ? "—" : `${v.winner === "b" ? "+" : ""}${Math.round((v.winner === "b" ? v.lift : 1 / (1 + v.lift) - 1) * 100)} %`,
          2: `${Math.round(v.confidence * 100)} %`,
        })
      : tr("🤝 Pas de différence nette pour l'instant (confiance {0}, il faut 95 %).", { 0: `${Math.round(v.confidence * 100)} %` });

  return (
    <Card
      title={
        <span className="flex flex-wrap items-center gap-2">
          {e.name}
          <Badge tone={e.status === "running" ? "bg-emerald-100 text-emerald-800" : e.status === "draft" ? "bg-sky-100 text-sky-800" : "bg-stone-200 text-stone-700"}>
            {e.status === "running" ? tr("En cours") : e.status === "draft" ? tr("Prêt") : tr("Arrêté")}
          </Badge>
          {e.winner && <Badge>{tr("Gardée : {0}", { 0: e.winner.toUpperCase() })}</Badge>}
        </span>
      }
      actions={
        <div className="flex gap-2">
          {e.status !== "running" ? (
            <Button size="sm" variant="primary" loading={save.isPending} onClick={() => save.mutate({ status: "running" })}>{tr("▶ Démarrer")}</Button>
          ) : (
            <Button size="sm" loading={save.isPending} onClick={() => save.mutate({ status: "stopped" })}>{tr("⏸ Arrêter")}</Button>
          )}
          {e.status !== "running" && (
            <Button size="sm" variant="danger" onClick={() => confirm(tr("Supprimer ce test et ses chiffres ?")) && remove.mutate()}>{tr("Supprimer")}</Button>
          )}
        </div>
      }
    >
      <p className="mb-3 text-xs text-ink-soft">
        {e.started_at ? tr("Démarré le {0}", { 0: date(e.started_at) }) : tr("Pas encore démarré")}
        {e.ended_at ? tr(" · arrêté le {0}", { 0: date(e.ended_at) }) : ""}
      </p>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[30rem] text-sm">
          <thead>
            <tr className="text-start text-xs uppercase tracking-[0.08em] text-ink-soft">
              <th className="py-1.5 text-start font-semibold">{tr("Version")}</th>
              {STEPS.map(([k, l]) => (
                <th key={k} className="py-1.5 text-end font-semibold">{l}</th>
              ))}
              <th className="py-1.5 text-end font-semibold">{tr("Conversion")}</th>
            </tr>
          </thead>
          <tbody>
            {(["a", "b"] as const).map((k) => (
              <tr key={k} className={`border-t border-line ${v.winner === k ? "font-semibold" : ""}`}>
                <td className="py-2">
                  <b>{k.toUpperCase()}</b> <span className="text-ink-soft">{label(k)}</span>
                </td>
                {STEPS.map(([s]) => (
                  <td key={s} className="py-2 text-end tabular-nums">{e.funnel[k][s]}</td>
                ))}
                <td className="py-2 text-end tabular-nums">{pct(k === "a" ? v.rateA : v.rateB)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className={`mt-3 rounded-lg p-3 text-sm ${v.winner ? "bg-emerald-50 text-emerald-800" : "bg-ivory-deep"}`}>{verdictText}</p>
      {e.status !== "draft" && (
        <div className="mt-3 flex flex-wrap gap-2">
          {(["a", "b"] as const).map((k) => (
            <Button key={k} size="sm" onClick={() => save.mutate({ winner: k, status: "stopped" })}>
              {tr("Garder la version {0} et arrêter", { 0: k.toUpperCase() })}
            </Button>
          ))}
        </div>
      )}
    </Card>
  );
}
