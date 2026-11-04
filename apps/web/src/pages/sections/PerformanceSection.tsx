/**
 * PerformanceSection — Performance Metrics
 * Shows: TTFB percentile time-series (p50/p75/p99) + top edge data center distribution.
 */
import { Zap, Server } from "lucide-react";
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid,
  Tooltip, Legend, ResponsiveContainer,
} from "recharts";
import { format, parseISO } from "date-fns";
import type { AppSecData } from "../../types";
import { formatNumber, formatBytes } from "../../utils/formatters";
import SectionHeader from "../../components/SectionHeader";
import HorizontalBarChart from "../../components/charts/HorizontalBarChart";

interface Props {
  data: AppSecData;
}

function TtfbTooltip({ active, payload, label }: {
  active?: boolean;
  payload?: { name: string; value: number; color: string }[];
  label?: string;
}) {
  if (!active || !payload?.length) return null;
  return (
    <div className="bg-white border border-cf-orange rounded-lg shadow-lg p-3">
      <p className="text-xs font-semibold text-cf-gray-600 mb-1">{label}</p>
      {payload.map((p) => (
        <div key={p.name} className="flex items-center gap-2">
          <span className="w-2 h-2 rounded-full inline-block" style={{ backgroundColor: p.color }} />
          <span className="text-xs text-cf-gray-600">{p.name}:</span>
          <span className="text-xs font-bold text-cf-navy">{p.value}ms</span>
        </div>
      ))}
    </div>
  );
}

export default function PerformanceSection({ data }: Props) {
  const ttfb = data.ttfbTimeSeries ?? [];
  const colos = data.edgeColoDistribution ?? [];

  const ttfbChartData = ttfb.map((d) => ({
    date: format(parseISO(d.date), "MMM d"),
    avg: d.avg,
  }));

  const coloBarData = colos.map((c) => ({
    name: c.coloCode,
    value: c.bytes,   // sort by bytes (more reliable than sampled request count)
  }));

  // Overall avg TTFB across the period
  const overallAvg = ttfb.length > 0 ? Math.round(ttfb.reduce((s, d) => s + d.avg, 0) / ttfb.length) : 0;

  const hasData = ttfb.length > 0 || colos.length > 0;

  return (
    <section className="report-section">
      <SectionHeader
        icon={<Zap size={20} />}
        title="Performance Metrics"
        subtitle="Average Edge Time To First Byte (TTFB) trend and Cloudflare PoP distribution"
      />

      {!hasData ? (
        <div className="bg-white rounded-xl border border-cf-gray-200 p-8 text-center">
          <p className="text-cf-gray-400 text-sm">No performance data available for this zone.</p>
        </div>
      ) : (
        <div className="space-y-6">
          {/* TTFB KPI cards */}
          {ttfb.length > 0 && (
            <>
               <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                {[
                  { label: "Avg TTFB (30d)", value: `${overallAvg}ms`, desc: "Average edge response", good: overallAvg < 200 },
                  { label: "Best Day", value: `${Math.min(...ttfb.map(d => d.avg))}ms`, desc: "Lowest daily avg", good: true },
                  { label: "Worst Day", value: `${Math.max(...ttfb.map(d => d.avg))}ms`, desc: "Highest daily avg", good: Math.max(...ttfb.map(d => d.avg)) < 500 },
                ].map(({ label, value, desc, good }) => (
                  <div key={label} className="bg-white rounded-xl shadow-sm border border-cf-gray-200 p-4">
                    <p className="text-xs text-cf-gray-500 mb-1">{label}</p>
                    <p className={`text-2xl font-bold ${good ? "text-green-600" : "text-yellow-600"}`}>{value}</p>
                    <p className="text-xs text-cf-gray-400 mt-0.5">{desc}</p>
                  </div>
                ))}
              </div>

              {/* TTFB time-series */}
              <div className="bg-white rounded-xl shadow-sm border border-cf-gray-200 p-5">
                <div className="mb-4">
                  <h3 className="text-sm font-semibold text-cf-navy">{`Avg TTFB Trend (${data.meta?.periodLabel ?? "30-Day"})`}</h3>
                  <p className="text-xs text-cf-gray-500 mt-0.5">
                    Average Edge Time To First Byte per day — measured at Cloudflare's edge
                  </p>
                </div>
                <ResponsiveContainer width="100%" height={260}>
                  <LineChart data={ttfbChartData} margin={{ top: 5, right: 20, left: 0, bottom: 5 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#E5E7EB" />
                    <XAxis
                      dataKey="date"
                      tick={{ fontSize: 10, fill: "#6B7280" }}
                      tickLine={false}
                      axisLine={false}
                      interval="preserveStartEnd"
                    />
                    <YAxis
                      tickFormatter={(v) => `${v}ms`}
                      tick={{ fontSize: 10, fill: "#6B7280" }}
                      tickLine={false}
                      axisLine={false}
                    />
                    <Tooltip content={<TtfbTooltip />} />
                    <Legend iconType="circle" iconSize={8} wrapperStyle={{ fontSize: "11px" }} />
                    <Line
                      type="monotone"
                      dataKey="avg"
                      name="Avg TTFB"
                      stroke="#10B981"
                      strokeWidth={2}
                      dot={false}
                    />
                  </LineChart>
                </ResponsiveContainer>
              </div>
            </>
          )}

          {/* Edge Colo Distribution */}
          {coloBarData.length > 0 && (
            <>
              <HorizontalBarChart
                data={coloBarData}
                title="Top Cloudflare Edge Locations"
                subtitle="Bandwidth served per data center (IATA 3-letter codes)"
                color="#00B0D1"
                height={Math.max(220, coloBarData.length * 32 + 60)}
                xTickFormatter={(v) => v >= 1e9 ? `${(v / 1e9).toFixed(1)}GB` : v >= 1e6 ? `${(v / 1e6).toFixed(0)}MB` : `${(v / 1e3).toFixed(0)}KB`}
              />

              {/* Colo details table */}
              <div className="bg-white rounded-xl shadow-sm border border-cf-gray-200 overflow-hidden">
                <div className="px-5 py-3 border-b border-cf-gray-100">
                  <h3 className="text-sm font-semibold text-cf-navy flex items-center gap-2">
                    <Server size={14} className="text-cf-orange" />
                    Edge Location Details
                  </h3>
                </div>
                <table className="w-full text-xs">
                  <thead>
                    <tr className="bg-cf-gray-50 text-cf-gray-500 uppercase tracking-wide text-[10px]">
                      <th className="px-4 py-2.5 text-left font-semibold">#</th>
                      <th className="px-4 py-2.5 text-left font-semibold">PoP Code</th>
                      <th className="px-4 py-2.5 text-right font-semibold">Requests</th>
                      <th className="px-4 py-2.5 text-right font-semibold">Bandwidth</th>
                      <th className="px-4 py-2.5 text-left font-semibold pl-4">Share</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-cf-gray-100">
                    {colos.map((c, i) => {
                      const totalReqs = colos.reduce((s, r) => s + r.requests, 0);
                      const pct = totalReqs > 0 ? ((c.requests / totalReqs) * 100).toFixed(1) : "0.0";
                      return (
                        <tr key={c.coloCode} className={i % 2 === 0 ? "bg-white" : "bg-cf-gray-50/40"}>
                          <td className="px-4 py-2 text-cf-gray-400 font-mono">{i + 1}</td>
                          <td className="px-4 py-2 font-bold text-cf-navy font-mono">{c.coloCode}</td>
                          <td className="px-4 py-2 text-right font-mono text-cf-gray-700">
                            {formatNumber(c.requests)}
                          </td>
                          <td className="px-4 py-2 text-right text-cf-gray-600 font-mono">
                            {formatBytes(c.bytes)}
                          </td>
                          <td className="px-4 py-2 pl-4">
                            <div className="flex items-center gap-2">
                              <div className="w-20 bg-cf-gray-100 rounded-full h-1.5 overflow-hidden">
                                <div
                                  className="h-full bg-cf-teal rounded-full"
                                  style={{ width: `${Math.min(parseFloat(pct) * 4, 100)}%` }}
                                />
                              </div>
                              <span className="text-cf-gray-600">{pct}%</span>
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </div>
      )}
    </section>
  );
}
