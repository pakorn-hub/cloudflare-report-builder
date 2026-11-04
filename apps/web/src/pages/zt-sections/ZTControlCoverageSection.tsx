/**
 * ZTControlCoverageSection — Control Coverage & Effectiveness
 *
 * SSE-competitor-standard "coverage vs total" reporting (Zscaler/Prisma/
 * Netskope executive reports all lead with this): not just "here is an
 * event count" but "how much of the environment is actually protected,
 * and which configured controls are provably doing nothing this period".
 * All values are derived from data already fetched for other sections —
 * no new external API calls, no fabricated denominators (e.g. no attempt
 * to guess a "total device count" the API doesn't expose).
 */
import { ShieldCheck, AlertTriangle } from "lucide-react";
import type { ZeroTrustData } from "../../types";
import SectionHeader from "../../components/SectionHeader";

function CoverageBar({ label, numerator, denominator, color }: { label: string; numerator: number; denominator: number; color: string }) {
  const pct = denominator > 0 ? Math.round((numerator / denominator) * 100) : 0;
  return (
    <div>
      <div className="flex items-center justify-between mb-1">
        <span className="text-xs font-medium text-cf-navy">{label}</span>
        <span className="text-xs font-bold tabular-nums" style={{ color }}>{numerator}/{denominator} ({pct}%)</span>
      </div>
      <div className="w-full bg-cf-gray-100 rounded-full h-2 overflow-hidden">
        <div className="h-full rounded-full" style={{ width: `${pct}%`, backgroundColor: color }} />
      </div>
    </div>
  );
}

export default function ZTControlCoverageSection({ data }: { data: ZeroTrustData }) {
  const cc = data.controlCoverage;
  if (!cc) return null;

  const { access, gatewayDns, gatewayHttp, gatewayL4, seats } = cc;
  const hasAnyPolicy = gatewayDns.totalPolicies + gatewayHttp.totalPolicies + gatewayL4.totalPolicies > 0;

  return (
    <section className="report-section">
      <SectionHeader icon={<ShieldCheck size={20}/>} title="Control Coverage & Effectiveness"
        subtitle="Coverage vs. total — not just what happened, but how much of the environment is actually protected and which configured controls saw zero real-world use this period" />

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 mb-4">
        {/* Access coverage */}
        <div className="bg-white rounded-xl shadow-sm border border-cf-gray-200 p-4">
          <h3 className="text-xs font-bold text-cf-navy uppercase tracking-wide mb-3">Access Applications</h3>
          <div className="space-y-3">
            <CoverageBar label="Apps enabled" numerator={access.enabledApps} denominator={access.totalApps} color="#3B82F6" />
            <CoverageBar label="Apps with ≥1 policy" numerator={access.appsWithPolicies} denominator={access.totalApps} color="#10B981" />
            <CoverageBar label="Apps requiring MFA" numerator={access.appsWithMfa} denominator={access.totalApps} color="#7C3AED" />
          </div>
          {access.appsWithoutPolicies > 0 && (
            <div className="mt-3 flex items-start gap-2 bg-red-50 border border-red-100 rounded-lg px-2.5 py-2">
              <AlertTriangle size={13} className="text-red-500 flex-shrink-0 mt-0.5" />
              <p className="text-[11px] text-red-700">
                {access.appsWithoutPolicies} app{access.appsWithoutPolicies === 1 ? "" : "s"} configured with <strong>zero Access policies</strong> — likely misconfigured or unintentionally unprotected.
              </p>
            </div>
          )}
        </div>

        {/* Gateway policy coverage */}
        <div className="bg-white rounded-xl shadow-sm border border-cf-gray-200 p-4">
          <h3 className="text-xs font-bold text-cf-navy uppercase tracking-wide mb-3">Gateway Policy Coverage</h3>
          {hasAnyPolicy ? (
            <div className="space-y-3">
              <CoverageBar label="DNS policies enabled" numerator={gatewayDns.enabledPolicies} denominator={gatewayDns.totalPolicies} color="#F59E0B" />
              <CoverageBar label="HTTP policies enabled" numerator={gatewayHttp.enabledPolicies} denominator={gatewayHttp.totalPolicies} color="#0EA5E9" />
              <CoverageBar label="Network (L4) policies enabled" numerator={gatewayL4.enabledPolicies} denominator={gatewayL4.totalPolicies} color="#8B5CF6" />
            </div>
          ) : (
            <p className="text-xs text-cf-gray-400">No Gateway policies configured yet.</p>
          )}
        </div>

        {/* Seat activity */}
        <div className="bg-white rounded-xl shadow-sm border border-cf-gray-200 p-4">
          <h3 className="text-xs font-bold text-cf-navy uppercase tracking-wide mb-3">License / Seat Activity</h3>
          <div className="space-y-3">
            <CoverageBar label="Seats active this period" numerator={seats.activeInPeriod} denominator={seats.total} color="#10B981" />
          </div>
          {seats.neverLoggedIn > 0 && (
            <div className="mt-3 flex items-start gap-2 bg-yellow-50 border border-yellow-100 rounded-lg px-2.5 py-2">
              <AlertTriangle size={13} className="text-yellow-600 flex-shrink-0 mt-0.5" />
              <p className="text-[11px] text-yellow-700">
                {seats.neverLoggedIn} of {seats.total} provisioned seats have never logged in — review for stale/unused licenses.
              </p>
            </div>
          )}
        </div>
      </div>

      {/* Unused DNS policies — real, from per-policy query counts this period */}
      {gatewayDns.unusedPolicies.length > 0 && (
        <div className="bg-white rounded-xl shadow-sm border border-cf-gray-200 p-4">
          <div className="flex items-center gap-2 mb-2">
            <AlertTriangle size={14} className="text-orange-500" />
            <h3 className="text-xs font-bold text-cf-navy uppercase tracking-wide">
              Unused DNS Policies This Period ({gatewayDns.unusedPolicies.length})
            </h3>
          </div>
          <p className="text-[11px] text-cf-gray-500 mb-3">
            These DNS policies are enabled but matched zero queries in the report period — verify they are correctly scoped, still needed, or safe to remove.
          </p>
          <div className="flex flex-wrap gap-2">
            {gatewayDns.unusedPolicies.map((p) => (
              <span key={p.name} className="text-[11px] font-medium px-2.5 py-1 rounded-full bg-orange-50 text-orange-700 border border-orange-100">
                {p.name}
              </span>
            ))}
          </div>
        </div>
      )}
    </section>
  );
}
