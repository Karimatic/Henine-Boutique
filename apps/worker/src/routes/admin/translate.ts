/**
 * French ↔ Arabic translation for the admin: typing a name, a description or a text in one
 * language fills its twin in the other (the admin calls this when a field is left). Workers AI
 * (free daily allocation, same model as the shop assistant); no binding or quota → 503 and the
 * field simply stays empty for the owner to fill.
 */
import { Hono } from "hono";
import { z } from "zod";
import type { AppEnv, Env } from "../../env";
import { DEFAULT_ASSISTANT_MODEL } from "../../lib/assistant-ai";
import { body, HttpError, rateLimit } from "../../lib/http";

export const translateRoutes = new Hono<AppEnv>();

const LANG = { fr: "French", ar: "Modern Standard Arabic (as used by Algerian shops)" } as const;

const SYSTEM = `You translate texts of Henine Boutique, a women's clothing shop in Algeria (pyjamas, nightgowns, lingerie, shapewear, bridal trousseau, sportswear, gandouras and djebbas), between French and Arabic.
Rules:
- Output ONLY the translation: no quotes, no explanation, no alternatives.
- Keep exactly: **bold** markers, line breaks, emojis, numbers, prices, sizes (S, M, L, XL, 38…), codes, links and brand names.
- Natural shop wording a customer would use. Examples: pyjama = بيجامة, nuisette = قميص نوم, robe de chambre = روب دو شامبر, ensemble = طقم, satin = ساتان, dentelle = دانتيل, coton = قطن, livraison = توصيل, paiement à la livraison = الدفع عند الاستلام.
- Address the customer in the feminine in Arabic, and politely in French.`;

export async function translate(env: Env, text: string, to: "fr" | "ar"): Promise<string> {
  if (!env.AI) throw new HttpError(503, "ai_unavailable");
  const model = env.ASSISTANT_MODEL && env.ASSISTANT_MODEL !== "off" ? env.ASSISTANT_MODEL : DEFAULT_ASSISTANT_MODEL;
  const run = env.AI.run.bind(env.AI) as unknown as (m: string, i: unknown) => Promise<{ response?: unknown; choices?: { message?: { content?: string | null } }[] }>;
  const out = await Promise.race([
    run(model, {
      messages: [
        { role: "system", content: SYSTEM },
        { role: "user", content: `Translate into ${LANG[to]}:\n\n${text}` },
      ],
      max_tokens: 900,
      temperature: 0.2,
      chat_template_kwargs: { enable_thinking: false },
    }),
    new Promise<never>((_, reject) => setTimeout(() => reject(new HttpError(503, "ai_timeout")), 12000)),
  ]).catch((err) => {
    throw err instanceof HttpError ? err : new HttpError(503, "ai_unavailable");
  });
  const raw = typeof out.response === "string" ? out.response : (out.choices?.[0]?.message?.content ?? "");
  const result = raw.trim().replace(/^["«“]+|["»”]+$/g, "").trim();
  if (!result) throw new HttpError(503, "ai_unavailable");
  return result;
}

translateRoutes.post("/translate", async (c) => {
  await rateLimit(c.env.RL_LOOKUP, `translate:${c.get("member").id}`);
  const input = await body(c, z.object({ text: z.string().trim().min(1).max(3000), to: z.enum(["fr", "ar"]) }));
  return c.json({ text: await translate(c.env, input.text, input.to) });
});
