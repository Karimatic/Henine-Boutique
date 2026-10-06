/**
 * Where a visit came from (campaign link, ad click, a link from Instagram / WhatsApp / Google…),
 * remembered on this phone for 30 days and sent with the order, so the shop knows which
 * sources really sell. The last such arrival counts. One anonymous visit count per browser
 * session goes to /api/visit (no personal data). The server classifies the source itself.
 */

const KEY = "henine.visit.v1";
const SESSION = "henine.visited";
const TTL = 30 * 86_400_000;

export interface Visit {
  source?: string;
  medium?: string;
  campaign?: string;
  /** host of the site the visitor came from */
  referrer?: string;
  /** the store page where the visit started */
  landing?: string;
  clickId?: "fb" | "google" | "tiktok";
}

const cut = (v: string | null, n: number) => (v ? v.trim().slice(0, n) || undefined : undefined);

/** Reads this page's address and referrer; runs once per page load. */
export function captureVisit() {
  try {
    const url = new URL(location.href);
    const p = url.searchParams;
    let ref = "";
    try {
      ref = document.referrer ? new URL(document.referrer).host : "";
    } catch {
      /* no referrer */
    }
    const external = ref && ref !== location.host ? ref : undefined;
    const clickId = p.has("fbclid") ? "fb" : p.has("gclid") || p.has("gbraid") || p.has("wbraid") ? "google" : p.has("ttclid") ? "tiktok" : undefined;
    const fresh: Visit = { source: cut(p.get("utm_source"), 64), medium: cut(p.get("utm_medium"), 64), campaign: cut(p.get("utm_campaign"), 64), clickId };
    if (fresh.source || clickId || external) {
      localStorage.setItem(KEY, JSON.stringify({ ...fresh, referrer: external?.slice(0, 120), landing: url.pathname.slice(0, 200), at: Date.now() }));
    }
    if (!sessionStorage.getItem(SESSION)) {
      sessionStorage.setItem(SESSION, "1");
      const v = visitAttribution() ?? {};
      navigator.sendBeacon?.("/api/visit", new Blob([JSON.stringify({ source: v.source, medium: v.medium, campaign: v.campaign, referrer: v.referrer, clickId: v.clickId })], { type: "application/json" }));
    }
  } catch {
    /* private mode, old browser: no attribution, nothing breaks */
  }
}

/** The remembered arrival (≤ 30 days), sent with the order. */
export function visitAttribution(): Visit | undefined {
  try {
    const v = JSON.parse(localStorage.getItem(KEY) ?? "null") as (Visit & { at: number }) | null;
    if (!v || Date.now() - v.at > TTL) return undefined;
    const { at: _at, ...rest } = v;
    return rest;
  } catch {
    return undefined;
  }
}
