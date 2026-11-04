import { test, expect, type Page } from "@playwright/test";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { buildEmbeddedReportAttachment } from "../../apps/api/src/services/attachment-builder";
import { fixture } from "./fixture";
import { TEST_TOKEN, TEST_ACCOUNT } from "./mock-upstream";

async function attachment(page: Page, data = fixture()) {
  const html = await buildEmbeddedReportAttachment({ ASSETS: { fetch: async (request: Request) => new Response(await readFile(resolve("apps/web/dist", new URL(request.url).pathname.slice(1)), "utf8")) } } as never, {
    kind: "magic-transit", data, input: { token: "", product: "magic-transit", isPoc: false, clientName: "Example customer" },
    aiSummary: "Synthetic executive assessment. Measurements are sampled estimates.\n\nProbe success and routing state are separate measurements.", generatedAt: "2026-09-02", scheduleName: "Example schedule",
  }, "Example Magic Transit report");
  expect(html).not.toBeNull();
  const attempts: string[] = [];
  await page.route("**/*", route => {
    if (new URL(route.request().url()).pathname === "/attachment") return route.fulfill({ contentType: "text/html", body: html! });
    attempts.push(route.request().url()); return route.abort();
  });
  await page.goto("/attachment");
  await expect(page.getByRole("heading", { name: "Traffic pulse" })).toBeVisible();
  return attempts;
}

test("built attachment renders charts offline, switches geography and exports a script-free HTML snapshot", async ({ page }, testInfo) => {
  const errors: string[] = []; page.on("pageerror", e => errors.push(e.message));
  const attempts = await attachment(page);
  await page.screenshot({ path: testInfo.outputPath("magic-transit-desktop.png") });
  await expect(page.getByRole("img", { name: "Tunnel probe success heatmap" })).toBeVisible();
  await expect(page.getByRole("img", { name: "Measured protocol and destination-port traffic matrix" })).toBeVisible();
  await page.getByRole("button", { name: "Processing countries", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Cloudflare processing-country packet distribution" })).toBeVisible();
  await page.getByRole("button", { name: "Static view", exact: true }).click();
  await expect(page.locator(".mt-globe-fallback")).toBeVisible();
  const pending = page.waitForEvent("download");
  await page.getByRole("button", { name: "HTML", exact: true }).click();
  const downloaded = await pending;
  const snapshot = await readFile((await downloaded.path())!, "utf8");
  expect(snapshot).not.toMatch(/<script[\s>]/i);
  expect(snapshot).not.toContain("fonts.googleapis.com");
  expect(snapshot).toContain("mt-globe-fallback");
  expect(Buffer.byteLength(snapshot)).toBeGreaterThan(100000);
  await page.setContent(snapshot);
  await expect(page.getByRole("heading", { name: "Magic Transit." })).toBeVisible();
  await expect(page.locator(".mt-globe-fallback")).toBeVisible();
  expect(attempts).toEqual([]);
  expect(errors).toEqual([]);
});

test("mobile WebGL fallback and print/PDF retain a visible globe and avoid page overflow", async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.addInitScript(() => { HTMLCanvasElement.prototype.getContext = (() => null) as typeof HTMLCanvasElement.prototype.getContext; });
  const attempts = await attachment(page);
  await expect(page.locator(".mt-globe-fallback")).toBeVisible();
  await expect(page.locator(".mt-globe-webgl")).toHaveCount(0);
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
  await page.screenshot({ path: testInfo.outputPath("magic-transit-mobile.png"), fullPage: false });
  await page.emulateMedia({ media: "print" });
  await expect(page.locator(".mt-toolbar")).toBeHidden();
  await expect(page.locator(".mt-globe-fallback")).toBeVisible();
  const pdf = await page.pdf({ format: "A4", printBackground: true });
  expect(pdf.subarray(0, 4).toString()).toBe("%PDF");
  expect(pdf.byteLength).toBeGreaterThan(20000);
  expect(attempts).toEqual([]);
});

test("one-day tunnel evidence stays compact, expands to 24 hours and is omitted from print", async ({ page }, testInfo) => {
  const data = fixture(); data.meta.bucketSeconds = 300;
  data.tunnels = data.tunnels.slice(0, 1); data.tunnelTraffic = [];
  data.health = Array.from({ length: 288 }, (_, i) => ({ timestamp: new Date(Date.parse(data.meta.sinceTs) + i * 300000).toISOString(), tunnel: data.tunnels[0].name, ok: 0, timeout: 100 + i, other: 0, state: 0 }));
  const attempts = await attachment(page, data), panel = page.locator("#mt-tunnels");
  await expect(panel.getByRole("heading", { name: "Hourly probe outcomes" })).toBeVisible();
  await expect(panel.getByText(/No tunnel throughput measurements returned/)).toBeVisible();
  expect(await panel.locator("details").evaluate(e => (e as HTMLDetailsElement).open)).toBe(false);
  await expect(panel.locator("svg[aria-label='Tunnel probe success heatmap'] rect")).toHaveCount(24);
  await expect(panel.locator(":scope > .mt-evidence .mt-table-wrap tbody tr")).toHaveCount(1);
  expect((await panel.boundingBox())!.height).toBeLessThan(1000);
  await panel.screenshot({ path: testInfo.outputPath("tunnel-hourly-summary.png") });
  await panel.locator("summary").click();
  await expect(panel.locator("details tbody tr")).toHaveCount(24);
  await page.emulateMedia({ media: "print" });
  await expect(panel.locator("details")).toBeHidden();
  expect(attempts).toEqual([]);
});

test("on-demand Magic Transit requires an account but no zone and dispatches the correct product", async ({ page }) => {
  const requests: Record<string, unknown>[] = [];
  await page.route("**/api/**", route => {
    const url = route.request().url();
    if (url.endsWith("/magic-transit")) { requests.push(route.request().postDataJSON()); return route.fulfill({ json: { ok: true, magicTransit: fixture() } }); }
    if (url.endsWith("/mt-summary")) return route.fulfill({ json: { ok: true, summary: "Synthetic assessment" } });
    return route.fulfill({ json: { ok: true, email: "example@example.com" } });
  });
  await page.goto("/");
  await page.getByRole("button", { name: "Magic Transit", exact: true }).click();
  await page.getByPlaceholder("Paste your Cloudflare API token").fill(TEST_TOKEN);
  await page.getByPlaceholder(/32-character/).fill(TEST_ACCOUNT);
  await expect(page.getByRole("button", { name: "Fetch Zones" })).toHaveCount(0);
  await page.getByRole("button", { name: /Generate POC Report/ }).click();
  await expect(page.getByRole("heading", { name: "Traffic pulse" })).toBeVisible();
  expect(requests).toHaveLength(1);
  expect(requests[0].accountId).toBe(TEST_ACCOUNT);
  expect(requests[0].zoneId).toBeUndefined();
});

test("attack priorities lead the report and long lists expand offline without losing printable evidence", async ({ page }, testInfo) => {
  const data = fixture();
  data.attackRankings!.sources = Array.from({ length: 25 }, (_, i) => ({ ip: `192.0.2.${i + 1}`, country: "US", bits: (25 - i) * 8000000, packets: (25 - i) * 10000 }));
  data.attackRankings!.targets = Array.from({ length: 25 }, (_, i) => ({ ip: `203.0.113.${i + 1}`, port: 443, protocol: "TCP", application: null, bits: (25 - i) * 8000000, packets: (25 - i) * 10000 }));
  data.rankings.sourceAsns = Array.from({ length: 25 }, (_, i) => ({ name: `645${String(i).padStart(2, "0")} · Example network`, bits: (25 - i) * 8000000, packets: (25 - i) * 10000 }));
  data.rankings.protocols = Array.from({ length: 25 }, (_, i) => ({ name: `Example protocol ${i}`, bits: (25 - i) * 8000000, packets: (25 - i) * 10000 }));
  const attempts = await attachment(page, data), priority = page.locator("#mt-attack-priority");
  const screenshotStyle = await page.addStyleTag({ content: ".mt-toolbar{visibility:hidden!important}" });
  await priority.screenshot({ path: testInfo.outputPath("attack-priority-compact.png") });
  await screenshotStyle.evaluate(el => el.remove());
  const assessment = page.getByRole("heading", { name: "Executive assessment", exact: true });
  expect((await priority.boundingBox())!.y).toBeLessThan((await assessment.boundingBox())!.y);
  expect((await priority.boundingBox())!.height).toBeLessThan(650);
  const sourceTable = page.getByRole("table", { name: "Top DDoS source IPs", exact: true });
  const sourceRows = sourceTable.locator("tbody tr");
  await expect(sourceRows).toHaveCount(25);
  await expect(sourceRows.nth(5)).toBeVisible();
  await expect(sourceRows.nth(6)).toBeHidden();
  await expect(priority.getByRole("columnheader", { name: "Application", exact: true })).toHaveCount(0);
  const sourceCard = priority.locator(".mt-attack-card").first();
  const toggle = sourceCard.getByRole("checkbox", { name: "Show all 25 rows", exact: true });
  await toggle.focus(); await toggle.press("Space");
  await expect(sourceRows.last()).toBeVisible();
  expect((await sourceCard.locator(".mt-table-wrap").boundingBox())!.height).toBeLessThanOrEqual(360);
  await sourceCard.getByRole("checkbox", { name: "Show first 6 rows", exact: true }).press("Space");
  await expect(sourceRows.last()).toBeHidden();

  const rank = page.locator(".mt-rank").filter({ has: page.getByRole("heading", { name: "Source ASNs", exact: true }) });
  await expect(rank.getByRole("table")).toBeHidden();
  expect((await rank.boundingBox())!.height).toBeLessThan(300);
  const distribution = page.locator(".mt-rank").filter({ has: page.getByRole("heading", { name: "Protocols", exact: true }) });
  await expect(distribution.getByText("Other returned categories", { exact: true })).toBeVisible();
  await expect(distribution.locator(".recharts-legend-item")).toHaveCount(6);
  await page.emulateMedia({ media: "print" });
  await expect(sourceRows.last()).toBeVisible();
  await expect(rank.getByRole("table").locator("tbody tr").last()).toBeVisible();
  await expect(distribution.getByRole("table", { name: "Protocols distribution" }).locator("tbody tr")).toHaveCount(25);
  await expect(toggle).toBeHidden();
  await page.emulateMedia({ media: "screen" });
  const pending = page.waitForEvent("download");
  await page.getByRole("button", { name: "HTML", exact: true }).click();
  const snapshot = await readFile((await (await pending).path())!, "utf8");
  expect(snapshot).not.toMatch(/<script[\s>]/i);
  await page.setContent(snapshot);
  const offlineCard = page.locator("#mt-attack-priority .mt-attack-card").first();
  await offlineCard.getByRole("checkbox", { name: "Show all 25 rows", exact: true }).focus();
  await offlineCard.getByRole("checkbox", { name: "Show all 25 rows", exact: true }).press("Space");
  await expect(offlineCard.getByRole("table").locator("tbody tr").last()).toBeVisible();
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
  expect(attempts).toEqual([]);
});

test("older reports do not label general traffic rankings as attack sources", async ({ page }) => {
  const data = fixture(); delete data.attackRankings;
  await attachment(page, data);
  const priority = page.locator("#mt-attack-priority");
  await expect(priority.getByText(/This older report does not include attack-specific rankings/)).toHaveCount(3);
  await expect(priority.getByRole("table")).toHaveCount(0);
});
