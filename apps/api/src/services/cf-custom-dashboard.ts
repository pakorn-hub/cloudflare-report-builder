import type { DashboardSnapshot, DashboardRow, DashboardWidget } from "../../../../shared/custom-dashboard";
import { validateDashboardTemplate, type DashboardTemplate } from "../../../../shared/custom-dashboard-template";
import { last30Days, lastCalendarMonth, lastPeriodRange, customDateRange, type ReportPeriod } from "./cf-graphql";
import type { ReportRangeMode } from "../types";

export interface CustomDashboardInput {
  token: string; accountId: string; zoneId: string; zoneName?: string;
  template: DashboardTemplate; tzOffset: number; days: number;
  rangeMode?: ReportRangeMode; period?: ReportPeriod; monthsAgo?: number;
  sinceDate?: string; untilDate?: string; sinceTime?: string; untilTime?: string;
}
export function dashboardRange(input: CustomDashboardInput) {
  if (!Number.isInteger(input.tzOffset) || Math.abs(input.tzOffset) > 840) throw new Error("Invalid timezone offset.");
  switch (input.rangeMode ?? "rolling") {
    case "period":
      if (!["yesterday", "last_week", "last_month"].includes(input.period ?? "")) throw new Error("Choose a complete reporting period.");
      return lastPeriodRange(input.period!, input.tzOffset);
    case "calendar_month":
      if (!Number.isInteger(input.monthsAgo) || input.monthsAgo! < 1 || input.monthsAgo! > 12) throw new Error("monthsAgo must be 1–12.");
      return lastCalendarMonth(input.tzOffset, input.monthsAgo);
    case "custom": {
      const range = customDateRange(input.sinceDate ?? "", input.untilDate ?? "", input.tzOffset, input.sinceTime, input.untilTime);
      if (!range) throw new Error("Invalid custom observation interval.");
      return range;
    }
    case "rolling":
      if (![1, 3, 5, 7, 14, 30].includes(input.days)) throw new Error("Unsupported rolling interval.");
      return last30Days(input.days, input.tzOffset);
    default: throw new Error("Unsupported range mode.");
  }
}

// Bounded parsing keeps upstream bodies within this Worker's memory budget.
export async function boundedBody(response: Response, max: number): Promise<Uint8Array> {
  if (!response.body) throw new Error("Empty upstream response.");
  const reader = response.body.getReader(), chunks: Uint8Array[] = []; let size = 0;
  try {
    while (true) {
      const part = await reader.read(); if (part.done) break;
      size += part.value.length;
      if (size > max) { await reader.cancel(); throw new Error("Upstream response exceeds the report size limit."); }
      chunks.push(part.value);
    }
  } finally { reader.releaseLock(); }
  const bytes = new Uint8Array(size); let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
  return bytes;
}

export async function generateCustomDashboardData(input: CustomDashboardInput): Promise<DashboardSnapshot> {
  if (!/^[a-f\d]{32}$/i.test(input.zoneId) || !/^[a-f\d]{32}$/i.test(input.accountId)) throw new Error("Account ID and zone ID must be 32-character hex values.");
  if (typeof input.token !== "string" || input.token.length < 10 || input.token.length > 500) throw new Error("A valid analytics API token is required.");
  const template = validateDashboardTemplate(input.template), range = dashboardRange(input);
  if (template.source && (template.source.accountId !== input.accountId || (template.source.scope === "zone" && template.source.zoneId !== input.zoneId))) throw new Error("The saved dashboard belongs to a different account or zone. Select it again for the current scope.");
  const warnings: string[] = [], widgets: DashboardWidget[] = new Array(template.widgets.length);
  let cursor = 0, usable = 0, responseBytes = 0;
  await Promise.all(Array.from({ length: Math.min(3, template.widgets.length) }, async () => {
    while (cursor < template.widgets.length) {
      const index = cursor++, w = template.widgets[index];
      const metric = w.metric === "count" ? "count" : "sum { edgeResponseBytes }";
      const unit = w.metric === "count" ? w.dataset === "httpRequestsAdaptiveGroups" ? "requests" : "events" : "bytes";
      const rowLimit = w.dimension ? w.type === "top-n" ? 25 : 2500 : 1;
      const order = w.dimension === "date" || w.dimension === "datetimeHour" ? `${w.dimension}_ASC` : w.metric === "count" ? "count_DESC" : "sum_edgeResponseBytes_DESC";
      const filterType = w.dataset === "httpRequestsAdaptiveGroups" ? "ZoneHttpRequestsAdaptiveGroupsFilter_InputObject" : "ZoneFirewallEventsAdaptiveGroupsFilter_InputObject";
      const query = `query DashboardWidget($zoneTag: string!, $filter: ${filterType}!) { viewer { zones(filter: {zoneTag: $zoneTag}) { rows: ${w.dataset}(limit: ${rowLimit}, filter: $filter${w.dimension ? `, orderBy: [${order}]` : ""}) { ${metric} ${w.dimension ? `dimensions { ${w.dimension} }` : ""} } } } }`;
      const filter = { datetime_geq: range.sinceTs, datetime_leq: range.untilTs,
        ...(template.hostname ? { clientRequestHTTPHost: template.hostname } : {}), ...(template.path ? { clientRequestPath: template.path } : {}) };
      const note = `${w.dataset} · sampled analytics as returned; no rescaling · ${w.dimension ? `up to ${rowLimit} returned categories/buckets` : "full selected interval aggregate"}`;
      let rows: DashboardRow[] = [];
      try {
        const response = await fetch("https://api.cloudflare.com/client/v4/graphql", {
          method: "POST", headers: { Authorization: `Bearer ${input.token}`, "Content-Type": "application/json" },
          body: JSON.stringify({ query, variables: { zoneTag: input.zoneId, filter } }),
          signal: AbortSignal.timeout(30000), redirect: "manual",
        });
        if (!response.ok) throw new Error(`Analytics HTTP ${response.status}`);
        const bytes = await boundedBody(response, 2 * 1024 * 1024);
        responseBytes += bytes.length;
        if (responseBytes > 6 * 1024 * 1024) throw new Error("Analytics report response budget reached");
        const json = JSON.parse(new TextDecoder().decode(bytes)) as { errors?: unknown[]; data?: { viewer?: { zones?: { rows?: unknown }[] } } };
        if (json.errors?.length) throw new Error("Analytics query unavailable (check dataset access, retention, filters and token permissions)");
        const returned = json.data?.viewer?.zones?.[0]?.rows;
        if (!Array.isArray(returned) || returned.length > rowLimit) throw new Error("Analytics dataset unavailable");
        rows = returned.map(value => {
          const r = value as { count?: unknown; sum?: { edgeResponseBytes?: unknown }; dimensions?: Record<string, unknown> };
          const valueNumber = w.metric === "count" ? r.count : r.sum?.edgeResponseBytes;
          const row: DashboardRow = { [w.metric]: typeof valueNumber === "number" && Number.isFinite(valueNumber) ? valueNumber : null };
          if (w.dimension) { const d = r.dimensions?.[w.dimension]; row[w.dimension] = typeof d === "string" || typeof d === "number" ? d : null; }
          return row;
        });
        usable++;
        if (returned.length === rowLimit && rowLimit > 1) warnings.push(`${w.title}: the return limit was reached; additional categories or buckets may be omitted.`);
      } catch (e) {
        // Deliberately do not echo upstream error text, request bodies or credentials.
        const reason = e instanceof Error && /^Analytics /.test(e.message) ? e.message : "Analytics request failed or timed out";
        warnings.push(`${w.title}: ${reason}. Data remains unavailable, not zero.`);
      }
      widgets[index] = { id: w.id, title: w.title, type: w.type, metric: w.metric, dimension: w.dimension, unit, note, rows };
    }
  }));
  if (!usable) throw new Error("All dashboard queries failed. Check the analytics token, zone access, dataset entitlement and retention.");
  return { format: "cloudflare-custom-dashboard/v1", origin: "api", title: template.title, zoneName: input.zoneName || input.zoneId,
    dashboardUrl: template.dashboardUrl, capturedAt: new Date().toISOString(), period: `${range.sinceTs} → ${range.untilTs} (UTC; reporting offset ${input.tzOffset} minutes)`,
    notes: `Fresh GraphQL API queries for this execution. ${template.hostname ? `Exact hostname: ${template.hostname}. ` : ""}${template.path ? `Exact path: ${template.path}. ` : ""}Saved report template; not an automatic import of Cloudflare's saved dashboard definition.`, widgets, warnings };
}
