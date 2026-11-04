/**
 * ApiShieldSection — API Traffic & API Shield posture.
 *
 * Shows:
 *   1. API traffic KPIs (volume, error rate, % of total)
 *   2. API request volume time-series
 *   3. HTTP method breakdown (GET/POST/PUT/DELETE distribution)
 *   4. HTTP status breakdown (2xx success vs 4xx/5xx errors)
 *   5. Top API paths by request count
 *   6. API Shield posture: discovered operations, schemas, JWT validation
 *   7. Endpoint risk labels: zombie APIs, missing/mixed auth, BOLA, sensitive data
 *   8. Business-function traffic: login, sign-up, purchase, password reset, etc.
 */
import { Shield, Code2, CheckCircle2, AlertTriangle, XCircle, Ghost, KeyRound, ShieldAlert } from "lucide-react";
import type { AppSecData } from "../../types";
import { formatNumber, formatBytes } from "../../utils/formatters";
import SectionHeader from "../../components/SectionHeader";
import {
  ResponsiveContainer, AreaChart, Area, BarChart, Bar, Cell,
  XAxis, YAxis, CartesianGrid, Tooltip,
} from "recharts";

interface Props { data: AppSecData }

// HTTP method colours
const METHOD_COLORS: Record<string, string> = {
  GET:    "#3B82F6",
  POST:   "#F6821F",
  PUT:    "#8B5CF6",
  DELETE: "#EF4444",
  PATCH:  "#F59E0B",
  HEAD:   "#6B7280",
  OPTIONS:"#9CA3AF",
};

// Status code → category
function statusCategory(code: number): "2xx" | "3xx" | "4xx" | "5xx" {
  if (code >= 500) return "5xx";
  if (code >= 400) return "4xx";
  if (code >= 300) return "3xx";
  return "2xx";
}

const STATUS_COLORS: Record<string, string> = {
  "2xx": "#10B981",
  "3xx": "#3B82F6",
  "4xx": "#F59E0B",
  "5xx": "#EF4444",
};

// Display metadata for KNOWN labels — any label Cloudflare returns that
// isn't in this map still renders correctly via the fallback in riskLabel()/
// useCaseLabel() below (title-cased from the raw label name), since the
// backend now classifies ALL labels dynamically by prefix rather than
// filtering against a fixed allowlist (see fetch-appsec.ts).
const RISK_LABEL_META: Record<string, { title: string; color: string }> = {
  "cf-risk-zombie":            { title: "Zombie APIs",          color: "#6B7280" },
  "cf-risk-missing-auth":      { title: "Missing Auth",         color: "#EF4444" },
  "cf-risk-mixed-auth":        { title: "Mixed Auth",           color: "#F59E0B" },
  "cf-risk-sensitive":         { title: "Sensitive Data",       color: "#EC4899" },
  "cf-risk-bola-enumeration":  { title: "BOLA — Enumeration",   color: "#DC2626" },
  "cf-risk-bola-pollution":    { title: "BOLA — Param Pollution", color: "#DC2626" },
  "cf-risk-errors-anomaly":    { title: "Error Anomaly",        color: "#F59E0B" },
  "cf-risk-latency-anomaly":   { title: "Latency Anomaly",      color: "#F59E0B" },
  "cf-risk-size-anomaly":      { title: "Response Size Anomaly", color: "#F59E0B" },
};

const USE_CASE_LABEL_META: Record<string, { title: string; color: string }> = {
  "cf-api-endpoint":   { title: "API Endpoint",      color: "#3B82F6" },
  "cf-log-in":         { title: "Login",            color: "#3B82F6" },
  "cf-sign-up":        { title: "Sign-up",           color: "#8B5CF6" },
  "cf-content":        { title: "Content",           color: "#6B7280" },
  "cf-purchase":       { title: "Purchase",           color: "#10B981" },
  "cf-password-reset": { title: "Password Reset",     color: "#F59E0B" },
  "cf-add-cart":       { title: "Add to Cart",        color: "#14B8A6" },
  "cf-add-payment":    { title: "Add Payment Method",  color: "#EF4444" },
  "cf-check-value":    { title: "Check Stored Value",  color: "#F97316" },
  "cf-add-post":       { title: "Post / Review",       color: "#9CA3AF" },
  "cf-account-update": { title: "Account Update",      color: "#3B82F6" },
  "cf-llm":            { title: "LLM-Powered",         color: "#7C3AED" },
  "cf-mcp":            { title: "MCP (AI Tool Access)", color: "#7C3AED" },
  "cf-rss-feed":       { title: "RSS Feed",            color: "#6B7280" },
  "cf-web-page":       { title: "Web Page",            color: "#6B7280" },
  "cf-contains-ads":   { title: "Contains Ads",        color: "#6B7280" },
};

function riskLabel(label: string): string {
  return RISK_LABEL_META[label]?.title ?? label.replace("cf-risk-", "").replace(/-/g, " ").replace(/^\w/, (c) => c.toUpperCase());
}
function useCaseLabel(label: string): string {
  return USE_CASE_LABEL_META[label]?.title ?? label.replace("cf-", "").replace(/-/g, " ").replace(/^\w/, (c) => c.toUpperCase());
}

/**
 * Defensive guard: Cloudflare API response shapes have proven to not always
 * match documented/expected types across plans and feature entitlements
 * (e.g. api_gateway/schemas returning an object instead of an array). Never
 * trust that a field typed as an array in AppSecData actually IS an array at
 * runtime — always fall back to [] instead of letting .some()/.map()/.filter()
 * throw and crash the whole report.
 */
function asArray<T>(v: T[] | undefined | null): T[] {
  return Array.isArray(v) ? v : [];
}

export default function ApiShieldSection({ data }: Props) {
  const apiTrafficSeries = asArray(data.apiTrafficSeries);
  const apiTopPaths      = asArray(data.apiTopPaths);
  const apiMethods       = asArray(data.apiMethods);
  const apiStatus        = asArray(data.apiStatus);
  const apiOperations    = asArray(data.apiOperations);
  const apiSchemas       = asArray(data.apiSchemas);
  const apiJwtConfigs    = asArray(data.apiJwtConfigs);
  const apiRiskLabels     = asArray(data.apiRiskLabels);
  const apiUseCaseLabels  = asArray(data.apiUseCaseLabels);
  const apiZombieEndpoints = asArray(data.apiZombieEndpoints);
  const apiRiskyEndpoints  = asArray(data.apiRiskyEndpoints);
  const apiOperationsTotalCount = data.apiOperationsTotalCount ?? 0;
  const discoveryPendingReviewCount = data.discoveryPendingReviewCount ?? 0;

  // KPIs
  const totalApiRequests = apiTrafficSeries.reduce((s, d) => s + d.requests, 0);
  const totalApiBytes    = apiTrafficSeries.reduce((s, d) => s + d.bytes, 0);
  const totalRequests    = data.summary.totalRequests;
  const apiPct           = totalRequests > 0 ? Math.round((totalApiRequests / totalRequests) * 100) : 0;

  const errorRequests = apiStatus
    .filter((s) => s.status >= 400)
    .reduce((sum, s) => sum + s.requests, 0);
  const errorRate = totalApiRequests > 0
    ? ((errorRequests / totalApiRequests) * 100).toFixed(1)
    : "0.0";

  // Aggregate status by category
  const statusByCategory = new Map<string, number>();
  for (const s of apiStatus) {
    const cat = statusCategory(s.status);
    statusByCategory.set(cat, (statusByCategory.get(cat) ?? 0) + s.requests);
  }
  const statusBars = ["2xx", "3xx", "4xx", "5xx"].map((cat) => ({
    name: cat, value: statusByCategory.get(cat) ?? 0, color: STATUS_COLORS[cat],
  })).filter((b) => b.value > 0);

  const hasData = totalApiRequests > 0 || apiOperations.length > 0 || apiOperationsTotalCount > 0
    || apiRiskLabels.length > 0 || apiUseCaseLabels.length > 0;

  // Risk KPI shortcuts — prefer the authoritative REST label count (persisted,
  // traffic-window-independent, matches the dashboard's Web Assets numbers)
  // over the traffic-sampled table length, since a true zombie endpoint (by
  // definition) produces no traffic and can never be fully enumerated via
  // GraphQL — see apiZombieEndpointsTotalCount computation in fetch-appsec.ts.
  const zombieCount   = data.apiZombieEndpointsTotalCount ?? apiZombieEndpoints.length;
  const missingAuthOp = apiRiskLabels.find((r) => r.label === "cf-risk-missing-auth")?.operationCount ?? 0;
  const mixedAuthOp    = apiRiskLabels.find((r) => r.label === "cf-risk-mixed-auth")?.operationCount ?? 0;
  const bolaOpCount    = new Set(
    apiRiskyEndpoints.filter((e) => e.labels.some((l) => l.startsWith("cf-risk-bola"))).map((e) => e.operationId)
  ).size;
  const sensitiveOp    = apiRiskLabels.find((r) => r.label === "cf-risk-sensitive")?.operationCount ?? 0;
  const hasRiskData    = apiRiskLabels.length > 0 || apiZombieEndpoints.length > 0;

  // Sum across risk-label categories — NOT deduplicated (an operation can
  // carry more than one risk label, e.g. missing-auth AND sensitive), so
  // this is "flagged instances," not a distinct "at risk operations" count.
  // Cloudflare's dashboard shows a true deduplicated union via a separate
  // internal computation not exposed by any public API.
  const riskFlaggedInstancesTotal = apiRiskLabels.reduce((s, r) => s + r.operationCount, 0);

  // Top hostnames carrying API traffic — derived from already-fetched
  // apiTopPaths (host+path+requests), aggregated by host. This is traffic-
  // based (not the dashboard's distinct-hostname-per-operation count, which
  // isn't obtainable without paginating every saved operation), but gives
  // real, useful context on which hostnames the API surface actually spans.
  const hostnameTrafficMap = new Map<string, number>();
  for (const p of apiTopPaths) {
    if (!p.host) continue;
    hostnameTrafficMap.set(p.host, (hostnameTrafficMap.get(p.host) ?? 0) + p.requests);
  }
  const topHostnamesByTraffic = Array.from(hostnameTrafficMap.entries())
    .map(([host, requests]) => ({ host, requests }))
    .sort((a, b) => b.requests - a.requests)
    .slice(0, 8);

  if (!hasData) {
    return (
      <section className="report-section">
        <SectionHeader icon={<Code2 size={20} />} title="API Traffic & API Shield" subtitle="API request analytics and API Shield posture" />
        <div className="bg-white rounded-xl border border-cf-gray-200 p-8 text-center">
          <Code2 size={32} className="text-cf-gray-300 mx-auto mb-3" />
          <p className="text-cf-gray-500 text-sm font-medium">No API traffic detected</p>
          <p className="text-cf-gray-400 text-xs mt-1">API traffic is identified by JSON, XML, gRPC response content types.</p>
        </div>
      </section>
    );
  }

  return (
    <section className="report-section">
      <SectionHeader
        icon={<Code2 size={20} />}
        title="API Traffic & API Shield"
        subtitle="API request volume, error rates, top endpoints, and API Shield protection posture"
        printBreak
      />

      <div className="space-y-5">

        {/* ── KPI Row ──────────────────────────────────────────────────────── */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          {[
            { label: "API Requests",     value: formatNumber(totalApiRequests), sub: `${apiPct}% of total traffic`,  color: "#3B82F6" },
            { label: "API Bandwidth",    value: formatBytes(totalApiBytes),     sub: "Served to API clients",        color: "#F6821F" },
            { label: "Error Rate",       value: `${errorRate}%`,               sub: "4xx + 5xx responses",          color: parseFloat(errorRate) > 5 ? "#EF4444" : "#10B981" },
            { label: "Endpoints Found",  value: formatNumber(apiOperations.length), sub: apiSchemas.length > 0 ? `${apiSchemas.length} schema(s) uploaded` : "No schemas uploaded", color: "#8B5CF6" },
          ].map((kpi) => (
            <div key={kpi.label} className="bg-white rounded-xl shadow-sm border border-cf-gray-200 p-4">
              <p className="text-[10px] font-semibold text-cf-gray-500 uppercase tracking-wide mb-1">{kpi.label}</p>
              <p className="text-2xl font-black" style={{ color: kpi.color }}>{kpi.value}</p>
              <p className="text-[10px] text-cf-gray-400 mt-1">{kpi.sub}</p>
            </div>
          ))}
        </div>

        {/* ── API Traffic Time-Series + Method breakdown ────────────────────── */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 items-start">

          {/* Time-series — 2/3 width */}
          {apiTrafficSeries.length > 0 && (
            <div className="lg:col-span-2 bg-white rounded-xl shadow-sm border border-cf-gray-200 p-4">
              <h3 className="text-sm font-semibold text-cf-navy mb-3">API Request Volume</h3>
              <ResponsiveContainer width="100%" height={240}>
                <AreaChart data={apiTrafficSeries} margin={{ top: 4, right: 8, bottom: 0, left: 0 }}>
                  <defs>
                    <linearGradient id="apiGrad" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="#3B82F6" stopOpacity={0.25} />
                      <stop offset="95%" stopColor="#3B82F6" stopOpacity={0.02} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke="#F1F5F9" />
                  <XAxis dataKey="date" tick={{ fontSize: 10 }} tickFormatter={(v) => v.slice(5)} />
                  <YAxis tick={{ fontSize: 10 }} tickFormatter={(v) => v >= 1e3 ? `${(v/1e3).toFixed(0)}K` : String(v)} />
                  <Tooltip
                    formatter={(v: number) => [formatNumber(v), "API Requests"]}
                    labelStyle={{ fontSize: 11 }}
                    contentStyle={{ fontSize: 11, borderRadius: 8 }}
                  />
                  <Area type="monotone" dataKey="requests" stroke="#3B82F6" fill="url(#apiGrad)" strokeWidth={2} dot={false} />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          )}

          {/* Method breakdown — 1/3 width */}
          {apiMethods.length > 0 && (
            <div className="bg-white rounded-xl shadow-sm border border-cf-gray-200 p-4">
              <h3 className="text-sm font-semibold text-cf-navy mb-3">HTTP Methods</h3>
              <div className="space-y-2">
                {apiMethods.map((m) => {
                  const total = apiMethods.reduce((s, r) => s + r.requests, 0);
                  const pct   = total > 0 ? (m.requests / total) * 100 : 0;
                  const color = METHOD_COLORS[m.method] ?? "#6B7280";
                  return (
                    <div key={m.method}>
                      <div className="flex justify-between text-xs mb-0.5">
                        <span className="font-mono font-semibold" style={{ color }}>{m.method}</span>
                        <span className="text-cf-gray-500">{formatNumber(m.requests)} ({pct.toFixed(0)}%)</span>
                      </div>
                      <div className="h-1.5 bg-cf-gray-100 rounded-full overflow-hidden">
                        <div className="h-full rounded-full" style={{ width: `${pct}%`, backgroundColor: color }} />
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>

        {/* ── Status breakdown + Top paths ─────────────────────────────────── */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 items-start">

          {/* Status code category breakdown */}
          {statusBars.length > 0 && (
            <div className="bg-white rounded-xl shadow-sm border border-cf-gray-200 p-4">
              <h3 className="text-sm font-semibold text-cf-navy mb-3">Response Status Distribution</h3>
              <ResponsiveContainer width="100%" height={220}>
                <BarChart data={statusBars} margin={{ top: 4, right: 8, bottom: 0, left: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#F1F5F9" />
                  <XAxis dataKey="name" tick={{ fontSize: 11 }} />
                  <YAxis tick={{ fontSize: 10 }} tickFormatter={(v) => v >= 1e3 ? `${(v/1e3).toFixed(0)}K` : String(v)} />
                  <Tooltip
                    formatter={(v: number) => [formatNumber(v), "Requests"]}
                    contentStyle={{ fontSize: 11, borderRadius: 8 }}
                  />
                  <Bar dataKey="value" radius={[4, 4, 0, 0]}>
                    {statusBars.map((entry) => (
                      <Cell key={entry.name} fill={entry.color} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
              {/* Error callout */}
              {parseFloat(errorRate) > 5 && (
                <div className="mt-3 flex items-start gap-2 p-2.5 bg-red-50 border border-red-200 rounded-lg">
                  <AlertTriangle size={13} className="text-red-500 flex-shrink-0 mt-0.5" />
                  <p className="text-[11px] text-red-700 font-medium">
                    High API error rate ({errorRate}%) — investigate 4xx/5xx responses for schema violations or auth failures.
                  </p>
                </div>
              )}
            </div>
          )}

          {/* Top API paths */}
          {apiTopPaths.length > 0 && (
            <div className="bg-white rounded-xl shadow-sm border border-cf-gray-200 overflow-hidden">
              <div className="px-4 py-3 border-b border-cf-gray-100">
                <h3 className="text-sm font-semibold text-cf-navy">Top API Paths</h3>
                <p className="text-[10px] text-cf-gray-400 mt-0.5">By request volume · JSON/XML/gRPC responses</p>
              </div>
              <div className="overflow-y-auto" style={{ maxHeight: 280 }}>
                <table className="w-full text-xs">
                  <thead className="sticky top-0">
                    <tr className="bg-cf-gray-50 text-cf-gray-500 uppercase tracking-wide text-[10px]">
                      <th className="px-3 py-2 text-left font-semibold w-6">#</th>
                      <th className="px-3 py-2 text-left font-semibold">Hostname</th>
                      <th className="px-3 py-2 text-left font-semibold">Path</th>
                      <th className="px-3 py-2 text-right font-semibold">Requests</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-cf-gray-100">
                    {apiTopPaths.map((p, i) => (
                      <tr key={`${p.host}${p.path}`} className={i % 2 === 0 ? "bg-white" : "bg-cf-gray-50/40"}>
                        <td className="px-3 py-1.5 text-cf-gray-400 font-mono text-[11px]">{i + 1}</td>
                        <td className="px-3 py-1.5 font-mono text-cf-gray-500 text-[11px] max-w-[140px] truncate" title={p.host}>{p.host || "—"}</td>
                        <td className="px-3 py-1.5 font-mono text-cf-navy text-[11px] max-w-[220px] truncate" title={p.path}>{p.path}</td>
                        <td className="px-3 py-1.5 text-right font-mono font-bold text-blue-600 text-[11px]">{formatNumber(p.requests)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>

        {/* ── API Shield Posture ────────────────────────────────────────────── */}
        <div className="bg-white rounded-xl shadow-sm border border-cf-gray-200 overflow-hidden">
          <div className="px-5 py-4 border-b border-cf-gray-100 flex items-center gap-2">
            <Shield size={15} className="text-cf-orange" />
            <div>
              <h3 className="text-sm font-semibold text-cf-navy">API Shield Posture</h3>
              <p className="text-xs text-cf-gray-400 mt-0.5">Endpoint discovery, schema validation, and JWT configuration</p>
            </div>
          </div>

          <div className="p-5 space-y-5">
            {/* Posture pills */}
            <div className="flex flex-wrap gap-3">
              {[
                {
                  label: "Endpoint Discovery",
                  active: apiOperations.length > 0 || apiOperationsTotalCount > 0,
                  detail: apiOperationsTotalCount > 0
                    ? `${formatNumber(apiOperationsTotalCount)} operation(s) tracked${discoveryPendingReviewCount > 0 ? `, ${formatNumber(discoveryPendingReviewCount)} pending review` : ""}`
                    : apiOperations.length > 0 ? `${apiOperations.length} endpoints discovered` : "No endpoints found",
                },
                {
                  label: "Schema Validation",
                  active: apiSchemas.some((s) => s.validation_enabled),
                  detail: apiSchemas.length > 0 ? `${apiSchemas.filter(s => s.validation_enabled).length}/${apiSchemas.length} schemas active` : "No schemas uploaded",
                },
                {
                  label: "JWT Validation",
                  active: apiJwtConfigs.length > 0,
                  detail: apiJwtConfigs.length > 0 ? `${apiJwtConfigs.length} token config(s) present` : "Not configured",
                },
              ].map((item) => (
                <div key={item.label}
                  className="flex items-center gap-2 px-4 py-2.5 rounded-xl border text-sm"
                  style={{
                    borderColor: item.active ? "#10B98140" : "#E5E7EB",
                    backgroundColor: item.active ? "#F0FDF4" : "#F9FAFB",
                  }}
                >
                  {item.active
                    ? <CheckCircle2 size={15} className="text-green-500 flex-shrink-0" />
                    : <XCircle size={15} className="text-cf-gray-400 flex-shrink-0" />
                  }
                  <div>
                    <p className="font-semibold text-xs text-cf-navy">{item.label}</p>
                    <p className="text-[10px] text-cf-gray-500">{item.detail}</p>
                  </div>
                </div>
              ))}
            </div>

            {discoveryPendingReviewCount > 0 && (
              <div className="flex items-start gap-2 p-3 bg-amber-50 border border-amber-200 rounded-lg">
                <AlertTriangle size={13} className="text-amber-500 flex-shrink-0 mt-0.5" />
                <p className="text-[11px] text-amber-700">
                  <strong>{formatNumber(discoveryPendingReviewCount)} discovered operation(s) awaiting review</strong> — these
                  receive basic traffic matching but not risk scans, schema validation, or fallthrough protection until
                  saved into Endpoint Management (Security → Web Assets → Discovery).
                </p>
              </div>
            )}

            {/* Discovered operations table */}
            {apiOperations.length > 0 && (
              <div className="overflow-x-auto">
                <h4 className="text-xs font-semibold text-cf-gray-600 uppercase tracking-wide mb-2">Discovered API Operations</h4>
                <table className="w-full text-xs">
                  <thead>
                    <tr className="bg-cf-gray-50 text-cf-gray-500 uppercase tracking-wide text-[10px]">
                      <th className="px-3 py-2 text-left font-semibold">Method</th>
                      <th className="px-3 py-2 text-left font-semibold">Endpoint</th>
                      <th className="px-3 py-2 text-right font-semibold">Requests</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-cf-gray-100">
                    {apiOperations.map((op, i) => (
                      <tr key={op.operation_id} className={i % 2 === 0 ? "bg-white" : "bg-cf-gray-50/40"}>
                        <td className="px-3 py-1.5">
                          <span
                            className="inline-block px-1.5 py-0.5 rounded text-[10px] font-bold text-white"
                            style={{ backgroundColor: METHOD_COLORS[op.method] ?? "#6B7280" }}
                          >
                            {op.method}
                          </span>
                        </td>
                        <td className="px-3 py-1.5 font-mono text-cf-navy text-[11px] max-w-[340px] truncate" title={op.endpoint}>
                          {op.endpoint}
                        </td>
                        <td className="px-3 py-1.5 text-right font-mono text-[11px] text-cf-gray-600">
                          {op.features?.thresholds?.requests != null
                            ? formatNumber(op.features.thresholds.requests)
                            : "—"}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>

        {/* ── API Shield Findings — headline summary + full label breakdown ──── */}
        {(hasRiskData || apiUseCaseLabels.length > 0) && (
          <div className="bg-white rounded-xl shadow-sm border border-cf-gray-200 overflow-hidden">
            <div className="px-5 py-4 border-b border-cf-gray-100 flex items-center gap-2">
              <ShieldAlert size={15} className="text-cf-orange" />
              <div>
                <h3 className="text-sm font-semibold text-cf-navy">API Shield Findings</h3>
                <p className="text-xs text-cf-gray-400 mt-0.5">
                  Operations, hostnames, and every managed label Cloudflare has applied — Web Assets / Endpoint Labeling Service
                </p>
              </div>
            </div>

            <div className="p-5 space-y-5">
              {/* Headline numbers — mirrors the dashboard's "At risk / Operations / Hostnames" bar */}
              <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
                {[
                  { label: "Operations Tracked", value: apiOperationsTotalCount || apiOperations.length, sub: "Saved + discovered", color: "#3B82F6" },
                  { label: "Risk-Flagged Instances", value: riskFlaggedInstancesTotal, sub: `Across ${apiRiskLabels.length} risk categor${apiRiskLabels.length === 1 ? "y" : "ies"}`, color: riskFlaggedInstancesTotal > 0 ? "#DC2626" : "#10B981" },
                  { label: "Zombie Endpoints", value: zombieCount, sub: "No traffic in 32+ days", color: zombieCount > 0 ? "#6B7280" : "#10B981" },
                  { label: "Hostnames (by traffic)", value: topHostnamesByTraffic.length, sub: "Carrying API traffic this period", color: "#8B5CF6" },
                ].map((kpi) => (
                  <div key={kpi.label} className="rounded-xl border border-cf-gray-200 p-4">
                    <p className="text-[10px] font-semibold text-cf-gray-500 uppercase tracking-wide mb-1">{kpi.label}</p>
                    <p className="text-2xl font-black" style={{ color: kpi.color }}>{formatNumber(kpi.value)}</p>
                    <p className="text-[10px] text-cf-gray-400 mt-1">{kpi.sub}</p>
                  </div>
                ))}
              </div>

              {/* Full label chip row — EVERY label Cloudflare returned, use-case first then risk, by count desc */}
              {(apiUseCaseLabels.length > 0 || apiRiskLabels.length > 0) && (
                <div>
                  <p className="text-[10px] font-semibold text-cf-gray-500 uppercase tracking-wide mb-2">Labels</p>
                  <div className="flex flex-wrap gap-2">
                    {apiUseCaseLabels.map((l) => (
                      <span key={l.label}
                        className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border text-xs bg-white"
                        style={{ borderColor: `${USE_CASE_LABEL_META[l.label]?.color ?? "#6B7280"}40` }}
                        title={`${l.operationCount} operation(s)${l.requests > 0 ? `, ${formatNumber(l.requests)} requests this period` : ""}`}
                      >
                        <span className="w-1.5 h-1.5 rounded-full flex-shrink-0" style={{ backgroundColor: USE_CASE_LABEL_META[l.label]?.color ?? "#6B7280" }} />
                        <span className="font-mono text-cf-gray-500">{l.label}</span>
                        <span className="font-bold text-cf-navy">{formatNumber(l.operationCount)}</span>
                      </span>
                    ))}
                    {apiRiskLabels.map((l) => (
                      <span key={l.label}
                        className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border text-xs bg-red-50/40"
                        style={{ borderColor: `${RISK_LABEL_META[l.label]?.color ?? "#EF4444"}40` }}
                        title={`${l.operationCount} operation(s)${l.requests > 0 ? `, ${formatNumber(l.requests)} requests this period` : ""}`}
                      >
                        <span className="w-1.5 h-1.5 rounded-full flex-shrink-0" style={{ backgroundColor: RISK_LABEL_META[l.label]?.color ?? "#EF4444" }} />
                        <span className="font-mono text-cf-gray-500">{l.label}</span>
                        <span className="font-bold text-red-700">{formatNumber(l.operationCount)}</span>
                      </span>
                    ))}
                  </div>
                  {riskFlaggedInstancesTotal > 0 && (
                    <p className="text-[10px] text-cf-gray-400 mt-2">
                      Risk-label counts are not deduplicated — an operation can carry more than one risk label (e.g. missing-auth and sensitive-data together).
                    </p>
                  )}
                </div>
              )}

              {/* Top hostnames by API traffic */}
              {topHostnamesByTraffic.length > 0 && (
                <div>
                  <p className="text-[10px] font-semibold text-cf-gray-500 uppercase tracking-wide mb-2">Top Hostnames (by API Traffic)</p>
                  <div className="flex flex-wrap gap-2">
                    {topHostnamesByTraffic.map((h) => (
                      <span key={h.host} className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border border-cf-gray-200 text-xs bg-cf-gray-50">
                        <span className="font-mono text-cf-navy">{h.host}</span>
                        <span className="font-bold text-cf-gray-600">{formatNumber(h.requests)}</span>
                      </span>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </div>
        )}

        {/* ── Endpoint Risk Labels (Zombie / Auth / BOLA / Sensitive) ─────────── */}
        {hasRiskData && (
          <div className="bg-white rounded-xl shadow-sm border border-cf-gray-200 overflow-hidden">
            <div className="px-5 py-4 border-b border-cf-gray-100 flex items-center gap-2">
              <ShieldAlert size={15} className="text-red-500" />
              <div>
                <h3 className="text-sm font-semibold text-cf-navy">Endpoint Risk Detail</h3>
                <p className="text-xs text-cf-gray-400 mt-0.5">
                  Cloudflare's automated daily risk scans — API Shield Endpoint Labeling Service
                </p>
              </div>
            </div>

            <div className="p-5 space-y-5">
              {/* Risk KPI cards */}
              <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
                {[
                  { label: "Zombie APIs",        value: zombieCount,   sub: "No traffic in 32+ days",          color: zombieCount > 0 ? "#6B7280" : "#10B981", icon: <Ghost size={14} /> },
                  { label: "Missing/Mixed Auth",  value: missingAuthOp + mixedAuthOp, sub: "Broken authentication risk",   color: (missingAuthOp + mixedAuthOp) > 0 ? "#EF4444" : "#10B981", icon: <KeyRound size={14} /> },
                  { label: "BOLA Risk",           value: bolaOpCount,   sub: "Object-level auth risk",          color: bolaOpCount > 0 ? "#DC2626" : "#10B981", icon: <AlertTriangle size={14} /> },
                  { label: "Sensitive Data",       value: sensitiveOp,   sub: "Endpoints returning PII/financial", color: sensitiveOp > 0 ? "#EC4899" : "#10B981", icon: <Shield size={14} /> },
                ].map((kpi) => (
                  <div key={kpi.label} className="bg-cf-gray-50 rounded-xl border border-cf-gray-200 p-4">
                    <div className="flex items-center gap-1.5 mb-1" style={{ color: kpi.color }}>
                      {kpi.icon}
                      <p className="text-[10px] font-semibold uppercase tracking-wide">{kpi.label}</p>
                    </div>
                    <p className="text-2xl font-black" style={{ color: kpi.color }}>{formatNumber(kpi.value)}</p>
                    <p className="text-[10px] text-cf-gray-400 mt-1">{kpi.sub}</p>
                  </div>
                ))}
              </div>

              {bolaOpCount > 0 && (
                <div className="flex items-start gap-2 p-3 bg-red-50 border border-red-200 rounded-lg">
                  <AlertTriangle size={13} className="text-red-500 flex-shrink-0 mt-0.5" />
                  <p className="text-[11px] text-red-700">
                    <strong>BOLA vulnerabilities are as dangerous as an account takeover.</strong> Sessions requesting
                    abnormally many unique objects, or parameters duplicated in unexpected locations, were detected —
                    review these endpoints with your development team immediately.
                  </p>
                </div>
              )}

              {/* Zombie endpoints table */}
              {apiZombieEndpoints.length > 0 && (
                <div>
                  <div className="flex items-center gap-2 mb-2">
                    <Ghost size={13} className="text-cf-gray-400" />
                    <h4 className="text-xs font-semibold text-cf-gray-600 uppercase tracking-wide">
                      Zombie API Endpoints
                    </h4>
                    <span className="text-[10px] text-cf-gray-400">— sampled from least-trafficked saved operations</span>
                  </div>
                  <table className="w-full text-xs">
                    <thead>
                      <tr className="bg-cf-gray-50 text-cf-gray-500 uppercase tracking-wide text-[10px]">
                        <th className="px-3 py-2 text-left font-semibold">Method</th>
                        <th className="px-3 py-2 text-left font-semibold">Endpoint</th>
                        <th className="px-3 py-2 text-left font-semibold">Host</th>
                        <th className="px-3 py-2 text-right font-semibold">Last Seen</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-cf-gray-100">
                      {apiZombieEndpoints.slice(0, 15).map((e, i) => (
                        <tr key={e.operationId} className={i % 2 === 0 ? "bg-white" : "bg-cf-gray-50/40"}>
                          <td className="px-3 py-1.5">
                            <span className="inline-block px-1.5 py-0.5 rounded text-[10px] font-bold text-white"
                              style={{ backgroundColor: METHOD_COLORS[e.method] ?? "#6B7280" }}>
                              {e.method}
                            </span>
                          </td>
                          <td className="px-3 py-1.5 font-mono text-cf-navy text-[11px] max-w-[280px] truncate" title={e.endpoint}>{e.endpoint}</td>
                          <td className="px-3 py-1.5 font-mono text-cf-gray-500 text-[11px] max-w-[160px] truncate" title={e.host}>{e.host || "—"}</td>
                          <td className="px-3 py-1.5 text-right text-[11px] text-cf-gray-500">
                            {e.lastUpdated ? new Date(e.lastUpdated).toLocaleDateString() : "—"}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}

              {/* At-risk endpoints (all risk labels) */}
              {apiRiskyEndpoints.length > 0 && (
                <div>
                  <h4 className="text-xs font-semibold text-cf-gray-600 uppercase tracking-wide mb-2">At-Risk Endpoints</h4>
                  <table className="w-full text-xs">
                    <thead>
                      <tr className="bg-cf-gray-50 text-cf-gray-500 uppercase tracking-wide text-[10px]">
                        <th className="px-3 py-2 text-left font-semibold">Method</th>
                        <th className="px-3 py-2 text-left font-semibold">Endpoint</th>
                        <th className="px-3 py-2 text-left font-semibold">Risk Labels</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-cf-gray-100">
                      {apiRiskyEndpoints.slice(0, 15).map((e, i) => (
                        <tr key={e.operationId} className={i % 2 === 0 ? "bg-white" : "bg-cf-gray-50/40"}>
                          <td className="px-3 py-1.5">
                            {e.method && (
                              <span className="inline-block px-1.5 py-0.5 rounded text-[10px] font-bold text-white"
                                style={{ backgroundColor: METHOD_COLORS[e.method] ?? "#6B7280" }}>
                                {e.method}
                              </span>
                            )}
                          </td>
                          <td className="px-3 py-1.5 font-mono text-cf-navy text-[11px] max-w-[280px] truncate" title={e.endpoint}>{e.endpoint}</td>
                          <td className="px-3 py-1.5">
                            <div className="flex flex-wrap gap-1">
                              {e.labels.map((l) => (
                                <span key={l} className="px-1.5 py-0.5 rounded text-white text-[9px] font-semibold"
                                  style={{ backgroundColor: RISK_LABEL_META[l]?.color ?? "#6B7280" }}>
                                  {riskLabel(l)}
                                </span>
                              ))}
                            </div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </div>
        )}

        {/* ── Business-Function Traffic (Login / Sign-up / Purchase / etc.) ───── */}
        {apiUseCaseLabels.length > 0 && (
          <div className="bg-white rounded-xl shadow-sm border border-cf-gray-200 p-4">
            <div className="flex items-center gap-2 mb-3">
              <KeyRound size={14} className="text-cf-orange" />
              <h3 className="text-sm font-semibold text-cf-navy">Traffic by Business Function</h3>
            </div>
            <p className="text-[11px] text-cf-gray-400 mb-3">
              Endpoint labels identifying sensitive business flows (login, sign-up, purchase, payment, etc.) —
              API Shield Endpoint Labeling Service
            </p>
            <div className="space-y-2">
              {apiUseCaseLabels.map((l) => {
                const total = apiUseCaseLabels.reduce((s, r) => s + r.requests, 0);
                const pct   = total > 0 ? (l.requests / total) * 100 : 0;
                const meta  = USE_CASE_LABEL_META[l.label];
                const color = meta?.color ?? "#6B7280";
                return (
                  <div key={l.label}>
                    <div className="flex justify-between text-xs mb-0.5">
                      <span className="font-semibold" style={{ color }}>{useCaseLabel(l.label)}</span>
                      <span className="text-cf-gray-500">
                        {formatNumber(l.requests)} requests · {l.operationCount} endpoint{l.operationCount === 1 ? "" : "s"} ({pct.toFixed(0)}%)
                      </span>
                    </div>
                    <div className="h-1.5 bg-cf-gray-100 rounded-full overflow-hidden">
                      <div className="h-full rounded-full" style={{ width: `${pct}%`, backgroundColor: color }} />
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}

      </div>
    </section>
  );
}
