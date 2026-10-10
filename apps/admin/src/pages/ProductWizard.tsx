import { useQuery, useQueryClient } from "@tanstack/react-query";
import { DiscountFields } from "../lib/discount";
import { studioEnabled, studioPhoto } from "../lib/studio";
import { useCan } from "../Shell";
import { Link, useNavigate } from "@tanstack/react-router";
import { Check, ImagePlus } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { api, errorMessage, post } from "../api";
import { CategoryOptions, categoryPath, type CategoryLite } from "../lib/categories";
import { tr } from "../i18n";
import { da } from "../lib/format";
import { Button, Card, inputCls, NumberField, PageHeader, Spinner, TextArea, TextField, useToast } from "../ui";
import { COLOR_CHOICES, SIZE_CHOICES, uploadPhoto } from "./Products";

/**
 * New product in 5 short steps, one thing per screen:
 * 1 photos → 2 name & price → 3 sizes & colours → 4 quantities → 5 publish.
 * Everything is created at the end in one go (product, sizes/colours, stock), then the
 * photos are optimised and uploaded. The full form stays available for the rest.
 */

type Color = { labelFr: string; labelAr: string; hex: string };
const STEPS = ["Photos", "Nom & prix", "Tailles & couleurs", "Quantités", "Publier"] as const;

export function ProductWizard() {
  const can = useCan();
  const toast = useToast();
  const qc = useQueryClient();
  const navigate = useNavigate();
  const categories = useQuery({ queryKey: ["categories"], queryFn: () => api<CategoryLite[]>("/categories") });
  const [step, setStep] = useState(0);
  const [files, setFiles] = useState<File[]>([]);
  const [info, setInfo] = useState({ nameFr: "", nameAr: "", price: null as number | null, compareAt: null as number | null, cost: null as number | null, categoryId: null as number | null, descriptionFr: "", descriptionAr: "" });
  const [sizes, setSizes] = useState<string[]>([]);
  const [colors, setColors] = useState<Color[]>([]);
  const [customSize, setCustomSize] = useState("");
  const [customColor, setCustomColor] = useState("");
  const [qty, setQty] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<string | null>(null);

  // photo previews
  const previews = useMemo(() => files.map((f) => URL.createObjectURL(f)), [files]);
  useEffect(() => () => previews.forEach((u) => URL.revokeObjectURL(u)), [previews]);

  // every size × colour combination
  const cells = useMemo(() => {
    const cs = colors.length ? colors.map((c) => c.labelFr) : [""];
    const ss = sizes.length ? sizes : [""];
    return cs.flatMap((c) => ss.map((s) => ({ key: `${c}|${s}`, color: c, size: s })));
  }, [sizes, colors]);
  const totalPieces = cells.reduce((n, c) => n + (Number(qty[c.key]) || 0), 0);

  const canNext = [true, info.nameFr.trim().length >= 2 && !!info.price, true, true, true][step];

  async function finish(status: "published" | "draft") {
    setBusy(tr("Création du produit…"));
    try {
      const sizeRefs = sizes.map((s, i) => ({ ref: `n:s${i}`, labelFr: s, labelAr: s, hex: null }));
      const colorRefs = colors.map((c, i) => ({ ref: `n:c${i}`, labelFr: c.labelFr, labelAr: c.labelAr || c.labelFr, hex: c.hex }));
      const options = [
        ...(sizeRefs.length ? [{ kind: "taille", nameFr: "Taille", nameAr: "المقاس", values: sizeRefs }] : []),
        ...(colorRefs.length ? [{ kind: "couleur", nameFr: "Couleur", nameAr: "اللون", values: colorRefs }] : []),
      ];
      const variants = cells.map((cell) => ({
        refs: [
          ...(sizes.length ? [sizeRefs[sizes.indexOf(cell.size)]!.ref] : []),
          ...(colors.length ? [colorRefs[colors.findIndex((c) => c.labelFr === cell.color)]!.ref] : []),
        ],
        priceOverride: null,
        stockOnHand: Number(qty[cell.key]) || 0,
        lowStockThreshold: 2,
        isActive: true,
      }));
      const saved = await post<{ id: number }>("/products", {
        nameFr: info.nameFr.trim(), nameAr: info.nameAr.trim() || info.nameFr.trim(), descriptionFr: info.descriptionFr, descriptionAr: info.descriptionAr,
        status, categoryId: info.categoryId, tags: ["nouveaute"], price: info.price ?? 0, compareAtPrice: info.compareAt, costPrice: can("cost.view") ? info.cost : null,
        seoTitle: null, seoDescription: null, instagramUrl: null, relatedIds: [], sizeGuideId: null, options, variants,
      });
      const studio = studioEnabled();
      let studioFailed = false;
      for (const [n, file] of files.entries()) {
        setBusy(tr("Photo {0}/{1}…", { 0: n + 1, 1: files.length }));
        // same style for every product: background removed, centred in the same frame
        const clean = studio ? await studioPhoto(file) : null;
        if (studio && !clean) studioFailed = true;
        await uploadPhoto(saved.id, clean ?? file, undefined, !!clean).catch(() => toast(tr("Une photo n'a pas pu être envoyée : ajoutez-la depuis la fiche."), "error"));
      }
      if (studioFailed) toast(tr("Le fond n'a pas pu être retiré pour le moment : photo gardée telle quelle."), "error");
      toast(status === "published" ? tr("Produit en ligne ✓") : tr("Brouillon enregistré ✓"));
      void qc.invalidateQueries({ queryKey: ["products"] });
      void qc.invalidateQueries({ queryKey: ["stock-products"] });
      void navigate({ to: "/produits/$id", params: { id: String(saved.id) } });
    } catch (e) {
      toast(errorMessage(e), "error");
      setBusy(null);
    }
  }

  const chip = (on: boolean) => `inline-flex h-11 items-center gap-2 rounded-xl border px-4 text-sm font-semibold transition ${on ? "border-ink bg-ink text-on-ink" : "border-line bg-surface hover:border-ink/40"}`;

  return (
    <div className="mx-auto max-w-2xl pb-28">
      <PageHeader
        group={tr("Catalogue › Produits")}
        title={tr("Nouveau produit")}
        actions={<Link to="/produits/nouveau-complet" className="text-sm font-semibold text-plum-600">{tr("Formulaire complet →")}</Link>}
      />

      {/* progress */}
      <ol className="mb-5 grid grid-cols-5 gap-1.5">
        {STEPS.map((s, i) => (
          <li key={s}>
            <button type="button" disabled={i > step && !canNext} onClick={() => i < step && setStep(i)} className="w-full text-start">
              <span className={`block h-1.5 rounded-full ${i <= step ? "bg-plum-600" : "bg-ivory-deep"}`} />
              <span className={`mt-1.5 hidden text-xs sm:block ${i === step ? "font-semibold text-ink" : "text-ink-soft"}`}>
                {i + 1}. {tr(s)}
              </span>
            </button>
          </li>
        ))}
      </ol>
      <p className="mb-3 text-sm font-semibold sm:hidden">
        {tr("Étape {0} sur 5 :", { 0: step + 1 })} {tr(STEPS[step]!)}
      </p>

      {step === 0 && (
        <Card title={tr("📸 Les photos")}>
          <p className="mb-3 text-sm text-ink-soft">{tr("La première photo sera la photo principale. Vous pourrez en ajouter d'autres plus tard.")}</p>
          <ul className="grid grid-cols-3 gap-2 sm:grid-cols-4">
            {previews.map((u, i) => (
              <li key={u} className="relative">
                <img src={u} alt="" className="aspect-[4/5] w-full rounded-xl object-cover" />
                {i === 0 && <span className="absolute start-1.5 top-1.5 rounded-full bg-noir/75 px-2 py-0.5 text-[10px] font-semibold text-white">{tr("Principale")}</span>}
                <button type="button" aria-label={tr("Retirer")} onClick={() => setFiles((f) => f.filter((_, k) => k !== i))} className="absolute end-1.5 top-1.5 grid size-7 place-items-center rounded-full bg-surface/90 text-sm shadow">
                  ×
                </button>
              </li>
            ))}
            <li>
              <label className="flex aspect-[4/5] cursor-pointer flex-col items-center justify-center gap-1 rounded-xl border-2 border-dashed border-line bg-surface text-center text-xs text-ink-soft hover:border-plum-600">
                <ImagePlus className="size-7 text-plum-600" />
                {tr("Ajouter des photos")}
                <input type="file" accept="image/*" multiple className="sr-only" onChange={(e) => { const l = e.target.files ? [...e.target.files] : []; e.target.value = ""; setFiles((f) => [...f, ...l].slice(0, 12)); }} />
              </label>
            </li>
          </ul>
        </Card>
      )}

      {step === 1 && (
        <Card title={tr("✏️ Nom et prix")}>
          <div className="space-y-3">
            <TextField label={tr("Nom (français)")} placeholder={tr("ex : Pyjama satin rayé")} value={info.nameFr} onChange={(e) => setInfo({ ...info, nameFr: e.target.value })} autoFocus />
            <TextField label={tr("Nom (arabe)")} dir="rtl" placeholder="مثلًا: بيجامة ساتان مخططة" value={info.nameAr} onChange={(e) => setInfo({ ...info, nameAr: e.target.value })} />
            <div className="grid grid-cols-2 gap-3">
              <NumberField label={tr("Prix de vente")} suffix="DA" value={info.price} onChange={(v) => setInfo({ ...info, price: v })} />
              {can("cost.view") && (
                <NumberField
                  label={tr("Prix d'achat")}
                  suffix="DA"
                  value={info.cost}
                  onChange={(v) => setInfo({ ...info, cost: v })}
                  hint={info.price && info.cost ? tr("marge {0} %", { 0: Math.round(((info.price - info.cost) / info.price) * 100) }) : tr("privé")}
                  className="col-span-2"
                />
              )}
            </div>
            <DiscountFields price={info.price} compareAt={info.compareAt} onChange={(n) => setInfo({ ...info, price: n.price, compareAt: n.compareAt })} />
            <label className="block text-sm font-medium">
              {tr("Catégorie")}
              <select className={`${inputCls} mt-1.5`} value={info.categoryId ?? ""} onChange={(e) => setInfo({ ...info, categoryId: e.target.value ? Number(e.target.value) : null })}>
                <option value="">—</option>
                <CategoryOptions cats={categories.data ?? []} />
              </select>
            </label>
            <details className="rounded-xl border border-line p-3">
              <summary className="cursor-pointer text-sm font-semibold">{tr("Description (facultatif)")}</summary>
              <div className="mt-3 grid gap-3">
                <TextArea label={tr("Description (français)")} rows={3} value={info.descriptionFr} onChange={(e) => setInfo({ ...info, descriptionFr: e.target.value })} />
                <TextArea label={tr("Description (arabe)")} dir="rtl" rows={3} value={info.descriptionAr} onChange={(e) => setInfo({ ...info, descriptionAr: e.target.value })} />
              </div>
            </details>
          </div>
        </Card>
      )}

      {step === 2 && (
        <div className="space-y-4">
          <Card title={tr("📏 Tailles")}>
            <div className="flex flex-wrap gap-2">
              {[...SIZE_CHOICES, ...sizes.filter((s) => !SIZE_CHOICES.includes(s))].map((s) => {
                const on = sizes.includes(s);
                return (
                  <button key={s} type="button" className={chip(on)} onClick={() => setSizes(on ? sizes.filter((x) => x !== s) : [...sizes, s])}>
                    {on && <Check className="size-4" />}
                    {s}
                  </button>
                );
              })}
            </div>
            <div className="mt-3 flex gap-2">
              <input className={`${inputCls} h-11`} placeholder={tr("Autre taille (ex : 38, Unique)")} value={customSize} onChange={(e) => setCustomSize(e.target.value)} />
              <Button className="h-11" disabled={!customSize.trim()} onClick={() => { const s = customSize.trim(); if (!sizes.includes(s)) setSizes([...sizes, s]); setCustomSize(""); }}>
                {tr("Ajouter")}
              </Button>
            </div>
          </Card>
          <Card title={tr("🎨 Couleurs")}>
            <div className="flex flex-wrap gap-2">
              {[...COLOR_CHOICES.map(([fr, ar, hex]) => ({ labelFr: fr, labelAr: ar, hex })), ...colors.filter((c) => !COLOR_CHOICES.some(([fr]) => fr === c.labelFr))].map((c) => {
                const on = colors.some((x) => x.labelFr === c.labelFr);
                return (
                  <button key={c.labelFr} type="button" className={chip(on)} onClick={() => setColors(on ? colors.filter((x) => x.labelFr !== c.labelFr) : [...colors, c])}>
                    <span className="size-4 rounded-full border border-white/60 shadow" style={{ background: c.hex }} />
                    {c.labelFr}
                  </button>
                );
              })}
            </div>
            <div className="mt-3 flex gap-2">
              <input className={`${inputCls} h-11`} placeholder={tr("Autre couleur")} value={customColor} onChange={(e) => setCustomColor(e.target.value)} />
              <Button
                className="h-11"
                disabled={!customColor.trim()}
                onClick={() => { const n = customColor.trim(); if (!colors.some((c) => c.labelFr === n)) setColors([...colors, { labelFr: n, labelAr: n, hex: "#e8b4bc" }]); setCustomColor(""); }}
              >
                {tr("Ajouter")}
              </Button>
            </div>
          </Card>
          <p className="text-sm text-ink-soft">{tr("Sans taille ni couleur ? Passez simplement à l'étape suivante (article unique).")}</p>
        </div>
      )}

      {step === 3 && (
        <Card title={tr("📦 Combien en avez-vous ?")}>
          <div className="mb-3 flex flex-wrap items-end gap-2">
            <p className="flex-1 text-sm text-ink-soft">{tr("Tapez le nombre de pièces pour chaque case. Laissez vide = 0.")}</p>
            <Button size="sm" onClick={() => { const v = prompt(tr("Même quantité dans toutes les cases :")); if (v && /^\d+$/.test(v.trim())) setQty(Object.fromEntries(cells.map((c) => [c.key, v.trim()]))); }}>
              {tr("Même quantité partout")}
            </Button>
          </div>
          <div className="-mx-1 overflow-x-auto px-1" dir="ltr">
            <table className="w-full border-separate border-spacing-1 text-sm">
              {sizes.length > 0 && (
                <thead>
                  <tr>
                    <th />
                    {sizes.map((s) => (
                      <th key={s} className="min-w-14 text-center text-xs font-semibold">{s}</th>
                    ))}
                  </tr>
                </thead>
              )}
              <tbody>
                {(colors.length ? colors : [{ labelFr: "", labelAr: "", hex: "" }]).map((c) => (
                  <tr key={c.labelFr}>
                    {colors.length > 0 && (
                      <th className="whitespace-nowrap pe-1 text-start font-medium">
                        <span className="inline-flex items-center gap-1.5">
                          <span className="size-3.5 rounded-full border border-line" style={{ background: c.hex }} />
                          {c.labelFr}
                        </span>
                      </th>
                    )}
                    {(sizes.length ? sizes : [""]).map((s) => {
                      const key = `${c.labelFr}|${s}`;
                      return (
                        <td key={key}>
                          <input
                            type="text"
                            inputMode="numeric"
                            placeholder="0"
                            aria-label={`${c.labelFr} ${s}`.trim() || tr("Quantité")}
                            value={qty[key] ?? ""}
                            onChange={(e) => setQty({ ...qty, [key]: e.target.value.replace(/[٠-٩]/g, (d) => String(d.charCodeAt(0) - 0x660)).replace(/[^0-9]/g, "") })}
                            className="h-12 w-full min-w-14 rounded-lg border border-line bg-surface text-center text-base font-semibold tabular-nums outline-none focus:border-plum-600 focus:ring-2 focus:ring-plum-600/15"
                          />
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="mt-2 text-sm">
            {tr("Total :")} <b className="tabular-nums">{totalPieces}</b> {tr("pièce(s)")}
          </p>
        </Card>
      )}

      {step === 4 && (
        <Card title={tr("✅ Vérifiez et publiez")}>
          <div className="flex gap-4">
            {previews[0] ? <img src={previews[0]} alt="" className="h-32 w-24 shrink-0 rounded-xl object-cover" /> : <span className="grid h-32 w-24 shrink-0 place-items-center rounded-xl bg-rose-100 text-3xl">👗</span>}
            <dl className="min-w-0 flex-1 space-y-1 text-sm">
              <div><dt className="inline text-ink-soft">{tr("Nom")} : </dt><dd className="inline font-semibold">{info.nameFr}{info.nameAr ? ` · ${info.nameAr}` : ""}</dd></div>
              <div><dt className="inline text-ink-soft">{tr("Prix")} : </dt><dd className="inline font-semibold">{da(info.price)}{info.compareAt ? <s className="ms-2 text-ink-soft">{da(info.compareAt)}</s> : null}</dd></div>
              <div><dt className="inline text-ink-soft">{tr("Catégorie")} : </dt><dd className="inline">{categoryPath(categories.data ?? [], info.categoryId) ?? "—"}</dd></div>
              <div><dt className="inline text-ink-soft">{tr("Tailles")} : </dt><dd className="inline">{sizes.join(", ") || "—"}</dd></div>
              <div><dt className="inline text-ink-soft">{tr("Couleurs")} : </dt><dd className="inline">{colors.map((c) => c.labelFr).join(", ") || "—"}</dd></div>
              <div><dt className="inline text-ink-soft">{tr("Stock")} : </dt><dd className="inline font-semibold">{tr("{0} pièce(s)", { 0: totalPieces })}</dd></div>
              <div><dt className="inline text-ink-soft">{tr("Photos")} : </dt><dd className="inline">{files.length}</dd></div>
            </dl>
          </div>
          {busy ? (
            <p className="mt-5 flex items-center justify-center gap-2 text-sm font-semibold"><Spinner className="size-4" /> {busy}</p>
          ) : (
            <div className="mt-5 grid gap-2 sm:grid-cols-2">
              <Button variant="primary" className="h-12" onClick={() => void finish("published")}>{tr("🌸 Mettre en ligne")}</Button>
              <Button className="h-12" onClick={() => void finish("draft")}>{tr("Enregistrer en brouillon")}</Button>
            </div>
          )}
          <p className="mt-3 text-xs text-ink-soft">{tr("Ensuite, la fiche complète s'ouvre : guide des tailles, référencement, « complétez le look »…")}</p>
        </Card>
      )}

      {/* navigation */}
      {step < 4 && (
        <div className="fixed inset-x-0 bottom-[calc(4rem+env(safe-area-inset-bottom))] z-30 border-t border-line bg-surface/95 p-3 backdrop-blur md:bottom-0 md:ps-[15rem]">
          <div className="mx-auto flex max-w-2xl items-center justify-between gap-3 px-1">
            <Button disabled={step === 0} onClick={() => setStep(step - 1)}>{tr("← Retour")}</Button>
            {step === 1 && !canNext && <span className="text-xs text-ink-soft">{tr("Nom et prix requis")}</span>}
            <Button variant="primary" disabled={!canNext} onClick={() => setStep(step + 1)}>
              {step === 0 && !files.length ? tr("Passer →") : tr("Suivant →")}
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
