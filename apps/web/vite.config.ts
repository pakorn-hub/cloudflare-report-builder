import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      "/api": {
        target: "http://localhost:8787", // wrangler dev port
        changeOrigin: true,
      },
    },
  },
  build: {
    // Inline imported assets (the Cloudflare logo, 11.4 KB) as data URIs so
    // they render inside scheduled-email attachments, not just on-demand.
    assetsInlineLimit: 20_000,
    rollupOptions: {
      output: {
        manualChunks: {
          "vendor-react": ["react", "react-dom"],
          "vendor-recharts": ["recharts"],
          "vendor-icons": ["lucide-react"],
          "vendor-d3": ["d3-sankey"],
        },
      },
    },
    chunkSizeWarningLimit: 600,
  },
});
