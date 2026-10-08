import { describe, expect, it, vi } from "vitest";
import { CheckTokens, retryOnCheckFailure } from "./check-token";

describe("anti-robot check tokens", () => {
  it("hands each token over once and asks for a fresh one", async () => {
    const box = new CheckTokens();
    const refresh = vi.fn();
    box.onRefresh(refresh);
    box.set("t1");
    expect(await box.take()).toBe("t1");
    expect(refresh).toHaveBeenCalledTimes(1);
    // the second attempt waits for the new token instead of reusing the first
    const next = box.take();
    box.set("t2");
    expect(await next).toBe("t2");
  });

  it("waits for a check still running, then gives up with 'pending'", async () => {
    vi.useFakeTimers();
    const box = new CheckTokens(1000);
    const early = box.take();
    box.set("late-but-in-time");
    expect(await early).toBe("late-but-in-time");
    const never = box.take();
    vi.advanceTimersByTime(1000);
    expect(await never).toBe("pending");
    vi.useRealTimers();
  });

  it("an expired token is not sent", async () => {
    const box = new CheckTokens();
    box.set("old");
    box.set(""); // expired
    const t = box.take();
    box.set("renewed");
    expect(await t).toBe("renewed");
  });

  it("keeps the 'no check here' values", async () => {
    const box = new CheckTokens();
    const refresh = vi.fn();
    box.onRefresh(refresh);
    box.set("no-site-key");
    expect(await box.take()).toBe("no-site-key");
    expect(await box.take()).toBe("no-site-key");
    expect(refresh).not.toHaveBeenCalled();
  });

  it("retries once when the check failed, not for other errors", async () => {
    const isCheck = (e: unknown) => (e as Error).message === "turnstile_failed";
    let calls = 0;
    expect(await retryOnCheckFailure(async () => (++calls === 1 ? Promise.reject(new Error("turnstile_failed")) : "ok"), isCheck)).toBe("ok");
    expect(calls).toBe(2);
    calls = 0;
    await expect(retryOnCheckFailure(async () => (++calls, Promise.reject(new Error("stock_problem"))), isCheck)).rejects.toThrow("stock_problem");
    expect(calls).toBe(1);
  });
});
