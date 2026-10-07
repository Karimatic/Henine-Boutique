import { formatDzPhone } from "@henine/shared";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { api, errorMessage, post, upload } from "../api";
import { tr } from "../i18n";
import { ago, da } from "../lib/format";
import { processImage } from "../lib/images";
import { Badge, Button, Empty, ErrorState, inputCls, ListSkeleton, PageHeader, useToast } from "../ui";
import { SubNav } from "../lib/subnav";

interface PackItem {
  id: number;
  name_fr: string;
  sku: string | null;
  options: string | null;
  qty: number;
  image: string | null;
}

interface PackOrder {
  id: number;
  public_code: string;
  status: "confirmee" | "en_preparation";
  name: string;
  phone: string;
  wilaya_code: number;
  wilaya: string | null;
  commune: string | null;
  delivery_type: "domicile" | "bureau";
  address: string | null;
  customer_note: string | null;
  internal_note: string | null;
  total: number;
  confirmed_at: number | null;
  created_at: number;
  verified_at: number | null;
  packed_at: number | null;
  pack_photo_url: string | null;
  tracking_number: string | null;
  channel: string;
  items: PackItem[];
}

const STEPS = [tr("📦 Prélever"), tr("🔍 Vérifier"), tr("📸 Emballer"), tr("🏷 Étiquette"), tr("🚚 Expédier")];

/**
 * Mode préparation: the confirmed orders, oldest first. One order at a time, step by step:
 * pick each piece (tap it, or scan / type its SKU), verified, packed (photo of the parcel),
 * label printed, shipped. Fewer wrong sizes and missing pieces.
 */
export function PackingPage() {
  const q = useQuery({ queryKey: ["packing"], queryFn: () => api<PackOrder[]>("/packing"), refetchInterval: 30_000 });
  const [openId, setOpenId] = useState<number | null>(null);
  const open = q.data?.find((o) => o.id === openId) ?? null;
  if (open) return <PackingFlow order={open} onBack={() => setOpenId(null)} onRefresh={() => void q.refetch()} />;
  return (
    <div>
      <PageHeader
        group={tr("Commandes")}
        title={tr("Préparation des colis")}
        subtitle={tr("Les commandes confirmées, la plus ancienne en premier. Ouvrez-en une et suivez les étapes.")}
      />
      <SubNav of="orders" />
      {q.error ? <ErrorState error={q.error} onRetry={q.refetch} /> : !q.data ? <ListSkeleton /> : q.data.length === 0 ? (
        <Empty title={tr("Aucun colis à préparer")} icon="📦">{tr("Les commandes apparaissent ici dès qu'elles sont confirmées.")}</Empty>
      ) : (
        <ul className="grid gap-2 md:grid-cols-2">
          {q.data.map((o) => {
            const pieces = o.items.reduce((s, i) => s + i.qty, 0);
            return (
              <li key={o.id}>
                <button type="button" onClick={() => setOpenId(o.id)} className="w-full rounded-xl border border-line bg-surface p-4 text-start transition hover:border-plum-600/40">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="font-mono text-sm font-bold">{o.public_code}</p>
                      <p className="truncate font-semibold">{o.name}</p>
                      <p className="text-sm text-ink-soft">{o.wilaya_code} · {o.wilaya} · {o.delivery_type === "bureau" ? tr("Bureau") : tr("Domicile")}</p>
                    </div>
                    <Badge tone={o.packed_at ? "bg-emerald-100 text-emerald-800" : o.verified_at ? "bg-sky-100 text-sky-800" : o.status === "en_preparation" ? "bg-amber-100 text-amber-800" : "bg-stone-200 text-stone-700"}>
                      {o.packed_at ? tr("Emballé") : o.verified_at ? tr("Vérifié") : o.status === "en_preparation" ? tr("En cours") : tr("À préparer")}
                    </Badge>
                  </div>
                  <div className="mt-3 flex items-center gap-2">
                    {o.items.slice(0, 4).map((i) => (i.image ? <img key={i.id} src={i.image} alt="" className="h-12 w-10 rounded-md object-cover" /> : <span key={i.id} className="grid h-12 w-10 place-items-center rounded-md bg-rose-100">👗</span>))}
                    <span className="ms-auto text-sm text-ink-soft">{tr("{0} pièce(s)", { 0: pieces })} · {ago(o.confirmed_at ?? o.created_at)}</span>
                  </div>
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

function PackingFlow({ order: o, onBack, onRefresh }: { order: PackOrder; onBack: () => void; onRefresh: () => void }) {
  const toast = useToast();
  const qc = useQueryClient();
  const [picked, setPicked] = useState<Record<number, number>>({});
  const [step, setStep] = useState(o.packed_at ? 3 : o.verified_at ? 2 : 0);
  const [scan, setScan] = useState("");
  const [photo, setPhoto] = useState<File | null>(null);
  const [tracking, setTracking] = useState(o.tracking_number ?? "");
  const scanRef = useRef<HTMLInputElement>(null);
  const total = o.items.reduce((s, i) => s + i.qty, 0);
  const done = o.items.reduce((s, i) => s + Math.min(picked[i.id] ?? 0, i.qty), 0);
  const allPicked = done === total;

  // opening an order = "en préparation"
  useEffect(() => {
    if (o.status === "confirmee") void post(`/orders/${o.id}/packing`, { step: "start" }).then(onRefresh).catch(() => undefined);
  }, [o.id]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (step <= 1) scanRef.current?.focus();
  }, [step]);

  const pick = (it: PackItem) => setPicked((p) => ({ ...p, [it.id]: Math.min(it.qty, (p[it.id] ?? 0) + 1) }));
  function onScan(code: string) {
    const c = code.trim().toUpperCase();
    if (!c) return;
    const it = o.items.find((i) => (i.sku ?? "").toUpperCase() === c && (picked[i.id] ?? 0) < i.qty);
    if (it) {
      pick(it);
      navigator.vibrate?.(30);
    } else {
      toast(tr("Ce code ne correspond à aucun article restant de la commande ⚠️"), "error");
      navigator.vibrate?.([60, 40, 60]);
    }
    setScan("");
  }

  const act = useMutation({
    mutationFn: async (what: "verified" | "packed" | "ship") => {
      if (what === "verified") return post(`/orders/${o.id}/packing`, { step: "verified" });
      if (what === "packed") {
        const form = new FormData();
        form.append("step", "packed");
        if (photo) {
          const img = await processImage(photo);
          const w = Object.keys(img.files).map(Number).sort((a, b) => b - a)[0]!;
          form.append("photo", img.files[w]!, `colis.${img.format}`);
        }
        return upload(`/orders/${o.id}/packing`, form);
      }
      return post(`/orders/${o.id}/status`, { to: "expediee", trackingNumber: tracking.trim() || undefined });
    },
    onSuccess: (_r, what) => {
      if (what === "verified") setStep(2);
      if (what === "packed") setStep(3);
      if (what === "ship") {
        toast(tr("Commande {0} expédiée ✓", { 0: o.public_code }));
        void qc.invalidateQueries({ queryKey: ["orders"] });
        onBack();
      }
      onRefresh();
    },
    onError: (e) => toast(errorMessage(e), "error"),
  });

  return (
    <div className="pb-24">
      <button type="button" onClick={onBack} className="mb-3 text-sm font-semibold text-plum-700">{tr("← Tous les colis")}</button>
      <div className="mb-4 rounded-xl border border-line bg-surface p-4">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div>
            <p className="font-mono text-lg font-bold">{o.public_code}</p>
            <p className="font-semibold">{o.name} · <span className="font-mono text-sm"><bdi dir="ltr">{formatDzPhone(o.phone)}</bdi></span></p>
            <p className="text-sm text-ink-soft">{o.wilaya_code} · {o.wilaya}{o.commune ? ` › ${o.commune}` : ""}</p>
          </div>
          <span className={`rounded-lg px-3 py-1.5 text-sm font-bold ${o.delivery_type === "bureau" ? "bg-ink text-on-ink" : "bg-rose-100 text-plum-700"}`}>
            {o.delivery_type === "bureau" ? tr("🏢 Bureau (stop-desk)") : tr("🏠 Domicile")}
          </span>
        </div>
        {o.address && <p className="mt-2 text-sm">📍 {o.address}</p>}
        {(o.customer_note || o.internal_note) && <p className="mt-2 rounded-lg bg-amber-50 p-2 text-sm text-amber-900">📝 {[o.customer_note, o.internal_note].filter(Boolean).join(" · ")}</p>}
      </div>

      <ol className="mb-4 grid grid-cols-5 gap-1 text-center text-[11px] font-semibold sm:text-xs">
        {STEPS.map((s, i) => (
          <li key={s} className={`rounded-lg px-1 py-2 ${i < step ? "bg-emerald-100 text-emerald-800" : i === step ? "bg-plum-600 text-white" : "bg-ivory-deep text-ink-soft"}`}>{s}</li>
        ))}
      </ol>

      {step <= 1 && (
        <section className="space-y-3">
          <div className="flex items-center gap-2">
            <input
              ref={scanRef}
              className={`${inputCls} font-mono`}
              placeholder={tr("Scannez ou tapez le SKU…")}
              value={scan}
              onChange={(e) => setScan(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && onScan(scan)}
              aria-label={tr("SKU")}
            />
            <span className="shrink-0 text-sm font-bold tabular-nums">{done}/{total}</span>
          </div>
          <ul className="space-y-2">
            {o.items.map((it) => {
              const n = picked[it.id] ?? 0;
              const full = n >= it.qty;
              return (
                <li key={it.id}>
                  <button
                    type="button"
                    onClick={() => (full ? setPicked((p) => ({ ...p, [it.id]: 0 })) : pick(it))}
                    className={`flex w-full items-center gap-3 rounded-xl border-2 p-3 text-start transition ${full ? "border-emerald-500 bg-emerald-50" : "border-line bg-surface"}`}
                  >
                    {it.image ? <img src={it.image} alt="" className="h-24 w-20 shrink-0 rounded-lg object-cover" /> : <span className="grid h-24 w-20 shrink-0 place-items-center rounded-lg bg-rose-100 text-3xl">👗</span>}
                    <span className="min-w-0 flex-1">
                      <span className="block font-semibold">{it.name_fr}</span>
                      <span className="mt-0.5 block text-lg font-bold text-plum-700">{it.options ?? "—"}</span>
                      <span className="block font-mono text-xs text-ink-soft">SKU {it.sku ?? "—"}</span>
                    </span>
                    <span className="shrink-0 text-center">
                      <span className="block text-3xl font-bold tabular-nums">×{it.qty}</span>
                      <span className={`text-xs font-semibold ${full ? "text-emerald-800" : "text-ink-soft"}`}>{full ? tr("✓ prélevé") : `${n}/${it.qty}`}</span>
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
          <Button variant="primary" className="w-full" disabled={!allPicked} loading={act.isPending} onClick={() => act.mutate("verified")}>
            {allPicked ? tr("✅ Colis vérifié") : tr("Prélevez chaque pièce ({0}/{1})", { 0: done, 1: total })}
          </Button>
        </section>
      )}

      {step === 2 && (
        <section className="space-y-3 rounded-xl border border-line bg-surface p-4">
          <p className="font-semibold">{tr("📸 Photo du colis fermé (facultatif)")}</p>
          <p className="text-sm text-ink-soft">{tr("Une preuve en cas de réclamation : le colis prêt, avec le bordereau visible.")}</p>
          <label className="inline-flex h-11 cursor-pointer items-center rounded-lg border border-dashed border-plum-600 px-4 text-sm font-semibold text-plum-700">
            {photo ? tr("✓ Photo prise · changer") : tr("📷 Prendre la photo")}
            <input type="file" accept="image/*" capture="environment" className="sr-only" onChange={(e) => setPhoto(e.target.files?.[0] ?? null)} />
          </label>
          {o.pack_photo_url && !photo && <img src={o.pack_photo_url} alt="" className="h-32 rounded-lg object-cover" />}
          <Button variant="primary" className="w-full" loading={act.isPending} onClick={() => act.mutate("packed")}>{tr("📦 Colis emballé")}</Button>
        </section>
      )}

      {step >= 3 && (
        <section className="space-y-3 rounded-xl border border-line bg-surface p-4">
          <p className="font-semibold">{tr("🏷 Étiquette et expédition")}</p>
          <Link to="/bordereaux" search={{ ids: String(o.id) }} className="inline-flex h-11 items-center rounded-lg border border-line bg-surface px-4 text-sm font-semibold">
            {tr("🖨 Imprimer le bordereau")}
          </Link>
          <label className="block">
            <span className="mb-1 block text-sm font-medium">{tr("N° de suivi ZR Express (facultatif)")}</span>
            <input className={`${inputCls} font-mono`} value={tracking} onChange={(e) => setTracking(e.target.value)} />
          </label>
          <Button variant="primary" className="w-full" loading={act.isPending} onClick={() => act.mutate("ship")}>{tr("🚚 Marquer « Expédiée »")}</Button>
          <p className="text-xs text-ink-soft">{tr("Total à encaisser par le livreur : {0}", { 0: da(o.total) })}</p>
        </section>
      )}
    </div>
  );
}
