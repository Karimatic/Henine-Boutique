/** "Robe Satin Émeraude – Été 2026" → "robe-satin-emeraude-ete-2026" */
export function slugify(input: string): string {
  return input
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/['’]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
}

/** Loose search normalisation for French + Arabic (accents, tashkeel, alef/ya/ta-marbuta variants). */
export function normalizeSearch(input: string): string {
  return input
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[ً-ٰٟـ]/g, "") // tashkeel + tatweel
    .replace(/[إأآا]/g, "ا")
    .replace(/ى/g, "ي")
    .replace(/ة/g, "ه")
    .toLowerCase()
    .trim();
}

/* ───────────── Minimal safe Markdown ─────────────
 * Parsed into a tiny AST that React renders as elements: no HTML string is ever injected,
 * so admin-authored content cannot introduce script.
 * Supports: # / ## / ### headings, paragraphs, "- " lists, **bold**, *italic*, [text](https://…).
 */

export type Inline =
  | { t: "text"; v: string }
  | { t: "b"; v: string }
  | { t: "i"; v: string }
  | { t: "a"; v: string; href: string };

export type Block =
  | { t: "h"; level: 1 | 2 | 3; content: Inline[] }
  | { t: "p"; content: Inline[] }
  | { t: "ul"; items: Inline[][] };

const SAFE_HREF = /^(https?:\/\/|\/|mailto:|tel:)/i;

export function parseInline(src: string): Inline[] {
  const out: Inline[] = [];
  const re = /\*\*([^*]+)\*\*|\*([^*]+)\*|\[([^\]]+)\]\(([^)\s]+)\)/g;
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(src))) {
    if (m.index > last) out.push({ t: "text", v: src.slice(last, m.index) });
    if (m[1] !== undefined) out.push({ t: "b", v: m[1] });
    else if (m[2] !== undefined) out.push({ t: "i", v: m[2] });
    else if (m[3] !== undefined && m[4] !== undefined) {
      out.push(SAFE_HREF.test(m[4]) ? { t: "a", v: m[3], href: m[4] } : { t: "text", v: m[3] });
    }
    last = re.lastIndex;
  }
  if (last < src.length) out.push({ t: "text", v: src.slice(last) });
  return out;
}

export function parseMarkdown(src: string): Block[] {
  const blocks: Block[] = [];
  let para: string[] = [];
  let list: string[] = [];
  const flushPara = () => {
    if (para.length) blocks.push({ t: "p", content: parseInline(para.join(" ")) });
    para = [];
  };
  const flushList = () => {
    if (list.length) blocks.push({ t: "ul", items: list.map(parseInline) });
    list = [];
  };
  for (const raw of src.replace(/\r\n/g, "\n").split("\n")) {
    const line = raw.trim();
    const h = /^(#{1,3})\s+(.*)$/.exec(line);
    if (!line) {
      flushPara();
      flushList();
    } else if (h) {
      flushPara();
      flushList();
      blocks.push({ t: "h", level: h[1]!.length as 1 | 2 | 3, content: parseInline(h[2]!) });
    } else if (/^[-*]\s+/.test(line)) {
      flushPara();
      list.push(line.replace(/^[-*]\s+/, ""));
    } else {
      flushList();
      para.push(line);
    }
  }
  flushPara();
  flushList();
  return blocks;
}

/** Fill "{name}"-style placeholders (WhatsApp / Telegram templates). */
export function fillTemplate(template: string, vars: Record<string, string | number | null | undefined>): string {
  return template.replace(/\{(\w+)\}/g, (_, k: string) => String(vars[k] ?? ""));
}
