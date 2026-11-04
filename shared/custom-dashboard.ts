/** Local-only dashboard snapshots. Never retain HAR headers, cookies or queries. */
export type DashboardCell = string | number | boolean | null;
export type DashboardRow = Record<string, DashboardCell>;
export type DashboardWidgetType = "stat" | "timeseries" | "top-n" | "table";
export interface DashboardWidget {
  id: string;
  title: string;
  type: DashboardWidgetType;
  rows: DashboardRow[];
  metric: string;
  dimension: string;
  unit: string;
  note: string;
}
export interface DashboardSnapshot {
  format: "cloudflare-custom-dashboard/v1";
  origin?: "api";
  title: string;
  zoneName: string;
  dashboardUrl: string;
  period: string;
  capturedAt: string;
  notes: string;
  widgets: DashboardWidget[];
  warnings: string[];
}

export const MAX_DASHBOARD_IMPORT_BYTES = 20 * 1024 * 1024;
const MAX_WIDGETS = 100, MAX_ROWS = 5000, MAX_COLUMNS = 80;
const FORMAT = "cloudflare-custom-dashboard/v1";
const object = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);
const text = (v: unknown, max = 2000): string => typeof v === "string" ? v.slice(0, max) : "";
const cell = (v: unknown): v is DashboardCell => v === null || typeof v === "boolean" || typeof v === "string" || (typeof v === "number" && Number.isFinite(v));

/** Validate a reference URL without ever requesting it or retaining query tokens. */
export function dashboardReference(input: string): { url: string; zoneName: string } {
  const url = new URL(input);
  if (url.protocol !== "https:" || url.hostname !== "dash.cloudflare.com" || url.username || url.password || url.port) {
    throw new Error("Use an HTTPS custom dashboard URL on dash.cloudflare.com.");
  }
  const parts = url.pathname.split("/").filter(Boolean);
  const last = parts[parts.length - 1];
  if (!/^[a-f\d]{32}$/i.test(parts[0] ?? "") || !parts.includes("dashboards") || !last || last === "dashboards") {
    throw new Error("Use a link to an individual Cloudflare custom dashboard.");
  }
  return { url: `${url.origin}${url.pathname}`, zoneName: parts[1]?.includes(".") ? parts[1] : "" };
}

export function dashboardColumns(rows: DashboardRow[]): string[] {
  return [...new Set(rows.flatMap(row => Object.keys(row)))];
}
export function dashboardMetrics(rows: DashboardRow[]): string[] {
  return dashboardColumns(rows).filter(key => rows.some(row => typeof row[key] === "number"));
}

function cleanRows(input: unknown): DashboardRow[] {
  if (!Array.isArray(input) || input.length > MAX_ROWS) throw new Error(`Each widget must have at most ${MAX_ROWS} rows.`);
  const rows = input.map(row => {
    if (!object(row) || Object.keys(row).length > MAX_COLUMNS) throw new Error(`Rows must be flat objects with at most ${MAX_COLUMNS} columns.`);
    const out: DashboardRow = Object.create(null);
    for (const [key, value] of Object.entries(row)) {
      if (key.length > 200 || !cell(value) || (typeof value === "string" && value.length > 10000)) {
        throw new Error("Widget cells must be finite numbers, text, booleans or null (not nested objects).");
      }
      out[key] = value;
    }
    return out;
  });
  if (dashboardColumns(rows).length > MAX_COLUMNS) throw new Error(`Each widget must have at most ${MAX_COLUMNS} columns.`);
  return rows;
}

function flatten(input: Record<string, unknown>, prefix = "", depth = 0): DashboardRow {
  if (depth > 12) throw new Error("The response is nested too deeply.");
  const out: DashboardRow = Object.create(null);
  for (const [key, value] of Object.entries(input)) {
    const path = prefix ? `${prefix}.${key}` : key;
    if (cell(value)) out[path] = value;
    else if (object(value)) Object.assign(out, flatten(value, path, depth + 1));
    else if (Array.isArray(value)) throw new Error("Nested array data needs an explicit snapshot mapping; it cannot be flattened safely.");
  }
  return out;
}

function snapshot(input: Record<string, unknown>): DashboardSnapshot {
  if (!Array.isArray(input.widgets) || input.widgets.length === 0 || input.widgets.length > MAX_WIDGETS) {
    throw new Error(`A snapshot must contain 1–${MAX_WIDGETS} widgets.`);
  }
  const ids = new Set<string>();
  const widgets = input.widgets.map((value, i): DashboardWidget => {
    if (!object(value)) throw new Error("Invalid widget.");
    const id = text(value.id, 100) || `widget-${i + 1}`;
    if (ids.has(id)) throw new Error("Widget IDs must be unique.");
    ids.add(id);
    const rows = cleanRows(value.rows), columns = dashboardColumns(rows);
    if (!["stat", "timeseries", "top-n", "table"].includes(String(value.type))) throw new Error("Unknown widget type.");
    const metric = text(value.metric, 200), dimension = text(value.dimension, 200);
    if (metric && rows.length && !dashboardMetrics(rows).includes(metric)) throw new Error(`Widget ${i + 1}: metric must name a numeric column.`);
    if (dimension && rows.length && !columns.includes(dimension)) throw new Error(`Widget ${i + 1}: dimension must name a column.`);
    return { id, title: text(value.title, 200) || `Widget ${i + 1}`, type: value.type as DashboardWidgetType, rows, metric, dimension, unit: text(value.unit, 40), note: text(value.note) };
  });
  const dashboardUrl = text(input.dashboardUrl) ? dashboardReference(text(input.dashboardUrl)).url : "";
  return { format: FORMAT, ...(input.origin === "api" ? { origin: "api" as const } : {}), title: text(input.title, 200) || "Custom dashboard", zoneName: text(input.zoneName, 200), dashboardUrl,
    period: text(input.period, 300), capturedAt: text(input.capturedAt, 100), notes: text(input.notes), widgets,
    warnings: Array.isArray(input.warnings) ? input.warnings.filter((v): v is string => typeof v === "string").slice(0, 100).map(v => v.slice(0, 2000)) : [] };
}

function emptySnapshot(): DashboardSnapshot {
  return { format: FORMAT, title: "Custom dashboard", zoneName: "", dashboardUrl: "", period: "", capturedAt: "", notes: "", widgets: [], warnings: [] };
}

function addResponse(result: DashboardSnapshot, response: unknown, prefix: string) {
  if (!object(response)) return;
  const hasErrors = Array.isArray(response.errors) && response.errors.length > 0;
  if (hasErrors) result.warnings.push(`${prefix}: GraphQL returned errors. Partial data may be present; check the original dashboard.`);
  if (!object(response.data) || !object(response.data.viewer)) return;
  const viewer = response.data.viewer;
  for (const scope of ["zones", "accounts"]) {
    const resources = viewer[scope];
    if (!Array.isArray(resources)) continue;
    resources.forEach((resource, index) => {
      if (!object(resource)) return;
      for (const [alias, data] of Object.entries(resource)) {
        if (alias === "__typename" || (!Array.isArray(data) && data !== null)) continue;
        if (data !== null && !data.every(object)) continue;
        if (result.widgets.length >= MAX_WIDGETS) throw new Error(`Import contains more than ${MAX_WIDGETS} datasets. Capture only the dashboard load.`);
        const name = `${prefix} / ${scope}[${index}] / ${alias}`;
        let rows: DashboardRow[];
        try { rows = data === null ? [] : cleanRows(data.map(row => flatten(row))); }
        catch { result.warnings.push(`${name}: unsupported nested data or dataset size. Not imported.`); continue; }
        const metrics = dashboardMetrics(rows), columns = dashboardColumns(rows);
        const time = columns.find(key => /(?:^|\.)(?:date|datetime\w*|timestamp)$/.test(key));
        const dimension = time ?? columns.find(key => !metrics.includes(key) && key !== "__typename") ?? "";
        // Choose a table for multiple metrics rather than guessing which one the dashboard plotted.
        const type = metrics.length !== 1 ? "table" : rows.length === 1 && !dimension ? "stat" : time ? "timeseries" : "top-n";
        result.widgets.push({ id: `import-${result.widgets.length + 1}`, title: alias, rows, metric: metrics[0] ?? "", dimension,
          type, unit: "", note: `${name}${hasErrors ? " · Partial response; GraphQL errors reported" : ""}${data === null ? " · Data unavailable (null response)" : rows.length === 0 ? " · No rows returned" : ""}` });
      }
    });
  }
}

/** Accept our documented snapshot, a GraphQL response, or a HAR with response bodies. */
export function parseDashboardImport(json: string): DashboardSnapshot {
  if (new TextEncoder().encode(json).byteLength > MAX_DASHBOARD_IMPORT_BYTES) throw new Error("Import must be under 20 MB.");
  let input: unknown;
  try { input = JSON.parse(json); } catch { throw new Error("Choose a valid JSON snapshot or HAR file. A PDF contains no query data."); }
  if (!object(input)) throw new Error("Import must be a JSON object.");
  if (input.format === FORMAT) return snapshot(input);
  const result = emptySnapshot();
  if (object(input.log) && Array.isArray(input.log.entries)) {
    if (input.log.entries.length > 10000) throw new Error("Capture only the dashboard load (at most 10,000 network entries).");
    for (const [i, entry] of input.log.entries.entries()) {
      if (!object(entry) || !object(entry.request) || typeof entry.request.url !== "string" || !object(entry.response) || !object(entry.response.content)) continue;
      let url: URL;
      try { url = new URL(entry.request.url); } catch { continue; }
      if (url.protocol !== "https:" || !["api.cloudflare.com", "dash.cloudflare.com"].includes(url.hostname) || !/\/graphql\/?$/.test(url.pathname)) continue;
      const content = entry.response.content;
      if (typeof content.text !== "string" || !content.text) { result.warnings.push(`Request ${i + 1}: response body missing. Export HAR with content.`); continue; }
      let response: unknown;
      try {
        const body = content.encoding === "base64" ? new TextDecoder("utf-8", { fatal: true, ignoreBOM: false }).decode(Uint8Array.from(atob(content.text), c => c.charCodeAt(0))) : content.text;
        response = JSON.parse(body);
      } catch { result.warnings.push(`Request ${i + 1}: response is not readable JSON.`); continue; }
      addResponse(result, response, `Request ${i + 1}`);
    }
    result.warnings.unshift("Imported GraphQL datasets, not the saved widget configuration. Set titles, metrics, units, order and chart types below. Repeated requests may contain duplicate datasets. Logs/Observability and non-GraphQL widgets are not imported.");
  } else {
    addResponse(result, input, "GraphQL response");
    result.warnings.unshift("Imported a GraphQL response. Confirm chart mappings, units and the observation period before exporting.");
  }
  if (!result.widgets.length) throw new Error(`No supported GraphQL datasets found. Include response bodies, or use a ${FORMAT} snapshot.`);
  return result;
}

/** Explicitly synthetic and independent of all customer references. */
export function demoDashboardSnapshot(): DashboardSnapshot {
  return snapshot({ format: FORMAT, title: "Example traffic overview", zoneName: "example.com", period: "2026-09-01 00:00–06:00 UTC", capturedAt: "2026-09-01T06:05:00Z",
    notes: "SYNTHETIC EXAMPLE — invented measurements for demonstrating the report layout. No customer data or live queries.",
    widgets: [
      { title: "Requests", type: "stat", metric: "requests", rows: [{ requests: 1200000 }], note: "Sampled estimate · full selected interval" },
      { title: "Cache hit ratio", type: "stat", metric: "cacheHitPercent", unit: "%", rows: [{ cacheHitPercent: 86.4 }] },
      { title: "Origin response time p95", type: "stat", metric: "p95", unit: "ms", rows: [{ p95: 182 }] },
      { title: "Requests over time", type: "timeseries", dimension: "timestamp", metric: "requests", rows: [32000, 38000, 35000, 51000, 44000, 39000].map((requests, i) => ({ timestamp: `2026-09-01T0${i}:00:00Z`, requests })), note: "Hourly buckets · illustrative subset, not a reconciliation to the headline total" },
      { title: "Top countries", type: "top-n", dimension: "country", metric: "requests", rows: [{ country: "TH", requests: 510000 }, { country: "SG", requests: 220000 }, { country: "JP", requests: 180000 }, { country: "US", requests: 120000 }], note: "Returned categories only · not the complete population" },
      { title: "Top paths", type: "top-n", dimension: "path", metric: "requests", rows: [{ path: "/", requests: 280000 }, { path: "/products", requests: 150000 }, { path: "/api/search", requests: 90000 }] },
    ] });
}
