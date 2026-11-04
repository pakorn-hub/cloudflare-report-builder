import { Users, AlertTriangle } from "lucide-react";
import type { ZeroTrustData } from "../../types";
import { formatNumber } from "../../utils/formatters";
import SectionHeader from "../../components/SectionHeader";

export default function ZTTopUsersSection({ data }: { data: ZeroTrustData }) {
  const users       = data.accessTopUsers;
  const topApps     = data.accessTopApps;
  const blockedUsers = data.accessTopBlockedUsers;
  if (users.length === 0 && topApps.length === 0) return null;

  return (
    <section className="report-section">
      <SectionHeader icon={<Users size={20}/>} title="Access — Top Users & Applications"
        subtitle="Most active users and applications, plus blocked access attempts" />
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        {/* Top users */}
        {users.length > 0 && (
          <div className="bg-white rounded-xl shadow-sm border border-cf-gray-200 overflow-hidden">
            <div className="px-5 py-3 border-b border-cf-gray-100"><h3 className="text-sm font-semibold text-cf-navy">Most Active Users</h3></div>
            <div className="overflow-y-auto" style={{ maxHeight: 320 }}>
              <table className="w-full text-xs">
                <thead className="sticky top-0">
                  <tr className="bg-cf-gray-50 text-cf-gray-500 uppercase tracking-wide text-[10px]">
                    <th className="px-4 py-2 text-left font-semibold">#</th>
                    <th className="px-4 py-2 text-left font-semibold">User</th>
                    <th className="px-4 py-2 text-right font-semibold">Auth</th>
                    <th className="px-4 py-2 text-right font-semibold">Blocked</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-cf-gray-100">
                  {users.map((u, i) => (
                    <tr key={u.email} className={i % 2 === 0 ? "bg-white" : "bg-cf-gray-50/40"}>
                      <td className="px-4 py-2 text-cf-gray-400 font-mono text-[11px]">{i+1}</td>
                      <td className="px-4 py-2 font-medium text-cf-navy text-[11px] max-w-[180px] truncate">{u.email}</td>
                      <td className="px-4 py-2 text-right font-mono text-[11px] text-blue-600">{formatNumber(u.requests)}</td>
                      <td className="px-4 py-2 text-right font-mono text-[11px] text-red-600">{formatNumber(u.blocked)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
        {/* Top apps */}
        {topApps.length > 0 && (
          <div className="bg-white rounded-xl shadow-sm border border-cf-gray-200 overflow-hidden">
            <div className="px-5 py-3 border-b border-cf-gray-100"><h3 className="text-sm font-semibold text-cf-navy">Most Accessed Applications</h3></div>
            <div className="overflow-y-auto" style={{ maxHeight: 320 }}>
              <table className="w-full text-xs">
                <thead className="sticky top-0">
                  <tr className="bg-cf-gray-50 text-cf-gray-500 uppercase tracking-wide text-[10px]">
                    <th className="px-4 py-2 text-left font-semibold">#</th>
                    <th className="px-4 py-2 text-left font-semibold">Application</th>
                    <th className="px-4 py-2 text-right font-semibold">Requests</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-cf-gray-100">
                  {topApps.map((a, i) => {
                    const maxVal = topApps[0]?.requests ?? 1;
                    const pct = Math.round((a.requests / maxVal) * 100);
                    return (
                      <tr key={a.name} className={i % 2 === 0 ? "bg-white" : "bg-cf-gray-50/40"}>
                        <td className="px-4 py-2 text-cf-gray-400 font-mono text-[11px]">{i+1}</td>
                        <td className="px-4 py-2 text-[11px]">
                          <div className="font-medium text-cf-navy mb-1">{a.name}</div>
                          <div className="w-full bg-cf-gray-100 rounded-full h-1"><div className="h-full rounded-full bg-blue-400" style={{ width: `${pct}%` }}/></div>
                        </td>
                        <td className="px-4 py-2 text-right font-mono font-bold text-blue-600 text-[11px]">{formatNumber(a.requests)}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>
      {blockedUsers.length > 0 && (
        <div className="bg-red-50 border border-red-200 rounded-xl p-4 mt-4">
          <div className="flex items-center gap-2 mb-3"><AlertTriangle size={14} className="text-red-500"/><h3 className="text-xs font-semibold text-red-700">Top Blocked Users</h3></div>
          <div className="flex flex-wrap gap-2">
            {blockedUsers.slice(0,8).map((u) => (
              <span key={u.email} className="text-[11px] bg-white border border-red-200 text-red-700 px-3 py-1 rounded-full">
                {u.email} — {formatNumber(u.count)}
              </span>
            ))}
          </div>
        </div>
      )}
    </section>
  );
}
