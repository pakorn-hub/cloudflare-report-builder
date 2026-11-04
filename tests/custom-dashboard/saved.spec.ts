import { test, expect, type Page } from "@playwright/test";
import { Hono } from "hono";
import { savedDashboardOptions } from "../../shared/saved-dashboard";
import { listSavedDashboards } from "../../apps/api/src/services/cf-saved-dashboards";
import { handleListSavedDashboards } from "../../apps/api/src/routes/list-saved-dashboards";
import { demoDashboardSnapshot } from "../../shared/custom-dashboard";
import { generateCustomDashboardData } from "../../apps/api/src/services/cf-custom-dashboard";

const ACCOUNT = "0".repeat(32), ZONE = "1".repeat(32), TOKEN = "synthetic-selector-token";
const fixture = () => ({ id: "synthetic-dashboard", title: "Synthetic saved traffic", created_by: "private@example.com", sharing: { private: true }, charts: [
  { title: "Saved requests", dataset: "httpRequestsAdaptiveGroups", type: "stat", aggregation: ["count"], filter: [] },
  { title: "Saved hourly traffic", dataset: "httpRequestsAdaptiveGroups", type: "timeseries", series: [{ label: "Requests", aggregation: ["count"], filter: [] }] },
  { title: "Saved countries", dataset: "httpRequestsAdaptiveGroups", type: "top_n", aggregation: ["count"], groupBy: "clientCountryName" },
] });

test("saved definitions map only fully supported charts and discard private metadata", () => {
  const [option] = savedDashboardOptions([fixture()], ACCOUNT, "account");
  expect(option.template?.widgets.map(w => w.type)).toEqual(["stat", "timeseries", "top-n"]);
  expect(option.template?.widgets[1].dimension).toBe("datetimeHour");
  expect(option.template?.title).toBe(fixture().title);
  expect(JSON.stringify(option)).not.toContain("private@example.com"); expect(JSON.stringify(option)).not.toContain("sharing");
  for (const chart of [
    { ...fixture().charts[0], filter: [{ key: "action", operator: "eq", value: "block" }] },
    { ...fixture().charts[0], type: "ratio" },
    { ...fixture().charts[0], limit: 5 },
    { ...fixture().charts[0], data_source: "log_explorer" },
    { ...fixture().charts[1], series: [fixture().charts[1].series![0], fixture().charts[1].series![0]] },
  ]) {
    const [unsupported] = savedDashboardOptions([{ ...fixture(), charts: [chart] }], ACCOUNT, "account");
    expect(unsupported.template).toBeNull(); expect(unsupported.issues.length).toBeGreaterThan(0);
  }
  expect(() => savedDashboardOptions([fixture(), fixture()], ACCOUNT, "account")).toThrow("identifiers");
  expect(() => savedDashboardOptions([{ ...fixture(), scope: "zone", scope_id: "2".repeat(32) }], ACCOUNT, "zone", ZONE)).toThrow("scope");
  expect(() => savedDashboardOptions([fixture()], ACCOUNT, "zone", ZONE)).toThrow("scope");
});

test("saved listing uses fixed API routes, never follows redirects, and keeps failures distinct from empty lists", async () => {
  const original = globalThis.fetch;
  globalThis.fetch = async (url, init) => {
    expect(url).toBe(`https://api.cloudflare.com/client/v4/accounts/${ACCOUNT}/analytics-dashboards`);
    expect(init?.redirect).toBe("manual"); expect(new Headers(init?.headers).get("authorization")).toBe(`Bearer ${TOKEN}`);
    return Response.json({ success: true, result: [fixture()] });
  };
  try {
    expect((await listSavedDashboards(TOKEN, ACCOUNT, "account"))[0].template?.widgets).toHaveLength(3);
    globalThis.fetch = async () => Response.json({ success: true, result: [] });
    expect(await listSavedDashboards(TOKEN, ACCOUNT, "account")).toEqual([]);
    globalThis.fetch = async () => new Response(TOKEN, { status: 500, headers: { "cf-ray": "synthetic-ray-BKK" } });
    await expect(listSavedDashboards(TOKEN, ACCOUNT, "account")).rejects.toThrow(/HTTP 500.*synthetic-ray-BKK/);
    globalThis.fetch = async () => new Response(null, { status: 302, headers: { location: "https://example.invalid/" } });
    await expect(listSavedDashboards(TOKEN, ACCOUNT, "account")).rejects.toThrow(/HTTP 302/);
    globalThis.fetch = async () => Response.json({ success: false, errors: [{ message: TOKEN }], result: [] });
    await expect(listSavedDashboards(TOKEN, ACCOUNT, "account")).rejects.toThrow("successful");
    globalThis.fetch = async () => new Response("not JSON");
    await expect(listSavedDashboards(TOKEN, ACCOUNT, "account")).rejects.toThrow("invalid");
    globalThis.fetch = async () => new Response("x".repeat(2 * 1024 * 1024 + 1));
    await expect(listSavedDashboards(TOKEN, ACCOUNT, "account")).rejects.toThrow("oversized");
    globalThis.fetch = async (url) => {
      expect(url).toBe(`https://api.cloudflare.com/client/v4/accounts/${ACCOUNT}/zones/${ZONE}/analytics-dashboards`);
      return Response.json({ success: true, result: [{ ...fixture(), scope: "zone", scope_id: ZONE }] });
    };
    expect(await listSavedDashboards(TOKEN, ACCOUNT, "zone", ZONE)).toHaveLength(1);
  } finally { globalThis.fetch = original; }
});

test("listing route validates scope and uses stored schedule credentials without exposing or modifying them", async () => {
  const app = new Hono(), original = globalThis.fetch;
  app.post("/list", handleListSavedDashboards);
  const request = (body: unknown, env = {}) => app.request("/list", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }, env);
  let calls = 0;
  globalThis.fetch = async (_url, init) => {
    calls++; expect(new Headers(init?.headers).get("authorization")).toBe(`Bearer ${TOKEN}`);
    return Response.json({ success: true, result: [fixture()] });
  };
  try {
    for (const body of [null, [], { scope: "other" }, { scope: "zone", zoneId: "bad" }, { scope: "account", accountId: "../wrong" }, { scope: "account", apiToken: "bad" }]) expect((await request(body)).status).toBe(400);
    expect(calls).toBe(0);
    const direct = await request({ scope: "account", apiToken: TOKEN, accountId: ACCOUNT });
    expect(direct.status).toBe(200); expect(direct.headers.get("cache-control")).toBe("no-store"); expect(await direct.text()).not.toContain(TOKEN);
    const env = { DB: { prepare: (sql: string) => {
      expect(sql).toBe("SELECT api_token, account_id FROM schedules WHERE id = ?");
      return { bind: (id: string) => { expect(id).toBe("saved-schedule"); return { first: async () => ({ api_token: TOKEN, account_id: ACCOUNT }) }; } };
    } } };
    expect((await request({ scope: "account", scheduleId: "saved-schedule" }, env)).status).toBe(200);
    expect((await request({ scope: "account" })).status).toBe(503);
    globalThis.fetch = async () => new Response(TOKEN, { status: 500 });
    const failed = await request({ scope: "account", apiToken: TOKEN, accountId: ACCOUNT });
    expect(failed.status).toBe(502); const body = await failed.json();
    expect(body.error).toContain("HTTP 500"); expect(body.dashboards).toBeUndefined(); expect(JSON.stringify(body)).not.toContain(TOKEN);
  } finally { globalThis.fetch = original; }
});

test("saved source metadata prevents querying a different account or zone", async () => {
  const [saved] = savedDashboardOptions([{ ...fixture(), scope: "zone", scope_id: ZONE }], ACCOUNT, "zone", ZONE);
  expect(saved.template?.source?.dashboardId).toBe(fixture().id);
  const original = globalThis.fetch;
  globalThis.fetch = async () => { throw new Error("Unexpected upstream query"); };
  try {
    const input = { token: TOKEN, accountId: ACCOUNT, zoneId: ZONE, template: saved.template!, days: 1, tzOffset: 0 };
    await expect(generateCustomDashboardData({ ...input, accountId: "2".repeat(32) })).rejects.toThrow("different account or zone");
    await expect(generateCustomDashboardData({ ...input, zoneId: "2".repeat(32) })).rejects.toThrow("different account or zone");
  } finally { globalThis.fetch = original; }
});

async function openSelector(page: Page) {
  await page.route("**/api/**", route => route.fulfill({ json: { ok: true, email: null } }));
  await page.goto("/"); await page.getByRole("button", { name: "Custom Dashboard", exact: true }).click();
  await page.getByLabel("Analytics API token", { exact: true }).fill(TOKEN);
  await page.getByLabel("Account ID", { exact: true }).fill(ACCOUNT);
  await page.getByLabel("Zone ID", { exact: true }).fill(ZONE);
  await page.getByRole("combobox", { name: "Dashboard source", exact: true }).selectOption("saved");
}

test("saved selector uses returned definitions for preview, clears credentials, and permits building the fetched report", async ({ page }) => {
  await openSelector(page);
  let listing: unknown, generated: { template: unknown } | undefined;
  const dashboards = savedDashboardOptions([fixture()], ACCOUNT, "account");
  await page.route("**/api/custom-dashboard/dashboards", route => { listing = route.request().postDataJSON(); return route.fulfill({ json: { ok: true, dashboards } }); });
  await page.route("**/api/custom-dashboard", route => { generated = route.request().postDataJSON(); return route.fulfill({ json: { ok: true, dashboard: { ...demoDashboardSnapshot(), origin: "api" } } }); });
  await expect(page.getByRole("button", { name: "Fetch fresh analytics", exact: true })).toBeDisabled();
  await page.getByRole("button", { name: "Load saved dashboards", exact: true }).click();
  await page.getByRole("combobox", { name: "Cloudflare saved dashboard", exact: true }).selectOption("synthetic-dashboard");
  expect(listing).toEqual({ apiToken: TOKEN, accountId: ACCOUNT, scope: "account" });
  await expect(page.getByText("Using Synthetic saved traffic", { exact: false })).toBeVisible();
  await page.getByRole("button", { name: "Fetch fresh analytics", exact: true }).click();
  await expect(page.getByLabel("Analytics API token", { exact: true })).toHaveValue("");
  expect(generated?.template).toEqual(dashboards[0].template);
  await page.getByRole("button", { name: "Build report · 6 widgets", exact: true }).click();
  await expect(page.getByText("API-generated dashboard report", { exact: true })).toBeVisible();
});

test("selector exposes upstream failure and unsupported charts without enabling a replacement report", async ({ page }) => {
  await openSelector(page);
  await page.route("**/api/custom-dashboard/dashboards", route => route.fulfill({ status: 502, json: { error: "Cloudflare saved-dashboard listing failed (HTTP 500)." } }));
  await page.getByRole("button", { name: "Load saved dashboards", exact: true }).click();
  await expect(page.getByRole("alert")).toContainText("HTTP 500");
  await expect(page.getByText("Cloudflare returned no saved dashboards in this scope.", { exact: true })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Fetch fresh analytics", exact: true })).toBeDisabled();
  const unsupported = savedDashboardOptions([{ ...fixture(), charts: [{ ...fixture().charts[0], type: "ratio" }] }], ACCOUNT, "account");
  await page.route("**/api/custom-dashboard/dashboards", route => route.fulfill({ json: { ok: true, dashboards: unsupported } }));
  await page.getByRole("button", { name: "Load saved dashboards", exact: true }).click();
  await page.getByRole("combobox", { name: "Cloudflare saved dashboard", exact: true }).selectOption("synthetic-dashboard");
  await expect(page.getByRole("alert")).toContainText("cannot be generated faithfully");
  await expect(page.getByRole("button", { name: "Fetch fresh analytics", exact: true })).toBeDisabled();
  await page.getByRole("combobox", { name: "Dashboard source", exact: true }).selectOption("manual");
  await expect(page.getByRole("button", { name: "Fetch fresh analytics", exact: true })).toBeEnabled();
});

test("credential changes invalidate saved choices and ignore a late response from the old account", async ({ page }) => {
  await openSelector(page);
  let release: () => void = () => {}, started: () => void = () => {};
  const pending = new Promise<void>(resolve => { release = resolve; });
  const requested = new Promise<void>(resolve => { started = resolve; });
  await page.route("**/api/custom-dashboard/dashboards", async route => {
    started(); await pending;
    await route.fulfill({ json: { ok: true, dashboards: savedDashboardOptions([fixture()], ACCOUNT, "account") } });
  });
  await page.getByRole("button", { name: "Load saved dashboards", exact: true }).click();
  await requested;
  await page.getByLabel("Account ID", { exact: true }).fill("2".repeat(32));
  const response = page.waitForResponse("**/api/custom-dashboard/dashboards"); release(); await response;
  await expect(page.getByRole("combobox", { name: "Cloudflare saved dashboard", exact: true })).toBeDisabled();
  await expect(page.getByRole("option", { name: fixture().title, exact: true })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Fetch fresh analytics", exact: true })).toBeDisabled();
});

test("schedule selection stores dashboard identity and restores it on edit without returning the token", async ({ page }) => {
  await openSelector(page);
  const dashboards = savedDashboardOptions([fixture()], ACCOUNT, "account");
  let schedule: Record<string, unknown> | null = null, written: Record<string, unknown> | null = null;
  await page.route("**/api/**", route => {
    const req = route.request(), path = new URL(req.url()).pathname;
    if (path === "/api/schedules" && req.method() === "GET") return route.fulfill({ json: { ok: true, schedules: schedule ? [schedule] : [] } });
    if (path === "/api/schedule/zones") return route.fulfill({ json: { ok: true, zones: [] } });
    if (path === "/api/custom-dashboard/dashboards") return route.fulfill({ json: { ok: true, dashboards } });
    if (path === "/api/schedules" && req.method() === "POST") {
      written = req.postDataJSON();
      const { apiToken: _token, ...safe } = written!;
      schedule = { ...safe, id: "synthetic-saved-schedule", createdAt: "2026-09-01", updatedAt: "2026-09-01", lastRunAt: null, lastStatus: null, lastError: null, apiTokenSet: true, apiTokenHint: "••••test" };
      return route.fulfill({ json: { ok: true, schedule } });
    }
    return route.fulfill({ json: { ok: true, email: null } });
  });
  await page.getByRole("button", { name: "Configure scheduled delivery", exact: true }).click();
  await page.getByRole("button", { name: "New Schedule", exact: true }).click();
  await page.getByRole("button", { name: "Custom Dashboard", exact: true }).click();
  await page.getByPlaceholder("e.g. Weekly AppSec digest — example.com", { exact: true }).fill("Synthetic saved schedule");
  await page.getByLabel("Dashboard zone ID (manual)", { exact: true }).fill(ZONE);
  await page.getByPlaceholder("Customer's Account ID — defaults to the backend account", { exact: true }).fill(ACCOUNT);
  await page.getByPlaceholder("Customer's Cloudflare API token", { exact: true }).fill(TOKEN);
  await page.getByRole("combobox", { name: "Dashboard source", exact: true }).selectOption("saved");
  await page.getByRole("button", { name: "Load saved dashboards", exact: true }).click();
  await page.getByRole("combobox", { name: "Cloudflare saved dashboard", exact: true }).selectOption(fixture().id);
  await page.getByPlaceholder("name@company.com", { exact: true }).fill("recipient@example.com");
  await page.getByRole("button", { name: "Add", exact: true }).click();
  await page.getByPlaceholder("e.g. Weekly AppSec Report — {{zone}} ({{date}})", { exact: true }).fill("Synthetic saved dashboard");
  await page.getByRole("button", { name: "Create Schedule", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Synthetic saved schedule", exact: true })).toBeVisible();
  expect(written?.dashboardTemplate).toEqual(dashboards[0].template);
  expect(schedule).not.toHaveProperty("apiToken");
  await page.getByRole("button", { name: "Edit", exact: true }).click();
  await expect(page.getByRole("combobox", { name: "Dashboard source", exact: true })).toHaveValue("saved");
  await expect(page.getByRole("combobox", { name: "Cloudflare saved dashboard", exact: true })).toHaveValue(fixture().id);
  await expect(page.getByPlaceholder("Customer's Cloudflare API token", { exact: true })).toHaveValue("");
  await expect(page.getByRole("status")).toContainText("Stored selection:");
});
