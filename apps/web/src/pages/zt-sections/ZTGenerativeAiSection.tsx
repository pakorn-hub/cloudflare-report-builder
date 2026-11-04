/**
 * Generative AI (Shadow AI) Usage Section — Cloudflare One.
 * Derived from Shadow IT discovery data: surfaces which generative-AI SaaS
 * tools (ChatGPT, Claude, Gemini, Copilot, Perplexity, etc.) are being
 * accessed by users, and whether any Gateway policy governs that traffic.
 */
import { Sparkles, ShieldAlert, ShieldCheck, Users } from "lucide-react";
import {
  ResponsiveContainer, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Cell,
} from "recharts";
import type { ZeroTrustData } from "../../types";
import { formatNumber } from "../../utils/formatters";
import SectionHeader from "../../components/SectionHeader";

const COLORS = ["#7C3AED", "#2563EB", "#0EA5E9", "#EC4899", "#F59E0B", "#10B981", "#EF4444", "#8B5CF6"];

const STATUS_COLORS: Record<string, string> = {
  approved: "#10B981", unapproved: "#EF4444", "in review": "#F59E0B", unreviewed: "#9CA3AF",
};
const STATUS_LABELS: Record<string, string> = {
  approved: "Approved", unapproved: "Unapproved", "in review": "In Review", unreviewed: "Unreviewed",
};

export default function ZTGenerativeAiSection({ data }: { data: ZeroTrustData }) {
  const ai = data.aiAppUsage;

  if (!ai || ai.uniqueApps === 0) {
    return (
      <section className="report-section">
        <SectionHeader icon={<Sparkles size={20} />} title="Generative AI (Shadow AI) Usage"
          subtitle="Real Cloudflare 'Artificial Intelligence' category classification across DNS + HTTP Gateway traffic" />
        <div className="bg-white rounded-xl shadow-sm border border-cf-gray-200 p-8 text-center text-cf-gray-400 text-sm">
          No traffic classified under Cloudflare's "Artificial Intelligence" category was detected via Gateway DNS or
          HTTP in this period. Ensure Gateway DNS/HTTP policies have logging enabled to gain visibility into GenAI tool adoption.
        </div>
      </section>
    );
  }

  const apps = [...ai.apps].sort((a, b) => b.count - a.count);
  const barData = apps.slice(0, 10).map((a) => ({ name: a.name, count: a.count }));
  const appsWithStatus = apps.filter((a) => a.status);
  const statusCounts   = new Map<string, number>();
  for (const a of appsWithStatus) {
    const key = (a.status ?? "").toLowerCase();
    statusCounts.set(key, (statusCounts.get(key) ?? 0) + 1);
  }
  const statusBreakdown = Array.from(statusCounts.entries()).map(([status, count]) => ({ status, count }));

  const mcpRequests = data.summary.gatewayMcpHttpRequests ?? 0;

  const kpiCards = [
    { label: "GenAI Apps Discovered", value: formatNumber(ai.uniqueApps),     color: "#7C3AED" },
    { label: "DNS/HTTP Requests",     value: formatNumber(ai.totalRequests),  color: "#2563EB" },
    { label: "Users Using AI Tools",  value: formatNumber(ai.uniqueUsers),    color: "#0EA5E9" },
    {
      label: "Governance Policy",
      value: ai.hasGovernancePolicy ? "Configured" : "Not Configured",
      color: ai.hasGovernancePolicy ? "#10B981" : "#EF4444",
    },
    // Real, from gatewayL7RequestsAdaptiveGroups.experimentalIsMcp — MCP
    // (Model Context Protocol) server traffic, a distinct AI-security signal
    // from GenAI SaaS tool usage (agentic/tool-calling traffic vs. chat UIs).
    ...(mcpRequests > 0 ? [{ label: "MCP Traffic (Requests)", value: formatNumber(mcpRequests), color: "#8B5CF6" }] : []),
  ];

  return (
    <section className="report-section">
      <SectionHeader icon={<Sparkles size={20} />} title="Generative AI (Shadow AI) Usage"
        subtitle="Visibility into ChatGPT, Claude, Gemini, Copilot, and other GenAI tool usage across the organization" />

      {/* KPI cards */}
      <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-5 gap-4 mb-5">
        {kpiCards.map((k) => (
          <div key={k.label} className="bg-white rounded-xl shadow-sm border border-cf-gray-200 p-4">
            <p className="text-[10px] font-semibold text-cf-gray-500 uppercase tracking-wide mb-1">{k.label}</p>
            <p className="text-xl font-black" style={{ color: k.color }}>{k.value}</p>
          </div>
        ))}
      </div>

      {/* Approval status breakdown — only shown if status data is available */}
      {statusBreakdown.length > 0 && (
        <div className="bg-white rounded-xl shadow-sm border border-cf-gray-200 p-4 mb-5">
          <h3 className="text-sm font-semibold text-cf-navy mb-3">AI Applications by Approval Status</h3>
          <div className="flex flex-wrap gap-3">
            {statusBreakdown.map((s) => (
              <div key={s.status} className="flex items-center gap-2 px-3 py-2 rounded-lg border border-cf-gray-200 bg-cf-gray-50">
                <div className="w-2 h-2 rounded-full" style={{ backgroundColor: STATUS_COLORS[s.status] ?? "#9CA3AF" }} />
                <span className="text-xs font-semibold text-cf-navy">{STATUS_LABELS[s.status] ?? s.status}</span>
                <span className="text-[10px] text-cf-gray-500 bg-cf-gray-200 px-1.5 py-0.5 rounded">{s.count}</span>
              </div>
            ))}
          </div>
          {(() => {
            const unapproved = apps.filter((a) => (a.status ?? "").toLowerCase() === "unapproved");
            return unapproved.length > 0 ? (
              <p className="text-xs text-red-600 mt-3">
                ⚠ {unapproved.length} unapproved AI app{unapproved.length === 1 ? "" : "s"} in use
                ({unapproved.map((a) => a.name).join(", ")}) — review for potential data exposure risk.
              </p>
            ) : null;
          })()}
        </div>
      )}

      {/* Governance banner */}
      <div
        className="rounded-xl border p-4 mb-5 flex items-start gap-3"
        style={{
          backgroundColor: ai.hasGovernancePolicy ? "#F0FDF4" : "#FEF2F2",
          borderColor: ai.hasGovernancePolicy ? "#BBF7D0" : "#FECACA",
        }}
      >
        {ai.hasGovernancePolicy
          ? <ShieldCheck size={16} className="text-green-600 flex-shrink-0 mt-0.5" />
          : <ShieldAlert size={16} className="text-red-500 flex-shrink-0 mt-0.5" />
        }
        <div>
          <p className={`text-sm font-semibold ${ai.hasGovernancePolicy ? "text-green-700" : "text-red-700"}`}>
            {ai.hasGovernancePolicy
              ? "A Gateway policy governing generative AI traffic was found"
              : "No Gateway policy specifically governs generative AI traffic"}
          </p>
          <p className={`text-xs mt-0.5 ${ai.hasGovernancePolicy ? "text-green-600" : "text-red-600"}`}>
            {ai.hasGovernancePolicy
              ? "Continue monitoring DLP match rates for prompts containing sensitive data."
              : "Add a DNS/HTTP policy targeting the \"Generative AI\" application category plus a DLP profile to inspect prompts before they leave the network."}
          </p>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5 items-start">
        {/* Top AI apps bar chart */}
        {barData.length > 0 && (
          <div className="bg-white rounded-xl shadow-sm border border-cf-gray-200 p-4">
            <h3 className="text-sm font-semibold text-cf-navy mb-3">Top Generative AI Tools by Volume</h3>
            <ResponsiveContainer width="100%" height={240}>
              <BarChart data={barData} layout="vertical" margin={{ top: 4, right: 16, bottom: 0, left: 90 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#F1F5F9" />
                <XAxis type="number" tick={{ fontSize: 10 }}
                  tickFormatter={(v) => v >= 1e6 ? `${(v / 1e6).toFixed(1)}M` : v >= 1e3 ? `${(v / 1e3).toFixed(0)}K` : String(v)} />
                <YAxis type="category" dataKey="name" tick={{ fontSize: 10 }} width={86} />
                <Tooltip contentStyle={{ fontSize: 11, borderRadius: 8 }} formatter={(v: number) => formatNumber(v)} />
                <Bar dataKey="count" radius={[0, 4, 4, 0]}>
                  {barData.map((_, i) => <Cell key={i} fill={COLORS[i % COLORS.length]} />)}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        )}

        {/* Inventory table */}
        <div className="bg-white rounded-xl shadow-sm border border-cf-gray-200 overflow-hidden">
          <div className="px-5 py-3 border-b border-cf-gray-100 flex items-center gap-2">
            <Users size={13} className="text-cf-gray-400" />
            <h3 className="text-sm font-semibold text-cf-navy">Discovered GenAI Application Inventory</h3>
          </div>
          <div className="overflow-y-auto" style={{ maxHeight: 280 }}>
            <table className="w-full text-xs">
              <thead className="sticky top-0">
                <tr className="bg-cf-gray-50 text-cf-gray-500 uppercase tracking-wide text-[10px]">
                  <th className="px-4 py-2 text-left font-semibold">#</th>
                  <th className="px-4 py-2 text-left font-semibold">Application</th>
                  <th className="px-4 py-2 text-left font-semibold">Category</th>
                  {appsWithStatus.length > 0 && <th className="px-4 py-2 text-left font-semibold">Status</th>}
                  <th className="px-4 py-2 text-right font-semibold">Requests</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-cf-gray-100">
                {apps.map((app, i) => {
                  const statusKey = (app.status ?? "").toLowerCase();
                  return (
                    <tr key={app.name} className={i % 2 === 0 ? "bg-white" : "bg-cf-gray-50/40"}>
                      <td className="px-4 py-1.5 text-cf-gray-400 font-mono text-[11px]">{i + 1}</td>
                      <td className="px-4 py-1.5 font-semibold text-cf-navy text-[11px]">{app.name}</td>
                      <td className="px-4 py-1.5 text-[11px] text-cf-gray-500">{app.category}</td>
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
      </div>
    </section>
  );
}
