import { test, expect, type Page } from "@playwright/test";
import { readFile } from "node:fs/promises";
import { demoDashboardSnapshot } from "../../shared/custom-dashboard";
import { defaultDashboardTemplate } from "../../shared/custom-dashboard-template";
import { buildEmbeddedReportAttachment } from "../../apps/api/src/services/attachment-builder";
import type { ScheduleConfig } from "../../apps/web/src/types";

async function open(page: Page) {
  await page.route("**/static-report/*", async route => {
    const file = route.request().url().endsWith(".js") ? "app.js" : "app.css";
    await route.fulfill({ body: await readFile(`apps/web/dist/static-report/${file}`, "utf8"), contentType: file.endsWith("js") ? "text/javascript" : "text/css" });
  });
  const posts: string[] = [];
  await page.route("**/api/**", route => {
    if (route.request().method() !== "GET") posts.push(route.request().url());
    return route.fulfill({ json: { ok: true, email: null } });
  });
  await page.goto("/");
  await page.getByRole("button", { name: "Custom Dashboard", exact: true }).click();
  return posts;
}

test("new report option supports widget selection, mapping, ordering and PDF/HTML export without report API calls", async ({ page }, info) => {
  const errors: string[] = []; page.on("pageerror", e => errors.push(e.message));
  const posts = await open(page);
  await page.getByRole("button", { name: "Load synthetic example" }).click();
  await page.getByRole("checkbox", { name: "Include Cache hit ratio", exact: true }).uncheck();
  await page.getByLabel("Report title", { exact: true }).fill("Synthetic dashboard report");
  await page.getByRole("button", { name: "Move Top paths up", exact: true }).click();
  await page.getByRole("button", { name: "Build report · 5 widgets", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Synthetic dashboard report", exact: true })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Cache hit ratio", exact: true })).toHaveCount(0);
  await expect(page.getByRole("img", { name: "Requests over time time series" })).toBeVisible();
  await expect(page.locator(".cd-widget h2")).toHaveText(["Requests", "Origin response time p95", "Requests over time", "Top paths", "Top countries"]);
  await page.screenshot({ path: info.outputPath("custom-dashboard-desktop.png"), fullPage: true });
  const snapshotDownload = page.waitForEvent("download");
  await page.getByRole("button", { name: "Save snapshot", exact: true }).click();
  const saved = JSON.parse(await readFile((await (await snapshotDownload).path())!, "utf8"));
  expect(saved.widgets).toHaveLength(5);
  const htmlDownload = page.waitForEvent("download");
  await page.getByRole("button", { name: "Save HTML", exact: true }).click();
  const html = await readFile((await (await htmlDownload).path())!, "utf8");
  expect(html).toContain("window.__EMBEDDED_REPORT__");
  expect(html).toContain("Content-Security-Policy");
  expect(html).toContain("SYNTHETIC EXAMPLE");
  await page.evaluate(() => { window.print = () => { document.body.dataset.printRequested = "yes"; }; });
  await page.getByRole("button", { name: "Save PDF", exact: true }).click();
  await expect(page.locator("body")).toHaveAttribute("data-print-requested", "yes");
  await page.emulateMedia({ media: "print" });
  await expect(page.locator(".cd-toolbar")).toBeHidden();
  await expect(page.locator(".cd-evidence").first()).toHaveCSS("max-height", "none");
  await expect(page.locator("#report-content")).toHaveCSS("padding", "0px");
  const pdf = await page.pdf({ format: "A4", printBackground: true, path: info.outputPath("custom-dashboard.pdf") });
  expect(pdf.subarray(0, 4).toString()).toBe("%PDF");
  expect(pdf.length).toBeGreaterThan(20000);
  await page.emulateMedia({ media: "screen" });
  const requests: string[] = [];
  await page.route("**/*", route => { requests.push(route.request().url()); return route.abort(); });
  await page.setContent(html);
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.getByRole("heading", { name: "Synthetic dashboard report", exact: true })).toBeVisible();
  await expect(page.getByRole("img", { name: "Requests over time time series" })).toBeVisible();
  await expect(page.locator(".cd-ranking li > div").first()).toHaveCSS("display", "flex");
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
  await page.screenshot({ path: info.outputPath("custom-dashboard-offline-mobile.png"), fullPage: true });
  expect(requests).toEqual([]); expect(posts).toEqual([]); expect(errors).toEqual([]);
});

test("HAR imports preserve nulls and show partial-data coverage without exporting request credentials", async ({ page }) => {
  await open(page);
  const har = { log: { entries: [{ request: { url: "https://dash.cloudflare.com/api/v4/graphql", headers: [{ name: "Cookie", value: "synthetic-session-value" }] }, response: { content: { text: JSON.stringify({ errors: [{ message: "Some dataset unavailable" }], data: { viewer: { zones: [{ countryTotals: [{ count: null, dimensions: { country: "TH" } }, { count: 0, dimensions: { country: "SG" } }] }] } } }) } } }] } };
  await page.getByLabel("Dashboard data file").setInputFiles({ name: "dashboard.har", mimeType: "application/json", buffer: Buffer.from(JSON.stringify(har)) });
  await page.getByLabel("Cloudflare custom dashboard URL (optional)").fill(`https://dash.cloudflare.com/${"0".repeat(32)}/example.com/dashboards/fixture?session=discarded`);
  await page.getByRole("button", { name: "Build report · 1 widgets", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Data coverage and import notes" })).toBeVisible();
  await expect(page.getByText("GraphQL returned errors", { exact: false })).toBeVisible();
  await expect(page.getByRole("table", { name: "countryTotals evidence" }).getByText("Unavailable", { exact: true })).toBeVisible();
  await expect(page.getByRole("link", { name: "Source custom dashboard" })).toHaveAttribute("href", `https://dash.cloudflare.com/${"0".repeat(32)}/example.com/dashboards/fixture`);
  const pending = page.waitForEvent("download"); await page.getByRole("button", { name: "Save HTML", exact: true }).click();
  const html = await readFile((await (await pending).path())!, "utf8");
  expect(html).not.toContain("synthetic-session-value"); expect(html).not.toContain("session=discarded");
});

test("invalid imports and URL schemes are rejected; duplicate timestamps and non-aggregate stat data are not misrepresented", async ({ page }) => {
  await open(page);
  await page.getByLabel("Dashboard data file").setInputFiles({ name: "invalid.json", mimeType: "application/json", buffer: Buffer.from("not JSON") });
  await expect(page.getByRole("alert")).toContainText("valid JSON");
  const data = demoDashboardSnapshot();
  data.widgets[0].rows.push({ requests: 99 });
  data.widgets[3].rows[1].timestamp = data.widgets[3].rows[0].timestamp;
  data.widgets[0].title = "<img src=x onerror=alert(1)>";
  await page.getByLabel("Dashboard data file").setInputFiles({ name: "snapshot.json", mimeType: "application/json", buffer: Buffer.from(JSON.stringify(data)) });
  await page.getByLabel("Cloudflare custom dashboard URL (optional)").fill("javascript:alert(1)");
  await page.getByRole("button", { name: "Build report · 6 widgets", exact: true }).click();
  await expect(page.getByRole("alert")).toBeVisible();
  await page.getByLabel("Cloudflare custom dashboard URL (optional)").fill("");
  await page.getByRole("button", { name: "Build report · 6 widgets", exact: true }).click();
  await expect(page.getByText("Values have not been summed.", { exact: false })).toBeVisible();
  await expect(page.getByText("A time-series chart needs", { exact: false })).toBeVisible();
  await expect(page.locator(".cd-widget img")).toHaveCount(0);
  await expect(page.getByRole("heading", { name: "<img src=x onerror=alert(1)>", exact: true })).toBeVisible();
});

test("long evidence tables reveal every row for print and preserve tiny nonzero values", async ({ page }, info) => {
  await open(page);
  const data = demoDashboardSnapshot();
  data.widgets = [{ id: "long", title: "Full returned evidence", type: "table", metric: "value", dimension: "path", unit: "", note: "Synthetic evidence", rows: Array.from({ length: 90 }, (_, i) => ({ path: `/example/${i}`, value: i === 89 ? 0.000000001 : i })) }];
  await page.getByLabel("Dashboard data file").setInputFiles({ name: "long.json", mimeType: "application/json", buffer: Buffer.from(JSON.stringify(data)) });
  await page.getByRole("button", { name: "Build report · 1 widgets", exact: true }).click();
  const table = page.getByRole("table", { name: "Full returned evidence evidence" });
  await expect(table.locator("tbody tr")).toHaveCount(90);
  await expect(table.getByText("0.000000001", { exact: true })).toHaveCount(1);
  await page.emulateMedia({ media: "print" });
  await expect(page.locator(".cd-evidence")).toHaveCSS("max-height", "none");
  await expect(page.locator(".cd-document > tbody > tr")).toHaveCSS("break-inside", "auto");
  await page.pdf({ format: "A4", printBackground: true, path: info.outputPath("custom-dashboard-long-evidence.pdf") });
});

test("API-token preview submits the reusable template and exports without credentials", async ({ page }) => {
  await open(page);
  const data = { ...demoDashboardSnapshot(), origin: "api" as const };
  let request: Record<string, unknown> | undefined;
  await page.route("**/api/custom-dashboard", route => {
    request = route.request().postDataJSON(); return route.fulfill({ json: { ok: true, dashboard: data } });
  });
  await page.getByLabel("Analytics API token", { exact: true }).fill("synthetic-preview-token");
  await page.getByLabel("Account ID", { exact: true }).fill("0".repeat(32));
  await page.getByLabel("Zone ID", { exact: true }).fill("1".repeat(32));
  await page.getByLabel("Complete reporting period").selectOption("last_week");
  await page.getByText("Configure live query widgets", { exact: true }).click();
  await page.getByLabel("Template title", { exact: true }).fill("Synthetic API template");
  const pendingTemplate = page.waitForEvent("download"); await page.getByRole("button", { name: "Save query template", exact: true }).click();
  const savedTemplate = JSON.parse(await readFile((await (await pendingTemplate).path())!, "utf8"));
  expect(savedTemplate.title).toBe("Synthetic API template"); expect(JSON.stringify(savedTemplate)).not.toContain("synthetic-preview-token");
  await page.getByRole("button", { name: "Fetch fresh analytics", exact: true }).click();
  await expect(page.getByLabel("Report title", { exact: true })).toHaveValue(data.title);
  await expect(page.getByLabel("Analytics API token", { exact: true })).toHaveValue("");
  expect(request?.period).toBe("last_week"); expect(request?.template).toEqual(savedTemplate);
  await page.getByRole("button", { name: "Build report · 6 widgets", exact: true }).click();
  await expect(page.getByText("API-generated dashboard report", { exact: true })).toBeVisible();
  const pendingHtml = page.waitForEvent("download"); await page.getByRole("button", { name: "Save HTML", exact: true }).click();
  const html = await readFile((await (await pendingHtml).path())!, "utf8");
  expect(html).not.toContain("synthetic-preview-token"); expect(html).toContain("window.__EMBEDDED_REPORT__");
});

test("scheduler UI saves a query template and pause retains customer account and template", async ({ page }) => {
  await open(page);
  let schedule: ScheduleConfig | null = null;
  const writes: Record<string, unknown>[] = [];
  await page.route("**/api/**", route => {
    const req = route.request(), path = new URL(req.url()).pathname;
    if (path === "/api/schedules" && req.method() === "GET") return route.fulfill({ json: { ok: true, schedules: schedule ? [schedule] : [] } });
    if (path === "/api/schedule/zones") return route.fulfill({ json: { ok: true, zones: [] } });
    if (path.startsWith("/api/schedules") && ["POST", "PUT"].includes(req.method())) {
      const body = req.postDataJSON(); writes.push(body);
      const { apiToken: _token, ...safe } = body;
      schedule = { ...safe, id: "synthetic-schedule", createdAt: "2026-09-01", updatedAt: "2026-09-01", lastRunAt: null, lastStatus: null, lastError: null, apiTokenSet: true, apiTokenHint: "••••test" };
      return route.fulfill({ json: { ok: true, schedule } });
    }
    return route.fulfill({ json: { ok: true, email: null } });
  });
  await page.getByRole("button", { name: "Configure scheduled delivery", exact: true }).click();
  await page.getByRole("button", { name: "New Schedule", exact: true }).click();
  await page.getByRole("button", { name: "Custom Dashboard", exact: true }).click();
  const template = defaultDashboardTemplate(); template.title = "Synthetic scheduled template";
  template.widgets = template.widgets.slice(0, 2);
  await page.getByLabel("Query template file", { exact: true }).setInputFiles({ name: "template.json", mimeType: "application/json", buffer: Buffer.from(JSON.stringify(template)) });
  await page.getByPlaceholder("e.g. Weekly AppSec digest — example.com", { exact: true }).fill("Synthetic automated dashboard");
  await page.getByLabel("Dashboard zone ID (manual)", { exact: true }).fill("1".repeat(32));
  await page.getByLabel("Dashboard zone label", { exact: true }).fill("example.com");
  await page.getByPlaceholder("Customer's Account ID — defaults to the backend account", { exact: true }).fill("0".repeat(32));
  await page.getByPlaceholder("Customer's Cloudflare API token", { exact: true }).fill("synthetic-schedule-token");
  await page.getByPlaceholder("name@company.com", { exact: true }).fill("recipient@example.com");
  await page.getByRole("button", { name: "Add", exact: true }).click();
  await page.getByPlaceholder("e.g. Weekly AppSec Report — {{zone}} ({{date}})", { exact: true }).fill("Synthetic dashboard {{zone}}");
  await page.getByRole("button", { name: "Create Schedule", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Synthetic automated dashboard", exact: true })).toBeVisible();
  expect(writes[0].dashboardTemplate).toEqual(template); expect(writes[0].reportType).toBe("custom-dashboard");
  expect(writes[0].zoneId).toBe("1".repeat(32)); expect(writes[0].apiToken).toBe("synthetic-schedule-token");
  await page.getByRole("button", { name: "Pause schedule", exact: true }).click();
  await expect(page.getByText("Paused", { exact: true })).toBeVisible();
  expect(writes[1].dashboardTemplate).toEqual(template); expect(writes[1].accountId).toBe("0".repeat(32)); expect(writes[1].apiToken).toBeUndefined();
});

test("scheduled HTML renders the built dashboard offline and prints the complete report", async ({ page }, info) => {
  const data = { ...demoDashboardSnapshot(), origin: "api" as const };
  const html = await buildEmbeddedReportAttachment({ ASSETS: { fetch: async (req: Request) => new Response(await readFile(`apps/web/dist/static-report/${req.url.endsWith(".js") ? "app.js" : "app.css"}`, "utf8")) } } as never,
    { kind: "custom-dashboard", data, input: { token: "", product: "custom-dashboard" }, generatedAt: data.capturedAt, scheduleName: "Synthetic offline dashboard" }, "Synthetic dashboard");
  expect(html).toBeTruthy();
  const requests: string[] = [], errors: string[] = [];
  page.on("pageerror", e => errors.push(e.message));
  await page.route("**/*", route => { requests.push(route.request().url()); return route.abort(); });
  await page.setContent(html!);
  await expect(page.locator(".cd-widget")).toHaveCount(6);
  await expect(page.getByRole("img", { name: "Requests over time time series", exact: true })).toBeVisible();
  await expect(page.locator(".cd-toolbar")).toHaveCount(0);
  await page.emulateMedia({ media: "print" });
  const pdf = await page.pdf({ format: "A4", printBackground: true, preferCSSPageSize: true, path: info.outputPath("custom-dashboard-scheduled.pdf") });
  expect(pdf.subarray(0, 5).toString()).toBe("%PDF-"); expect(pdf.length).toBeGreaterThan(20000);
  expect(requests).toEqual([]); expect(errors).toEqual([]);
});
