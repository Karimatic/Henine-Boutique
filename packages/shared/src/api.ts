/**
 * JSON contracts between the Worker API and the two front-ends.
 * Money is integer DA. Times are epoch milliseconds.
 */
import type { OrderStatus } from "./order-status";

/* ───────────── Media ───────────── */

export interface ImageRef {
  /** URL template with a "{w}" width placeholder, e.g. "/media/p/12/9f2c1a-{w}.webp" (see imageUrl) */
  src: string;
  widths: number[];
  width: number;
  height: number;
  lqip: string | null;
  altFr: string | null;
  altAr: string | null;
  optionValueId: number | null;
}

/** Concrete URL for the closest available width ≥ wanted (or the largest). */
export function imageUrl(img: ImageRef, wanted: number): string {
  const sorted = [...img.widths].sort((a, b) => a - b);
  const w = sorted.find((x) => x >= wanted) ?? sorted[sorted.length - 1] ?? wanted;
  return img.src.replace("{w}", String(w));
}

export function imageSrcSet(img: ImageRef): string {
  return [...img.widths].sort((a, b) => a - b).map((w) => `${img.src.replace("{w}", String(w))} ${w}w`).join(", ");
}

/* ───────────── Catalogue ───────────── */

export interface CategoryDTO {
  id: number;
  slug: string;
  nameFr: string;
  nameAr: string;
  image: string | null;
  productCount?: number;
}

export interface ProductCardDTO {
  id: number;
  slug: string;
  nameFr: string;
  nameAr: string;
  price: number;
  compareAtPrice: number | null;
  categorySlug: string | null;
  tags: string[];
  image: ImageRef | null;
  /** hex colours of the colour option, for swatches and placeholders */
  colors: string[];
  inStock: boolean;
  createdAt: number;
  rating: { avg: number; count: number } | null;
}

export interface OptionValueDTO {
  id: number;
  labelFr: string;
  labelAr: string;
  hex: string | null;
}

export interface OptionDTO {
  id: number;
  kind: "taille" | "couleur" | "autre";
  nameFr: string;
  nameAr: string;
  values: OptionValueDTO[];
}

export interface VariantDTO {
  id: number;
  sku: string;
  optionValueIds: number[];
  price: number;
  available: number;
}

export interface ReviewDTO {
  id: number;
  name: string;
  rating: number;
  text: string | null;
  verified: boolean;
  reply: string | null;
  createdAt: number;
}

export interface ProductDetailDTO extends ProductCardDTO {
  descriptionFr: string | null;
  descriptionAr: string | null;
  category: CategoryDTO | null;
  images: ImageRef[];
  options: OptionDTO[];
  variants: VariantDTO[];
  reviews: ReviewDTO[];
  seoTitle: string | null;
  seoDescription: string | null;
}

/* ───────────── Site configuration ───────────── */

export interface SiteConfigDTO {
  store: { name: string; taglineFr: string; taglineAr: string; cityFr: string; cityAr: string; hoursFr: string; hoursAr: string };
  announcement: { active: boolean; messagesFr: string[]; messagesAr: string[] };
  hero: { eyebrowFr: string; eyebrowAr: string; titleFr: string; titleAr: string; subtitleFr: string; subtitleAr: string };
  contact: { phone: string | null; whatsapp: string | null; instagram: string | null; tiktok: string | null; facebook: string | null; maps: string | null; addressFr: string | null; addressAr: string | null };
  checkout: { freeShippingOver: number | null; expressOnProduct: boolean; deskEnabled: boolean };
  turnstileSiteKey: string;
  maintenance: { active: boolean; messageFr: string; messageAr: string };
  faq: { qFr: string; aFr: string; qAr: string; aAr: string }[];
}

export interface WilayaDTO {
  code: number;
  fr: string;
  ar: string;
  home: number | null;
  desk: number | null;
  delay: string | null;
}

export interface CommuneDTO {
  id: number;
  fr: string;
  ar: string;
}

export interface LinkDTO {
  id: number;
  labelFr: string | null;
  labelAr: string | null;
  target: string;
  icon: string | null;
}

export interface PageDTO {
  slug: string;
  titleFr: string;
  titleAr: string;
  bodyFr: string;
  bodyAr: string;
}

/* ───────────── Checkout ───────────── */

export interface QuoteLineDTO {
  variantId: number;
  productId: number;
  slug: string;
  nameFr: string;
  nameAr: string;
  optionsFr: string;
  optionsAr: string;
  image: ImageRef | null;
  unitPrice: number;
  qty: number;
  available: number;
  lineTotal: number;
  problem: "out_of_stock" | "insufficient_stock" | "unavailable" | null;
}

export interface QuoteDTO {
  lines: QuoteLineDTO[];
  subtotal: number;
  discount: number;
  shipping: number | null;
  total: number;
  coupon: { code: string; valid: boolean; reason: string | null; label: string | null } | null;
  freeShipping: boolean;
  deliveryAvailable: boolean;
}

export interface CreatedOrderDTO {
  code: string;
  token: string;
  total: number;
  status: OrderStatus;
}

/* ───────────── Tracking ───────────── */

export interface TrackedOrderDTO {
  code: string;
  status: OrderStatus;
  createdAt: number;
  total: number;
  wilayaFr: string;
  wilayaAr: string;
  deliveryType: "domicile" | "bureau";
  trackingNumber: string | null;
  items: { nameFr: string; nameAr: string; options: string | null; qty: number; image: ImageRef | null }[];
  events: { status: string; at: number }[];
  /** only with a valid token */
  details: { name: string; phoneMasked: string; address: string | null; communeFr: string | null } | null;
}
