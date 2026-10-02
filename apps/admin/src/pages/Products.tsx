import { imageUrl, slugify, type ImageRef } from "@henine/shared";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useNavigate, useParams } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { api, del, errorMessage, post, put, upload } from "../api";
import { da } from "../lib/format";
import { processImage } from "../lib/images";
import { useCan } from "../Shell";
import {
  Badge, Button, Card, Empty, ErrorState, inputCls, ListSkeleton, NumberField, PageHeader, Pills, SearchBox, Select, Spinner, TextArea, TextField, useToast,
} from "../ui";

/* ───────────── List ───────────── */

interface ProductRow {
  id: number;
  slug: string;
  name_fr: string;
  status: string;
  price: number;
  compare_at_price: number | null;
  category: string | null;
  image: string | null;
  variant_count: number;
  available: number;
  sold: number;
  updated_at: number;
}

const STATUS_BADGE: Record<string, [string, string]> = {
  published: ["En ligne", "bg-emerald-100 text-emerald-800"],
  draft: ["Brouillon", "bg-stone-200 text-stone-700"],
  archived: ["Archivé", "bg-stone-200 text-stone-500"],
  scheduled: ["Programmé", "bg-sky-100 text-sky-800"],
};

export function ProductsPage() {
  const can = useCan();
  const [status, setStatus] = useState("all");
  const [q, setQ] = useState("");
  const list = useQuery({ queryKey: ["products", status, q], queryFn: () => api<ProductRow[]>(`/products?status=${status}&q=${encodeURIComponent(q)}`) });
  return (
    <div>
      <PageHeader
        group="Catalogue"
        title="Produits"
        subtitle={list.data ? `${list.data.length} produit(s)` : undefined}
        actions={can("products.edit") && <Link to="/produits/nouveau" className="inline-flex h-11 items-center rounded-lg bg-plum-600 px-5 font-semibold text-ivory">+ Nouveau produit</Link>}
      />
      <Pills
        value={status}
        onChange={setStatus}
        options={[
          { value: "all", label: "Tous" },
          { value: "published", label: "En ligne" },
          { value: "draft", label: "Brouillons" },
          { value: "archived", label: "Archivés" },
        ]}
      />
      <SearchBox value={q} onChange={setQ} placeholder="Nom, SKU…" />
      {list.error ? (
        <ErrorState error={list.error} onRetry={list.refetch} />
      ) : !list.data ? (
        <ListSkeleton />
      ) : list.data.length === 0 ? (
        <Empty title="Aucun produit">Créez votre premier produit avec « Nouveau produit ».</Empty>
      ) : (
        <ul className="grid gap-2 md:grid-cols-2">
          {list.data.map((p) => (
            <li key={p.id}>
              <Link to="/produits/$id" params={{ id: String(p.id) }} className="flex gap-3 rounded-xl border border-line bg-white p-3 transition hover:border-plum-600/40">
                {p.image ? <img src={p.image} alt="" className="h-20 w-16 shrink-0 rounded-lg object-cover" /> : <span className="grid h-20 w-16 shrink-0 place-items-center rounded-lg bg-rose-100 text-2xl">👗</span>}
                <div className="min-w-0 flex-1">
                  <p className="truncate font-semibold">{p.name_fr}</p>
                  <p className="text-sm tabular-nums">
                    {da(p.price)} {p.compare_at_price ? <s className="text-ink-soft">{da(p.compare_at_price)}</s> : null}
                  </p>
                  <div className="mt-1 flex flex-wrap gap-1.5 text-xs">
                    <Badge tone={STATUS_BADGE[p.status]?.[1]}>{STATUS_BADGE[p.status]?.[0] ?? p.status}</Badge>
                    <Badge tone={p.available <= 0 ? "bg-red-100 text-red-800" : p.available <= 5 ? "bg-amber-100 text-amber-800" : "bg-stone-100 text-stone-700"}>
                      Stock {p.available}
                    </Badge>
                    <Badge tone="bg-stone-100 text-stone-700">{p.variant_count} variante(s)</Badge>
                    {p.sold > 0 && <Badge tone="bg-stone-100 text-stone-700">{p.sold} vendu(s)</Badge>}
                  </div>
                </div>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/* ───────────── Editor ───────────── */

interface OptionValue {
  ref: string;
  labelFr: string;
  labelAr: string;
  hex: string | null;
}
interface Option {
  id?: number;
  kind: "taille" | "couleur" | "autre";
  nameFr: string;
  nameAr: string;
  values: OptionValue[];
}
interface Variant {
  id?: number;
  refs: string[];
  sku: string;
  priceOverride: number | null;
  stockOnHand: number;
  stockReserved?: number;
  lowStockThreshold: number;
  isActive: boolean;
}
interface ProductForm {
  id?: number;
  slug: string;
  nameFr: string;
  nameAr: string;
  descriptionFr: string;
  descriptionAr: string;
  status: "draft" | "published" | "archived";
  categoryId: number | null;
  tags: string[];
  price: number | null;
  compareAtPrice: number | null;
  costPrice: number | null;
  seoTitle: string | null;
  seoDescription: string | null;
  instagramUrl: string | null;
  relatedIds: number[];
  sizeGuideId: number | null;
  options: Option[];
  variants: Variant[];
  images?: (ImageRef & { id: number })[];
}

/** Photos chosen on a product that wasn't saved yet: uploaded right after the first save. */
let pendingPhotos: File[] | null = null;

const SIZE_PRESETS = ["S", "M", "L", "XL", "XXL"];
const COLOR_PRESETS: [string, string, string][] = [
  ["Noir", "أسود", "#1f1a1c"], ["Blanc", "أبيض", "#f7f4ef"], ["Rose poudré", "وردي فاتح", "#e8b4bc"], ["Bordeaux", "خمري", "#6d1f33"],
  ["Beige", "بيج", "#d9c3a5"], ["Champagne", "شمبانيا", "#e9d3b0"], ["Bleu ciel", "أزرق سماوي", "#a9c8e8"], ["Émeraude", "زمردي", "#1f6f5c"],
  ["Lavande", "لافندر", "#b9a7d6"], ["Rouge", "أحمر", "#b3261e"],
];
let refCounter = 0;
const newRef = () => `n:${Date.now().toString(36)}${refCounter++}`;

function emptyForm(): ProductForm {
  return {
    slug: "", nameFr: "", nameAr: "", descriptionFr: "", descriptionAr: "", status: "draft", categoryId: null, tags: [],
    price: null, compareAtPrice: null, costPrice: null, seoTitle: null, seoDescription: null, instagramUrl: null, relatedIds: [], sizeGuideId: null,
    options: [
      { kind: "taille", nameFr: "Taille", nameAr: "المقاس", values: [] },
      { kind: "couleur", nameFr: "Couleur", nameAr: "اللون", values: [] },
    ],
    variants: [],
  };
}

/** Every combination of option values (cartesian product), keeping existing variants' data. */
function buildVariants(options: Option[], existing: Variant[]): Variant[] {
  const lists = options.filter((o) => o.values.length).map((o) => o.values.map((v) => v.ref));
  if (!lists.length) return existing.length ? existing.slice(0, 1).map((v) => ({ ...v, refs: [] })) : [{ refs: [], sku: "", priceOverride: null, stockOnHand: 0, lowStockThreshold: 2, isActive: true }];
  const combos = lists.reduce<string[][]>((acc, list) => acc.flatMap((c) => list.map((r) => [...c, r])), [[]]);
  return combos.map((refs) => {
    const key = [...refs].sort().join("|");
    const found = existing.find((v) => [...v.refs].sort().join("|") === key);
    return found ?? { refs, sku: "", priceOverride: null, stockOnHand: 0, lowStockThreshold: 2, isActive: true };
  });
}

export function ProductEditor() {
  const params = useParams({ strict: false }) as { id?: string };
  const isNew = !params.id || params.id === "nouveau";
  const navigate = useNavigate();
  const qc = useQueryClient();
  const toast = useToast();
  const can = useCan();
  const categories = useQuery({ queryKey: ["categories"], queryFn: () => api<{ id: number; name_fr: string }[]>("/categories") });
  const sizeGuides = useQuery({ queryKey: ["size-guides"], queryFn: () => api<{ id: number; name: string }[]>("/size-guides") });
  const loaded = useQuery({ queryKey: ["product", params.id], queryFn: () => api<ProductForm>(`/products/${params.id}`), enabled: !isNew });
  const [form, setForm] = useState<ProductForm | null>(isNew ? emptyForm() : null);
  useEffect(() => {
    if (loaded.data) setForm(loaded.data);
  }, [loaded.data]);
  const [error, setError] = useState<string | null>(null);

  const save = useMutation({
    mutationFn: (f: ProductForm) => {
      const payload = {
        nameFr: f.nameFr, nameAr: f.nameAr, slug: f.slug || undefined, descriptionFr: f.descriptionFr, descriptionAr: f.descriptionAr,
        status: f.status, categoryId: f.categoryId, tags: f.tags, price: f.price ?? 0, compareAtPrice: f.compareAtPrice, costPrice: f.costPrice,
        seoTitle: f.seoTitle || null, seoDescription: f.seoDescription || null, instagramUrl: f.instagramUrl || null, relatedIds: f.relatedIds ?? [],
        sizeGuideId: f.sizeGuideId ?? null,
        options: f.options.filter((o) => o.values.length).map((o) => ({ id: o.id, kind: o.kind, nameFr: o.nameFr, nameAr: o.nameAr, values: o.values })),
        variants: f.variants.map((v) => ({ id: v.id, refs: v.refs, sku: v.sku || undefined, priceOverride: v.priceOverride, stockOnHand: v.stockOnHand, lowStockThreshold: v.lowStockThreshold, isActive: v.isActive })),
      };
      return isNew ? post<ProductForm>("/products", payload) : put<ProductForm>(`/products/${f.id}`, payload);
    },
    onSuccess: (saved) => {
      toast(saved.status === "published" ? "Produit en ligne ✓" : "Brouillon enregistré ✓");
      void qc.invalidateQueries({ queryKey: ["products"] });
      qc.setQueryData(["product", String(saved.id)], saved);
      setForm(saved);
      if (isNew) void navigate({ to: "/produits/$id", params: { id: String(saved.id) } });
    },
    onError: (e) => setError(errorMessage(e)),
  });

  if (!isNew && loaded.error) return <ErrorState error={loaded.error} onRetry={loaded.refetch} />;
  if (!form) return <ListSkeleton rows={6} />;

  const set = <K extends keyof ProductForm>(k: K, v: ProductForm[K]) => setForm((f) => (f ? { ...f, [k]: v } : f));
  const setOptions = (options: Option[]) => setForm((f) => (f ? { ...f, options, variants: buildVariants(options, f.variants) } : f));
  const readOnly = !can("products.edit");

  function submit(status?: ProductForm["status"]) {
    setError(null);
    if (!form) return false;
    const problem =
      form.nameFr.trim().length < 2
        ? "Indiquez le nom du produit."
        : !form.price
          ? "Indiquez le prix."
          : !form.variants.length
            ? "Ajoutez au moins une taille ou une couleur (ou laissez vide pour un article unique)."
            : null;
    if (problem) {
      setError(problem);
      return false;
    }
    const next = status ? { ...form, status } : form;
    if (status) setForm(next);
    save.mutate(next);
    return true;
  }

  return (
    <div className="pb-24">
      <PageHeader
        group="Catalogue › Produits"
        title={isNew ? "Nouveau produit" : form.nameFr}
        subtitle={!isNew && form.status === "published" ? <a href={`/produit/${form.slug}`} target="_blank" rel="noreferrer" className="font-semibold text-plum-600">Voir sur la boutique ↗</a> : undefined}
        actions={!isNew && can("products.edit") && <ProductActions id={form.id!} />}
      />
      <div className="grid gap-4 lg:grid-cols-[1fr_20rem]">
        <div className="space-y-4">
          <Card title="Informations">
            <div className="grid gap-3 sm:grid-cols-2">
              <TextField label="Nom (français)" value={form.nameFr} onChange={(e) => set("nameFr", e.target.value)} disabled={readOnly} />
              <TextField label="الاسم (عربي)" dir="rtl" value={form.nameAr} onChange={(e) => set("nameAr", e.target.value)} disabled={readOnly} />
              <TextArea label="Description (français)" hint="**gras**, - listes" value={form.descriptionFr} onChange={(e) => set("descriptionFr", e.target.value)} rows={5} disabled={readOnly} />
              <TextArea label="الوصف (عربي)" dir="rtl" value={form.descriptionAr} onChange={(e) => set("descriptionAr", e.target.value)} rows={5} disabled={readOnly} />
            </div>
          </Card>

          <Card title="Prix">
            <div className="grid gap-3 sm:grid-cols-3">
              <NumberField label="Prix de vente" suffix="DA" value={form.price} onChange={(v) => set("price", v)} />
              <NumberField label="Prix barré" hint="avant promo" suffix="DA" value={form.compareAtPrice} onChange={(v) => set("compareAtPrice", v)} />
              {can("cost.view") && (
                <NumberField
                  label="Prix d'achat"
                  hint={form.price && form.costPrice ? `marge ${Math.round(((form.price - form.costPrice) / form.price) * 100)} %` : "privé"}
                  suffix="DA"
                  value={form.costPrice}
                  onChange={(v) => set("costPrice", v)}
                />
              )}
            </div>
          </Card>

          <OptionsEditor options={form.options} onChange={setOptions} disabled={readOnly} />
          <VariantsTable form={form} onChange={(variants) => set("variants", variants)} disabled={readOnly} />
          {!isNew ? <ImagesEditor productId={form.id!} images={form.images ?? []} options={form.options} onChange={(images) => set("images", images)} /> : (
            <Card title="Photos">
              <label className="flex cursor-pointer flex-col items-center justify-center gap-1 rounded-xl border-2 border-dashed border-line bg-white p-6 text-center text-sm text-ink-soft hover:border-plum-600">
                <span className="text-2xl">＋</span>
                Ajouter des photos
                <span className="text-xs">Le produit est d'abord enregistré en brouillon, puis les photos sont envoyées.</span>
                <input
                  type="file"
                  accept="image/*"
                  multiple
                  className="sr-only"
                  disabled={readOnly || save.isPending}
                  onChange={(e) => {
                    const files = e.target.files ? [...e.target.files] : [];
                    e.target.value = "";
                    if (!files.length) return;
                    pendingPhotos = files;
                    if (!submit()) pendingPhotos = null;
                  }}
                />
              </label>
            </Card>
          )}
          {!readOnly && <RelatedPicker productId={form.id} ids={form.relatedIds ?? []} onChange={(ids) => set("relatedIds", ids)} />}
        </div>

        <div className="space-y-4">
          <Card title="Publication">
            <Select label="Statut" value={form.status} onChange={(e) => set("status", e.target.value as ProductForm["status"])} disabled={readOnly}>
              <option value="draft">Brouillon (invisible)</option>
              <option value="published">En ligne</option>
              <option value="archived">Archivé</option>
            </Select>
            <Select label="Catégorie" className="mt-3" value={form.categoryId ?? ""} onChange={(e) => set("categoryId", e.target.value ? Number(e.target.value) : null)} disabled={readOnly}>
              <option value="">—</option>
              {categories.data?.map((c) => <option key={c.id} value={c.id}>{c.name_fr}</option>)}
            </Select>
            <Select label="📏 Guide des tailles" className="mt-3" value={form.sizeGuideId ?? ""} onChange={(e) => set("sizeGuideId", e.target.value ? Number(e.target.value) : null)} disabled={readOnly}>
              <option value="">Aucun</option>
              {sizeGuides.data?.map((g) => <option key={g.id} value={g.id}>{g.name}</option>)}
            </Select>
            <p className="mt-1 text-xs text-ink-soft">
              Affiché à côté des tailles sur la fiche produit. <Link to="/contenu" search={{ tab: "tailles" }} className="font-semibold text-plum-600">Créer / modifier les guides</Link>
            </p>
            <div className="mt-3 space-y-1.5">
              <p className="text-sm font-medium">Étiquettes</p>
              {[["nouveaute", "Nouveauté"], ["best-seller", "Coup de cœur"], ["promo", "Promo"]].map(([tag, label]) => (
                <label key={tag} className="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    className="size-4 accent-plum-600"
                    checked={form.tags.includes(tag!)}
                    disabled={readOnly}
                    onChange={(e) => set("tags", e.target.checked ? [...form.tags, tag!] : form.tags.filter((t) => t !== tag))}
                  />
                  {label}
                </label>
              ))}
            </div>
          </Card>
          <Card title="Référencement">
            <TextField label="Adresse (slug)" hint={`/produit/${form.slug || slugify(form.nameFr) || "…"}`} value={form.slug} placeholder={slugify(form.nameFr)} onChange={(e) => set("slug", e.target.value)} disabled={readOnly} />
            <TextField label="Titre Google" className="mt-3" value={form.seoTitle ?? ""} onChange={(e) => set("seoTitle", e.target.value)} maxLength={120} disabled={readOnly} />
            <TextArea label="Description Google / WhatsApp" className="mt-3" rows={3} value={form.seoDescription ?? ""} onChange={(e) => set("seoDescription", e.target.value)} maxLength={300} disabled={readOnly} />
            <TextField label="Lien de la publication Instagram" className="mt-3" value={form.instagramUrl ?? ""} onChange={(e) => set("instagramUrl", e.target.value)} disabled={readOnly} />
          </Card>
        </div>
      </div>

      {!readOnly && (
        <div className="fixed inset-x-0 bottom-[calc(4rem+env(safe-area-inset-bottom))] z-30 border-t border-line bg-ivory/95 p-3 backdrop-blur md:bottom-0 md:ps-[15rem]">
          <div className="mx-auto flex max-w-6xl items-center justify-between gap-3 px-1 md:px-8">
            <p className="min-w-0 truncate text-sm text-red-700">{error}</p>
            <div className="flex shrink-0 gap-2">
              {form.status === "published" ? (
                <>
                  <Button loading={save.isPending && save.variables?.status === "draft"} onClick={() => confirm("Retirer ce produit de la boutique ?") && submit("draft")}>
                    Mettre hors ligne
                  </Button>
                  <Button variant="primary" loading={save.isPending && save.variables?.status === "published"} onClick={() => submit()}>
                    Enregistrer
                  </Button>
                </>
              ) : (
                <>
                  <Button loading={save.isPending && save.variables?.status !== "published"} onClick={() => submit(form.status === "archived" ? "archived" : "draft")}>
                    {form.status === "archived" ? "Enregistrer" : "Enregistrer le brouillon"}
                  </Button>
                  <Button variant="primary" loading={save.isPending && save.variables?.status === "published"} onClick={() => submit("published")}>
                    Publier
                  </Button>
                </>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function ProductActions({ id }: { id: number }) {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const toast = useToast();
  const dup = useMutation({
    mutationFn: () => post<{ id: number }>(`/products/${id}/duplicate`),
    onSuccess: (r) => {
      toast("Copie créée (brouillon)");
      void qc.invalidateQueries({ queryKey: ["products"] });
      void navigate({ to: "/produits/$id", params: { id: String(r.id) } });
    },
  });
  const remove = useMutation({
    mutationFn: () => del<{ archived?: boolean }>(`/products/${id}`),
    onSuccess: (r) => {
      toast(r.archived ? "Produit archivé (il a déjà été commandé)" : "Produit supprimé");
      void qc.invalidateQueries({ queryKey: ["products"] });
      void navigate({ to: "/produits" });
    },
  });
  return (
    <>
      <Button size="sm" onClick={() => dup.mutate()} loading={dup.isPending}>Dupliquer</Button>
      <Button size="sm" variant="danger" onClick={() => confirm("Supprimer ce produit ? (archivé s'il a déjà des commandes)") && remove.mutate()} loading={remove.isPending}>
        Supprimer
      </Button>
    </>
  );
}

function OptionsEditor({ options, onChange, disabled }: { options: Option[]; onChange: (o: Option[]) => void; disabled: boolean }) {
  const [draft, setDraft] = useState<Record<number, string>>({});
  const update = (i: number, o: Option) => onChange(options.map((x, k) => (k === i ? o : x)));
  const addValue = (i: number, labelFr: string, labelAr = "", hex: string | null = null) => {
    const o = options[i]!;
    if (!labelFr.trim() || o.values.some((v) => v.labelFr.toLowerCase() === labelFr.trim().toLowerCase())) return;
    update(i, { ...o, values: [...o.values, { ref: newRef(), labelFr: labelFr.trim(), labelAr: labelAr || labelFr.trim(), hex: o.kind === "couleur" ? hex ?? "#e8b4bc" : null }] });
  };
  return (
    <Card title="Tailles & couleurs" actions={<span className="text-xs text-ink-soft">Les variantes sont créées automatiquement</span>}>
      <div className="space-y-5">
        {options.map((o, i) => (
          <div key={i}>
            <p className="mb-2 text-sm font-medium">{o.nameFr}</p>
            <div className="flex flex-wrap gap-2">
              {o.values.map((v) => (
                <span key={v.ref} className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-line bg-white ps-2 pe-1 text-sm">
                  {o.kind === "couleur" && (
                    <input
                      type="color"
                      value={v.hex ?? "#e8b4bc"}
                      disabled={disabled}
                      onChange={(e) => update(i, { ...o, values: o.values.map((x) => (x.ref === v.ref ? { ...x, hex: e.target.value } : x)) })}
                      className="size-6 cursor-pointer rounded-full border-0 bg-transparent p-0"
                      aria-label={`Couleur ${v.labelFr}`}
                    />
                  )}
                  {v.labelFr}
                  {!disabled && (
                    <button type="button" aria-label={`Retirer ${v.labelFr}`} onClick={() => update(i, { ...o, values: o.values.filter((x) => x.ref !== v.ref) })} className="grid size-7 place-items-center rounded-full text-ink-soft hover:bg-rose-100">
                      ×
                    </button>
                  )}
                </span>
              ))}
            </div>
            {!disabled && (
              <>
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {(o.kind === "taille" ? SIZE_PRESETS.map((s) => [s, s, null] as const) : COLOR_PRESETS)
                    .filter(([fr]) => !o.values.some((v) => v.labelFr === fr))
                    .map(([fr, ar, hex]) => (
                      <button key={fr} type="button" onClick={() => addValue(i, fr, ar, hex)} className="h-8 rounded-lg border border-dashed border-line px-3 text-xs text-ink-soft hover:border-plum-600">
                        + {fr}
                      </button>
                    ))}
                </div>
                <div className="mt-2 flex gap-2">
                  <input
                    className={`${inputCls} h-10`}
                    placeholder={o.kind === "taille" ? "Autre taille (ex : 38, Unique)" : "Autre couleur"}
                    value={draft[i] ?? ""}
                    onChange={(e) => setDraft((d) => ({ ...d, [i]: e.target.value }))}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") {
                        e.preventDefault();
                        addValue(i, draft[i] ?? "");
                        setDraft((d) => ({ ...d, [i]: "" }));
                      }
                    }}
                  />
                  <Button size="sm" className="h-10" onClick={() => { addValue(i, draft[i] ?? ""); setDraft((d) => ({ ...d, [i]: "" })); }}>Ajouter</Button>
                </div>
              </>
            )}
          </div>
        ))}
      </div>
    </Card>
  );
}

/** Hand-picked "Complétez le look" products (otherwise: bought together, then same category). */
function RelatedPicker({ productId, ids, onChange }: { productId?: number; ids: number[]; onChange: (ids: number[]) => void }) {
  const [q, setQ] = useState("");
  const products = useQuery({ queryKey: ["products", "published", ""], queryFn: () => api<ProductRow[]>("/products?status=published&q=") });
  const byId = new Map((products.data ?? []).map((p) => [p.id, p]));
  const matches = q ? (products.data ?? []).filter((p) => p.id !== productId && !ids.includes(p.id) && p.name_fr.toLowerCase().includes(q.toLowerCase())).slice(0, 8) : [];
  return (
    <Card title="Complétez le look" actions={<span className="text-xs text-ink-soft">facultatif</span>}>
      <p className="mb-3 text-sm text-ink-soft">
        Choisissez les pièces à proposer avec celle-ci (ex : une robe → la lingerie assortie). Sans choix, la boutique montre les articles achetés ensemble, puis ceux de la même catégorie.
      </p>
      {ids.length > 0 && (
        <ul className="mb-3 flex flex-wrap gap-2">
          {ids.map((id) => (
            <li key={id} className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-line bg-white ps-1 pe-1 text-sm">
              {byId.get(id)?.image ? <img src={byId.get(id)!.image!} alt="" className="size-7 rounded-full object-cover" /> : <span className="grid size-7 place-items-center rounded-full bg-rose-100 text-xs">👗</span>}
              {byId.get(id)?.name_fr ?? `#${id}`}
              <button type="button" onClick={() => onChange(ids.filter((x) => x !== id))} className="grid size-7 place-items-center rounded-full text-ink-soft hover:bg-rose-100" aria-label="Retirer">
                ×
              </button>
            </li>
          ))}
        </ul>
      )}
      {ids.length < 8 && (
        <>
          <input className={inputCls} placeholder="Ajouter une pièce : tapez son nom…" value={q} onChange={(e) => setQ(e.target.value)} />
          <ul className="mt-2 grid gap-1.5 sm:grid-cols-2">
            {matches.map((p) => (
              <li key={p.id}>
                <button type="button" onClick={() => { onChange([...ids, p.id]); setQ(""); }} className="flex w-full items-center gap-2 rounded-xl border border-dashed border-line px-2 py-1.5 text-start text-sm hover:border-plum-600">
                  {p.image ? <img src={p.image} alt="" className="h-9 w-7 rounded object-cover" /> : <span className="grid h-9 w-7 place-items-center rounded bg-rose-100 text-xs">👗</span>}
                  <span className="truncate">+ {p.name_fr}</span>
                </button>
              </li>
            ))}
          </ul>
        </>
      )}
    </Card>
  );
}

/**
 * Colour × size grid (the way the team counts stock), used when a product has exactly
 * one colour option and one size option. Each cell is one variant's stock.
 */
function StockGrid({ form, onChange, disabled }: { form: ProductForm; onChange: (v: Variant[]) => void; disabled: boolean }) {
  const colors = form.options.find((o) => o.kind === "couleur")!.values;
  const sizes = form.options.find((o) => o.kind === "taille")!.values;
  const cell = (c: string, s: string) => form.variants.findIndex((v) => v.refs.includes(c) && v.refs.includes(s));
  const setStock = (i: number, n: number) => onChange(form.variants.map((v, k) => (k === i ? { ...v, stockOnHand: Math.max(n, v.stockReserved ?? 0) } : v)));
  const rowTotal = (c: string) => form.variants.filter((v) => v.isActive && v.refs.includes(c)).reduce((s, v) => s + v.stockOnHand, 0);
  return (
    <div className="-mx-1 overflow-x-auto px-1">
      <table className="w-full border-separate border-spacing-1 text-sm">
        <thead>
          <tr>
            <th className="text-start text-xs font-medium text-ink-soft">Couleur \ Taille</th>
            {sizes.map((s) => <th key={s.ref} className="min-w-14 text-center text-xs font-semibold">{s.labelFr}</th>)}
            <th className="text-center text-xs font-medium text-ink-soft">Total</th>
          </tr>
        </thead>
        <tbody>
          {colors.map((c) => (
            <tr key={c.ref}>
              <th className="whitespace-nowrap pe-2 text-start font-medium">
                <span className="inline-flex items-center gap-1.5">
                  <span className="size-3.5 rounded-full border border-line" style={{ background: c.hex ?? "#eee" }} />
                  {c.labelFr}
                </span>
              </th>
              {sizes.map((s) => {
                const i = cell(c.ref, s.ref);
                const v = form.variants[i];
                if (!v) return <td key={s.ref} />;
                return (
                  <td key={s.ref}>
                    <input
                      type="number"
                      inputMode="numeric"
                      min={v.stockReserved ?? 0}
                      disabled={disabled || !v.isActive}
                      aria-label={`Stock ${c.labelFr} ${s.labelFr}`}
                      title={v.stockReserved ? `${v.stockReserved} réservé(s) par des commandes` : undefined}
                      className={`h-11 w-full min-w-14 rounded-lg border text-center tabular-nums outline-none focus:border-plum-600 ${
                        !v.isActive ? "border-line bg-stone-100 text-ink-soft" : v.stockOnHand - (v.stockReserved ?? 0) <= 0 ? "border-red-200 bg-red-50" : v.stockOnHand - (v.stockReserved ?? 0) <= v.lowStockThreshold ? "border-amber-200 bg-amber-50" : "border-line bg-white"
                      }`}
                      value={v.stockOnHand}
                      onChange={(e) => setStock(i, Math.round(Number(e.target.value) || 0))}
                    />
                  </td>
                );
              })}
              <td className="text-center font-semibold tabular-nums">{rowTotal(c.ref)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="mt-1 text-xs text-ink-soft">Rouge = épuisé, orange = stock bas. Les quantités réservées par des commandes en cours ne peuvent pas être retirées.</p>
    </div>
  );
}

function VariantsTable({ form, onChange, disabled }: { form: ProductForm; onChange: (v: Variant[]) => void; disabled: boolean }) {
  const label = useMemo(() => {
    const map = new Map(form.options.flatMap((o) => o.values.map((v) => [v.ref, v] as const)));
    return (refs: string[]) => refs.map((r) => map.get(r)?.labelFr ?? "?").join(" / ") || "Article unique";
  }, [form.options]);
  const colorOf = (refs: string[]) => form.options.find((o) => o.kind === "couleur")?.values.find((v) => refs.includes(v.ref))?.hex;
  const [bulk, setBulk] = useState<number | null>(null);
  const total = form.variants.reduce((s, v) => s + (v.isActive ? v.stockOnHand : 0), 0);
  const update = (i: number, patch: Partial<Variant>) => onChange(form.variants.map((v, k) => (k === i ? { ...v, ...patch } : v)));
  const gridable =
    form.options.filter((o) => o.values.length).length === 2 &&
    !!form.options.find((o) => o.kind === "couleur" && o.values.length) &&
    !!form.options.find((o) => o.kind === "taille" && o.values.length);
  const [view, setView] = useState<"grid" | "list">("grid");

  return (
    <Card
      title={`Variantes & stock (${form.variants.length})`}
      actions={
        <span className="flex items-center gap-3 text-sm text-ink-soft">
          {gridable && (
            <span className="inline-flex rounded-full border border-line p-0.5 text-xs">
              {(["grid", "list"] as const).map((k) => (
                <button key={k} type="button" onClick={() => setView(k)} className={`rounded-full px-2.5 py-1 font-semibold ${view === k ? "bg-plum-600 text-ivory" : ""}`}>
                  {k === "grid" ? "Tableau" : "Liste"}
                </button>
              ))}
            </span>
          )}
          <span>Total : <b className="text-ink">{total}</b></span>
        </span>
      }
    >
      {gridable && view === "grid" ? (
        <>
          <StockGrid form={form} onChange={onChange} disabled={disabled} />
          {!disabled && <p className="mt-2 text-xs text-ink-soft">Prix spécifique ou désactivation d'une variante : vue « Liste ».</p>}
        </>
      ) : (
      <>
      {!disabled && form.variants.length > 1 && (
        <div className="mb-3 flex items-end gap-2">
          <NumberField label="Mettre le même stock partout" value={bulk} onChange={setBulk} className="flex-1" />
          <Button onClick={() => bulk != null && onChange(form.variants.map((v) => ({ ...v, stockOnHand: Math.max(bulk, v.stockReserved ?? 0) })))}>Appliquer</Button>
        </div>
      )}
      <ul className="divide-y divide-line">
        {form.variants.map((v, i) => (
          <li key={v.refs.join("|") || "single"} className={`grid grid-cols-2 items-end gap-x-3 gap-y-2 py-3 sm:grid-cols-[1fr_7rem_7rem_auto] sm:items-center ${v.isActive ? "" : "opacity-50"}`}>
            <span className="col-span-2 flex min-w-0 items-center gap-2 sm:col-span-1">
              {colorOf(v.refs) && <span className="size-4 shrink-0 rounded-full border border-line" style={{ background: colorOf(v.refs)! }} />}
              <span className="min-w-0">
                <span className="block truncate text-sm font-medium">{label(v.refs)}</span>
                <span className="block truncate text-xs text-ink-soft">{v.sku || "SKU automatique"}{v.stockReserved ? ` · ${v.stockReserved} réservé(s)` : ""}</span>
              </span>
            </span>
            <label className="text-xs text-ink-soft">
              Stock
              <input
                type="number"
                inputMode="numeric"
                min={v.stockReserved ?? 0}
                disabled={disabled}
                className={`${inputCls} h-10 text-center`}
                value={v.stockOnHand}
                onChange={(e) => update(i, { stockOnHand: Math.max(0, Math.round(Number(e.target.value) || 0)) })}
              />
            </label>
            <label className="text-xs text-ink-soft">
              Prix spécifique
              <input
                type="number"
                inputMode="numeric"
                disabled={disabled}
                className={`${inputCls} h-10`}
                placeholder={form.price ? String(form.price) : "—"}
                value={v.priceOverride ?? ""}
                onChange={(e) => update(i, { priceOverride: e.target.value ? Math.round(Number(e.target.value)) : null })}
              />
            </label>
            <label className="col-span-2 flex items-center gap-1.5 text-xs sm:col-span-1 sm:justify-self-end">
              <input type="checkbox" className="size-4 accent-plum-600" checked={v.isActive} disabled={disabled} onChange={(e) => update(i, { isActive: e.target.checked })} />
              Active
            </label>
          </li>
        ))}
      </ul>
      </>
      )}
    </Card>
  );
}


function ImagesEditor({ productId, images, options, onChange }: { productId: number; images: (ImageRef & { id: number })[]; options: Option[]; onChange: (i: (ImageRef & { id: number })[]) => void }) {
  const toast = useToast();
  const qc = useQueryClient();
  const [busy, setBusy] = useState<string | null>(null);
  const colors = options.find((o) => o.kind === "couleur")?.values ?? [];
  const colorIdOf = (ref: string) => (ref.startsWith("v:") ? Number(ref.slice(2)) : null);

  // photos picked before the product's first save
  useEffect(() => {
    if (!pendingPhotos) return;
    const files = pendingPhotos;
    pendingPhotos = null;
    void handleFiles(files);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  async function handleFiles(list: FileList | File[] | null) {
    if (!list?.length) return;
    let current = images;
    for (const [n, file] of [...list].entries()) {
      setBusy(`Photo ${n + 1}/${list.length} : optimisation…`);
      try {
        const img = await processImage(file);
        const form = new FormData();
        for (const [w, blob] of Object.entries(img.files)) form.append(`w${w}`, blob, `${w}.${img.format}`);
        form.append("width", String(img.width));
        form.append("height", String(img.height));
        form.append("lqip", img.lqip);
        setBusy(`Photo ${n + 1}/${list.length} : envoi…`);
        const saved = await upload<ImageRef & { id: number }>(`/products/${productId}/images`, form);
        current = [...current, saved];
        onChange(current);
      } catch (e) {
        toast(e instanceof Error && e.message === "not_an_image" ? "Ce fichier n'est pas une image." : errorMessage(e), "error");
      }
    }
    setBusy(null);
    void qc.invalidateQueries({ queryKey: ["products"] });
  }

  async function persist(next: (ImageRef & { id: number })[]) {
    onChange(next);
    await put(`/products/${productId}/images`, next.map((i) => ({ id: i.id, optionValueId: i.optionValueId, altFr: i.altFr, altAr: i.altAr }))).catch((e) => toast(errorMessage(e), "error"));
  }

  return (
    <Card title={`Photos (${images.length})`} actions={busy && <span className="flex items-center gap-2 text-xs text-ink-soft"><Spinner className="size-3.5" />{busy}</span>}>
      <ul className="grid grid-cols-3 gap-2 sm:grid-cols-4">
        {images.map((img, i) => (
          <li key={img.id} className="group relative">
            <img src={imageUrl(img, 480)} alt="" className="aspect-[4/5] w-full rounded-xl object-cover" style={img.lqip ? { backgroundImage: `url(${img.lqip})`, backgroundSize: "cover" } : undefined} />
            {i === 0 && <span className="absolute start-1.5 top-1.5 rounded-full bg-ink/75 px-2 py-0.5 text-[10px] font-semibold text-ivory">Principale</span>}
            <div className="mt-1 flex items-center justify-between gap-1">
              <button type="button" disabled={i === 0} className="grid size-8 place-items-center rounded-full border border-line bg-white text-sm disabled:opacity-30" aria-label="Avancer" onClick={() => { const n = [...images]; [n[i - 1], n[i]] = [n[i]!, n[i - 1]!]; void persist(n); }}>
                ←
              </button>
              {colors.length > 0 && (
                <select
                  className="h-8 min-w-0 flex-1 rounded-lg border border-line bg-white px-1 text-xs"
                  value={img.optionValueId ?? ""}
                  aria-label="Couleur de la photo"
                  onChange={(e) => void persist(images.map((x) => (x.id === img.id ? { ...x, optionValueId: e.target.value ? Number(e.target.value) : null } : x)))}
                >
                  <option value="">Toutes</option>
                  {colors.map((c) => colorIdOf(c.ref) && <option key={c.ref} value={colorIdOf(c.ref)!}>{c.labelFr}</option>)}
                </select>
              )}
              <button
                type="button"
                className="grid size-8 place-items-center rounded-full border border-red-200 bg-white text-sm text-red-700"
                aria-label="Supprimer la photo"
                onClick={async () => {
                  if (!confirm("Supprimer cette photo ?")) return;
                  await del(`/images/${img.id}`).catch((e) => toast(errorMessage(e), "error"));
                  onChange(images.filter((x) => x.id !== img.id));
                }}
              >
                🗑
              </button>
            </div>
          </li>
        ))}
        <li>
          <label className="flex aspect-[4/5] cursor-pointer flex-col items-center justify-center gap-1 rounded-xl border-2 border-dashed border-line bg-white text-center text-xs text-ink-soft hover:border-plum-600">
            <span className="text-2xl">＋</span>
            Ajouter des photos
            <input type="file" accept="image/*" multiple className="sr-only" onChange={(e) => { void handleFiles(e.target.files); e.target.value = ""; }} disabled={!!busy} />
          </label>
        </li>
      </ul>
      <p className="mt-3 text-xs text-ink-soft">Les photos sont redimensionnées et compressées sur votre téléphone (et leur localisation GPS est supprimée) avant l'envoi.</p>
      {colors.some((c) => !colorIdOf(c.ref)) && <p className="mt-1 text-xs text-amber-700">Enregistrez le produit pour associer les photos aux nouvelles couleurs.</p>}
    </Card>
  );
}

