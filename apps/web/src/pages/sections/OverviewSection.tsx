/**
 * Overview Section — KPI row + Area chart traffic overview + WAF overlay.
 */
import { Shield, Zap, Bot, Activity } from "lucide-react";
import type { AppSecData } from "../../types";
import { formatNumber, formatBytes } from "../../utils/formatters";
import StatCard from "../../components/StatCard";
import SectionHeader from "../../components/SectionHeader";
import AreaTimeSeriesChart from "../../components/charts/AreaTimeSeriesChart";
import HorizonChart from "../../components/charts/HorizonChart";

export default function OverviewSection({ data }: { data: AppSecData }) {
  const {
    summary, meta, requestsTimeSeries,
    wafTimeSeries, ddosTimeSeries, bandwidthTimeSeries,
  } = data;

  const totalDdos = ddosTimeSeries.reduce((s, d) => s + d.mitigated, 0);
  // Use the robust numeric field, not scoreRange string-matching — the real
  // labels ("Automated (Score 1)" / "Likely Automated (Score 2–29)") never
  // contain the substring "Bot", so that lookup always returned 0.
  const botPct = summary.botTrafficPct ?? 0;
  // Always use meta.days as the authoritative period count — never compute from date diff
  // (date diff gives N-1 because until=today and since=today-(N-1) → diff = N-1 days)
  const days = (meta as unknown as Record<string, number>)["days"] ?? 30;

  // Combined time-series: requests + WAF events overlaid
  const combinedData = requestsTimeSeries.map((d) => {
    const waf = wafTimeSeries.find((w) => w.date === d.date);
    const bw = bandwidthTimeSeries.find((b) => b.date === d.date);
    return {
      date: d.date,
      requests: d.value,
      wafEvents: waf ? waf.block + waf.challenge + waf.managed_challenge : 0,
      bandwidth: bw ? bw.totalBytes : 0,
    };
  });

  return (
    <div className="report-section space-y-6 print:space-y-4">
      {/* ── Overview KPI Row ──────────────────────────────────────────────── */}
      <SectionHeader
        title="Application Security Overview"
        subtitle={`${days}-day analysis · ${meta.since} → ${meta.until} · Zone: ${meta.zoneName}`}
        icon={<Shield size={18} />}
        printBreak
      />
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard
          title="Total Requests"
          value={formatNumber(summary.totalRequests)}
          subtitle={`${formatBytes(summary.totalBandwidthBytes)} served`}
          icon={<Activity size={18} />}
          color="blue"
        />
        <StatCard
          title="Threats Blocked"
          value={formatNumber(summary.totalThreatsBlocked)}
          subtitle="WAF + DDoS combined"
          icon={<Shield size={18} />}
          color="orange"
          trend="up"
          trendLabel="Protected by Cloudflare"
        />
        <StatCard
          title="DDoS Mitigated"
          value={formatNumber(totalDdos)}
          subtitle="L7 DDoS events blocked"
          icon={<Zap size={18} />}
          color="red"
        />
        <StatCard
          title="Bot Traffic"
          value={`${botPct}%`}
          subtitle="Of total requests automated"
          icon={<Bot size={18} />}
          color="purple"
        />
      </div>

      {/* ── Horizon Chart — all time-series in one compact panel ──────── */}
      {combinedData.length > 0 && (
        <HorizonChart
          title="Traffic & Security Overview"
          subtitle="Each band = one metric over the analysis period. Darker shade = higher value. Aligned for cross-metric correlation."
          bandHeight={44}
          overlap={3}
          series={[
            {
              key: "requests", label: "Total Requests", color: "#3B82F6",
              data: combinedData.map((d) => ({ date: d.date, value: d.requests })),
              formatter: (v: number) => v >= 1e6 ? `${(v/1e6).toFixed(1)}M` : v >= 1e3 ? `${(v/1e3).toFixed(0)}K` : String(v),
            },
            {
              key: "wafEvents", label: "WAF Events", color: "#EF4444",
              data: combinedData.map((d) => ({ date: d.date, value: d.wafEvents })),
              formatter: (v: number) => v >= 1e3 ? `${(v/1e3).toFixed(0)}K` : String(v),
            },
            {
              key: "bandwidth", label: "Bandwidth", color: "#F6821F",
              data: combinedData.map((d) => ({ date: d.date, value: d.bandwidth })),
              formatter: (v: number) => v >= 1e9 ? `${(v/1e9).toFixed(1)}GB` : v >= 1e6 ? `${(v/1e6).toFixed(0)}MB` : `${(v/1e3).toFixed(0)}KB`,
              unit: "",
            },
          ].filter((s) => s.data.some((d) => d.value > 0))}
        />
      )}

      {/* ── Dual area charts below for detail ───────────────────────────── */}
      {combinedData.length > 0 && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <AreaTimeSeriesChart
            data={combinedData}
            series={[{ key: "requests", label: "Total Requests", color: "#3B82F6" }]}
            title="Daily Request Volume"
            subtitle="Total HTTP requests served per day"
            height={240}
            tickFormatter={(v) => v >= 1e6 ? `${(v/1e6).toFixed(1)}M` : v >= 1e3 ? `${(v/1e3).toFixed(0)}K` : String(v)}
          />
          <AreaTimeSeriesChart
            data={combinedData}
            series={[{ key: "wafEvents", label: "WAF Events", color: "#EF4444" }]}
            title="Daily WAF Events"
            subtitle="Block + Challenge + Managed Challenge per day"
            height={240}
            tickFormatter={(v) => v >= 1e3 ? `${(v/1e3).toFixed(0)}K` : String(v)}
          />
        </div>
      )}
    </div>
  );
}
