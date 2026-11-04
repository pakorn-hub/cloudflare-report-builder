import { Eye } from "lucide-react";
import {
  ResponsiveContainer, PieChart, Pie, Cell, Tooltip, Legend,
  BarChart, Bar, XAxis, YAxis, CartesianGrid,
} from "recharts";
import type { ZeroTrustData } from "../../types";
import { formatNumber } from "../../utils/formatters";
import SectionHeader from "../../components/SectionHeader";

const STATUS_COLORS: Record<string, string> = {
  approved: "#10B981", unapproved: "#EF4444", "in review": "#F59E0B", unreviewed: "#9CA3AF",
};
const STATUS_LABELS: Record<string, string> = {
  approved: "Approved", unapproved: "Unapproved", "in review": "In Review", unreviewed: "Unreviewed",
};

// High-risk category keywords (from cf-reporting)
const HIGH_RISK = new Set(["malware","phishing","command","control","security","threat","spyware","spam"]);
// "anonymizer" added — Cloudflare's own category taxonomy tags anonymizer/
// proxy-evasion domains under "Security threats", but this keyword was
// previously missing here, silently falling through to "low" risk despite
// being a real risk-relevant category.
const MED_RISK  = new Set(["file sharing","peer-to-peer","vpn","proxy","anonymizer","cryptocurrency","adult","gambling"]);

function riskLevel(category: string): "high" | "medium" | "low" {
  const c = category.toLowerCase();
  if ([...HIGH_RISK].some((k) => c.includes(k))) return "high";
  if ([...MED_RISK].some((k) => c.includes(k))) return "medium";
  return "low";
}

const RISK_COLORS = { high: "#EF4444", medium: "#F59E0B", low: "#10B981" };
const RISK_LABELS = { high: "High Risk", medium: "Medium Risk", low: "Low Risk" };

export default function ZTShadowItSection({ data }: { data: ZeroTrustData }) {
  const apps     = data.shadowItApps ?? [];
  const cats     = data.shadowItCategoryBreakdown ?? [];
  const users    = data.shadowItUserMappings ?? [];
  const s        = data.summary;

  // Graceful empty state
  if (apps.length === 0 && cats.length === 0) {
    return (
      <section className="report-section">
        <SectionHeader icon={<Eye size={20}/>} title="Gateway — Shadow IT Discovery"
          subtitle="SaaS applications discovered via DNS — sanctioned vs. unsanctioned app usage" />
        <div className="bg-white rounded-xl shadow-sm border border-cf-gray-200 p-8 text-center text-cf-gray-400 text-sm">
          No application discovery data available. Enable application categories in Gateway DNS policies
          to discover SaaS apps being accessed by users.
        </div>
      </section>
    );
  }

  const totalApps      = s.shadowItAppsDiscovered ?? apps.length;
  const highRiskApps   = apps.filter((a) => riskLevel(a.category) === "high").length;
  const totalRequests  = apps.reduce((s, a) => s + a.count, 0);
  const usersWithApps  = users.length;
  const appsWithStatus = apps.filter((a) => a.status);
  const statusCounts   = new Map<string, number>();
  for (const a of appsWithStatus) {
    const key = (a.status ?? "").toLowerCase();
    statusCounts.set(key, (statusCounts.get(key) ?? 0) + 1);
  }
  const statusBreakdown = Array.from(statusCounts.entries()).map(([status, count]) => ({ status, count }));

  // Risk-level breakdown (by DNS query volume) — replaces a raw "App Category
  // Breakdown" pie that was nearly meaningless in practice: Cloudflare's
  // categoryNames field here is a content-risk taxonomy (Malware, Anonymizer,
  // Artificial Intelligence, Spam, Security threats, ...), not a SaaS-app
  // taxonomy, so common high-volume business apps (Microsoft, Google, Bing)
  // are simply untagged and fall into "Uncategorized" — which dominated the
  // old pie at ~100% while every real category rounded to an unreadable
  // overlapping "0%". Bucketing every app into High/Medium/Low risk (the
  // same classification already used for the bar chart colors and table
  // badges below) gives a real, readable distribution instead.
  const riskBreakdown = (["high", "medium", "low"] as const)
    .map((risk) => ({
      risk,
      count: apps.filter((a) => riskLevel(a.category) === risk).reduce((sum, a) => sum + a.count, 0),
    }))
    .filter((r) => r.count > 0);

  const kpiCards = [
    { label: "Apps Discovered",   value: formatNumber(totalApps),     color: "#3B82F6" },
    { label: "High Risk Apps",    value: formatNumber(highRiskApps),  color: highRiskApps > 0 ? "#EF4444" : "#10B981" },
    { label: "DNS Queries",       value: formatNumber(totalRequests), color: "#F59E0B" },
    { label: "Users Detected",    value: formatNumber(usersWithApps), color: "#8B5CF6" },
  ];

  return (
    <section className="report-section">
      <SectionHeader icon={<Eye size={20}/>} title="Gateway — Shadow IT Discovery"
        subtitle="SaaS applications discovered via DNS — sanctioned vs. unsanctioned app usage" />

      {/* KPI cards */}
      <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-5 gap-4 mb-5">
        {kpiCards.map((k) => (
          <div key={k.label} className="bg-white rounded-xl shadow-sm border border-cf-gray-200 p-4">
            <p className="text-[10px] font-semibold text-cf-gray-500 uppercase tracking-wide mb-1">{k.label}</p>
            <p className="text-2xl font-black" style={{ color: k.color }}>{k.value}</p>
          </div>
        ))}
      </div>

      {/* Approval status breakdown — only shown if status data is available */}
      {statusBreakdown.length > 0 && (
        <div className="bg-white rounded-xl shadow-sm border border-cf-gray-200 p-4 mb-5">
          <h3 className="text-sm font-semibold text-cf-navy mb-3">Applications by Approval Status</h3>
          <div className="flex flex-wrap gap-3">
            {statusBreakdown.map((s) => (
              <div key={s.status} className="flex items-center gap-2 px-3 py-2 rounded-lg border border-cf-gray-200 bg-cf-gray-50">
                <div className="w-2 h-2 rounded-full" style={{ backgroundColor: STATUS_COLORS[s.status] ?? "#9CA3AF" }} />
                <span className="text-xs font-semibold text-cf-navy">{STATUS_LABELS[s.status] ?? s.status}</span>
                <span className="text-[10px] text-cf-gray-500 bg-cf-gray-200 px-1.5 py-0.5 rounded">{s.count}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5 items-start">
        {/* Risk-level breakdown pie (by DNS query volume) */}
        {riskBreakdown.length > 0 && (() => {
          const riskTotal = riskBreakdown.reduce((sum, r) => sum + r.count, 0);
          return (
            <div className="bg-white rounded-xl shadow-sm border border-cf-gray-200 p-4">
              <h3 className="text-sm font-semibold text-cf-navy mb-3">Risk Level Breakdown</h3>
              <ResponsiveContainer width="100%" height={220}>
                <PieChart>
                  <Pie data={riskBreakdown} cx="50%" cy="45%" innerRadius={55} outerRadius={85}
                    paddingAngle={2} dataKey="count" nameKey="risk" label={false} labelLine={false}>
                    {riskBreakdown.map((r) => <Cell key={r.risk} fill={RISK_COLORS[r.risk]}/>)}
                  </Pie>
                  <Tooltip contentStyle={{ fontSize: 11, borderRadius: 8 }} formatter={(v: number) => formatNumber(v)}/>
                  <Legend iconType="circle" iconSize={10} wrapperStyle={{ fontSize: 10 }}
                    formatter={(value: string) => {
                      const r = riskBreakdown.find((x) => x.risk === value);
                      const pct = r && riskTotal > 0 ? Math.round((r.count / riskTotal) * 100) : 0;
                      return `${RISK_LABELS[value as keyof typeof RISK_LABELS] ?? value} (${pct}%)`;
                    }} />
                </PieChart>
              </ResponsiveContainer>
            </div>
          );
        })()}

        {/* Top apps bar chart */}
        {apps.length > 0 && (
          <div className="bg-white rounded-xl shadow-sm border border-cf-gray-200 p-4">
            <h3 className="text-sm font-semibold text-cf-navy mb-3">Top Applications by Volume</h3>
            <ResponsiveContainer width="100%" height={220}>
              <BarChart data={apps.slice(0,8)} layout="vertical" margin={{ top: 4, right: 16, bottom: 0, left: 90 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#F1F5F9"/>
                <XAxis type="number" tick={{ fontSize: 10 }} tickFormatter={(v) => v >= 1e6 ? `${(v/1e6).toFixed(1)}M` : v >= 1e3 ? `${(v/1e3).toFixed(0)}K` : String(v)}/>
                <YAxis type="category" dataKey="name" tick={{ fontSize: 10 }} width={86}/>
                <Tooltip contentStyle={{ fontSize: 11, borderRadius: 8 }} formatter={(v: number) => formatNumber(v)}/>
                <Bar dataKey="count" radius={[0,4,4,0]}>
                  {apps.slice(0,8).map((app, i) => (
                    <Cell key={i} fill={RISK_COLORS[riskLevel(app.category)]}/>
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
            <p className="text-[9px] text-cf-gray-400 mt-1">
              <span className="inline-block w-2 h-2 rounded-full bg-red-500 mr-1"/>High risk
              <span className="inline-block w-2 h-2 rounded-full bg-yellow-500 mx-1 ml-2"/>Medium
              <span className="inline-block w-2 h-2 rounded-full bg-green-500 mx-1 ml-2"/>Low
            </p>
          </div>
        )}
      </div>

      {/* App inventory table */}
      {apps.length > 0 && (
        <div className="mt-5 bg-white rounded-xl shadow-sm border border-cf-gray-200 overflow-hidden">
          <div className="px-5 py-3 border-b border-cf-gray-100">
            <h3 className="text-sm font-semibold text-cf-navy">Discovered Application Inventory</h3>
          </div>
          <div className="overflow-y-auto" style={{ maxHeight: 280 }}>
            <table className="w-full text-xs">
              <thead className="sticky top-0">
                <tr className="bg-cf-gray-50 text-cf-gray-500 uppercase tracking-wide text-[10px]">
                  <th className="px-4 py-2 text-left font-semibold">#</th>
                  <th className="px-4 py-2 text-left font-semibold">Application</th>
                  <th className="px-4 py-2 text-left font-semibold">Category</th>
                  <th className="px-4 py-2 text-left font-semibold">Risk</th>
                  {appsWithStatus.length > 0 && <th className="px-4 py-2 text-left font-semibold">Status</th>}
                  <th className="px-4 py-2 text-right font-semibold">DNS Queries</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-cf-gray-100">
                {apps.map((app, i) => {
                  const risk = riskLevel(app.category);
                  const statusKey = (app.status ?? "").toLowerCase();
                  return (
                    <tr key={app.name} className={i % 2 === 0 ? "bg-white" : "bg-cf-gray-50/40"}>
                      <td className="px-4 py-1.5 text-cf-gray-400 font-mono text-[11px]">{i+1}</td>
                      <td className="px-4 py-1.5 font-semibold text-cf-navy text-[11px]">{app.name}</td>
                      <td className="px-4 py-1.5 text-[11px] text-cf-gray-500">{app.category}</td>
                      <td className="px-4 py-1.5 text-[11px]">
                        <span className="px-1.5 py-0.5 rounded text-white text-[10px] font-semibold"
                          style={{ backgroundColor: RISK_COLORS[risk] }}>
                          {RISK_LABELS[risk]}
                        </span>
                      </td>
                      {appsWithStatus.length > 0 && (
                        <td className="px-4 py-1.5 text-[11px]">
                          {app.status ? (
                            <span className="px-1.5 py-0.5 rounded text-white text-[10px] font-semibold"
                              style={{ backgroundColor: STATUS_COLORS[statusKey] ?? "#9CA3AF" }}>
                              {STATUS_LABELS[statusKey] ?? app.status}
                            </span>
                          ) : <span className="text-cf-gray-300">—</span>}
                        </td>
                      )}
                      <td className="px-4 py-1.5 text-right font-mono font-bold text-cf-navy text-[11px]">{formatNumber(app.count)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* User → app mapping table */}
      {users.length > 0 && (
        <div className="mt-5 bg-white rounded-xl shadow-sm border border-cf-gray-200 overflow-hidden">
          <div className="px-5 py-3 border-b border-cf-gray-100">
            <h3 className="text-sm font-semibold text-cf-navy">User Activity — App Mapping</h3>
          </div>
          <div className="overflow-y-auto" style={{ maxHeight: 240 }}>
            <table className="w-full text-xs">
              <thead className="sticky top-0">
                <tr className="bg-cf-gray-50 text-cf-gray-500 uppercase tracking-wide text-[10px]">
                  <th className="px-4 py-2 text-left font-semibold">User</th>
                  <th className="px-4 py-2 text-left font-semibold">Applications</th>
                  <th className="px-4 py-2 text-right font-semibold">Requests</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-cf-gray-100">
                {users.slice(0, 20).map((u, i) => (
                  <tr key={u.email} className={i % 2 === 0 ? "bg-white" : "bg-cf-gray-50/40"}>
                    <td className="px-4 py-1.5 font-mono text-cf-navy text-[11px]">{u.email}</td>
                    <td className="px-4 py-1.5 text-[11px] text-cf-gray-500">
                      {u.apps.length > 0 ? u.apps.slice(0, 3).join(", ") + (u.apps.length > 3 ? ` +${u.apps.length - 3}` : "") : "–"}
                    </td>
                    <td className="px-4 py-1.5 text-right font-mono text-cf-navy text-[11px]">{formatNumber(u.totalRequests)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </section>
  );
}
