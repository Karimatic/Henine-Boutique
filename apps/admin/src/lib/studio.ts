/**
 * "Studio" product photos: the background removed and the product centred in the same 4:5
 * frame (server: POST /api/admin/images/studio, Cloudflare Images). Every product then looks
 * alike in the shop, on the theme's background. On by default, remembered on this device.
 * When the service is unavailable (monthly quota, error) the original photo is used.
 */
const KEY = "henine.admin.studioPhotos";

export function studioEnabled(): boolean {
  try {
    return localStorage.getItem(KEY) !== "off";
  } catch {
    return true;
  }
}

export function setStudioEnabled(on: boolean) {
  try {
    localStorage.setItem(KEY, on ? "on" : "off");
  } catch {
    /* private mode */
  }
}

async function once(file: File): Promise<File> {
  const form = new FormData();
  form.append("image", file);
  const res = await fetch("/api/admin/images/studio", { method: "POST", body: form, credentials: "same-origin" });
  if (!res.ok || !res.headers.get("Content-Type")?.startsWith("image/")) throw new Error(`studio_${res.status}`);
  const blob = await res.blob();
  return new File([blob], file.name.replace(/\.\w+$/, "") + ".webp", { type: blob.type || "image/webp" });
}

/** The photo without background, or null when it could not be made (the caller keeps the original). */
export async function studioPhoto(file: File): Promise<File | null> {
  if (!file.type.startsWith("image/")) return null;
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      return await once(file);
    } catch (err) {
      // a refusal (quota, too big, not allowed) won't change on retry; a passing error might
      if (/studio_(4\d\d|503)/.test(String(err))) return null;
    }
  }
  return null;
}
