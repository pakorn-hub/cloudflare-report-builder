/**
 * ZTPocValueSection — POC Value Story
 *
 * The "hero" section placed immediately after the overview.
 * Shows:
 *   - What Cloudflare protected during the POC (headline metrics + impact framing)
 *   - Feature coverage matrix (what's live vs. what's available)
 *   - Deployment phase readiness (Phase 1 done → Phase 2 roadmap)
 */
import { Shield, CheckCircle2, Circle, Lock, Globe, Wifi, Network, Layers, Eye, FileText } from "lucide-react";
import {
  ResponsiveContainer, AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip,
} from "recharts";
import type { ZeroTrustData } from "../../types";
import { formatNumber } from "../../utils/formatters";
import SectionHeader from "../../components/SectionHeader";

// Estimated "infections prevented" multiplier — industry benchmark:
// ~1 in 200 malware DNS queries leads to an actual infection if not blocked
const INFECTIONS_PER_BLOCKED = 1 / 200;

function fmtBig(n: number): string {
  if (n >= 1_000_000_000) return `${(n / 1_000_000_000).toFixed(2)}B`;
  if (n >= 1_000_000)     return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000)         return `${(n / 1_000).toFixed(1)}K`;
  return String(n);
}

interface FeatureStatus {
  name: string;
  capability: string;
  deployed: boolean;
  dataPresent: boolean;
  icon: React.ReactNode;
  impact: string;
}

export default function ZTPocValueSection({ data }: { data: ZeroTrustData }) {
  const s = data.summary;
  const dnsSeries   = data.gatewayDnsTimeSeries ?? [];
  const policies    = data.gatewayPolicies ?? [];
  const accessApps  = data.accessApps ?? [];

  const dnsBlocked  = s.gatewayDnsBlocked ?? 0;
  const dnsTotal    = s.gatewayDnsQueries ?? 0;
  const dnsBlkPct   = dnsTotal > 0 ? ((dnsBlocked / dnsTotal) * 100).toFixed(2) : "0";
  const infectionsEst = Math.round(dnsBlocked * INFECTIONS_PER_BLOCKED);
  const httpPolicies  = policies.filter((p) => p.ruleType === "http").length;
  const dnsPolicies   = policies.filter((p) => p.ruleType === "dns").length;

  // Feature coverage matrix — what's deployed vs available
  const features: FeatureStatus[] = [
    {
      name: "DNS Security",
      capability: "Gateway DNS Filtering",
      deployed: dnsPolicies > 0,
      dataPresent: dnsBlocked > 0,
      icon: <Globe size={16}/>,
      impact: `${fmtBig(dnsBlocked)} threats blocked`,
    },
    {
      name: "Identity & Access",
      capability: "Zero Trust Access (ZTNA)",
      deployed: accessApps.length > 0,
      dataPresent: s.totalAuthEvents > 0,
      icon: <Lock size={16}/>,
      impact: `${accessApps.length} apps, ${s.uniqueUsers} users`,
    },
    {
      name: "HTTP Inspection",
      capability: "Secure Web Gateway (SWG)",
      deployed: httpPolicies > 0,
      dataPresent: (s.gatewayHttpRequests ?? 0) > 0,
      icon: <Layers size={16}/>,
      impact: httpPolicies > 0 ? `${formatNumber(s.gatewayHttpRequests ?? 0)} requests inspected` : "Enable to inspect HTTP traffic",
    },
    {
      name: "Device Security",
      capability: "WARP Client + Posture",
      deployed: s.warpEnrolledDevices > 0,
      dataPresent: s.warpEnrolledDevices > 0,
      icon: <Wifi size={16}/>,
      impact: s.warpEnrolledDevices > 0 ? `${s.warpEnrolledDevices} devices enrolled` : "Deploy WARP to all managed devices",
    },
    {
      name: "Private Network",
      capability: "Cloudflare Tunnel (VPN Replace)",
      deployed: s.tunnelsTotal > 0,
      dataPresent: s.tunnelsTotal > 0,
      icon: <Network size={16}/>,
      impact: s.tunnelsTotal > 0 ? `${s.tunnelsHealthy}/${s.tunnelsTotal} tunnels healthy` : "Replace VPN with Cloudflare Tunnel",
    },
    {
      name: "Shadow IT",
      capability: "CASB / App Discovery",
      deployed: httpPolicies > 0,
      dataPresent: (s.shadowItAppsDiscovered ?? 0) > 0,
      icon: <Eye size={16}/>,
      impact: (s.shadowItAppsDiscovered ?? 0) > 0 ? `${s.shadowItAppsDiscovered} apps discovered` : "Enable HTTP filtering to discover SaaS",
    },
    {
      name: "Data Protection",
      capability: "DLP (Data Loss Prevention)",
      deployed: data.dlpProfiles?.length > 0,
      dataPresent: (s.casbFindingsCount ?? 0) > 0,
      icon: <FileText size={16}/>,
      impact: data.dlpProfiles?.length > 0 ? `${data.dlpProfiles.length} profiles active` : "Configure DLP profiles for sensitive data",
    },
  ];

  const deployedCount = features.filter((f) => f.deployed).length;

  // Phase definitions
  const phases = [
    {
      label: "Phase 1 — POC (Complete)",
      color: "#10B981",
      bg: "#F0FDF4",
      border: "#BBF7D0",
      items: features.filter((f) => f.deployed),
      status: "done",
    },
    {
      label: "Phase 2 — Quick Wins (30 days)",
      color: "#F59E0B",
      bg: "#FFFBEB",
      border: "#FDE68A",
      items: features.filter((f) => !f.deployed && (f.name === "HTTP Inspection" || f.name === "Device Security")),
      status: "next",
    },
    {
      label: "Phase 3 — Full SASE (60–90 days)",
      color: "#8B5CF6",
      bg: "#F5F3FF",
      border: "#DDD6FE",
      items: features.filter((f) => !f.deployed && f.name !== "HTTP Inspection" && f.name !== "Device Security"),
      status: "future",
    },
  ].filter((p) => p.items.length > 0);

  // DNS timeseries chart — aggregate to daily
  const chartData = dnsSeries.slice(-30).map((d) => ({
    date: d.date.slice(5),
    blocked: d.blocked,
    allowed: d.total - d.blocked,
  }));

  const hasAnyData = dnsBlocked > 0 || s.totalAuthEvents > 0;

  if (!hasAnyData && deployedCount === 0) return null;

  return (
    <section className="report-section">
      <SectionHeader
        icon={<Shield size={20}/>}
        title="POC Value Delivered"
        subtitle={`What Cloudflare One protected during the ${data.meta.periodLabel} evaluation period`}
        printBreak
      />

      {/* ── Hero metrics row ─────────────────────────────────────────── */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
        {/* DNS headline — always show even if 0 so customer sees the capability */}
        <div className="lg:col-span-2 bg-gradient-to-br from-blue-600 to-blue-800 rounded-2xl p-5 text-white">
          <p className="text-[10px] font-bold uppercase tracking-widest text-blue-200 mb-2">DNS Threats Stopped</p>
          <p className="text-4xl font-black leading-none mb-1">{fmtBig(dnsBlocked)}</p>
          <p className="text-blue-200 text-xs mb-3">{dnsBlkPct}% of {fmtBig(dnsTotal)} total DNS queries flagged</p>
          {dnsBlocked > 0 && (
            <div className="flex items-center gap-2 bg-white/10 rounded-lg px-3 py-2">
              <Shield size={14} className="text-blue-200 flex-shrink-0"/>
              <p className="text-[10px] text-blue-100 leading-snug">
                Est. <strong className="text-white">{infectionsEst.toLocaleString()}</strong> potential malware infections
                prevented (industry avg: 1 in 200 blocked queries)
              </p>
            </div>
          )}
        </div>

        <div className="bg-white rounded-2xl border border-cf-gray-200 shadow-sm p-4 flex flex-col justify-between">
          <p className="text-[10px] font-semibold text-cf-gray-500 uppercase tracking-wide">Users Access-Controlled</p>
          <div>
            <p className="text-3xl font-black text-cf-navy">{formatNumber(s.uniqueUsers)}</p>
            <p className="text-[10px] text-cf-gray-400 mt-1">across {accessApps.length} protected apps</p>
          </div>
        </div>

        <div className="bg-white rounded-2xl border border-cf-gray-200 shadow-sm p-4 flex flex-col justify-between">
          <p className="text-[10px] font-semibold text-cf-gray-500 uppercase tracking-wide">Capabilities Active</p>
          <div>
            <p className="text-3xl font-black text-green-600">{deployedCount}<span className="text-base font-semibold text-cf-gray-400">/{features.length}</span></p>
            <p className="text-[10px] text-cf-gray-400 mt-1">{features.length - deployedCount} more available to unlock</p>
          </div>
        </div>
      </div>

      {/* ── DNS blocking trend ───────────────────────────────────────── */}
      {chartData.length > 3 && (
        <div className="bg-white rounded-xl shadow-sm border border-cf-gray-200 p-4 mb-6">
          <div className="flex items-center justify-between mb-3">
            <div>
              <h3 className="text-sm font-semibold text-cf-navy">DNS Threat Blocking — Daily Trend</h3>
              <p className="text-[10px] text-cf-gray-400 mt-0.5">Allowed vs. blocked queries over the evaluation period</p>
            </div>
            <div className="text-right">
              <p className="text-xl font-black text-red-600">{fmtBig(dnsBlocked)}</p>
              <p className="text-[10px] text-cf-gray-400">total blocked</p>
            </div>
          </div>
          <ResponsiveContainer width="100%" height={180}>
            <AreaChart data={chartData} margin={{ top: 4, right: 8, bottom: 0, left: 0 }}>
              <defs>
                <linearGradient id="pocAllowed" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="#3B82F6" stopOpacity={0.15}/><stop offset="95%" stopColor="#3B82F6" stopOpacity={0}/>
                </linearGradient>
                <linearGradient id="pocBlocked" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="#EF4444" stopOpacity={0.4}/><stop offset="95%" stopColor="#EF4444" stopOpacity={0}/>
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke="#F1F5F9"/>
              <XAxis dataKey="date" tick={{ fontSize: 9 }} tickLine={false}/>
              <YAxis tick={{ fontSize: 9 }} tickFormatter={(v) => v >= 1e6 ? `${(v/1e6).toFixed(0)}M` : v >= 1e3 ? `${(v/1e3).toFixed(0)}K` : String(v)}/>
              <Tooltip
                contentStyle={{ fontSize: 11, borderRadius: 8 }}
                formatter={(v: number, name: string) => [formatNumber(v), name]}
              />
              <Area type="monotone" dataKey="allowed" name="Allowed" stroke="#3B82F6" fill="url(#pocAllowed)" strokeWidth={1.5} dot={false}/>
              <Area type="monotone" dataKey="blocked" name="Blocked" stroke="#EF4444" fill="url(#pocBlocked)" strokeWidth={2} dot={false}/>
            </AreaChart>
          </ResponsiveContainer>
        </div>
      )}

      {/* ── Feature coverage matrix ──────────────────────────────────── */}
      <div className="bg-white rounded-xl shadow-sm border border-cf-gray-200 overflow-hidden mb-6">
        <div className="px-5 py-3 border-b border-cf-gray-100 flex items-center justify-between">
          <div>
            <h3 className="text-sm font-semibold text-cf-navy">Cloudflare One Feature Coverage</h3>
            <p className="text-[10px] text-cf-gray-400 mt-0.5">What's active in this POC vs. full deployment potential</p>
          </div>
          <div className="flex items-center gap-4 text-[10px]">
            <span className="flex items-center gap-1 text-green-600"><CheckCircle2 size={12}/> Deployed</span>
            <span className="flex items-center gap-1 text-cf-gray-400"><Circle size={12}/> Available</span>
          </div>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-0 divide-y sm:divide-y-0 sm:divide-x divide-cf-gray-100">
          {features.map((f) => (
            <div key={f.name} className={`p-4 ${f.deployed ? "bg-green-50/40" : "bg-cf-gray-50/30"}`}>
              <div className="flex items-start gap-2.5">
                <div className={`mt-0.5 flex-shrink-0 ${f.deployed ? "text-green-600" : "text-cf-gray-300"}`}>
                  {f.deployed ? <CheckCircle2 size={16}/> : <Circle size={16}/>}
                </div>
                <div>
                  <div className="flex items-center gap-1.5 mb-0.5">
                    <span className={`${f.deployed ? "text-green-700" : "text-cf-gray-400"}`}>{f.icon}</span>
                    <p className="text-xs font-semibold text-cf-navy">{f.name}</p>
                  </div>
                  <p className="text-[10px] text-cf-gray-400 mb-1">{f.capability}</p>
                  <p className={`text-[10px] font-medium ${f.deployed && f.dataPresent ? "text-green-700" : f.deployed ? "text-yellow-600" : "text-cf-gray-400"}`}>
                    {f.impact}
                  </p>
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* ── Deployment phases ────────────────────────────────────────── */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {phases.map((phase) => (
          <div key={phase.label} className="rounded-xl border p-4" style={{ backgroundColor: phase.bg, borderColor: phase.border }}>
            <div className="flex items-center gap-2 mb-3">
              <div className="w-2 h-2 rounded-full" style={{ backgroundColor: phase.color }}/>
              <p className="text-[11px] font-bold uppercase tracking-wide" style={{ color: phase.color }}>{phase.label}</p>
            </div>
            <div className="space-y-2">
              {phase.items.map((item) => (
                <div key={item.name} className="flex items-start gap-2">
                  <span style={{ color: phase.color }} className="mt-0.5 flex-shrink-0">{item.icon}</span>
                  <div>
                    <p className="text-xs font-semibold text-cf-navy">{item.name}</p>
                    <p className="text-[10px] text-cf-gray-500">{item.impact}</p>
                  </div>
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}
