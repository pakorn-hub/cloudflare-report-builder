/**
 * CostSavingsSection — bandwidth savings + interactive AWS vs Cloudflare cost calculator.
 *
 * Top half: CDN bandwidth savings from actual POC data.
 * Bottom half: Interactive cost calculator — pre-filled from API data,
 *              user can edit monthly requests / bandwidth / DNS queries
 *              to see live AWS cost breakdown vs Cloudflare.
 */
import { DollarSign, TrendingDown, Server, Info } from "lucide-react";
import SectionHeader from "../../components/SectionHeader";
import StatCard from "../../components/StatCard";
import CostCalculator from "../../components/CostCalculator";
import type { AppSecData } from "../../types";
import { formatBytes, formatNumber } from "../../utils/formatters";

interface Props { data: AppSecData }

export default function CostSavingsSection({ data }: Props) {
  const cs = data.summary.costSavings;
  const periodLabel = data.meta?.periodLabel ?? "30-Day";
  const days = data.meta?.days ?? 30;

  if (!cs) return null;

  const hasBandwidthSavings = cs.monthlyBandwidthSavings > 0 || cs.originBandwidthSavedGB > 0;

  // Default inputs for calculator from actual POC data (scaled to monthly)
  const scaleFactor = 30 / Math.max(days, 1);
  const defaultRequestsM    = Math.round((data.summary.totalRequests * scaleFactor) / 1_000_000 * 10) / 10;
  const defaultBandwidthGB  = Math.round((data.summary.totalBandwidthBytes * scaleFactor) / 1e9 * 10) / 10;
  const defaultDnsQueriesM  = Math.round(defaultRequestsM * 1.5 * 10) / 10;

  return (
    <section className="report-section">
      <SectionHeader
        title="Cost Savings Analysis"
        subtitle={`${periodLabel} bandwidth savings + interactive AWS vs Cloudflare cost calculator`}
        icon={<DollarSign size={18} />}
      />

      {/* ── Bandwidth Savings from POC ──────────────────────────────────── */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mt-4 print-keep-together">
        <StatCard
          title="Monthly Savings"
          value={`$${cs.monthlyBandwidthSavings.toLocaleString()}`}
          subtitle="Bandwidth cost avoided vs origin"
          icon={<DollarSign size={18} />}
          color="green"
        />
        <StatCard
          title="Annual Projection"
          value={`$${cs.annualBandwidthSavings.toLocaleString()}`}
          subtitle="12-month bandwidth saving"
          icon={<TrendingDown size={18} />}
          color="teal"
        />
        <StatCard
          title="Bandwidth Offloaded"
          value={`${cs.originBandwidthSavedGB.toFixed(1)} GB`}
          subtitle={`Of ${formatBytes(data.summary.totalBandwidthBytes)} total`}
          icon={<Server size={18} />}
          color="blue"
        />
        <StatCard
          title="Origin Load Reduced"
          value={`${cs.originLoadReductionPct}%`}
          subtitle={`${formatNumber(cs.originRequestsAvoided)} requests offloaded`}
          icon={<TrendingDown size={18} />}
          color="orange"
        />
      </div>

      {hasBandwidthSavings && (
        <div className="mt-4 bg-green-50 border border-green-200 rounded-xl p-4">
          <div className="space-y-1.5 text-sm text-green-800">
            <p>
              <span className="w-1.5 h-1.5 bg-green-500 rounded-full inline-block mr-2" />
              <strong>{cs.originBandwidthSavedGB.toFixed(1)} GB</strong> served from Cloudflare edge over {days} days — never hitting origin servers.
            </p>
            <p>
              <span className="w-1.5 h-1.5 bg-green-500 rounded-full inline-block mr-2" />
              At <strong>$0.085/GB</strong> (AWS CloudFront egress rate): <strong>${cs.monthlyBandwidthSavings.toLocaleString()}/month</strong> avoided in data transfer costs.
            </p>
            <p>
              <span className="w-1.5 h-1.5 bg-green-500 rounded-full inline-block mr-2" />
              <strong>{cs.originLoadReductionPct}% fewer requests</strong> reached origin — reducing compute and database load.
            </p>
          </div>
        </div>
      )}

      {/* ── Interactive Cost Calculator ─────────────────────────────────── */}
      <div className="mt-6">
        <div className="flex items-center gap-2 mb-2">
          <DollarSign size={16} className="text-red-600" />
          <h3 className="text-sm font-semibold text-cf-navy">
            If You Chose AWS Instead — Cost Calculator
          </h3>
        </div>
        <p className="text-xs text-cf-gray-500 mb-4">
          Pre-filled with your actual {periodLabel} POC traffic data (scaled to monthly).
          Edit any field to model different traffic volumes.
        </p>

        <CostCalculator
          defaultRequestsM={defaultRequestsM}
          defaultBandwidthGB={defaultBandwidthGB}
          defaultDnsQueriesM={defaultDnsQueriesM}
        />
      </div>

      {!hasBandwidthSavings && (
        <div className="mt-4 bg-blue-50 border border-blue-200 rounded-xl p-4 flex items-start gap-3">
          <Info size={16} className="text-blue-500 flex-shrink-0 mt-0.5" />
          <p className="text-sm text-blue-800">
            <strong>Cache optimization opportunity:</strong> Configure Edge Cache TTL and Cache Rules
            to increase cache efficiency and unlock significant bandwidth savings.
          </p>
         </div>
      )}
    </section>
  );
}
