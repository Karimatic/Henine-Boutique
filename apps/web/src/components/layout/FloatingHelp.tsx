import { useEffect, useRef, useState } from "react";
import { formatDA, type AssistantReplyDTO } from "@henine/shared";
import { ProductImage, Spinner } from "@/components/ui/kit";
import { apiPost } from "@/lib/api";
import { useLocale } from "@/lib/locale";
import { useSite, whatsappLink } from "@/lib/site";
import { cartStore, favoritesStore, ordersStore, recentStore } from "@/lib/stores";

export function WhatsAppIcon({ size = 26 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" fill="currentColor" aria-hidden="true">
      <path d="M16 3C9 3 3.3 8.6 3.3 15.6c0 2.4.7 4.7 1.9 6.7L3 29l6.9-2.1c1.9 1 4 1.6 6.1 1.6 7 0 12.7-5.7 12.7-12.7S23 3 16 3Zm0 23.2c-1.9 0-3.8-.5-5.4-1.5l-.4-.2-4.1 1.2 1.3-4-.3-.4a10.4 10.4 0 0 1-1.6-5.6C5.5 9.9 10.2 5.3 16 5.3s10.4 4.6 10.4 10.4S21.8 26.2 16 26.2Zm5.7-7.8c-.3-.2-1.9-.9-2.2-1s-.5-.2-.7.2-.8 1-1 1.2-.4.2-.7.1a8.5 8.5 0 0 1-4.2-3.7c-.3-.5.3-.5.9-1.6.1-.2 0-.4 0-.5l-1-2.4c-.3-.6-.5-.5-.7-.5h-.6c-.2 0-.6.1-.9.4s-1.2 1.1-1.2 2.8 1.2 3.3 1.4 3.5c.2.2 2.4 3.7 5.8 5.2 2.2.9 3 1 4.1.8.7-.1 1.9-.8 2.2-1.5s.3-1.4.2-1.5c-.1-.2-.3-.3-.6-.4Z" />
    </svg>
  );
}

/**
 * Bottom corner, every page: the ✨ shopping assistant (WhatsApp is in the menu, the contact
 * page and the product pages). Lifted above the phone's buy bar on product pages,
 * hidden at checkout (its own confirm bar is there).
 */
export function FloatingHelp() {
  const { t, locale } = useLocale();
  const [path, setPath] = useState("");
  const [open, setOpen] = useState(false);
  // once per visit: a little bubble introducing the assistant, gone after a few seconds
  const [hint, setHint] = useState(false);
  useEffect(() => setPath(location.pathname.replace(/^\/fr(?=\/|$)/, "") || "/"), []);
  useEffect(() => {
    let seen = "1";
    try {
      seen = sessionStorage.getItem("henine.assistantHint") ?? "";
      sessionStorage.setItem("henine.assistantHint", "1");
    } catch {
      /* private mode: no bubble */
    }
    if (seen) return;
    const show = setTimeout(() => setHint(true), 5000);
    const hide = setTimeout(() => setHint(false), 13000);
    return () => {
      clearTimeout(show);
      clearTimeout(hide);
    };
  }, []);
  useEffect(() => {
    const show = () => setOpen(true);
    window.addEventListener("henine:assistant", show);
    return () => window.removeEventListener("henine:assistant", show);
  }, []);
  if (!path || path.startsWith("/commande")) return null;
  // pages with a bar fixed at the bottom (buy bar, outfit total): sit above it
  const onProduct = path.startsWith("/produit/") || path.startsWith("/tenue");
  return (
    <>
      <div
        className={`follow-nav fixed end-3 z-30 flex flex-col items-end gap-2.5 md:bottom-6 md:end-6 ${
          onProduct ? "bottom-[calc(var(--nav-h)+4.75rem+env(safe-area-inset-bottom))]" : "bottom-[calc(var(--nav-h)+0.75rem+env(safe-area-inset-bottom))]"
        }`}
      >
        {hint && (
          <button
            type="button"
            onClick={() => {
              setHint(false);
              setOpen(true);
            }}
            className="toast-in max-w-[14rem] rounded-2xl rounded-ee-sm bg-surface px-3.5 py-2.5 text-start text-sm font-medium shadow-[0_12px_30px_-10px_rgb(23_10_16/0.45)] ring-1 ring-line"
          >
            {t.plus.assistant.hint}
          </button>
        )}
        <button
          type="button"
          onClick={() => {
            setHint(false);
            setOpen(true);
          }}
          aria-label={t.plus.assistant.open}
          className={`assistant-fab lift relative flex h-12 items-center gap-2 overflow-hidden rounded-full bg-gradient-to-br from-rose-500 via-plum-600 to-plum-700 ps-1.5 text-sm ${onProduct ? "pe-1.5 md:pe-4" : "pe-4"} font-semibold text-white shadow-[0_12px_30px_-8px_rgb(142_16_72/0.7)] ring-2 ring-white/80`}
        >
          <span className="grid size-9 place-items-center rounded-full bg-white/20" aria-hidden="true">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor" className="assistant-spark">
              <path d="M12 2c.6 4.6 2.4 6.4 7 7-4.6.6-6.4 2.4-7 7-.6-4.6-2.4-6.4-7-7 4.6-.6 6.4-2.4 7-7Z" />
              <path d="M19 14c.3 2 1 2.7 3 3-2 .3-2.7 1-3 3-.3-2-1-2.7-3-3 2-.3 2.7-1 3-3Z" opacity=".8" />
            </svg>
          </span>
          {/* on a product page's phone layout: the icon only, the page needs the room */}
          <span className={`whitespace-nowrap ${onProduct ? "max-md:hidden" : ""}`}>{t.plus.assistant.short}</span>
        </button>
      </div>
      {open && <AssistantPanel onClose={() => setOpen(false)} locale={locale} />}
    </>
  );
}

type Turn = { q: string; reply?: AssistantReplyDTO; error?: boolean };

function AssistantPanel({ onClose, locale }: { onClose: () => void; locale: "fr" | "ar" }) {
  const { t, href, ar } = useLocale();
  const A = t.plus.assistant;
  const site = useSite();
  const [q, setQ] = useState("");
  const [turns, setTurns] = useState<Turn[]>([]);
  const [busy, setBusy] = useState(false);
  const lastSearch = useRef<string | null>(null);
  const end = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => {
    input.current?.focus();
    const esc = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", esc);
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", esc);
      document.body.style.overflow = "";
    };
  }, [onClose]);
  useEffect(() => {
    end.current?.scrollIntoView({ behavior: "smooth", block: "end" }); // braces: scrollIntoView now returns a Promise, not a cleanup
  }, [turns, busy]);

  async function ask(text: string) {
    const wish = text.trim();
    if (wish.length < 2 || busy) return;
    setQ("");
    setBusy(true);
    setTurns((list) => [...list, { q: wish }]);
    try {
      // what this phone knows, so she can ask "my last product", "my order", "my cart"…
      const context = {
        recent: recentStore.get().slice(0, 12),
        favorites: favoritesStore.get().slice(0, 50),
        cart: cartStore.get().slice(0, 30).map((i) => ({ slug: i.slug, qty: i.qty, price: i.price })),
        orders: ordersStore.get().slice(0, 3).map((o) => ({ code: o.code, token: o.token })),
        previous: lastSearch.current ?? undefined,
        // the conversation so far, so "and in red?" or "the second one" make sense
        history: turns
          .filter((x) => x.reply)
          .slice(-4)
          .map((x) => ({
            q: x.q.slice(0, 300),
            a: (x.reply!.reply ?? x.reply!.products.map((p) => (ar ? p.nameAr : p.nameFr)).join(", ")).slice(0, 600),
          })),
      };
      const reply = await apiPost<AssistantReplyDTO>("/assistant", { q: wish, locale, context });
      if (reply.intent === "search") lastSearch.current = wish;
      setTurns((list) => list.map((x, i) => (i === list.length - 1 ? { ...x, reply } : x)));
    } catch {
      setTurns((list) => list.map((x, i) => (i === list.length - 1 ? { ...x, error: true } : x)));
    } finally {
      setBusy(false);
    }
  }
  const wa = whatsappLink(site.data?.contact.whatsapp, t.plus.whatsapp.hello);

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-noir/40 backdrop-blur-[2px] md:items-center" role="dialog" aria-modal="true" aria-label={A.title} onClick={onClose}>
      <div className="flex max-h-[88dvh] w-full max-w-lg flex-col overflow-hidden rounded-t-[1.75rem] bg-ivory shadow-2xl md:rounded-[1.75rem]" onClick={(e) => e.stopPropagation()}>
        <header className="flex items-center justify-between gap-3 bg-gradient-to-br from-plum-600 to-plum-700 px-5 py-4 text-white">
          <div>
            <p className="heading-display text-xl">{A.title}</p>
            <p className="text-xs text-white/75">{ar ? "من منتجاتنا المتوفرة فقط" : "Uniquement nos pièces en stock"}</p>
          </div>
          <button type="button" onClick={onClose} className="grid size-10 place-items-center rounded-full bg-white/15 text-lg" aria-label={t.common.close}>
            ✕
          </button>
        </header>

        <div className="flex-1 space-y-4 overflow-y-auto p-4" aria-live="polite">
          <p className="rounded-2xl rounded-ss-sm bg-surface p-3.5 text-sm leading-relaxed shadow-sm">{A.intro}</p>
          {turns.length === 0 && (
            <div className="flex flex-wrap gap-2">
              {A.examples.map((ex) => (
                <button key={ex} type="button" onClick={() => ask(ex)} className="rounded-full border border-plum-600/30 bg-surface px-3.5 py-2 text-start text-sm text-plum-700">
                  {ex}
                </button>
              ))}
            </div>
          )}
          {turns.map((turn, i) => (
            <div key={i} className="space-y-2.5">
              <p className="ms-auto w-fit max-w-[85%] rounded-2xl rounded-se-sm bg-ink px-3.5 py-2.5 text-sm text-on-ink">{turn.q}</p>
              {turn.error && <p className="text-sm text-danger">{t.common.error}</p>}
              {turn.reply && (
                <div className="space-y-2.5">
                  {turn.reply.understood.length > 0 && (
                    <p className="flex flex-wrap items-center gap-1.5 text-xs text-ink-soft">
                      {A.understood}
                      {turn.reply.understood.map((u) => (
                        <span key={u} className="rounded-full bg-rose-100 px-2.5 py-1 font-medium text-plum-700">{u}</span>
                      ))}
                    </p>
                  )}
                  {turn.reply.reply ? (
                    <p className="w-fit max-w-[92%] whitespace-pre-line rounded-2xl rounded-ss-sm bg-surface px-3.5 py-2.5 text-sm leading-relaxed shadow-sm ring-1 ring-line">
                      {turn.reply.reply}
                    </p>
                  ) : (
                    <p className="text-sm font-semibold">
                      {turn.reply.products.length === 0 ? A.none : turn.reply.relaxed ? A.relaxed : A.found(turn.reply.products.length)}
                    </p>
                  )}
                  <ul className="space-y-2">
                    {turn.reply.products.map((p) => (
                      <li key={p.id}>
                        <a href={href(`/produit/${p.slug}`)} className="flex gap-3 rounded-2xl bg-surface p-2.5 shadow-sm ring-1 ring-line transition hover:ring-plum-600/40">
                          <ProductImage image={p.image} alt="" category={p.categorySlug} color={p.colors[0]} sizes="80px" className="aspect-[4/5] w-18 shrink-0 rounded-xl" />
                          <span className="min-w-0 flex-1">
                            <span className="line-clamp-1 font-semibold">{ar ? p.nameAr : p.nameFr}</span>
                            <span className="mt-0.5 flex items-baseline gap-2 text-sm" dir="ltr">
                              <b>{formatDA(p.price, locale)}</b>
                              {p.compareAtPrice && p.compareAtPrice > p.price && <s className="text-xs text-ink-soft">{formatDA(p.compareAtPrice, locale)}</s>}
                            </span>
                            <span className="mt-1 block space-y-0.5 text-xs text-ink-soft">
                              {p.why.map((w) => (
                                <span key={w} className="block">✓ {w}</span>
                              ))}
                            </span>
                          </span>
                        </a>
                      </li>
                    ))}
                  </ul>
                  {(turn.reply.actions ?? []).length > 0 && (
                    <div className="flex flex-wrap gap-2">
                      {turn.reply.actions!.map((a) => {
                        const external = /^https?:/.test(a.href);
                        return (
                          <a
                            key={a.href}
                            href={external ? a.href : href(a.href)}
                            {...(external ? { target: "_blank", rel: "noopener noreferrer" } : {})}
                            className="inline-flex h-10 items-center rounded-full bg-plum-600 px-4 text-sm font-semibold text-white"
                          >
                            {a.label}
                          </a>
                        );
                      })}
                    </div>
                  )}
                  {turn.reply.products.length === 0 && !turn.reply.reply && wa && (
                    <a href={wa} target="_blank" rel="noopener noreferrer" className="inline-flex h-10 items-center gap-2 rounded-full bg-[#25D366] px-4 text-sm font-semibold text-white">
                      <WhatsAppIcon size={18} /> WhatsApp
                    </a>
                  )}
                </div>
              )}
            </div>
          ))}
          {busy && (
            <p className="flex items-center gap-2 text-sm text-ink-soft">
              <Spinner className="size-4" /> {A.thinking}
            </p>
          )}
          <div ref={end} />
        </div>

        <form
          className="flex gap-2 border-t border-line bg-surface p-3 pb-[calc(0.75rem+env(safe-area-inset-bottom))]"
          onSubmit={(e) => {
            e.preventDefault();
            void ask(q);
          }}
        >
          <input
            ref={input}
            value={q}
            onChange={(e) => setQ(e.target.value)}
            maxLength={300}
            placeholder={A.placeholder}
            aria-label={A.placeholder}
            className="h-12 min-w-0 flex-1 rounded-full border border-line bg-ivory px-4 text-[16px] outline-none focus:border-plum-600"
          />
          <button type="submit" disabled={busy || q.trim().length < 2} className="h-12 shrink-0 rounded-full bg-plum-600 px-5 font-semibold text-white disabled:opacity-50">
            {A.send}
          </button>
        </form>
      </div>
    </div>
  );
}

/** Opens the assistant from anywhere (search page "ask the assistant"). */
export function openAssistant() {
  window.dispatchEvent(new Event("henine:assistant"));
}
