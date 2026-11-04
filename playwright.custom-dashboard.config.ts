import { defineConfig } from "@playwright/test";

// Offline: never loads .env.test or invokes Cloudflare APIs.
export default defineConfig({
  testDir: "./tests/custom-dashboard", workers: 1, timeout: 60000,
  reporter: "list", outputDir: "test-results/custom-dashboard",
  preserveOutput: "always",
  use: { baseURL: "http://127.0.0.1:5179", headless: true, channel: process.env.PLAYWRIGHT_CHANNEL },
  webServer: {
    command: "npm run dev --workspace=apps/web -- --host 127.0.0.1 --port 5179",
    url: "http://127.0.0.1:5179", reuseExistingServer: !process.env.CI,
  },
});
