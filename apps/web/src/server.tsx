/**
 * Build-time only (scripts/build.mjs): renders every page to HTML with its <head> tags.
 * Never shipped to the browser.
 */
import type { ComponentType } from "react";
import { renderToString } from "react-dom/server";
import { dirOf, type Locale } from "@henine/shared";
import { App, APP_CLASS, type LanguageProvider } from "./App";
import { HomePage } from "@/components/home/HomePage";
import { ProductView } from "@/components/product/ProductView";
import { BoutiqueView } from "@/components/views/BoutiqueView";
import { CategoriesView, CategoryView, PromotionsView } from "@/components/views/CatalogViews";
import { CollectionView, NewArrivalsView } from "@/components/views/DropViews";
import { ContactView, LinksView, PageView } from "@/components/views/InfoViews";
import { NotFoundView } from "@/components/views/NotFoundView";
import { ThankYouView, TrackView } from "@/components/views/OrderViews";
import { OutfitView } from "@/components/views/OutfitView";
import { SearchView } from "@/components/views/SearchView";
import { CartView, CheckoutView, FavoritesView } from "@/components/views/ShopViews";
import { MODE_BOOT, THEME_BOOT } from "@/lib/boot";
import { getDictionary } from "@/lib/dictionary";
import { ArabicProvider } from "@/lib/locale-ar";
import { FrenchProvider } from "@/lib/locale-fr";
import { localePath, NOT_FOUND, PAGES, type PageDef, type ViewKey } from "./pages";

const VIEWS: Record<ViewKey, ComponentType> = {
  HomePage,
  BoutiqueView,
  CategoryView,
  CategoriesView,
  CollectionView,
  CheckoutView,
  ContactView,
  FavoritesView,
  LinksView,
  ThankYouView,
  NewArrivalsView,
  PageView,
  CartView,
  ProductView,
  PromotionsView,
  SearchView,
  TrackView,
  OutfitView,
  NotFoundView,
};
const PROVIDERS: Record<Locale, LanguageProvider> = { ar: ArabicProvider, fr: FrenchProvider };

export { NOT_FOUND, PAGES, APP_CLASS };
export const BOOT_SCRIPT = MODE_BOOT + THEME_BOOT;

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/**
 * The page's <head> tags: title, description, link previews, the install-as-app tags, and for
 * the fixed pages their canonical address and Arabic / French twins (search engines index
 * each page as itself). Shells get their canonical from the Worker, per slug.
 */
/** Default picture of link previews (the built-in home photo, 640 × 640). */
export const SHARE_IMAGE = { src: "/ig/pyjamas-rayures.jpg", width: 640, height: 640 };

function headTags(page: PageDef, locale: Locale, siteUrl: string): string {
  const t = getDictionary(locale);
  const title = page.title ? `${page.title[locale]} · Henine Boutique` : t.meta.title;
  const description = page.description?.[locale] ?? t.meta.description;
  const abs = (p: string) => esc(new URL(p, siteUrl).toString().replace(/\/$/, "") || siteUrl);
  const tags: string[] = [
    `<meta name="theme-color" content="#fdeef3" media="(prefers-color-scheme: light)"/>`,
    `<meta name="theme-color" content="#140c10" media="(prefers-color-scheme: dark)"/>`,
    `<title>${esc(title)}</title>`,
    `<meta name="description" content="${esc(description)}"/>`,
    `<meta name="application-name" content="Henine Boutique"/>`,
    `<link rel="manifest" href="/manifest.webmanifest"/>`,
  ];
  if (page.noindex) tags.push(`<meta name="robots" content="noindex"/>`);
  const own = localePath(locale, page.path);
  if (!page.shell && page !== NOT_FOUND) {
    const ar = localePath("ar", page.path);
    const fr = localePath("fr", page.path);
    tags.push(
      `<link rel="canonical" href="${abs(own)}"/>`,
      `<link rel="alternate" hreflang="ar" href="${abs(ar)}"/>`,
      `<link rel="alternate" hreflang="fr" href="${abs(fr)}"/>`,
      `<link rel="alternate" hreflang="x-default" href="${abs(ar)}"/>`,
    );
  }
  tags.push(
    `<meta name="format-detection" content="telephone=no"/>`,
    `<meta name="mobile-web-app-capable" content="yes"/>`,
    `<meta name="apple-mobile-web-app-title" content="Henine"/>`,
    `<meta name="apple-mobile-web-app-status-bar-style" content="default"/>`,
    `<meta property="og:title" content="${esc(title)}"/>`,
    `<meta property="og:description" content="${esc(description)}"/>`,
    ...(page.shell || page === NOT_FOUND ? [] : [`<meta property="og:url" content="${abs(own)}"/>`]),
    `<meta property="og:site_name" content="Henine Boutique"/>`,
    `<meta property="og:locale" content="${locale === "fr" ? "fr_DZ" : "ar_DZ"}"/>`,
    `<meta property="og:type" content="website"/>`,
    // link previews (WhatsApp, Instagram, Facebook): the shop's home photo (product pages get their own)
    `<meta property="og:image" content="${abs(SHARE_IMAGE.src)}"/>`,
    `<meta property="og:image:width" content="${SHARE_IMAGE.width}"/>`,
    `<meta property="og:image:height" content="${SHARE_IMAGE.height}"/>`,
    `<meta property="og:image:alt" content="Henine Boutique"/>`,
    `<meta name="twitter:card" content="summary"/>`,
    `<meta name="twitter:title" content="${esc(title)}"/>`,
    `<meta name="twitter:description" content="${esc(description)}"/>`,
    `<link rel="icon" href="/icon.svg"/>`,
    `<link rel="apple-touch-icon" href="/icons/apple-touch-icon.png"/>`,
  );
  return tags.join("");
}

/** One page, ready to be put in its HTML file. */
export function renderPage(page: PageDef, locale: Locale, siteUrl: string) {
  const View = VIEWS[page.view];
  const body = renderToString(
    <App Provider={PROVIDERS[locale]}>
      <View />
    </App>,
  );
  return { lang: locale, dir: dirOf(locale), head: headTags(page, locale, siteUrl), body };
}
