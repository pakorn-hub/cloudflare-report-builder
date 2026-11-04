import { Globe } from "lucide-react";
import { ResponsiveContainer, AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, BarChart, Bar, Cell } from "recharts";
import type { ZeroTrustData } from "../../types";
import { formatNumber, formatBytes, formatRate } from "../../utils/formatters";
import SectionHeader from "../../components/SectionHeader";

const STATUS_BUCKET_COLORS: Record<string, string> = {
  "2xx": "#10B981", "3xx": "#3B82F6", "4xx": "#F59E0B", "5xx": "#EF4444", "No Status": "#9CA3AF",
};

export default function ZTGatewayHttpSection({ data }: { data: ZeroTrustData }) {
  const series    = data.gatewayHttpTimeSeries;
  const topDoms   = data.gatewayHttpTopBlockedDomains;
  const topAllowed = data.gatewayHttpTopAllowedDomains ?? [];
  const cats      = data.gatewayHttpTopBlockedCategories;
  const statusCodes = data.gatewayHttpStatusCodes ?? [];
  const topBlockedUsers = data.gatewayHttpTopBlockedUsers ?? [];
  const topBandwidthUsers = data.gatewayHttpTopBandwidthUsers ?? [];
  const topCountries = data.gatewayHttpTopCountries ?? [];
  const s         = data.summary;
  if (series.length === 0 && topDoms.length === 0) return null;

  const rbi         = s.httpRbiSessions ?? 0;
  const blocked     = s.gatewayHttpBlocked ?? 0;
  const quarantined = s.httpQuarantinedRequests ?? 0;
  const mcpRequests = s.gatewayMcpHttpRequests ?? 0;
  // Raw (unrounded) percentages for color-threshold logic only — the
  // displayed value uses formatRate() so a real but small rate (e.g.
  // 3.5K blocked of 171M inspected = 0.002%) never misleadingly shows as
  // "0%" the way Math.round() to an integer would.
  const rbiPct  = s.gatewayHttpRequests > 0 ? (rbi     / s.gatewayHttpRequests) * 100 : 0;
  const blkPct  = s.gatewayHttpRequests > 0 ? (blocked / s.gatewayHttpRequests) * 100 : 0;
  const COLORS  = ["#EF4444","#F59E0B","#8B5CF6","#3B82F6","#10B981","#F97316","#6B7280","#EC4899"];

  const kpis = [
    { label: "HTTP Inspected", value: formatNumber(s.gatewayHttpRequests), color: "#3B82F6" },
    { label: "HTTP Blocked",   value: formatNumber(blocked),               color: "#EF4444" },
    { label: "Block Rate",     value: formatRate(blocked, s.gatewayHttpRequests), color: blkPct > 5 ? "#EF4444" : "#10B981" },
    { label: "RBI Sessions",   value: formatNumber(rbi),                   color: "#F59E0B" },
    { label: "RBI Rate",       value: formatRate(rbi, s.gatewayHttpRequests),     color: rbiPct > 0 ? "#F59E0B" : "#10B981" },
    ...(quarantined > 0 ? [{ label: "Quarantined (DLP)", value: formatNumber(quarantined), color: "#EF4444" }] : []),
    ...(mcpRequests > 0 ? [{ label: "MCP Requests", value: formatNumber(mcpRequests), color: "#8B5CF6" }] : []),
    ...((s.gatewayHttpUniqueUsers ?? 0) > 0 ? [{ label: "Unique Users", value: formatNumber(s.gatewayHttpUniqueUsers!), color: "#10B981" }] : []),
    ...((s.gatewayHttpUniqueApps ?? 0) > 0 ? [{ label: "Unique Apps", value: formatNumber(s.gatewayHttpUniqueApps!), color: "#0EA5E9" }] : []),
    ...((s.gatewayHttpBandwidthBytes ?? 0) > 0 ? [{ label: "Bandwidth", value: formatBytes(s.gatewayHttpBandwidthBytes!), color: "#14B8A6" }] : []),
    ...((s.gatewayHttpDlpMatchesTotal ?? 0) > 0 ? [{ label: "DLP Matches", value: formatNumber(s.gatewayHttpDlpMatchesTotal!), color: "#EF4444" }] : []),
  ];

  // Dynamic column count so an unfilled 3rd/4th grid slot never leaves an
  // empty, stretched-looking gap when only 1-2 of the possible cards have data.
  const chartPanelCount = [series.length > 0, cats.length > 0, statusCodes.length > 0].filter(Boolean).length;
  const chartGridCols = chartPanelCount >= 3 ? "lg:grid-cols-3" : chartPanelCount === 2 ? "lg:grid-cols-2" : "grid-cols-1";

  return (
    <section className="report-section">
      <SectionHeader icon={<Globe size={20}/>} title="Gateway — HTTP Filtering"
        subtitle="Web traffic inspection — RBI sessions, blocked URLs, and policy hits" />
      <div className="grid grid-cols-1 sm:grid-cols-4 gap-4 mb-5">
        {kpis.map((k) => (
          <div key={k.label} className="bg-white rounded-xl shadow-sm border border-cf-gray-200 p-4">
            <p className="text-[10px] font-semibold text-cf-gray-500 uppercase tracking-wide mb-1">{k.label}</p>
            <p className="text-2xl font-black" style={{ color: k.color }}>{k.value}</p>
          </div>
        ))}
      </div>
      <div className={`grid gap-5 items-start ${chartGridCols}`}>
        {series.length > 0 && (
          <div className="bg-white rounded-xl shadow-sm border border-cf-gray-200 p-4">
            <h3 className="text-sm font-semibold text-cf-navy mb-3">HTTP Traffic Trend</h3>
            <ResponsiveContainer width="100%" height={220}>
              <AreaChart data={series} margin={{ top: 4, right: 8, bottom: 0, left: 0 }}>
                <defs>
                  <linearGradient id="httpT" x1="0" y1="0" x2="0" y2="1"><stop offset="5%" stopColor="#3B82F6" stopOpacity={0.2}/><stop offset="95%" stopColor="#3B82F6" stopOpacity={0}/></linearGradient>
                  <linearGradient id="httpB" x1="0" y1="0" x2="0" y2="1"><stop offset="5%" stopColor="#EF4444" stopOpacity={0.3}/><stop offset="95%" stopColor="#EF4444" stopOpacity={0}/></linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="#F1F5F9"/>
                <XAxis dataKey="date" tick={{ fontSize: 10 }} tickFormatter={(v) => v.slice(5)}/>
                <YAxis tick={{ fontSize: 10 }} tickFormatter={(v) => v >= 1e3 ? `${(v/1e3).toFixed(0)}K` : String(v)}/>
                <Tooltip contentStyle={{ fontSize: 11, borderRadius: 8 }} formatter={(v: number) => formatNumber(v)}/>
                <Area type="monotone" dataKey="total"   name="Inspected" stroke="#3B82F6" fill="url(#httpT)" strokeWidth={2} dot={false}/>
                <Area type="monotone" dataKey="blocked" name="Blocked (non-RBI)" stroke="#EF4444" fill="url(#httpB)" strokeWidth={2} dot={false}/>
              </AreaChart>
            </ResponsiveContainer>
          </div>
        )}
        {cats.length > 0 && (
          <div className="bg-white rounded-xl shadow-sm border border-cf-gray-200 p-4">
            <h3 className="text-sm font-semibold text-cf-navy mb-3">Top Blocked Web Categories</h3>
            <ResponsiveContainer width="100%" height={220}>
              <BarChart data={cats.slice(0,8)} layout="vertical" margin={{ top: 4, right: 16, bottom: 0, left: 100 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#F1F5F9"/>
                <XAxis type="number" tick={{ fontSize: 10 }} tickFormatter={(v) => v >= 1e3 ? `${(v/1e3).toFixed(0)}K` : String(v)}/>
                <YAxis type="category" dataKey="category" tick={{ fontSize: 10 }} width={96}/>
                <Tooltip contentStyle={{ fontSize: 11, borderRadius: 8 }} formatter={(v: number) => formatNumber(v)}/>
                <Bar dataKey="count" radius={[0,4,4,0]}>{cats.slice(0,8).map((_,i) => <Cell key={i} fill={COLORS[i%COLORS.length]}/>)}</Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        )}
        {statusCodes.length > 0 && (
          <div className="bg-white rounded-xl shadow-sm border border-cf-gray-200 p-4">
            <h3 className="text-sm font-semibold text-cf-navy mb-3">HTTP Status Code Distribution</h3>
            <ResponsiveContainer width="100%" height={220}>
              <BarChart data={statusCodes} layout="vertical" margin={{ top: 4, right: 16, bottom: 0, left: 70 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#F1F5F9"/>
                <XAxis type="number" tick={{ fontSize: 10 }} tickFormatter={(v) => v >= 1e3 ? `${(v/1e3).toFixed(0)}K` : String(v)}/>
                <YAxis type="category" dataKey="bucket" tick={{ fontSize: 10 }} width={62}/>
                <Tooltip contentStyle={{ fontSize: 11, borderRadius: 8 }} formatter={(v: number) => formatNumber(v)}/>
                <Bar dataKey="count" radius={[0,4,4,0]}>{statusCodes.map((b) => <Cell key={b.bucket} fill={STATUS_BUCKET_COLORS[b.bucket] ?? "#6B7280"}/>)}</Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        )}
      </div>
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5 mt-5 items-start">
        {topDoms.length > 0 && (
          <div className="bg-white rounded-xl shadow-sm border border-cf-gray-200 overflow-hidden">
            <div className="px-5 py-3 border-b border-cf-gray-100"><h3 className="text-sm font-semibold text-cf-navy">Top Blocked Domains</h3></div>
            <div className="overflow-y-auto" style={{ maxHeight: 240 }}>
              <table className="w-full text-xs">
                <thead className="sticky top-0">
                  <tr className="bg-cf-gray-50 text-cf-gray-500 uppercase tracking-wide text-[10px]">
                    <th className="px-4 py-2 text-left font-semibold">#</th>
                    <th className="px-4 py-2 text-left font-semibold">Domain</th>
                    <th className="px-4 py-2 text-right font-semibold">Blocked</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-cf-gray-100">
                  {topDoms.map((d, i) => (
                    <tr key={d.domain} className={i%2===0?"bg-white":"bg-cf-gray-50/40"}>
                      <td className="px-4 py-1.5 text-cf-gray-400 font-mono text-[11px]">{i+1}</td>
                      <td className="px-4 py-1.5 font-mono text-cf-navy text-[11px]">{d.domain}</td>
                      <td className="px-4 py-1.5 text-right font-mono font-bold text-red-600 text-[11px]">{formatNumber(d.count)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
        {topAllowed.length > 0 && (
          <div className="bg-white rounded-xl shadow-sm border border-cf-gray-200 overflow-hidden">
            <div className="px-5 py-3 border-b border-cf-gray-100"><h3 className="text-sm font-semibold text-cf-navy">Top Allowed Domains</h3></div>
            <div className="overflow-y-auto" style={{ maxHeight: 240 }}>
              <table className="w-full text-xs">
                <thead className="sticky top-0">
                  <tr className="bg-cf-gray-50 text-cf-gray-500 uppercase tracking-wide text-[10px]">
                    <th className="px-4 py-2 text-left font-semibold">#</th>
                    <th className="px-4 py-2 text-left font-semibold">Domain</th>
                    <th className="px-4 py-2 text-right font-semibold">Allowed</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-cf-gray-100">
                  {topAllowed.map((d, i) => (
                    <tr key={d.domain} className={i%2===0?"bg-white":"bg-cf-gray-50/40"}>
                      <td className="px-4 py-1.5 text-cf-gray-400 font-mono text-[11px]">{i+1}</td>
                      <td className="px-4 py-1.5 font-mono text-cf-navy text-[11px]">{d.domain}</td>
                      <td className="px-4 py-1.5 text-right font-mono font-bold text-green-600 text-[11px]">{formatNumber(d.count)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
        {topBlockedUsers.length > 0 && (
          <div className="bg-white rounded-xl shadow-sm border border-cf-gray-200 overflow-hidden">
            <div className="px-5 py-3 border-b border-cf-gray-100">
              <h3 className="text-sm font-semibold text-cf-navy">Users With the Most Blocked HTTP Requests</h3>
            </div>
            <div className="overflow-y-auto" style={{ maxHeight: 240 }}>
              <table className="w-full text-xs">
                <thead className="sticky top-0">
                  <tr className="bg-cf-gray-50 text-cf-gray-500 uppercase tracking-wide text-[10px]">
                    <th className="px-4 py-2 text-left font-semibold">#</th>
                    <th className="px-4 py-2 text-left font-semibold">User</th>
                    <th className="px-4 py-2 text-right font-semibold">Blocked</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-cf-gray-100">
                  {topBlockedUsers.map((u, i) => (
                    <tr key={u.email} className={i%2===0?"bg-white":"bg-cf-gray-50/40"}>
                      <td className="px-4 py-1.5 text-cf-gray-400 font-mono text-[11px]">{i+1}</td>
                      <td className="px-4 py-1.5 font-mono text-cf-navy text-[11px] truncate max-w-[220px]">{u.email}</td>
                      <td className="px-4 py-1.5 text-right font-mono font-bold text-red-600 text-[11px]">{formatNumber(u.count)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>

      {/* Real top bandwidth consumers and top request countries — REST
          analytics API (no equivalent existed anywhere in this codebase
          before; complements the blocked-request view above with a usage/
          adoption view). */}
      {(topBandwidthUsers.length > 0 || topCountries.length > 0) && (
        <div className="mt-5 grid grid-cols-1 lg:grid-cols-2 gap-5 items-start">
          {topBandwidthUsers.length > 0 && (
            <div className="bg-white rounded-xl shadow-sm border border-cf-gray-200 p-4">
              <h3 className="text-sm font-semibold text-cf-navy mb-3">Top Users by Bandwidth</h3>
              <div className="space-y-1.5">
                {topBandwidthUsers.slice(0, 8).map((u) => (
                  <div key={u.email} className="flex items-center justify-between text-xs">
                    <span className="text-cf-gray-600 truncate font-mono pr-2">{u.email}</span>
                    <span className="font-mono font-semibold text-cf-navy flex-shrink-0">{formatBytes(u.bandwidthConsumedBytes)}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
          {topCountries.length > 0 && (
            <div className="bg-white rounded-xl shadow-sm border border-cf-gray-200 p-4">
              <h3 className="text-sm font-semibold text-cf-navy mb-3">Top Countries by Requests</h3>
              <ResponsiveContainer width="100%" height={180}>
                <BarChart data={topCountries.slice(0,8)} layout="vertical" margin={{ top: 4, right: 16, bottom: 0, left: 30 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#F1F5F9"/>
                  <XAxis type="number" tick={{ fontSize: 10 }} tickFormatter={(v) => v >= 1e6 ? `${(v/1e6).toFixed(1)}M` : v >= 1e3 ? `${(v/1e3).toFixed(0)}K` : String(v)}/>
                  <YAxis type="category" dataKey="country" tick={{ fontSize: 10 }} width={26}/>
                  <Tooltip contentStyle={{ fontSize: 11, borderRadius: 8 }} formatter={(v: number) => formatNumber(v)}/>
                  <Bar dataKey="requestsTotal" radius={[0,4,4,0]}>{topCountries.slice(0,8).map((_, i) => <Cell key={i} fill={COLORS[i % COLORS.length]}/>)}</Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
          )}
        </div>
      )}
    </section>
  );
}
