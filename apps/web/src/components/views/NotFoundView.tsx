import { Blossom } from "@/components/ui/icons";
import { useLocale } from "@/lib/locale";

/** Any address that doesn't exist (dist/404.html): back to the shop in one tap. */
export function NotFoundView() {
  const { t, href } = useLocale();
  return (
    <section className="mx-auto flex max-w-xl flex-col items-center px-4 py-20 text-center">
      <Blossom size={48} className="animate-bloom" />
      <p className="heading-display mt-6 text-6xl text-plum-600" dir="ltr">
        404
      </p>
      <h1 className="heading-display mt-3 text-2xl sm:text-3xl">{t.notFound.title}</h1>
      <p className="mt-2 text-ink-soft">{t.notFound.text}</p>
      <div className="mt-8 flex flex-wrap justify-center gap-3">
        <a href={href("/")} className="rounded-full bg-plum-600 px-6 py-3 font-semibold text-white transition hover:bg-plum-700">
          {t.notFound.cta}
        </a>
        <a href={href("/categories")} className="rounded-full border border-line bg-surface px-6 py-3 font-semibold transition hover:border-plum-600/40">
          {t.notFound.browse}
        </a>
      </div>
    </section>
  );
}
