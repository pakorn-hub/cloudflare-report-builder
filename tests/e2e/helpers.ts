/**
 * Shared helpers for E2E tests.
 * The form is 2-step: token+accountId → "Fetch Zones" button → zone dropdown → generate.
 */
import { Page } from "@playwright/test";

export async function fillAndSubmitReport(
  page: Page,
  token: string,
  accountId: string,
  zoneId: string
) {
  await page.goto("/");
  await page.waitForLoadState("networkidle");

  const inputs = await page.locator("input").all();
  // inputs[0] = API token, inputs[1] = account ID
  await inputs[0].fill(token);
  await inputs[1].fill(accountId);

  // Click "Fetch Zones" and wait for the /api/zones response
  await Promise.all([
    page.waitForResponse((r) => r.url().includes("/api/zones"), { timeout: 20_000 }),
    page.locator("button").filter({ hasText: /fetch zones/i }).click(),
  ]);

  // Wait for the zone select dropdown to appear
  const select = page.locator("select");
  await select.waitFor({ state: "visible", timeout: 10_000 });

  // Select the target zone
  await select.selectOption(zoneId);

  // Click Generate Report (submit button)
  await page.locator("button[type=submit]").click();
}

/** Wait for the report page to fully load (Executive Summary heading visible) */
export async function waitForReport(page: Page, timeout = 120_000) {
  // .first() avoids strict-mode errors when multiple headings match the regex
  await page
    .locator("h2")
    .filter({ hasText: /executive summary/i })
    .first()
    .waitFor({ state: "visible", timeout });
}
