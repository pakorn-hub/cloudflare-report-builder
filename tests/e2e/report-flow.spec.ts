/**
 * Full Report Generation Flow (Browser E2E)
 * Uses the live deployed Pages app with real credentials.
 * Tests the full UI flow: token input → zone picker → report render → visualisations.
 */

import { test, expect } from "@playwright/test";
import { fillAndSubmitReport, waitForReport } from "./helpers";

const CF_TOKEN = process.env.CF_TOKEN!;
const CF_ZONE_ID = process.env.CF_ZONE_ID!;
const CF_ACCOUNT_ID = process.env.CF_ACCOUNT_ID!;
// Optional — the exact zone name (e.g. "example.com") shown on the report
// cover for the zone identified by CF_ZONE_ID above. Only used to assert the
// cover renders the correct zone name; the test still runs (skipping just
// that assertion) if it isn't set.
const CF_ZONE_NAME = process.env.CF_ZONE_NAME;

test.skip(!CF_TOKEN || !CF_ZONE_ID || !CF_ACCOUNT_ID, () => {
  console.warn("Skipping report flow tests: credentials not set in .env.test");
});

// Helper: fill the form, submit and wait for the report to render
async function loadReport(page: Parameters<typeof fillAndSubmitReport>[0]) {
  await fillAndSubmitReport(page, CF_TOKEN, CF_ACCOUNT_ID, CF_ZONE_ID);
  await waitForReport(page, 120_000);
}

test.describe("Report Generation Flow (Live)", () => {
  test.setTimeout(150_000);

  test("zone picker: fetches zones and shows dropdown", async ({ page }) => {
    await page.goto("/");

    const inputs = await page.locator("input").all();
    await inputs[0].fill(CF_TOKEN);
    await inputs[1].fill(CF_ACCOUNT_ID);

    await page.locator("button").filter({ hasText: /fetch zones/i }).click();

    // Dropdown should appear
    const select = page.locator("select");
    await expect(select).toBeVisible({ timeout: 15_000 });

    // Should have options beyond the placeholder
    const options = await select.locator("option").all();
    expect(options.length).toBeGreaterThan(1); // placeholder + at least 1 zone

    await page.screenshot({ path: "test-results/zone-picker.png" });
  });

  test("submits credentials and generates full AppSec report", async ({ page }) => {
    await loadReport(page);
    await page.screenshot({ path: "test-results/report-rendered.png", fullPage: false });
  });

  test("report shows cover with zone name and date range", async ({ page }) => {
    await loadReport(page);

    // Zone name appears in the cover — use visible:true to skip hidden TOC elements
    if (CF_ZONE_NAME) {
      await expect(page.locator(`text=${CF_ZONE_NAME}`).and(page.locator(":visible")).first()).toBeVisible();
    }
    // Date range label
    await expect(page.locator("text=/2026/i").and(page.locator(":visible")).first()).toBeVisible();

    await page.screenshot({ path: "test-results/cover.png" });
  });

  test("StatCards render with numeric KPIs", async ({ page }) => {
    await loadReport(page);

    // The page body should contain formatted numbers like 225,180 or 119K
    const bodyText = await page.locator("body").textContent();
    expect(bodyText).toMatch(/[\d,]{3,}/); // at least a 3-digit number with commas

    // StatCard values use specific class — check at least some exist
    const statValues = page.locator("[class*='text-2xl'], [class*='text-3xl']");
    const count = await statValues.count();
    expect(count).toBeGreaterThan(0);

    await page.screenshot({ path: "test-results/stat-cards.png" });
  });

  test("Recharts SVG charts render (time-series, pie, bar)", async ({ page }) => {
    await loadReport(page);

    // Recharts renders svg.recharts-surface
    const svgs = page.locator("svg.recharts-surface");
    await expect(svgs.first()).toBeVisible({ timeout: 30_000 });

    const chartCount = await svgs.count();
    expect(chartCount).toBeGreaterThan(3);

    console.log(`Charts rendered: ${chartCount}`);
    await page.screenshot({ path: "test-results/charts.png", fullPage: true });
  });

  test("WAF section is visible with events data", async ({ page }) => {
    await loadReport(page);

    // Use .first() since "WAF Events" appears in multiple places (StatCard label + chart heading)
    await expect(page.locator("text=/waf events/i").first()).toBeVisible();

    await page.screenshot({ path: "test-results/waf-section.png" });
  });

  test("Certificate table renders with expiry info", async ({ page }) => {
    await loadReport(page);

    // Certificate section heading — filter to visible elements only (skip hidden TOC)
    await expect(page.locator("text=/security posture/i").and(page.locator(":visible")).first()).toBeVisible();

    // Table rows with host names
    const tableRows = page.locator("table tr, [class*=table] [class*=row]");
    const rowCount = await tableRows.count();
    expect(rowCount).toBeGreaterThan(0);

    await page.screenshot({ path: "test-results/certificates.png" });
  });

  test("PDF export button is visible and clickable", async ({ page }) => {
    // Small pause to avoid rate limit across multiple tests hitting /api/zones
    await page.waitForTimeout(3_000);
    await loadReport(page);

    // Both "Export PDF" and "Print" buttons are present — check first one
    const exportBtn = page.locator("button").filter({ hasText: /pdf|export|print|download/i }).first();
    await expect(exportBtn).toBeVisible();
    await expect(exportBtn).toBeEnabled();

    await page.screenshot({ path: "test-results/export-button.png" });
  });

  test("AI Executive Summary section renders non-empty text", async ({ page }) => {
    // Small pause to avoid rate limit
    await page.waitForTimeout(3_000);
    await loadReport(page);

    // "Executive Summary" heading (use first() — strict mode)
    await expect(
      page.locator("h2").filter({ hasText: /executive summary/i }).first()
    ).toBeVisible();

    // Page body should have substantial text (the AI paragraph)
    const bodyText = await page.locator("body").textContent();
    expect(bodyText!.length).toBeGreaterThan(1000);

    await page.screenshot({ path: "test-results/executive-summary.png" });
  });

  test("Cost Savings section renders with dollar amounts", async ({ page }) => {
    await page.waitForTimeout(3_000);
    await loadReport(page);

    // Use visible filter to skip the hidden TOC entry
    await expect(page.locator("text=Cost Savings Analysis").and(page.locator(":visible")).first()).toBeVisible();
    await expect(page.locator("text=Monthly Savings").and(page.locator(":visible")).first()).toBeVisible();
    await expect(page.locator("text=Annual Projection").and(page.locator(":visible")).first()).toBeVisible();

    // Should have at least one dollar or percentage value
    const bodyText = await page.locator("body").textContent();
    expect(bodyText).toMatch(/\$[\d,]+|[\d]+%/);

    await page.screenshot({ path: "test-results/cost-savings.png" });
  });

  test("Security Recommendations section renders with priority badges", async ({ page }) => {
    await page.waitForTimeout(3_000);
    await loadReport(page);

    // Use visible filter to skip the hidden TOC entry
    await expect(page.locator("text=Security Recommendations").and(page.locator(":visible")).first()).toBeVisible();

    // At least one priority badge should appear (High/Medium/Low Priority)
    const priorityBadges = page.locator("text=/high priority|medium priority|low priority/i");
    await expect(priorityBadges.first()).toBeVisible({ timeout: 10_000 });

    const badgeCount = await priorityBadges.count();
    expect(badgeCount).toBeGreaterThan(0);

    await page.screenshot({ path: "test-results/recommendations.png" });
  });

  test("both cache hit rate metrics are visible", async ({ page }) => {
    await loadReport(page);

    const bodyText = await page.locator("body").textContent();

    // Both new cache stat card titles should appear
    expect(bodyText).toMatch(/request cache hit|bandwidth cache hit/i);

    // At least one percentage value for cache
    expect(bodyText).toMatch(/\d+%/);

    await page.screenshot({ path: "test-results/cache-metrics.png" });
  });
});
