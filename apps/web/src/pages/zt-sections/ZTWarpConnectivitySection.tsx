import { Wifi } from "lucide-react";
import { ResponsiveContainer, AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, Legend } from "recharts";
import type { ZeroTrustData } from "../../types";
import { formatNumber } from "../../utils/formatters";
import SectionHeader from "../../components/SectionHeader";

export default function ZTWarpConnectivitySection({ data }: { data: ZeroTrustData }) {
  const series = data.warpDeviceStatusTimeSeries ?? [];
  const breakdown = data.warpDeviceStatusBreakdown ?? [];
  const s = data.summary;
  if (series.length === 0 && breakdown.length === 0) return null;

  const onlinePct = s.warpEnrolledDevices > 0 ? Math.round((s.warpOnlineDevices / s.warpEnrolledDevices) * 100) : 0;

  return (
    <section className="report-section">
      <SectionHeader icon={<Wifi size={20}/>} title="WARP — Device Connectivity"
        subtitle="Real connection-status events (connected/disconnected/other) over the analysis period" />
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-5">
        {[
          { label: "Devices Online (Latest Status)", value: `${s.warpOnlineDevices} (${onlinePct}%)`, color: "#10B981" },
          { label: "Devices Offline / Other",         value: formatNumber(s.warpOfflineDevices),        color: "#EF4444" },
          { label: "Enrolled Devices",                value: formatNumber(s.warpEnrolledDevices),        color: "#3B82F6" },
        ].map((k) => (
          <div key={k.label} className="bg-white rounded-xl shadow-sm border border-cf-gray-200 p-4">
            <p className="text-[10px] font-semibold text-cf-gray-500 uppercase tracking-wide mb-1">{k.label}</p>
            <p className="text-2xl font-black" style={{ color: k.color }}>{k.value}</p>
          </div>
        ))}
      </div>
      {series.length > 0 && (
        <div className="bg-white rounded-xl shadow-sm border border-cf-gray-200 p-4 mb-5">
          <h3 className="text-sm font-semibold text-cf-navy mb-3">Connection-Status Events Per Day</h3>
          <ResponsiveContainer width="100%" height={220}>
            <AreaChart data={series} margin={{ top: 4, right: 8, bottom: 0, left: 0 }}>
              <defs>
                <linearGradient id="warpConnOk" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%"  stopColor="#10B981" stopOpacity={0.25}/>
                  <stop offset="95%" stopColor="#10B981" stopOpacity={0.02}/>
                </linearGradient>
                <linearGradient id="warpConnBad" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%"  stopColor="#EF4444" stopOpacity={0.25}/>
                  <stop offset="95%" stopColor="#EF4444" stopOpacity={0.02}/>
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke="#F1F5F9"/>
              <XAxis dataKey="date" tick={{ fontSize: 10 }} tickFormatter={(v) => v.slice(5)}/>
              <YAxis tick={{ fontSize: 10 }} tickFormatter={(v) => formatNumber(v)}/>
              <Tooltip contentStyle={{ fontSize: 11, borderRadius: 8 }} formatter={(v: number) => formatNumber(v)}/>
              <Legend wrapperStyle={{ fontSize: 11 }}/>
              <Area type="monotone" dataKey="connected"    name="Connected"    stroke="#10B981" fill="url(#warpConnOk)"  strokeWidth={2} dot={false} stackId="1"/>
              <Area type="monotone" dataKey="disconnected" name="Disconnected" stroke="#EF4444" fill="url(#warpConnBad)" strokeWidth={2} dot={false} stackId="1"/>
              <Area type="monotone" dataKey="other"        name="Other"        stroke="#9CA3AF" fill="#9CA3AF20"        strokeWidth={1.5} dot={false} stackId="1"/>
            </AreaChart>
          </ResponsiveContainer>
        </div>
      )}
      {breakdown.length > 0 && (
        <div className="bg-white rounded-xl shadow-sm border border-cf-gray-200 p-4">
          <h3 className="text-sm font-semibold text-cf-navy mb-3">Connection Status Breakdown (All Events)</h3>
          <div className="flex flex-wrap gap-3">
            {breakdown.map((b) => (
              <div key={b.status} className="flex items-center gap-2 px-3 py-2 rounded-lg border border-cf-gray-200 bg-cf-gray-50">
                <div className="w-2 h-2 rounded-full" style={{ backgroundColor: b.online ? "#10B981" : "#EF4444" }} />
                <span className="text-xs font-semibold text-cf-navy">{b.status}</span>
                <span className="text-[10px] text-cf-gray-500 bg-cf-gray-200 px-1.5 py-0.5 rounded">{formatNumber(b.count)}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </section>
  );
}
