import { Lock, CheckCircle2, XCircle, Key, Bot } from "lucide-react";
import {
  ResponsiveContainer, PieChart, Pie, Cell, Tooltip, Legend,
  BarChart, Bar, XAxis, YAxis, CartesianGrid,
} from "recharts";
import type { ZeroTrustData } from "../../types";
import { formatNumber } from "../../utils/formatters";
import SectionHeader from "../../components/SectionHeader";

const APP_TYPE_LABELS: Record<string, string> = {
  self_hosted: "Self-Hosted", saas: "SaaS", ssh: "SSH", vnc: "VNC",
  app_launcher: "App Launcher", warp: "WARP", biso: "Browser Isolation",
  mcp: "MCP Server",
};
const IDP_COLORS: Record<string, string> = {
  google: "#4285F4", okta: "#007DC1", azure: "#0078D4", github: "#24292E",
  saml: "#E8830A", oidc: "#F15A22", otp: "#10B981",
};
const TYPE_COLORS = ["#3B82F6", "#8B5CF6", "#F59E0B", "#10B981", "#EF4444", "#EC4899", "#14B8A6", "#6366F1"];
const ACTION_COLORS: Record<string, string> = {
  Allow: "#10B981", Block: "#EF4444", Bypass: "#F59E0B", "Service Auth": "#8B5CF6",
};
const AUTH_METHOD_COLORS: Record<string, string> = { SSO: "#3B82F6", "Direct Login": "#F59E0B" };

export default function ZTAccessAppsSection({ data }: { data: ZeroTrustData }) {
  const apps     = data.accessApps;
  const policies = data.accessPolicies;
  const idps     = data.accessIdps;
  if (apps.length === 0 && idps.length === 0) return null;

  const mfaCount   = policies.filter((p) => p.requireMfa).length;
  const blockCount = policies.filter((p) => p.decision === "block").length;

  const appTypeBreakdown    = data.accessAppTypeBreakdown ?? [];
  const policyActionBreak   = data.accessPolicyActionBreakdown ?? [];
  const topSourceIps        = data.accessTopSourceIps ?? [];
  const authMethodBreakdown = data.accessAuthMethodBreakdown ?? [];
  const mcpServersCount     = data.summary.mcpServersCount ?? 0;
  const mcpPortalsCount     = data.summary.mcpPortalsCount ?? 0;
  const mcpLoginEvents      = data.summary.mcpServerLoginEvents ?? 0;

  return (
    <section className="report-section">
      <SectionHeader icon={<Lock size={20}/>} title="Access — Applications & Policies"
        subtitle="Identity-aware access control for internal and SaaS applications" />
      <div className="space-y-5">
        {/* KPI strip */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          {[
            { label: "Applications",   value: apps.length,            color: "#3B82F6" },
            { label: "Enabled",        value: apps.filter((a) => a.enabled).length, color: "#10B981" },
            { label: "Policies with MFA", value: mfaCount,            color: "#F59E0B" },
            { label: "Identity Providers", value: idps.length,        color: "#8B5CF6" },
          ].map((k) => (
            <div key={k.label} className="bg-white rounded-xl shadow-sm border border-cf-gray-200 p-4">
              <p className="text-[10px] font-semibold text-cf-gray-500 uppercase tracking-wide mb-1">{k.label}</p>
              <p className="text-2xl font-black" style={{ color: k.color }}>{k.value}</p>
            </div>
          ))}
        </div>

        {/* MCP visibility callout */}
        {(mcpServersCount > 0 || mcpPortalsCount > 0) && (
          <div className="rounded-xl border p-4 flex items-start gap-3" style={{ backgroundColor: "#F5F3FF", borderColor: "#DDD6FE" }}>
            <Bot size={16} className="flex-shrink-0 mt-0.5" style={{ color: "#7C3AED" }} />
            <div>
              <p className="text-sm font-semibold" style={{ color: "#6D28D9" }}>
                {mcpServersCount + mcpPortalsCount} MCP server{mcpServersCount + mcpPortalsCount === 1 ? "" : "s"} protected by Access
              </p>
              <p className="text-xs mt-0.5" style={{ color: "#7C3AED" }}>
                {mcpServersCount} individual MCP server app{mcpServersCount === 1 ? "" : "s"}
                {mcpPortalsCount > 0 && `, ${mcpPortalsCount} MCP server portal${mcpPortalsCount === 1 ? "" : "s"}`}
                {mcpLoginEvents > 0 && ` · ${formatNumber(mcpLoginEvents)} login events in this period`}
              </p>
            </div>
          </div>
        )}

        {/* App type / policy action / auth method breakdowns */}
        {(appTypeBreakdown.length > 0 || policyActionBreak.length > 0 || authMethodBreakdown.length > 0) && (
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 items-start">
            {appTypeBreakdown.length > 0 && (
              <div className="bg-white rounded-xl shadow-sm border border-cf-gray-200 p-4">
                <h3 className="text-sm font-semibold text-cf-navy mb-3">Applications by Type</h3>
                <ResponsiveContainer width="100%" height={180}>
                  <PieChart>
                    <Pie data={appTypeBreakdown} cx="50%" cy="50%" innerRadius={40} outerRadius={70}
                      paddingAngle={2} dataKey="count" nameKey="type" labelLine={false}>
                      {appTypeBreakdown.map((_, i) => <Cell key={i} fill={TYPE_COLORS[i % TYPE_COLORS.length]} />)}
                    </Pie>
                    <Tooltip contentStyle={{ fontSize: 11, borderRadius: 8 }} formatter={(v: number) => formatNumber(v)} />
                    <Legend iconType="circle" iconSize={8} wrapperStyle={{ fontSize: 10 }} />
                  </PieChart>
                </ResponsiveContainer>
              </div>
            )}
            {policyActionBreak.length > 0 && (
              <div className="bg-white rounded-xl shadow-sm border border-cf-gray-200 p-4">
                <h3 className="text-sm font-semibold text-cf-navy mb-3">Policies by Action</h3>
                <ResponsiveContainer width="100%" height={180}>
                  <BarChart data={policyActionBreak} margin={{ top: 4, right: 8, bottom: 0, left: -20 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#F1F5F9" vertical={false} />
                    <XAxis dataKey="action" tick={{ fontSize: 9 }} />
                    <YAxis tick={{ fontSize: 10 }} allowDecimals={false} />
                    <Tooltip contentStyle={{ fontSize: 11, borderRadius: 8 }} formatter={(v: number) => formatNumber(v)} />
                    <Bar dataKey="count" radius={[4, 4, 0, 0]}>
                      {policyActionBreak.map((d, i) => <Cell key={i} fill={ACTION_COLORS[d.action] ?? "#6B7280"} />)}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </div>
            )}
            {authMethodBreakdown.length > 0 && (() => {
              const authTotal = authMethodBreakdown.reduce((sum, d) => sum + d.count, 0);
              return (
                <div className="bg-white rounded-xl shadow-sm border border-cf-gray-200 p-4">
                  <h3 className="text-sm font-semibold text-cf-navy mb-3">Login Method</h3>
                  <ResponsiveContainer width="100%" height={180}>
                    <PieChart>
                      <Pie data={authMethodBreakdown} cx="50%" cy="50%" innerRadius={40} outerRadius={70}
                        paddingAngle={2} dataKey="count" nameKey="method" label={false} labelLine={false}>
                        {authMethodBreakdown.map((d, i) => <Cell key={i} fill={AUTH_METHOD_COLORS[d.method] ?? "#6B7280"} />)}
                      </Pie>
                      <Tooltip contentStyle={{ fontSize: 11, borderRadius: 8 }} formatter={(v: number) => formatNumber(v)} />
                      <Legend iconType="circle" iconSize={8} wrapperStyle={{ fontSize: 10 }}
                        formatter={(value: string) => {
                          const d = authMethodBreakdown.find((x) => x.method === value);
                          const pct = d && authTotal > 0 ? Math.round((d.count / authTotal) * 100) : 0;
                          return `${value} (${pct}%)`;
                        }} />
                    </PieChart>
                  </ResponsiveContainer>
                </div>
              );
            })()}
          </div>
        )}

        {/* Top source IPs */}
        {topSourceIps.length > 0 && (
          <div className="bg-white rounded-xl shadow-sm border border-cf-gray-200 overflow-hidden">
            <div className="px-5 py-3 border-b border-cf-gray-100">
              <h3 className="text-sm font-semibold text-cf-navy">Top Source IP Addresses</h3>
              <p className="text-xs text-cf-gray-500 mt-0.5">Most active source IPs for Access login events</p>
            </div>
            <div className="overflow-y-auto" style={{ maxHeight: 240 }}>
              <table className="w-full text-xs">
                <thead className="sticky top-0">
                  <tr className="bg-cf-gray-50 text-cf-gray-500 uppercase tracking-wide text-[10px]">
                    <th className="px-4 py-2 text-left font-semibold">#</th>
                    <th className="px-4 py-2 text-left font-semibold">IP Address</th>
                    <th className="px-4 py-2 text-right font-semibold">Requests</th>
                    <th className="px-4 py-2 text-right font-semibold">Blocked</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-cf-gray-100">
                  {topSourceIps.slice(0, 15).map((ip, i) => (
                    <tr key={ip.ip} className={i % 2 === 0 ? "bg-white" : "bg-cf-gray-50/40"}>
                      <td className="px-4 py-1.5 text-cf-gray-400 font-mono text-[11px]">{i + 1}</td>
                      <td className="px-4 py-1.5 font-mono text-cf-navy text-[11px]">{ip.ip}</td>
                      <td className="px-4 py-1.5 text-right font-mono text-cf-navy text-[11px]">{formatNumber(ip.requests)}</td>
                      <td className="px-4 py-1.5 text-right font-mono text-[11px]" style={{ color: ip.blocked > 0 ? "#EF4444" : "#9CA3AF" }}>
                        {ip.blocked > 0 ? formatNumber(ip.blocked) : "—"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* IdP cards */}
        {idps.length > 0 && (
          <div className="bg-white rounded-xl shadow-sm border border-cf-gray-200 p-5">
            <h3 className="text-sm font-semibold text-cf-navy mb-3">Connected Identity Providers</h3>
            <div className="flex flex-wrap gap-3">
              {idps.map((idp) => (
                <div key={idp.id} className="flex items-center gap-2 px-3 py-2 rounded-lg border border-cf-gray-200 bg-cf-gray-50">
                  <div className="w-2 h-2 rounded-full" style={{ backgroundColor: IDP_COLORS[idp.type.toLowerCase()] ?? "#9CA3AF" }} />
                  <span className="text-xs font-semibold text-cf-navy">{idp.name}</span>
                  <span className="text-[10px] text-cf-gray-500 bg-cf-gray-200 px-1.5 py-0.5 rounded">{idp.type.toUpperCase()}</span>
                </div>
              ))}
            </div>
          </div>
        )}
        {/* Apps table */}
        {apps.length > 0 && (
          <div className="bg-white rounded-xl shadow-sm border border-cf-gray-200 overflow-hidden">
            <div className="px-5 py-4 border-b border-cf-gray-100 flex items-center gap-2">
              <Key size={14} className="text-cf-orange" />
              <h3 className="text-sm font-semibold text-cf-navy">Application Inventory</h3>
              {blockCount > 0 && <span className="text-[10px] bg-red-50 text-red-600 border border-red-200 px-2 py-0.5 rounded-full ml-auto">{blockCount} block policies</span>}
            </div>
            <div className="overflow-x-auto overflow-y-auto" style={{ maxHeight: 400 }}>
              <table className="w-full text-xs">
                <thead className="sticky top-0">
                  <tr className="bg-cf-gray-50 text-cf-gray-500 uppercase tracking-wide text-[10px]">
                    <th className="px-4 py-2.5 text-left font-semibold">#</th>
                    <th className="px-4 py-2.5 text-left font-semibold">Application</th>
                    <th className="px-4 py-2.5 text-left font-semibold">Domain</th>
                    <th className="px-4 py-2.5 text-left font-semibold">Type</th>
                    <th className="px-4 py-2.5 text-center font-semibold">Policies</th>
                    <th className="px-4 py-2.5 text-center font-semibold">Session</th>
                    <th className="px-4 py-2.5 text-center font-semibold">Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-cf-gray-100">
                  {apps.map((app, i) => {
                    const appPols = policies.filter((p) => p.appId === app.id);
                    const hasMfa  = appPols.some((p) => p.requireMfa);
                    return (
                      <tr key={app.id} className={i % 2 === 0 ? "bg-white" : "bg-cf-gray-50/40"}>
                        <td className="px-4 py-2 text-cf-gray-400 font-mono text-[11px]">{i+1}</td>
                        <td className="px-4 py-2">
                          <div className="flex items-center gap-2">
                            <span className="text-xs font-semibold text-cf-navy">{app.name}</span>
                            {hasMfa && <span className="text-[9px] bg-green-50 text-green-600 border border-green-200 px-1 rounded">MFA</span>}
                          </div>
                        </td>
                        <td className="px-4 py-2 font-mono text-[11px] text-cf-gray-500 max-w-[180px] truncate">{app.domain || "—"}</td>
                        <td className="px-4 py-2 text-[11px] text-cf-gray-600">{APP_TYPE_LABELS[app.type] ?? app.type}</td>
                        <td className="px-4 py-2 text-center text-[11px] font-mono text-cf-navy">{app.policyCount}</td>
                        <td className="px-4 py-2 text-center text-[11px] text-cf-gray-500">{app.sessionDuration}</td>
                        <td className="px-4 py-2 text-center">
                          {app.enabled ? <CheckCircle2 size={14} className="text-green-500 mx-auto"/> : <XCircle size={14} className="text-cf-gray-400 mx-auto"/>}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>
    </section>
  );
}
