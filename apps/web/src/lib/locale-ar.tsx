"use client";

import { ar } from "./i18n/ar";
import { LocaleProvider } from "./locale";

/** Arabic pages: only the Arabic texts are downloaded. */
export function ArabicProvider({ children }: { children: React.ReactNode }) {
  return (
    <LocaleProvider locale="ar" t={ar}>
      {children}
    </LocaleProvider>
  );
}
