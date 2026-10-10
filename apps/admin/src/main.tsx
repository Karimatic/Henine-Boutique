import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { RouterProvider } from "@tanstack/react-router";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { ApiError } from "./api";
import { applyLangToDocument } from "./i18n";
import { applyColorMode } from "./lib/colorMode";
// listens for the browser's "install as an app" offer from the very start
import "./lib/install";
import { router } from "./router";
import { ToastProvider } from "./ui";
import "./styles.css";

// French or Arabic (right to left), as chosen in Paramètres → Mon compte
applyLangToDocument();
// light / dark as chosen on this device (auto = the phone's setting, handled by CSS)
applyColorMode();

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      refetchOnWindowFocus: true,
      // never retry auth/permission errors
      retry: (count, err) => !(err instanceof ApiError && err.status >= 400 && err.status < 500) && count < 2,
    },
  },
});

/**
 * The admin's fonts load with "swap": without this, text first shows in a system font and
 * jumps a moment later while the icons stay still (a flicker next to the menu icons). Wait for
 * the fonts of the menu (cached after the first visit), never more than 1.2 s.
 */
async function fontsReady() {
  if (!document.fonts?.load) return;
  const ar = document.documentElement.lang === "ar";
  const wanted = ar ? ['400 14px "Tajawal"', '500 14px "Tajawal"', '400 14px "DM Sans Variable"'] : ['400 14px "DM Sans Variable"', '500 14px "DM Sans Variable"'];
  await Promise.race([Promise.all(wanted.map((f) => document.fonts.load(f, ar ? "ابج" : "abc"))), new Promise((r) => setTimeout(r, 1200))]).catch(() => undefined);
}

void fontsReady().then(() =>
  createRoot(document.getElementById("root")!).render(
    <StrictMode>
      <QueryClientProvider client={queryClient}>
        <ToastProvider>
          <RouterProvider router={router} />
        </ToastProvider>
      </QueryClientProvider>
    </StrictMode>,
  ),
);
