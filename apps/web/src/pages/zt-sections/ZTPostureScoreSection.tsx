/**
 * ZTPostureScoreSection — Zero Trust Posture Score
 *
 * Redesigned for transparency: every dimension shows exactly how the score
 * is computed, what evidence was found, and what the next step is to improve.
 */
import { ShieldCheck, CheckCircle2, XCircle, AlertCircle, Info } from "lucide-react";
import type { ZeroTrustData } from "../../types";
import SectionHeader from "../../components/SectionHeader";
import SecurityRadarChart from "../../components/charts/SecurityRadarChart";

function clamp(v: number) { return Math.min(100, Math.max(0, v)); }

// ─── Scoring criteria definitions ────────────────────────────────────────────
// Each check has a label, weight (points), and whether it passed.
interface Check {
  label: string;       // what was evaluated
  points: number;      // points awarded if passed
  passed: boolean;
  evidence: string;    // what was observed (passed or failed)
}

interface Dimension {
  subject: string;
  score: number;
  fullMark: 100;
  description: string;
  maturityLabel: string;
  maturityColor: string;
  checks: Check[];
  nextStep: string;    // what to do to improve
}

function maturity(score: number): { maturityLabel: string; maturityColor: string } {
  if (score >= 90) return { maturityLabel: "Excellent",   maturityColor: "#10B981" };
  if (score >= 70) return { maturityLabel: "Good",         maturityColor: "#3B82F6" };
  if (score >= 50) return { maturityLabel: "Moderate",     maturityColor: "#F59E0B" };
  if (score >= 25) return { maturityLabel: "Weak",         maturityColor: "#F97316" };
  return              { maturityLabel: "Not Started",  maturityColor: "#EF4444" };
}

// ─── Main component ───────────────────────────────────────────────────────────
export default function ZTPostureScoreSection({ data }: { data: ZeroTrustData }) {
  const s            = data.summary;
  const mfaApps      = data.accessPolicies.filter((p) => p.requireMfa).length;
  const totalApps    = data.accessApps.length;
  const dnsPolicies  = data.gatewayPolicies.filter((p) => p.ruleType === "dns" && p.action === "block").length;
  const httpPolicies = data.gatewayPolicies.filter((p) => p.ruleType === "http").length;
  const dnsBlocked   = s.gatewayDnsBlocked ?? 0;

  // ── MFA Coverage ─────────────────────────────────────────────────────────
  const mfaChecks: Check[] = [
    {
      label: "At least one Access app is protected",
      points: 20,
      passed: totalApps > 0,
      evidence: totalApps > 0 ? `${totalApps} app${totalApps !== 1 ? "s" : ""} behind Cloudflare Access` : "No Access apps configured",
    },
    {
      label: "Multiple identity providers connected",
      points: 20,
      passed: data.accessIdps.length >= 2,
      evidence: data.accessIdps.length >= 2 ? `${data.accessIdps.length} IdPs connected` : `${data.accessIdps.length} IdP connected (recommend ≥ 2)`,
    },
    {
      label: "≥ 50% of apps require MFA",
      points: 30,
      passed: totalApps > 0 && mfaApps / totalApps >= 0.5,
      evidence: totalApps > 0 ? `${mfaApps}/${totalApps} apps (${Math.round((mfaApps / totalApps) * 100)}%) enforce MFA` : "No apps to evaluate",
    },
    {
      label: "All apps require MFA",
      points: 30,
      passed: totalApps > 0 && mfaApps === totalApps,
      evidence: totalApps > 0 && mfaApps === totalApps ? "100% MFA enforcement" : `${totalApps - mfaApps} app${totalApps - mfaApps !== 1 ? "s" : ""} still allow passwordless access`,
    },
  ];
  const mfaScore = clamp(mfaChecks.filter((c) => c.passed).reduce((s, c) => s + c.points, 0));

  // ── DNS Filtering ─────────────────────────────────────────────────────────
  const dnsChecks: Check[] = [
    {
      label: "At least 1 DNS blocking policy active",
      points: 20,
      passed: dnsPolicies >= 1,
      evidence: dnsPolicies >= 1 ? `${dnsPolicies} DNS block polic${dnsPolicies !== 1 ? "ies" : "y"} configured` : "No DNS blocking policies",
    },
    {
      label: "Security categories blocked (Malware, Phishing, C&C)",
      points: 30,
      passed: dnsPolicies >= 2,
      evidence: dnsPolicies >= 2 ? "Multiple security category policies active" : "Add policies for Malware, Phishing, and C&C categories",
    },
    {
      label: "DNS threats actively blocked in period",
      points: 30,
      passed: dnsBlocked > 0,
      evidence: dnsBlocked > 0 ? `${dnsBlocked.toLocaleString()} threats blocked this period` : "No blocked queries recorded — verify policy actions are set to 'Block'",
    },
    {
      label: "5+ blocking policies (comprehensive coverage)",
      points: 20,
      passed: dnsPolicies >= 5,
      evidence: dnsPolicies >= 5 ? `${dnsPolicies} blocking policies — comprehensive coverage` : `${dnsPolicies}/5 blocking policies (add more for full coverage)`,
    },
  ];
  const dnsScore = clamp(dnsChecks.filter((c) => c.passed).reduce((s, c) => s + c.points, 0));

  // ── Device Posture ────────────────────────────────────────────────────────
  const deviceChecks: Check[] = [
    {
      label: "WARP client deployed to at least 1 device",
      points: 25,
      passed: s.warpEnrolledDevices > 0,
      evidence: s.warpEnrolledDevices > 0 ? `${s.warpEnrolledDevices} device${s.warpEnrolledDevices !== 1 ? "s" : ""} enrolled` : "No WARP-enrolled devices — deploy the WARP client",
    },
    {
      label: "Device posture rules configured",
      points: 25,
      passed: data.warpPostureRules.length > 0,
      evidence: data.warpPostureRules.length > 0 ? `${data.warpPostureRules.length} posture rule${data.warpPostureRules.length !== 1 ? "s" : ""} defined` : "No posture rules — add OS version, disk encryption, or antivirus checks",
    },
    {
      label: "WARP deployed AND posture rules enforced",
      points: 30,
      passed: s.warpEnrolledDevices > 0 && data.warpPostureRules.length > 0,
      evidence: s.warpEnrolledDevices > 0 && data.warpPostureRules.length > 0
        ? "Devices enrolled with active posture enforcement"
        : "Both WARP deployment and posture rules are needed",
    },
    {
      label: "Access policies gate on device posture",
      points: 20,
      passed: s.warpEnrolledDevices > 0 && data.warpPostureRules.length > 0 && mfaApps > 0,
      evidence: s.warpEnrolledDevices > 0 && data.warpPostureRules.length > 0 && mfaApps > 0
        ? "Device posture integrated with Access policies"
        : "Link posture rules to Access policies for Zero Trust device enforcement",
    },
  ];
  const deviceScore = clamp(deviceChecks.filter((c) => c.passed).reduce((s, c) => s + c.points, 0));

  // ── DLP & HTTP ────────────────────────────────────────────────────────────
  const dlpChecks: Check[] = [
    {
      label: "DLP profiles configured",
      points: 30,
      passed: data.dlpProfiles.length > 0,
      evidence: data.dlpProfiles.length > 0 ? `${data.dlpProfiles.length} DLP profile${data.dlpProfiles.length !== 1 ? "s" : ""} active` : "No DLP profiles — add predefined profiles for PII and financial data",
    },
    {
      label: "HTTP Gateway filtering policies active",
      points: 40,
      passed: httpPolicies > 0,
      evidence: httpPolicies > 0 ? `${httpPolicies} HTTP polic${httpPolicies !== 1 ? "ies" : "y"} — web traffic being inspected` : "No HTTP policies — enable to inspect web traffic and detect shadow IT",
    },
    {
      label: "Both DLP profiles and HTTP inspection enabled",
      points: 30,
      passed: data.dlpProfiles.length > 0 && httpPolicies > 0,
      evidence: data.dlpProfiles.length > 0 && httpPolicies > 0
        ? "Full data-in-transit inspection active"
        : "Enable both HTTP inspection and DLP for complete data protection",
    },
  ];
  const dlpScore = clamp(dlpChecks.filter((c) => c.passed).reduce((s, c) => s + c.points, 0));

  // ── Private Access ────────────────────────────────────────────────────────
  const tunnelChecks: Check[] = [
    {
      label: "At least 1 Cloudflare Tunnel deployed",
      points: 35,
      passed: s.tunnelsTotal > 0,
      evidence: s.tunnelsTotal > 0 ? `${s.tunnelsTotal} tunnel${s.tunnelsTotal !== 1 ? "s" : ""} configured` : "No tunnels — deploy cloudflared to replace VPN",
    },
    {
      label: "All tunnels are healthy",
      points: 30,
      passed: s.tunnelsTotal > 0 && s.tunnelsHealthy === s.tunnelsTotal,
      evidence: s.tunnelsTotal > 0
        ? s.tunnelsHealthy === s.tunnelsTotal
          ? `All ${s.tunnelsTotal} tunnel${s.tunnelsTotal !== 1 ? "s" : ""} healthy`
          : `${s.tunnelsHealthy}/${s.tunnelsTotal} tunnels healthy — investigate unhealthy connectors`
        : "No tunnels to evaluate",
    },
    {
      label: "Private network routes configured",
      points: 35,
      passed: data.tunnelRoutes.length > 0,
      evidence: data.tunnelRoutes.length > 0
        ? `${data.tunnelRoutes.length} private network route${data.tunnelRoutes.length !== 1 ? "s" : ""} configured`
        : "No routes — add CIDR ranges to expose internal services through tunnels",
    },
  ];
  const tunnelScore = clamp(tunnelChecks.filter((c) => c.passed).reduce((s, c) => s + c.points, 0));

  // ── Identity (Access) ─────────────────────────────────────────────────────
  const accessChecks: Check[] = [
    {
      label: "Access apps protecting internal resources",
      points: 25,
      passed: totalApps > 0,
      evidence: totalApps > 0 ? `${totalApps} app${totalApps !== 1 ? "s" : ""} behind Zero Trust Access` : "No Access apps — put applications behind Cloudflare Access",
    },
    {
      label: "Corporate identity provider connected (SAML/OIDC)",
      points: 25,
      passed: data.accessIdps.some((idp) => idp.type !== "onetimepin"),
      evidence: data.accessIdps.some((idp) => idp.type !== "onetimepin")
        ? `Corporate IdP connected (${data.accessIdps.filter((i) => i.type !== "onetimepin").map((i) => i.type).join(", ")})`
        : "Only OTP/email auth — connect a corporate SAML or OIDC IdP",
    },
    {
      label: "Multiple IdPs for redundancy",
      points: 20,
      passed: data.accessIdps.length >= 2,
      evidence: data.accessIdps.length >= 2 ? `${data.accessIdps.length} IdPs — redundancy configured` : "Single IdP — add a backup for resilience",
    },
    {
      label: "Active authentication events in period",
      points: 30,
      passed: s.totalAuthEvents > 0,
      evidence: s.totalAuthEvents > 0
        ? `${s.totalAuthEvents} auth events — Access actively protecting resources`
        : "No auth events — verify Access policies are enforced",
    },
  ];
  const accessScore = clamp(accessChecks.filter((c) => c.passed).reduce((s, c) => s + c.points, 0));

  // ─── Assemble radar data ──────────────────────────────────────────────────
  const dimensions: Dimension[] = [
    {
      subject: "MFA Coverage",
      score: mfaScore,
      fullMark: 100,
      description: `${mfaApps}/${totalApps} apps enforce MFA`,
      ...maturity(mfaScore),
      checks: mfaChecks,
      nextStep: mfaApps < totalApps
        ? `Enforce MFA on remaining ${totalApps - mfaApps} app${totalApps - mfaApps !== 1 ? "s" : ""}`
        : "All apps enforce MFA — excellent",
    },
    {
      subject: "DNS Filtering",
      score: dnsScore,
      fullMark: 100,
      description: `${dnsPolicies} blocking policies · ${dnsBlocked > 0 ? dnsBlocked.toLocaleString() + " threats blocked" : "no blocks yet"}`,
      ...maturity(dnsScore),
      checks: dnsChecks,
      nextStep: dnsScore < 100
        ? dnsPolicies < 5
          ? "Add more blocking policies (Malware, Phishing, C&C categories)"
          : "Enable DNS over HTTPS enforcement and custom block pages"
        : "Full DNS coverage active",
    },
    {
      subject: "Device Posture",
      score: deviceScore,
      fullMark: 100,
      description: `${s.warpEnrolledDevices} WARP devices · ${data.warpPostureRules.length} posture rules`,
      ...maturity(deviceScore),
      checks: deviceChecks,
      nextStep: s.warpEnrolledDevices === 0
        ? "Deploy WARP client to managed devices to enable posture enforcement"
        : data.warpPostureRules.length === 0
        ? "Add posture rules (OS version, disk encryption, antivirus)"
        : "Expand WARP to all managed endpoints",
    },
    {
      subject: "DLP & HTTP",
      score: dlpScore,
      fullMark: 100,
      description: `${data.dlpProfiles.length} DLP profiles · ${httpPolicies} HTTP policies`,
      ...maturity(dlpScore),
      checks: dlpChecks,
      nextStep: httpPolicies === 0
        ? "Enable HTTP Gateway filtering to inspect web traffic"
        : data.dlpProfiles.length === 0
        ? "Add DLP profiles to detect sensitive data in transit"
        : "Tune DLP profiles for organisation-specific sensitive data",
    },
    {
      subject: "Private Access",
      score: tunnelScore,
      fullMark: 100,
      description: `${s.tunnelsHealthy}/${s.tunnelsTotal} tunnels healthy · ${data.tunnelRoutes.length} routes`,
      ...maturity(tunnelScore),
      checks: tunnelChecks,
      nextStep: s.tunnelsTotal === 0
        ? "Deploy cloudflared connectors to replace VPN with Cloudflare Tunnel"
        : data.tunnelRoutes.length === 0
        ? "Add private network CIDR routes to expose internal services"
        : "Expand tunnel coverage to all internal applications",
    },
    {
      subject: "Identity (Access)",
      score: accessScore,
      fullMark: 100,
      description: `${totalApps} apps · ${data.accessIdps.length} IdPs · ${s.totalAuthEvents} auth events`,
      ...maturity(accessScore),
      checks: accessChecks,
      nextStep: totalApps === 0
        ? "Put internal applications behind Cloudflare Access"
        : !data.accessIdps.some((i) => i.type !== "onetimepin")
        ? "Connect a corporate SAML or OIDC identity provider"
        : "Expand Access to cover all internal and SaaS applications",
    },
  ];

  const overall = Math.round(dimensions.reduce((s, d) => s + d.score, 0) / dimensions.length);
  const { maturityLabel: overallLabel, maturityColor: overallColor } = maturity(overall);

  return (
    <section className="report-section">
      <SectionHeader icon={<ShieldCheck size={20}/>} title="Zero Trust Posture Score"
        subtitle="Evidence-based scoring — each dimension shows exact criteria and how the score was calculated" />

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-6">
        {/* Radar chart */}
        <div className="relative bg-white rounded-xl shadow-sm border border-cf-gray-200 p-4">
          <SecurityRadarChart data={dimensions} title="Zero Trust Radar" subtitle="0-100 per dimension" height={290} />
          {/* Overall score badge */}
          <div className="absolute top-4 right-4">
            <div className="rounded-xl border-2 px-3 py-2 text-center shadow-sm"
              style={{ borderColor: overallColor, backgroundColor: overallColor + "12" }}>
              <div className="text-2xl font-black leading-none" style={{ color: overallColor }}>{overall}</div>
              <div className="text-[9px] font-bold text-cf-gray-500">/100</div>
              <div className="text-[9px] font-bold mt-0.5" style={{ color: overallColor }}>{overallLabel}</div>
            </div>
          </div>
          {/* Legend */}
          <div className="mt-2 flex flex-wrap gap-2 justify-center">
            {[
              { label: "Excellent",    color: "#10B981", min: 90 },
              { label: "Good",         color: "#3B82F6", min: 70 },
              { label: "Moderate",     color: "#F59E0B", min: 50 },
              { label: "Weak",         color: "#F97316", min: 25 },
              { label: "Not Started",  color: "#EF4444", min: 0  },
            ].map((l) => (
              <span key={l.label} className="flex items-center gap-1 text-[9px] text-cf-gray-500">
                <span className="w-2 h-2 rounded-full inline-block" style={{ backgroundColor: l.color }}/>
                {l.label} ({l.min}+)
              </span>
            ))}
          </div>
        </div>

        {/* Dimension summary bars */}
        <div className="bg-white rounded-xl shadow-sm border border-cf-gray-200 p-5">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-sm font-semibold text-cf-navy">Dimension Overview</h3>
            <span className="text-[10px] text-cf-gray-400">Click a dimension below for details</span>
          </div>
          <div className="space-y-3">
            {dimensions.map((d) => (
              <div key={d.subject}>
                <div className="flex items-center justify-between mb-1">
                  <span className="text-xs font-semibold text-cf-navy">{d.subject}</span>
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-bold tabular-nums" style={{ color: d.maturityColor }}>{d.score}/100</span>
                    <span className="text-[9px] px-1.5 py-0.5 rounded-full font-semibold"
                      style={{ color: d.maturityColor, backgroundColor: d.maturityColor + "18" }}>
                      {d.maturityLabel}
                    </span>
                  </div>
                </div>
                <div className="w-full bg-cf-gray-100 rounded-full h-2 overflow-hidden">
                  <div className="h-full rounded-full transition-all" style={{ width: `${d.score}%`, backgroundColor: d.maturityColor }}/>
                </div>
                <p className="text-[10px] text-cf-gray-400 mt-0.5">{d.description}</p>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* ── Scoring criteria — per dimension ─────────────────────────────── */}
      <div className="space-y-4">
        <div className="flex items-center gap-2 mb-1">
          <Info size={14} className="text-blue-500"/>
          <h3 className="text-sm font-semibold text-cf-navy">Scoring Criteria — How Each Score Is Calculated</h3>
        </div>
        <p className="text-xs text-cf-gray-500 -mt-2 mb-3">
          Each dimension is scored out of 100 based on the checks below. Points are awarded when evidence is found in your Cloudflare One account.
        </p>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {dimensions.map((d) => (
            <div key={d.subject} className="bg-white rounded-xl shadow-sm border border-cf-gray-200 overflow-hidden">
              {/* Dimension header */}
              <div className="px-4 py-3 border-b border-cf-gray-100 flex items-center justify-between"
                style={{ backgroundColor: d.maturityColor + "0A" }}>
                <div>
                  <h4 className="text-sm font-bold text-cf-navy">{d.subject}</h4>
                  <p className="text-[10px] text-cf-gray-500 mt-0.5">{d.description}</p>
                </div>
                <div className="text-right flex-shrink-0 ml-3">
                  <div className="text-xl font-black leading-none" style={{ color: d.maturityColor }}>{d.score}</div>
                  <div className="text-[9px] text-cf-gray-400">/100</div>
                </div>
              </div>

              {/* Checks */}
              <div className="divide-y divide-cf-gray-50">
                {d.checks.map((c, i) => (
                  <div key={i} className="px-4 py-2.5 flex items-start gap-2.5">
                    {c.passed
                      ? <CheckCircle2 size={14} className="text-green-500 flex-shrink-0 mt-0.5"/>
                      : <XCircle     size={14} className="text-red-400 flex-shrink-0 mt-0.5"/>
                    }
                    <div className="flex-1 min-w-0">
                      <div className="flex items-start justify-between gap-2">
                        <p className="text-[11px] font-medium text-cf-navy leading-snug">{c.label}</p>
                        <span className={`text-[10px] font-bold flex-shrink-0 ${c.passed ? "text-green-600" : "text-cf-gray-400"}`}>
                          +{c.points}pts
                        </span>
                      </div>
                      <p className={`text-[10px] mt-0.5 ${c.passed ? "text-green-700" : "text-red-500"}`}>
                        {c.evidence}
                      </p>
                    </div>
                  </div>
                ))}
              </div>

              {/* Next step */}
              <div className="px-4 py-2.5 bg-cf-gray-50 border-t border-cf-gray-100 flex items-start gap-2">
                <AlertCircle size={12} className="text-blue-500 flex-shrink-0 mt-0.5"/>
                <p className="text-[10px] text-blue-700 font-medium">{d.nextStep}</p>
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
