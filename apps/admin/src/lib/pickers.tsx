import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { api } from "../api";
import { tr } from "../i18n";
import { inputCls } from "../ui";
import { da } from "./format";

interface PickProduct {
  id: number;
  name_fr: string;
  price: number;
  image: string | null;
  status: string;
}

/** Products chosen by tapping them in a search list; the chosen ones show as removable chips. */
export function ProductPicker({ value, onChange, max = 100, label }: { value: number[]; onChange: (ids: number[]) => void; max?: number; label?: string }) {
  const [q, setQ] = useState("");
  const all = useQuery({ queryKey: ["products", "picker"], queryFn: () => api<PickProduct[]>("/products?status=all&q=") });
  const byId = new Map((all.data ?? []).map((p) => [p.id, p]));
  const matches = (all.data ?? [])
    .filter((p) => p.status !== "archived" && !value.includes(p.id) && p.name_fr.toLowerCase().includes(q.trim().toLowerCase()))
    .slice(0, 8);
  return (
    <div>
      {label && <p className="mb-1.5 text-sm font-medium">{label}</p>}
      {value.length > 0 && (
        <ul className="mb-2 flex flex-wrap gap-1.5">
          {value.map((id) => {
            const p = byId.get(id);
            return (
              <li key={id} className="flex items-center gap-1.5 rounded-full bg-rose-100 py-1 pe-1 ps-1.5 text-sm text-plum-700">
                {p?.image ? <img src={p.image} alt="" className="size-6 rounded-full object-cover" /> : <span aria-hidden="true">👗</span>}
                <span className="max-w-[12rem] truncate font-medium">{p?.name_fr ?? `#${id}`}</span>
                <button type="button" onClick={() => onChange(value.filter((x) => x !== id))} className="grid size-6 place-items-center rounded-full bg-white/70" aria-label={tr("Retirer")}>
                  ✕
                </button>
              </li>
            );
          })}
        </ul>
      )}
      {value.length < max && (
        <>
          <input type="search" className={inputCls} placeholder={tr("Chercher un produit à ajouter…")} value={q} onChange={(e) => setQ(e.target.value)} />
          <ul className="mt-1.5 max-h-56 divide-y divide-line overflow-y-auto rounded-lg border border-line bg-white">
            {matches.map((p) => (
              <li key={p.id}>
                <button type="button" onClick={() => onChange([...value, p.id])} className="flex w-full items-center gap-2.5 px-3 py-2 text-start hover:bg-rose-100/40">
                  {p.image ? <img src={p.image} alt="" className="h-10 w-8 rounded object-cover" /> : <span className="grid h-10 w-8 place-items-center rounded bg-rose-100">👗</span>}
                  <span className="min-w-0 flex-1 truncate text-sm">{p.name_fr}</span>
                  <span className="text-xs tabular-nums text-ink-soft">{da(p.price)}</span>
                  <span className="text-lg font-semibold text-plum-600">+</span>
                </button>
              </li>
            ))}
            {all.data && matches.length === 0 && <li className="px-3 py-2 text-sm text-ink-soft">{tr("Aucun produit")}</li>}
          </ul>
        </>
      )}
    </div>
  );
}

/** Categories as on/off chips. */
export function CategoryPicker({ value, onChange, label }: { value: number[]; onChange: (ids: number[]) => void; label?: string }) {
  const cats = useQuery({ queryKey: ["categories"], queryFn: () => api<{ id: number; name_fr: string }[]>("/categories") });
  return (
    <div>
      {label && <p className="mb-1.5 text-sm font-medium">{label}</p>}
      <div className="flex flex-wrap gap-1.5">
        {(cats.data ?? []).map((c) => {
          const on = value.includes(c.id);
          return (
            <button
              key={c.id}
              type="button"
              aria-pressed={on}
              onClick={() => onChange(on ? value.filter((x) => x !== c.id) : [...value, c.id])}
              className={`h-9 rounded-full border px-3.5 text-sm font-medium ${on ? "border-plum-600 bg-plum-600 text-white" : "border-line bg-white"}`}
            >
              {on ? "✓ " : ""}
              {c.name_fr}
            </button>
          );
        })}
      </div>
    </div>
  );
}
