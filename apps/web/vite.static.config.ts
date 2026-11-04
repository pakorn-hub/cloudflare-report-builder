/**
 * Single-chunk static build of the report app.
 *
 * Used by the scheduled-email pipeline: the Worker fetches app.js + app.css
 * from its own ASSETS binding and inlines them into the email attachment
 * together with the generated report data (window.__EMBEDDED_REPORT__). The
 * recipient's browser then renders the exact same report the on-demand page
 * renders — same components, same charts — from one self-contained file.
 *
 * Differences from the default build:
 *   - one chunk (inlineDynamicImports) — no /assets/* import specifiers to
 *     rewrite when inlining; ES module chunks cannot be merged any other way.
 *   - deterministic filenames (static-report/app.js|app.css) — the Worker
 *     cannot know hashed names at send time.
 *   - output into dist/static-report/ — served by the same ASSETS binding.
 */
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  build: {
    // Inline imported assets (the Cloudflare logo, 11.4 KB) as data URIs —
    // this bundle ends up inside email attachments with no server behind it.
    assetsInlineLimit: 20_000,
    outDir: "dist/static-report",
    emptyOutDir: true,
    rollupOptions: {
      output: {
        inlineDynamicImports: true,
        entryFileNames: "app.js",
        chunkFileNames: "[name].js",
        assetFileNames: "app.css",
      },
    },
    chunkSizeWarningLimit: 2000,
  },
});
