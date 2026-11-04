/**
 * EnterpriseIntelSection — Enterprise-only security intelligence
 * Shows:
 *   1. Security Events by Service (which CF product mitigated what)
 *   2. Page Shield — client-side script inventory
 * Note: WAF Attack Score (All Traffic) has been moved to WafSection.
 * Note: Leaked Credential Check / AI Security for Apps / Malicious Uploads /
 * Account Takeover now live in SuspiciousActivitySection (real enabled/
 * disabled status + real detection data, replacing the old dead HIBP-style
 * per-request breach-count card that never had a real backend source).
 */
import { Zap, Shield, Code2, AlertTriangle } from "lucide-react";
import { ResponsiveContainer, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, Cell } from "recharts";
import type { AppSecData } from "../../types";
import { formatNumber } from "../../utils/formatters";
import SectionHeader from "../../components/SectionHeader";

interface Props { data: AppSecData }

// ── Source label map — only zone-level WAF/security sources ──────────────────
const SOURCE_LABEL: Record<string, string> = {
  firewallManaged:    "WAF Managed Rules",
  firewallCustom:     "WAF Custom Rules",
  firewallRateLimit:  "Rate Limiting",
  l7ddos:             "DDoS L7 Protection",
  apiShield:          "API Shield",
  botManagement:      "Bot Management",
  hot:                "Hot (IP Reputation)",
  jschallengeError:   "JS Challenge Error",
  securitylevel:      "Security Level",
  uaBlock:            "User-Agent Block",
  zonelockdown:       "Zone Lockdown",
  waf:                "WAF",
};

const SOURCE_COLOR: Record<string, string> = {
  firewallManaged:    "#3B82F6",
  firewallCustom:     "#F6821F",
  firewallRateLimit:  "#8B5CF6",
  l7ddos:             "#EF4444",
  apiShield:          "#10B981",
  botManagement:      "#F59E0B",
  hot:                "#EC4899",
  jschallengeError:   "#6B7280",
  securitylevel:      "#14B8A6",
  uaBlock:            "#F97316",
  zonelockdown:       "#7C3AED",
  waf:                "#2563EB",
};

// Sources to exclude — non-zone security products (Zero Trust / DLP / internal checks)
const EXCLUDED_SOURCES = new Set([
  "dlp",           // Data Loss Prevention — Cloudflare One product, not zone WAF
  "sanitycheck",   // Cloudflare internal health-check traffic, not real threats
  "unknown",       // Noise
]);

export default function EnterpriseIntelSection({ data }: Props) {
  const eventsByService  = data.securityEventsByService ?? [];
  const pageShieldScripts = data.pageShieldScripts ?? [];
  const pageShieldEnabled = data.pageShieldEnabled ?? false;

  const hasData = eventsByService.length > 0 || pageShieldScripts.length > 0;

  if (!hasData) return null;

  // ── Security Events by Service ────────────────────────────────────────────
  // Filter to zone-level WAF/security sources only — exclude DLP, sanitycheck, etc.
  const filteredEvents = eventsByService.filter((e) => !EXCLUDED_SOURCES.has(e.source));

  // Aggregate by source (merge actions)
  const bySourceMap = new Map<string, number>();
  for (const e of filteredEvents) {
    bySourceMap.set(e.source, (bySourceMap.get(e.source) ?? 0) + e.count);
  }
  const serviceBarData = Array.from(bySourceMap.entries())
    .map(([src, count]) => ({
      name: SOURCE_LABEL[src] ?? src,
      value: count,
      color: SOURCE_COLOR[src] ?? "#9CA3AF",
    }))
    .sort((a, b) => b.value - a.value);

  // ── Page Shield ───────────────────────────────────────────────────────────
  const maliciousScripts = pageShieldScripts.filter(
    (s) => (s.js_integrity_score ?? 100) < 30 || (s.malware_score ?? 100) < 30
  );
  const activeScripts = pageShieldScripts.filter((s) => s.status === "active");
  const uniqueHosts = new Set(pageShieldScripts.map((s) => s.host)).size;

  return (
    <section className="report-section">
      <SectionHeader
        icon={<Zap size={20} />}
        title="Enterprise Security Intelligence"
        subtitle="Security event attribution and client-side script inventory"
        printBreak
      />

      <div className="space-y-6">
        {/* ── Security Events by Service ──────────────────────────────── */}
        {serviceBarData.length > 0 && (() => {
          // Build grouped data: one row per service, columns = actions
          const ACTIONS = ["block", "managed_challenge", "challenge", "log", "skip"];
          const ACTION_COLORS: Record<string, string> = {
            block:              "#DC2626",  // red   — bad
            managed_challenge:  "#D97706",  // amber — warning
            challenge:          "#F59E0B",  // yellow
            log:                "#3B82F6",  // blue  — neutral
            skip:               "#9CA3AF",  // gray  — neutral
          };

          // Group by source, then by action — exclude irrelevant sources
          const bySource = new Map<string, Record<string, number>>();
          for (const e of filteredEvents) {
            if (!bySource.has(e.source)) bySource.set(e.source, {});
            const row = bySource.get(e.source)!;
            row[e.action] = (row[e.action] ?? 0) + e.count;
          }

          const groupedData = Array.from(bySource.entries())
            .map(([src, actions]) => ({
              service: SOURCE_LABEL[src] ?? src,
              srcKey: src,
              total: Object.values(actions).reduce((s, v) => s + v, 0),
              ...actions,
            }))
            .sort((a, b) => b.total - a.total);

          const usedActions = ACTIONS.filter((a) =>
            groupedData.some((d) => (d as Record<string, unknown>)[a])
          );

          return (
            <div className="bg-white rounded-xl shadow-sm border border-cf-gray-200 overflow-hidden">
              <div className="px-5 py-4 border-b border-cf-gray-100 flex items-center gap-3">
                <div className="w-8 h-8 bg-blue-50 rounded-lg flex items-center justify-center">
                  <Shield size={16} className="text-blue-600" />
                </div>
                <div className="flex-1">
                  <h3 className="text-sm font-semibold text-cf-navy">Security Events by Service &amp; Action</h3>
                  <p className="text-xs text-cf-gray-500 mt-0.5">
                    Which Cloudflare service acted on threats, and what action was taken. Red = blocked, amber = challenged, blue = logged.
                  </p>
                </div>
              </div>

              {/* Grouped stacked bar chart */}
              <div className="px-5 pt-5 pb-2">
                <ResponsiveContainer width="100%" height={Math.max(220, groupedData.length * 50 + 60)}>
                  <BarChart
                    data={groupedData}
                    layout="vertical"
                    margin={{ top: 0, right: 20, left: 120, bottom: 0 }}
                  >
                    <CartesianGrid strokeDasharray="3 3" horizontal={false} stroke="#E8E6E3" />
                    <XAxis
                      type="number"
                      tickFormatter={(v) => v >= 1e3 ? `${(v / 1e3).toFixed(0)}K` : String(v)}
                      tick={{ fontSize: 10, fill: "#78716C" }}
                      tickLine={false}
                      axisLine={false}
                    />
                    <YAxis
                      type="category"
                      dataKey="service"
                      tick={{ fontSize: 11, fill: "#1C1917", fontWeight: 600 }}
                      tickLine={false}
                      axisLine={false}
                      width={115}
                    />
                    <Tooltip
                      formatter={(v: number, name: string) => [formatNumber(v), name]}
                      contentStyle={{ borderRadius: "8px", border: "1px solid #E8E6E3", fontSize: "11px" }}
                    />
                    <Legend
                      iconType="circle"
                      iconSize={8}
                      wrapperStyle={{ fontSize: "11px", paddingTop: "8px" }}
                    />
                    {usedActions.map((action) => (
                      <Bar
                        key={action}
                        dataKey={action}
                        name={action.replace("_", " ")}
                        stackId="a"
                        fill={ACTION_COLORS[action] ?? "#9CA3AF"}
                        radius={action === usedActions[usedActions.length - 1] ? [0, 4, 4, 0] : undefined}
                      />
                    ))}
                  </BarChart>
                </ResponsiveContainer>
              </div>

              {/* Summary total per service */}
              <div className="px-5 pb-4">
                <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-2 mt-2">
                  {groupedData.map((row) => (
                    <div key={row.srcKey} className="rounded-lg bg-cf-gray-50 border border-cf-gray-100 px-3 py-2">
                      <div className="flex items-center gap-1.5 mb-0.5">
                        <span className="w-2 h-2 rounded-full flex-shrink-0"
                          style={{ backgroundColor: SOURCE_COLOR[row.srcKey] ?? "#9CA3AF" }} />
                        <p className="text-[10px] font-semibold text-cf-gray-600 truncate">{row.service}</p>
                      </div>
                      <p className="text-sm font-bold text-cf-navy">{formatNumber(row.total)}</p>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          );
        })()}

        {/* ── 4. Page Shield — Client-Side Script Inventory ───────────────── */}
        {(pageShieldEnabled || pageShieldScripts.length > 0) && (
          <div className="bg-white rounded-xl shadow-sm border border-cf-gray-200 overflow-hidden">
            <div className="px-5 py-4 border-b border-cf-gray-100 flex items-center gap-3">
              <div className="w-8 h-8 bg-purple-50 rounded-lg flex items-center justify-center">
                <Code2 size={16} className="text-purple-600" />
              </div>
              <div className="flex-1">
                <h3 className="text-sm font-semibold text-cf-navy">Page Shield — Client-Side Script Inventory</h3>
                <p className="text-xs text-cf-gray-500 mt-0.5">
                  Third-party JavaScript detected loading on your pages. Malicious scripts can exfiltrate customer data (Magecart, cryptomining, etc.).
                </p>
              </div>
              <div className={`px-3 py-1.5 rounded-full text-[10px] font-semibold border ${pageShieldEnabled ? "bg-green-50 text-green-700 border-green-200" : "bg-gray-50 text-gray-600 border-gray-200"}`}>
                {pageShieldEnabled ? "Active" : "Inactive"}
              </div>
            </div>
            {pageShieldScripts.length > 0 ? (
              <div className="p-5">
                {/* KPI row */}
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-4">
                  <div className="rounded-lg border border-cf-gray-200 p-3">
                    <p className="text-xs text-cf-gray-500">Total Scripts</p>
                    <p className="text-2xl font-bold text-cf-navy">{pageShieldScripts.length}</p>
                  </div>
                  <div className="rounded-lg border border-cf-gray-200 p-3">
                    <p className="text-xs text-cf-gray-500">Active Scripts</p>
                    <p className="text-2xl font-bold text-blue-600">{activeScripts.length}</p>
                  </div>
                  <div className="rounded-lg border border-cf-gray-200 p-3">
                    <p className="text-xs text-cf-gray-500">Unique Domains</p>
                    <p className="text-2xl font-bold text-cf-navy">{uniqueHosts}</p>
                  </div>
                  <div className={`rounded-lg border p-3 ${maliciousScripts.length > 0 ? "bg-red-50 border-red-200" : "border-cf-gray-200"}`}>
                    <p className={`text-xs ${maliciousScripts.length > 0 ? "text-red-600" : "text-cf-gray-500"}`}>Flagged Scripts</p>
                    <p className={`text-2xl font-bold ${maliciousScripts.length > 0 ? "text-red-700" : "text-green-600"}`}>
                      {maliciousScripts.length}
                    </p>
                  </div>
                </div>

                {maliciousScripts.length > 0 && (
                  <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-lg flex items-start gap-2">
                    <AlertTriangle size={14} className="text-red-600 flex-shrink-0 mt-0.5" />
                    <p className="text-xs text-red-700">
                      <strong>{maliciousScripts.length} script{maliciousScripts.length !== 1 ? "s" : ""} flagged</strong> with low integrity or malware scores.
                      Review these in the Page Shield dashboard and consider adding them to a Content Security Policy.
                    </p>
                  </div>
                )}

                <div className="overflow-y-auto" style={{ maxHeight: 360 }}>
                <table className="w-full text-xs">
                  <thead className="sticky top-0">
                    <tr className="bg-cf-gray-50 text-cf-gray-500 uppercase tracking-wide text-[10px]">
                      <th className="px-4 py-2 text-left font-semibold">Script URL</th>
                      <th className="px-4 py-2 text-left font-semibold">Status</th>
                      <th className="px-4 py-2 text-right font-semibold">Integrity Score</th>
                      <th className="px-4 py-2 text-right font-semibold">First Seen</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-cf-gray-100">
                    {pageShieldScripts.slice(0, 20).map((s, i) => {
                      const score = s.js_integrity_score ?? 100;
                      const isMalicious = score < 30;
                      return (
                        <tr key={s.id} className={i % 2 === 0 ? "bg-white" : "bg-cf-gray-50/40"}>
                          <td className="px-4 py-2">
                            <div className="font-mono text-[10px] truncate max-w-[280px] text-cf-navy" title={s.url}>
                              {s.url}
                            </div>
                            <div className="text-[10px] text-cf-gray-400">{s.host}</div>
                          </td>
                          <td className="px-4 py-2">
                            <span className={`inline-block px-2 py-0.5 rounded-full text-[10px] font-semibold ${s.status === "active" ? "bg-green-50 text-green-700" : "bg-gray-50 text-gray-600"}`}>
                              {s.status}
                            </span>
                          </td>
                          <td className="px-4 py-2 text-right">
                            <span className={`font-mono font-bold text-xs ${isMalicious ? "text-red-700" : "text-green-700"}`}>
                              {score === 100 ? "—" : score}
                            </span>
                          </td>
                          <td className="px-4 py-2 text-right text-cf-gray-400 text-[10px]">
                            {s.first_seen_at ? new Date(s.first_seen_at).toLocaleDateString() : "—"}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
                </div>
              </div>
            ) : (
              <div className="p-6 text-center">
                <p className="text-sm text-cf-gray-500">Page Shield is {pageShieldEnabled ? "enabled but no scripts detected yet" : "not enabled on this zone"}.</p>
                {!pageShieldEnabled && (
                  <p className="text-xs text-cf-gray-400 mt-1">Enable Page Shield to monitor and protect against malicious third-party scripts.</p>
                )}
              </div>
            )}
          </div>
        )}
      </div>
    </section>
  );
}
