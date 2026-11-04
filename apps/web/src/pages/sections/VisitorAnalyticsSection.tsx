/**
 * VisitorAnalyticsSection — Web Analytics Breakdown
 * Shows:
 *   - Bubble Matrix: device × browser (rows = devices, cols = browsers, bubble = volume)
 *   - HTTP Method distribution
 *   - HTTP Response Status summary
 *   - Browser + Device detail tables
 */
import { Monitor, BarChart2, Info } from "lucide-react";
import type { AppSecData } from "../../types";
import { formatNumber } from "../../utils/formatters";
import SectionHeader from "../../components/SectionHeader";
import HorizontalBarChart from "../../components/charts/HorizontalBarChart";

interface Props { data: AppSecData }

const STATUS_COLORS = {
  e2xx: "#16A34A", e3xx: "#3B82F6",
  e4xx: "#EF4444", e5xx: "#DC2626", e1xx: "#93C5FD",
};

const METHOD_COLORS = ["#F6821F","#3B82F6","#16A34A","#EF4444","#8B5CF6","#F59E0B","#9CA3AF"];

const DEVICE_COLORS: Record<string, string> = {
  desktop: "#F6821F",
  mobile:  "#3B82F6",
  tablet:  "#16A34A",
  unknown: "#9CA3AF",
};

const BROWSER_COLORS: Record<string, string> = {
  Chrome:   "#F6821F",
  Firefox:  "#FF6633",
  Safari:   "#3B82F6",
  Edge:     "#00B0D1",
  "Samsung Internet": "#8B5CF6",
  Opera:    "#EF4444",
  Other:    "#D1D5DB",
};

function StatusBadge({ label, value, color }: { label: string; value: number; color: string }) {
  return (
    <div className="flex flex-col items-center p-4 rounded-lg border border-cf-gray-100 bg-white flex-1 min-w-[80px]">
      <span className="text-lg font-bold" style={{ color }}>{value > 0 ? formatNumber(value) : "0"}</span>
      <span className="text-[10px] text-cf-gray-500 mt-0.5 font-medium text-center">{label}</span>
    </div>
  );
}

/** Bubble matrix: rows = devices, cols = browsers, bubble size = request share */
function BubbleMatrix({
  devices, browsers,
}: {
  devices: { clientDeviceType: string; requests: number; pct: number }[];
  browsers: { uaBrowserFamily: string; requests: number; pct: number }[];
}) {
  if (!devices.length || !browsers.length) return null;

  const totalBrowserReqs = browsers.reduce((s, b) => s + b.requests, 0);
  const totalDeviceReqs  = devices.reduce((s, d) => s + d.requests, 0);

  const COL_W = 80;
  const ROW_H = 64;
  const LABEL_W = 100;
  const LABEL_H = 40;
  const MAX_R = 24;

  const svgW = LABEL_W + browsers.length * COL_W + 16;
  const svgH = LABEL_H + devices.length * ROW_H + 8;

  return (
    <div className="bg-white rounded-xl shadow-sm border border-cf-gray-200 p-5 overflow-x-auto">
      <h3 className="text-sm font-semibold text-cf-navy mb-1">Browser × Device Traffic Matrix</h3>
      <p className="text-xs text-cf-gray-500 mb-4">
        Bubble size = estimated traffic share. Rows = device type, columns = browser.
      </p>
      <svg width={svgW} height={svgH} style={{ overflow: "visible" }}>
        {/* Column headers (browsers) */}
        {browsers.map((b, ci) => {
          const cx = LABEL_W + ci * COL_W + COL_W / 2;
          const color = BROWSER_COLORS[b.uaBrowserFamily] ?? "#9CA3AF";
          return (
            <g key={b.uaBrowserFamily}>
              <text
                x={cx} y={LABEL_H - 8}
                textAnchor="middle"
                style={{ fontSize: 10, fontWeight: 700, fill: color, fontFamily: "Inter, system-ui, sans-serif" }}
              >
                {b.uaBrowserFamily.length > 8 ? b.uaBrowserFamily.slice(0, 7) + "…" : b.uaBrowserFamily}
              </text>
              <text
                x={cx} y={LABEL_H - 22}
                textAnchor="middle"
                style={{ fontSize: 11, fill: "#A8A29E", fontFamily: "Inter, system-ui, sans-serif" }}
              >
                {b.pct}%
              </text>
            </g>
          );
        })}

        {/* Row headers (devices) + bubbles */}
        {devices.map((d, ri) => {
          const cy = LABEL_H + ri * ROW_H + ROW_H / 2;
          const devName = d.clientDeviceType.charAt(0).toUpperCase() + d.clientDeviceType.slice(1);
          const devColor = DEVICE_COLORS[d.clientDeviceType.toLowerCase()] ?? "#9CA3AF";
          const devShare = totalDeviceReqs > 0 ? d.requests / totalDeviceReqs : 0;

          return (
            <g key={d.clientDeviceType}>
              {/* Row background stripe */}
              <rect
                x={LABEL_W - 4}
                y={cy - ROW_H / 2 + 2}
                width={browsers.length * COL_W + 8}
                height={ROW_H - 4}
                fill={ri % 2 === 0 ? "#FAFAF9" : "white"}
                rx={4}
              />

              {/* Device label */}
              <text x={LABEL_W - 10} y={cy - 6} textAnchor="end"
                style={{ fontSize: 11, fontWeight: 700, fill: devColor, fontFamily: "Inter, system-ui, sans-serif" }}>
                {devName}
              </text>
              <text x={LABEL_W - 10} y={cy + 8} textAnchor="end"
                style={{ fontSize: 11, fill: "#A8A29E", fontFamily: "Inter, system-ui, sans-serif" }}>
                {d.pct}%
              </text>

              {/* Bubbles */}
              {browsers.map((b, ci) => {
                const bx = LABEL_W + ci * COL_W + COL_W / 2;
                const brShare = totalBrowserReqs > 0 ? b.requests / totalBrowserReqs : 0;
                // Bubble size = geometric mean of device × browser share
                const combined = Math.sqrt(devShare * brShare);
                const r = Math.max(3, combined * MAX_R * 8);
                const clampedR = Math.min(r, MAX_R);
                const opacity = 0.25 + combined * 8;
                const bColor = DEVICE_COLORS[d.clientDeviceType.toLowerCase()] ?? "#F6821F";

                return (
                  <g key={b.uaBrowserFamily}>
                    <title>{`${devName} + ${b.uaBrowserFamily}: ~${(combined * 100).toFixed(1)}% combined`}</title>
                    <circle
                      cx={bx} cy={cy}
                      r={clampedR}
                      fill={bColor}
                      fillOpacity={Math.min(opacity, 0.85)}
                      stroke={bColor}
                      strokeOpacity={0.3}
                      strokeWidth={1}
                    />
                    {clampedR >= 14 && (
                      <text x={bx} y={cy} textAnchor="middle" dominantBaseline="middle"
                        style={{ fontSize: 11, fill: "white", fontWeight: 700, fontFamily: "Inter, system-ui, sans-serif", pointerEvents: "none" }}>
                        {(combined * 100).toFixed(0)}%
                      </text>
                    )}
                  </g>
                );
              })}
            </g>
          );
        })}
      </svg>

      {/* Legend */}
      <div className="flex flex-wrap gap-3 mt-3 pt-3 border-t border-cf-gray-100">
        {devices.map((d) => {
          const devName = d.clientDeviceType.charAt(0).toUpperCase() + d.clientDeviceType.slice(1);
          return (
            <span key={d.clientDeviceType} className="flex items-center gap-1.5 text-[10px] text-cf-gray-600">
              <span className="w-2.5 h-2.5 rounded-full"
                style={{ backgroundColor: DEVICE_COLORS[d.clientDeviceType.toLowerCase()] ?? "#9CA3AF" }} />
              {devName} ({d.pct}%)
            </span>
          );
        })}
      </div>
    </div>
  );
}

export default function VisitorAnalyticsSection({ data }: Props) {
  const browsers = data.browserBreakdown ?? [];
  const devices  = data.deviceBreakdown ?? [];
  const methods  = data.httpMethodBreakdown ?? [];
  const status   = data.httpStatusSummary;

  const methodBarData = methods.map((m, i) => ({
    name: m.method, value: m.requests,
    color: METHOD_COLORS[i % METHOD_COLORS.length],
  }));

  const hasData = browsers.length > 0 || devices.length > 0 || methods.length > 0 || status;

  return (
    <section className="report-section">
      <SectionHeader
        icon={<Monitor size={20} />}
        title="Visitor Analytics"
        subtitle="Browser × device distribution, HTTP methods, and response status — sourced from Cloudflare zone analytics"
      />

      {!hasData ? (
        <div className="bg-white rounded-xl border border-cf-gray-200 p-8 text-center">
          <p className="text-cf-gray-400 text-sm">No visitor analytics data available.</p>
        </div>
      ) : (
        <div className="space-y-6">
          {/* HTTP Status Summary */}
          {status && (
            <div className="bg-white rounded-xl shadow-sm border border-cf-gray-200 p-5">
              <h3 className="text-sm font-semibold text-cf-navy flex items-center gap-2 mb-1">
                <BarChart2 size={14} className="text-cf-orange" />
                HTTP Response Status
              </h3>
              <p className="text-xs text-cf-gray-400 mb-4">Green = success · Blue = redirect · Red = error</p>
              <div className="flex gap-3 flex-wrap">
                <StatusBadge label="2xx Success"    value={status.e2xx}         color={STATUS_COLORS.e2xx} />
                <StatusBadge label="3xx Redirect"   value={status.e3xx}         color={STATUS_COLORS.e3xx} />
                <StatusBadge label="4xx Client Err" value={status.e4xx}         color={STATUS_COLORS.e4xx} />
                <StatusBadge label="5xx Server Err" value={status.e5xx}         color={STATUS_COLORS.e5xx} />
                {(status.e1xx ?? 0) > 0 && (
                  <StatusBadge label="1xx Info" value={status.e1xx ?? 0} color={STATUS_COLORS.e1xx} />
                )}
              </div>
            </div>
          )}

          {/* Data accuracy note */}
          <div className="flex items-start gap-2 p-3 bg-blue-50 border border-blue-200 rounded-lg">
            <Info size={12} className="text-blue-500 flex-shrink-0 mt-0.5" />
            <p className="text-[10px] text-blue-700 leading-relaxed">
              <strong>Data notes:</strong> Browser distribution uses page views (not total requests) from <code className="font-mono">browserMap</code>.
              Device types are sampled estimates from adaptive groups — minor variance vs dashboard expected.
              Total request counts, country distribution, and edge status codes use exact non-sampled data from <code className="font-mono">httpRequests1dGroups</code>.
            </p>
          </div>

          {/* Bubble Matrix — replaces chord diagram */}
          {browsers.length > 0 && devices.length > 0 && (
            <BubbleMatrix devices={devices} browsers={browsers.slice(0, 6)} />
          )}

          {/* HTTP Method bar */}
          {methodBarData.length > 0 && (
            <HorizontalBarChart
              data={methodBarData}
              title="HTTP Method Distribution"
              subtitle="Request volume by HTTP verb"
              height={Math.max(180, methodBarData.length * 38 + 60)}
            />
          )}

          {/* Top Requested Hostnames — from HTTP request counts */}
          {(() => {
            // Use HTTP request data (always available) not DNS query counts
            const httpHostnames = data.topHttpHostnames ?? [];
            if (!httpHostnames.length) return null;

            const ranked = httpHostnames
              .slice(0, 20)
              .map((h) => [h.hostname, h.requests] as [string, number]);

            // Use actual total from httpRequests1dGroups (exact) not sum of sampled hostname counts
            const totalFromSummary = data.summary?.totalRequests ?? 0;
            const sampledSum = ranked.reduce((s, [, c]) => s + c, 0);
            // Show the authoritative total; use sampled sum only for % within hostnames
            const total = sampledSum;
            const zoneName = data.meta?.zoneName ?? "";

            return (
              <div className="bg-white rounded-xl shadow-sm border border-cf-gray-200 overflow-hidden">
                <div className="px-5 py-4 border-b border-cf-gray-100 flex items-center justify-between">
                  <div>
                    <h3 className="text-sm font-semibold text-cf-navy">Top Requested Hostnames</h3>
                    <p className="text-xs text-cf-gray-500 mt-0.5">
                      Most requested hostnames during the {data.meta?.periodLabel ?? "30-Day"} period — Cloudflare-proxied traffic only
                    </p>
                    <p className="text-[10px] text-cf-gray-400 mt-0.5">
                      Total zone requests: <span className="font-semibold text-cf-navy">{formatNumber(totalFromSummary)}</span> · Shown below: sampled relative counts (for ranking only)
                    </p>
                  </div>
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full text-xs">
                    <thead>
                      <tr className="bg-cf-gray-50 text-cf-gray-500 uppercase tracking-wide text-[10px]">
                        <th className="px-4 py-2.5 text-left font-semibold w-8">#</th>
                        <th className="px-4 py-2.5 text-left font-semibold">Hostname</th>
                        <th className="px-4 py-2.5 text-right font-semibold">Requests (sampled)</th>
                        <th className="px-4 py-2.5 text-right font-semibold">% of list</th>
                        <th className="px-4 py-2.5 text-left font-semibold pl-4">Distribution</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-cf-gray-100">
                      {ranked.map(([hostname, count], i) => {
                        // % relative to other hostnames in the sampled list (not zone total)
                        const pct = sampledSum > 0
                            ? ((count / sampledSum) * 100).toFixed(1)
                            : "0";
                        const isApex = hostname === zoneName || hostname === `${zoneName}.`;
                        const isSubdomain = !isApex && hostname.endsWith(`.${zoneName}`);
                        const isCf = hostname.includes("cloudflare") || hostname.includes(".pages.dev") || hostname.includes(".workers.dev");
                        const badge = isApex ? "apex" : isCf ? "cloudflare" : isSubdomain ? "subdomain" : "external";
                        const BADGE_STYLE: Record<string, string> = {
                          apex:       "bg-cf-orange/10 text-cf-orange border-cf-orange/20",
                          subdomain:  "bg-blue-50 text-blue-600 border-blue-200",
                          cloudflare: "bg-orange-50 text-orange-600 border-orange-200",
                          external:   "bg-cf-gray-100 text-cf-gray-500 border-cf-gray-200",
                        };

                        return (
                          <tr key={hostname} className={i % 2 === 0 ? "bg-white" : "bg-cf-gray-50/40"}>
                            <td className="px-4 py-2 text-cf-gray-400 font-mono">{i + 1}</td>
                            <td className="px-4 py-2">
                              <div className="flex items-center gap-2">
                                <span className="font-mono text-cf-navy">{hostname}</span>
                                <span className={`inline-block px-1.5 py-0.5 rounded text-[10px] font-semibold border ${BADGE_STYLE[badge]}`}>
                                  {badge}
                                </span>
                              </div>
                            </td>
                            <td className="px-4 py-2 text-right font-mono font-semibold text-cf-navy">
                              {formatNumber(count)}
                            </td>
                            <td className="px-4 py-2 text-right text-cf-gray-600 font-semibold">
                              {pct}%
                            </td>
                            <td className="px-4 py-2 pl-4">
                              <div className="w-32 bg-cf-gray-100 rounded-full h-1.5 overflow-hidden">
                                <div
                                  className="h-full bg-cf-orange rounded-full"
                                  style={{ width: `${Math.min(parseFloat(pct) * 4, 100)}%` }}
                                />
                              </div>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </div>
            );
          })()}

          {/* Browser + Device detail tables side by side */}
          {(browsers.length > 0 || devices.length > 0) && (
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
              {browsers.length > 0 && (
                <div className="bg-white rounded-xl shadow-sm border border-cf-gray-200 overflow-hidden">
                  <div className="px-5 py-3 border-b border-cf-gray-100">
                    <h3 className="text-sm font-semibold text-cf-navy">Browser Details</h3>
                  </div>
                  <table className="w-full text-xs">
                    <thead>
                      <tr className="bg-cf-gray-50 text-cf-gray-500 uppercase tracking-wide text-[10px]">
                        <th className="px-4 py-2.5 text-left font-semibold">Browser</th>
                        <th className="px-4 py-2.5 text-right font-semibold">Requests</th>
                        <th className="px-4 py-2.5 text-right font-semibold">Share</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-cf-gray-100">
                      {browsers.map((b, i) => (
                        <tr key={b.uaBrowserFamily} className={i % 2 === 0 ? "bg-white" : "bg-cf-gray-50/40"}>
                          <td className="px-4 py-2 font-medium text-cf-navy flex items-center gap-2">
                            <span className="w-2 h-2 rounded-full flex-shrink-0"
                              style={{ backgroundColor: BROWSER_COLORS[b.uaBrowserFamily] ?? "#9CA3AF" }} />
                            {b.uaBrowserFamily}
                          </td>
                          <td className="px-4 py-2 text-right font-mono text-cf-gray-700">{formatNumber(b.requests)}</td>
                          <td className="px-4 py-2 text-right">
                            <div className="flex items-center justify-end gap-2">
                              <div className="w-14 bg-cf-gray-100 rounded-full h-1.5 overflow-hidden">
                                <div className="h-full bg-blue-500 rounded-full" style={{ width: `${b.pct}%` }} />
                              </div>
                              <span className="text-cf-gray-600 w-8 text-right">{b.pct}%</span>
                            </div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}

              {devices.length > 0 && (
                <div className="bg-white rounded-xl shadow-sm border border-cf-gray-200 overflow-hidden">
                  <div className="px-5 py-3 border-b border-cf-gray-100">
                    <h3 className="text-sm font-semibold text-cf-navy">Device Type Details</h3>
                  </div>
                  <table className="w-full text-xs">
                    <thead>
                      <tr className="bg-cf-gray-50 text-cf-gray-500 uppercase tracking-wide text-[10px]">
                        <th className="px-4 py-2.5 text-left font-semibold">Device</th>
                        <th className="px-4 py-2.5 text-right font-semibold">Requests</th>
                        <th className="px-4 py-2.5 text-right font-semibold">Share</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-cf-gray-100">
                      {devices.map((d, i) => (
                        <tr key={d.clientDeviceType} className={i % 2 === 0 ? "bg-white" : "bg-cf-gray-50/40"}>
                          <td className="px-4 py-2 font-medium text-cf-navy flex items-center gap-2 capitalize">
                            <span className="w-2 h-2 rounded-full flex-shrink-0"
                              style={{ backgroundColor: DEVICE_COLORS[d.clientDeviceType.toLowerCase()] ?? "#9CA3AF" }} />
                            {d.clientDeviceType}
                          </td>
                          <td className="px-4 py-2 text-right font-mono text-cf-gray-700">{formatNumber(d.requests)}</td>
                          <td className="px-4 py-2 text-right font-semibold text-cf-gray-700">{d.pct}%</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </section>
  );
}
