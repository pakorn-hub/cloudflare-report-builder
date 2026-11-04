import { Activity, Info } from "lucide-react";
import { ResponsiveContainer, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Cell } from "recharts";
import type { ZeroTrustData } from "../../types";
import { formatNumber } from "../../utils/formatters";
import SectionHeader from "../../components/SectionHeader";

const COLORS = ["#3B82F6", "#10B981", "#8B5CF6", "#F59E0B", "#EF4444", "#F97316", "#6B7280", "#EC4899"];

function MiniBar({ title, rows }: { title: string; rows: { value: string; count: number }[] }) {
  if (rows.length === 0) return null;
  const sorted = rows.slice().sort((a, b) => b.count - a.count).slice(0, 6);
  return (
    <div className="bg-white rounded-xl shadow-sm border border-cf-gray-200 p-4">
      <h3 className="text-sm font-semibold text-cf-navy mb-3">{title}</h3>
      <ResponsiveContainer width="100%" height={Math.max(120, sorted.length * 32)}>
        <BarChart data={sorted} layout="vertical" margin={{ top: 4, right: 16, bottom: 0, left: 90 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#F1F5F9"/>
          <XAxis type="number" tick={{ fontSize: 10 }} allowDecimals={false}/>
          <YAxis type="category" dataKey="value" tick={{ fontSize: 10 }} width={86}/>
          <Tooltip contentStyle={{ fontSize: 11, borderRadius: 8 }} formatter={(v: number) => formatNumber(v)}/>
          <Bar dataKey="count" radius={[0,4,4,0]}>
            {sorted.map((_, i) => <Cell key={i} fill={COLORS[i % COLORS.length]}/>)}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

/**
 * Digital Experience Monitoring (DEX) — real live device telemetry from
 * REST /accounts/{id}/dex/fleet-status/live. This is the "can users still
 * reliably reach what they need" dimension that pairs with Gateway/Access
 * security telemetry — a device can be fully policy-compliant and still
 * have a degraded experience (bad colo routing, stale client version, etc).
 *
 * IMPORTANT: this is LIVE data (up to 60 minutes back at generation time),
 * not scoped to the report's [since, until] window — labeled as such.
 */
export default function ZTDeviceExperienceSection({ data }: { data: ZeroTrustData }) {
  const dex = data.dexFleetStatus;
  const note = data.dataConfidence?.dexFleetStatus;
  if (!dex || dex.uniqueDevicesTotal === 0) return null;

  const connectedCount = dex.byStatus
    .filter((s) => s.value.toLowerCase().includes("connect") && !s.value.toLowerCase().includes("dis"))
    .reduce((sum, s) => sum + s.count, 0);
  const connectedPct = dex.uniqueDevicesTotal > 0 ? Math.round((connectedCount / dex.uniqueDevicesTotal) * 100) : 0;

  return (
    <section className="report-section">
      <SectionHeader icon={<Activity size={20}/>} title="Device Experience (DEX)"
        subtitle="Live WARP client device health — connectivity, platform, and version distribution right now" />
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-5">
        <div className="bg-white rounded-xl shadow-sm border border-cf-gray-200 p-4">
          <p className="text-[10px] font-semibold text-cf-gray-500 uppercase tracking-wide mb-1">Devices Seen (60 min)</p>
          <p className="text-2xl font-black text-blue-600">{formatNumber(dex.uniqueDevicesTotal)}</p>
        </div>
        <div className="bg-white rounded-xl shadow-sm border border-cf-gray-200 p-4">
          <p className="text-[10px] font-semibold text-cf-gray-500 uppercase tracking-wide mb-1">Currently Connected</p>
          <p className="text-2xl font-black" style={{ color: connectedPct >= 80 ? "#10B981" : connectedPct >= 50 ? "#F59E0B" : "#EF4444" }}>{connectedPct}%</p>
        </div>
        <div className="bg-white rounded-xl shadow-sm border border-cf-gray-200 p-4">
          <p className="text-[10px] font-semibold text-cf-gray-500 uppercase tracking-wide mb-1">Client Versions in Fleet</p>
          <p className="text-2xl font-black text-purple-600">{dex.byVersion.length}</p>
        </div>
      </div>
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5 items-start">
        <MiniBar title="By Connection Status" rows={dex.byStatus} />
        <MiniBar title="By Platform" rows={dex.byPlatform} />
        <MiniBar title="By Client Version" rows={dex.byVersion} />
        <MiniBar title="By Egress Colo" rows={dex.byColo} />
      </div>
      {note && (
        <div className="print:hidden flex items-start gap-2 bg-slate-50 border border-slate-200 rounded-lg px-3 py-2 mt-5">
          <Info size={13} className="text-slate-400 flex-shrink-0 mt-0.5"/>
          <p className="text-[11px] text-slate-500 leading-relaxed">{note}</p>
        </div>
      )}
    </section>
  );
}
