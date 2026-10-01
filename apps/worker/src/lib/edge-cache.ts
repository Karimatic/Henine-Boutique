/**
 * Tiny wrapper around the Cache API (per-PoP, free, no KV write limits).
 * Used for public read endpoints so thousands of visitors cost a handful of D1 reads.
 */
export async function cached(
  req: Request,
  ctx: { waitUntil(promise: Promise<unknown>): void },
  ttlSeconds: number,
  produce: () => Promise<Response>,
): Promise<Response> {
  const cache = caches.default;
  const key = new Request(new URL(req.url).toString(), { method: "GET" });
  const hit = await cache.match(key);
  // responses from the Cache API have immutable headers; copy so middleware can add security headers
  if (hit) return new Response(hit.body, hit);

  const res = await produce();
  if (res.ok) {
    const copy = new Response(res.clone().body, res);
    copy.headers.set("Cache-Control", `public, max-age=${ttlSeconds}`);
    ctx.waitUntil(cache.put(key, copy));
    const out = new Response(res.body, res);
    out.headers.set("Cache-Control", `public, max-age=${ttlSeconds}`);
    return out;
  }
  return res;
}
