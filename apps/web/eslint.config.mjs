import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

export default defineConfig([
  ...nextVitals,
  ...nextTs,
  {
    files: ["src/**/*.{ts,tsx}"],
    rules: {
      "@typescript-eslint/no-unused-vars": ["error", { argsIgnorePattern: "^_", varsIgnorePattern: "^_" }],
      "no-console": ["warn", { allow: ["warn", "error"] }],
      "prefer-const": "error",
      // The store is a static export: values that only exist in the browser (localStorage,
      // the address bar, the clock, the API) are read in an effect after the page loads,
      // so the pre-built HTML and the first render match. That is this rule's exact pattern.
      "react-hooks/set-state-in-effect": "off",
      // images are served pre-sized from R2 (static export, no Next image optimizer)
      "@next/next/no-img-element": "off",
      // App Router root layout (RootDocument), not the Pages Router <Head>
      "@next/next/no-head-element": "off",
    },
  },
  globalIgnores([".next/**", "out/**", "next-env.d.ts"]),
]);
