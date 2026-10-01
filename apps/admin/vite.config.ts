import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  base: "/admin/",
  plugins: [react(), tailwindcss()],
  server: {
    port: 5174,
    // `npm run dev` at the root runs the Worker on :8787 (API + local D1)
    proxy: { "/api": "http://localhost:8787" },
  },
  build: {
    outDir: "dist",
    sourcemap: false,
    // no inline scripts/styles → the Worker can serve a strict CSP without nonces
    assetsInlineLimit: 0,
    modulePreload: { polyfill: false },
    target: "es2022",
  },
});
