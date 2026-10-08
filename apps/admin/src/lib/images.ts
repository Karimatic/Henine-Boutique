/**
 * Photo pipeline, entirely in the browser (zero server CPU, zero image-service cost):
 *  - decodes the photo with its EXIF orientation applied
 *  - re-draws it on a canvas → strips EXIF/GPS metadata (privacy: phone photos carry location)
 *  - exports 480 / 960 / 1440 px widths as WebP (JPEG where the browser can't encode WebP, e.g. older iPhones)
 *  - builds a tiny blurred placeholder (LQIP) shown while the real image loads
 */
export interface ProcessedImage {
  files: Record<number, Blob>;
  width: number;
  height: number;
  lqip: string;
  format: "webp" | "jpg";
}

const WIDTHS = [480, 960, 1440];

let webpSupported: boolean | null = null;
function canEncodeWebp(): boolean {
  if (webpSupported == null) {
    const c = document.createElement("canvas");
    c.width = c.height = 1;
    webpSupported = c.toDataURL("image/webp").startsWith("data:image/webp");
  }
  return webpSupported;
}

function toBlob(canvas: HTMLCanvasElement, type: string, quality: number): Promise<Blob> {
  return new Promise((resolve, reject) => canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("encode_failed"))), type, quality));
}

/** `transparent`: a photo without background (studio): the transparency is kept (WebP), with a
 *  white ground only where the browser can just make JPEG, and a transparent placeholder. */
export async function processImage(file: File, transparent = false): Promise<ProcessedImage> {
  if (!file.type.startsWith("image/")) throw new Error("not_an_image");
  const bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
  try {
    const format = canEncodeWebp() ? "webp" : "jpg";
    const mime = format === "webp" ? "image/webp" : "image/jpeg";
    const files: Record<number, Blob> = {};
    const canvas = document.createElement("canvas");
    const ctx = canvas.getContext("2d")!;
    for (const w of WIDTHS) {
      const width = Math.min(w, bitmap.width);
      const height = Math.round((bitmap.height / bitmap.width) * width);
      canvas.width = width;
      canvas.height = height;
      ctx.imageSmoothingQuality = "high";
      if (transparent && format === "jpg") {
        ctx.fillStyle = "#ffffff";
        ctx.fillRect(0, 0, width, height);
      }
      ctx.drawImage(bitmap, 0, 0, width, height);
      files[w] = await toBlob(canvas, mime, w <= 480 ? 0.78 : 0.82);
      if (width < w) break; // source smaller than this width: no need for bigger copies
    }
    // LQIP: 16 px wide, low quality JPEG data URL (~400 bytes)
    const lw = 16;
    const lh = Math.max(1, Math.round((bitmap.height / bitmap.width) * lw));
    canvas.width = lw;
    canvas.height = lh;
    ctx.drawImage(bitmap, 0, 0, lw, lh);
    // a transparent photo keeps a transparent placeholder (PNG): the shop's background shows through
    const png = transparent ? canvas.toDataURL("image/png") : "";
    const lqip = png && png.length <= 3000 ? png : canvas.toDataURL("image/jpeg", 0.5);
    return { files, width: bitmap.width, height: bitmap.height, lqip, format };
  } finally {
    bitmap.close();
  }
}
