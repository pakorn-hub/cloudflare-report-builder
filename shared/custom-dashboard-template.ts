import { dashboardReference, type DashboardWidgetType } from "./custom-dashboard";

export const DASHBOARD_DATASETS = {
  httpRequestsAdaptiveGroups: { label: "HTTP requests (sampled)", metrics: ["count", "sum.edgeResponseBytes"], dimensions: ["", "datetimeHour", "date", "clientCountryName", "clientRequestPath", "clientRequestHTTPHost", "edgeResponseStatus", "cacheStatus", "clientIP"] },
  firewallEventsAdaptiveGroups: { label: "Security events (sampled)", metrics: ["count"], dimensions: ["", "datetimeHour", "date", "action", "source", "clientCountryName", "clientIP", "clientRequestHTTPHost", "clientRequestPath", "ruleId"] },
} as const;
export type DashboardDataset = keyof typeof DASHBOARD_DATASETS;
export interface DashboardTemplateWidget {
  id: string; title: string; dataset: DashboardDataset;
  metric: "count" | "sum.edgeResponseBytes";
  dimension: string; type: DashboardWidgetType;
}
export interface DashboardTemplate {
  format: "cloudflare-custom-dashboard-template/v1";
  title: string; dashboardUrl: string;
  hostname: string; path: string;
  widgets: DashboardTemplateWidget[];
  source?: { kind: "cloudflare-saved-dashboard"; dashboardId: string; accountId: string; scope: "account" | "zone"; zoneId?: string };
}

export function validateDashboardTemplate(input: unknown): DashboardTemplate {
  if (!input || typeof input !== "object" || Array.isArray(input)) throw new Error("A dashboard template is required.");
  const b = input as Record<string, unknown>;
  if (b.format !== "cloudflare-custom-dashboard-template/v1") throw new Error("Invalid dashboard template format.");
  const string = (value: unknown, name: string, max: number): string => {
    if (typeof value !== "string" || value.length > max) throw new Error(`${name} must be text (max ${max} characters).`);
    return value.trim();
  };
  const title = string(b.title, "Title", 200);
  if (!title) throw new Error("A report title is required.");
  const hostname = string(b.hostname ?? "", "Hostname filter", 255);
  const path = string(b.path ?? "", "Path filter", 2000);
  if (hostname && !/^[a-z\d.-]+$/i.test(hostname)) throw new Error("Hostname must be an exact hostname, without a scheme, port or path.");
  if (path && !path.startsWith("/")) throw new Error("An exact path filter must start with /.");
  const rawUrl = string(b.dashboardUrl ?? "", "Dashboard URL", 2000);
  const dashboardUrl = rawUrl ? dashboardReference(rawUrl).url : "";
  if (!Array.isArray(b.widgets) || b.widgets.length < 1 || b.widgets.length > 12) throw new Error("Choose 1–12 widgets per dashboard template.");
  const ids = new Set<string>();
  const widgets = b.widgets.map((value): DashboardTemplateWidget => {
    if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Invalid template widget.");
    const w = value as Record<string, unknown>;
    const id = string(w.id, "Widget ID", 80), title = string(w.title, "Widget title", 200);
    if (!id || ids.has(id) || !title) throw new Error("Widget IDs must be unique and titles must not be empty.");
    ids.add(id);
    if (typeof w.dataset !== "string" || !Object.prototype.hasOwnProperty.call(DASHBOARD_DATASETS, w.dataset)) throw new Error("Unsupported dashboard dataset.");
    const dataset = w.dataset as DashboardDataset, catalog = DASHBOARD_DATASETS[dataset];
    if (!(catalog.metrics as readonly unknown[]).includes(w.metric)) throw new Error("Unsupported metric for the selected dataset.");
    if (!(catalog.dimensions as readonly unknown[]).includes(w.dimension)) throw new Error("Unsupported dimension for the selected dataset.");
    if (!["stat", "timeseries", "top-n", "table"].includes(String(w.type))) throw new Error("Unsupported chart type.");
    if (w.type === "stat" && w.dimension !== "") throw new Error("Stat widgets must use an aggregate without a dimension.");
    if (w.type === "timeseries" && w.dimension !== "datetimeHour" && w.dimension !== "date") throw new Error("Time-series widgets need an hourly or daily time dimension.");
    if (w.type === "top-n" && (!w.dimension || w.dimension === "datetimeHour" || w.dimension === "date")) throw new Error("Top-N widgets need a category dimension.");
    return { id, title, dataset, metric: w.metric as DashboardTemplateWidget["metric"], dimension: w.dimension as string, type: w.type as DashboardWidgetType };
  });
  let source: DashboardTemplate["source"];
  if (b.source !== undefined) {
    if (!b.source || typeof b.source !== "object" || Array.isArray(b.source)) throw new Error("Invalid saved dashboard source.");
    const s = b.source as Record<string, unknown>;
    if (s.kind !== "cloudflare-saved-dashboard" || typeof s.dashboardId !== "string" || !/^[\w-]{1,80}$/.test(s.dashboardId) || typeof s.accountId !== "string" || !/^[a-f\d]{32}$/i.test(s.accountId) || (s.scope !== "account" && s.scope !== "zone") || (s.scope === "zone" && (typeof s.zoneId !== "string" || !/^[a-f\d]{32}$/i.test(s.zoneId)))) throw new Error("Invalid saved dashboard source.");
    source = { kind: "cloudflare-saved-dashboard", dashboardId: s.dashboardId, accountId: s.accountId, scope: s.scope, ...(s.scope === "zone" ? { zoneId: s.zoneId as string } : {}) };
  }
  return { format: "cloudflare-custom-dashboard-template/v1", title, dashboardUrl, hostname, path, widgets, ...(source ? { source } : {}) };
}

export function defaultDashboardTemplate(): DashboardTemplate {
  return { format: "cloudflare-custom-dashboard-template/v1", title: "Traffic and security overview", dashboardUrl: "", hostname: "", path: "", widgets: [
    { id: "requests", title: "Requests", dataset: "httpRequestsAdaptiveGroups", metric: "count", dimension: "", type: "stat" },
    { id: "bandwidth", title: "Response bandwidth", dataset: "httpRequestsAdaptiveGroups", metric: "sum.edgeResponseBytes", dimension: "", type: "stat" },
    { id: "security-events", title: "Security events", dataset: "firewallEventsAdaptiveGroups", metric: "count", dimension: "", type: "stat" },
    { id: "traffic", title: "Requests over time", dataset: "httpRequestsAdaptiveGroups", metric: "count", dimension: "datetimeHour", type: "timeseries" },
    { id: "countries", title: "Top countries", dataset: "httpRequestsAdaptiveGroups", metric: "count", dimension: "clientCountryName", type: "top-n" },
    { id: "paths", title: "Top paths", dataset: "httpRequestsAdaptiveGroups", metric: "count", dimension: "clientRequestPath", type: "top-n" },
  ] };
}
