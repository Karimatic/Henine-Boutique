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

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <ToastProvider>
        <RouterProvider router={router} />
      </ToastProvider>
    </QueryClientProvider>
  </StrictMode>,
);
