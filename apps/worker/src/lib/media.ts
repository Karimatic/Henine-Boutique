/**
 * Uploads to R2 (review photos, logo, banners, home video, sounds). The type is read from the
 * file's first bytes, never trusted from the browser; the media route only serves these types.
 */
import { DEFAULT_DESIGN, resolveSections, type DesignDTO } from "@henine/shared";
import type { Env } from "../env";
import { mediaUrl } from "./catalog";
import { HttpError } from "./http";

const IMAGE_TYPES = { webp: "image/webp", jpg: "image/jpeg" } as const;
const VIDEO_TYPES = { mp4: "video/mp4", webm: "video/webm" } as const;
export const AUDIO_TYPES = { mp3: "audio/mpeg", ogg: "audio/ogg", wav: "audio/wav", m4a: "audio/mp4" } as const;

export function sniffImage(b: Uint8Array): keyof typeof IMAGE_TYPES | null {
  if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return "jpg";
  if (String.fromCharCode(...b.slice(0, 4)) === "RIFF" && String.fromCharCode(...b.slice(8, 12)) === "WEBP") return "webp";
  return null;
}

export function sniffVideo(b: Uint8Array): keyof typeof VIDEO_TYPES | null {
  if (String.fromCharCode(...b.slice(4, 8)) === "ftyp") return "mp4";
  if (b[0] === 0x1a && b[1] === 0x45 && b[2] === 0xdf && b[3] === 0xa3) return "webm";
  return null;
}

/** Stores the home page video (MP4 / WebM, ≤ 40 MB) without reading it into memory; returns its R2 key. */
export async function putVideo(env: Env, prefix: string, file: File): Promise<string> {
  if (file.size > 40_000_000) throw new HttpError(413, "file_too_large");
  const kind = sniffVideo(new Uint8Array(await file.slice(0, 16).arrayBuffer()));
  if (!kind) throw new HttpError(415, "video_type");
  const key = `${prefix}-${Date.now().toString(36)}${rand()}.${kind}`;
  await env.MEDIA.put(key, file.stream(), { httpMetadata: { contentType: VIDEO_TYPES[kind], cacheControl: "public, max-age=31536000, immutable" } });
  return key;
}

export function sniffAudio(b: Uint8Array): keyof typeof AUDIO_TYPES | null {
  const txt = (from: number, to: number) => String.fromCharCode(...b.slice(from, to));
  if (txt(0, 3) === "ID3" || (b[0] === 0xff && (b[1]! & 0xe0) === 0xe0)) return "mp3";
  if (txt(0, 4) === "OggS") return "ogg";
  if (txt(0, 4) === "RIFF" && txt(8, 12) === "WAVE") return "wav";
  if (txt(4, 8) === "ftyp" && /^(M4A |mp4|isom|dash)/.test(txt(8, 12))) return "m4a";
  return null;
}

const rand = () => crypto.getRandomValues(new Uint32Array(1))[0]!.toString(36);

/** Stores an uploaded image (WebP / JPEG, ≤ maxBytes) under `prefix/…`; returns its R2 key. */
export async function putImage(env: Env, prefix: string, file: File, maxBytes = 2_500_000): Promise<string> {
  if (file.size > maxBytes) throw new HttpError(413, "file_too_large");
  const bytes = new Uint8Array(await file.arrayBuffer());
  const kind = sniffImage(bytes);
  if (!kind) throw new HttpError(415, "image_type");
  const key = `${prefix}-${Date.now().toString(36)}${rand()}.${kind}`;
  await env.MEDIA.put(key, bytes, { httpMetadata: { contentType: IMAGE_TYPES[kind], cacheControl: "public, max-age=31536000, immutable" } });
  return key;
}

/** Stores a short sound (MP3 / OGG / WAV / M4A, ≤ 1 MB); returns its R2 key. */
export async function putAudio(env: Env, prefix: string, file: File): Promise<string> {
  if (file.size > 1_000_000) throw new HttpError(413, "file_too_large");
  const bytes = new Uint8Array(await file.arrayBuffer());
  const kind = sniffAudio(bytes);
  if (!kind) throw new HttpError(415, "audio_type");
  const key = `${prefix}-${Date.now().toString(36)}${rand()}.${kind}`;
  await env.MEDIA.put(key, bytes, { httpMetadata: { contentType: AUDIO_TYPES[kind], cacheControl: "public, max-age=31536000, immutable" } });
  return key;
}

/** Saved design (R2 keys) → what the storefront gets (media URLs, every section listed). */
export function designOut(env: Env, d: Partial<DesignDTO>): DesignDTO {
  const url = (k: string | null | undefined) => (!k ? null : /^(https?:)?\//.test(k) ? k : mediaUrl(env, k));
  return {
    ...DEFAULT_DESIGN,
    ...d,
    colors: { ...DEFAULT_DESIGN.colors, ...d.colors },
    featured: { ...DEFAULT_DESIGN.featured, ...d.featured },
    logo: url(d.logo),
    heroImage: url(d.heroImage),
    heroVideo: url(d.heroVideo),
    banners: (d.banners ?? []).filter((b) => b.image).map((b) => ({ ...b, image: url(b.image)! })),
    sections: resolveSections(d.sections),
  };
}
