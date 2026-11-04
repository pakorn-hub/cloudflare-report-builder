/**
 * ThreatIntelSection — Security Intelligence
 * Shows:
 *   1. Top Source IPs (all traffic, matches CF dashboard "Source IPs" widget)
 *   2. Top Threat IPs (blocked/challenged only, deduped by IP, no skip)
 *   3. Top Threat ASNs
 *   4. Suspicious User Agents
 */
import { Shield, AlertTriangle, Search, Globe } from "lucide-react";
import type { AppSecData } from "../../types";
import { formatNumber } from "../../utils/formatters";
import SectionHeader from "../../components/SectionHeader";
import HorizontalBarChart from "../../components/charts/HorizontalBarChart";
import ParallelCoordinates from "../../components/charts/ParallelCoordinates";

interface Props {
  data: AppSecData;
}

// Only blocking/challenging actions are "threats" — skip is Cloudflare infrastructure
const BLOCKING_ACTIONS = new Set(["block", "challenge", "managed_challenge", "jschallenge", "drop"]);

const ACTION_COLORS: Record<string, string> = {
  block:              "#EF4444",
  challenge:          "#F59E0B",
  managed_challenge:  "#F97316",
  jschallenge:        "#FBBF24",
  drop:               "#DC2626",
  log:                "#3B82F6",
  skip:               "#9CA3AF",
};

const CATEGORY_COLORS: Record<string, string> = {
  scanner: "#EF4444",
  bot:     "#F59E0B",
  browser: "#10B981",
  unknown: "#9CA3AF",
};

const CATEGORY_ICONS: Record<string, string> = {
  scanner: "⚠️",
  bot:     "🤖",
  browser: "🌐",
  unknown: "❓",
};

export default function ThreatIntelSection({ data }: Props) {
  const rawThreatIps = data.topThreatIps  ?? [];
  const threatAsns   = data.topThreatAsns ?? [];
  const userAgents   = data.topUserAgents ?? [];
  const topClientIps = (data as unknown as Record<string, unknown>)["topClientIps"] as
    Array<{ ip: string; requests: number; bytes: number }> | undefined ?? [];

  // ── Deduplicate threat IPs ─────────────────────────────────────────────────
  // firewallEventsAdaptiveGroups can return the same IP multiple times with
  // different countries (geolocation varies per CDN PoP) or different actions.
  // Merge: keep the most severe action, sum counts, drop skip-only IPs.
  const ACTION_SEVERITY: Record<string, number> = {
    block: 5, drop: 4, managed_challenge: 3, jschallenge: 2, challenge: 2, log: 1, skip: 0,
  };

  const merged = new Map<string, { ip: string; country: string; action: string; count: number }>();
  for (const ip of rawThreatIps) {
    if (!BLOCKING_ACTIONS.has(ip.action)) continue; // drop skip/log rows
    const existing = merged.get(ip.ip);
    if (!existing) {
      merged.set(ip.ip, { ip: ip.ip, country: ip.country, action: ip.action, count: ip.count });
    } else {
      existing.count += ip.count;
      // Upgrade to more severe action if needed
      if ((ACTION_SEVERITY[ip.action] ?? 0) > (ACTION_SEVERITY[existing.action] ?? 0)) {
        existing.action  = ip.action;
        existing.country = ip.country;
      }
    }
  }
  const threatIps = Array.from(merged.values())
    .sort((a, b) => b.count - a.count)
    .slice(0, 20);

  const asnBarData = threatAsns.map((a) => ({
    name:  `AS${a.asn} ${a.asnName}`,
    value: a.count,
    color: "#EF4444",
  }));

  const hasData = threatIps.length > 0 || threatAsns.length > 0 || userAgents.length > 0 || topClientIps.length > 0;

  // Parallel coordinates — top 10 threat IPs
  const ACTION_COLOR_MAP: Record<string, string> = {
    block: "#EF4444", managed_challenge: "#F97316",
    challenge: "#EAB308", log: "#3B82F6", skip: "#9CA3AF",
  };
  const pcRows = threatIps.slice(0, 10).map((ip) => ({
    id:    ip.ip,
    label: ip.ip,
    color: ACTION_COLOR_MAP[ip.action] ?? "#9CA3AF",
    values: {
      events:           ip.count,
      action_severity:  ACTION_SEVERITY[ip.action] ?? 0,
    },
  }));

  const pcDimensions = [
    { key: "events",          label: "Events",  log: true, format: (v: number) => v >= 1e3 ? `${(v/1e3).toFixed(0)}K` : String(v) },
    { key: "action_severity", label: "Severity",           format: (v: number) => ["—","Log","Chall","Mgd Ch","Drop","Block"][Math.round(v)] ?? "-" },
  ];

  return (
    <section className="report-section">
      <SectionHeader
        icon={<Shield size={20} />}
        title="Threat Intelligence"
        subtitle="Top source IPs, attacking networks, and suspicious user agents"
      />

      {!hasData ? (
        <div className="bg-white rounded-xl border border-cf-gray-200 p-8 text-center">
          <p className="text-cf-gray-400 text-sm">No threat intelligence data available.</p>
        </div>
      ) : (
        <div className="space-y-6">

          {/* ── 1 & 3. Source IPs + Threat IPs — side by side ──────────────── */}
          {/* Only split the OUTER grid into 2 columns when BOTH cards have
              data — otherwise the grid still reserves the empty column's
              width, leaving a large blank area beside a single half-width
              card. When "Top Source IPs" is shown alone, its own list is
              additionally split into internal sub-columns so the full width
              is used to show more rows at once, instead of one narrow
              3-column table stretched thin across the page. */}
          {(topClientIps.length > 0 || threatIps.length > 0) && (
            <div className={`grid grid-cols-1 gap-4 ${topClientIps.length > 0 && threatIps.length > 0 ? "lg:grid-cols-2" : ""}`}>

              {/* Top Source IPs — all eyeball traffic, matches CF dashboard */}
              {topClientIps.length > 0 && (() => {
                const solo = threatIps.length === 0;
                const rows = topClientIps.slice(0, solo ? 60 : 25);
                const cols = solo ? 3 : 1;
                const perCol = Math.ceil(rows.length / cols);
                const columns = Array.from({ length: cols }, (_, c) => rows.slice(c * perCol, (c + 1) * perCol));
                return (
                  <div className="bg-white rounded-xl shadow-sm border border-cf-gray-200 overflow-hidden flex flex-col">
                    <div className="px-4 py-3 border-b border-cf-gray-100 flex items-center gap-2">
                      <Globe size={13} className="text-blue-500 flex-shrink-0" />
                      <div>
                        <h3 className="text-sm font-semibold text-cf-navy">Top Source IPs</h3>
                        <p className="text-[10px] text-cf-gray-400 mt-0.5">All eyeball traffic · matches CF dashboard</p>
                      </div>
                    </div>
                    <div className={`overflow-y-auto ${solo ? "grid grid-cols-3 divide-x divide-cf-gray-100" : ""}`} style={{ maxHeight: 440 }}>
                      {columns.map((colRows, c) => (
                        <table key={c} className="w-full text-xs">
                          <thead className="sticky top-0">
                            <tr className="bg-cf-gray-50 text-cf-gray-500 uppercase tracking-wide text-[10px]">
                              <th className="px-3 py-2 text-left font-semibold w-8">#</th>
                              <th className="px-3 py-2 text-left font-semibold">IP Address</th>
                              <th className="px-3 py-2 text-right font-semibold">Requests</th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-cf-gray-100">
                            {colRows.map((ip, i) => (
                              <tr key={ip.ip} className={i % 2 === 0 ? "bg-white" : "bg-cf-gray-50/40"}>
                                <td className="px-3 py-1.5 text-cf-gray-400 font-mono text-[11px]">{c * perCol + i + 1}</td>
                                <td className="px-3 py-1.5 font-mono font-medium text-cf-navy text-[11px]">{ip.ip}</td>
                                <td className="px-3 py-1.5 text-right font-mono font-bold text-blue-600 text-[11px]">
                                  {formatNumber(ip.requests)}
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      ))}
                    </div>
                  </div>
                );
              })()}

              {/* Top Threat Source IPs — blocked/challenged only, deduped */}
              {threatIps.length > 0 && (
                <div className="bg-white rounded-xl shadow-sm border border-cf-gray-200 overflow-hidden flex flex-col">
                  <div className="px-4 py-3 border-b border-cf-gray-100 flex items-center gap-2">
                    <AlertTriangle size={13} className="text-red-500 flex-shrink-0" />
                    <div>
                      <h3 className="text-sm font-semibold text-cf-navy">Top Threat Source IPs</h3>
                      <p className="text-[10px] text-cf-gray-400 mt-0.5">Blocked / challenged · skip excluded · merged per IP</p>
                    </div>
                  </div>
                  <div className="overflow-y-auto" style={{ maxHeight: 440 }}>
                    <table className="w-full text-xs">
                      <thead className="sticky top-0">
                        <tr className="bg-cf-gray-50 text-cf-gray-500 uppercase tracking-wide text-[10px]">
                          <th className="px-3 py-2 text-left font-semibold w-8">#</th>
                          <th className="px-3 py-2 text-left font-semibold">IP Address</th>
                          <th className="px-3 py-2 text-left font-semibold">CC</th>
                          <th className="px-3 py-2 text-left font-semibold">Action</th>
                          <th className="px-3 py-2 text-right font-semibold">Events</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-cf-gray-100">
                        {threatIps.map((ip, i) => (
                          <tr key={ip.ip} className={i % 2 === 0 ? "bg-white" : "bg-cf-gray-50/40"}>
                            <td className="px-3 py-1.5 text-cf-gray-400 font-mono text-[11px]">{i + 1}</td>
                            <td className="px-3 py-1.5 font-mono font-medium text-cf-navy text-[11px]">{ip.ip}</td>
                            <td className="px-3 py-1.5 text-cf-gray-500 text-[11px]">{ip.country || "—"}</td>
                            <td className="px-3 py-1.5">
                              <span
                                className="inline-block px-1.5 py-0.5 rounded-full text-[10px] font-semibold text-white"
                                style={{ backgroundColor: ACTION_COLORS[ip.action] ?? "#9CA3AF" }}
                              >
                                {ip.action.replace(/_/g, " ")}
                              </span>
                            </td>
                            <td className="px-3 py-1.5 text-right font-mono font-bold text-red-600 text-[11px]">
                              {formatNumber(ip.count)}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* ── 2. Parallel Coordinates — threat IP fingerprinting ──────────── */}
          {pcRows.length >= 2 && (
            <ParallelCoordinates
              title="Threat IP Profile"
              subtitle="Each line = one threat IP. Axes show event volume and action severity. Hover to inspect."
              dimensions={pcDimensions}
              rows={pcRows}
              height={280}
            />
          )}

          {/* ── 4. Top Threat ASNs ──────────────────────────────────────────── */}
          {asnBarData.length > 0 && (
            <HorizontalBarChart
              data={asnBarData}
              title="Top Threat Source Networks (ASNs)"
              subtitle="Autonomous systems generating the most blocked/challenged requests"
              color="#EF4444"
              height={Math.max(200, asnBarData.length * 34 + 60)}
              maxLabelLength={40}
            />
          )}

          {/* ── 5. Suspicious User Agents ───────────────────────────────────── */}
          {userAgents.length > 0 && (
            <div className="bg-white rounded-xl shadow-sm border border-cf-gray-200 overflow-hidden">
              <div className="px-5 py-4 border-b border-cf-gray-100 flex items-center gap-2">
                <Search size={14} className="text-cf-orange" />
                <div>
                  <h3 className="text-sm font-semibold text-cf-navy">Suspicious User Agents</h3>
                  <p className="text-xs text-cf-gray-500 mt-0.5">
                    Top user agents in blocked/challenged requests — classified by type
                  </p>
                </div>
              </div>
              <table className="w-full text-xs">
                <thead>
                  <tr className="bg-cf-gray-50 text-cf-gray-500 uppercase tracking-wide text-[10px]">
                    <th className="px-4 py-2.5 text-left font-semibold">#</th>
                    <th className="px-4 py-2.5 text-left font-semibold">Type</th>
                    <th className="px-4 py-2.5 text-left font-semibold">User Agent</th>
                    <th className="px-4 py-2.5 text-right font-semibold">Events</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-cf-gray-100">
                  {userAgents.map((ua, i) => (
                    <tr key={i} className={i % 2 === 0 ? "bg-white" : "bg-cf-gray-50/40"}>
                      <td className="px-4 py-2 text-cf-gray-400 font-mono">{i + 1}</td>
                      <td className="px-4 py-2">
                        <span
                          className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold"
                          style={{
                            backgroundColor: `${CATEGORY_COLORS[ua.category]}20`,
                            color: CATEGORY_COLORS[ua.category],
                          }}
                        >
                          {CATEGORY_ICONS[ua.category]} {ua.category}
                        </span>
                      </td>
                      <td className="px-4 py-2 font-mono text-cf-gray-600 max-w-[360px] truncate" title={ua.userAgent}>
                        {ua.userAgent}
                      </td>
                      <td className="px-4 py-2 text-right font-mono font-bold text-cf-navy">
                        {formatNumber(ua.count)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

        </div>
      )}
    </section>
  );
}
