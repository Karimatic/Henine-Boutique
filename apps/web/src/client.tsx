import type { ComponentType } from "react";
import { hydrateRoot } from "react-dom/client";
import { App, type LanguageProvider } from "./App";
import { captureVisit } from "./lib/attribution";
import "./styles/globals.css";

/**
 * Brings one pre-rendered page to life. Each page's own entry (made by vite.config.ts) passes
 * its language provider and its view, so a page only downloads its own code and language.
 */
export function mount(Provider: LanguageProvider, View: ComponentType) {
  // where this visit came from (campaign link, ad, Instagram…): kept for the order
  captureVisit();
  const root = document.getElementById("app");
  if (root)
    hydrateRoot(
      root,
      <App Provider={Provider}>
        <View />
      </App>,
    );
}
