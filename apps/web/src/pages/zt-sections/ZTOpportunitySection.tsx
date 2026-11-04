/**
 * ZTOpportunitySection — consolidates all undeployed Zero Trust features
 * into a single "unlock more value" section instead of showing 4+ empty sections.
 * Only renders when there are meaningful undeployed features.
 */
import { Wifi, Network, Layers, FileText, Eye, ArrowRight } from "lucide-react";
import type { ZeroTrustData } from "../../types";
import SectionHeader from "../../components/SectionHeader";

interface Opportunity {
  icon: React.ReactNode;
  title: string;
  subtitle: string;
  benefit: string;
  action: string;
  color: string;
  bg: string;
}

export default function ZTOpportunitySection({ data }: { data: ZeroTrustData }) {
  const s          = data.summary;
  const policies   = data.gatewayPolicies ?? [];
  const httpPols   = policies.filter((p) => p.ruleType === "http").length;

  const opportunities: Opportunity[] = [
    ...( s.warpEnrolledDevices === 0 ? [{
      icon: <Wifi size={20}/>,
      title: "WARP Client",
      subtitle: "Device Security & Posture",
      benefit: "Enforce device health checks, route all traffic through Cloudflare Gateway for full egress control",
      action: "Deploy WARP to all managed endpoints",
      color: "#8B5CF6",
      bg: "#F5F3FF",
    }] : []),
    ...( httpPols === 0 ? [{
      icon: <Layers size={20}/>,
      title: "HTTP/SWG Filtering",
      subtitle: "Secure Web Gateway",
      benefit: "Inspect all web traffic, block malicious content, detect shadow IT, prevent data exfiltration",
      action: "Configure HTTP Gateway policies",
      color: "#3B82F6",
      bg: "#EFF6FF",
    }] : []),
    ...( s.tunnelsTotal === 0 ? [{
      icon: <Network size={20}/>,
      title: "Cloudflare Tunnel",
      subtitle: "VPN Replacement",
      benefit: "Replace VPN with outbound-only tunnels — no inbound firewall rules, no public IPs, no attack surface",
      action: "Deploy cloudflared connectors to internal resources",
      color: "#10B981",
      bg: "#F0FDF4",
    }] : []),
    ...( (data.dlpProfiles?.length ?? 0) === 0 ? [{
      icon: <FileText size={20}/>,
      title: "Data Loss Prevention",
      subtitle: "DLP Profiles",
      benefit: "Prevent PII, credit card numbers, and sensitive files from leaving your network via email or web uploads",
      action: "Enable predefined DLP profiles for financial and PII data",
      color: "#EF4444",
      bg: "#FEF2F2",
    }] : []),
    ...( httpPols === 0 ? [{
      icon: <Eye size={20}/>,
      title: "Shadow IT Discovery",
      subtitle: "CASB / App Visibility",
      benefit: "Discover all SaaS apps employees are accessing — identify unsanctioned apps and cloud data risk",
      action: "Enable application visibility in Gateway HTTP policies",
      color: "#F97316",
      bg: "#FFF7ED",
    }] : []),
  ];

  if (opportunities.length === 0) return null;

  return (
    <section className="report-section">
      <SectionHeader
        icon={<ArrowRight size={20}/>}
        title="Undeployed Capabilities — Unlock More Value"
        subtitle="These Cloudflare One features are available in your plan but not yet configured"
      />

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
        {opportunities.map((opp) => (
          <div key={opp.title} className="rounded-xl border p-4 flex flex-col gap-3"
            style={{ backgroundColor: opp.bg, borderColor: opp.color + "30" }}>

            <div className="flex items-start gap-3">
              <div className="w-9 h-9 rounded-lg flex items-center justify-center flex-shrink-0"
                style={{ backgroundColor: opp.color + "15", color: opp.color }}>
                {opp.icon}
              </div>
              <div>
                <p className="text-sm font-bold text-cf-navy">{opp.title}</p>
                <p className="text-[10px] text-cf-gray-500">{opp.subtitle}</p>
              </div>
            </div>

            <p className="text-xs text-cf-gray-600 leading-relaxed">{opp.benefit}</p>

            <div className="mt-auto flex items-center gap-1.5 text-[11px] font-semibold"
              style={{ color: opp.color }}>
              <ArrowRight size={12}/>
              {opp.action}
            </div>
          </div>
        ))}
      </div>

      <div className="mt-4 bg-cf-gray-50 border border-cf-gray-200 rounded-xl p-4 text-center">
        <p className="text-xs text-cf-gray-500">
          All capabilities above are included in your Cloudflare One subscription.
          Contact your Cloudflare representative to activate these features.
        </p>
      </div>
    </section>
  );
}
