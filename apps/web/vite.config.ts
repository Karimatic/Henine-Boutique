import { fileURLToPath } from "node:url";
import tailwindcss from "@tailwindcss/vite";
import { defineConfig, type Plugin } from "vite";
import { NOT_FOUND, PAGES, type ViewKey } from "./src/pages";

/**
 * The store: Preact (React's API in 4 KB) instead of React + Next.js. Every page is
 * pre-rendered to HTML by scripts/build.mjs and gets its own small entry script (only its view
 * and its language), so a phone downloads a fraction of the old JavaScript.
 */

const src = (p: string) => fileURLToPath(new URL(`./src/${p}`, import.meta.url));

/** Where each page's view lives (imported directly, so a page only pulls its own code). */
const VIEW_MODULE: Record<ViewKey, string> = {
  HomePage: "components/home/HomePage.tsx",
  ProductView: "components/product/ProductView.tsx",
  BoutiqueView: "components/views/BoutiqueView.tsx",
  CategoriesView: "components/views/CatalogViews.tsx",
  CategoryView: "components/views/CatalogViews.tsx",
  PromotionsView: "components/views/CatalogViews.tsx",
  CollectionView: "components/views/DropViews.tsx",
  NewArrivalsView: "components/views/DropViews.tsx",
  ContactView: "components/views/InfoViews.tsx",
  LinksView: "components/views/InfoViews.tsx",
  PageView: "components/views/InfoViews.tsx",
  ThankYouView: "components/views/OrderViews.tsx",
  TrackView: "components/views/OrderViews.tsx",
  OutfitView: "components/views/OutfitView.tsx",
  SearchView: "components/views/SearchView.tsx",
  CartView: "components/views/ShopViews.tsx",
  CheckoutView: "components/views/ShopViews.tsx",
  FavoritesView: "components/views/ShopViews.tsx",
  NotFoundView: "components/views/NotFoundView.tsx",
};

/** One entry per language × view: "ar-HomePage" → hydrate the Arabic home page. */
export const ENTRIES = [
  ...new Set([...PAGES, NOT_FOUND].flatMap((p) => [`ar-${p.view}`, `fr-${p.view}`])),
];

const PREFIX = "\0henine-page:";
function pageEntries(): Plugin {
  return {
    name: "henine-page-entries",
    resolveId: (id) => (id.startsWith("henine-page:") ? `\0${id}` : null),
    load(id) {
      if (!id.startsWith(PREFIX)) return null;
      const [locale, view] = id.slice(PREFIX.length).split("-") as ["ar" | "fr", ViewKey];
      const provider = locale === "ar" ? "ArabicProvider" : "FrenchProvider";
      return [
        `import { mount } from ${JSON.stringify(src("client.tsx"))};`,
        `import { ${view} as View } from ${JSON.stringify(src(VIEW_MODULE[view]))};`,
        `import { ${provider} as Provider } from ${JSON.stringify(src(`lib/locale-${locale}.tsx`))};`,
        `mount(Provider, View);`,
      ].join("\n");
    },
  };
}

export default defineConfig(({ isSsrBuild }) => {
  const plugins: Plugin[] = [tailwindcss()];

  if (!isSsrBuild) {
    plugins.push(pageEntries());
  }

  return {
    resolve: {
      alias: [
        { find: /^@\//, replacement: src("") },
        // React's API, Preact's engine
        { find: /^react-dom\/client$/, replacement: "preact/compat/client" },
        { find: /^react-dom\/server$/, replacement: "preact/compat/server" },
        { find: /^react-dom$/, replacement: "preact/compat" },
        { find: /^react\/jsx-runtime$/, replacement: "preact/jsx-runtime" },
        { find: /^react\/jsx-dev-runtime$/, replacement: "preact/jsx-dev-runtime" },
        { find: /^react$/, replacement: "preact/compat" },
      ],
    },
    plugins,
    // the build-time renderer carries its own copy of everything (no node_modules lookups)
    ssr: { noExternal: true },
    build: isSsrBuild
      ? { outDir: ".ssr", emptyOutDir: true, copyPublicDir: false, minify: false }
      : {
        outDir: "out",
        emptyOutDir: true,
        assetsDir: "assets",
        target: "es2022",
        cssCodeSplit: true,
        modulePreload: { polyfill: false },
        rollupOptions: {
          input: Object.fromEntries(ENTRIES.map((e) => [e, `henine-page:${e}`])),
        },
      },
  };
});