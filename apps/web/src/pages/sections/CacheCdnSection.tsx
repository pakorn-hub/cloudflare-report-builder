/**
 * CDN/Cache Performance + HTTP Error Rates Section.
 * Shows cache KPIs, cache time-series, cache pie, bandwidth time-series,
 * error stacked bar, and error pie.
 */
import { Server, TrendingDown, Activity, AlertTriangle } from "lucide-react";
import type { AppSecData } from "../../types";
import { formatNumber, formatBytes } from "../../utils/formatters";
import StatCard from "../../components/StatCard";
import SectionHeader from "../../components/SectionHeader";
import TimeSeriesChart from "../../components/charts/TimeSeriesChart";
import StackedBarChart from "../../components/charts/StackedBarChart";
import PieBreakdownChart from "../../components/charts/PieBreakdownChart";

// ─── Color palettes ──────────────────────────────────────────────────────────
const CACHE_COLORS = ["#10B981", "#F6821F", "#F59E0B", "#3B82F6", "#9CA3AF"];
const ERROR_COLORS = { e2xx: "#10B981", e3xx: "#3B82F6", e4xx: "#F59E0B", e5xx: "#EF4444" };

export default function CacheCdnSection({ data }: { data: AppSecData }) {
  const {
    summary, cacheTimeSeries, bandwidthTimeSeries, errorTimeSeries, cacheStatusBreakdown,
  } = data;

  // Cache time-series
  const cacheChartData = cacheTimeSeries.map((d) => ({
    date: d.date,
    cached: d.hit,
    uncached: d.miss,
  }));

  // Bandwidth time-series (bytes → GB for display)
  const bwChartData = bandwidthTimeSeries.map((d) => ({
    date: d.date,
    total: +(d.totalBytes / 1e9).toFixed(2),
    cached: +(d.cachedBytes / 1e9).toFixed(2),
    uncached: +(d.uncachedBytes / 1e9).toFixed(2),
  }));

  // Error time-series
  const errorChartData = errorTimeSeries.map((d) => ({
    date: d.date,
    "5xx": d.e5xx,
    "4xx": d.e4xx,
    "3xx": d.e3xx,
    "2xx": d.e2xx,
  }));

  // Cache pie
  const cachePieData = cacheStatusBreakdown.map((c) => ({
    name: c.status.replace(/_/g, " ").replace(/\b\w/g, (l) => l.toUpperCase()),
    value: c.requests,
    pct: c.pct,
  }));

  // Error pie (aggregate totals)
  const errorPieData = [
    { name: "2xx Success", value: errorTimeSeries.reduce((s, d) => s + d.e2xx, 0) },
    { name: "3xx Redirect", value: errorTimeSeries.reduce((s, d) => s + d.e3xx, 0) },
    { name: "4xx Client Error", value: errorTimeSeries.reduce((s, d) => s + d.e4xx, 0) },
    { name: "5xx Server Error", value: errorTimeSeries.reduce((s, d) => s + d.e5xx, 0) },
  ].filter((d) => d.value > 0);

  return (
    <div className="report-section space-y-8 print:space-y-0">
      {/* ── CDN / Cache Performance Section ─────────────────────────────── */}
      <div className="print-section-break pt-8 print:pt-14">
        <SectionHeader
          title="CDN & Cache Performance"
          subtitle="Bandwidth savings, cache efficiency, and origin offload"
          icon={<Server size={18} />}
          printBreak
        />

        {/* Cache KPIs */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-4">
          <StatCard
            title="Request Cache Hit"
            value={`${summary.cacheHitRatePct}%`}
            subtitle="Requests served from cache"
            icon={<TrendingDown size={18} />}
            color="green"
            trend="up"
            trendLabel="Origin offload rate"
          />
          <StatCard
            title="Bandwidth Cache Hit"
            value={`${(summary as unknown as Record<string, number>)["cacheBandwidthHitRatePct"] ?? summary.cacheHitRatePct}%`}
            subtitle="Bytes served from cache"
            icon={<Activity size={18} />}
            color="teal"
            trend="up"
            trendLabel="Bandwidth cost savings"
          />
          <StatCard
            title="Bandwidth Served"
            value={formatBytes(summary.totalBandwidthBytes)}
            subtitle="Total edge bandwidth"
            color="blue"
          />
          <StatCard
            title="Bandwidth Saved"
            value={formatBytes(summary.cachedBandwidthBytes)}
            subtitle="Served from cache (origin saved)"
            color="orange"
            trend="up"
            trendLabel={`$${(summary as unknown as Record<string, Record<string, number>>)["costSavings"]?.["monthlyBandwidthSavings"] ?? 0}/mo saved`}
          />
        </div>

        {/* Cache time-series + pie */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 mb-4">
          <TimeSeriesChart
            data={cacheChartData}
            title="Cache Hit vs Miss — Daily"
            subtitle="Daily cached vs uncached requests"
            series={[
              { key: "cached", label: "Cache Hit", color: "#10B981" },
              { key: "uncached", label: "Cache Miss", color: "#F6821F" },
            ]}
            height={220}
          />
          <PieBreakdownChart
            data={cachePieData}
            title="Cache Status Breakdown"
            subtitle="Request distribution by cache status"
            colors={CACHE_COLORS}
            height={260}
          />
        </div>

        {/* Bandwidth time-series */}
        <TimeSeriesChart
          data={bwChartData}
          title="Bandwidth Usage — Daily (GB)"
          subtitle="Total vs cached bandwidth served from edge"
          series={[
            { key: "total", label: "Total (GB)", color: "#3B82F6" },
            { key: "cached", label: "Cached (GB)", color: "#10B981" },
            { key: "uncached", label: "Uncached (GB)", color: "#F6821F", strokeDasharray: "4 4" },
          ]}
          height={220}
          yTickFormatter={(v) => `${v}GB`}
        />
      </div>

      {/* ── HTTP Error Rate Section ───────────────────────────────────────── */}
      <div>
        <h3 className="text-base font-semibold text-cf-navy mb-4 flex items-center gap-2">
          <AlertTriangle size={16} className="text-yellow-500" /> HTTP Error Rates
        </h3>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <StackedBarChart
            data={errorChartData}
            series={[
              { key: "5xx", label: "5xx Server Error", color: ERROR_COLORS.e5xx },
              { key: "4xx", label: "4xx Client Error", color: ERROR_COLORS.e4xx },
              { key: "3xx", label: "3xx Redirect", color: ERROR_COLORS.e3xx },
              { key: "2xx", label: "2xx Success", color: ERROR_COLORS.e2xx },
            ]}
            title="HTTP Response Codes — Daily"
            subtitle="Edge response code distribution per day"
            height={240}
          />
          <PieBreakdownChart
            data={errorPieData}
            title="Response Code Summary"
            subtitle={`${data.meta?.periodLabel ?? "30-Day"} aggregate by response class`}
            colors={[ERROR_COLORS.e2xx, ERROR_COLORS.e3xx, ERROR_COLORS.e4xx, ERROR_COLORS.e5xx]}
            height={260}
            innerRadius={45}
          />
        </div>
      </div>
    </div>
  );
}
