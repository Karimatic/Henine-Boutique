import { dirOf, type Locale } from "@henine/shared";
import { getDictionary } from "@/lib/dictionary";
import { arabicDisplay, arabicSans, dmSans, playfair, presetFontVariables } from "@/lib/fonts";
import { ActivityToast } from "./ActivityToast";
import { AnnouncementBar } from "./AnnouncementBar";
import { BottomNav } from "./BottomNav";
import { ErrorReporter } from "./ErrorReporter";
import { FloatingHelp } from "./FloatingHelp";
import { InstallPrompt } from "./InstallPrompt";
import { SiteFooter } from "./SiteFooter";
import { SiteHeader } from "./SiteHeader";
import { SplashScreen } from "./SplashScreen";
import { ThemeStyle } from "./ThemeStyle";
import { MODE_BOOT, THEME_BOOT } from "@/lib/boot";
import "@/styles/globals.css";

/**
 * Shared <html> shell for the Arabic (/, main) and French (/fr) root layouts. Each layout
 * passes its own language provider, so a page only downloads its own language's texts.
 */
export function RootDocument({
  locale,
  Provider,
  children,
}: {
  locale: Locale;
  Provider: React.ComponentType<{ children: React.ReactNode }>;
  children: React.ReactNode;
}) {
  const fonts = [playfair.variable, dmSans.variable, arabicSans.variable, arabicDisplay.variable, presetFontVariables].join(" ");
  return (
    <html lang={locale} dir={dirOf(locale)} className={fonts} suppressHydrationWarning>
      <head>
        {/* the store's colours and fonts (Admin → Apparence) before the first paint */}
        {/* light / dark choice and the store's colours before the first paint (no flash) */}
        <script dangerouslySetInnerHTML={{ __html: MODE_BOOT + THEME_BOOT }} />
      </head>
      <body className="flex min-h-dvh flex-col pb-[calc(4rem+env(safe-area-inset-bottom))] md:pb-0">
        <noscript>
          <style>{".reveal{opacity:1!important;transform:none!important}"}</style>
        </noscript>
        <SplashScreen />
        <Provider>
          <a
            href="#main"
            className="sr-only focus:not-sr-only focus:fixed focus:start-3 focus:top-3 focus:z-50 focus:rounded-lg focus:bg-noir focus:px-4 focus:py-2 focus:text-white"
          >
            {getDictionary(locale).skip}
          </a>
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
      </body>
    </html>
  );
}
