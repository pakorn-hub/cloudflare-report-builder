/**
 * ZTRecommendationsSection — reframed as a Deployment Roadmap.
 * Shows Phase 1 (POC outcomes) → Phase 2 (quick wins) → Phase 3 (full SASE).
 * Each recommendation links to business impact, not just technical action.
 */
import { CheckCircle, ArrowRight, Zap, Target, TrendingUp } from "lucide-react";
import type { ZeroTrustData } from "../../types";
import SectionHeader from "../../components/SectionHeader";

const PRIORITY_STYLE = {
  high:   { bg: "#FEE2E2", text: "#DC2626", border: "#FECACA", dot: "#EF4444",  badge: "bg-red-100 text-red-700 border-red-200" },
  medium: { bg: "#FEF3C7", text: "#D97706", border: "#FDE68A", dot: "#F59E0B",  badge: "bg-yellow-100 text-yellow-700 border-yellow-200" },
  low:    { bg: "#F0FDF4", text: "#16A34A", border: "#BBF7D0", dot: "#10B981",  badge: "bg-green-100 text-green-700 border-green-200" },
};

function fmtBig(n: number): string {
  if (n >= 1_000_000_000) return `${(n / 1_000_000_000).toFixed(2)}B`;
  if (n >= 1_000_000)     return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000)         return `${(n / 1_000).toFixed(0)}K`;
  return n.toLocaleString();
}

export default function ZTRecommendationsSection({ data }: { data: ZeroTrustData }) {
  const recs   = data.recommendations ?? [];
  const s      = data.summary;
  const high   = recs.filter((r) => r.priority === "high");
  const medium = recs.filter((r) => r.priority === "medium");
  const low    = recs.filter((r) => r.priority === "low");

  // Compute POC outcomes for Phase 1 card
  const dnsBlocked   = s.gatewayDnsBlocked ?? 0;
  const dnsTotal     = s.gatewayDnsQueries ?? 0;
  const dnsPolicies  = (data.gatewayPolicies ?? []).filter((p) => p.ruleType === "dns").length;
  const accessApps   = data.accessApps?.length ?? 0;
  const pocOutcomes  = [
    dnsBlocked > 0 && `${fmtBig(dnsBlocked)} DNS threats blocked`,
    dnsTotal > 0 && `${fmtBig(dnsTotal)} DNS queries filtered`,
    dnsPolicies > 0 && `${dnsPolicies} Gateway DNS policies active`,
    accessApps > 0 && `${accessApps} apps behind Zero Trust Access`,
    s.uniqueUsers > 0 && `${s.uniqueUsers} users protected`,
  ].filter(Boolean) as string[];

  return (
    <section className="report-section">
      <SectionHeader icon={<Target size={20}/>} title="Deployment Roadmap &amp; Recommendations"
        subtitle="From POC success to full Cloudflare One deployment — prioritised next steps" />

      {/* Phase 1 — POC Outcomes */}
      <div className="bg-gradient-to-br from-green-50 to-emerald-50 border border-green-200 rounded-2xl p-5 mb-5">
        <div className="flex items-start gap-3 mb-4">
          <div className="w-8 h-8 bg-green-600 rounded-lg flex items-center justify-center flex-shrink-0">
            <CheckCircle size={16} className="text-white"/>
          </div>
          <div>
            <h3 className="text-sm font-bold text-green-800">Phase 1 — POC Complete ✓</h3>
            <p className="text-xs text-green-600 mt-0.5">Cloudflare One is actively protecting your organisation</p>
          </div>
        </div>
        {pocOutcomes.length > 0 ? (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
            {pocOutcomes.map((o) => (
              <div key={o} className="flex items-center gap-2 bg-white/70 rounded-lg px-3 py-2">
                <CheckCircle size={12} className="text-green-600 flex-shrink-0"/>
                <span className="text-xs font-medium text-green-800">{o}</span>
              </div>
            ))}
          </div>
        ) : (
          <p className="text-xs text-green-700">Cloudflare One is configured and protecting your organisation.</p>
        )}
      </div>

      {/* Phase 2 — Quick wins */}
      {high.length + medium.length > 0 && (
        <div className="mb-5">
          <div className="flex items-center gap-2 mb-3">
            <div className="w-6 h-6 bg-orange-500 rounded-md flex items-center justify-center">
              <Zap size={13} className="text-white"/>
            </div>
            <h3 className="text-sm font-bold text-cf-navy">Phase 2 — Quick Wins (Next 30 Days)</h3>
            <ArrowRight size={14} className="text-cf-gray-400"/>
            <p className="text-xs text-cf-gray-400">Expand protection across all traffic types</p>
          </div>
          <div className="space-y-3">
            {[...high, ...medium].map((r, i) => {
              const style = PRIORITY_STYLE[r.priority];
              return (
                <div key={i} className="bg-white rounded-xl border border-cf-gray-200 overflow-hidden flex">
                  <div className="w-1 flex-shrink-0" style={{ backgroundColor: style.dot }}/>
                  <div className="flex-1 p-4">
                    <div className="flex items-start justify-between gap-3 mb-1.5">
                      <h4 className="text-sm font-semibold text-cf-navy">{r.title}</h4>
                      <span className={`text-[10px] px-2 py-0.5 rounded-full font-bold border flex-shrink-0 ${style.badge}`}>
                        {r.priority.toUpperCase()}
                      </span>
                    </div>
                    <p className="text-xs text-cf-gray-600 leading-relaxed mb-2">{r.description}</p>
                    <div className="flex items-start gap-1.5 bg-blue-50 rounded-lg px-3 py-2 border border-blue-100">
                      <TrendingUp size={11} className="text-blue-500 flex-shrink-0 mt-0.5"/>
                      <p className="text-[10px] text-blue-700 font-medium">{r.benefit}</p>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Phase 3 — Full SASE */}
      {low.length > 0 && (
        <div className="mb-5">
          <div className="flex items-center gap-2 mb-3">
            <div className="w-6 h-6 bg-purple-600 rounded-md flex items-center justify-center">
              <Target size={13} className="text-white"/>
            </div>
            <h3 className="text-sm font-bold text-cf-navy">Phase 3 — Full SASE (60–90 Days)</h3>
            <ArrowRight size={14} className="text-cf-gray-400"/>
            <p className="text-xs text-cf-gray-400">Complete Zero Trust transformation</p>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {low.map((r, i) => {
              const style = PRIORITY_STYLE[r.priority];
              return (
                <div key={i} className="bg-white rounded-xl border border-cf-gray-200 p-4">
                  <div className="flex items-center gap-2 mb-1.5">
                    <div className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: style.dot }}/>
                    <h4 className="text-xs font-semibold text-cf-navy">{r.title}</h4>
                  </div>
                  <p className="text-[10px] text-cf-gray-500 leading-relaxed">{r.description}</p>
                  <p className="mt-2 text-[10px] text-green-700 font-medium">{r.benefit}</p>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* ROI callout */}
      <div className="bg-gradient-to-r from-blue-600 to-blue-800 rounded-2xl p-6 text-white">
        <h3 className="text-base font-bold mb-1">Why Cloudflare One for Full Deployment?</h3>
        <p className="text-blue-200 text-xs mb-5">One platform, one agent, one control plane — replacing fragmented point tools</p>
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          {[
            { stat: "~3×",  desc: "Faster than legacy VPN using QUIC / HTTP/3 transport" },
            { stat: "Zero", desc: "Inbound firewall rules — Tunnel connections are outbound-only" },
            { stat: "1",    desc: "Unified platform: ZTNA + SWG + CASB + DLP + Magic WAN" },
            { stat: "30%",  desc: "Avg. IT cost reduction vs. stitching multiple vendors" },
          ].map((item) => (
            <div key={item.stat} className="bg-white/10 rounded-xl p-3 text-center">
              <p className="text-2xl font-black text-white">{item.stat}</p>
              <p className="text-[10px] text-blue-200 mt-1 leading-tight">{item.desc}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
