/**
 * ContentAnalysisSection — Content Type Analysis
 * Shows: content type breakdown by request count and bandwidth.
 */
import { FileText } from "lucide-react";
import type { AppSecData } from "../../types";
import { formatNumber, formatBytes } from "../../utils/formatters";
import SectionHeader from "../../components/SectionHeader";
import PieBreakdownChart from "../../components/charts/PieBreakdownChart";

interface Props {
  data: AppSecData;
}

const CONTENT_TYPE_COLORS = [
  "#F6821F", // html
  "#3B82F6", // image/jpeg/png
  "#10B981", // javascript
  "#8B5CF6", // css
  "#00B0D1", // json/api
  "#F59E0B", // font
  "#EC4899", // video
  "#EF4444", // other
  "#64748B",
  "#6B7280",
];

// Human-readable labels for MIME type names
function formatContentType(name: string): string {
  const MAP: Record<string, string> = {
    html: "HTML",
    jpeg: "JPEG",
    png: "PNG",
    gif: "GIF",
    webp: "WebP",
    svg: "SVG",
    javascript: "JavaScript",
    css: "CSS",
    json: "JSON (API)",
    xml: "XML",
    plain: "Plain Text",
    "octet-stream": "Binary",
    mp4: "MP4 Video",
    webm: "WebM Video",
    woff: "Web Font (WOFF)",
    woff2: "Web Font (WOFF2)",
    pdf: "PDF",
  };
  return MAP[name.toLowerCase()] ?? name;
}

export default function ContentAnalysisSection({ data }: Props) {
  const contentTypes = data.contentTypeBreakdown ?? [];

  const pieData = contentTypes.map((ct) => ({
    name: formatContentType(ct.edgeResponseContentTypeName),
    value: ct.requests,
  }));

  const totalRequests = contentTypes.reduce((s, r) => s + r.requests, 0);
  const totalBytes    = contentTypes.reduce((s, r) => s + r.bytes, 0);

  return (
    <section className="report-section">
      <SectionHeader
        icon={<FileText size={20} />}
        title="Content Analysis"
        subtitle="Request distribution and bandwidth by content type / MIME type"
      />

      {contentTypes.length === 0 ? (
        <div className="bg-white rounded-xl border border-cf-gray-200 p-8 text-center">
          <p className="text-cf-gray-400 text-sm">No content type data available for this zone.</p>
        </div>
      ) : (
        <div className="space-y-6">
          {/* Summary KPIs */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <div className="bg-white rounded-xl shadow-sm border border-cf-gray-200 p-4">
              <p className="text-xs text-cf-gray-500 mb-1">Total Requests</p>
              <p className="text-2xl font-bold text-cf-navy">{formatNumber(totalRequests)}</p>
              <p className="text-xs text-cf-gray-400 mt-0.5">{contentTypes.length} content types</p>
            </div>
            <div className="bg-white rounded-xl shadow-sm border border-cf-gray-200 p-4">
              <p className="text-xs text-cf-gray-500 mb-1">Total Bandwidth</p>
              <p className="text-2xl font-bold text-cf-navy">{formatBytes(totalBytes)}</p>
              <p className="text-xs text-cf-gray-400 mt-0.5">served from edge</p>
            </div>
            <div className="bg-white rounded-xl shadow-sm border border-cf-gray-200 p-4">
              <p className="text-xs text-cf-gray-500 mb-1">Top Content Type</p>
              <p className="text-2xl font-bold text-cf-orange">
                {contentTypes[0] ? formatContentType(contentTypes[0].edgeResponseContentTypeName) : "—"}
              </p>
              <p className="text-xs text-cf-gray-400 mt-0.5">by request count</p>
            </div>
          </div>

          {/* Pie chart + bandwidth table side by side */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {pieData.length > 0 && (
              <PieBreakdownChart
                data={pieData}
                title="Content Type Distribution"
                subtitle="By request count"
                colors={CONTENT_TYPE_COLORS}
                height={320}
                innerRadius={60}
              />
            )}

            {/* Bandwidth table */}
            <div className="bg-white rounded-xl shadow-sm border border-cf-gray-200 overflow-hidden">
              <div className="px-5 py-3 border-b border-cf-gray-100">
                <h3 className="text-sm font-semibold text-cf-navy">Content Type Bandwidth</h3>
                <p className="text-xs text-cf-gray-500 mt-0.5">Sorted by bandwidth descending</p>
              </div>
              <table className="w-full text-xs">
                <thead>
                  <tr className="bg-cf-gray-50 text-cf-gray-500 uppercase tracking-wide text-[10px]">
                    <th className="px-4 py-2 text-left font-semibold">Type</th>
                    <th className="px-4 py-2 text-right font-semibold">Bandwidth</th>
                    <th className="px-4 py-2 text-right font-semibold">Requests</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-cf-gray-100">
                  {contentTypes
                    .slice()
                    .sort((a, b) => b.bytes - a.bytes)
                    .map((ct, i) => (
                      <tr key={ct.edgeResponseContentTypeName} className={i % 2 === 0 ? "bg-white" : "bg-cf-gray-50/40"}>
                        <td className="px-4 py-2 font-medium text-cf-navy">
                          <span className="inline-block w-2 h-2 rounded-full mr-2"
                            style={{ backgroundColor: CONTENT_TYPE_COLORS[i % CONTENT_TYPE_COLORS.length] }} />
                          {formatContentType(ct.edgeResponseContentTypeName)}
                        </td>
                        <td className="px-4 py-2 text-right font-mono text-cf-gray-700">{formatBytes(ct.bytes)}</td>
                        <td className="px-4 py-2 text-right font-mono text-cf-gray-500">{formatNumber(ct.requests)}</td>
                      </tr>
                    ))}
                </tbody>
              </table>
            </div>
          </div>

          {/* Full breakdown table */}
          <div className="bg-white rounded-xl shadow-sm border border-cf-gray-200 overflow-hidden">
            <div className="px-5 py-3 border-b border-cf-gray-100">
              <h3 className="text-sm font-semibold text-cf-navy">Full Content Type Breakdown</h3>
              <p className="text-xs text-cf-gray-500 mt-0.5">All {contentTypes.length} content types — sorted by request count</p>
            </div>
            <table className="w-full text-xs">
              <thead>
                <tr className="bg-cf-gray-50 text-cf-gray-500 uppercase tracking-wide text-[10px]">
                  <th className="px-4 py-2.5 text-left font-semibold">#</th>
                  <th className="px-4 py-2.5 text-left font-semibold">Content Type</th>
                  <th className="px-4 py-2.5 text-right font-semibold">Requests</th>
                  <th className="px-4 py-2.5 text-right font-semibold">% of Total</th>
                  <th className="px-4 py-2.5 text-right font-semibold">Bandwidth</th>
                  <th className="px-4 py-2.5 text-left font-semibold pl-4">Share</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-cf-gray-100">
                {contentTypes.map((ct, i) => {
                  const pct = totalRequests > 0
                    ? ((ct.requests / totalRequests) * 100).toFixed(1)
                    : "0.0";
                  return (
                    <tr key={ct.edgeResponseContentTypeName} className={i % 2 === 0 ? "bg-white" : "bg-cf-gray-50/40"}>
                      <td className="px-4 py-2 text-cf-gray-400 font-mono">{i + 1}</td>
                      <td className="px-4 py-2 font-medium text-cf-navy">
                        {formatContentType(ct.edgeResponseContentTypeName)}
                        <span className="text-cf-gray-400 font-normal ml-1 font-mono text-[10px]">
                          ({ct.edgeResponseContentTypeName})
                        </span>
                      </td>
                      <td className="px-4 py-2 text-right font-mono text-cf-gray-700">{formatNumber(ct.requests)}</td>
                      <td className="px-4 py-2 text-right font-semibold text-cf-gray-700">{pct}%</td>
                      <td className="px-4 py-2 text-right font-mono text-cf-gray-600">{formatBytes(ct.bytes)}</td>
                      <td className="px-4 py-2 pl-4">
                        <div className="w-24 bg-cf-gray-100 rounded-full h-1.5 overflow-hidden">
                          <div
                            className="h-full rounded-full"
                            style={{
                              width: `${Math.min(parseFloat(pct) * 2, 100)}%`,
                              backgroundColor: CONTENT_TYPE_COLORS[i % CONTENT_TYPE_COLORS.length],
                            }}
                          />
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </section>
  );
}
