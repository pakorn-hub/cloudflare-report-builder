/**
 * DDoS + Bot Management Section — DDoS time-series & vectors, Bot KPIs, Bot time-series & pie.
 */
import { Zap, Bot, CheckCircle } from "lucide-react";
import type { AppSecData } from "../../types";
import { formatNumber } from "../../utils/formatters";
import StatCard from "../../components/StatCard";
import SectionHeader from "../../components/SectionHeader";
import TimeSeriesChart from "../../components/charts/TimeSeriesChart";
import PieBreakdownChart from "../../components/charts/PieBreakdownChart";
import HorizontalBarChart from "../../components/charts/HorizontalBarChart";

// ─── Color palette ───────────────────────────────────────────────────────────
// Official CF bot score groupings: Automated(1)=red, Likely Automated(2-29)=purple, Likely Human(30-99)=green
const BOT_COLORS = ["#DC2626", "#7C3AED", "#16A34A"];

export default function DDoSBotSection({ data }: { data: AppSecData }) {
  const { summary, ddosTimeSeries, ddosAttackVectors, botTimeSeries, botScoreBreakdown } = data;

  // Robust numeric fields — NOT scoreRange string-matching (the real labels
  // "Automated (Score 1)" / "Likely Automated (Score 2–29)" never contain
  // the substring "Bot", so `.includes("Bot")` always returned 0 here).
  const likelyAutomatedPct = summary.likelyAutomatedPct ?? 0;
  const humanPct = summary.humanPct ?? 0;

  // DDoS time-series
  const ddosChartData = ddosTimeSeries.map((d) => ({
    date: d.date,
    mitigated: d.mitigated,
  }));

  const ddosVectorBar = ddosAttackVectors.map((v) => ({
    name: v.vector,
    value: v.count,
    color: "#DC2626",
  }));

  // Bot time-series
  const botChartData = botTimeSeries.map((d) => ({
    date: d.date,
    bot: d.botRequests,
    likelyBot: d.likelyBotRequests,
    human: d.humanRequests,
  }));

  // Bot pie
  const botPieData = botScoreBreakdown.map((b) => ({
    name: b.scoreRange,
    value: b.requests,
    pct: b.pct,
  }));

  return (
    <div className="report-section space-y-8 print:space-y-0">
      {/* ── DDoS Section ─────────────────────────────────────────────────── */}
      <div className="print-section-break pt-8 print:pt-14">
        <SectionHeader
          title="DDoS Protection"
          subtitle="Layer 7 HTTP DDoS mitigation events"
          icon={<Zap size={18} />}
          printBreak
        />

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 mb-4">
          <TimeSeriesChart
            data={ddosChartData}
            title="DDoS Mitigated Requests — Daily"
            subtitle="Layer 7 HTTP DDoS events blocked per day"
            series={[{ key: "mitigated", label: "Mitigated", color: "#F6821F" }]}
            height={220}
          />
          {ddosVectorBar.length > 0 ? (
            <HorizontalBarChart
              data={ddosVectorBar}
              title="DDoS Attack Vectors"
              subtitle="Rule IDs triggered by DDoS mitigation"
              color="#DC2626"
            />
          ) : (
            <div className="bg-green-50 rounded-xl border border-green-200 p-6 flex flex-col items-center justify-center text-center">
              <CheckCircle size={32} className="text-green-500 mb-2" />
              <p className="text-sm font-semibold text-green-700">No DDoS Attacks Detected</p>
              <p className="text-xs text-green-600 mt-1">
                Cloudflare's automatic DDoS mitigation is active and no attack vectors were triggered in the past ${data.meta?.days ?? 30} days.
              </p>
            </div>
          )}
        </div>
      </div>

      {/* ── Bot Management Section ───────────────────────────────────────── */}
      <div className="print-section-break pt-8 print:pt-14">
        <SectionHeader
          title="Bot Management"
          subtitle="Bot score classification and automated traffic analysis"
          icon={<Bot size={18} />}
          printBreak
        />

        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-4">
          <StatCard
            title="Automated (Score 1)"
            value={formatNumber(summary.crawlerRequests)}
            subtitle="Definitely automated — score 1"
            color="red"
          />
          <StatCard
            title="Likely Automated"
            value={`${likelyAutomatedPct}%`}
            subtitle="Score 2–29 combined"
            color="orange"
          />
          <StatCard
            title="Likely Human"
            value={`${humanPct}%`}
            subtitle="Score 30–99 (99 = most human)"
            color="green"
          />
          <StatCard
            title="Bot Management"
            value={data["botManagementConfig"] ? "Active" : "Unknown"}
            subtitle="JS fingerprinting enabled"
            color="purple"
          />
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {/* Bot time-series */}
          <TimeSeriesChart
            data={botChartData}
            title="Bot vs Human Traffic — Daily"
            subtitle="Daily breakdown of bot score categories"
            series={[
              { key: "human",     label: "Likely Human (30–99)",     color: "#16A34A" },
              { key: "likelyBot", label: "Likely Automated (2–29)",   color: "#7C3AED" },
              { key: "bot",       label: "Automated (Score 1)",        color: "#DC2626" },
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

        {/* Verified Bot Categories (Enterprise Bot Management) */}
        {(data.verifiedBotCategories ?? []).length > 0 && (
          <div className="bg-white rounded-xl shadow-sm border border-cf-gray-200 overflow-hidden">
            <div className="px-5 py-3 border-b border-cf-gray-100">
              <h3 className="text-sm font-semibold text-cf-navy">Verified Bot Categories</h3>
              <p className="text-xs text-cf-gray-500 mt-0.5">
                Breakdown of verified bot traffic by purpose (Enterprise Bot Management)
              </p>
            </div>
            <table className="w-full text-xs">
              <thead>
                <tr className="bg-cf-gray-50 text-cf-gray-500 uppercase tracking-wide text-[10px]">
                  <th className="px-4 py-2.5 text-left font-semibold">#</th>
                  <th className="px-4 py-2.5 text-left font-semibold">Category</th>
                  <th className="px-4 py-2.5 text-right font-semibold">Requests</th>
                  <th className="px-4 py-2.5 text-left font-semibold pl-4">Share</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-cf-gray-100">
                {(data.verifiedBotCategories ?? []).map((r, i) => {
                  const total = (data.verifiedBotCategories ?? []).reduce((s, x) => s + x.count, 0);
                  const pct = total > 0 ? ((r.count / total) * 100).toFixed(1) : "0";
                  return (
                    <tr key={r.category} className={i % 2 === 0 ? "bg-white" : "bg-cf-gray-50/40"}>
                      <td className="px-4 py-2 text-cf-gray-400 font-mono">{i + 1}</td>
                      <td className="px-4 py-2 font-medium text-cf-navy capitalize">{r.category}</td>
                      <td className="px-4 py-2 text-right font-mono font-bold text-cf-navy">{formatNumber(r.count)}</td>
                      <td className="px-4 py-2 pl-4">
                        <div className="flex items-center gap-2">
                          <div className="w-20 bg-cf-gray-100 rounded-full h-1.5 overflow-hidden">
                            <div className="h-full bg-yellow-400 rounded-full" style={{ width: `${pct}%` }} />
                          </div>
                          <span className="text-cf-gray-500">{pct}%</span>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
