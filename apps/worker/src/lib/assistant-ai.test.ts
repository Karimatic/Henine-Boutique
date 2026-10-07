import { describe, expect, it } from "vitest";
import { assistantInput, type AssistantReplyDTO } from "@henine/shared";
import type { Env } from "../env";
import { seedShop, testDb } from "../test/db";
import { answer } from "./assistant-intents";
import { amountsIn, parseModelReply, withAiVoice } from "./assistant-ai";

const product = (price: number) =>
  ({
    id: 1, slug: "pyjama-satin", nameFr: "Pyjama satin", nameAr: "بيجامة ساتان", price, compareAtPrice: null, categorySlug: "pyjamas", tags: [], image: null,
    colors: [], inStock: true, createdAt: 0, rating: null, badge: null, labels: [], flash: null, why: ["Existe en noir"],
  }) as AssistantReplyDTO["products"][number];

const ruled: AssistantReplyDTO = { intent: "search", understood: ["Couleur : noir"], relaxed: false, products: [product(3500)] };
const input = (q: string) => assistantInput.parse({ q, locale: "fr", context: { history: [{ q: "bonjour", a: "Bonjour 🌸" }] } });

/** an env whose AI answers `content` (or fails) and records what it was asked */
function envWith(answer: string | Error) {
  const calls: { model: string; inputs: { messages: { role: string; content: string }[] } }[] = [];
  const AI = {
    run: async (model: string, inputs: (typeof calls)[number]["inputs"]) => {
      calls.push({ model, inputs });
      if (answer instanceof Error) throw answer;
      return { choices: [{ message: { content: answer } }] };
    },
  };
  return { env: { DB: testDb(), AI } as unknown as Env, calls };
}

describe("assistant AI voice", () => {
  it("reads amounts however they are written", () => {
    expect(amountsIn("3 500 DA, 2.500 دج, ٤٠٠٠, code 16")).toEqual(["3500", "2500", "4000"]);
  });

  it("parses JSON, fenced JSON and plain text", () => {
    expect(parseModelReply('{"reply":"Salut","showProducts":false}')).toEqual({ reply: "Salut", showProducts: false });
    expect(parseModelReply('```json\n{"reply":"Salut","showProducts":true}\n```')).toEqual({ reply: "Salut", showProducts: true });
    expect(parseModelReply("Bonjour !")).toEqual({ reply: "Bonjour !", showProducts: true });
    expect(parseModelReply('{"broken"')).toBeNull();
  });

  it("words the rules' facts and keeps their products", async () => {
    const { env, calls } = envWith('{"reply":"Voici notre pyjama satin noir à 3 500 DA 🌸","showProducts":true}');
    const out = await withAiVoice(env, input("pyjama noir"), ruled, "1.2.3.4");
    expect(out).toMatchObject({ ai: true, reply: "Voici notre pyjama satin noir à 3 500 DA 🌸", understood: ruled.understood });
    expect(out.products).toHaveLength(1);
    // the facts and the conversation reach the model
    const msgs = calls[0]!.inputs.messages;
    expect(msgs[0]!.role).toBe("system");
    expect(msgs.map((m) => m.role)).toEqual(["system", "user", "assistant", "user"]);
    expect(msgs.at(-1)!.content).toContain('"priceDA":3500');
  });

  it("keeps the rules' answer when the model invents an amount", async () => {
    const { env } = envWith('{"reply":"Il est à 2 900 DA","showProducts":true}');
    expect(await withAiVoice(env, input("prix ?"), ruled, "ip")).toBe(ruled);
  });

  it("falls back to the rules on an error or without the binding", async () => {
    expect(await withAiVoice(envWith(new Error("4006: daily free allocation used")).env, input("pyjama"), ruled, "ip")).toBe(ruled);
    expect(await withAiVoice({ DB: testDb() } as unknown as Env, input("pyjama"), ruled, "ip")).toBe(ruled);
    expect(await withAiVoice({ ...envWith("x").env, ASSISTANT_MODEL: "off" } as Env, input("pyjama"), ruled, "ip")).toBe(ruled);
  });

  it("hides products only when the rules searched blindly", async () => {
    const off = '{"reply":"Je suis là pour la boutique 🌸","showProducts":false}';
    const blind = { ...ruled, understood: [] };
    expect((await withAiVoice(envWith(off).env, input("tu aimes le foot ?"), blind, "ip")).products).toEqual([]);
    expect((await withAiVoice(envWith(off).env, input("pyjama noir"), ruled, "ip")).products).toHaveLength(1);
  });

  it("shows no products for a message that is not about clothes", async () => {
    const db = testDb();
    seedShop(db);
    const env = { DB: db } as unknown as Env;
    const offTopic = await answer(env, assistantInput.parse({ q: "هل انت ai حقيقي", locale: "ar" }));
    expect(offTopic.products).toEqual([]);
    expect(offTopic.reply).toContain("Henine");
    const search = await answer(env, assistantInput.parse({ q: "بيجامة", locale: "ar" }));
    expect(search.products.map((p) => p.slug)).toEqual(["pyjama"]);
  });
});
