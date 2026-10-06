import type { ComponentType, ReactNode } from "react";
import { ActivityToast } from "@/components/layout/ActivityToast";
import { AnnouncementBar } from "@/components/layout/AnnouncementBar";
import { BottomNav } from "@/components/layout/BottomNav";
import { ErrorReporter } from "@/components/layout/ErrorReporter";
import { FloatingHelp } from "@/components/layout/FloatingHelp";
import { InstallPrompt } from "@/components/layout/InstallPrompt";
import { SiteFooter } from "@/components/layout/SiteFooter";
import { SiteHeader } from "@/components/layout/SiteHeader";
import { SplashScreen } from "@/components/layout/SplashScreen";
import { ThemeStyle } from "@/components/layout/ThemeStyle";
import { useLocale } from "@/lib/locale";

/** The language's texts, given by each page's own provider (a page only downloads its language). */
export type LanguageProvider = ComponentType<{ children: ReactNode }>;

function SkipLink() {
  const { t } = useLocale();
  return (
    <a
      href="#main"
      className="sr-only focus:not-sr-only focus:fixed focus:start-3 focus:top-3 focus:z-50 focus:rounded-lg focus:bg-noir focus:px-4 focus:py-2 focus:text-white"
    >
      {t.skip}
    </a>
  );
}

/**
 * Everything inside <div id="app">: the same tree is rendered to HTML at build time and then
 * brought to life in the browser (hydration), so the first paint needs no script.
 */
export function App({ Provider, children }: { Provider: LanguageProvider; children: ReactNode }) {
  return (
    <>
      <SplashScreen />
      <Provider>
        <SkipLink />
        <AnnouncementBar />
        <SiteHeader />
        <main id="main" className="flex-1">
          {children}
        </main>
        <SiteFooter />
        <BottomNav />
        <ActivityToast />
        <FloatingHelp />
        <InstallPrompt />
        <ThemeStyle />
        <ErrorReporter />
      </Provider>
    </>
  );
}

/** Classes of the page frame (on #app): a column filling the screen, room for the phone tab bar. */
export const APP_CLASS = "flex min-h-dvh flex-col pb-[calc(4rem+env(safe-area-inset-bottom))] md:pb-0";
