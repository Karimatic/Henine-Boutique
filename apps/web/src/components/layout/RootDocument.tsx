import { dirOf, type Locale } from "@henine/shared";
import { getDictionary } from "@/lib/dictionary";
import { arabicDisplay, arabicSans, dmSans, playfair } from "@/lib/fonts";
import { LocaleProvider } from "@/lib/locale";
import { ActivityToast } from "./ActivityToast";
import { AnnouncementBar } from "./AnnouncementBar";
import { BottomNav } from "./BottomNav";
import { ErrorReporter } from "./ErrorReporter";
import { SiteFooter } from "./SiteFooter";
import { SiteHeader } from "./SiteHeader";
import { SplashScreen } from "./SplashScreen";
import "@/styles/globals.css";

/** Shared <html> shell for the Arabic (/, main) and French (/fr) root layouts. */
export function RootDocument({ locale, children }: { locale: Locale; children: React.ReactNode }) {
  const fonts = [playfair.variable, dmSans.variable, arabicSans.variable, arabicDisplay.variable].join(" ");
  return (
    <html lang={locale} dir={dirOf(locale)} className={fonts}>
      <body className="flex min-h-dvh flex-col pb-[calc(4rem+env(safe-area-inset-bottom))] md:pb-0">
        <noscript>
          <style>{".reveal{opacity:1!important;transform:none!important}"}</style>
        </noscript>
        <SplashScreen />
        <LocaleProvider locale={locale}>
          <a
            href="#main"
            className="sr-only focus:not-sr-only focus:fixed focus:start-3 focus:top-3 focus:z-50 focus:rounded-lg focus:bg-ink focus:px-4 focus:py-2 focus:text-ivory"
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
          <ErrorReporter />
        </LocaleProvider>
      </body>
    </html>
  );
}
