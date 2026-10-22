/**
 * Admin → Produits → photos: upload (validated, stored in R2), order and deletion.
 */
import { Hono } from "hono";
import { z } from "zod";
import type { AppEnv } from "../../env";
import { auditStmt } from "../../lib/audit";
import { imageRef, mediaUrl, type ImageRow } from "../../lib/catalog";
import { putVideo } from "../../lib/media";
import { randomToken } from "../../lib/crypto";
import { body, HttpError, intParam } from "../../lib/http";
import { bumpCatalogStmt } from "../../lib/settings";
import { actorOf, requirePermission } from "../../middleware/access";
import { optText, unusedImageKeys } from "./catalog-shared";

export const photoRoutes = new Hono<AppEnv>();

/* ───────────── Photos (R2) ─────────────
 * The admin browser resizes and encodes each photo (480/960/1440 px, WebP or JPEG) and strips
 * EXIF/GPS by re-drawing it on a canvas. The Worker only validates and stores the files.
 */

const MAX_FILE = 1_500_000;
const SIGNATURES: [string, (b: Uint8Array) => boolean][] = [
  ["webp", (b) => b[0] === 0x52 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x46 && b[8] === 0x57 && b[9] === 0x45 && b[10] === 0x42 && b[11] === 0x50],
  ["jpg", (b) => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff],
];

photoRoutes.post("/products/:id/images", requirePermission("products.edit"), async (c) => {
  const productId = intParam(c, "id");
  const exists = await c.env.DB.prepare("SELECT id FROM products WHERE id = ?").bind(productId).first();
  if (!exists) throw new HttpError(404, "not_found");
  const form = await c.req.formData();
  const width = Number(form.get("width"));
  const height = Number(form.get("height"));
  const lqip = String(form.get("lqip") ?? "");
  const optionValueId = form.get("optionValueId") ? Number(form.get("optionValueId")) : null;
  if (!width || !height || width > 10000 || height > 10000) throw new HttpError(422, "invalid_dimensions");
  if (lqip && (!lqip.startsWith("data:image/") || lqip.length > 3000)) throw new HttpError(422, "invalid_lqip");

  const files: { w: number; data: Uint8Array; ext: string }[] = [];
  for (const w of [480, 960, 1440]) {
    const f = form.get(`w${w}`);
    if (!(f instanceof File)) continue;
    if (f.size > MAX_FILE) throw new HttpError(413, "file_too_large");
    const data = new Uint8Array(await f.arrayBuffer());
    const ext = SIGNATURES.find(([, test]) => test(data))?.[0];
    if (!ext) throw new HttpError(415, "unsupported_image"); // magic bytes, not the declared type
    files.push({ w, data, ext });
  }
  if (!files.length) throw new HttpError(422, "no_files");
  const ext = files[0]!.ext;
  if (files.some((f) => f.ext !== ext)) throw new HttpError(422, "mixed_formats");

  const baseKey = `p/${productId}/${randomToken(9)}-{w}.${ext}`;
  await Promise.all(
    files.map((f) =>
      c.env.MEDIA.put(baseKey.replace("{w}", String(f.w)), f.data, {
        httpMetadata: { contentType: ext === "webp" ? "image/webp" : "image/jpeg", cacheControl: "public, max-age=31536000, immutable" },
      }),
    ),
  );
  const sort = await c.env.DB.prepare("SELECT COALESCE(MAX(sort), -1) + 1 AS s FROM product_images WHERE product_id = ?").bind(productId).first<{ s: number }>();
  const row = await c.env.DB.prepare(
    "INSERT INTO product_images (product_id, option_value_id, base_key, widths, width, height, lqip, sort) VALUES (?, ?, ?, ?, ?, ?, ?, ?) RETURNING *",
  )
    .bind(productId, optionValueId, baseKey, JSON.stringify(files.map((f) => f.w)), width, height, lqip || null, sort?.s ?? 0)
    .first<ImageRow>();
  await c.env.DB.batch([bumpCatalogStmt(c.env), auditStmt(c.env, actorOf(c.get("member")), "upload", "product_image", row!.id, { productId })]);
  return c.json({ id: row!.id, ...imageRef(c.env, row!) }, 201);
});

photoRoutes.put("/products/:id/images", requirePermission("products.edit"), async (c) => {
  const productId = intParam(c, "id");
  const input = await body(
    c,
    z.array(z.object({ id: z.number().int().positive(), optionValueId: z.number().int().positive().nullable(), altFr: optText(160), altAr: optText(160) })).max(40),
  );
  await c.env.DB.batch([
    ...input.map((img, i) =>
      c.env.DB.prepare("UPDATE product_images SET sort = ?, option_value_id = ?, alt_fr = ?, alt_ar = ? WHERE id = ? AND product_id = ?").bind(
        i, img.optionValueId, img.altFr ?? null, img.altAr ?? null, img.id, productId,
      ),
    ),
    bumpCatalogStmt(c.env),
  ]);
  return c.json({ ok: true });
});

photoRoutes.delete("/images/:id", requirePermission("products.edit"), async (c) => {
  const id = intParam(c, "id");
  const img = await c.env.DB.prepare("SELECT base_key, widths FROM product_images WHERE id = ?").bind(id).first<{ base_key: string; widths: string }>();
  if (!img) throw new HttpError(404, "not_found");
  await c.env.DB.batch([
    c.env.DB.prepare("DELETE FROM product_images WHERE id = ?").bind(id),
    bumpCatalogStmt(c.env),
    auditStmt(c.env, actorOf(c.get("member")), "delete", "product_image", id),
  ]);
  const keys = await unusedImageKeys(c.env, [img]);
  if (keys.length) c.executionCtx.waitUntil(c.env.MEDIA.delete(keys));
  return c.json({ ok: true });
});

/* ───────────── Video (one per product) ─────────────
 * A short video of the piece (worn, turning, the fabric moving): MP4 / WebM / MOV, 40 MB at
 * most, stored as it is (no re-encoding on the free plan: film it in 720p, under 30 s). The
 * product page shows it in the photo gallery, streamed in pieces like the home banner video.
 */
photoRoutes.post("/products/:id/video", requirePermission("products.edit"), async (c) => {
  const id = intParam(c, "id");
  const p = await c.env.DB.prepare("SELECT video_key FROM products WHERE id = ?").bind(id).first<{ video_key: string | null }>();
  if (!p) throw new HttpError(404, "not_found");
  const form = await c.req.formData().catch(() => null);
  const file = form?.get("video");
  if (!(file instanceof File)) throw new HttpError(422, "validation_failed", { video: "required" });
  const key = await putVideo(c.env, `products/video/${id}`, file);
  await c.env.DB.batch([
    c.env.DB.prepare("UPDATE products SET video_key = ?, updated_at = ? WHERE id = ?").bind(key, Date.now(), id),
    bumpCatalogStmt(c.env),
    auditStmt(c.env, actorOf(c.get("member")), "video", "product", id, { size: file.size }),
  ]);
  if (p.video_key) c.executionCtx.waitUntil(c.env.MEDIA.delete(p.video_key));
  return c.json({ video: mediaUrl(c.env, key) });
});

photoRoutes.delete("/products/:id/video", requirePermission("products.edit"), async (c) => {
  const id = intParam(c, "id");
  const p = await c.env.DB.prepare("SELECT video_key FROM products WHERE id = ?").bind(id).first<{ video_key: string | null }>();
  if (!p) throw new HttpError(404, "not_found");
  await c.env.DB.batch([
    c.env.DB.prepare("UPDATE products SET video_key = NULL, updated_at = ? WHERE id = ?").bind(Date.now(), id),
    bumpCatalogStmt(c.env),
    auditStmt(c.env, actorOf(c.get("member")), "video_delete", "product", id),
  ]);
  if (p.video_key) c.executionCtx.waitUntil(c.env.MEDIA.delete(p.video_key));
  return c.json({ ok: true });
});
