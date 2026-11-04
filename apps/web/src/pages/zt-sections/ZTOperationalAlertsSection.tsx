/**
 * ZTOperationalAlertsSection — recurring monthly operational report framing.
 * Shown only when isPoc=false, replacing the POC "Deployment Roadmap" /
 * upsell-oriented ZTRecommendationsSection with operational callouts derived
 * entirely from real data already present in ZeroTrustData (no fabricated
 * defaults, no invented reference numbers) — e.g. devices offline, ungoverned
 * GenAI usage, DNS block-rate spikes, stale seats, and existing real
 * accessAnomalies.
 */
import { AlertTriangle, CheckCircle2, Activity } from "lucide-react";
import type { ZeroTrustData } from "../../types";
import { formatNumber } from "../../utils/formatters";
import SectionHeader from "../../components/SectionHeader";

type Severity = "critical" | "warning" | "info";

interface OpAlert {
  severity: Severity;
  title: string;
  description: string;
}

const SEVERITY_STYLE: Record<Severity, { bg: string; border: string; text: string; dot: string }> = {
  critical: { bg: "#FEF2F2", border: "#FECACA", text: "#DC2626", dot: "#EF4444" },
  warning:  { bg: "#FFFBEB", border: "#FDE68A", text: "#D97706", dot: "#F59E0B" },
  info:     { bg: "#EFF6FF", border: "#BFDBFE", text: "#2563EB", dot: "#3B82F6" },
};

export default function ZTOperationalAlertsSection({ data }: { data: ZeroTrustData }) {
  const s = data.summary;
  const alerts: OpAlert[] = [];

  // 1. Device connectivity — real online/offline breakdown
  if (s.warpEnrolledDevices > 0 && s.warpOfflineDevices > 0) {
    const pct = Math.round((s.warpOfflineDevices / s.warpEnrolledDevices) * 100);
    alerts.push({
      severity: pct >= 50 ? "critical" : pct >= 20 ? "warning" : "info",
      title: `${s.warpOfflineDevices} of ${s.warpEnrolledDevices} WARP devices not connected (${pct}%)`,
      description: "Devices most recently reporting a disconnected, no-network, or connectivity-check-failed status during this period are not protected by Gateway policies or posture checks while offline. Investigate client health, expired certificates, or captive-portal issues.",
    });
  }

  // 2. Ungoverned GenAI usage — real category-classified traffic
  if (data.aiAppUsage && data.aiAppUsage.uniqueApps > 0 && !data.aiAppUsage.hasGovernancePolicy) {
    const topApps = data.aiAppUsage.apps.slice(0, 3).map((a) => a.name).join(", ");
    alerts.push({
      severity: "warning",
      title: `${data.aiAppUsage.uniqueApps} generative AI app${data.aiAppUsage.uniqueApps === 1 ? "" : "s"} in use with no governance policy`,
      description: `Traffic to ${topApps || "generative AI tools"} was detected via Cloudflare's real "Artificial Intelligence" category classification, with no Gateway policy or DLP profile specifically governing it. ${formatNumber(data.aiAppUsage.uniqueUsers)} user(s) generated ${formatNumber(data.aiAppUsage.totalRequests)} requests this period.`,
    });
  }

  // 3. DNS block-rate spike — real day-over-day comparison from gatewayDnsTimeSeries
  const dnsSeries = data.gatewayDnsTimeSeries ?? [];
  if (dnsSeries.length >= 4) {
    const last = dnsSeries[dnsSeries.length - 1];
    const priorDays = dnsSeries.slice(0, -1);
    const priorAvg = priorDays.reduce((sum, d) => sum + d.blocked, 0) / priorDays.length;
    if (priorAvg > 0 && last.blocked > priorAvg * 2 && last.blocked - priorAvg >= 10) {
      alerts.push({
        severity: "warning",
        title: `DNS block volume spiked on ${last.date}`,
        description: `${formatNumber(last.blocked)} DNS queries were blocked on ${last.date} vs. a ${formatNumber(Math.round(priorAvg))}/day average over the rest of the period — a ${Math.round((last.blocked / priorAvg - 1) * 100)}% increase. Review top blocked domains/categories for that day for signs of a targeted campaign or compromised endpoint.`,
      });
    }
  }

  // 4. Stale / unused seats — real seat + login data
  if (s.seatsTotal > 0 && s.seatsNeverLoggedIn / s.seatsTotal > 0.3) {
    alerts.push({
      severity: "info",
      title: `${s.seatsNeverLoggedIn} of ${s.seatsTotal} provisioned seats have never logged in`,
      description: "These accounts consume licensed seats without any recorded successful login. Review for deprovisioning to reduce licensing cost and shrink the attack surface from unused accounts.",
    });
  }

  // 5. CASB findings — real, from Data Security Posture
  if ((s.casbFindingsCount ?? 0) > 0) {
    const bySeverity = (data.casbFindingsBySeverity ?? []).map((f) => `${f.count} ${f.severity}`).join(", ");
    alerts.push({
      severity: "warning",
      title: `${s.casbFindingsCount} CASB finding${s.casbFindingsCount === 1 ? "" : "s"} detected`,
      description: `Data Security Posture findings this period: ${bySeverity || "see detail below"}. Review the DLP & CASB section for specifics and remediate misconfigured SaaS resources.`,
    });
  }

  // 6. Tunnel health — real
  if (s.tunnelsTotal > 0 && s.tunnelsHealthy < s.tunnelsTotal) {
    alerts.push({
      severity: "warning",
      title: `${s.tunnelsTotal - s.tunnelsHealthy} of ${s.tunnelsTotal} Cloudflare Tunnels unhealthy`,
      description: "Degraded or down tunnels can disrupt access to internal resources behind Cloudflare Tunnel. Check cloudflared connector logs and network egress on the affected hosts.",
    });
  }

  // 7. Existing real Access anomalies (already computed server-side)
  for (const a of data.accessAnomalies ?? []) {
    alerts.push({ severity: a.severity, title: a.title, description: a.description });
  }

  const critical = alerts.filter((a) => a.severity === "critical");
  const warning  = alerts.filter((a) => a.severity === "warning");
  const info     = alerts.filter((a) => a.severity === "info");
  const ordered  = [...critical, ...warning, ...info];

  return (
    <section className="report-section">
      <SectionHeader icon={<Activity size={20}/>} title="Operational Alerts"
        subtitle="Notable changes and issues detected this period, derived from real Cloudflare One telemetry" />

      {ordered.length === 0 ? (
        <div className="bg-green-50 border border-green-200 rounded-xl p-6 text-center">
          <CheckCircle2 size={28} className="text-green-500 mx-auto mb-2"/>
          <p className="text-sm font-semibold text-green-700">No operational issues detected this period</p>
          <p className="text-xs text-green-600 mt-1">Device connectivity, GenAI governance, seat utilization, and Access authentication patterns all appear within normal ranges.</p>
        </div>
      ) : (
        <div className="space-y-3">
          {ordered.map((a, i) => {
            const style = SEVERITY_STYLE[a.severity];
            return (
              <div key={i} className="rounded-xl border overflow-hidden flex" style={{ borderColor: style.border, backgroundColor: style.bg }}>
                <div className="w-1 flex-shrink-0" style={{ backgroundColor: style.dot }}/>
                <div className="flex-1 p-4">
                  <div className="flex items-start justify-between gap-3 mb-1">
                    <h4 className="text-sm font-semibold" style={{ color: style.text }}>{a.title}</h4>
                    <span className="text-[10px] px-2 py-0.5 rounded-full font-bold flex-shrink-0 uppercase" style={{ color: style.text, backgroundColor: "#fff" }}>
                      {a.severity}
                    </span>
                  </div>
                  <p className="text-xs text-cf-gray-600 leading-relaxed">{a.description}</p>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {ordered.length > 0 && (
        <div className="mt-4 flex items-center gap-2 text-[11px] text-cf-gray-400">
          <AlertTriangle size={12}/>
          <span>{critical.length} critical · {warning.length} warning · {info.length} informational</span>
        </div>
      )}
    </section>
  );
}
