/**
 * AuditPage — Browse saved POC reports from the R2 audit bucket.
 * Accessible via the "Audit" link on the HomePage.
 */
import { useState, useEffect } from "react";
import { ArrowLeft, FileText, ExternalLink, Search, RefreshCw, Loader2, Shield, Globe } from "lucide-react";
import { fetchAuditList, type AuditReportMeta } from "../services/api";
import cfLogo from "../assets/cf-logo";

const API_BASE = import.meta.env.VITE_API_URL ?? "";

interface Props {
  onBack: () => void;
  userEmail?: string | null;
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function formatDate(iso: string): string {
  if (!iso) return "—";
  try {
    return new Date(iso).toLocaleString("en-US", { dateStyle: "medium", timeStyle: "short" });
  } catch {
    return iso;
  }
}

function productBadge(hostname: string) {
  const isZT = hostname.startsWith("zerotrust-") || hostname === "scheduled-zero-trust";
  const isMT = hostname.startsWith("magic-transit-") || hostname === "scheduled-magic-transit";
  return (
    <span
      className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold ${
        isMT ? "bg-cyan-100 text-cyan-700" : isZT ? "bg-blue-100 text-blue-700" : "bg-orange-100 text-orange-700"
      }`}
    >
      {isZT ? <Shield size={9} /> : <Globe size={9} />}
      {isMT ? "Magic Transit" : isZT ? "Cloudflare One" : "App Security"}
    </span>
  );
}

export default function AuditPage({ onBack, userEmail }: Props) {
  const [reports, setReports]   = useState<AuditReportMeta[]>([]);
  const [loading, setLoading]   = useState(true);
  const [error, setError]       = useState("");
  const [search, setSearch]     = useState("");

  async function load() {
    setLoading(true);
    setError("");
    try {
      const list = await fetchAuditList();
      setReports(list);
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(); }, []);

  const filtered = reports.filter((r) => {
    const q = search.toLowerCase();
    return (
      r.hostname.toLowerCase().includes(q) ||
      r.email.toLowerCase().includes(q) ||
      r.zoneName.toLowerCase().includes(q)
    );
  });

  return (
    <div className="min-h-screen bg-cf-gray-50">
      {/* Header */}
      <div className="bg-white border-b border-cf-gray-200 shadow-sm">
        <div className="max-w-5xl mx-auto px-4 py-3 flex items-center gap-3">
          <button
            onClick={onBack}
            className="flex items-center gap-1.5 text-sm text-cf-gray-500 hover:text-cf-navy transition"
          >
            <ArrowLeft size={14} /> Back
          </button>
          <div className="flex-1 flex items-center gap-2">
            <img src={cfLogo} alt="Cloudflare" className="h-5 object-contain" />
            <span className="text-sm font-semibold text-cf-navy">Report Audit</span>
            <span className="text-xs text-cf-gray-400">— Saved Reports</span>
          </div>
          {userEmail && (
            <span className="text-xs text-cf-gray-500 bg-cf-gray-100 px-2.5 py-1 rounded-full">{userEmail}</span>
          )}
          <button
            onClick={load}
            disabled={loading}
            className="flex items-center gap-1.5 text-xs text-cf-gray-500 hover:text-cf-navy transition disabled:opacity-40"
          >
            {loading ? <Loader2 size={12} className="animate-spin" /> : <RefreshCw size={12} />}
            Refresh
          </button>
        </div>
      </div>

      <div className="max-w-5xl mx-auto px-4 py-6 space-y-4">
        {/* Search + stats */}
        <div className="flex items-center gap-3">
          <div className="relative flex-1 max-w-sm">
            <Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-cf-gray-400" />
            <input
              type="text"
              placeholder="Search by zone, email, hostname…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="w-full pl-8 pr-3 py-1.5 text-sm border border-cf-gray-200 rounded-lg bg-white focus:outline-none focus:ring-2 focus:ring-cf-orange/30 focus:border-cf-orange"
            />
          </div>
          <span className="text-xs text-cf-gray-400">
            {loading ? "Loading…" : `${filtered.length} of ${reports.length} reports`}
          </span>
        </div>

        {/* Error */}
        {error && (
          <div className="bg-red-50 border border-red-200 text-red-700 text-sm rounded-lg px-4 py-3">
            Failed to load audit list: {error}
          </div>
        )}

        {/* Loading skeleton */}
        {loading && (
          <div className="space-y-2">
            {[1, 2, 3, 4, 5].map((i) => (
              <div key={i} className="bg-white rounded-xl border border-cf-gray-200 p-4 animate-pulse">
                <div className="h-3 bg-cf-gray-200 rounded w-1/3 mb-2" />
                <div className="h-2 bg-cf-gray-100 rounded w-1/2" />
              </div>
            ))}
          </div>
        )}

        {/* Empty state */}
        {!loading && !error && filtered.length === 0 && (
          <div className="text-center py-16 text-cf-gray-400">
            <FileText size={40} className="mx-auto mb-3 opacity-30" />
            <p className="text-sm font-medium">
              {search ? "No reports match your search" : "No saved reports yet"}
            </p>
            {!search && (
              <p className="text-xs mt-1">Reports are saved automatically after each report generation.</p>
            )}
          </div>
        )}

        {/* Reports table */}
        {!loading && filtered.length > 0 && (
          <div className="bg-white rounded-xl border border-cf-gray-200 overflow-hidden shadow-sm">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-cf-gray-50 text-cf-gray-500 text-[10px] uppercase tracking-wide border-b border-cf-gray-200">
                    <th className="px-4 py-2.5 text-left font-semibold">Zone / Account</th>
                    <th className="px-4 py-2.5 text-left font-semibold">Product</th>
                    <th className="px-4 py-2.5 text-left font-semibold">Generated by</th>
                    <th className="px-4 py-2.5 text-left font-semibold">Period</th>
                    <th className="px-4 py-2.5 text-left font-semibold">Date</th>
                    <th className="px-4 py-2.5 text-right font-semibold">Size</th>
                    <th className="px-4 py-2.5 text-center font-semibold">Open</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-cf-gray-100">
                  {filtered.map((r, i) => (
                    <tr key={r.key} className={i % 2 === 0 ? "bg-white" : "bg-cf-gray-50/40"}>
                      <td className="px-4 py-2.5">
                        <p className="font-semibold text-cf-navy text-xs">
                          {r.zoneName || r.hostname || "—"}
                        </p>
                        <p className="text-[10px] text-cf-gray-400 font-mono mt-0.5">{r.hostname}</p>
                      </td>
                      <td className="px-4 py-2.5">{productBadge(r.hostname)}</td>
                      <td className="px-4 py-2.5 text-xs text-cf-gray-600">{r.email || "—"}</td>
                      <td className="px-4 py-2.5 text-xs text-cf-gray-600">
                        {r.days ? `${r.days}-day` : "—"}
                      </td>
                      <td className="px-4 py-2.5 text-xs text-cf-gray-500">
                        {formatDate(r.generatedAt || r.uploaded)}
                      </td>
                      <td className="px-4 py-2.5 text-right text-xs text-cf-gray-400 font-mono">
                        {formatBytes(r.size)}
                      </td>
                      <td className="px-4 py-2.5 text-center">
                        <a
                          href={`${API_BASE}/api/audit/${encodeURIComponent(r.key)}`}
                          target="_blank"
                          rel="noreferrer"
                          className="inline-flex items-center gap-1 text-[10px] font-semibold text-blue-600 hover:text-blue-800 transition"
                          title="Open saved report in new tab"
                        >
                          <ExternalLink size={11} /> View
                        </a>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
