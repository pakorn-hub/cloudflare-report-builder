/**
 * TrafficSourcesSection — Traffic Source Analysis
 * Shows: referrer breakdown pie chart, traffic category summary, top referrer table.
 */
import { ArrowUpRight } from "lucide-react";
import type { AppSecData, ReferrerData } from "../../types";
import { formatNumber } from "../../utils/formatters";
import SectionHeader from "../../components/SectionHeader";
import PieBreakdownChart from "../../components/charts/PieBreakdownChart";

interface Props {
  data: AppSecData;
}

const CATEGORY_COLORS: Record<ReferrerData["category"], string> = {
  direct:   "#3B82F6",
  search:   "#10B981",
  social:   "#8B5CF6",
  referral: "#F6821F",
};

const CATEGORY_LABELS: Record<ReferrerData["category"], string> = {
  direct:   "Direct / None",
  search:   "Search Engines",
  social:   "Social Media",
  referral: "Referral Sites",
};

const CATEGORY_DESC: Record<ReferrerData["category"], string> = {
  direct:   "Direct navigation or missing referrer header",
  search:   "Google, Bing, DuckDuckGo, Baidu, etc.",
  social:   "Facebook, Twitter, LinkedIn, Reddit, etc.",
  referral: "Other external websites linking to this zone",
};

export default function TrafficSourcesSection({ data }: Props) {
  const referrers = data.topReferrers ?? [];

  // Category totals come from `referrerCategoryTotals` (computed server-side
  // over a much larger sample of distinct referrer hosts), NOT by summing
  // `referrers` (a small top-N list for table display only). Summing the
  // top-N list under-counts categories whose hosts don't individually rank
  // in the top N — confirmed real-world symptom: "Search Engines: 0%" /
  // "Social Media: 0%" on a zone with billions of requests, because
  // google.com/facebook.com didn't happen to be in the top 20 individual
  // referrer hosts by raw count, even though real search/social traffic
  // existed further down the distribution.
  const byCategory = data.referrerCategoryTotals ?? referrers.reduce<Record<string, number>>((acc, r) => {
    acc[r.category] = (acc[r.category] ?? 0) + r.requests;
    return acc;
  }, {});

  const categoryPieData = (["direct", "search", "social", "referral"] as const)
    .filter((c) => (byCategory[c] ?? 0) > 0)
    .map((c) => ({
      name: CATEGORY_LABELS[c],
      value: byCategory[c] ?? 0,
      color: CATEGORY_COLORS[c],
    }));

  const totalRequests = (["direct", "search", "social", "referral"] as const)
    .reduce((s, c) => s + (byCategory[c] ?? 0), 0);

  return (
    <section className="report-section">
      <SectionHeader
        icon={<ArrowUpRight size={20} />}
        title="Traffic Sources"
        subtitle="Where your visitors are coming from — direct, search, social, and referral traffic"
      />

      {referrers.length === 0 ? (
        <div className="bg-white rounded-xl border border-cf-gray-200 p-8 text-center">
          <p className="text-cf-gray-400 text-sm">No referrer data available for this zone.</p>
        </div>
      ) : (
        <div className="space-y-6">
          {/* Category summary cards */}
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
            {(["direct", "search", "social", "referral"] as const).map((cat) => {
              const count = byCategory[cat] ?? 0;
              const pct = totalRequests > 0 ? ((count / totalRequests) * 100).toFixed(1) : "0.0";
              return (
                <div key={cat} className="bg-white rounded-xl shadow-sm border border-cf-gray-200 p-4">
                  <div
                    className="w-8 h-1.5 rounded-full mb-3"
                    style={{ backgroundColor: CATEGORY_COLORS[cat] }}
                  />
                  <p className="text-lg font-bold text-cf-navy">{pct}%</p>
                  <p className="text-xs font-semibold text-cf-gray-700 mt-0.5">{CATEGORY_LABELS[cat]}</p>
                  <p className="text-xs text-cf-gray-400 mt-0.5">{formatNumber(count)} requests</p>
                  <p className="text-[10px] text-cf-gray-500 mt-1 leading-tight">{CATEGORY_DESC[cat]}</p>
                </div>
              );
            })}
          </div>

          {/* Pie chart + All Referrers table side by side */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 items-start">
            {categoryPieData.length > 0 && (
              <PieBreakdownChart
                data={categoryPieData}
                title="Traffic Source Distribution"
                subtitle="By request volume"
                colors={categoryPieData.map((d) => d.color)}
                height={300}
                innerRadius={65}
              />
            )}

            <div className="bg-white rounded-xl shadow-sm border border-cf-gray-200 overflow-hidden">
              <div className="px-5 py-3 border-b border-cf-gray-100">
                <h3 className="text-sm font-semibold text-cf-navy">All Referrers</h3>
                <p className="text-xs text-cf-gray-500 mt-0.5">
                  Top {referrers.length} referrers — sorted by request count
                </p>
              </div>
              <div className="overflow-y-auto max-h-[280px]">
                <table className="w-full text-xs">
                  <thead className="sticky top-0">
                    <tr className="bg-cf-gray-50 text-cf-gray-500 uppercase tracking-wide text-[10px]">
                      <th className="px-3 py-2 text-left font-semibold">#</th>
                      <th className="px-3 py-2 text-left font-semibold">Referrer</th>
                      <th className="px-3 py-2 text-left font-semibold">Cat.</th>
                      <th className="px-3 py-2 text-right font-semibold">Req.</th>
                      <th className="px-3 py-2 text-right font-semibold">%</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-cf-gray-100">
                    {referrers.map((r, i) => {
                      const pct = totalRequests > 0
                        ? ((r.requests / totalRequests) * 100).toFixed(1)
                        : "0.0";
                      return (
                        <tr key={`${r.refererHost}-all-${i}`} className={i % 2 === 0 ? "bg-white" : "bg-cf-gray-50/40"}>
                          <td className="px-3 py-1.5 text-cf-gray-400 font-mono">{i + 1}</td>
                          <td className="px-3 py-1.5 font-medium text-cf-navy max-w-[180px] truncate" title={r.refererHost}>
                            {r.refererHost === "(direct)" ? (
                              <span className="text-cf-gray-400 italic">Direct</span>
                            ) : r.refererHost}
                          </td>
                          <td className="px-3 py-1.5">
                            <span
                              className="inline-block px-1.5 py-0.5 rounded-full text-[9px] font-semibold text-white"
                              style={{ backgroundColor: CATEGORY_COLORS[r.category] }}
                            >
                              {r.category.slice(0, 3)}
                            </span>
                          </td>
                          <td className="px-3 py-1.5 text-right font-mono text-cf-gray-700">
                            {formatNumber(r.requests)}
                          </td>
                          <td className="px-3 py-1.5 text-right text-cf-gray-500">
                            {pct}%
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}
