import { useCallback, useEffect, useState } from "react";

export class ApiError extends Error {
  constructor(
    public status: number,
    public code: string,
    public details?: unknown,
  ) {
    super(code);
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`/api${path}`, {
      ...init,
      headers: init?.body && !(init.body instanceof FormData) ? { "Content-Type": "application/json", ...init.headers } : init?.headers,
    });
  } catch {
    throw new ApiError(0, "network");
  }
  const body = (await res.json().catch(() => null)) as { error?: string; details?: unknown } | null;
  if (!res.ok) throw new ApiError(res.status, body?.error ?? "generic", body?.details);
  return body as T;
}

export const apiGet = <T,>(path: string) => request<T>(path);
export const apiPost = <T,>(path: string, data: unknown) => request<T>(path, { method: "POST", body: JSON.stringify(data) });
/** multipart form (files): the browser sets the Content-Type with its boundary */
/** one key per checkout: a double tap or a retry never creates two orders */
export function newIdempotencyKey(): string {
  return crypto.randomUUID();
}

export const apiForm = <T,>(path: string, form: FormData) => request<T>(path, { method: "POST", body: form, headers: {} });

/* Tiny SWR-style cache: identical GETs across components share one request. */
const cache = new Map<string, { at: number; data?: unknown; promise?: Promise<unknown> }>();
const TTL = 60_000;

function load<T>(path: string): Promise<T> {
  const hit = cache.get(path);
  if (hit?.data !== undefined && Date.now() - hit.at < TTL) return Promise.resolve(hit.data as T);
  if (hit?.promise) return hit.promise as Promise<T>;
  const promise = apiGet<T>(path).then(
    (data) => {
      cache.set(path, { at: Date.now(), data });
      return data;
    },
    (err) => {
      cache.delete(path);
      throw err;
    },
  );
  cache.set(path, { at: Date.now(), promise });
  return promise;
}

export function useApi<T>(path: string | null) {
  const cached = path ? (cache.get(path)?.data as T | undefined) : undefined;
  const [state, setState] = useState<{ data?: T; error?: ApiError; loading: boolean }>({ data: cached, loading: !!path && cached === undefined });
  const [tick, setTick] = useState(0);

  useEffect(() => {
    if (!path) return;
    let alive = true;
    setState((s) => ({ ...s, loading: s.data === undefined }));
    load<T>(path).then(
      (data) => alive && setState({ data, loading: false }),
      (error: ApiError) => alive && setState({ error, loading: false }),
    );
    return () => {
      alive = false;
    };
  }, [path, tick]);

  const reload = useCallback(() => {
    if (path) cache.delete(path);
    setTick((t) => t + 1);
  }, [path]);

  return { ...state, reload };
}

/** Slug from the current URL: /produit/<slug> or /fr/produit/<slug>. */
export function slugFromPath(pathname: string): string {
  const last = pathname.replace(/\/+$/, "").split("/").pop() ?? "";
  return decodeURIComponent(last);
}
