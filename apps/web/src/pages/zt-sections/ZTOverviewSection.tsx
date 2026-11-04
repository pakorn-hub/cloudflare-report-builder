import { Shield, Users, Globe, Lock, AlertTriangle, CheckCircle2, TrendingUp } from "lucide-react";
import type { ZeroTrustData } from "../../types";
import { formatNumber } from "../../utils/formatters";
import SectionHeader from "../../components/SectionHeader";
import BaselineDelta from "../../components/BaselineDelta";

function fmtBig(n: number): string {
  if (n >= 1_000_000_000) return `${(n / 1_000_000_000).toFixed(2)}B`;
  if (n >= 1_000_000)     return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000)         return `${(n / 1_000).toFixed(0)}K`;
  return formatNumber(n);
}

export default function ZTOverviewSection({ data, isPoc = true }: { data: ZeroTrustData; isPoc?: boolean }) {
  const s           = data.summary;
  const dnsBlocked  = s.gatewayDnsBlocked ?? 0;
  const dnsTotal    = s.gatewayDnsQueries ?? 0;
  const dnsFiltPct  = dnsTotal > 0 ? ((dnsBlocked / dnsTotal) * 100).toFixed(2) : "0";

  // Always show DNS (it's the POC headline even at 0), Access, and auth-blocked.
  // Only show WARP/L4/Shadow if they have data — don't show a wall of zeros.
  const kpis = [
    {
      label: "DNS Threats Blocked",
      value: fmtBig(dnsBlocked),
      sub: `${dnsFiltPct}% of ${fmtBig(dnsTotal)} queries`,
      color: "#ba0816",
      icon: <Shield size={18}/>,
      highlight: true,
      deltaField: "gatewayDnsBlocked",
    },
    {
      label: "Auth Events",
      value: formatNumber(s.totalAuthEvents),
      sub: (s.warpAndServiceTokenLoginEvents ?? 0) > 0
        ? `${s.authSuccessRate}% success · +${fmtBig(s.warpAndServiceTokenLoginEvents!)} WARP/service-token sessions excluded`
        : `${s.authSuccessRate}% success rate`,
      color: "#3B82F6",
      icon: <Lock size={18}/>,
      highlight: false,
      deltaField: "totalAuthEvents",
    },
    {
      label: "Users Protected",
      // Gateway (DNS/HTTP) unique users cover everyone routing traffic
      // through Zero Trust — usually far larger than Access-app login
      // users (e.g. WARP client users who never hit a gated app). Prefer
      // it when available; fall back to the Access-derived count.
      value: formatNumber(Math.max(s.gatewayDnsUniqueUsers ?? 0, s.gatewayHttpUniqueUsers ?? 0, s.uniqueUsers)),
      sub: (s.gatewayDnsUniqueUsers ?? 0) > 0 || (s.gatewayHttpUniqueUsers ?? 0) > 0
        ? "Gateway (DNS/HTTP) unique users"
        : `across ${s.uniqueApps} apps`,
      color: "#10B981",
      icon: <Users size={18}/>,
      highlight: false,
      deltaField: "uniqueUsers",
    },
    {
      label: "Auth Blocked",
      value: formatNumber(s.blockedAuthEvents),
      sub: "unauthorized attempts stopped",
      color: s.blockedAuthEvents > 0 ? "#DC2626" : "#6B7280",
      icon: <Shield size={18}/>,
      highlight: false,
      deltaField: "blockedAuthEvents",
      invert: true,
    },
    ...(( s.httpRbiSessions ?? 0) > 0 ? [{
      label: "RBI Sessions",
      value: fmtBig(s.httpRbiSessions!),
      sub: "remote browser isolation",
      color: "#F59E0B",
      icon: <Globe size={18}/>,
      highlight: false,
    }] : []),
    ...((s.gatewayL4Sessions ?? 0) > 0 ? [{
      label: "L4 Sessions",
      value: fmtBig(s.gatewayL4Sessions!),
      sub: `${s.gatewayL4Blocked ?? 0 > 0 ? `${fmtBig(s.gatewayL4Blocked!)} blocked` : "monitored"}`,
      color: "#8B5CF6",
      icon: <Shield size={18}/>,
      highlight: false,
    }] : []),
    ...((s.shadowItAppsDiscovered ?? 0) > 0 ? [{
      label: "Shadow IT Apps",
      value: formatNumber(s.shadowItAppsDiscovered!),
      sub: "discovered SaaS apps",
      color: "#F97316",
      icon: <AlertTriangle size={18}/>,
      highlight: false,
    }] : []),
    ...((s.tunnelsTotal ?? 0) > 0 ? [{
      label: "Tunnels Healthy",
      value: `${s.tunnelsHealthy}/${s.tunnelsTotal}`,
      sub: "Cloudflare Tunnels",
      color: s.tunnelsHealthy === s.tunnelsTotal ? "#10B981" : "#F59E0B",
      icon: <CheckCircle2 size={18}/>,
      highlight: false,
    }] : []),
    ...((s.warpEnrolledDevices ?? 0) > 0 ? [{
      label: "WARP Devices Online",
      value: `${formatNumber(s.warpOnlineDevices ?? 0)}/${formatNumber(s.warpEnrolledDevices)}`,
      sub: "connected (latest status)",
      color: "#8B5CF6",
      icon: <TrendingUp size={18}/>,
      highlight: false,
    }] : []),
    ...((s.seatsTotal ?? 0) > 0 ? [{
      label: "Licensed Seats",
      value: formatNumber(s.seatsTotal),
      sub: `${formatNumber(s.seatsActiveInPeriod ?? 0)} active this period`,
      color: "#0EA5E9",
      icon: <Users size={18}/>,
      highlight: false,
    }] : []),
  ];

  return (
    <section className="report-section">
      <SectionHeader icon={<Shield size={20}/>} title="Cloudflare One — Overview"
        subtitle={`${data.meta.periodLabel} Zero Trust ${isPoc ? "POC" : "Assessment"} · ${data.meta.accountName} · ${data.meta.since} → ${data.meta.until}`}
        printBreak />
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-0" style={{ border: "1px solid #c4c4c4" }}>
        {kpis.map((k, i) => (
          <div key={k.label}
            style={{
              padding: "1.25rem",
              borderRight: i < kpis.length - 1 ? "1px solid #c4c4c4" : "none",
              borderBottom: i < kpis.length - 4 ? "1px solid #c4c4c4" : "none",
              backgroundColor: k.highlight ? "#fdf2f3" : "#ffffff",
              borderLeft: k.highlight ? "3px solid #ba0816" : "3px solid transparent",
            }}>
            <p style={{ fontSize: 10, fontWeight: 400, letterSpacing: "0.09rem", textTransform: "uppercase", color: "#5d5e65", marginBottom: 8 }}>{k.label}</p>
            <div style={{ display: "flex", alignItems: "baseline", gap: 8 }}>
              <p style={{ fontSize: 26, fontWeight: 800, color: k.highlight ? "#ba0816" : k.color, lineHeight: 1, marginBottom: 6 }}>{k.value}</p>
              {"deltaField" in k && <BaselineDelta baseline={data.baseline} field={k.deltaField} invert={"invert" in k && !!k.invert} />}
            </div>
            <p style={{ fontSize: 10, color: "#5d5e65" }}>{k.sub}</p>
          </div>
        ))}
      </div>
    </section>
  );
}
