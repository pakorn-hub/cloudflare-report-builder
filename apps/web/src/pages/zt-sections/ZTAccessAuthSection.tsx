import { Lock, Info } from "lucide-react";
import { ResponsiveContainer, AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, Legend } from "recharts";
import type { ZeroTrustData } from "../../types";
import { formatNumber } from "../../utils/formatters";
import SectionHeader from "../../components/SectionHeader";
import BaselineDelta from "../../components/BaselineDelta";

export default function ZTAccessAuthSection({ data }: { data: ZeroTrustData }) {
  const series = data.accessAuthTimeSeries;
  if (series.length === 0) return null;

  const totalAllow = series.reduce((s, d) => s + d.allow, 0);
  const totalBlock = series.reduce((s, d) => s + d.block, 0);
  const mfaNote = data.dataConfidence?.mfaChallenges;
  const authNote = data.dataConfidence?.totalAuthEvents;
  const warpEvents = data.summary.warpAndServiceTokenLoginEvents ?? 0;
  const topApps = data.accessLoginsTopApps ?? [];
  const topUsers = data.accessLoginsTopUsers ?? [];

  return (
    <section className="report-section">
      <SectionHeader icon={<Lock size={20}/>} title="Access — Authentication Events"
        subtitle="Daily authentication activity — real interactive login attempts (WARP client session events and service-token validations excluded)" />
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-5">
        {[
          { label: "Allowed", value: totalAllow, color: "#10B981", key: "totalAuthEvents" },
          { label: "Blocked", value: totalBlock, color: "#EF4444", key: "blockedAuthEvents" },
        ].map((k) => (
          <div key={k.label} className="bg-white rounded-xl shadow-sm border border-cf-gray-200 p-4">
            <p className="text-[10px] font-semibold text-cf-gray-500 uppercase tracking-wide mb-1">{k.label}</p>
            <div className="flex items-baseline gap-2">
              <p className="text-2xl font-black" style={{ color: k.color }}>{formatNumber(k.value)}</p>
              <BaselineDelta baseline={data.baseline} field={k.key} />
            </div>
          </div>
        ))}
      </div>
      {authNote && (
        <div className="print:hidden flex items-start gap-2 bg-slate-50 border border-slate-200 rounded-lg px-3 py-2 mb-3">
          <Info size={13} className="text-slate-400 flex-shrink-0 mt-0.5"/>
          <p className="text-[11px] text-slate-500 leading-relaxed">{authNote}</p>
        </div>
      )}
      {warpEvents > 0 && (
        <div className="flex items-start gap-2 bg-blue-50 border border-blue-100 rounded-lg px-3 py-2 mb-5">
          <Info size={13} className="text-blue-400 flex-shrink-0 mt-0.5"/>
          <p className="text-[11px] text-blue-700 leading-relaxed">
            {formatNumber(warpEvents)} additional WARP client session / service-token login events occurred this period — excluded from the KPIs above since they measure device connectivity, not application access. See WARP — Device Connectivity for that trend.
          </p>
        </div>
      )}
      {mfaNote && (
        <div className="print:hidden flex items-start gap-2 bg-slate-50 border border-slate-200 rounded-lg px-3 py-2 mb-5">
          <Info size={13} className="text-slate-400 flex-shrink-0 mt-0.5"/>
          <p className="text-[11px] text-slate-500 leading-relaxed">{mfaNote}</p>
        </div>
      )}
      {(topApps.length > 0 || topUsers.length > 0) && (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-5">
          {topApps.length > 0 && (
            <div className="bg-white rounded-xl shadow-sm border border-cf-gray-200 p-4">
              <h3 className="text-sm font-semibold text-cf-navy mb-3">Top Applications by Login Attempts</h3>
              <div className="space-y-1.5">
                {topApps.slice(0, 8).map((a) => (
                  <div key={a.appId} className="flex items-center justify-between text-xs">
                    <span className="text-cf-gray-600 truncate">{a.appName}</span>
                    <span className="font-mono font-semibold text-cf-navy">{formatNumber(a.attemptsTotal)}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
          {topUsers.length > 0 && (
            <div className="bg-white rounded-xl shadow-sm border border-cf-gray-200 p-4">
              <h3 className="text-sm font-semibold text-cf-navy mb-3">Top Users by Login Attempts</h3>
              <div className="space-y-1.5">
                {topUsers.slice(0, 8).map((u) => (
                  <div key={u.email} className="flex items-center justify-between text-xs">
                    <span className="text-cf-gray-600 truncate font-mono">{u.email}</span>
                    <span className="font-mono font-semibold text-cf-navy">{formatNumber(u.attemptsTotal)}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
      <div className="bg-white rounded-xl shadow-sm border border-cf-gray-200 p-4">
        <h3 className="text-sm font-semibold text-cf-navy mb-3">Daily Authentication Breakdown</h3>
        <ResponsiveContainer width="100%" height={260}>
          <AreaChart data={series} margin={{ top: 4, right: 8, bottom: 0, left: 0 }}>
            <defs>
              {[["allow","#10B981"],["block","#EF4444"]].map(([k,c]) => (
                <linearGradient key={k} id={`ztAuth-${k}`} x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%"  stopColor={c} stopOpacity={0.25}/>
                  <stop offset="95%" stopColor={c} stopOpacity={0.02}/>
                </linearGradient>
              ))}
            </defs>
            <CartesianGrid strokeDasharray="3 3" stroke="#F1F5F9"/>
            <XAxis dataKey="date" tick={{ fontSize: 10 }} tickFormatter={(v) => v.slice(5)}/>
            <YAxis tick={{ fontSize: 10 }} tickFormatter={(v) => v >= 1e3 ? `${(v/1e3).toFixed(0)}K` : String(v)}/>
            <Tooltip contentStyle={{ fontSize: 11, borderRadius: 8 }} formatter={(v: number) => formatNumber(v)}/>
            <Legend wrapperStyle={{ fontSize: 11 }}/>
            <Area type="monotone" dataKey="allow" name="Allowed"   stroke="#10B981" fill="url(#ztAuth-allow)" strokeWidth={2} dot={false}/>
            <Area type="monotone" dataKey="block" name="Blocked"   stroke="#EF4444" fill="url(#ztAuth-block)" strokeWidth={2} dot={false}/>
          </AreaChart>
        </ResponsiveContainer>
      </div>
    </section>
  );
}
