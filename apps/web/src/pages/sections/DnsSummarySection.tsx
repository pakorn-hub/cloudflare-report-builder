/**
 * DnsSummarySection - DNS Record Inventory + DNS Query Analytics
 * Shows: record type breakdown, proxied vs DNS-only, query volume time-series,
 *        query type breakdown with latency percentiles.
 */
import { Globe, Cloud, CloudOff, Activity } from "lucide-react";
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid,
  Tooltip, Legend, ResponsiveContainer, Bar, BarChart,
} from "recharts";
import { format, parseISO } from "date-fns";
import type { AppSecData } from "../../types";
import { formatNumber } from "../../utils/formatters";
import SectionHeader from "../../components/SectionHeader";
import PieBreakdownChart from "../../components/charts/PieBreakdownChart";
import DnsForceGraph from "../../components/charts/DnsForceGraph";

interface Props {
  data: AppSecData;
}

const TYPE_COLORS: Record<string, string> = {
  A: "#3B82F6",
  AAAA: "#8B5CF6",
  CNAME: "#10B981",
  MX: "#F59E0B",
  TXT: "#EF4444",
  NS: "#00B0D1",
  SRV: "#EC4899",
  CAA: "#6B7280",
  SOA: "#9CA3AF",
};

const RCODE_COLORS: Record<string, string> = {
  NOERROR: "#10B981",
  NXDOMAIN: "#F59E0B",
  SERVFAIL: "#EF4444",
  REFUSED: "#9CA3AF",
};

function usToMs(us: number): string {
  return us >= 1000 ? `${(us / 1000).toFixed(1)}ms` : `${us}us`;
}

export default function DnsSummarySection({ data }: Props) {
  const records = data.dnsRecordSummary;
  const queryTypes = data.dnsQueryTypeBreakdown ?? [];
  const timeSeries = data.dnsQueryTimeSeries ?? [];

  const hasRecords = records && records.totalRecords > 0;
  const hasAnalytics = queryTypes.length > 0 || timeSeries.length > 0;
  const hasData = hasRecords || hasAnalytics;

  // Aggregate query types (merge response codes)
  const queryTypeAgg = new Map<string, { count: number; p50: number; p95: number }>();
  for (const qt of queryTypes) {
    const existing = queryTypeAgg.get(qt.queryType);
    if (existing) {
      existing.count += qt.count;
    } else {
      queryTypeAgg.set(qt.queryType, { count: qt.count, p50: qt.p50Us, p95: qt.p95Us });
    }
  }
  const queryTypeRows = Array.from(queryTypeAgg.entries())
    .map(([type, v]) => ({ type, ...v }))
    .sort((a, b) => b.count - a.count);

  // Aggregate response codes
  const rcodeAgg = new Map<string, number>();
  for (const qt of queryTypes) {
    rcodeAgg.set(qt.responseCode, (rcodeAgg.get(qt.responseCode) ?? 0) + qt.count);
  }
  const rcodePieData = Array.from(rcodeAgg.entries())
    .map(([name, value]) => ({ name, value }))
    .sort((a, b) => b.value - a.value);

  // Record type pie
  const recordPieData = records?.byType?.map((t) => ({
    name: t.type,
    value: t.count,
  })) ?? [];

  // Time-series chart data
  const tsChartData = timeSeries.map((d) => ({
    date: format(parseISO(d.date), "MMM d"),
    queries: d.count,
    p50ms: +(d.p50Us / 1000).toFixed(2),
    p95ms: +(d.p95Us / 1000).toFixed(2),
  }));

  const totalQueries = timeSeries.reduce((s, d) => s + d.count, 0);
  const avgP50 = timeSeries.length > 0
    ? Math.round(timeSeries.reduce((s, d) => s + d.p50Us, 0) / timeSeries.length)
    : 0;
  const avgP95 = timeSeries.length > 0
    ? Math.round(timeSeries.reduce((s, d) => s + d.p95Us, 0) / timeSeries.length)
    : 0;

  // Top 10 DNS records for force graph — ranked by actual HTTP request volume.
  // Prefer topHttpHostnames (HTTP request counts — always available) over
  // dnsTopHostnames (DNS query counts — requires DNS Analytics access).
  // Falls back to type-priority order if neither is available.
  const enrichedRecords = data.dnsRecordsEnriched ?? [];
  const httpHostnames  = data.topHttpHostnames ?? [];
  const dnsHostnames   = data.dnsTopHostnames ?? [];
  const graphableTypes = new Set(["A","AAAA","CNAME","MX"]);
  const zoneName  = data.meta.zoneName;
  const periodDays = (data.meta as unknown as Record<string, number>)["days"] ?? 30;
  const normalise = (name: string) => name.replace(/\.$/, "").toLowerCase();

  // Build request-count lookup from HTTP data (primary) or DNS data (fallback)
  const queryCountMap = new Map<string, number>();
  if (httpHostnames.length > 0) {
    for (const h of httpHostnames) {
      const key = normalise(h.hostname);
      queryCountMap.set(key, (queryCountMap.get(key) ?? 0) + h.requests);
    }
  } else {
    for (const h of dnsHostnames) {
      const key = normalise(h.hostname);
      queryCountMap.set(key, (queryCountMap.get(key) ?? 0) + h.count);
    }
  }

  const top10Records = enrichedRecords
    .filter((r) => graphableTypes.has(r.type))
    .map((r) => ({
      ...r,
      _queryCount: queryCountMap.get(normalise(r.name)) ?? 0,
    }))
    .sort((a, b) => {
      // Primary: sort by actual query count (descending)
      if (b._queryCount !== a._queryCount) return b._queryCount - a._queryCount;
      // Secondary: apex records first when no query data
      const aIsApex = a.name === zoneName || a.name === `${zoneName}.`;
      const bIsApex = b.name === zoneName || b.name === `${zoneName}.`;
      if (aIsApex && !bIsApex) return -1;
      if (!aIsApex && bIsApex) return 1;
      // Tertiary: A/AAAA before CNAME/MX
      const TYPE_PRIORITY: Record<string, number> = { A: 0, AAAA: 1, CNAME: 2, MX: 3 };
      return (TYPE_PRIORITY[a.type] ?? 9) - (TYPE_PRIORITY[b.type] ?? 9);
    })
    .slice(0, 10);

  return (
    <section className="report-section">
      <SectionHeader
        icon={<Globe size={20} />}
        title="DNS Summary"
        subtitle="DNS record inventory, query analytics, and resolution performance"
        printBreak
      />

      {!hasData ? (
        <div className="bg-white rounded-xl border border-cf-gray-200 p-8 text-center">
          <p className="text-cf-gray-400 text-sm">No DNS data available for this zone.</p>
        </div>
      ) : (
        <div className="space-y-6">
          {/* KPI cards */}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
            {hasRecords && (
              <>
                <div className="bg-white rounded-xl shadow-sm border border-cf-gray-200 p-4">
                  <p className="text-xs text-cf-gray-500 mb-1">Total DNS Records</p>
                  <p className="text-2xl font-bold text-cf-navy">{records.totalRecords}</p>
                  <p className="text-xs text-cf-gray-400 mt-0.5">{records.byType.length} record types</p>
                </div>
                <div className="bg-white rounded-xl shadow-sm border border-cf-gray-200 p-4">
                  <div className="flex items-center gap-1.5 mb-1">
                    <Cloud size={12} className="text-cf-orange" />
                    <p className="text-xs text-cf-gray-500">Proxied</p>
                  </div>
                  <p className="text-2xl font-bold text-cf-orange">{records.proxiedCount}</p>
                  <p className="text-xs text-cf-gray-400 mt-0.5">
                    {records.totalRecords > 0
                      ? `${Math.round((records.proxiedCount / records.totalRecords) * 100)}% of records`
                      : ""}
                  </p>
                </div>
              </>
            )}
            {hasAnalytics && (
              <>
                <div className="bg-white rounded-xl shadow-sm border border-cf-gray-200 p-4">
                  <p className="text-xs text-cf-gray-500 mb-1">DNS Queries (30d)</p>
                  <p className="text-2xl font-bold text-cf-navy">{formatNumber(totalQueries)}</p>
                  <p className="text-xs text-cf-gray-400 mt-0.5">
                    {formatNumber(Math.round(totalQueries / periodDays))}/day avg
                  </p>
                </div>
                <div className="bg-white rounded-xl shadow-sm border border-cf-gray-200 p-4">
                  <div className="flex items-center gap-1.5 mb-1">
                    <Activity size={12} className="text-green-500" />
                    <p className="text-xs text-cf-gray-500">Avg Latency</p>
                  </div>
                  <p className="text-2xl font-bold text-green-600">{usToMs(avgP50)}</p>
                  <p className="text-xs text-cf-gray-400 mt-0.5">p50 median / p95: {usToMs(avgP95)}</p>
                </div>
              </>
            )}
          </div>

          {/* Record type pie + Proxy status */}
          {hasRecords && (
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
              <PieBreakdownChart
                data={recordPieData}
                title="DNS Record Type Distribution"
                subtitle="Number of records by type"
                colors={recordPieData.map((d) => TYPE_COLORS[d.name] ?? "#6B7280")}
                height={280}
                innerRadius={55}
              />
              <div className="bg-white rounded-xl shadow-sm border border-cf-gray-200 p-5">
                <h3 className="text-sm font-semibold text-cf-navy mb-4">Proxy Status</h3>
                <div className="space-y-3 mb-6">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <Cloud size={16} className="text-cf-orange" />
                      <span className="text-sm text-cf-gray-700">Proxied (Orange Cloud)</span>
                    </div>
                    <span className="text-sm font-bold text-cf-navy">{records.proxiedCount}</span>
                  </div>
                  <div className="w-full bg-cf-gray-100 rounded-full h-3 overflow-hidden">
                    <div
                      className="h-full bg-cf-orange rounded-full"
                      style={{ width: `${records.totalRecords > 0 ? (records.proxiedCount / records.totalRecords) * 100 : 0}%` }}
                    />
                  </div>
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <CloudOff size={16} className="text-cf-gray-400" />
                      <span className="text-sm text-cf-gray-700">DNS-Only (Grey Cloud)</span>
                    </div>
                    <span className="text-sm font-bold text-cf-navy">{records.dnsOnlyCount}</span>
                  </div>
                </div>

                {/* Record type table */}
                <h3 className="text-sm font-semibold text-cf-navy mb-2 mt-4 pt-4 border-t border-cf-gray-100">Records by Type</h3>
                <table className="w-full text-xs">
                  <tbody className="divide-y divide-cf-gray-100">
                    {records.byType.map((t) => (
                      <tr key={t.type}>
                        <td className="py-1.5 font-mono font-bold text-cf-navy">
                          <span className="inline-block w-2 h-2 rounded-full mr-2" style={{ backgroundColor: TYPE_COLORS[t.type] ?? "#6B7280" }} />
                          {t.type}
                        </td>
                        <td className="py-1.5 text-right font-mono text-cf-gray-600">{t.count}</td>
                        <td className="py-1.5 text-right text-cf-gray-400">
                          {records.totalRecords > 0 ? `${Math.round((t.count / records.totalRecords) * 100)}%` : ""}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* DNS Query Volume Time Series */}
          {tsChartData.length > 0 && (
            <div className="bg-white rounded-xl shadow-sm border border-cf-gray-200 p-5">
              <h3 className="text-sm font-semibold text-cf-navy mb-1">DNS Query Volume &amp; Latency ({data.meta?.periodLabel ?? "30-Day"})</h3>
              <p className="text-xs text-cf-gray-500 mb-4">
                Daily DNS query count with median (p50) and p95 resolution time
              </p>
              <ResponsiveContainer width="100%" height={260}>
                <LineChart data={tsChartData} margin={{ top: 5, right: 20, left: 0, bottom: 5 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#E5E7EB" />
                  <XAxis dataKey="date" tick={{ fontSize: 10, fill: "#6B7280" }} tickLine={false} axisLine={false} interval="preserveStartEnd" />
                  <YAxis yAxisId="left" tickFormatter={(v) => formatNumber(v)} tick={{ fontSize: 10, fill: "#6B7280" }} tickLine={false} axisLine={false} />
                  <YAxis yAxisId="right" orientation="right" tickFormatter={(v) => `${v}ms`} tick={{ fontSize: 10, fill: "#6B7280" }} tickLine={false} axisLine={false} />
                  <Tooltip />
                  <Legend iconType="circle" iconSize={8} wrapperStyle={{ fontSize: "11px" }} />
                  <Bar yAxisId="left" dataKey="queries" name="Queries" fill="#3B82F6" opacity={0.3} />
                  <Line yAxisId="right" type="monotone" dataKey="p50ms" name="p50 Latency" stroke="#10B981" strokeWidth={2} dot={false} />
                  <Line yAxisId="right" type="monotone" dataKey="p95ms" name="p95 Latency" stroke="#F59E0B" strokeWidth={2} dot={false} strokeDasharray="4 2" />
                </LineChart>
              </ResponsiveContainer>
            </div>
          )}

          {/* Query type breakdown + Response code pie */}
          {queryTypeRows.length > 0 && (
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
              {/* Query type table with latency */}
              <div className="bg-white rounded-xl shadow-sm border border-cf-gray-200 overflow-hidden">
                <div className="px-5 py-3 border-b border-cf-gray-100">
                  <h3 className="text-sm font-semibold text-cf-navy">DNS Query Type Performance</h3>
                  <p className="text-xs text-cf-gray-500 mt-0.5">Resolution latency by query type</p>
                </div>
                <table className="w-full text-xs">
                  <thead>
                    <tr className="bg-cf-gray-50 text-cf-gray-500 uppercase tracking-wide text-[10px]">
                      <th className="px-4 py-2 text-left font-semibold">Type</th>
                      <th className="px-4 py-2 text-right font-semibold">Queries</th>
                      <th className="px-4 py-2 text-right font-semibold">p50</th>
                      <th className="px-4 py-2 text-right font-semibold">p95</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-cf-gray-100">
                    {queryTypeRows.map((qt, i) => (
                      <tr key={qt.type} className={i % 2 === 0 ? "bg-white" : "bg-cf-gray-50/40"}>
                        <td className="px-4 py-2 font-mono font-bold text-cf-navy">{qt.type}</td>
                        <td className="px-4 py-2 text-right font-mono text-cf-gray-700">{formatNumber(qt.count)}</td>
                        <td className="px-4 py-2 text-right text-green-600 font-mono">{usToMs(qt.p50)}</td>
                        <td className="px-4 py-2 text-right text-yellow-600 font-mono">{usToMs(qt.p95)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {/* Response code pie */}
              {rcodePieData.length > 0 && (
                <PieBreakdownChart
                  data={rcodePieData}
                  title="DNS Response Codes"
                  subtitle="Distribution of RCODE responses"
                  colors={rcodePieData.map((d) => RCODE_COLORS[d.name] ?? "#6B7280")}
                  height={280}
                  innerRadius={55}
                />
              )}
            </div>
          )}
          {/* ── NXDOMAIN Hotspots ────────────────────────────────────── */}
          {(data.nxdomainHotspots ?? []).length > 0 && (
            <div className="bg-white rounded-xl shadow-sm border border-cf-gray-200 overflow-hidden">
              <div className="px-5 py-3 border-b border-cf-gray-100">
                <h3 className="text-sm font-semibold text-cf-navy">NXDOMAIN Hotspots</h3>
                <p className="text-xs text-cf-gray-500 mt-0.5">Top DNS names returning "Not Found" — potential misconfigurations or stale records</p>
              </div>
              <div className="overflow-y-auto" style={{ maxHeight: 220 }}>
                <table className="w-full text-xs">
                  <thead className="sticky top-0">
                    <tr className="bg-cf-gray-50 text-cf-gray-500 uppercase tracking-wide text-[10px]">
                      <th className="px-4 py-2 text-left font-semibold">#</th>
                      <th className="px-4 py-2 text-left font-semibold">Domain Name</th>
                      <th className="px-4 py-2 text-right font-semibold">NXDOMAIN Queries</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-cf-gray-100">
                    {(data.nxdomainHotspots ?? []).map((r, i) => (
                      <tr key={r.name} className={i % 2 === 0 ? "bg-white" : "bg-cf-gray-50/40"}>
                        <td className="px-4 py-1.5 text-cf-gray-400 font-mono text-[11px]">{i + 1}</td>
                        <td className="px-4 py-1.5 font-mono text-cf-navy text-[11px]">{r.name}</td>
                        <td className="px-4 py-1.5 text-right font-mono font-bold text-yellow-600 text-[11px]">{r.count.toLocaleString()}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
          {/* ── DNS Record Network Graph ──────────────────────────────── */}
          {top10Records.length > 0 && (
            <div>
              <div className="mb-3">
                <h3 className="text-sm font-semibold text-cf-navy">DNS Record Network</h3>
                <p className="text-xs text-cf-gray-500 mt-0.5">
                  Top 10 DNS records — zone root → record names → IP addresses → hosting providers (Cloudflare, AWS, Azure, Google, etc.).
                  <span className="text-cf-orange font-medium"> Orange ring</span> = proxied. Dashed = DNS-only.
                </p>
              </div>
              <DnsForceGraph
                records={top10Records}
                zoneName={zoneName}
                height={Math.min(480, Math.max(300, top10Records.length * 42 + 80))}
              />
            </div>
          )}
        </div>
      )}
    </section>
  );
}
