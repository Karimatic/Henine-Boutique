import type { CategoryDTO, ProductCardDTO } from "@henine/shared";
import { ProductImage } from "@/components/ui/kit";
import { useLocale } from "@/lib/locale";

/** Category tile: picture on top, name + count underneath (text never covers the image). */
export function CategoryCard({ c, sample, wide = false }: { c: CategoryDTO; sample?: ProductCardDTO; wide?: boolean }) {
  const { t, href, ar } = useLocale();
  return (
    <a href={href(`/c/${c.slug}`)} className="lift group block overflow-hidden rounded-3xl border border-line bg-surface">
      <div className={`relative overflow-hidden ${wide ? "aspect-[16/9] md:aspect-[4/5]" : "aspect-[4/5]"}`}>
        <ProductImage
          image={sample?.image ?? null}
          alt=""
          category={c.slug}
          color={sample?.colors[0]}
          className="absolute inset-0 transition duration-500 group-hover:scale-105"
        />
      </div>
      <div className="flex items-center justify-between gap-2 px-4 py-3">
        <div className="min-w-0">
          <p className="heading-display text-lg leading-snug md:text-2xl">{ar ? c.nameAr : c.nameFr}</p>
          <p className="text-xs text-ink-soft">
            <span dir="ltr">{c.productCount ?? 0}</span> {t.categories.products}
          </p>
        </div>
        <span aria-hidden="true" className="grid size-9 shrink-0 place-items-center rounded-full bg-ink text-on-ink transition group-hover:bg-plum-600 rtl:rotate-180">
          →
        </span>
      </div>
    </a>
  );
}
