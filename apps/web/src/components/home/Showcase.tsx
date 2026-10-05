"use client";

import { artKey, mainCategories, type CategoryDTO, type ProductCardDTO, type ReviewWallDTO } from "@henine/shared";
import { ProductGrid } from "@/components/product/ProductCard";
import { InstagramIcon, TRUST_ICONS } from "@/components/ui/icons";
import { Stars } from "@/components/ui/kit";
import { useApi } from "@/lib/api";
import { useLocale } from "@/lib/locale";
import { useRecent } from "@/lib/stores";
import { Reveal, SectionHead } from "./Sections";

const IG = "https://www.instagram.com/henine.boutique/";

/* ───────── Instagram-style story bubbles (the shop's own highlights) ───────── */

type Story = { key: string; label: string; href: string; external?: boolean; category?: string; art?: string };

/* Story artwork: a soft gradient per bubble with a fine white line drawing (no photos). */
const STORY_GRADIENT: Record<string, string> = {
  new: "from-[#f3d9a4] via-rose-500 to-plum-600",
  robes: "from-rose-300 via-rose-500 to-plum-700",
  lingerie: "from-[#f6b9cf] via-rose-500 to-[#7b1747]",
  djebba: "from-[#f3d9a4] via-rose-500 to-[#7b1747]",
  pyjamas: "from-[#fbd3e1] via-rose-300 to-plum-600",
  set: "from-[#f9c6d6] via-rose-500 to-plum-700",
  sport: "from-[#d9c8f2] via-plum-600 to-noir",
  promo: "from-plum-600 via-plum-700 to-noir",
};

const STORY_LINES: Record<string, React.ReactNode> = {
  // 4-point sparkle with two small ones
  new: (
    <>
      <path d="M32 12c1.6 9 4 11.4 13 13-9 1.6-11.4 4-13 13-1.6-9-4-11.4-13-13 9-1.6 11.4-4 13-13Z" />
      <path d="M47 38c.6 3 1.4 3.8 4.4 4.4-3 .6-3.8 1.4-4.4 4.4-.6-3-1.4-3.8-4.4-4.4 3-.6 3.8-1.4 4.4-4.4Z" />
      <path d="M17 40c.5 2.2 1 2.8 3.2 3.2-2.2.5-2.7 1-3.2 3.2-.5-2.2-1-2.7-3.2-3.2 2.2-.4 2.7-1 3.2-3.2Z" />
    </>
  ),
  // dress
  robes: <path d="M26 12h12l-1.5 7 6 6-3 5c3 8 6 15 8 22H17c2-7 5-14 8-22l-3-5 6-6L26 12Zm1.5 7h9M24.5 30c5 1.5 10 1.5 15 0" />,
  // nightie with thin straps and lace hem
  lingerie: (
    <>
      <path d="M26 12v9m12-9v9M24 21c3 3 13 3 16 0 1 5 2 8 4 11-1 7 1 13 4 20H16c3-7 5-13 4-20 2-3 3-6 4-11Z" />
      <path d="M16 52c2-2 4-2 6 0s4 2 6 0 4-2 6 0 4 2 6 0 4-2 6 0" />
    </>
  ),
  // djebba: long traditional dress, wide sleeves, embroidered neckline and hem
  djebba: (
    <>
      <path d="M27 10h10l2 5 9 5-3 10-4-2c1 8 3 16 6 24H17c3-8 5-16 6-24l-4 2-3-10 9-5 2-5Z" />
      <path d="M27 10c1 4 9 4 10 0M29 15l3 4 3-4M20 48h24M22 44l2 2 2-2 2 2 2-2 2 2 2-2 2 2 2-2 2 2 2-2" />
    </>
  ),
  // pyjama shirt + trousers
  pyjamas: (
    <>
      <path d="M24 10h16l9 6-4 7-4-2v12H23V21l-4 2-4-7 9-6Zm8 0v23m-3-18h6" />
      <path d="M23 37h18l2 18h-7l-4-12-4 12h-7l2-18Z" />
    </>
  ),
  // lingerie set: bra + briefs
  set: (
    <>
      <path d="M14 20c4-7 11-8 16-2h4c5-6 12-5 16 2l-2 8c-5 3-11 1-16-4-5 5-11 7-16 4Z" />
      <path d="M20 38h24l-3 10c-3 5-6 7-9 7s-6-2-9-7Z" />
    </>
  ),
  // tracksuit: hoodie + joggers
  sport: (
    <>
      <path d="M26 9c2 3 4 4 6 4s4-1 6-4l9 5-3 12-5-2v10H25V24l-5 2-3-12Z" />
      <path d="M25 38h14l3 18h-6l-4-12-4 12h-6Z" />
    </>
  ),
  // hanger, for any other category
  other: <path d="M32 18a4 4 0 1 1 4-4c0 3-4 3-4 7l18 12c2 1.4 1 4-1.5 4H15.5c-2.5 0-3.5-2.6-1.5-4L32 21" />,
};

export function StoryArt({ kind }: { kind: string }) {
  const gradient = STORY_GRADIENT[kind] ?? "from-rose-300 via-rose-500 to-plum-600";
  return (
    <span className={`grid size-full place-items-center bg-gradient-to-br ${gradient} text-white transition duration-500 group-hover:scale-110`}>
      {kind === "promo" ? (
        <span className="text-[1.35rem] font-bold leading-none">%</span>
      ) : (
        <svg viewBox="0 0 64 64" className="size-[66%]" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          {STORY_LINES[kind] ?? STORY_LINES.other}
        </svg>
      )}
    </span>
  );
}

export function Stories({ categories, products }: { categories: CategoryDTO[] | undefined; products: ProductCardDTO[] }) {
  const { t, href, ar } = useLocale();
  const S = t.home.stories;
  const onSale = products.some((p) => p.compareAtPrice != null && p.compareAtPrice > p.price);
  const stories: Story[] = [
    // main categories only (their sub-categories are one tap further)
    ...mainCategories(categories ?? []).map((c) => ({ key: c.slug, label: ar ? c.nameAr : c.nameFr, href: href(`/c/${c.slug}`), category: c.slug, art: artKey(c.slug) })),
    ...(onSale ? [{ key: "promo", label: S.promo, href: "#promos" }] : []),
  ];
  return (
    <nav aria-label={t.categories.title} className="mx-auto max-w-6xl">
      <ul className="swipe-row mx-auto flex w-fit max-w-full gap-3.5 overflow-x-auto px-4 pb-1 pt-1 md:gap-6">
        {stories.map((s, i) => (
          <li key={s.key} className="shrink-0">
            <a
              href={s.href}
              {...(s.external ? { target: "_blank", rel: "noopener noreferrer" } : {})}
              className="story group flex w-[4.6rem] flex-col items-center gap-1.5 text-center"
              style={{ animationDelay: `${i * 60}ms` }}
            >
              <span className="story-ring grid size-[4.4rem] place-items-center rounded-full p-[3px]">
                <span className="relative block size-full overflow-hidden rounded-full border-[3px] border-white">
                  <StoryArt kind={s.art ?? s.key} />
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
      <ul className="grid grid-cols-3 overflow-hidden rounded-[1.4rem] bg-noir text-white">
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

/** The shop's Instagram photos (shown inside the Instagram card). */
export function LookbookGrid() {
  return (
    <ul className="grid grid-cols-3 gap-1.5 md:grid-cols-6 md:gap-3">
        {LOOKS.map((src, i) => (
          <li key={src} className={i === 0 ? "col-span-2 row-span-2 md:col-span-2" : ""}>
            <Reveal delay={i * 70} className="h-full">
              <a href={IG} target="_blank" rel="noopener noreferrer" className="group relative block h-full overflow-hidden rounded-2xl bg-ivory-deep" aria-label="Instagram">
                <img src={src} alt="" loading="lazy" className={`w-full object-cover transition duration-700 group-hover:scale-110 ${i === 0 ? "aspect-square h-full" : "aspect-square"}`} />
                <span className="absolute inset-0 grid place-items-center bg-noir/0 text-white opacity-0 transition group-hover:bg-noir/35 group-hover:opacity-100">
                  <InstagramIcon size={28} />
                </span>
              </a>
            </Reveal>
          </li>
        ))}
    </ul>
  );
}

/* ───────── Contests (Instagram) ───────── */

export function ContestCard() {
  const { t } = useLocale();
  const C = t.home.contest;
  return (
    <section className="mx-auto max-w-6xl px-4 py-6">
      <Reveal>
        <a href={IG} target="_blank" rel="noopener noreferrer" className="lift group relative flex items-center gap-4 overflow-hidden rounded-[1.75rem] bg-noir p-5 text-white md:p-8">
          <img src="/ig/pyjamas-rose.jpg" alt="" loading="lazy" className="absolute inset-y-0 end-0 h-full w-1/2 object-cover opacity-45 [mask-image:linear-gradient(to_left,black,transparent)] rtl:[mask-image:linear-gradient(to_right,black,transparent)]" />
          <span className="relative grid size-14 shrink-0 place-items-center rounded-2xl bg-gradient-to-br from-[#e9c98f] via-rose-500 to-plum-600 text-2xl shadow-lg transition group-hover:scale-105">🎁</span>
          <span className="relative min-w-0 flex-1">
            <span className="block text-xs font-semibold uppercase tracking-[0.16em] text-rose-300">{C.eyebrow}</span>
            <span className="heading-display mt-0.5 block text-xl leading-snug md:text-3xl">{C.title}</span>
            <span className="mt-1 block text-sm text-white/70">{C.text}</span>
          </span>
          <span aria-hidden="true" className="relative grid size-10 shrink-0 place-items-center rounded-full bg-surface text-ink rtl:rotate-180">→</span>
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
            <p className="mt-3 inline-flex items-center gap-2 rounded-full bg-surface px-4 py-2 text-sm shadow-sm">
              <b className="text-lg" dir="ltr">{data.avg.toFixed(1)}</b>
              <Stars value={data.avg} size={16} />
              <span className="text-ink-soft">{R.based(data.count)}</span>
            </p>
          )}
        </div>
        <ul className="swipe-row flex gap-3 overflow-x-auto px-4 pb-2 md:grid md:grid-cols-3 md:overflow-visible">
          {data.reviews.map((r) => (
            <li key={r.id} className="w-[80%] shrink-0 md:w-auto">
              <figure className="flex h-full flex-col rounded-[1.4rem] bg-surface p-5 shadow-[0_1px_2px_rgb(23_10_16/0.05)]">
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
