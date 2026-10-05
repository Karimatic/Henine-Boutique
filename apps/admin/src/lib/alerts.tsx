/**
 * Topbar bell: operational alerts (late orders, parcels ready, critical stock, customer
 * problems, exchange requests). Refreshed live by the WebSocket (see live.tsx).
 */
import { useEffect, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { Bell } from "lucide-react";
import { api, post } from "../api";
import { tr } from "../i18n";
import { ago } from "./format";

export interface AlertRow {
  id: number;
  kind: string;
  priority: "high" | "medium" | "low";
  entity: string | null;
  entity_id: string | null;
  message: string;
  created_at: number;
  read_at: number | null;
  resolved_at: number | null;
  resolved_by: string | null;
}

const ICON: Record<string, string> = {
  late_order: "⏰",
  unconfirmed: "📞",
  ready_to_ship: "📦",
  low_stock: "⚠️",
  receipt_issue: "❌",
  exchange: "🔄",
};

const DOT: Record<AlertRow["priority"], string> = { high: "bg-red-500", medium: "bg-amber-500", low: "bg-emerald-500" };

export function AlertsBell() {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  const q = useQuery({
    queryKey: ["alerts"],
    queryFn: () => api<{ rows: AlertRow[]; open: number; unread: number }>("/alerts"),
    refetchInterval: 5 * 60_000,
  });
  const refresh = () => void qc.invalidateQueries({ queryKey: ["alerts"] });
  const resolve = useMutation({ mutationFn: (id: number) => post(`/alerts/${id}/resolve`), onSuccess: refresh });
  const readAll = useMutation({ mutationFn: () => post("/alerts/read-all"), onSuccess: refresh });

  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent | KeyboardEvent) => {
      if (e instanceof KeyboardEvent ? e.key === "Escape" : !box.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", close);
    document.addEventListener("keydown", close);
    return () => {
      document.removeEventListener("mousedown", close);
      document.removeEventListener("keydown", close);
    };
  }, [open]);

  function go(a: AlertRow) {
    setOpen(false);
    void post(`/alerts/${a.id}/read`).then(refresh);
    if (a.entity === "order" && a.entity_id) void navigate({ to: "/commandes", search: { o: Number(a.entity_id) } as never });
    else if (a.entity === "orders") void navigate({ to: "/commandes", search: (a.kind === "unconfirmed" ? { attention: "late" } : { status: a.entity_id ?? "active" }) as never });
    else if (a.entity === "variant") void navigate({ to: "/stock" });
  }

  const unread = q.data?.unread ?? 0;
  const rows = q.data?.rows ?? [];
  return (
    <div ref={box} className="relative">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-label={unread ? tr("Alertes ({0} non lues)", { 0: unread }) : tr("Alertes")}
        className="relative grid size-9 place-items-center rounded-lg text-ink-soft transition hover:bg-ivory-deep hover:text-plum-700"
      >
        <Bell className="size-5" strokeWidth={1.8} />
        {unread > 0 && (
          <span className="absolute -end-0.5 -top-0.5 grid min-w-5 place-items-center rounded-full bg-red-600 px-1 text-[10px] font-bold leading-5 text-white ring-2 ring-surface">
            {unread > 99 ? "99+" : unread}
          </span>
        )}
      </button>
      {open && (
        <div
          role="dialog"
          aria-label={tr("Alertes")}
          className="animate-pop fixed inset-x-3 top-16 z-50 max-h-[75vh] overflow-hidden rounded-2xl border border-line bg-surface shadow-xl sm:absolute sm:inset-x-auto sm:end-0 sm:top-11 sm:w-[26rem]"
        >
          <div className="flex items-center justify-between gap-2 border-b border-line px-4 py-3">
            <p className="font-semibold">
              {tr("Alertes")} {q.data?.open ? <span className="text-ink-soft">· {q.data.open}</span> : null}
            </p>
            {unread > 0 && (
              <button type="button" onClick={() => readAll.mutate()} className="text-xs font-semibold text-plum-600">
                {tr("Tout marquer comme lu")}
              </button>
            )}
          </div>
          <ul className="max-h-[60vh] divide-y divide-line overflow-y-auto">
            {rows.length === 0 && <li className="px-4 py-8 text-center text-sm text-ink-soft">{tr("Rien à signaler 🌸")}</li>}
            {rows.map((a) => (
              <li key={a.id} className={`flex gap-3 px-4 py-3 ${a.read_at ? "" : "bg-rose-100/40"}`}>
                <span className="relative mt-0.5 text-lg" aria-hidden="true">
                  {ICON[a.kind] ?? "🔔"}
                  <span className={`absolute -end-1 -top-0.5 size-2 rounded-full ${DOT[a.priority]}`} />
                </span>
                <div className="min-w-0 flex-1">
                  <button type="button" onClick={() => go(a)} className="text-start text-sm leading-snug hover:text-plum-700">
                    {a.message}
                  </button>
                  <p className="mt-0.5 text-xs text-ink-soft">{ago(a.created_at)}</p>
                </div>
                <button
                  type="button"
                  onClick={() => resolve.mutate(a.id)}
                  title={tr("Marquer comme résolue")}
                  aria-label={tr("Marquer comme résolue")}
                  className="grid size-9 shrink-0 place-items-center rounded-lg text-ink-soft hover:bg-emerald-50 hover:text-emerald-700"
                >
                  ✓
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
