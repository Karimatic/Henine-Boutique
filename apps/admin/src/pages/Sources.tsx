/**
 * Statistiques → Sources: where customers come from (Instagram, Facebook, TikTok, Google, a
 * friend, the shop's own links…), what each source brings (visits, orders, money, deliveries),
 * and the shop's own list: built-in sources renamed or hidden, its own sources with their
 * links, and the « How did you hear about us? » question at checkout.
 */
import { CUSTOM_SOURCE_KEY, ORDER_SOURCE_LABEL, ORDER_SOURCES, sourceLabel, type CustomSource, type OrderSource, type SourceSettings } from "@henine/shared";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { api, errorMessage, put } from "../api";
import { isAr, tr } from "../i18n";
import { da, ltr } from "../lib/format";
import { usePeriod } from "../lib/period";
import { SubNav } from "../lib/subnav";
import { useCan } from "../Shell";
import { Button, Card, Empty, ErrorState, inputCls, ListSkeleton, PageHeader, Stat, Toggle, useToast } from "../ui";

interface SourceRow {
  source: string;
  placed: number;
  orders: number;
  revenue: number;
  delivered: number;
  delivered_revenue: number;
  customers: number;
  visits: number;
  conversion: number | null;
}
interface SourcesData {
  settings: SourceSettings;
  visits: number;
  rows: SourceRow[];
  campaigns: { campaign: string; orders: number; revenue: number; delivered: number; visits: number; conversion: number | null }[];
}

const lang = () => (isAr ? "ar" : "fr");
const conv = (v: number | null) => (v == null ? "—" : ltr(`${String(v).replace(".", ",")} %`));

export function SourcesPage() {
  const can = useCan();
  const { query, picker } = usePeriod();
  const q = useQuery({ queryKey: ["sources", query], queryFn: () => api<SourcesData>(`/sources?${query}`), placeholderData: (p) => p });
  return (
    <div className="space-y-4">
      <PageHeader
        group={tr("Analyse")}
        title={tr("Sources")}
        subtitle={tr("D'où viennent vos clientes : Instagram, Facebook, TikTok, une amie, vos propres liens… et ce que chaque source rapporte.")}
      />
      <SubNav of="analysis" />
      {picker}
      {q.error ? <ErrorState error={q.error} onRetry={q.refetch} /> : !q.data ? <ListSkeleton /> : <Results data={q.data} />}
      {q.data && can("marketing.edit") && <SourcesEditor settings={q.data.settings} />}
    </div>
  );
}

function Results({ data }: { data: SourcesData }) {
  const navigate = useNavigate();
  const rows = data.rows.filter((r) => r.placed > 0 || r.visits > 0);
  const orders = rows.reduce((s, r) => s + r.orders, 0);
  const revenue = rows.reduce((s, r) => s + r.revenue, 0);
  const best = [...rows].sort((a, b) => b.revenue - a.revenue)[0];
  const label = (k: string) => sourceLabel(k, data.settings, lang());
  if (!rows.length)
    return (
      <Empty icon="📍" title={tr("Rien sur cette période")}>
        {tr("Dès qu'une cliente visite le site ou commande, sa source apparaît ici.")}
      </Empty>
    );
  return (
    <>
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Stat label={tr("Visites")} value={data.visits} />
        <Stat label={tr("Commandes")} value={orders} />
        <Stat label={tr("Chiffre d'affaires")} value={da(revenue)} />
        <Stat label={tr("Meilleure source")} value={best && best.revenue > 0 ? `${label(best.source).emoji} ${label(best.source).name}` : "—"} />
      </div>
      <Card title={tr("D'où viennent les commandes")}>
        <p className="mb-3 text-sm text-ink-soft">{tr("Touchez une source pour voir ses commandes. La source est retenue 30 jours sur le téléphone de la cliente.")}</p>
        <ul className="space-y-2">
          {rows.map((r) => {
            const l = label(r.source);
            const share = revenue > 0 ? Math.round((r.revenue / revenue) * 100) : 0;
            return (
              <li key={r.source}>
                <button
                  type="button"
                  onClick={() => void navigate({ to: "/commandes", search: { source: r.source } as never })}
                  className="w-full rounded-xl border border-line bg-surface p-3 text-start transition hover:border-plum-600/40"
                >
                  <span className="flex flex-wrap items-center justify-between gap-2">
                    <span className="font-semibold">
                      {l.emoji} {l.name}
                    </span>
                    <span className="font-semibold tabular-nums">{da(r.revenue)}</span>
                  </span>
                  <span className="mt-2 block h-1.5 overflow-hidden rounded-full bg-ivory-deep">
                    <span className="block h-full rounded-full bg-plum-600" style={{ width: `${share}%` }} />
                  </span>
                  <span className="mt-2 grid grid-cols-2 gap-x-4 gap-y-0.5 text-xs text-ink-soft sm:grid-cols-5">
                    <span>{tr("Visites")} <b className="tabular-nums text-ink">{r.visits || "—"}</b></span>
                    <span>{tr("Commandes")} <b className="tabular-nums text-ink">{r.orders}</b></span>
                    <span>{tr("Conversion")} <b className="tabular-nums text-ink">{conv(r.conversion)}</b></span>
                    <span>{tr("Livrées")} <b className="tabular-nums text-ink">{r.delivered}</b></span>
                    <span>{tr("Clientes")} <b className="tabular-nums text-ink">{r.customers}</b></span>
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      </Card>
      {data.campaigns.length > 0 && (
        <Card title={tr("Campagnes (utm_campaign)")}>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[32rem] text-sm">
              <tbody>
                {data.campaigns.map((c) => (
                  <tr key={c.campaign} className="border-t border-line first:border-0">
                    <td className="py-2 font-medium">{c.campaign}</td>
                    <td className="py-2 text-end tabular-nums">{tr("{0} visites", { 0: c.visits })}</td>
                    <td className="py-2 text-end tabular-nums">{tr("{0} cmd", { 0: c.orders })}</td>
                    <td className="py-2 text-end tabular-nums">{conv(c.conversion)}</td>
                    <td className="py-2 text-end tabular-nums">{da(c.revenue)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}
    </>
  );
}

/** a link code from a name: "Influenceuse Lina" → "influenceuse-lina" (Arabic names get a short code) */
function keyFrom(name: string, taken: string[]): string {
  const base =
    name
      .normalize("NFD")
      .replace(/[̀-ͯ]/g, "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 24) || "source";
  let key = base.length >= 2 ? base : `src-${base}`;
  for (let i = 2; taken.includes(key) || (ORDER_SOURCES as readonly string[]).includes(key); i++) key = `${base}-${i}`;
  return key;
}

function SourcesEditor({ settings }: { settings: SourceSettings }) {
  const qc = useQueryClient();
  const toast = useToast();
  const [draft, setDraft] = useState<SourceSettings>(settings);
  useEffect(() => setDraft(settings), [settings]);
  const [newName, setNewName] = useState("");
  const [newEmoji, setNewEmoji] = useState("🏷️");
  const save = useMutation({
    mutationFn: (next: SourceSettings) => put<SourceSettings>("/sources/settings", next),
    onSuccess: () => {
      toast(tr("Sources enregistrées ✓"));
      for (const k of ["sources", "source-settings"]) void qc.invalidateQueries({ queryKey: [k] });
    },
    onError: (e) => toast(errorMessage(e), "error"),
  });
  const setBuiltIn = (k: OrderSource, patch: { name?: string; emoji?: string; hidden?: boolean }) =>
    setDraft((d) => ({ ...d, builtIn: { ...d.builtIn, [k]: { ...d.builtIn[k], ...patch } } }));
  const setCustom = (i: number, patch: Partial<CustomSource>) => setDraft((d) => ({ ...d, custom: d.custom.map((c, k) => (k === i ? { ...c, ...patch } : c)) }));
  const add = () => {
    const name = newName.trim();
    if (!name) return;
    setDraft((d) => ({ ...d, custom: [...d.custom, { key: keyFrom(name, d.custom.map((c) => c.key)), name, emoji: newEmoji.trim() || "🏷️" }] }));
    setNewName("");
  };
  const link = (key: string) => `${location.origin}/?utm_source=${key}`;
  const copy = async (key: string) => {
    try {
      await navigator.clipboard.writeText(link(key));
      toast(tr("Lien copié"));
    } catch {
      toast(link(key));
    }
  };
  const badKeys = draft.custom.filter((c) => !CUSTOM_SOURCE_KEY.test(c.key)).length > 0;
  return (
    <Card title={tr("⚙️ Vos sources")}>
      <p className="mb-4 text-sm text-ink-soft">
        {tr("Ajoutez vos propres sources (une influenceuse, un flyer, une story…) : chacune a son lien. Partagez-le, et chaque visite ou commande venue par ce lien est comptée pour elle. Les sources détectées automatiquement peuvent être renommées ou masquées.")}
      </p>

      <p className="mb-2 text-sm font-semibold">{tr("Vos propres sources")}</p>
      {draft.custom.length === 0 && <p className="mb-2 text-sm text-ink-soft">{tr("Aucune pour l'instant.")}</p>}
      <ul className="space-y-2">
        {draft.custom.map((c, i) => (
          <li key={i} className="rounded-xl border border-line p-3">
            <div className="flex items-center gap-2">
              <input className={`${inputCls} w-14! shrink-0 px-1 text-center`} value={c.emoji} maxLength={4} onChange={(e) => setCustom(i, { emoji: e.target.value })} aria-label={tr("Emoji")} />
              <input className={`${inputCls} min-w-0 flex-1`} value={c.name} maxLength={40} onChange={(e) => setCustom(i, { name: e.target.value })} aria-label={tr("Nom de la source")} />
              <Button size="sm" variant="ghost" onClick={() => setDraft((d) => ({ ...d, custom: d.custom.filter((_, k) => k !== i) }))} aria-label={tr("Retirer {0}", { 0: c.name })}>
                ✕
              </Button>
            </div>
            <div className="mt-2 flex flex-wrap items-center gap-2 text-xs">
              <span className="text-ink-soft">{tr("Code du lien :")}</span>
              <input
                className="h-8 w-40 rounded-lg border border-line bg-surface px-2 font-mono text-xs"
                dir="ltr"
                value={c.key}
                maxLength={30}
                onChange={(e) => setCustom(i, { key: e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, "") })}
                aria-label={tr("Code du lien")}
              />
              <code className="order-last w-full truncate rounded bg-ivory-deep px-2 py-1" dir="ltr">
                {link(c.key)}
              </code>
              <Button size="sm" onClick={() => void copy(c.key)}>{tr("📋 Copier le lien")}</Button>
            </div>
          </li>
        ))}
      </ul>
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <input className={`${inputCls} w-14! shrink-0 px-1 text-center`} value={newEmoji} maxLength={4} onChange={(e) => setNewEmoji(e.target.value)} aria-label={tr("Emoji")} />
        <input
          className={`${inputCls} min-w-0 flex-1`}
          value={newName}
          maxLength={40}
          placeholder={tr("Ex. : Influenceuse Lina, Flyer Dellys, Story Ramadan…")}
          onChange={(e) => setNewName(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && add()}
          aria-label={tr("Nouvelle source")}
        />
        <Button onClick={add} disabled={!newName.trim()}>{tr("+ Ajouter")}</Button>
      </div>

      <p className="mb-2 mt-6 text-sm font-semibold">{tr("Sources détectées automatiquement")}</p>
      <ul className="divide-y divide-line rounded-xl border border-line">
        {ORDER_SOURCES.map((k) => {
          const o = draft.builtIn[k] ?? {};
          return (
            <li key={k} className={`flex items-center gap-2 p-2.5 ${o.hidden ? "opacity-50" : ""}`}>
              <input className={`${inputCls} w-14! shrink-0 px-1 text-center`} value={o.emoji ?? ""} placeholder={ORDER_SOURCE_LABEL[k].emoji} maxLength={4} onChange={(e) => setBuiltIn(k, { emoji: e.target.value || undefined })} aria-label={tr("Emoji")} />
              <input
                className={`${inputCls} min-w-0 flex-1`}
                value={o.name ?? ""}
                placeholder={ORDER_SOURCE_LABEL[k][lang()]}
                maxLength={40}
                onChange={(e) => setBuiltIn(k, { name: e.target.value || undefined })}
                aria-label={tr("Nom de {0}", { 0: ORDER_SOURCE_LABEL[k][lang()] })}
              />
              <label className="flex shrink-0 items-center gap-1.5 text-xs">
                <input type="checkbox" className="size-4 accent-plum-600" checked={!o.hidden} onChange={(e) => setBuiltIn(k, { hidden: !e.target.checked })} />
                {tr("Visible")}
              </label>
            </li>
          );
        })}
      </ul>

      <div className="mt-6 rounded-xl border border-line p-3">
        <Toggle
          checked={draft.ask}
          onChange={(v) => setDraft((d) => ({ ...d, ask: v }))}
          label={tr("Demander « Comment nous avez-vous connus ? » à la commande")}
          hint={tr("Une petite question facultative dans le formulaire, avec vos sources visibles comme réponses. Sa réponse compte quand la visite elle-même ne dit rien (bouche-à-oreille, story vue puis site tapé à la main…).")}
        />
      </div>

      <Button variant="primary" className="mt-4" loading={save.isPending} disabled={badKeys} onClick={() => save.mutate(draft)}>
        {tr("Enregistrer")}
      </Button>
      {badKeys && <p className="mt-2 text-xs text-danger">{tr("Un code de lien doit faire au moins 2 caractères (lettres, chiffres, tirets).")}</p>}
    </Card>
  );
}
