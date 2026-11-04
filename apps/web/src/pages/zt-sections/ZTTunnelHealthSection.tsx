import { CheckCircle2, AlertTriangle, XCircle, Server } from "lucide-react";
import type { ZeroTrustData, TunnelStatus } from "../../types";
import SectionHeader from "../../components/SectionHeader";

const STATUS_CONFIG: Record<TunnelStatus["status"], { color: string; bg: string; icon: React.ReactNode; label: string }> = {
  healthy:   { color: "#16A34A", bg: "#DCFCE7", icon: <CheckCircle2 size={16}/>, label: "Healthy" },
  degraded:  { color: "#D97706", bg: "#FEF3C7", icon: <AlertTriangle size={16}/>, label: "Degraded" },
  down:      { color: "#DC2626", bg: "#FEE2E2", icon: <XCircle size={16}/>, label: "Down" },
  inactive:  { color: "#9CA3AF", bg: "#F3F4F6", icon: <XCircle size={16}/>, label: "Inactive" },
};

export default function ZTTunnelHealthSection({ data }: { data: ZeroTrustData }) {
  const tunnels = data.tunnels;
  const routes  = data.tunnelRoutes;
  const s       = data.summary;

  if (s.tunnelsTotal === 0) return (
    <section className="report-section">
      <SectionHeader icon={<Server size={20}/>} title="Cloudflare Tunnels" subtitle="Secure, outbound-only connectivity to private resources"/>
      <div className="bg-blue-50 border border-blue-200 rounded-xl p-6 text-center">
        <Server size={28} className="text-blue-400 mx-auto mb-2"/>
        <p className="text-sm font-semibold text-blue-700">No Cloudflare Tunnels configured</p>
        <p className="text-xs text-blue-600 mt-1">Replace your VPN with Cloudflare Tunnel + Access for zero-trust access to private applications.</p>
      </div>
    </section>
  );

  return (
    <section className="report-section">
      <SectionHeader icon={<Server size={20}/>} title="Cloudflare Tunnels"
        subtitle="Secure outbound-only connectivity — no inbound firewall rules required" />
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-5">
        {[
          { label: "Total Tunnels",   value: s.tunnelsTotal,   color: "#3B82F6" },
          { label: "Healthy",         value: s.tunnelsHealthy, color: "#10B981" },
          { label: "Total Routes",    value: routes.length,    color: "#8B5CF6" },
        ].map((k) => (
          <div key={k.label} className="bg-white rounded-xl shadow-sm border border-cf-gray-200 p-4">
            <p className="text-[10px] font-semibold text-cf-gray-500 uppercase tracking-wide mb-1">{k.label}</p>
            <p className="text-2xl font-black" style={{ color: k.color }}>{k.value}</p>
          </div>
        ))}
      </div>
      {/* Tunnel cards */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 mb-5">
        {tunnels.map((t) => {
          const cfg = STATUS_CONFIG[t.status];
          return (
            <div key={t.id} className="bg-white rounded-xl shadow-sm border border-cf-gray-200 p-4 flex items-start gap-3">
              <span style={{ color: cfg.color }}>{cfg.icon}</span>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="text-sm font-semibold text-cf-navy">{t.name}</span>
                  <span className="text-[10px] font-medium px-2 py-0.5 rounded-full" style={{ backgroundColor: cfg.bg, color: cfg.color }}>{cfg.label}</span>
                </div>
                <p className="text-[10px] text-cf-gray-400 mt-1 font-mono">{t.id.slice(0,8)}…</p>
                <div className="flex gap-3 mt-1 text-[10px] text-cf-gray-500">
                  <span>{t.connections} connections</span>
                  <span>{t.routeCount} routes</span>
                  {t.createdAt && <span>since {t.createdAt.split("T")[0]}</span>}
                </div>
              </div>
            </div>
          );
        })}
      </div>
      {/* Routes table */}
      {routes.length > 0 && (
        <div className="bg-white rounded-xl shadow-sm border border-cf-gray-200 overflow-hidden">
          <div className="px-5 py-3 border-b border-cf-gray-100"><h3 className="text-sm font-semibold text-cf-navy">Network Routes</h3></div>
          <div className="overflow-y-auto" style={{ maxHeight: 280 }}>
            <table className="w-full text-xs">
              <thead className="sticky top-0"><tr className="bg-cf-gray-50 text-cf-gray-500 uppercase tracking-wide text-[10px]">
                <th className="px-4 py-2 text-left font-semibold">Network CIDR</th>
                <th className="px-4 py-2 text-left font-semibold">Tunnel</th>
                <th className="px-4 py-2 text-left font-semibold">Comment</th>
              </tr></thead>
              <tbody className="divide-y divide-cf-gray-100">
                {routes.map((r, i) => (
                  <tr key={`${r.network}-${i}`} className={i%2===0?"bg-white":"bg-cf-gray-50/40"}>
                    <td className="px-4 py-2 font-mono font-semibold text-cf-navy text-[11px]">{r.network}</td>
                    <td className="px-4 py-2 text-[11px] text-cf-gray-600">{r.tunnelName || r.tunnelId.slice(0,8)}</td>
                    <td className="px-4 py-2 text-[11px] text-cf-gray-400">{r.comment || "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </section>
  );
}
