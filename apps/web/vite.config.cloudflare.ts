import { fileURLToPath } from "node:url";
import tailwindcss from "@tailwindcss/vite";
import { defineConfig } from "vite";

const src = (p: string) => fileURLToPath(new URL(`./src/${p}`, import.meta.url));

export default defineConfig({
    resolve: {
        alias: [
            { find: /^@\//, replacement: src("") },
            { find: /^react-dom\/client$/, replacement: "preact/compat/client" },
            { find: /^react-dom\/server$/, replacement: "preact/compat/server" },
            { find: /^react-dom$/, replacement: "preact/compat" },
            { find: /^react\/jsx-runtime$/, replacement: "preact/jsx-runtime" },
            { find: /^react\/jsx-dev-runtime$/, replacement: "preact/jsx-dev-runtime" },
            { find: /^react$/, replacement: "preact/compat" },
        ],
    },
    plugins: [
        tailwindcss(),
    ],
    ssr: { noExternal: true },
});