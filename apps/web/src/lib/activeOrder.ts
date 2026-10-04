"use client";

import type { TrackedOrderDTO } from "@henine/shared";
import { useApi } from "./api";
import { useEffect, useState } from "react";
import { ordersStore, useSavedOrders } from "./stores";

const DONE = new Set(["livree", "retour_recu", "annulee", "doublon", "fausse"]);

/**
 * The last order placed on this phone, while it's still on its way (≤ 30 days): its status
 * and the private tracking link. One request, shared by the header and the bottom bar.
 */
export function useActiveOrder(): { code: string; status: string; link: string } | null {
  const latest = useSavedOrders()[0];
  const [now] = useState(Date.now);
  const recent = latest && now - latest.createdAt <= 30 * 86400_000;
  const { data, error } = useApi<TrackedOrderDTO>(recent ? `/track/${latest.code}?t=${encodeURIComponent(latest.token)}` : null);
  // the order no longer exists (deleted by the shop): forget it on this phone
  useEffect(() => {
    if (error?.status === 404 && latest) ordersStore.set((list) => list.filter((o) => o.code !== latest.code));
  }, [error, latest]);
  if (!latest || !data || DONE.has(data.status)) return null;
  return { code: data.code, status: data.status, link: `/suivi?c=${data.code}&t=${encodeURIComponent(latest.token)}` };
}
