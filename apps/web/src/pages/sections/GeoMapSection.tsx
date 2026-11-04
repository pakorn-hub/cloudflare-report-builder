/**
 * GeoMapSection — Geographic Traffic Distribution
 * Shows: D3-geo world map choropleth + top countries table.
 */
import { Globe } from "lucide-react";
import type { AppSecData } from "../../types";
import { formatNumber, formatBytes } from "../../utils/formatters";
import { alpha2ToName } from "../../utils/country-codes";
import SectionHeader from "../../components/SectionHeader";
import WorldMap from "../../components/charts/WorldMap";

interface Props {
  data: AppSecData;
}

export default function GeoMapSection({ data }: Props) {
  const countries = data.countryDistribution ?? [];
  const totalRequests = countries.reduce((s, r) => s + r.requests, 0);

  return (
    <section className="report-section">
      <SectionHeader
        icon={<Globe size={20} />}
        title="Geographic Traffic Distribution"
        subtitle={`Top traffic origins across the analysis period (${countries.length} countries)`}
      />

      {countries.length === 0 ? (
        <div className="bg-white rounded-xl border border-cf-gray-200 p-8 text-center">
          <p className="text-cf-gray-400 text-sm">No geographic data available for this zone.</p>
        </div>
      ) : (
        <>
          {/* D3-geo Natural Earth choropleth */}
          <div className="bg-white rounded-xl shadow-sm border border-cf-gray-200 p-5 mb-4">
            <h3 className="text-sm font-semibold text-cf-navy mb-1">Request Volume by Country</h3>
            <p className="text-xs text-cf-gray-500 mb-4">
              Darker orange = higher request volume. Hover to see country details.
            </p>
            <WorldMap data={countries} height={300} />
          </div>

          {/* Top Countries Table */}
          <div className="bg-white rounded-xl shadow-sm border border-cf-gray-200 overflow-hidden">
            <div className="px-5 py-4 border-b border-cf-gray-100">
              <h3 className="text-sm font-semibold text-cf-navy">Top Countries by Request Volume</h3>
              <p className="text-xs text-cf-gray-500 mt-0.5">
                Showing top {countries.length} countries — sorted by requests descending
              </p>
            </div>
            <div className="overflow-x-auto overflow-y-auto" style={{ maxHeight: 400 }}>
              <table className="w-full text-xs">
                <thead>
                  <tr className="bg-cf-gray-50 text-cf-gray-500 uppercase tracking-wide text-[10px]">
                    <th className="px-4 py-2.5 text-left font-semibold">#</th>
                    <th className="px-4 py-2.5 text-left font-semibold">Country</th>
                    <th className="px-4 py-2.5 text-right font-semibold">Requests</th>
                    <th className="px-4 py-2.5 text-right font-semibold">% of Total</th>
                    <th className="px-4 py-2.5 text-right font-semibold">Bandwidth</th>
                    <th className="px-4 py-2.5 text-right font-semibold">Threats</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-cf-gray-100">
                  {countries.map((row, i) => {
                    const pct = totalRequests > 0
                      ? ((row.requests / totalRequests) * 100).toFixed(1)
                      : "0.0";
                    const isThreat = row.threats > 0;
                    return (
                      <tr
                        key={row.clientCountryName}
                        className={i % 2 === 0 ? "bg-white" : "bg-cf-gray-50/50"}
                      >
                        <td className="px-4 py-2 text-cf-gray-400 font-mono">{i + 1}</td>
                        <td className="px-4 py-2 font-medium text-cf-navy">
                          {alpha2ToName(row.clientCountryName)}
                          <span className="text-cf-gray-400 text-[10px] ml-1 font-mono">({row.clientCountryName})</span>
                        </td>
                        <td className="px-4 py-2 text-right font-mono text-cf-gray-700">
                          {formatNumber(row.requests)}
                        </td>
                        <td className="px-4 py-2 text-right">
                          <div className="flex items-center justify-end gap-2">
                            <div className="w-16 bg-cf-gray-100 rounded-full h-1.5 overflow-hidden">
                              <div
                                className="h-full bg-cf-orange rounded-full"
                                style={{ width: `${Math.min(parseFloat(pct) * 3, 100)}%` }}
                              />
                            </div>
                            <span className="text-cf-gray-600 w-10 text-right">{pct}%</span>
                          </div>
                        </td>
                        <td className="px-4 py-2 text-right text-cf-gray-600 font-mono">
                          {formatBytes(row.bytes)}
                        </td>
                        <td className={`px-4 py-2 text-right font-mono ${isThreat ? "text-red-700 font-semibold" : "text-cf-gray-400"}`}>
                          {isThreat ? formatNumber(row.threats) : "—"}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}
    </section>
  );
}
