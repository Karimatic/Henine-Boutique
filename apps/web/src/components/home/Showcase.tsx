"use client";

import type { CategoryDTO, ProductCardDTO, ReviewWallDTO } from "@henine/shared";
import { ProductGrid } from "@/components/product/ProductCard";
import { InstagramIcon, TruckIcon, TRUST_ICONS } from "@/components/ui/icons";
import { ProductImage, Stars } from "@/components/ui/kit";
import { useApi } from "@/lib/api";
import { useLocale } from "@/lib/locale";
import { useRecent } from "@/lib/stores";
import { Reveal, SectionHead } from "./Sections";

const IG = "https://www.instagram.com/henine.boutique/";

/* ───────── Instagram-style story bubbles (the shop's own highlights) ───────── */

type Story = { key: string; label: string; href: string; external?: boolean; img?: string; product?: ProductCardDTO; category?: string; icon?: "truck" | "percent" };

export function Stories({ categories, products }: { categories: CategoryDTO[] | undefined; products: ProductCardDTO[] }) {
  const { t, href, ar } = useLocale();
  const S = t.home.stories;
  const onSale = products.some((p) => p.compareAtPrice != null && p.compareAtPrice > p.price);
  // square crops of the shop's Instagram photos (clothes only)
  const CATEGORY_PHOTO: Record<string, string> = { pyjamas: "/ig/story-pyjamas.jpg", robes: "/ig/story-robes.jpg" };
  const stories: Story[] = [
    { key: "new", label: S.nouveautes, href: href("/nouveautes"), img: "/ig/story-nouveautes.jpg" },
    ...(categories ?? []).map((c) => ({
      key: c.slug,
      label: ar ? c.nameAr : c.nameFr,
      href: href(`/c/${c.slug}`),
      img: CATEGORY_PHOTO[c.slug],
      product: products.find((p) => p.categorySlug === c.slug && p.image),
      category: c.slug,
    })),
    ...(onSale ? [{ key: "promo", label: S.promo, href: "#promos", icon: "percent" as const }] : []),
  ];
  return (
    <nav aria-label={t.categories.title} className="mx-auto max-w-6xl">
      <ul className="swipe-row flex gap-3.5 overflow-x-auto px-4 pb-1 pt-1 md:justify-center md:gap-6">
        {stories.map((s, i) => (
          <li key={s.key} className="shrink-0">
            <a
              href={s.href}
              {...(s.external ? { target: "_blank", rel: "noopener noreferrer" } : {})}
              className="story group flex w-[4.6rem] flex-col items-center gap-1.5 text-center"
              style={{ animationDelay: `${i * 60}ms` }}
            >
              <span className="story-ring grid size-[4.4rem] place-items-center rounded-full p-[3px]">
                <span className="relative block size-full overflow-hidden rounded-full border-[3px] border-white bg-ivory-deep">
                  {s.img ? (
                    <img src={s.img} alt="" loading="lazy" className="size-full object-cover transition duration-500 group-hover:scale-110" />
                  ) : !s.product?.image && s.category ? (
                    // no photo yet: brand art with the category's silhouette
                    <span className="grid size-full place-items-center bg-gradient-to-br from-rose-300 via-rose-500 to-plum-600">
                      <ProductImage image={null} alt="" category={s.category} color="#ffffff" className="size-[78%] bg-none! [&_path]:stroke-white/40" />
                    </span>
                  ) : s.icon ? (
                    <span className="grid size-full place-items-center bg-ink text-white">
                      {s.icon === "truck" ? <TruckIcon size={24} /> : <span className="text-xl font-bold">%</span>}
                    </span>
                  ) : (
                    <ProductImage image={s.product?.image ?? null} alt="" category={s.category} color={s.product?.colors[0]} sizes="72px" className="size-full" />
                  )}
                </span>
              </span>
              <span className="line-clamp-1 w-full text-[11.5px] font-semibold leading-tight">{s.label}</span>
            </a>
          </li>
        ))}
      </ul>
    </nav>
  );
}

/* ───────── The 3 promises: a dark band ───────── */

export function PromiseBand() {
  const { t, href } = useLocale();
  return (
    <div className="mx-auto max-w-6xl px-4">
      <ul className="grid grid-cols-3 overflow-hidden rounded-[1.4rem] bg-ink text-white">
        {t.trust.slice(0, 3).map((item, i) => {
          const Icon = TRUST_ICONS[item.icon as keyof typeof TRUST_ICONS];
          return (
            <li key={item.title} className={i ? "border-s border-white/10" : ""}>
              <a
                href={href(item.icon === "truck" ? "/p/livraison-retours" : item.icon === "swap" ? "/p/livraison-retours" : "/p/cgv")}
                className="flex h-full flex-col items-center gap-1.5 px-2 py-4 text-center transition hover:bg-white/5 md:flex-row md:justify-center md:gap-3 md:py-5"
              >
                <Icon size={22} className="shrink-0 text-[#e9c98f]" />
                <span className="text-[11.5px] font-semibold leading-tight md:text-sm">{item.title}</span>
              </a>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

/* ───────── Lookbook: the shop's Instagram posts ───────── */

const LOOKS = [
  "/ig/pyjamas-rose.jpg",
  "/ig/ensemble-maille.jpg",
  "/ig/pantalons-pyjama.jpg",
  "/ig/sweat-noir.jpg",
  "/ig/chaussettes.jpg",
  "/ig/boutique.jpg",
];

export function Lookbook() {
  const { t } = useLocale();
  const L = t.home.lookbook;
  return (
    <section className="mx-auto max-w-6xl px-4 py-10">
      <div className="mb-5 text-center">
        <p className="text-xs font-semibold tracking-[0.18em] text-rose-700" dir="ltr">{L.eyebrow}</p>
        <h2 className="heading-display mt-1 text-[1.65rem] leading-tight md:text-4xl">{L.title}</h2>
      </div>
      <ul className="grid grid-cols-3 gap-1.5 md:grid-cols-6 md:gap-3">
        {LOOKS.map((src, i) => (
          <li key={src} className={i === 0 ? "col-span-2 row-span-2 md:col-span-2" : ""}>
            <Reveal delay={i * 70} className="h-full">
              <a href={IG} target="_blank" rel="noopener noreferrer" className="group relative block h-full overflow-hidden rounded-2xl bg-ivory-deep" aria-label="Instagram">
                <img src={src} alt="" loading="lazy" className={`w-full object-cover transition duration-700 group-hover:scale-110 ${i === 0 ? "aspect-square h-full" : "aspect-square"}`} />
                <span className="absolute inset-0 grid place-items-center bg-ink/0 text-white opacity-0 transition group-hover:bg-ink/35 group-hover:opacity-100">
                  <InstagramIcon size={28} />
                </span>
              </a>
            </Reveal>
          </li>
        ))}
      </ul>
      <div className="mt-5 flex justify-center">
        <a href={IG} target="_blank" rel="noopener noreferrer" className="lift inline-flex h-12 items-center gap-2 rounded-full bg-ink px-6 font-semibold text-white">
          <InstagramIcon size={18} />
          {L.cta}
        </a>
      </div>
    </section>
  );
}

/* ───────── Contests (Instagram) ───────── */

export function ContestCard() {
  const { t } = useLocale();
  const C = t.home.contest;
  return (
    <section className="mx-auto max-w-6xl px-4 py-6">
      <Reveal>
        <a href={IG} target="_blank" rel="noopener noreferrer" className="lift group relative flex items-center gap-4 overflow-hidden rounded-[1.75rem] bg-ink p-5 text-white md:p-8">
          <img src="/ig/pyjamas-rose.jpg" alt="" loading="lazy" className="absolute inset-y-0 end-0 h-full w-1/2 object-cover opacity-45 [mask-image:linear-gradient(to_left,black,transparent)] rtl:[mask-image:linear-gradient(to_right,black,transparent)]" />
          <span className="relative grid size-14 shrink-0 place-items-center rounded-2xl bg-gradient-to-br from-[#e9c98f] via-rose-500 to-plum-600 text-2xl shadow-lg transition group-hover:scale-105">🎁</span>
          <span className="relative min-w-0 flex-1">
            <span className="block text-xs font-semibold uppercase tracking-[0.16em] text-rose-300">{C.eyebrow}</span>
            <span className="heading-display mt-0.5 block text-xl leading-snug md:text-3xl">{C.title}</span>
            <span className="mt-1 block text-sm text-white/70">{C.text}</span>
          </span>
          <span aria-hidden="true" className="relative grid size-10 shrink-0 place-items-center rounded-full bg-white text-ink rtl:rotate-180">→</span>
        </a>
      </Reveal>
    </section>
  );
}

/* ───────── Review wall: verified reviews from every product ───────── */

export function ReviewWall() {
  const { t, href, ar } = useLocale();
  const R = t.home.reviews;
  const { data } = useApi<ReviewWallDTO>("/reviews");
  if (!data || !data.count || !data.reviews.length) return null;
  return (
    <section className="bg-ivory-deep/70 py-12">
      <div className="mx-auto max-w-6xl">
        <div className="mb-6 px-4 text-center">
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-rose-700">{R.eyebrow}</p>
          <h2 className="heading-display mt-1 text-[1.65rem] leading-tight md:text-4xl">{R.title}</h2>
          {data.avg != null && (
            <p className="mt-3 inline-flex items-center gap-2 rounded-full bg-white px-4 py-2 text-sm shadow-sm">
              <b className="text-lg" dir="ltr">{data.avg.toFixed(1)}</b>
              <Stars value={data.avg} size={16} />
              <span className="text-ink-soft">{R.based(data.count)}</span>
            </p>
          )}
        </div>
        <ul className="swipe-row flex gap-3 overflow-x-auto px-4 pb-2 md:grid md:grid-cols-3 md:overflow-visible">
          {data.reviews.map((r) => (
            <li key={r.id} className="w-[80%] shrink-0 md:w-auto">
              <figure className="flex h-full flex-col rounded-[1.4rem] bg-white p-5 shadow-[0_1px_2px_rgb(23_10_16/0.05)]">
                <span aria-hidden="true" className="heading-display text-4xl leading-none text-rose-300">“</span>
                <Stars value={r.rating} size={15} />
                {r.text && <blockquote className="mt-2 flex-1 text-[15px] leading-relaxed">{r.text}</blockquote>}
                <figcaption className="mt-4 flex items-center justify-between gap-2 border-t border-line pt-3 text-sm">
                  <span>
                    <b className="block">{r.name}</b>
                    <a href={href(`/produit/${r.productSlug}`)} className="text-xs text-ink-soft hover:text-plum-600">
                      {ar ? r.productAr : r.productFr}
                    </a>
                  </span>
                  {r.verified && <span className="shrink-0 rounded-full bg-emerald-50 px-2 py-1 text-[11px] font-semibold text-emerald-700">✓ {R.verified}</span>}
                </figcaption>
              </figure>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}

/* ───────── Recently viewed (this phone only) ───────── */

export function RecentlyViewed({ products, exclude }: { products: ProductCardDTO[]; exclude?: string }) {
  const { t } = useLocale();
  const recent = useRecent();
  const list = recent
    .filter((s) => s !== exclude)
    .map((s) => products.find((p) => p.slug === s))
    .filter((p): p is ProductCardDTO => !!p)
    .slice(0, 4);
  if (!list.length) return null;
  return (
    <section className="mx-auto max-w-6xl px-4 py-6">
      <SectionHead title={t.home.recent} />
      <ProductGrid products={list} />
    </section>
  );
}
