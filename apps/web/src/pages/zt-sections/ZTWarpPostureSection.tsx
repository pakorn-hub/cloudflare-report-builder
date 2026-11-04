import { Laptop, CheckCircle2, XCircle, AlertTriangle } from "lucide-react";
import { ResponsiveContainer, PieChart, Pie, Cell, Tooltip } from "recharts";
import type { ZeroTrustData } from "../../types";
import { formatNumber } from "../../utils/formatters";
import SectionHeader from "../../components/SectionHeader";

export default function ZTWarpPostureSection({ data }: { data: ZeroTrustData }) {
  const devices      = data.warpDevices;
  const postureRules = data.warpPostureRules;
  const osBkdn       = data.warpOsBreakdown;
  const s            = data.summary;
  if (s.warpEnrolledDevices === 0 && postureRules.length === 0) return (
    <section className="report-section">
      <SectionHeader icon={<Laptop size={20}/>} title="WARP — Device Posture" subtitle="Device enrollment and compliance status" />
      <div className="bg-yellow-50 border border-yellow-200 rounded-xl p-6 text-center">
        <AlertTriangle size={28} className="text-yellow-500 mx-auto mb-2"/>
        <p className="text-sm font-semibold text-yellow-700">No WARP-enrolled devices detected</p>
        <p className="text-xs text-yellow-600 mt-1">Deploy the WARP client to enable device-level security, posture checks, and egress filtering.</p>
      </div>
    </section>
  );

  const OS_COLORS = ["#3B82F6","#10B981","#8B5CF6","#F59E0B","#EF4444","#6B7280"];
  // Real online % — from each device's most recent connection-status event
  // within the period (warpDeviceAdaptiveGroups.status), not a fabricated
  // "posture compliant" number (there is no real posture pass/fail data
  // source available without DEX permissions).
  const onlinePct = s.warpEnrolledDevices > 0 ? Math.round((s.warpOnlineDevices / s.warpEnrolledDevices) * 100) : 0;

  return (
    <section className="report-section">
      <SectionHeader icon={<Laptop size={20}/>} title="WARP — Device Posture"
        subtitle="Enrolled devices, OS breakdown, and real connection status" />
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-5">
        {[
          { label: "Enrolled Devices", value: formatNumber(s.warpEnrolledDevices), color: "#3B82F6" },
          { label: "Online (Latest Status)", value: `${onlinePct}%`, color: onlinePct >= 90 ? "#10B981" : onlinePct >= 70 ? "#F59E0B" : "#EF4444" },
          { label: "Posture Rules", value: postureRules.length, color: "#8B5CF6" },
          { label: "OS Types", value: osBkdn.length, color: "#F59E0B" },
        ].map((k) => (
          <div key={k.label} className="bg-white rounded-xl shadow-sm border border-cf-gray-200 p-4">
            <p className="text-[10px] font-semibold text-cf-gray-500 uppercase tracking-wide mb-1">{k.label}</p>
            <p className="text-2xl font-black" style={{ color: k.color }}>{k.value}</p>
          </div>
        ))}
      </div>
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5 items-start">
        {/* OS breakdown pie */}
        {osBkdn.length > 0 && (
          <div className="bg-white rounded-xl shadow-sm border border-cf-gray-200 p-4">
            <h3 className="text-sm font-semibold text-cf-navy mb-3">Device OS Breakdown</h3>
            <div className="flex items-center gap-4">
              <ResponsiveContainer width={160} height={160}>
                <PieChart>
                  <Pie data={osBkdn} dataKey="count" nameKey="os" cx="50%" cy="50%" innerRadius={40} outerRadius={70}>
                    {osBkdn.map((_, i) => <Cell key={i} fill={OS_COLORS[i % OS_COLORS.length]}/>)}
                  </Pie>
                  <Tooltip contentStyle={{ fontSize: 11 }} formatter={(v: number) => formatNumber(v)}/>
                </PieChart>
              </ResponsiveContainer>
              <div className="space-y-2 flex-1">
                {osBkdn.map((o, i) => (
                  <div key={o.os} className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <div className="w-2 h-2 rounded-full" style={{ backgroundColor: OS_COLORS[i%OS_COLORS.length] }}/>
                      <span className="text-xs text-cf-navy">{o.os}</span>
                    </div>
                    <span className="text-xs font-bold text-cf-navy">{formatNumber(o.count)}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}
        {/* Posture rules */}
        {postureRules.length > 0 && (
          <div className="bg-white rounded-xl shadow-sm border border-cf-gray-200 overflow-hidden">
            <div className="px-5 py-3 border-b border-cf-gray-100"><h3 className="text-sm font-semibold text-cf-navy">Posture Check Rules</h3></div>
            <div className="overflow-y-auto" style={{ maxHeight: 200 }}>
              <table className="w-full text-xs">
                <thead className="sticky top-0"><tr className="bg-cf-gray-50 text-cf-gray-500 uppercase tracking-wide text-[10px]">
                  <th className="px-4 py-2 text-left font-semibold">Rule</th>
                  <th className="px-4 py-2 text-left font-semibold">Type</th>
                  <th className="px-4 py-2 text-center font-semibold">Active</th>
                </tr></thead>
                <tbody className="divide-y divide-cf-gray-100">
                  {postureRules.map((r, i) => (
                    <tr key={r.id} className={i%2===0?"bg-white":"bg-cf-gray-50/40"}>
                      <td className="px-4 py-2 text-xs font-medium text-cf-navy">{r.name}</td>
                      <td className="px-4 py-2 text-[11px] text-cf-gray-500">{r.type}</td>
                      <td className="px-4 py-2 text-center">{r.enabled ? <CheckCircle2 size={14} className="text-green-500 mx-auto"/> : <XCircle size={14} className="text-cf-gray-400 mx-auto"/>}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>
      {/* Recent devices sample */}
      {devices.length > 0 && (
        <div className="mt-5 bg-white rounded-xl shadow-sm border border-cf-gray-200 overflow-hidden">
          <div className="px-5 py-3 border-b border-cf-gray-100 flex items-center justify-between">
            <h3 className="text-sm font-semibold text-cf-navy">Enrolled Devices (sample)</h3>
            <span className="text-[10px] text-cf-gray-400">{devices.length} total</span>
          </div>
          <div className="overflow-x-auto overflow-y-auto" style={{ maxHeight: 280 }}>
            <table className="w-full text-xs">
              <thead className="sticky top-0"><tr className="bg-cf-gray-50 text-cf-gray-500 uppercase tracking-wide text-[10px]">
                <th className="px-4 py-2 text-left font-semibold">Device</th>
                <th className="px-4 py-2 text-left font-semibold">User</th>
                <th className="px-4 py-2 text-left font-semibold">OS</th>
                <th className="px-4 py-2 text-left font-semibold">Last Seen</th>
              </tr></thead>
              <tbody className="divide-y divide-cf-gray-100">
                {devices.slice(0, 20).map((d, i) => (
                  <tr key={d.id} className={i%2===0?"bg-white":"bg-cf-gray-50/40"}>
                    <td className="px-4 py-2 font-medium text-cf-navy text-[11px]">{d.name || d.id.slice(0,8)}</td>
                    <td className="px-4 py-2 text-[11px] text-cf-gray-500 max-w-[160px] truncate">{d.user}</td>
                    <td className="px-4 py-2 text-[11px] text-cf-gray-500">{d.os}</td>
                    <td className="px-4 py-2 text-[11px] text-cf-gray-400">{d.lastSeen ? d.lastSeen.split("T")[0] : "—"}</td>
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
