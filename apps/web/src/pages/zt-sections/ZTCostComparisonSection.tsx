import { DollarSign } from "lucide-react";
import type { ZeroTrustData } from "../../types";
import SectionHeader from "../../components/SectionHeader";

// Competitor per-user/month pricing (2024/2025 public estimates)
const SASE_COMPETITORS = [
  { name: "Zscaler Internet Access (ZIA)",  perUser: 14,  features: ["DNS Security","CASB","SSL Inspection","Sandbox"] },
  { name: "Palo Alto Prisma Access",        perUser: 20,  features: ["ZTNA","SWG","CASB","DLP"] },
  { name: "Cisco Umbrella (DNS Advantage)", perUser: 8,   features: ["DNS Security","CASB","IPS"] },
  { name: "Netskope (Core Bundle)",         perUser: 16,  features: ["SWG","CASB","ZTNA","DLP"] },
  { name: "Cloudflare One (All-in-one)",    perUser: 8,   features: ["Access (ZTNA)","Gateway (SWG)","WARP","DLP","Magic WAN"], cloudflare: true },
];

export default function ZTCostComparisonSection({ data }: { data: ZeroTrustData }) {
  // Use the real detected user count as-is — never substitute a fabricated
  // floor. If genuinely 0 users were detected this period, show that
  // honestly rather than silently rendering a fictional "10 users" figure.
  const users   = data.summary.uniqueUsers;
  const days    = data.meta.days;
  const months  = Math.max(1, Math.round(days / 30));

  if (users <= 0) {
    return (
      <section className="report-section">
        <SectionHeader icon={<DollarSign size={20}/>} title="Cost Comparison — Cloudflare One vs SASE Vendors"
          subtitle="Per-user monthly pricing comparison based on active users in this POC period" />
        <div className="bg-white rounded-xl border border-cf-gray-200 p-8 text-center">
          <p className="text-cf-gray-400 text-sm">No active users detected in this period — cost comparison requires at least one authenticated Access session.</p>
        </div>
      </section>
    );
  }

  return (
    <section className="report-section">
      <SectionHeader icon={<DollarSign size={20}/>} title="Cost Comparison — Cloudflare One vs SASE Vendors"
        subtitle="Per-user monthly pricing comparison based on active users in this POC period" />

      <div className="mb-4 bg-blue-50 border border-blue-200 rounded-xl p-4 flex items-start gap-3">
        <DollarSign size={16} className="text-blue-500 flex-shrink-0 mt-0.5"/>
        <div>
          <p className="text-xs font-semibold text-blue-700">Based on {users.toLocaleString()} active users detected in this {data.meta.periodLabel} POC</p>
          <p className="text-xs text-blue-600 mt-0.5">Annual estimates extrapolated. Actual pricing varies by contract, tier, and add-ons. Contact your Cloudflare rep for a formal quote.</p>
        </div>
      </div>

      <div className="space-y-3">
        {SASE_COMPETITORS.map((v) => {
          const monthly = users * v.perUser;
          const annual  = monthly * 12;
          const isCloudflare = v.cloudflare === true;
          return (
            <div key={v.name} className={`rounded-xl border p-4 ${isCloudflare ? "border-cf-orange bg-cf-orange/5" : "border-cf-gray-200 bg-white"}`}>
              <div className="flex items-start justify-between gap-4 flex-wrap">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <h3 className={`text-sm font-bold ${isCloudflare ? "text-cf-orange" : "text-cf-navy"}`}>{v.name}</h3>
                    {isCloudflare && <span className="text-[10px] bg-cf-orange text-white px-2 py-0.5 rounded-full font-semibold">Your POC Product</span>}
                  </div>
                  <div className="flex flex-wrap gap-1.5 mt-2">
                    {v.features.map((f) => (
                      <span key={f} className={`text-[10px] px-2 py-0.5 rounded-full border ${isCloudflare ? "bg-white border-cf-orange/30 text-cf-orange" : "bg-cf-gray-50 border-cf-gray-200 text-cf-gray-600"}`}>{f}</span>
                    ))}
                  </div>
                </div>
                <div className="text-right flex-shrink-0">
                  <p className="text-[10px] text-cf-gray-500 uppercase tracking-wide">Per user / month</p>
                  <p className={`text-2xl font-black ${isCloudflare ? "text-cf-orange" : "text-cf-navy"}`}>${v.perUser}</p>
                  <p className="text-[10px] text-cf-gray-400 mt-1">${monthly.toLocaleString()}/mo · ${annual.toLocaleString()}/yr for {users.toLocaleString()} users</p>
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {/* Savings summary */}
      {(() => {
        const cfCost   = users * 8 * 12;
        const avgComp  = users * ((14 + 20 + 8 + 16) / 4) * 12;
        const saving   = avgComp - cfCost;
        return saving > 0 ? (
          <div className="mt-5 bg-green-50 border border-green-200 rounded-xl p-4">
            <p className="text-sm font-bold text-green-700">Estimated annual savings vs SASE competitors</p>
            <p className="text-3xl font-black text-green-600 mt-1">${saving.toLocaleString()}</p>
            <p className="text-xs text-green-600 mt-1">Based on {users.toLocaleString()} users switching from average competitor pricing (${Math.round((14+20+8+16)/4)}/user/mo) to Cloudflare One ($8/user/mo)</p>
          </div>
        ) : null;
      })()}
    </section>
  );
}
