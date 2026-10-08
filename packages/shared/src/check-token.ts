/**
 * Anti-robot check tokens (Cloudflare Turnstile) on the forms: a token works only once and
 * expires after a few minutes. `take()` waits for the check if it is still running, hands the
 * token over once and asks the widget for a fresh one, so a second attempt has its own.
 */

/** Values meaning "no check possible here" (no site key, script blocked): never used up. */
const STANDING = new Set(["no-site-key", "unavailable"]);

export class CheckTokens {
  private token = "";
  private waiters: ((t: string) => void)[] = [];
  private refresh: (() => void) | null = null;

  constructor(private readonly waitMs = 15000) {}

  /** the widget produced a token ("" when it expired or failed) */
  set(token: string) {
    this.token = token;
    if (token) for (const resolve of this.waiters.splice(0)) resolve(token);
  }

  /** how to ask the widget for a new token */
  onRefresh(refresh: () => void) {
    this.refresh = refresh;
  }

  /** the token for one submission ("pending" if none came in time: the server refuses, she can retry) */
  async take(): Promise<string> {
    const t =
      this.token ||
      (await new Promise<string>((resolve) => {
        this.waiters.push(resolve);
        setTimeout(() => resolve(this.token || "pending"), this.waitMs);
      }));
    if (!STANDING.has(t)) {
      this.token = "";
      this.refresh?.();
    }
    return t;
  }
}

/** Sends once more, with a new token, when the server says the check failed (an expired or late token). */
export async function retryOnCheckFailure<T>(send: () => Promise<T>, isCheckFailure: (err: unknown) => boolean): Promise<T> {
  try {
    return await send();
  } catch (err) {
    if (isCheckFailure(err)) return send();
    throw err;
  }
}
