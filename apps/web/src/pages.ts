/**
 * Every page of the store, built twice: Arabic at "/…" and French at "/fr/…". Each page is one
 * pre-rendered HTML file plus its own small script (scripts/build.mjs); the data comes from /api
 * in the browser.
 *
 * `shell`: one file ("_") serves every slug (/produit/<slug>, /c/<slug>…): the Worker answers
 * every address with it and adds the item's own title, preview and canonical tags.
 */
export type ViewKey =
  | "HomePage"
  | "BoutiqueView"
  | "CategoryView"
  | "CategoriesView"
  | "CollectionView"
  | "CheckoutView"
  | "ContactView"
  | "FavoritesView"
  | "LinksView"
  | "ThankYouView"
  | "NewArrivalsView"
  | "PageView"
  | "CartView"
  | "ProductView"
  | "PromotionsView"
  | "SearchView"
  | "TrackView"
  | "OutfitView"
  | "NotFoundView";

export interface PageDef {
  /** address without the language prefix */
  path: string;
  view: ViewKey;
  title?: { ar: string; fr: string };
  description?: { ar: string; fr: string };
  /** kept out of search engines (cart, checkout…) */
  noindex?: boolean;
  shell?: boolean;
}

export const PAGES: PageDef[] = [
  { path: "/", view: "HomePage" },
  {
    path: "/boutique",
    view: "BoutiqueView",
    title: { ar: "محلنا في دلس", fr: "Notre boutique à Dellys" },
    description: {
      ar: "العنوان، أوقات العمل، الخريطة والاتجاهات إلى محل Henine Boutique في دلس، لقهاوي، بجانب المحكمة.",
      fr: "Adresse, horaires, plan et itinéraire de la boutique Henine à Dellys (Laqhaoui, à côté du tribunal).",
    },
  },
  { path: "/c/_", view: "CategoryView", title: { ar: "قسم", fr: "Catégorie" }, shell: true },
  { path: "/categories", view: "CategoriesView", title: { ar: "الأقسام", fr: "Catégories" } },
  { path: "/collection/_", view: "CollectionView", title: { ar: "تشكيلة", fr: "Collection" }, shell: true },
  { path: "/commande", view: "CheckoutView", title: { ar: "إتمام الطلب", fr: "Commande" }, noindex: true },
  { path: "/contact", view: "ContactView", title: { ar: "تواصلي معنا", fr: "Contact" } },
  { path: "/favoris", view: "FavoritesView", title: { ar: "مفضلتي", fr: "Mes favoris" }, noindex: true },
  { path: "/liens", view: "LinksView", title: { ar: "روابطنا", fr: "Nos liens" } },
  { path: "/merci", view: "ThankYouView", title: { ar: "شكرا!", fr: "Merci !" }, noindex: true },
  { path: "/nouveautes", view: "NewArrivalsView", title: { ar: "القطع الجديدة", fr: "Nouveautés" } },
  { path: "/p/_", view: "PageView", title: { ar: "معلومات", fr: "Informations" }, shell: true },
  { path: "/panier", view: "CartView", title: { ar: "سلتي", fr: "Mon panier" }, noindex: true },
  { path: "/produit/_", view: "ProductView", title: { ar: "منتج", fr: "Produit" }, shell: true },
  {
    path: "/promotions",
    view: "PromotionsView",
    title: { ar: "التخفيضات", fr: "Promotions" },
    description: {
      ar: "قطع بأسعار مخفضة ما دامت متوفرة: فساتين، بيجامات، لانجري… الدفع عند الاستلام والتوصيل إلى 69 ولاية.",
      fr: "Des pièces à prix cassés tant qu'il en reste : robes, pyjamas, lingerie… Paiement à la livraison, 69 wilayas.",
    },
  },
  { path: "/recherche", view: "SearchView", title: { ar: "بحث", fr: "Recherche" } },
  { path: "/suivi", view: "TrackView", title: { ar: "تتبع الطلب", fr: "Suivi de commande" } },
  { path: "/tenue", view: "OutfitView", title: { ar: "نسّقي إطلالتك", fr: "Composez votre tenue" } },
];

/** The page any unknown address gets (Arabic, with a link to the French site). */
export const NOT_FOUND: PageDef = { path: "/404", view: "NotFoundView", title: { ar: "الصفحة غير موجودة", fr: "Page introuvable" }, noindex: true };

/** "/boutique" → "/fr/boutique", "/" → "/fr" */
export const localePath = (locale: "ar" | "fr", path: string) => (locale === "ar" ? path : path === "/" ? "/fr" : `/fr${path}`);

/** Where a page's HTML file goes in out/: "/" → index.html, "/fr" → fr.html, "/fr/c/_" → fr/c/_.html */
export const fileOf = (address: string) => (address === "/" ? "index.html" : `${address.slice(1)}.html`);
