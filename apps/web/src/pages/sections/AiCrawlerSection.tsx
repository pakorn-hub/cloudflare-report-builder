/**
 * AI Crawl Control Section — Generative AI bot/crawler traffic visibility.
 * Mirrors Cloudflare's AI Crawl Control dashboard (Overview/Crawlers/Metrics
 * tabs): named AI bots by operator, bandwidth consumed, allowed vs blocked
 * status codes, most-crawled paths, and AI-driven referral traffic.
 * Detection method: user-agent matching (works on all plans — see
 * https://developers.cloudflare.com/ai-crawl-control/reference/graphql-api/).
 */
import { Sparkles, Bot, Info, ArrowUpRight } from "lucide-react";
import type { AppSecData } from "../../types";
import { formatNumber, formatBytes } from "../../utils/formatters";
import StatCard from "../../components/StatCard";
import SectionHeader from "../../components/SectionHeader";
import TimeSeriesChart from "../../components/charts/TimeSeriesChart";
import HorizontalBarChart from "../../components/charts/HorizontalBarChart";
import PieBreakdownChart from "../../components/charts/PieBreakdownChart";

const CATEGORY_COLORS: Record<string, string> = {
  "AI Crawler": "#7C3AED",
  "AI Assistant": "#2563EB",
  "AI Search": "#0EA5E9",
};

const STATUS_COLORS = ["#16A34A", "#F59E0B", "#DC2626", "#6B7280"];

export default function AiCrawlerSection({ data }: { data: AppSecData }) {
  const summary = data.aiCrawlerSummary;
  const series  = data.aiCrawlerTimeSeries ?? [];
  const bots    = data.aiCrawlerBots ?? [];
  const topPaths = data.aiCrawlerTopPaths ?? [];
  const referrals = data.aiReferralTraffic ?? [];

  if (!summary || summary.totalRequests === 0) {
    return (
      <div className="report-section">
        <div className="print-section-break pt-8 print:pt-14">
          <SectionHeader
            title="AI Crawl Control"
            subtitle="Generative AI bot/crawler traffic (GPTBot, ClaudeBot, PerplexityBot, and more)"
            icon={<Sparkles size={18} />}
            printBreak
          />
          <div className="bg-cf-gray-50 rounded-xl border border-cf-gray-200 p-6 flex items-start gap-3">
            <Info size={16} className="text-cf-gray-400 flex-shrink-0 mt-0.5" />
            <div>
              <p className="text-sm font-semibold text-cf-navy">No AI crawler traffic detected</p>
              <p className="text-xs text-cf-gray-500 mt-1">
                No requests matching known AI crawler user agents (OpenAI's GPTBot, Anthropic's ClaudeBot,
                PerplexityBot, Bytespider, CCBot, and others) were observed in this period. Detection is
                user-agent based and works on all plans — no Bot Management subscription required.
                See Security → AI Crawl Control in the Cloudflare dashboard for live monitoring.
              </p>
            </div>
          </div>
        </div>
      </div>
    );
  }

  const chartData = series.map((d) => ({ date: d.date, requests: d.requests }));

  const barData = bots.slice(0, 12).map((b) => ({
    name: `${b.botName} (${b.operator})`,
    value: b.requests,
    color: CATEGORY_COLORS[b.category] ?? "#7C3AED",
  }));

  const categoryTotals = summary.categoryBreakdown ?? [];

  const statusPieData = [
    { name: "Allowed (2xx)", value: summary.allowedRequests },
    { name: "Payment Required (402)", value: summary.paymentRequiredRequests },
    { name: "Blocked (403)", value: summary.blockedRequests },
    { name: "Other Error", value: summary.otherErrorRequests },
  ].filter((d) => d.value > 0);

  const referralByDate = new Map<string, Record<string, string | number>>();
  const referralOperators = new Set<string>();
  for (const r of referrals) {
    referralOperators.add(r.operator);
    const row: Record<string, string | number> = referralByDate.get(r.date) ?? { date: r.date };
    row[r.operator] = ((row[r.operator] as number) ?? 0) + r.requests;
    referralByDate.set(r.date, row);
  }
  const referralChartData = Array.from(referralByDate.values()).sort((a, b) => String(a.date).localeCompare(String(b.date)));
  const totalReferrals = referrals.reduce((s, r) => s + r.requests, 0);

  return (
    <div className="report-section">
      <div className="print-section-break pt-8 print:pt-14">
        <SectionHeader
          title="AI Crawl Control"
          subtitle="Generative AI bot/crawler traffic — training crawlers, on-demand assistants, and AI search engines"
          icon={<Sparkles size={18} />}
          printBreak
        />

        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-4">
          <StatCard
            title="AI Crawler Requests"
            value={formatNumber(summary.totalRequests)}
            subtitle={`${summary.pctOfTotal}% of total traffic`}
            icon={<Sparkles size={16} />}
            color="purple"
          />
          <StatCard
            title="Bandwidth Consumed"
            value={formatBytes(summary.totalBandwidthBytes)}
            subtitle="Data transferred to AI crawlers"
            color="blue"
          />
          <StatCard
            title="Unique AI Bots Detected"
            value={summary.uniqueBots}
            subtitle="Distinct AI crawlers/assistants"
            icon={<Bot size={16} />}
            color="teal"
          />
          <StatCard
            title="Top AI Crawler"
            value={summary.topBot ?? "—"}
            subtitle={bots[0]?.operator ?? "Highest request volume"}
            color="orange"
          />
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 mb-4">
          {chartData.length > 0 ? (
            <TimeSeriesChart
              data={chartData}
              title="AI Crawler Traffic — Daily"
              subtitle="Requests matching known AI crawler user agents per day"
              series={[{ key: "requests", label: "AI Crawler Requests", color: "#7C3AED" }]}
              height={220}
            />
          ) : (
            <div className="bg-white rounded-xl shadow-sm border border-cf-gray-200 p-6 flex items-center justify-center text-sm text-cf-gray-400">
              Daily trend unavailable for this period
            </div>
          )}
          {barData.length > 0 && (
            <HorizontalBarChart
              data={barData}
              title="Top AI Bots by Volume"
              subtitle="Named AI crawlers/assistants ranked by request count"
              color="#7C3AED"
            />
          )}
        </div>

        {/* Status code breakdown — allowed vs blocked/error */}
        {statusPieData.length > 0 && (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 mb-4">
            <PieBreakdownChart
              data={statusPieData}
              title="AI Crawler Response Status"
              subtitle="Allowed (2xx) vs blocked (403) / payment required (402) / other errors"
              colors={STATUS_COLORS}
              height={240}
            />
            <div className="bg-white rounded-xl shadow-sm border border-cf-gray-200 p-5">
              <h3 className="text-sm font-semibold text-cf-navy mb-3">Access Control Summary</h3>
              <div className="space-y-2.5 text-xs">
                <div className="flex items-center justify-between">
                  <span className="flex items-center gap-2 text-cf-gray-600"><span className="w-2.5 h-2.5 rounded-full bg-green-600" />Allowed (2xx)</span>
                  <span className="font-mono font-bold text-cf-navy">{formatNumber(summary.allowedRequests)}</span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="flex items-center gap-2 text-cf-gray-600"><span className="w-2.5 h-2.5 rounded-full bg-amber-500" />Payment Required (402)</span>
                  <span className="font-mono font-bold text-cf-navy">{formatNumber(summary.paymentRequiredRequests)}</span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="flex items-center gap-2 text-cf-gray-600"><span className="w-2.5 h-2.5 rounded-full bg-red-600" />Blocked (403)</span>
                  <span className="font-mono font-bold text-cf-navy">{formatNumber(summary.blockedRequests)}</span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="flex items-center gap-2 text-cf-gray-600"><span className="w-2.5 h-2.5 rounded-full bg-cf-gray-400" />Other Error</span>
                  <span className="font-mono font-bold text-cf-navy">{formatNumber(summary.otherErrorRequests)}</span>
                </div>
              </div>
              <p className="text-[11px] text-cf-gray-400 mt-4 pt-3 border-t border-cf-gray-100">
                Manage per-crawler allow/block rules in <strong>Security → AI Crawl Control → Crawlers</strong>.
              </p>
            </div>
          </div>
        )}

        {/* Named bot table */}
        {bots.length > 0 && (
          <div className="bg-white rounded-xl shadow-sm border border-cf-gray-200 overflow-hidden mb-4">
            <div className="px-5 py-3 border-b border-cf-gray-100">
              <h3 className="text-sm font-semibold text-cf-navy">AI Crawler Inventory</h3>
              <p className="text-xs text-cf-gray-500 mt-0.5">
                Individual AI bots identified via user-agent matching, grouped by operator
              </p>
            </div>
            <table className="w-full text-xs">
              <thead>
                <tr className="bg-cf-gray-50 text-cf-gray-500 uppercase tracking-wide text-[10px]">
                  <th className="px-4 py-2.5 text-left font-semibold">#</th>
                  <th className="px-4 py-2.5 text-left font-semibold">Bot Name</th>
                  <th className="px-4 py-2.5 text-left font-semibold">Operator</th>
                  <th className="px-4 py-2.5 text-left font-semibold">Category</th>
                  <th className="px-4 py-2.5 text-right font-semibold">Requests</th>
                  <th className="px-4 py-2.5 text-right font-semibold">Data Transfer</th>
                  <th className="px-4 py-2.5 text-left font-semibold pl-4">Share</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-cf-gray-100">
                {bots.slice(0, 20).map((b, i) => {
                  const shr = summary.totalRequests > 0 ? ((b.requests / summary.totalRequests) * 100).toFixed(1) : "0";
                  return (
                    <tr key={b.botName} className={i % 2 === 0 ? "bg-white" : "bg-cf-gray-50/40"}>
                      <td className="px-4 py-2 text-cf-gray-400 font-mono">{i + 1}</td>
                      <td className="px-4 py-2 font-medium text-cf-navy font-mono">{b.botName}</td>
                      <td className="px-4 py-2 text-cf-gray-500">{b.operator}</td>
                      <td className="px-4 py-2">
                        <span
                          className="px-1.5 py-0.5 rounded text-white text-[10px] font-semibold"
                          style={{ backgroundColor: CATEGORY_COLORS[b.category] ?? "#7C3AED" }}
                        >
                          {b.category}
                        </span>
                      </td>
                      <td className="px-4 py-2 text-right font-mono font-bold text-cf-navy">{formatNumber(b.requests)}</td>
                      <td className="px-4 py-2 text-right font-mono text-cf-gray-600">{formatBytes(b.bytes)}</td>
                      <td className="px-4 py-2 pl-4">
                        <div className="flex items-center gap-2">
                          <div className="w-20 bg-cf-gray-100 rounded-full h-1.5 overflow-hidden">
                            <div className="h-full bg-purple-500 rounded-full" style={{ width: `${shr}%` }} />
                          </div>
                          <span className="text-cf-gray-500">{shr}%</span>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}

        {/* Most popular paths crawled by AI */}
        {topPaths.length > 0 && (
          <div className="bg-white rounded-xl shadow-sm border border-cf-gray-200 overflow-hidden mb-4">
            <div className="px-5 py-3 border-b border-cf-gray-100">
              <h3 className="text-sm font-semibold text-cf-navy">Most Popular Paths Crawled by AI</h3>
              <p className="text-xs text-cf-gray-500 mt-0.5">Pages most frequently requested by AI crawlers</p>
            </div>
            <table className="w-full text-xs">
              <thead>
                <tr className="bg-cf-gray-50 text-cf-gray-500 uppercase tracking-wide text-[10px]">
                  <th className="px-4 py-2.5 text-left font-semibold">#</th>
                  <th className="px-4 py-2.5 text-left font-semibold">Path</th>
                  <th className="px-4 py-2.5 text-left font-semibold">Hostname</th>
                  <th className="px-4 py-2.5 text-right font-semibold">Requests</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-cf-gray-100">
                {topPaths.slice(0, 15).map((p, i) => (
                  <tr key={`${p.host}${p.path}`} className={i % 2 === 0 ? "bg-white" : "bg-cf-gray-50/40"}>
                    <td className="px-4 py-2 text-cf-gray-400 font-mono">{i + 1}</td>
                    <td className="px-4 py-2 font-mono text-cf-navy truncate max-w-xs">{p.path}</td>
                    <td className="px-4 py-2 text-cf-gray-500 font-mono">{p.host}</td>
                    <td className="px-4 py-2 text-right font-mono font-bold text-cf-navy">{formatNumber(p.requests)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {/* AI referral traffic — humans arriving from AI platforms (paid plans) */}
        {referrals.length > 0 && (
          <div className="bg-white rounded-xl shadow-sm border border-cf-gray-200 p-5">
            <div className="flex items-center gap-2 mb-1">
              <ArrowUpRight size={14} className="text-cf-teal" />
              <h3 className="text-sm font-semibold text-cf-navy">AI Referral Traffic</h3>
            </div>
            <p className="text-xs text-cf-gray-500 mb-4">
              Human visitors arriving from AI platforms (ChatGPT, Claude, Perplexity, Gemini, Copilot) —
              {" "}{formatNumber(totalReferrals)} total referrals in this period
            </p>
            {referralChartData.length > 0 && (
              <TimeSeriesChart
                data={referralChartData}
                title="Referral Visits by AI Operator — Daily"
                series={Array.from(referralOperators).map((op, i) => ({
                  key: op,
                  label: op,
                  color: ["#7C3AED", "#2563EB", "#0EA5E9", "#16A34A", "#F59E0B", "#EC4899"][i % 6],
                }))}
                height={200}
              />
            )}
          </div>
        )}
      </div>
    </div>
  );
}
