import { test, expect } from "@playwright/test";
import { dashboardReference, demoDashboardSnapshot, parseDashboardImport } from "../../shared/custom-dashboard";

const response = { data: { viewer: { zones: [{
  total: [{ count: 420 }],
  countries: [{ count: 250, dimensions: { clientCountryName: "TH" } }, { count: 0, dimensions: { clientCountryName: "SG" } }, { count: null, dimensions: { clientCountryName: "JP" } }],
  timeline: [{ count: 100, dimensions: { datetimeHour: "2026-09-01T00:00:00Z" } }, { count: 200, dimensions: { datetimeHour: "2026-09-01T01:00:00Z" } }],
  unavailable: null, empty: [],
}] } } };

test("imports GraphQL aliases without inventing totals, units, dates or null observations", () => {
  const result = parseDashboardImport(JSON.stringify(response));
  expect(result.widgets.map(w => w.title)).toEqual(["total", "countries", "timeline", "unavailable", "empty"]);
  expect(result.widgets.map(w => w.type)).toEqual(["stat", "top-n", "timeseries", "table", "table"]);
  expect(result.widgets[1].rows[1].count).toBe(0);
  expect(result.widgets[1].rows[2].count).toBeNull();
  expect(result.widgets[1].dimension).toBe("dimensions.clientCountryName");
  expect(result.widgets[2].dimension).toBe("dimensions.datetimeHour");
  expect(result.widgets.every(w => w.unit === "")).toBe(true);
  expect(result.period).toBe(""); expect(result.capturedAt).toBe("");
  expect(result.widgets[3].note).toContain("unavailable");
});

test("HAR import reads only Cloudflare GraphQL response bodies, including UTF-8 base64; discards credentials and queries", () => {
  const request = { url: "https://dash.cloudflare.com/api/v4/graphql", headers: [{ name: "Authorization", value: "synthetic-private-header" }], cookies: [{ name: "session", value: "synthetic-private-cookie" }], postData: { text: "synthetic-private-query" } };
  const entries = [
    { request, response: { content: { encoding: "base64", text: Buffer.from(JSON.stringify({ ...response, errors: [{ message: "synthetic-private-error" }] })).toString("base64") } } },
    { request: { url: "https://other.example/graphql" }, response: { content: { text: JSON.stringify(response) } } },
    { request, response: { content: {} } },
  ];
  const result = parseDashboardImport(JSON.stringify({ log: { entries } }));
  expect(result.widgets).toHaveLength(5);
  expect(result.warnings.join(" ")).toContain("GraphQL returned errors");
  expect(result.warnings.join(" ")).toContain("response body missing");
  expect(JSON.stringify(result)).not.toContain("synthetic-private-");
  expect(result.widgets[0].note).toContain("Partial response");
});

test("snapshot round-trip retains mappings and notes while enforcing data limits and safe URLs", () => {
  const demo = demoDashboardSnapshot();
  expect(parseDashboardImport(JSON.stringify(demo))).toEqual(demo);
  expect(demo.notes).toContain("SYNTHETIC");
  const url = `https://dash.cloudflare.com/${"0".repeat(32)}/example.com/dashboards/fixture?token=discarded#discarded`;
  expect(dashboardReference(url)).toEqual({ url: url.split("?")[0], zoneName: "example.com" });
  expect(() => dashboardReference("https://dash.cloudflare.com.evil.example/a/dashboards/b")).toThrow();
  expect(() => parseDashboardImport(JSON.stringify({ ...demo, dashboardUrl: "javascript:alert(1)" }))).toThrow();
  expect(() => parseDashboardImport(JSON.stringify({ ...demo, widgets: [demo.widgets[0], demo.widgets[0]] }))).toThrow("unique");
  expect(() => parseDashboardImport(JSON.stringify({ ...demo, widgets: [{ ...demo.widgets[0], rows: [{ nested: {} }] }] }))).toThrow("nested");
  expect(() => parseDashboardImport(JSON.stringify({ ...demo, widgets: [{ ...demo.widgets[0], rows: Array.from({ length: 5001 }, () => ({ requests: 1 })) }] }))).toThrow("5000");
  expect(() => parseDashboardImport("not JSON")).toThrow("valid JSON");
});

test("unsupported nested data is reported and multiple metrics are not arbitrarily charted", () => {
  const result = parseDashboardImport(JSON.stringify({ data: { viewer: { accounts: [{
    multiple: [{ count: 42, avg: { latency: 25 }, quantiles: { latencyP95: 80 } }],
    nested: [{ dimensions: { lists: [{ id: 1 }] } }],
  }] } } }));
  expect(result.widgets).toHaveLength(1);
  expect(result.widgets[0].type).toBe("table");
  expect(result.warnings.join(" ")).toContain("Not imported");
  expect(() => parseDashboardImport(JSON.stringify({ log: { entries: [] } }))).toThrow("No supported");
});
