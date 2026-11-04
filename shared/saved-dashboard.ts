import { DASHBOARD_DATASETS, validateDashboardTemplate, type DashboardTemplate, type DashboardTemplateWidget } from "./custom-dashboard-template";

export interface SavedDashboard {
  id: string;
  title: string;
  dashboardUrl: string;
  template: DashboardTemplate | null;
  issues: string[];
}

const record = (value: unknown): value is Record<string, unknown> => !!value && typeof value === "object" && !Array.isArray(value);
const emptyFilter = (value: unknown) => value === undefined || (Array.isArray(value) && value.length === 0);

/** Only translate configurations that the report engine can represent completely. */
function chartWidget(input: unknown, index: number): DashboardTemplateWidget {
  if (!record(input)) throw new Error("Invalid chart configuration.");
  const allowed = ["id", "title", "dataset", "type", "aggregation", "filter", "series", "groupBy", "layout", "data_source"];
  if (Object.keys(input).some(key => !allowed.includes(key))) throw new Error("Chart has settings the report engine cannot represent.");
  if (input.data_source !== undefined && input.data_source !== "graphql") throw new Error("Only GraphQL analytics charts are supported.");
  if (typeof input.dataset !== "string" || !Object.prototype.hasOwnProperty.call(DASHBOARD_DATASETS, input.dataset)) throw new Error("Unsupported analytics dataset.");
  if (!emptyFilter(input.filter)) throw new Error("Saved chart filters require an explicit mapping; they have not been dropped.");
  let aggregation = input.aggregation;
  if (input.series !== undefined) {
    if (!Array.isArray(input.series) || input.series.length !== 1 || !record(input.series[0])) throw new Error("Multiple chart series are not supported.");
    const series = input.series[0];
    if (Object.keys(series).some(key => !["filter", "label", "aggregation"].includes(key)) || !emptyFilter(series.filter) || aggregation !== undefined || input.groupBy !== undefined) throw new Error("Saved series settings cannot be represented faithfully.");
    aggregation = series.aggregation;
  }
  if (!Array.isArray(aggregation) || aggregation.length !== 1 || !["count", "sum.edgeResponseBytes"].includes(String(aggregation[0]))) throw new Error("Choose a supported single count or response-bytes aggregation.");
  let type: DashboardTemplateWidget["type"], dimension = "";
  if (input.type === "stat" && input.groupBy === undefined) type = "stat";
  else if (input.type === "timeseries" && input.groupBy === undefined) { type = "timeseries"; dimension = "datetimeHour"; }
  else if (input.type === "top_n" && typeof input.groupBy === "string") { type = "top-n"; dimension = input.groupBy; }
  else throw new Error("Unsupported chart type or grouping.");
  if (typeof input.title !== "string" || !input.title.trim() || input.title.length > 200) throw new Error("A valid chart title is required.");
  return { id: `saved-chart-${index + 1}`, title: input.title.trim(), dataset: input.dataset as DashboardTemplateWidget["dataset"], metric: aggregation[0] as DashboardTemplateWidget["metric"], type, dimension };
}

/** Discard authors, sharing information, arbitrary URLs and all unknown metadata. */
export function savedDashboardOptions(input: unknown, accountId: string, scope: "account" | "zone", zoneId?: string): SavedDashboard[] {
  if (!/^[a-f\d]{32}$/i.test(accountId) || (scope === "zone" && !/^[a-f\d]{32}$/i.test(zoneId ?? ""))) throw new Error("Invalid saved-dashboard scope.");
  if (!Array.isArray(input) || input.length > 1000) throw new Error("Cloudflare returned an invalid or oversized dashboard list.");
  const ids = new Set<string>();
  return input.map(raw => {
    if (!record(raw) || typeof raw.id !== "string" || !/^[\w-]{1,80}$/.test(raw.id) || ids.has(raw.id) || typeof raw.title !== "string" || !raw.title.trim() || raw.title.length > 200) throw new Error("Cloudflare returned invalid dashboard identifiers or titles.");
    ids.add(raw.id);
    if ((raw.scope !== undefined && raw.scope !== scope) || (scope === "zone" && (raw.scope !== "zone" || raw.scope_id !== zoneId)) || (scope === "account" && raw.scope_id != null && raw.scope_id !== accountId)) throw new Error("Cloudflare returned a dashboard outside the requested scope.");
    const title = raw.title.trim(), dashboardUrl = `https://dash.cloudflare.com/${accountId}/analytics/dashboards/${raw.id}`;
    const issues: string[] = [], widgets: DashboardTemplateWidget[] = [];
    const knownFields = ["id", "title", "charts", "scope", "scope_id", "starred", "created_at", "created_by", "updated_at", "updated_by", "access_level", "sharing"];
    if (Object.keys(raw).some(key => !knownFields.includes(key))) issues.push("Dashboard has additional settings that need an explicit mapping.");
    if (!Array.isArray(raw.charts) || raw.charts.length < 1 || raw.charts.length > 12) issues.push("Reports support 1–12 charts; this dashboard cannot be imported completely.");
    else for (let i = 0; i < raw.charts.length; i++) {
      try { widgets.push(chartWidget(raw.charts[i], i)); }
      catch (e) { issues.push(`Chart ${i + 1}: ${e instanceof Error ? e.message : "Unsupported chart."}`); }
    }
    let template: DashboardTemplate | null = null;
    if (!issues.length) {
      try { template = validateDashboardTemplate({ format: "cloudflare-custom-dashboard-template/v1", title, dashboardUrl, hostname: "", path: "", widgets, source: { kind: "cloudflare-saved-dashboard", dashboardId: raw.id, accountId, scope, ...(scope === "zone" ? { zoneId } : {}) } }); }
      catch { issues.push("Dashboard metrics or dimensions are outside the supported report schema."); }
    }
    return { id: raw.id, title, dashboardUrl, template, issues };
  });
}
