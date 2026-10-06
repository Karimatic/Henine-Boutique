import type { ComponentType } from "react";
import { hydrateRoot } from "react-dom/client";
import { App, type LanguageProvider } from "./App";
import "./styles/globals.css";

/**
 * Brings one pre-rendered page to life. Each page's own entry (made by vite.config.ts) passes
 * its language provider and its view, so a page only downloads its own code and language.
 */
export function mount(Provider: LanguageProvider, View: ComponentType) {
  const root = document.getElementById("app");
  if (root)
    hydrateRoot(
      root,
      <App Provider={Provider}>
        <View />
      </App>,
    );
}
