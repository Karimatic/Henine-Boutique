/**
 * JSON contracts between the Worker API and the two front-ends.
 * Money is integer DA. Times are epoch milliseconds.
 */
import type { BoutiqueDTO } from "./boutique";
import type { DesignDTO } from "./design";
import type { ProductBadge } from "./insights";
import type { OrderStatus } from "./order-status";
import type { StoreTextOverrides } from "./store-texts";

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
  /** sub-category of (null: a main category) */
  parentId?: number | null;
  /** seasonal sub-category, shown first in its season */
  season?: "summer" | "winter" | null;
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
  /** arrival date: first publication (falls back to creation) */
  createdAt: number;
  rating: { avg: number; count: number } | null;
  /** data-driven sales badge (see BADGE_RULES), null when the numbers don't support one */
  badge: ProductBadge | null;
  /** size / colour names in both languages (search by colour or size) */
  labels: string[];
  /** in a flash sale right now: `price` is already the sale price, `compareAtPrice` the usual one */
  flash: FlashInfoDTO | null;
}

export interface FlashInfoDTO {
  saleId: number;
  percent: number;
  endsAt: number;
  /** pieces offered at this price (null = no limit) and already sold during the sale */
  limit: number | null;
  sold: number;
}

/** Flash sale running now, for the home page block (its products carry `flash`). */
export interface FlashSaleDTO {
  id: number;
  nameFr: string;
  nameAr: string;
  percent: number;
  endsAt: number;
  productIds: number[];
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
  /** customer photos (media URLs) */
  photos: string[];
}

/** Home page "what our customers say": verified reviews from every product. */
export interface ReviewWallDTO {
  avg: number | null;
  count: number;
  reviews: (ReviewDTO & { productSlug: string; productFr: string; productAr: string })[];
}

/** Size chart: same columns in both languages, cells are sizes / measurements. */
export interface SizeGuideDTO {
  headersFr: string[];
  headersAr: string[];
  rows: string[][];
  tipsFr: string | null;
  tipsAr: string | null;
}

/** Starting point offered in the admin (usual Algerian / EU women's sizes, to adjust). */
export const SIZE_GUIDE_TEMPLATE: Omit<SizeGuideDTO, "tipsFr" | "tipsAr"> & { tipsFr: string; tipsAr: string } = {
  // by height and weight: simple to know, nothing to measure on the body
  headersFr: ["Taille", "Hauteur (cm)", "Poids (kg)"],
  headersAr: ["المقاس", "الطول (سم)", "الوزن (كغ)"],
  rows: [
    ["S", "150-160", "45-53"],
    ["M", "155-165", "53-61"],
    ["L", "158-168", "61-70"],
    ["XL", "160-172", "70-80"],
    ["XXL", "162-175", "80-92"],
  ],
  tipsFr: "Choisissez selon votre hauteur et votre poids. Entre deux tailles ? Prenez la plus grande, ou écrivez-nous sur WhatsApp.",
  tipsAr: "اختاري حسب طولك ووزنك. بين مقاسين؟ اختاري الأكبر، أو راسلينا على واتساب.",
};

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
  /** "look": hand-picked or bought together; "similar": same category */
  related: ProductCardDTO[];
  relatedKind: "look" | "similar";
  /** size chart chosen for this product in the admin */
  sizeGuide: SizeGuideDTO | null;
}

/* ───────────── Collections / drops ───────────── */

export interface DropTeaserDTO {
  slug: string;
  nameFr: string;
  nameAr: string;
  startsAt: number | null;
  endsAt: number | null;
  showCountdown: boolean;
}

export interface CollectionDTO extends DropTeaserDTO {
  descriptionFr: string | null;
  descriptionAr: string | null;
  /** false until startsAt: products are hidden while a locked drop has not launched */
  launched: boolean;
  /** server clock, so the countdown doesn't depend on the phone's clock */
  now: number;
  image: ImageRef | null;
  products: ProductCardDTO[];
}

/* ───────────── Site configuration ───────────── */

/**
 * Store switches and contact details. Customer-facing texts (hero, announcement messages,
 * FAQ, opening hours…) are built into the storefront in both languages, so the visitor
 * always sees them in the language of the page.
 */
/** How the top banner's messages move: scrolling (default), fading, sliding up, or still. */
export const ANNOUNCEMENT_ANIMATIONS = ["scroll", "fade", "slide", "static"] as const;
export type AnnouncementAnimation = (typeof ANNOUNCEMENT_ANIMATIONS)[number];

export interface SiteConfigDTO {
  store: { name: string };
  /** « How did you hear about us? » at checkout: its answers (null = not asked) */
  heardFrom: { key: string; ar: string; fr: string; emoji: string }[] | null;
  announcement: { active: boolean; animation: AnnouncementAnimation };
  contact: {
    phone: string | null; whatsapp: string | null; instagram: string | null; tiktok: string | null; facebook: string | null; maps: string | null;
    /** Instagram follower count as the shop writes it ("+89K"); null = not shown */
    followers: string | null;
  };
  checkout: { freeShippingOver: number | null; expressOnProduct: boolean; deskEnabled: boolean };
  maintenance: { active: boolean };
  /** the team's edits to the built-in store texts, per language (see resolveStoreTexts) */
  texts: { ar: StoreTextOverrides; fr: StoreTextOverrides };
  /** next or current collection launch, for the home banner */
  drop: DropTeaserDTO | null;
  /** flash sale running now */
  flash: FlashSaleDTO | null;
  /** logo, colours, fonts, banners, home sections (Admin → Page d'accueil) */
  design: DesignDTO;
  /** the shop in Boumerdès: address, map, opening hours */
  boutique: BoutiqueDTO;
  /** whose pyjamas come first right now (Paramètres → Boutique → Saison) */
  season: "summer" | "winter";
}

/** Shopping assistant answer: real products only, with why each one fits. */
export interface AssistantReplyDTO {
  /** the answer in words (questions about delivery, the shop, her order…) */
  reply?: string;
  /** buttons under the answer: a page of the store */
  actions?: { label: string; href: string }[];
  /** what kind of question it was (product search, delivery, order…) */
  intent?: string;
  /** what was understood, in the visitor's language */
  understood: string[];
  products: (ProductCardDTO & { why: string[] })[];
  /** nothing matched every wish: these are the closest ones */
  relaxed: boolean;
  /** the reply was worded by the AI model (from the same facts) */
  ai?: boolean;
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
  /** home-delivery price for this commune when it differs from the wilaya price */
  home: number | null;
  /** false when couriers don't deliver at home here (stop-desk only) */
  homeOk: boolean;
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
  /** usual delivery time for the wilaya, e.g. "1-2" (days) */
  delay: string | null;
  /** loyalty points of this phone number (programme on, enough points): what they're worth here */
  points: { balance: number; usable: number; value: number; applied: boolean } | null;
}

export interface CreatedOrderDTO {
  code: string;
  token: string;
  total: number;
  status: OrderStatus;
}

/* ───────────── Tracking ───────────── */

export interface TrackedItemDTO {
  productId: number | null;
  slug: string | null;
  nameFr: string;
  nameAr: string;
  options: string | null;
  /** size / colour in Arabic (looked up from the variant; null if it no longer exists) */
  optionsAr: string | null;
  qty: number;
  unitPrice: number;
  image: ImageRef | null;
  /** with a valid token on a delivered order: a verified review can be left (once) */
  canReview: boolean;
  /** private link only: the line and its variant (to ask for an exchange) */
  orderItemId: number | null;
  variantId: number | null;
}

export interface TrackedOrderDTO {
  code: string;
  status: OrderStatus;
  createdAt: number;
  subtotal: number;
  discount: number;
  shipping: number;
  total: number;
  wilayaCode: number;
  wilayaFr: string;
  wilayaAr: string;
  communeFr: string | null;
  communeAr: string | null;
  deliveryType: "domicile" | "bureau";
  trackingNumber: string | null;
  items: TrackedItemDTO[];
  events: { status: string; at: number }[];
  /** only with a valid token */
  details: { name: string; phoneMasked: string; address: string | null } | null;
  /** private link only: not confirmed yet, so the customer can still fix her address or cancel */
  canChange: boolean;
  /** private link only, once delivered: did she get it? (null = not answered yet) */
  receipt: { confirmedAt: number | null; issue: string | null } | null;
  /** private link only: an exchange can still be asked (delivered recently) */
  canExchange: boolean;
  /** private link only: her exchange requests and where they stand */
  exchanges: { id: number; orderItemId: number; fromFr: string | null; fromAr: string | null; toFr: string; toAr: string; status: string; createdAt: number }[];
}

/** Reasons a customer can give when she cancels from her tracking link. */
export const CUSTOMER_CANCEL_REASONS = ["changed_mind", "size_issue", "wrong_address", "other"] as const;
