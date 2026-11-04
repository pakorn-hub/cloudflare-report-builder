/**
 * Home Page (Token Input) Tests
 * Verifies the token input form renders and validates correctly.
 */

import { test, expect } from "@playwright/test";

test.describe("Home Page: Token Input Form", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/");
  });

  test("renders the home page with token input form", async ({ page }) => {
    // Title / heading
    await expect(page.locator("h1, h2")).toContainText([
      /cloudflare|report|poc/i,
    ]);

    // Two input fields: token + account ID (zone is picked via dropdown after fetch)
    const inputs = page.locator("input");
    await expect(inputs).toHaveCount(2);

    // "Fetch Zones" button
    await expect(
      page.locator("button").filter({ hasText: /fetch zones/i })
    ).toBeVisible();

    // Submit button (disabled until zone selected)
    await expect(
      page.locator("button[type=submit], button").filter({ hasText: /generate|run|report/i })
    ).toBeVisible();

    await page.screenshot({ path: "test-results/home-page.png" });
  });

  test("submit button is disabled when form is empty", async ({ page }) => {
    // The app disables the submit button until all fields are filled — good UX
    const submitBtn = page
      .locator("button")
      .filter({ hasText: /generate|run|report/i });

    await expect(submitBtn).toBeVisible();
    await expect(submitBtn).toBeDisabled();
  });

  test("Fetch Zones button enables after token and account ID are filled", async ({ page }) => {
    const [tokenInput, accountInput] = await page.locator("input").all();

    await tokenInput.fill("test-token-value");
    await accountInput.fill("abcdef1234567890abcdef1234567890");

    // Fetch Zones button should now be enabled
    await expect(
      page.locator("button").filter({ hasText: /fetch zones/i })
    ).toBeEnabled();

    // Generate button still disabled (no zone selected yet)
    await expect(
      page.locator("button").filter({ hasText: /generate|run|report/i })
    ).toBeDisabled();
  });

  test("shows privacy/security note about token handling", async ({ page }) => {
    // Should inform users that the token is not stored
    const securityNote = page.locator(
      "text=/never stored|not stored|read.only|stateless/i"
    );
    await expect(securityNote).toBeVisible();
  });
});
