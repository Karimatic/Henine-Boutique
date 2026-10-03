import {
  COLOR_PRESETS,
  contrastRatio,
  DEFAULT_DESIGN,
  FONT_PRESETS,
  fontStylesheet,
  HOME_SECTION_LABEL,
  isHexColor,
  resolveSections,
  type BannerDTO,
  type DesignDTO,
  type FontPreset,
} from "@henine/shared";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import { api, errorMessage, put, upload } from "../api";
import { tr } from "../i18n";
import { processImage } from "../lib/images";
import { ProductPicker } from "../lib/pickers";
import { Button, Card, ErrorState, inputCls, ListSkeleton, TextArea, TextField, useToast } from "../ui";

/** Picture made in the browser (WebP, ≤ 1440 px), then stored; returns its key. */
async function uploadDesignImage(file: File): Promise<{ key: string; url: string }> {
  const img = await processImage(file);
  const widths = Object.keys(img.files).map(Number).sort((a, b) => b - a);
  const blob = img.files[widths[0]!]!;
  const form = new FormData();
  form.append("image", blob, `image.${img.format}`);
  return upload<{ key: string; url: string }>("/design/image", form);
}

function ImageBox({ label, hint, url, onPick, onRemove, wide = false }: { label: string; hint: string; url: string | null; onPick: (f: File) => Promise<void>; onRemove: () => void; wide?: boolean }) {
  const [busy, setBusy] = useState(false);
  const toast = useToast();
  return (
    <div>
      <p className="text-sm font-medium">{label}</p>
      <p className="mb-2 text-xs text-ink-soft">{hint}</p>
      <div className="flex flex-wrap items-center gap-3">
        <div className={`grid shrink-0 place-items-center overflow-hidden rounded-xl border border-dashed border-line bg-ivory-deep ${wide ? "h-24 w-40" : "size-24"}`}>
          {url ? <img src={url} alt="" className="size-full object-contain" /> : <span className="text-2xl text-ink-soft">🖼️</span>}
        </div>
        <div className="flex flex-col gap-2">
          <label className="inline-flex h-9 cursor-pointer items-center rounded-lg bg-plum-600 px-3.5 text-sm font-semibold text-white">
            {busy ? tr("Envoi…") : url ? tr("Changer") : tr("Choisir une image")}
            <input
              type="file"
              accept="image/*"
              className="sr-only"
              disabled={busy}
              onChange={async (e) => {
                const f = e.target.files?.[0];
                e.target.value = "";
                if (!f) return;
                setBusy(true);
                try {
                  await onPick(f);
                } catch (err) {
                  toast(errorMessage(err), "error");
                } finally {
                  setBusy(false);
                }
              }}
            />
          </label>
          {url && (
            <button type="button" onClick={onRemove} className="h-9 rounded-lg border border-line px-3.5 text-sm font-semibold text-ink-soft">
              {tr("Retirer")}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

/**
 * Apparence de la boutique, without touching code: logo, colours, fonts, the big home photo,
 * banners, hand-picked products, footer note, and the order of the home page sections.
 * One "Enregistrer" for everything; the store follows within a minute.
 */
export function DesignEditor() {
  const qc = useQueryClient();
  const toast = useToast();
  const q = useQuery({ queryKey: ["design"], queryFn: () => api<{ design: DesignDTO; mediaBase: string }>("/design") });
  const [d, setD] = useState<DesignDTO | null>(null);
  useEffect(() => {
    if (q.data) setD({ ...DEFAULT_DESIGN, ...q.data.design, sections: resolveSections(q.data.design.sections) });
  }, [q.data]);
  const save = useMutation({
    mutationFn: (v: DesignDTO) => put("/design", v),
    onSuccess: () => {
      toast(tr("Apparence enregistrée ✓ La boutique est à jour."));
      void qc.invalidateQueries({ queryKey: ["design"] });
    },
    onError: (e) => toast(errorMessage(e), "error"),
  });
  // font previews
  useEffect(() => {
    for (const key of Object.keys(FONT_PRESETS) as FontPreset[]) {
      const href = fontStylesheet(key);
      if (!href || document.querySelector(`link[data-font="${key}"]`)) continue;
      document.head.appendChild(Object.assign(document.createElement("link"), { rel: "stylesheet", href, dataset: { font: key } }));
    }
  }, []);

  if (q.error) return <ErrorState error={q.error} onRetry={q.refetch} />;
  if (!q.data || !d) return <ListSkeleton />;
  const media = (key: string | null) => (key ? (/^(https?:)?\//.test(key) ? key : q.data.mediaBase + key) : null);
  const set = (patch: Partial<DesignDTO>) => setD({ ...d, ...patch });
  const contrast = isHexColor(d.colors.accent) ? contrastRatio(d.colors.accent, "#ffffff") : 0;
  const colorOk = contrast >= 4.5 && isHexColor(d.colors.soft);
  const dirty = JSON.stringify(d) !== JSON.stringify({ ...DEFAULT_DESIGN, ...q.data.design, sections: resolveSections(q.data.design.sections) });

  return (
    <div className="space-y-4">
      <Card title={tr("🎨 Logo, couleurs et polices")}>
        <div className="grid gap-6 md:grid-cols-2">
          <ImageBox
            label={tr("Logo")}
            hint={tr("Remplace le nom écrit en haut de la boutique. PNG/JPG, fond transparent ou blanc.")}
            url={media(d.logo)}
            onPick={async (f) => set({ logo: (await uploadDesignImage(f)).key })}
            onRemove={() => set({ logo: null })}
            wide
          />
          <ImageBox
            label={tr("Grande photo de l'accueil")}
            hint={tr("La photo en haut de la page d'accueil. Vide = la photo actuelle.")}
            url={media(d.heroImage)}
            onPick={async (f) => set({ heroImage: (await uploadDesignImage(f)).key })}
            onRemove={() => set({ heroImage: null })}
            wide
          />
        </div>

        <div className="mt-6">
          <p className="text-sm font-medium">{tr("Couleurs")}</p>
          <p className="mb-2 text-xs text-ink-soft">{tr("La couleur principale (boutons, prix, liens) et la couleur douce (fonds roses).")}</p>
          <div className="flex flex-wrap gap-2">
            {COLOR_PRESETS.map((c) => {
              const on = c.accent === d.colors.accent && c.soft === d.colors.soft;
              return (
                <button
                  key={c.key}
                  type="button"
                  onClick={() => set({ colors: { accent: c.accent, soft: c.soft } })}
                  aria-pressed={on}
                  className={`flex items-center gap-2 rounded-xl border px-3 py-2 text-sm font-medium ${on ? "border-ink ring-2 ring-ink/10" : "border-line bg-surface"}`}
                >
                  <span className="flex -space-x-1.5" aria-hidden="true">
                    <span className="size-5 rounded-full border-2 border-white" style={{ background: c.accent }} />
                    <span className="size-5 rounded-full border-2 border-white" style={{ background: c.soft }} />
                  </span>
                  {tr(c.label)}
                </button>
              );
            })}
          </div>
          <div className="mt-3 flex flex-wrap items-end gap-4">
            {(["accent", "soft"] as const).map((k) => (
              <label key={k} className="flex items-center gap-2 text-sm">
                <input type="color" value={isHexColor(d.colors[k]) ? d.colors[k] : "#000000"} onChange={(e) => set({ colors: { ...d.colors, [k]: e.target.value } })} className="size-10 cursor-pointer rounded-lg border border-line bg-surface p-0.5" />
                {k === "accent" ? tr("Principale") : tr("Douce")}
                <code className="text-xs text-ink-soft">{d.colors[k]}</code>
              </label>
            ))}
            {/* live preview: a button and a price as customers will see them */}
            <span className="flex items-center gap-2 rounded-xl p-2" style={{ background: d.colors.soft }}>
              <span className="rounded-full px-4 py-2 text-sm font-semibold text-white" style={{ background: d.colors.accent }}>{tr("Commander")}</span>
              <b style={{ color: d.colors.accent }}>2 500 DA</b>
            </span>
          </div>
          {!colorOk && (
            <p className="mt-2 text-sm font-medium text-danger">
              {tr("Couleur principale trop claire : le texte blanc des boutons serait illisible (contraste {0}:1, il faut au moins 4.5:1). Choisissez une teinte plus foncée.", { 0: contrast.toFixed(1) })}
            </p>
          )}
        </div>

        <div className="mt-6">
          <p className="mb-2 text-sm font-medium">{tr("Polices")}</p>
          <div className="grid gap-2 sm:grid-cols-2">
            {(Object.keys(FONT_PRESETS) as FontPreset[]).map((key) => {
              const f = FONT_PRESETS[key];
              const on = d.font === key;
              return (
                <button
                  key={key}
                  type="button"
                  onClick={() => set({ font: key })}
                  aria-pressed={on}
                  className={`rounded-xl border p-3 text-start ${on ? "border-ink ring-2 ring-ink/10" : "border-line bg-surface"}`}
                >
                  <span className="block text-xs font-semibold text-ink-soft">{tr(f.label)}</span>
                  <span className="mt-1 block text-2xl italic" style={{ fontFamily: f.display ? `"${f.display}", serif` : '"Playfair Display", Georgia, serif' }}>
                    Henine Boutique
                  </span>
                  <span className="block text-lg" dir="rtl" style={{ fontFamily: f.arabicDisplay ? `"${f.arabicDisplay}", serif` : '"El Messiri", serif' }}>
                    الأناقة والجودة بأفضل سعر
                  </span>
                </button>
              );
            })}
          </div>
        </div>
      </Card>

      <SectionsCard d={d} set={set} />

      <BannersCard d={d} set={set} media={media} />

      <Card title={tr("⭐ Produits mis en avant")}>
        <p className="mb-3 text-sm text-ink-soft">{tr("Une rangée de produits choisis à la main sur l'accueil (section « Produits mis en avant »).")}</p>
        <div className="mb-3 grid gap-3 sm:grid-cols-2">
          <TextField label={tr("Titre (français)")} value={d.featured.titleFr} onChange={(e) => set({ featured: { ...d.featured, titleFr: e.target.value } })} maxLength={60} />
          <TextField label={tr("Titre (arabe)")} dir="rtl" value={d.featured.titleAr} onChange={(e) => set({ featured: { ...d.featured, titleAr: e.target.value } })} maxLength={60} />
        </div>
        <ProductPicker value={d.featured.productIds} onChange={(ids) => set({ featured: { ...d.featured, productIds: ids } })} max={24} />
      </Card>

      <Card title={tr("📝 Pied de page")}>
        <p className="mb-3 text-sm text-ink-soft">{tr("Un petit texte en bas de chaque page (horaires, adresse, message…). Les liens Instagram, TikTok, Facebook et WhatsApp se règlent dans Paramètres → Contact & réseaux.")}</p>
        <div className="grid gap-3 sm:grid-cols-2">
          <TextArea label={tr("Texte (français)")} rows={3} value={d.footerFr} onChange={(e) => set({ footerFr: e.target.value })} maxLength={300} />
          <TextArea label={tr("Texte (arabe)")} rows={3} dir="rtl" value={d.footerAr} onChange={(e) => set({ footerAr: e.target.value })} maxLength={300} />
        </div>
      </Card>

      <div className="sticky bottom-3 z-10 flex items-center justify-end gap-3 rounded-xl border border-line bg-surface/95 p-3 shadow-lg backdrop-blur">
        {dirty && <span className="text-sm text-ink-soft">{tr("Modifications non enregistrées")}</span>}
        <Button variant="primary" loading={save.isPending} disabled={!dirty || !colorOk} onClick={() => save.mutate(d)}>
          {tr("Enregistrer l'apparence")}
        </Button>
      </div>
    </div>
  );
}

/** Home page sections: drag to reorder (or the arrows on a phone), switch each one on/off. */
function SectionsCard({ d, set }: { d: DesignDTO; set: (p: Partial<DesignDTO>) => void }) {
  const dragFrom = useRef<number | null>(null);
  const [over, setOver] = useState<number | null>(null);
  const move = (from: number, to: number) => {
    if (to < 0 || to >= d.sections.length || from === to) return;
    const list = [...d.sections];
    const [item] = list.splice(from, 1);
    list.splice(to, 0, item!);
    set({ sections: list });
  };
  return (
    <Card title={tr("🧱 Sections de la page d'accueil")}>
      <p className="mb-3 text-sm text-ink-soft">{tr("Glissez pour changer l'ordre (ou les flèches sur téléphone). Décochez pour cacher une section.")}</p>
      <ol className="space-y-1.5">
        {d.sections.map((s, i) => {
          const meta = HOME_SECTION_LABEL[s.key];
          return (
            <li
              key={s.key}
              draggable
              onDragStart={(e) => {
                dragFrom.current = i;
                e.dataTransfer.effectAllowed = "move";
              }}
              onDragOver={(e) => {
                e.preventDefault();
                setOver(i);
              }}
              onDragLeave={() => setOver((o) => (o === i ? null : o))}
              onDrop={(e) => {
                e.preventDefault();
                if (dragFrom.current != null) move(dragFrom.current, i);
                dragFrom.current = null;
                setOver(null);
              }}
              onDragEnd={() => setOver(null)}
              className={`flex items-center gap-2 rounded-xl border bg-surface px-2.5 py-2 transition ${over === i ? "border-plum-600 bg-rose-100/40" : "border-line"} ${s.on ? "" : "opacity-55"}`}
            >
              <span className="cursor-grab select-none px-1 text-lg text-ink-soft" aria-hidden="true">⠿</span>
              <span className="w-6 text-center text-xs tabular-nums text-ink-soft">{i + 1}</span>
              <span aria-hidden="true">{meta.icon}</span>
              <span className="min-w-0 flex-1 truncate text-sm font-medium">{tr(meta.fr)}</span>
              <button type="button" onClick={() => move(i, i - 1)} disabled={i === 0} className="grid size-8 place-items-center rounded-lg border border-line text-sm disabled:opacity-30" aria-label={tr("Monter")}>
                ↑
              </button>
              <button type="button" onClick={() => move(i, i + 1)} disabled={i === d.sections.length - 1} className="grid size-8 place-items-center rounded-lg border border-line text-sm disabled:opacity-30" aria-label={tr("Descendre")}>
                ↓
              </button>
              <label className="flex cursor-pointer items-center gap-1.5 ps-1 text-xs font-semibold">
                <input type="checkbox" className="size-4 accent-plum-600" checked={s.on} onChange={(e) => set({ sections: d.sections.map((x, j) => (j === i ? { ...x, on: e.target.checked } : x)) })} />
                <span className="hidden sm:inline">{s.on ? tr("Visible") : tr("Cachée")}</span>
              </label>
            </li>
          );
        })}
      </ol>
    </Card>
  );
}

function BannersCard({ d, set, media }: { d: DesignDTO; set: (p: Partial<DesignDTO>) => void; media: (k: string | null) => string | null }) {
  const toast = useToast();
  const update = (i: number, patch: Partial<BannerDTO>) => set({ banners: d.banners.map((b, j) => (j === i ? { ...b, ...patch } : b)) });
  const [adding, setAdding] = useState(false);
  return (
    <Card title={tr("🏷️ Bannières")}>
      <p className="mb-3 text-sm text-ink-soft">{tr("Grandes images cliquables sur l'accueil (promo, nouvelle collection…). 6 au maximum. Lien : une page de la boutique (/c/robes, /collection/ete) ou un lien https.")}</p>
      <ul className="space-y-3">
        {d.banners.map((b, i) => (
          <li key={b.id} className="rounded-xl border border-line p-3">
            <div className="flex flex-wrap gap-3">
              <div className="relative aspect-[16/9] w-44 shrink-0 overflow-hidden rounded-lg bg-ivory-deep">
                {b.image && <img src={media(b.image) ?? ""} alt="" className="size-full object-cover" />}
              </div>
              <div className="grid min-w-[14rem] flex-1 gap-2 sm:grid-cols-2">
                <TextField label={tr("Titre (français)")} value={b.titleFr} onChange={(e) => update(i, { titleFr: e.target.value })} maxLength={80} />
                <TextField label={tr("Titre (arabe)")} dir="rtl" value={b.titleAr} onChange={(e) => update(i, { titleAr: e.target.value })} maxLength={80} />
                <TextField label={tr("Sous-titre (français)")} value={b.subtitleFr} onChange={(e) => update(i, { subtitleFr: e.target.value })} maxLength={140} />
                <TextField label={tr("Sous-titre (arabe)")} dir="rtl" value={b.subtitleAr} onChange={(e) => update(i, { subtitleAr: e.target.value })} maxLength={140} />
                <TextField label={tr("Lien")} placeholder="/c/robes" dir="ltr" value={b.link} onChange={(e) => update(i, { link: e.target.value.trim() })} maxLength={300} className="sm:col-span-2" />
              </div>
            </div>
            <div className="mt-2 flex justify-end gap-2">
              <Button size="sm" onClick={() => i > 0 && set({ banners: [...d.banners.slice(0, i - 1), b, d.banners[i - 1]!, ...d.banners.slice(i + 1)] })} disabled={i === 0}>
                ↑
              </Button>
              <Button size="sm" variant="danger" onClick={() => set({ banners: d.banners.filter((_, j) => j !== i) })}>
                {tr("Supprimer")}
              </Button>
            </div>
          </li>
        ))}
      </ul>
      {d.banners.length < 6 && (
        <label className="mt-3 inline-flex h-10 cursor-pointer items-center rounded-lg border border-dashed border-plum-600 px-4 text-sm font-semibold text-plum-700">
          {adding ? tr("Envoi…") : tr("+ Ajouter une bannière (image)")}
          <input
            type="file"
            accept="image/*"
            className="sr-only"
            disabled={adding}
            onChange={async (e) => {
              const f = e.target.files?.[0];
              e.target.value = "";
              if (!f) return;
              setAdding(true);
              try {
                const { key } = await uploadDesignImage(f);
                set({ banners: [...d.banners, { id: Math.random().toString(36).slice(2, 10), image: key, titleFr: "", titleAr: "", subtitleFr: "", subtitleAr: "", link: "" }] });
              } catch (err) {
                toast(errorMessage(err), "error");
              } finally {
                setAdding(false);
              }
            }}
          />
        </label>
      )}
    </Card>
  );
}
