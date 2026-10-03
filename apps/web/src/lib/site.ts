"use client";

import { DEFAULT_DESIGN, type SiteConfigDTO } from "@henine/shared";
import { useApi } from "./api";

/** Store settings (/site): contact, design, flash sale… shared by every component. */
export function useSite() {
  return useApi<SiteConfigDTO>("/site");
}

export function useDesign() {
  return useSite().data?.design ?? DEFAULT_DESIGN;
}

/**
 * wa.me link from the number saved in Admin → Contact ("0555 12 34 56", "+213 555…",
 * or a full wa.me link), with a pre-filled message.
 */
export function whatsappLink(saved: string | null | undefined, text: string): string | null {
  if (!saved) return null;
  const s = saved.trim();
  if (/^https:\/\/(wa\.me|api\.whatsapp\.com)\//.test(s)) return `${s}${s.includes("?") ? "&" : "?"}text=${encodeURIComponent(text)}`;
  let digits = s.replace(/\D/g, "");
  if (digits.startsWith("00")) digits = digits.slice(2);
  if (digits.startsWith("0")) digits = `213${digits.slice(1)}`;
  if (digits.length < 9) return null;
  return `https://wa.me/${digits}?text=${encodeURIComponent(text)}`;
}
