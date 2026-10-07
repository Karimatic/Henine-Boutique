/**
 * French ↔ Arabic everywhere: the Arabic always follows the French. When a field labelled
 * "… (français)" / "(FR)" is left with new text, its twin "… (arabe)" / "(AR)" is rewritten with
 * the translation. The other way round, Arabic typed first fills the French twin only when it is
 * empty or still holds an automatic translation (French typed by hand is never replaced).
 * Works on every form of the admin without touching them: fields are matched by their labels.
 */
import { post } from "../api";

// "Nom (français)", "Titre (FR)", "الاسم (فرنسية)", "Colonne 1 en français", "العمود 1 بالفرنسية"
const FR = /(?:\(\s*(?:français|fr|فرنسية|بالفرنسية|فرنسي)\s*\)|\s(?:en français|بالفرنسية))\s*$/i;
const AR = /(?:\(\s*(?:arabe|ar|عربي|عربية|بالعربية)\s*\)|\s(?:en arabe|بالعربية))\s*$/i;

type Box = HTMLInputElement | HTMLTextAreaElement;
const isBox = (el: EventTarget | null): el is Box => el instanceof HTMLTextAreaElement || (el instanceof HTMLInputElement && ["text", "search", ""].includes(el.type));

/** The label's own words (not its hint), e.g. "Nom (français)". */
function labelOf(el: Box): string {
  const label = (el.id && document.querySelector(`label[for="${CSS.escape(el.id)}"]`)) || el.closest("label");
  if (!label) return el.getAttribute("aria-label") ?? "";
  return [...label.childNodes]
    .filter((n) => n.nodeType === Node.TEXT_NODE)
    .map((n) => n.textContent)
    .join("")
    .trim();
}

function langOf(el: Box): { lang: "fr" | "ar"; base: string } | null {
  const label = labelOf(el);
  const lang = FR.test(label) ? "fr" : AR.test(label) ? "ar" : null;
  return lang ? { lang, base: label.replace(lang === "fr" ? FR : AR, "").trim().toLowerCase() } : null;
}

/** The field with the same name in the other language, in the nearest block holding both. */
function twinOf(el: Box, me: { lang: "fr" | "ar"; base: string }): Box | null {
  let scope: HTMLElement | null = el.parentElement;
  for (let depth = 0; scope && depth < 8; depth++, scope = scope.parentElement) {
    for (const other of scope.querySelectorAll<Box>("input, textarea")) {
      if (other === el || !isBox(other)) continue;
      const o = langOf(other);
      if (o && o.lang !== me.lang && o.base === me.base) return other;
    }
  }
  return null;
}

/** Sets a React-controlled field as if typed (React hears the input event). */
function fill(el: Box, value: string) {
  const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
  Object.getOwnPropertyDescriptor(proto, "value")!.set!.call(el, value);
  el.dispatchEvent(new Event("input", { bubbles: true }));
}

const startValue = new WeakMap<Box, string>();
const autoValue = new WeakMap<Box, string>();

export function installAutoTranslate(onDone: (lang: "fr" | "ar") => void, onFail: () => void): () => void {
  const focusIn = (e: FocusEvent) => {
    if (isBox(e.target)) startValue.set(e.target, e.target.value);
  };
  const focusOut = (e: FocusEvent) => {
    const el = e.target;
    if (!isBox(el)) return;
    const text = el.value.trim();
    if (!text || text === (startValue.get(el) ?? "").trim()) return;
    const me = langOf(el);
    if (!me) return;
    const twin = twinOf(el, me);
    if (!twin || twin.disabled || twin.readOnly) return;
    const before = twin.value;
    // the Arabic follows the French; French typed by hand is never replaced from the Arabic
    if (me.lang === "ar" && before.trim() && autoValue.get(twin) !== before) return;
    const to = me.lang === "fr" ? "ar" : "fr";
    const placeholder = twin.placeholder;
    twin.placeholder = to === "ar" ? "✨ ترجمة…" : "✨ Traduction…";
    post<{ text: string }>("/translate", { text, to })
      .then((r) => {
        if (twin.value !== before) return; // she started typing meanwhile
        fill(twin, r.text);
        autoValue.set(twin, twin.value);
        twin.classList.add("auto-translated");
        setTimeout(() => twin.classList.remove("auto-translated"), 1600);
        onDone(to);
      })
      .catch(onFail)
      .finally(() => {
        twin.placeholder = placeholder;
      });
  };
  document.addEventListener("focusin", focusIn);
  document.addEventListener("focusout", focusOut);
  return () => {
    document.removeEventListener("focusin", focusIn);
    document.removeEventListener("focusout", focusOut);
  };
}
