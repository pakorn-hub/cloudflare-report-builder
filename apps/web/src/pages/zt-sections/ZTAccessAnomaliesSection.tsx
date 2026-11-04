/**
 * ZTAccessAnomaliesSection — detected anomalies in Access login patterns,
 * identity provider breakdown, per-app success/failure, and failed login details.
 * Inspired by cf-reporting's access-audit.ts anomaly detection.
 */
import { AlertTriangle, Users, Shield } from "lucide-react";
import {
  ResponsiveContainer, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip,
  Cell, PieChart, Pie, Legend,
} from "recharts";
import type { ZeroTrustData } from "../../types";
import { formatNumber } from "../../utils/formatters";
import SectionHeader from "../../components/SectionHeader";

const SEV_COLORS = {
  critical: { bg: "bg-red-50",    border: "border-red-300",    text: "text-red-800",    icon: "text-red-500",    badge: "bg-red-100 text-red-700" },
  warning:  { bg: "bg-yellow-50", border: "border-yellow-300", text: "text-yellow-800", icon: "text-yellow-500", badge: "bg-yellow-100 text-yellow-700" },
  info:     { bg: "bg-blue-50",   border: "border-blue-300",   text: "text-blue-800",   icon: "text-blue-500",   badge: "bg-blue-100 text-blue-700" },
};

const IDP_COLORS = ["#3B82F6","#10B981","#F59E0B","#8B5CF6","#EF4444","#F97316","#6B7280"];

export default function ZTAccessAnomaliesSection({ data }: { data: ZeroTrustData }) {
  const anomalies  = data.accessAnomalies ?? [];
  const idp        = data.accessIdpBreakdown ?? [];
  const appBreak   = data.accessAppBreakdown ?? [];
  const failed     = data.accessFailedLoginDetails ?? [];

  const hasData = anomalies.length > 0 || idp.length > 0 || appBreak.length > 0;
  if (!hasData) return null;

  const criticalCount = anomalies.filter((a) => a.severity === "critical").length;
  const warningCount  = anomalies.filter((a) => a.severity === "warning").length;

  // Aggregate failed logins by country for display
  const failedByCountry = Array.from(
    failed.reduce((m, d) => {
      m.set(d.country, (m.get(d.country) ?? 0) + d.count);
      return m;
    }, new Map<string, number>())
  )
    .map(([country, count]) => ({ country, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 8);

  // Per-app bar data
  const appChartData = appBreak.slice(0, 8).map((a) => ({
    name: a.appId.length > 16 ? a.appId.slice(0, 14) + "…" : a.appId,
    fullId: a.appId,
    Successful: a.successful,
    Failed: a.failed,
    failureRate: a.failureRate,
  }));

  return (
    <section className="report-section">
      <SectionHeader
        icon={<AlertTriangle size={20}/>}
        title="Access — Authentication Audit"
        subtitle="Detected anomalies, identity provider usage, and per-app login breakdown"
      />

      {/* Anomaly KPI bar */}
      {anomalies.length > 0 && (
        <div className="grid grid-cols-3 gap-4 mb-5">
          <div className="bg-white rounded-xl shadow-sm border border-cf-gray-200 p-4">
            <p className="text-[10px] font-semibold text-cf-gray-500 uppercase tracking-wide mb-1">Anomalies Detected</p>
            <p className="text-2xl font-black text-cf-navy">{formatNumber(anomalies.length)}</p>
          </div>
          <div className="bg-white rounded-xl shadow-sm border border-cf-gray-200 p-4">
            <p className="text-[10px] font-semibold text-cf-gray-500 uppercase tracking-wide mb-1">Critical</p>
            <p className="text-2xl font-black" style={{ color: criticalCount > 0 ? "#EF4444" : "#10B981" }}>{criticalCount}</p>
          </div>
          <div className="bg-white rounded-xl shadow-sm border border-cf-gray-200 p-4">
            <p className="text-[10px] font-semibold text-cf-gray-500 uppercase tracking-wide mb-1">Warnings</p>
            <p className="text-2xl font-black" style={{ color: warningCount > 0 ? "#F59E0B" : "#10B981" }}>{warningCount}</p>
          </div>
        </div>
      )}

      {/* Anomaly cards */}
      {anomalies.length > 0 && (
        <div className="space-y-3 mb-5">
          {anomalies.map((a, i) => {
            const style = SEV_COLORS[a.severity];
            return (
              <div key={i} className={`rounded-xl border p-4 ${style.bg} ${style.border}`}>
                <div className="flex items-start gap-3">
                  <AlertTriangle size={16} className={`mt-0.5 flex-shrink-0 ${style.icon}`}/>
                  <div>
                    <div className="flex items-center gap-2 mb-1">
                      <span className={`text-[10px] font-bold uppercase px-1.5 py-0.5 rounded ${style.badge}`}>
                        {a.severity}
                      </span>
                      <p className={`text-sm font-semibold ${style.text}`}>{a.title}</p>
                    </div>
                    <p className="text-xs text-cf-gray-600">{a.description}</p>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5 items-start">
        {/* Identity provider breakdown */}
        {idp.length > 0 && (
          <div className="bg-white rounded-xl shadow-sm border border-cf-gray-200 p-4">
            <div className="flex items-center gap-2 mb-3">
              <Shield size={16} className="text-cf-gray-400"/>
              <h3 className="text-sm font-semibold text-cf-navy">Identity Provider Usage</h3>
            </div>
            <ResponsiveContainer width="100%" height={200}>
              <PieChart>
                <Pie
                  data={idp}
                  cx="50%"
                  cy="45%"
                  innerRadius={50}
                  outerRadius={80}
                  paddingAngle={2}
                  dataKey="count"
                  nameKey="provider"
                  label={({ provider, percent }) =>
                    `${provider?.slice(0, 10)} ${(percent * 100).toFixed(0)}%`
                  }
                  labelLine={false}
                >
                  {idp.map((_, i) => (
                    <Cell key={i} fill={IDP_COLORS[i % IDP_COLORS.length]}/>
                  ))}
                </Pie>
                <Tooltip
                  contentStyle={{ fontSize: 11, borderRadius: 8 }}
                  formatter={(v: number) => formatNumber(v)}
                />
                <Legend iconType="circle" iconSize={10} wrapperStyle={{ fontSize: 11 }}/>
              </PieChart>
            </ResponsiveContainer>
          </div>
        )}

        {/* Per-app login success/failure */}
        {appChartData.length > 0 && (
          <div className="bg-white rounded-xl shadow-sm border border-cf-gray-200 p-4">
            <div className="flex items-center gap-2 mb-3">
              <Users size={16} className="text-cf-gray-400"/>
              <h3 className="text-sm font-semibold text-cf-navy">Login Success/Failure by App</h3>
            </div>
            <ResponsiveContainer width="100%" height={200}>
              <BarChart data={appChartData} layout="vertical" margin={{ top: 4, right: 16, bottom: 0, left: 60 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#F1F5F9"/>
                <XAxis type="number" tick={{ fontSize: 10 }}/>
                <YAxis type="category" dataKey="name" tick={{ fontSize: 10 }} width={56}/>
                <Tooltip
                  contentStyle={{ fontSize: 11, borderRadius: 8 }}
                  formatter={(v: number, name: string, props: { payload?: { fullId?: string; failureRate?: number } }) => [
                    formatNumber(v),
                    `${name} (${props.payload?.fullId?.slice(0, 20) ?? ""})`,
                  ]}
                />
                <Bar dataKey="Successful" stackId="a" fill="#10B981" radius={[0,0,0,0]}/>
                <Bar dataKey="Failed"     stackId="a" fill="#EF4444" radius={[0,4,4,0]}/>
              </BarChart>
            </ResponsiveContainer>
          </div>
        )}

        {/* Failed logins by country */}
        {failedByCountry.length > 0 && (
          <div className="bg-white rounded-xl shadow-sm border border-cf-gray-200 p-4">
            <h3 className="text-sm font-semibold text-cf-navy mb-3">Failed Logins by Country</h3>
            <ResponsiveContainer width="100%" height={200}>
              <BarChart data={failedByCountry} layout="vertical" margin={{ top: 4, right: 16, bottom: 0, left: 40 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#F1F5F9"/>
                <XAxis type="number" tick={{ fontSize: 10 }}/>
                <YAxis type="category" dataKey="country" tick={{ fontSize: 10 }} width={36}/>
                <Tooltip contentStyle={{ fontSize: 11, borderRadius: 8 }} formatter={(v: number) => formatNumber(v)}/>
                <Bar dataKey="count" fill="#EF4444" radius={[0,4,4,0]}/>
              </BarChart>
            </ResponsiveContainer>
          </div>
        )}

        {/* Failed login details table */}
        {failed.length > 0 && (
          <div className="bg-white rounded-xl shadow-sm border border-cf-gray-200 overflow-hidden">
            <div className="px-5 py-3 border-b border-cf-gray-100">
              <h3 className="text-sm font-semibold text-cf-navy">Failed Login Details</h3>
            </div>
            <div className="overflow-y-auto" style={{ maxHeight: 220 }}>
              <table className="w-full text-xs">
                <thead className="sticky top-0">
                  <tr className="bg-cf-gray-50 text-cf-gray-500 uppercase tracking-wide text-[10px]">
                    <th className="px-4 py-2 text-left font-semibold">App</th>
                    <th className="px-4 py-2 text-left font-semibold">Country</th>
                    <th className="px-4 py-2 text-left font-semibold">IdP</th>
                    <th className="px-4 py-2 text-right font-semibold">Failures</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-cf-gray-100">
                  {failed.slice(0, 15).map((d, i) => (
                    <tr key={i} className={i % 2 === 0 ? "bg-white" : "bg-cf-gray-50/40"}>
                      <td className="px-4 py-1.5 font-mono text-cf-navy text-[11px]">{d.appId.slice(0, 20)}</td>
                      <td className="px-4 py-1.5 text-[11px] text-cf-gray-600">{d.country}</td>
                      <td className="px-4 py-1.5 text-[11px] text-cf-gray-600">{d.identityProvider}</td>
                      <td className="px-4 py-1.5 text-right font-mono font-bold text-red-600 text-[11px]">{formatNumber(d.count)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>
    </section>
  );
}
