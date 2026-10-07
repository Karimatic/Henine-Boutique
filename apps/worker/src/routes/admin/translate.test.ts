import { describe, expect, it } from "vitest";
import type { Env } from "../../env";
import { translate } from "./translate";

const envWith = (content: string | Error) =>
  ({
    AI: {
      run: async () => {
        if (content instanceof Error) throw content;
        return { choices: [{ message: { content } }] };
      },
    },
  }) as unknown as Env;

describe("admin translation (French ↔ Arabic)", () => {
  it("returns the model's translation, without quotes", async () => {
    expect(await translate(envWith("« بيجامة ساتان »"), "Pyjama satin", "ar")).toBe("بيجامة ساتان");
  });
  it("fails cleanly without AI or when the model fails", async () => {
    await expect(translate({} as Env, "Pyjama", "ar")).rejects.toMatchObject({ status: 503 });
    await expect(translate(envWith(new Error("4006")), "Pyjama", "ar")).rejects.toMatchObject({ status: 503 });
  });
});
