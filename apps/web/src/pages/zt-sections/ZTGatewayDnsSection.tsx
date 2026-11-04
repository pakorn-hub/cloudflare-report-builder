import { Shield, AlertTriangle } from "lucide-react";
import {
  ResponsiveContainer, AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip,
  BarChart, Bar, Cell, PieChart, Pie, Legend,
} from "recharts";
import type { ZeroTrustData } from "../../types";
import { formatNumber } from "../../utils/formatters";
import SectionHeader from "../../components/SectionHeader";

const COLORS = ["#EF4444","#F97316","#F59E0B","#8B5CF6","#3B82F6","#10B981","#6B7280","#EC4899","#14B8A6","#84CC16"];

function fmtBig(n: number): string {
  if (n >= 1_000_000_000) return `${(n / 1_000_000_000).toFixed(2)}B`;
  if (n >= 1_000_000)     return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000)         return `${(n / 1_000).toFixed(0)}K`;
  return formatNumber(n);
}

// Threat severity map — which categories are most dangerous
const THREAT_SEVERITY: Record<string, { label: string; color: string }> = {
  "Malware":            { label: "Critical", color: "#DC2626" },
  "Command & Control":  { label: "Critical", color: "#DC2626" },
  "Spyware":            { label: "Critical", color: "#DC2626" },
  "Phishing":           { label: "High",     color: "#EF4444" },
  "Compromised Servers":{ label: "High",     color: "#EF4444" },
  "New Domains":        { label: "Medium",   color: "#F59E0B" },
  "Newly Observed":     { label: "Medium",   color: "#F59E0B" },
  "DNS-over-HTTPS":     { label: "Medium",   color: "#F59E0B" },
  "Peer-to-Peer":       { label: "Low",      color: "#10B981" },
  "Ads & Trackers":     { label: "Low",      color: "#10B981" },
};

export default function ZTGatewayDnsSection({ data }: { data: ZeroTrustData }) {
  const series    = data.gatewayDnsTimeSeries;
  const breakdown = data.gatewayDnsResolverBreakdown ?? [];
  const topDoms   = data.gatewayDnsTopBlockedDomains;
  const topAllowed = data.gatewayDnsTopAllowedDomains ?? [];
  const cats      = data.gatewayDnsTopBlockedCategories;
  const s         = data.summary;

  if (series.length === 0 && topDoms.length === 0 && breakdown.length === 0) return null;

  const dnsBlocked  = s.gatewayDnsBlocked ?? 0;
  const dnsTotal    = s.gatewayDnsQueries ?? 0;
  const dnsFiltPct  = dnsTotal > 0 ? ((dnsBlocked / dnsTotal) * 100).toFixed(2) : "0";
  const dnsFiltPct0 = dnsTotal > 0 ? Math.round((dnsBlocked / dnsTotal) * 100) : 0;

  // Top threat category (for impact statement)
  const topThreat = cats[0]?.category ?? "";
  const criticalCats = cats.filter((c) => ["Malware","Command & Control","Spyware","Phishing"].includes(c.category));
  const criticalTotal = criticalCats.reduce((s, c) => s + c.count, 0);

  // Collapse resolver breakdown into Allowed / Blocked / Other for the pie
  const pieData = (() => {
    let allowed = 0, blocked = 0, other = 0;
    for (const r of breakdown) {
      const d = r.decision.toLowerCase();
      if (d.includes("blocked") || d.includes("block")) blocked += r.count;
      else if (d.includes("allowed") || d.includes("allow")) allowed += r.count;
      else other += r.count;
    }
    const result = [];
    if (allowed > 0) result.push({ name: "Allowed", value: allowed });
    if (blocked > 0) result.push({ name: "Blocked", value: blocked });
    if (other   > 0) result.push({ name: "Other",   value: other   });
    return result;
  })();

  const PIE_COLORS: Record<string, string> = {
    Allowed: "#10B981", Blocked: "#EF4444", Other: "#6B7280",
  };

  return (
    <section className="report-section">
      <SectionHeader icon={<Shield size={20}/>} title="Gateway — DNS Security"
        subtitle="Malicious domains blocked at the DNS layer — before any connection is established" />

      {/* Threat impact banner */}
      {dnsBlocked > 0 && (
        <div className="bg-gradient-to-r from-red-600 to-orange-600 rounded-2xl p-5 mb-5 text-white">
          <div className="flex items-start justify-between gap-4">
            <div>
              <p className="text-[10px] font-bold uppercase tracking-widest text-red-200 mb-1">Threats Blocked This Period</p>
              <p className="text-5xl font-black leading-none">{fmtBig(dnsBlocked)}</p>
              <p className="text-red-200 text-sm mt-1">{dnsFiltPct}% of {fmtBig(dnsTotal)} DNS queries were flagged as malicious</p>
            </div>
            <div className="flex flex-col gap-2 text-right">
              <div className="bg-white/15 rounded-xl px-4 py-2">
                <p className="text-[10px] text-red-200 font-semibold uppercase mb-0.5">Block Rate</p>
                <p className="text-2xl font-black">{dnsFiltPct}%</p>
              </div>
              {criticalTotal > 0 && (
                <div className="bg-white/15 rounded-xl px-4 py-2">
                  <p className="text-[10px] text-red-200 font-semibold uppercase mb-0.5">Critical Threats</p>
                  <p className="text-2xl font-black">{fmtBig(criticalTotal)}</p>
                </div>
              )}
            </div>
          </div>
          {topThreat && (
            <div className="mt-3 flex items-center gap-2 bg-white/10 rounded-lg px-3 py-2">
              <AlertTriangle size={13} className="text-red-200 flex-shrink-0"/>
              <p className="text-[11px] text-red-100">
                Top threat category: <strong className="text-white">{topThreat}</strong>
                {criticalTotal > 0 && ` · ${fmtBig(criticalTotal)} malware/C&C/phishing queries stopped`}
              </p>
            </div>
          )}
        </div>
      )}

      {/* KPI cards */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 mb-5">
        {[
          { label: "Total DNS Queries", value: fmtBig(dnsTotal),                  color: "#3B82F6" },
          { label: "DNS Blocked",       value: fmtBig(dnsBlocked),                color: "#EF4444" },
          { label: "Block Rate",        value: `${dnsFiltPct}%`,                   color: dnsFiltPct0 > 0 ? "#EF4444" : "#6B7280" },
          { label: "Threat Categories", value: String(cats.length > 0 ? cats.length : "–"), color: "#8B5CF6" },
        ].map((k) => (
          <div key={k.label} className="bg-white rounded-xl shadow-sm border border-cf-gray-200 p-4">
            <p className="text-[10px] font-semibold text-cf-gray-500 uppercase tracking-wide mb-1">{k.label}</p>
            <p className="text-2xl font-black" style={{ color: k.color }}>{k.value}</p>
          </div>
        ))}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5 items-start">
        {/* Time-series */}
        {series.length > 0 && (
          <div className="bg-white rounded-xl shadow-sm border border-cf-gray-200 p-4">
            <h3 className="text-sm font-semibold text-cf-navy mb-3">DNS Query Volume</h3>
            <ResponsiveContainer width="100%" height={220}>
              <AreaChart data={series} margin={{ top: 4, right: 8, bottom: 0, left: 0 }}>
                <defs>
                  <linearGradient id="dnsTotal" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#3B82F6" stopOpacity={0.2}/><stop offset="95%" stopColor="#3B82F6" stopOpacity={0}/>
                  </linearGradient>
                  <linearGradient id="dnsBlock" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#EF4444" stopOpacity={0.3}/><stop offset="95%" stopColor="#EF4444" stopOpacity={0}/>
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="#F1F5F9"/>
                <XAxis dataKey="date" tick={{ fontSize: 10 }} tickFormatter={(v) => v.slice(5)}/>
                <YAxis tick={{ fontSize: 10 }} tickFormatter={(v) => v >= 1e6 ? `${(v/1e6).toFixed(1)}M` : v >= 1e3 ? `${(v/1e3).toFixed(0)}K` : String(v)}/>
                <Tooltip contentStyle={{ fontSize: 11, borderRadius: 8 }} formatter={(v: number) => formatNumber(v)}/>
                <Area type="monotone" dataKey="total"   name="Total"   stroke="#3B82F6" fill="url(#dnsTotal)" strokeWidth={2} dot={false}/>
                <Area type="monotone" dataKey="blocked" name="Blocked" stroke="#EF4444" fill="url(#dnsBlock)" strokeWidth={2} dot={false}/>
              </AreaChart>
            </ResponsiveContainer>
          </div>
        )}

        {/* Resolver Decision breakdown pie */}
        {pieData.length > 0 && (
          <div className="bg-white rounded-xl shadow-sm border border-cf-gray-200 p-4">
            <h3 className="text-sm font-semibold text-cf-navy mb-3">Resolver Decision Breakdown</h3>
            <ResponsiveContainer width="100%" height={220}>
              <PieChart>
                <Pie
                  data={pieData}
                  cx="50%"
                  cy="45%"
                  innerRadius={60}
                  outerRadius={90}
                  paddingAngle={2}
                  dataKey="value"
                  label={({ name, percent }) => `${name} ${(percent * 100).toFixed(0)}%`}
                  labelLine={false}
                >
                  {pieData.map((entry) => (
                    <Cell key={entry.name} fill={PIE_COLORS[entry.name] ?? "#6B7280"} />
                  ))}
                </Pie>
                <Tooltip contentStyle={{ fontSize: 11, borderRadius: 8 }} formatter={(v: number) => formatNumber(v)}/>
                <Legend iconType="circle" iconSize={10} wrapperStyle={{ fontSize: 11 }}/>
              </PieChart>
            </ResponsiveContainer>
          </div>
        )}

        {/* Top blocked categories */}
        {cats.length > 0 && (
          <div className="bg-white rounded-xl shadow-sm border border-cf-gray-200 p-4">
            <h3 className="text-sm font-semibold text-cf-navy mb-3">Top Blocked Categories</h3>
            <ResponsiveContainer width="100%" height={220}>
              <BarChart data={cats.slice(0,8)} layout="vertical" margin={{ top: 4, right: 16, bottom: 0, left: 100 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#F1F5F9"/>
                <XAxis type="number" tick={{ fontSize: 10 }} tickFormatter={(v) => v >= 1e6 ? `${(v/1e6).toFixed(1)}M` : v >= 1e3 ? `${(v/1e3).toFixed(0)}K` : String(v)}/>
                <YAxis type="category" dataKey="category" tick={{ fontSize: 10 }} width={96}/>
                <Tooltip contentStyle={{ fontSize: 11, borderRadius: 8 }} formatter={(v: number) => formatNumber(v)}/>
                <Bar dataKey="count" radius={[0,4,4,0]}>
                  {cats.slice(0,8).map((_, i) => <Cell key={i} fill={COLORS[i % COLORS.length]}/>)}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        )}
      </div>

      {/* Top blocked domains table — now with policyName + locationName */}
      {topDoms.length > 0 && (
        <div className="mt-5 bg-white rounded-xl shadow-sm border border-cf-gray-200 overflow-hidden">
          <div className="px-5 py-3 border-b border-cf-gray-100">
            <h3 className="text-sm font-semibold text-cf-navy">Top Blocked Domains</h3>
          </div>
          <div className="overflow-y-auto" style={{ maxHeight: 300 }}>
            <table className="w-full text-xs">
              <thead className="sticky top-0">
                <tr className="bg-cf-gray-50 text-cf-gray-500 uppercase tracking-wide text-[10px]">
                  <th className="px-4 py-2 text-left font-semibold">#</th>
                  <th className="px-4 py-2 text-left font-semibold">Domain</th>
                  <th className="px-4 py-2 text-left font-semibold">Category</th>
                  <th className="px-4 py-2 text-left font-semibold">Severity</th>
                  <th className="px-4 py-2 text-left font-semibold">Policy</th>
                  <th className="px-4 py-2 text-right font-semibold">Blocked</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-cf-gray-100">
                {topDoms.map((d, i) => {
                  const sev = THREAT_SEVERITY[d.category] ?? { label: "Low", color: "#6B7280" };
                  return (
                  <tr key={d.domain} className={i % 2 === 0 ? "bg-white" : "bg-cf-gray-50/40"}>
                    <td className="px-4 py-1.5 text-cf-gray-400 font-mono text-[11px]">{i+1}</td>
                    <td className="px-4 py-1.5 font-mono text-cf-navy text-[11px]">{d.domain}</td>
                    <td className="px-4 py-1.5 text-[11px] text-cf-gray-500">{d.category || "–"}</td>
                    <td className="px-4 py-1.5 text-[11px]">
                      <span className="px-1.5 py-0.5 rounded text-white text-[10px] font-semibold"
                        style={{ backgroundColor: sev.color }}>{sev.label}</span>
                    </td>
                    <td className="px-4 py-1.5 text-[11px] text-cf-gray-500">{d.policyName || "–"}</td>
                    <td className="px-4 py-1.5 text-right font-mono font-bold text-red-600 text-[11px]">{fmtBig(d.count)}</td>
                  </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Top allowed domains table */}
      {topAllowed.length > 0 && (
        <div className="mt-5 bg-white rounded-xl shadow-sm border border-cf-gray-200 overflow-hidden">
          <div className="px-5 py-3 border-b border-cf-gray-100">
            <h3 className="text-sm font-semibold text-cf-navy">Top Allowed Domains</h3>
          </div>
          <div className="overflow-y-auto" style={{ maxHeight: 260 }}>
            <table className="w-full text-xs">
              <thead className="sticky top-0">
                <tr className="bg-cf-gray-50 text-cf-gray-500 uppercase tracking-wide text-[10px]">
                  <th className="px-4 py-2 text-left font-semibold">#</th>
                  <th className="px-4 py-2 text-left font-semibold">Domain</th>
                  <th className="px-4 py-2 text-left font-semibold">Category</th>
                  <th className="px-4 py-2 text-left font-semibold">Policy</th>
                  <th className="px-4 py-2 text-right font-semibold">Allowed</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-cf-gray-100">
                {topAllowed.map((d, i) => (
                  <tr key={d.domain} className={i % 2 === 0 ? "bg-white" : "bg-cf-gray-50/40"}>
                    <td className="px-4 py-1.5 text-cf-gray-400 font-mono text-[11px]">{i+1}</td>
                    <td className="px-4 py-1.5 font-mono text-cf-navy text-[11px]">{d.domain}</td>
                    <td className="px-4 py-1.5 text-[11px] text-cf-gray-500">{d.category || "–"}</td>
                    <td className="px-4 py-1.5 text-[11px] text-cf-gray-500">{d.policyName || "–"}</td>
                    <td className="px-4 py-1.5 text-right font-mono font-bold text-green-600 text-[11px]">{fmtBig(d.count)}</td>
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
