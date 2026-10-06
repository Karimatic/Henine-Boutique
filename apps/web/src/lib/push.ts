import { apiGet, apiPost } from "./api";

/** Browser can receive notifications (Android Chrome, desktop; iPhone only once added to the home screen). */
export function pushSupported(): boolean {
  return typeof window !== "undefined" && "serviceWorker" in navigator && "PushManager" in window && "Notification" in window;
}

function keyBytes(b64url: string): Uint8Array<ArrayBuffer> {
  const b = atob(b64url.replace(/-/g, "+").replace(/_/g, "/") + "=".repeat((4 - (b64url.length % 4)) % 4));
  const out = new Uint8Array(b.length);
  for (let i = 0; i < b.length; i++) out[i] = b.charCodeAt(i);
  return out;
}

/**
 * Asks permission, subscribes this browser and registers it for `variantId`.
 * "denied" = the customer (or the browser) said no; the phone form stays available.
 */
export async function subscribeRestock(variantId: number, locale: "fr" | "ar"): Promise<"ok" | "denied" | "error"> {
  return subscribe({ variantId }, locale);
}

/** Every sold-out size of a product (from the wishlist). */
export function subscribeProduct(productId: number, locale: "fr" | "ar") {
  return subscribe({ productId }, locale);
}

/** "Recevoir les nouveautés": store news sent from Admin → Notifier. */
export function subscribeNews(locale: "fr" | "ar") {
  return subscribe({ topic: "news" }, locale);
}

async function subscribe(target: { variantId?: number; productId?: number; topic?: "news" }, locale: "fr" | "ar"): Promise<"ok" | "denied" | "error"> {
  if (!pushSupported()) return "error";
  try {
    const permission = await Notification.requestPermission();
    if (permission !== "granted") return "denied";
    const reg = await navigator.serviceWorker.register("/sw.js", { scope: "/" });
    await navigator.serviceWorker.ready;
    let sub = await reg.pushManager.getSubscription();
    if (!sub) {
      const { publicKey } = await apiGet<{ publicKey: string }>("/push/key");
      sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: keyBytes(publicKey) });
    }
    const json = sub.toJSON() as { endpoint: string; keys: { p256dh: string; auth: string } };
    await apiPost("/push/subscribe", { ...target, locale, subscription: { endpoint: json.endpoint, keys: json.keys } });
    return "ok";
  } catch {
    return "error";
  }
}
