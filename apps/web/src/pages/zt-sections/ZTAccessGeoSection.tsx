import { Globe } from "lucide-react";
import type { ZeroTrustData } from "../../types";
import { formatNumber, formatRate } from "../../utils/formatters";
import SectionHeader from "../../components/SectionHeader";
import WorldMap from "../../components/charts/WorldMap";

export default function ZTAccessGeoSection({ data }: { data: ZeroTrustData }) {
  const geo = data.accessGeoDistribution;
  if (geo.length === 0) return null;

  const totalReqs = geo.reduce((s, g) => s + g.requests, 0);
  const topBlocked = [...geo].sort((a, b) => b.blocked - a.blocked).filter((g) => g.blocked > 0).slice(0, 5);

  const mapData = geo.map((g) => ({ clientCountryName: g.country, requests: g.requests, bytes: 0, threats: g.blocked }));

  return (
    <section className="report-section">
      <SectionHeader icon={<Globe size={20}/>} title="Access — Geographic Distribution"
        subtitle="Authentication request origins and blocked access attempts by country" />
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        <WorldMap data={mapData} height={300}/>
        <div className="bg-white rounded-xl shadow-sm border border-cf-gray-200 overflow-hidden">
          <div className="px-5 py-4 border-b border-cf-gray-100">
            <h3 className="text-sm font-semibold text-cf-navy">Top Countries by Auth Volume</h3>
          </div>
          <div className="overflow-y-auto" style={{ maxHeight: 280 }}>
            <table className="w-full text-xs">
              <thead className="sticky top-0">
                <tr className="bg-cf-gray-50 text-cf-gray-500 uppercase tracking-wide text-[10px]">
                  <th className="px-4 py-2 text-left font-semibold">Country</th>
                  <th className="px-4 py-2 text-right font-semibold">Requests</th>
                  <th className="px-4 py-2 text-right font-semibold">Blocked</th>
                  <th className="px-4 py-2 text-right font-semibold">Block%</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-cf-gray-100">
                {geo.slice(0, 20).map((g, i) => {
                  const blockPct = g.requests > 0 ? (g.blocked / g.requests) * 100 : 0;
                  return (
                    <tr key={g.country} className={i % 2 === 0 ? "bg-white" : "bg-cf-gray-50/40"}>
                      <td className="px-4 py-2 font-medium text-cf-navy text-[11px]">{g.country}</td>
                      <td className="px-4 py-2 text-right font-mono text-[11px] text-cf-gray-700">{formatNumber(g.requests)}</td>
                      <td className="px-4 py-2 text-right font-mono text-[11px] text-red-600">{formatNumber(g.blocked)}</td>
                      <td className="px-4 py-2 text-right font-mono text-[11px]">
                        <span className={blockPct > 20 ? "text-red-600 font-bold" : "text-cf-gray-500"}>{formatRate(g.blocked, g.requests)}</span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      </div>
      {topBlocked.length > 0 && (
        <div className="mt-4 bg-red-50 border border-red-200 rounded-xl p-4">
          <p className="text-xs font-semibold text-red-700 mb-2">Top Sources of Blocked Auth Attempts</p>
          <div className="flex flex-wrap gap-2">
            {topBlocked.map((g) => (
              <span key={g.country} className="text-[11px] bg-white border border-red-200 text-red-700 px-3 py-1 rounded-full">
                {g.country} — {formatNumber(g.blocked)} blocked ({totalReqs > 0 ? Math.round((g.blocked/totalReqs)*100) : 0}%)
              </span>
            ))}
          </div>
        </div>
      )}
    </section>
  );
}
