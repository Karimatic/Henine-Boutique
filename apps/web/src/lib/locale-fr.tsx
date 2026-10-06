import { fr } from "./i18n/fr";
import { LocaleProvider } from "./locale";

/** French pages: only the French texts are downloaded. */
export function FrenchProvider({ children }: { children: React.ReactNode }) {
  return (
    <LocaleProvider locale="fr" t={fr}>
      {children}
    </LocaleProvider>
  );
}
