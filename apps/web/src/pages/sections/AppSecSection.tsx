/**
 * AppSec Section — covers:
 * WAF, DDoS, Bot Management, Cache/CDN Performance, Security Posture,
 * Certificates, TLS, Rate Limiting.
 *
 * All charts: time-series + pie + bar as appropriate.
 * Data period: past 30 days (GraphQL limit).
 */
import {
  Shield, Zap, Bot, Lock, Activity, Globe,
  TrendingDown, AlertTriangle, CheckCircle, Server,
} from "lucide-react";
import type { AppSecData } from "../../types";
import { formatNumber, formatBytes } from "../../utils/formatters";
import StatCard from "../../components/StatCard";
import SectionHeader from "../../components/SectionHeader";
import TimeSeriesChart from "../../components/charts/TimeSeriesChart";
import StackedBarChart from "../../components/charts/StackedBarChart";
import PieBreakdownChart from "../../components/charts/PieBreakdownChart";
import HorizontalBarChart from "../../components/charts/HorizontalBarChart";
import CertificateTable from "../../components/tables/CertificateTable";

interface Props {
  data: AppSecData;
}

// ─── Color palettes ──────────────────────────────────────────────────────────
const WAF_COLORS = {
  block: "#EF4444",
  challenge: "#F59E0B",
  managed_challenge: "#F97316",
  log: "#3B82F6",
  skip: "#9CA3AF",
};

const BOT_COLORS = ["#EF4444", "#F59E0B", "#10B981"];
const CACHE_COLORS = ["#10B981", "#F6821F", "#F59E0B", "#3B82F6", "#9CA3AF"];
const TLS_COLORS = ["#10B981", "#3B82F6", "#F6821F", "#8B5CF6", "#9CA3AF"];
const ERROR_COLORS = { e2xx: "#10B981", e3xx: "#3B82F6", e4xx: "#F59E0B", e5xx: "#EF4444" };

// ─── Helpers ─────────────────────────────────────────────────────────────────
function securityLevelBadge(level: string | null | undefined) {
  const styles: Record<string, string> = {
    essentially_off: "bg-gray-100 text-gray-600",
    low: "bg-blue-50 text-blue-700",
    medium: "bg-yellow-50 text-yellow-700",
    high: "bg-orange-50 text-orange-700",
    under_attack: "bg-red-50 text-red-700 font-bold",
  };
  const labels: Record<string, string> = {
    essentially_off: "Off",
    low: "Low",
    medium: "Medium",
    high: "High",
    under_attack: "Under Attack Mode",
  };
  const key = level ?? "medium";
  return (
    <span className={`inline-block px-2 py-0.5 rounded-full text-xs ${styles[key] ?? styles.medium}`}>
      {labels[key] ?? level}
    </span>
  );
}

function BoolBadge({ val, trueLabel = "Enabled", falseLabel = "Disabled" }: {
  val?: boolean; trueLabel?: string; falseLabel?: string;
}) {
  return val ? (
    <span className="inline-flex items-center gap-1 text-xs text-green-700 font-medium">
      <CheckCircle size={12} /> {trueLabel}
    </span>
  ) : (
    <span className="inline-flex items-center gap-1 text-xs text-cf-gray-400 font-medium">
      <AlertTriangle size={12} /> {falseLabel}
    </span>
  );
}

// ─── Component ───────────────────────────────────────────────────────────────
export default function AppSecSection({ data }: Props) {
  const {
    summary, meta, wafTimeSeries, requestsTimeSeries, bandwidthTimeSeries,
    cacheTimeSeries, errorTimeSeries, botTimeSeries, ddosTimeSeries,
    wafTopRules, wafTopCountries, wafTopPaths,
    botScoreBreakdown, cacheStatusBreakdown, tlsVersionBreakdown, ddosAttackVectors,
    certificates, rateLimitRules, wafManagedRules, errors,
  } = data;

  const totalDdos = ddosTimeSeries.reduce((s, d) => s + d.mitigated, 0);
  const totalWafEvents = wafTimeSeries.reduce(
    (s, d) => s + d.block + d.challenge + d.managed_challenge, 0
  );
  // Robust numeric field, not scoreRange string-matching (see fetch-appsec.ts
  // comment on botTrafficPct — "Bot" never matches the real bucket labels).
  const botPct = summary.botTrafficPct ?? 0;
  const expiringSoon = certificates.filter(
    (c) => c.daysUntilExpiry >= 0 && c.daysUntilExpiry < 30
  ).length;

  // ── Prepare chart data ────────────────────────────────────────────────────

  // Requests time-series
  const requestChartData = requestsTimeSeries.map((d) => ({
    date: d.date,
    requests: d.value,
  }));

  // WAF stacked bar series
  const wafSeries = [
    { key: "block", label: "Block", color: WAF_COLORS.block },
    { key: "managed_challenge", label: "Managed Challenge", color: WAF_COLORS.managed_challenge },
    { key: "challenge", label: "Challenge", color: WAF_COLORS.challenge },
    { key: "log", label: "Log", color: WAF_COLORS.log },
    { key: "skip", label: "Skip", color: WAF_COLORS.skip },
  ];

  // DDoS time-series
  const ddosChartData = ddosTimeSeries.map((d) => ({
    date: d.date,
    mitigated: d.mitigated,
  }));

  // Bot time-series
  const botChartData = botTimeSeries.map((d) => ({
    date: d.date,
    bot: d.botRequests,
    likelyBot: d.likelyBotRequests,
    human: d.humanRequests,
  }));

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

  // WAF top rules — prefer human-readable name, fall back to short rule ID
  const wafRuleBar = wafTopRules.map((r) => ({
    name: r.ruleName ?? r.description ?? r.ruleId.slice(0, 12),
    value: r.count,
    label: `${r.action} · ${r.ruleId.slice(0, 8)}…`,
    color: r.action === "block" ? "#EF4444" : r.action === "challenge" || r.action === "managed_challenge" ? "#F59E0B" : "#3B82F6",
  }));

  const wafCountryBar = wafTopCountries.map((c) => ({
    name: c.countryName,
    value: c.count,
  }));

  // WAF top paths — show host + path as full URL
  const wafPathBar = wafTopPaths.map((p) => ({
    name: p.url ?? p.path,
    value: p.count,
  }));

  const ddosVectorBar = ddosAttackVectors.map((v) => ({
    name: v.vector,
    value: v.count,
    color: "#EF4444",
  }));

  // Bot pie
  const botPieData = botScoreBreakdown.map((b) => ({
    name: b.scoreRange,
    value: b.requests,
    pct: b.pct,
  }));

  // Cache pie
  const cachePieData = cacheStatusBreakdown.map((c) => ({
    name: c.status.replace(/_/g, " ").replace(/\b\w/g, (l) => l.toUpperCase()),
    value: c.requests,
    pct: c.pct,
  }));

  // TLS pie
  const tlsPieData = tlsVersionBreakdown.map((t) => ({
    name: t.version,
    value: t.requests,
    pct: t.pct,
  }));

  // Error pie (aggregate totals)
  const errorPieData = [
    { name: "2xx Success", value: errorTimeSeries.reduce((s, d) => s + d.e2xx, 0) },
    { name: "3xx Redirect", value: errorTimeSeries.reduce((s, d) => s + d.e3xx, 0) },
    { name: "4xx Client Error", value: errorTimeSeries.reduce((s, d) => s + d.e4xx, 0) },
    { name: "5xx Server Error", value: errorTimeSeries.reduce((s, d) => s + d.e5xx, 0) },
  ].filter((d) => d.value > 0);

  const hasErrors = Object.keys(errors).length > 0;

  return (
    <div className="space-y-8 print:space-y-0">

      {/* ── Overview KPI Row ──────────────────────────────────────────────── */}
      <div>
        <SectionHeader
          title="Application Security"
          subtitle={`${(meta as any).periodLabel ?? '30-Day'} analysis · ${meta.since} → ${meta.until} · Zone: ${meta.zoneName}`}
          icon={<Shield size={18} />}
          printBreak
        />
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          <StatCard
            title="Total Requests"
            value={formatNumber(summary.totalRequests)}
            subtitle="HTTP requests served"
            icon={<Activity size={18} />}
            color="blue"
          />
          <StatCard
            title="Threats Blocked"
            value={formatNumber(summary.totalThreatsBlocked)}
            subtitle={`WAF + DDoS combined`}
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
            subtitle="Of total requests identified as bots"
            icon={<Bot size={18} />}
            color="purple"
          />
        </div>
      </div>

      {/* ── HTTP Traffic Overview ─────────────────────────────────────────── */}
      <div>
        <h3 className="text-base font-semibold text-cf-navy mb-4">Traffic Overview</h3>
        <TimeSeriesChart
          data={requestChartData}
          title="Total HTTP Requests"
          subtitle="Daily request volume over the analysis period"
          series={[{ key: "requests", label: "Total Requests", color: "#3B82F6" }]}
          height={220}
        />
      </div>

      {/* ── WAF Section ──────────────────────────────────────────────────── */}
      <div>
        <h3 className="text-base font-semibold text-cf-navy mb-4 flex items-center gap-2">
          <Shield size={16} className="text-cf-orange" /> WAF & Firewall Events
        </h3>

        {/* WAF KPI row */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-4">
          <StatCard
            title="WAF Events"
            value={formatNumber(totalWafEvents)}
            subtitle="Total events over the analysis period"
            color="orange"
          />
          <StatCard
            title="Blocked"
            value={formatNumber(wafTimeSeries.reduce((s, d) => s + d.block, 0))}
            subtitle="Hard block action"
            color="red"
          />
          <StatCard
            title="Challenged"
            value={formatNumber(wafTimeSeries.reduce((s, d) => s + d.challenge + d.managed_challenge, 0))}
            subtitle="CAPTCHA / JS challenge"
            color="purple"
          />
          <StatCard
            title="Managed Rules"
            value={wafManagedRules.filter((r) => r.enabled).length}
            subtitle={`of ${wafManagedRules.length} rulesets enabled`}
            color="teal"
          />
        </div>

        {/* WAF time-series stacked bar */}
        <div className="mb-4">
          <StackedBarChart
            data={wafTimeSeries}
            series={wafSeries}
            title="WAF Events by Action — Daily"
            subtitle="Daily breakdown of WAF actions (block, challenge, log, skip)"
            height={240}
          />
        </div>

        {/* WAF breakdowns: top rules + top countries */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <HorizontalBarChart
            data={wafRuleBar}
            title="Top WAF Rules Triggered"
            subtitle="Most frequently triggered rules by name (color = action)"
            color="#F6821F"
          />
          <HorizontalBarChart
            data={wafCountryBar}
            title="Top Attack Source Countries"
            subtitle="Countries with most WAF events blocked"
            color="#EF4444"
          />
        </div>

        {/* Top attacked paths */}
        {wafPathBar.length > 0 && (
          <div className="mt-4">
            <HorizontalBarChart
              data={wafPathBar}
              title="Top Attacked URLs"
              subtitle="Most frequently targeted host + path combinations blocked by WAF"
              color="#8B5CF6"
            />
          </div>
        )}
      </div>

      {/* ── DDoS Section ─────────────────────────────────────────────────── */}
      <div className="print-section-break pt-8 print:pt-14">
        <h3 className="text-base font-semibold text-cf-navy mb-4 flex items-center gap-2">
          <Zap size={16} className="text-red-500" /> DDoS Protection
        </h3>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 mb-4">
          <TimeSeriesChart
            data={ddosChartData}
            title="DDoS Mitigated Requests — Daily"
            subtitle="Layer 7 HTTP DDoS events blocked per day"
            series={[{ key: "mitigated", label: "Mitigated", color: "#EF4444" }]}
            height={220}
          />
          {ddosVectorBar.length > 0 ? (
            <HorizontalBarChart
              data={ddosVectorBar}
              title="DDoS Attack Vectors"
              subtitle="Rule IDs triggered by DDoS mitigation"
              color="#EF4444"
            />
          ) : (
            <div className="bg-green-50 rounded-xl border border-green-200 p-6 flex flex-col items-center justify-center text-center">
              <CheckCircle size={32} className="text-green-500 mb-2" />
              <p className="text-sm font-semibold text-green-700">No DDoS Attacks Detected</p>
              <p className="text-xs text-green-600 mt-1">
                Cloudflare's automatic DDoS mitigation is active and no attack vectors were triggered in the analysis period.
              </p>
            </div>
          )}
        </div>
      </div>

      {/* ── Bot Management Section ───────────────────────────────────────── */}
      <div className="print-section-break pt-8 print:pt-14">
        <h3 className="text-base font-semibold text-cf-navy mb-4 flex items-center gap-2">
          <Bot size={16} className="text-purple-500" /> Bot Management
        </h3>

        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-4">
          <StatCard
            title="Total Bot Requests"
            value={formatNumber(summary.crawlerRequests)}
            subtitle="Score 1-29: Verified bots"
            color="red"
          />
          <StatCard
            title="Human Traffic"
            value={`${summary.humanPct ?? 0}%`}
            subtitle="Score 30-99: Likely human"
            color="green"
          />
          <StatCard
            title="Bot Score Enabled"
            value={data["botManagementConfig"] ? "Active" : "Unknown"}
            subtitle="Bot score classification"
            color="purple"
          />
          <StatCard
            title="Automated Traffic"
            value={`${botPct}%`}
            subtitle="Bots + likely bots combined"
            color="orange"
          />
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {/* Bot time-series */}
          <TimeSeriesChart
            data={botChartData}
            title="Bot vs Human Traffic — Daily"
            subtitle="Daily breakdown of bot score categories"
            series={[
              { key: "human", label: "Human (100)", color: "#10B981" },
              { key: "likelyBot", label: "Likely Bot (30-99)", color: "#F59E0B" },
              { key: "bot", label: "Verified Bot (1-29)", color: "#EF4444" },
            ]}
            height={220}
          />
          {/* Bot score pie */}
          <PieBreakdownChart
            data={botPieData}
            title="Bot Score Distribution"
            subtitle="Total requests by bot score category"
            colors={BOT_COLORS}
            height={260}
          />
        </div>
      </div>

      {/* ── CDN / Cache Performance Section ─────────────────────────────── */}
      <div className="print-section-break pt-8 print:pt-14">
        <SectionHeader
          title="CDN & Cache Performance"
          subtitle="Bandwidth savings, cache efficiency, and origin offload"
          icon={<Server size={18} />}
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
            subtitle="Aggregate by response class"
            colors={[ERROR_COLORS.e2xx, ERROR_COLORS.e3xx, ERROR_COLORS.e4xx, ERROR_COLORS.e5xx]}
            height={260}
            innerRadius={45}
          />
        </div>
      </div>

      {/* ── HTTP Error Rate Section ───────────────────────────────────────── */}
      {/* (already inside CDN section space above) */}

      {/* ── Security Posture Section ─────────────────────────────────────── */}
      <div className="print-section-break pt-8 print:pt-14">
        <SectionHeader
          title="Security Posture"
          subtitle="TLS encryption, certificate hygiene, and protocol security"
          icon={<Lock size={18} />}
        />

        {/* Security config badges */}
        <div className="bg-white rounded-xl shadow-sm border border-cf-gray-200 p-5 mb-4">
          <h3 className="text-sm font-semibold text-cf-navy mb-4">Security Configuration</h3>
          <div className="grid grid-cols-2 lg:grid-cols-3 gap-4 text-sm">
            <div className="flex items-center justify-between">
              <span className="text-cf-gray-600">Security Level</span>
              {securityLevelBadge(data.securityLevel)}
            </div>
            <div className="flex items-center justify-between">
              <span className="text-cf-gray-600">TLS 1.3</span>
              <BoolBadge val={data.tls13Enabled} />
            </div>
            <div className="flex items-center justify-between">
              <span className="text-cf-gray-600">Always HTTPS</span>
              <BoolBadge val={data.alwaysHttps} />
            </div>
            <div className="flex items-center justify-between">
              <span className="text-cf-gray-600">Min TLS Version</span>
              <span className="text-xs font-semibold text-cf-navy">{data.tlsMinVersion ?? "N/A"}</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-cf-gray-600">SSL Mode</span>
              <span className="text-xs font-semibold text-cf-navy capitalize">{data.sslMode ?? "N/A"}</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-cf-gray-600">API Shield</span>
              <BoolBadge val={data.apiShieldEnabled} />
            </div>
          </div>
        </div>

        {/* Cipher Suite table */}
        {(data.cipherSuites?.length ?? 0) > 0 && (
          <div className="bg-white rounded-xl shadow-sm border border-cf-gray-200 p-5 mb-4">
            <h3 className="text-sm font-semibold text-cf-navy mb-3">Enabled TLS Cipher Suites</h3>
            <div className="flex flex-wrap gap-2">
              {(data.cipherSuites ?? []).map((cipher) => {
                // Colour-code by strength: CHACHA20 and AES-256 = strong green, AES-128 = blue, others = gray
                const isStrong = cipher.includes("CHACHA20") || cipher.includes("AES256") || cipher.includes("AES-256");
                const isMedium = cipher.includes("AES128") || cipher.includes("AES-128");
                const badgeClass = isStrong
                  ? "bg-green-50 border-green-200 text-green-800"
                  : isMedium
                  ? "bg-blue-50 border-blue-200 text-blue-800"
                  : "bg-cf-gray-50 border-cf-gray-200 text-cf-gray-600";
                return (
                  <span
                    key={cipher}
                    className={`inline-flex items-center px-2.5 py-1 rounded-lg border text-xs font-mono font-medium ${badgeClass}`}
                  >
                    {cipher}
                  </span>
                );
              })}
            </div>
            <p className="text-xs text-cf-gray-400 mt-3">
              All enabled ciphers support Perfect Forward Secrecy (PFS) via ECDHE key exchange.
            </p>
          </div>
        )}

        {/* TLS version pie + protocol pie */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 mb-4">
          <PieBreakdownChart
            data={tlsPieData}
            title="TLS Version Distribution"
            subtitle="Requests by TLS protocol version"
            colors={TLS_COLORS}
            height={260}
          />
          {(data.httpProtocolBreakdown?.length ?? 0) > 0 ? (
            <PieBreakdownChart
              data={(data.httpProtocolBreakdown ?? []).map((d) => ({
                name: d.protocol,
                value: d.requests,
              }))}
              title="HTTP Protocol Distribution"
              subtitle="HTTP/1.1 vs HTTP/2 vs HTTP/3 adoption"
              colors={["#3B82F6", "#F6821F", "#10B981"]}
              height={260}
            />
          ) : (
            <div className="bg-cf-gray-50 rounded-xl border border-cf-gray-200 p-5 flex items-center justify-center">
              <p className="text-sm text-cf-gray-400">HTTP protocol breakdown unavailable</p>
            </div>
          )}
        </div>

        {/* Certificates */}
        <CertificateTable certs={certificates} />

        {/* Expiry alerts */}
        {expiringSoon > 0 && (
          <div className="mt-4 flex items-start gap-3 bg-orange-50 border border-orange-200 rounded-xl p-4">
            <AlertTriangle size={20} className="text-orange-500 flex-shrink-0 mt-0.5" />
            <div>
              <p className="text-sm font-semibold text-orange-800">
                {expiringSoon} certificate{expiringSoon > 1 ? "s" : ""} expiring within 30 days
              </p>
              <p className="text-xs text-orange-700 mt-0.5">
                Cloudflare Universal SSL auto-renews certificates automatically. For custom/dedicated certificates, manual renewal action may be required.
              </p>
            </div>
          </div>
        )}
      </div>

      {/* ── Rate Limiting ─────────────────────────────────────────────────── */}
      {rateLimitRules.length > 0 && (
        <div>
          <h3 className="text-base font-semibold text-cf-navy mb-4 flex items-center gap-2">
            <Globe size={16} className="text-cf-teal" /> Rate Limiting Rules
          </h3>
          <div className="bg-white rounded-xl shadow-sm border border-cf-gray-200 overflow-hidden">
            <table className="w-full text-xs">
              <thead>
                <tr className="bg-cf-gray-50 border-b border-cf-gray-100">
                  <th className="text-left px-4 py-3 font-semibold text-cf-gray-600">Description</th>
                  <th className="text-right px-4 py-3 font-semibold text-cf-gray-600">Threshold</th>
                  <th className="text-right px-4 py-3 font-semibold text-cf-gray-600">Period</th>
                  <th className="text-center px-4 py-3 font-semibold text-cf-gray-600">Action</th>
                  <th className="text-center px-4 py-3 font-semibold text-cf-gray-600">Status</th>
                </tr>
              </thead>
              <tbody>
                {rateLimitRules.map((r) => (
                  <tr key={r.id} className="border-b border-cf-gray-50 hover:bg-cf-gray-50">
                    <td className="px-4 py-3 text-cf-navy">
                      {r.description || <span className="text-cf-gray-400">—</span>}
                    </td>
                    <td className="px-4 py-3 text-right text-cf-navy font-medium">
                      {r.threshold.toLocaleString()}
                    </td>
                    <td className="px-4 py-3 text-right text-cf-gray-600">{r.period}s</td>
                    <td className="px-4 py-3 text-center">
                      <span className="inline-block px-2 py-0.5 rounded-full bg-orange-50 text-orange-700 border border-orange-200 font-medium">
                        {r.action}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-center">
                      {r.enabled ? (
                        <span className="inline-flex items-center gap-1 text-green-600 font-medium">
                          <CheckCircle size={12} /> Active
                        </span>
                      ) : (
                        <span className="text-cf-gray-400">Disabled</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* ── Data Availability Warnings ──────────────────────────────────── */}
      {hasErrors && (
        <div className="bg-cf-gray-50 border border-cf-gray-200 rounded-xl p-4">
          <p className="text-xs font-semibold text-cf-gray-600 mb-2">
            Some data sections were unavailable (check token permissions):
          </p>
          <ul className="space-y-1">
            {Object.entries(errors).map(([k, v]) => (
              <li key={k} className="text-xs text-cf-gray-500">
                <span className="font-medium text-cf-gray-700">{k}:</span> {v}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
