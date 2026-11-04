import { defineConfig } from "@playwright/test";

// Isolated offline suite: no .env.test, live API, customer credentials or email.
export default defineConfig({
  testDir: "./tests/magic-transit", workers: 1, timeout: 60000,
  reporter: "list", outputDir: "test-results/magic-transit",
  preserveOutput: "always",
  use: { baseURL: "http://127.0.0.1:5178", headless: true, channel: process.env.PLAYWRIGHT_CHANNEL },
  webServer: {
    command: "npm run dev --workspace=apps/web -- --host 127.0.0.1 --port 5178",
    url: "http://127.0.0.1:5178", reuseExistingServer: !process.env.CI,
  },
});
