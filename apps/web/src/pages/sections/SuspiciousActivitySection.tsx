/**
 * SuspiciousActivitySection — mirrors Cloudflare's Security Analytics
 * "Suspicious Activity" dashboard panel. Covers four detection categories
 * with confirmed, real data sources that aren't already broken out into
 * their own dedicated section:
 *
 *   1. Account Takeover        — Bot Management detection IDs (real counts,
 *                                 confirmed GraphQL field: botDetectionIds)
 *   2. Leaked Credential Check — real per-result detection counts (real
 *                                 GraphQL field: leakedCredentialCheckResult
 *                                 — confirmed via live schema introspection
 *                                 2026-09-01), replacing the old dead
 *                                 HIBP-style stub entirely
 *   3. Malicious Uploads       — real Content Scanning detection counts
 *                                 (confirmed GraphQL fields:
 *                                 contentScanNumMaliciousObj,
 *                                 contentScanHasFailed, contentScanObjResults)
 *   4. WAF Attack Score by Vector — real per-vector SQLi/XSS/RCE/Path
 *                                 Traversal average scores (confirmed
 *                                 GraphQL fields: wafSqliAttackScore etc. —
 *                                 these DO exist, but only as `dimensions`
 *                                 fields, not inside an `avg {}` aggregate,
 *                                 which is why an earlier attempt querying
 *                                 them under `avg {}` failed with "unknown
 *                                 field")
 *
 * AI Security for Apps (PII/unsafe-topic/prompt-injection) has its own
 * dedicated section (AiSecuritySection.tsx), so it's not duplicated here.
 *
 * Enabled/disabled status for Leaked Credential Check and Content Scanning
 * are Enterprise paid add-ons; showing them as "not enabled" is itself a
 * valuable POC finding, not an error.
 */
import { UserX, KeyRound, FileWarning, Gauge, CheckCircle2, XCircle, AlertTriangle } from "lucide-react";
import type { AppSecData } from "../../types";
import { formatNumber } from "../../utils/formatters";
import SectionHeader from "../../components/SectionHeader";

interface Props { data: AppSecData }

function StatusPill({ enabled }: { enabled: boolean }) {
  return (
    <div
      className="flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[10px] font-semibold border flex-shrink-0"
      style={{
        borderColor: enabled ? "#10B98140" : "#EF444440",
        backgroundColor: enabled ? "#F0FDF4" : "#FEF2F2",
        color: enabled ? "#15803D" : "#B91C1C",
      }}
    >
      {enabled ? <CheckCircle2 size={12} /> : <XCircle size={12} />}
      {enabled ? "Enabled" : "Not Enabled"}
    </div>
  );
}

function resultLabel(result: string): string {
  return result.replace(/_/g, " ").replace(/^\w/, (c) => c.toUpperCase());
}

export default function SuspiciousActivitySection({ data }: Props) {
  const accountTakeover = data.accountTakeover ?? { totalRequests: 0, topPaths: [] };
  const leakedCredCheck = data.leakedCredentialCheck ?? { enabled: false, customDetections: 0, totalChecked: 0, breachedCount: 0, byResult: [] };
  const contentScanning = data.contentScanning ?? { enabled: false, totalScannedRequests: 0, requestsWithMaliciousObject: 0, scanFailedCount: 0, objResultsBreakdown: [] };
  const wafPerVector = data.wafPerVectorScore;

  const hasAnyData =
    accountTakeover.totalRequests > 0 ||
    leakedCredCheck.enabled ||
    contentScanning.enabled ||
    (wafPerVector && wafPerVector.scoredCount > 0);

  if (!hasAnyData) return null;

  return (
    <section className="report-section">
      <SectionHeader
        icon={<AlertTriangle size={20} />}
        title="Suspicious Activity"
        subtitle="Account takeover, leaked credential checks, malicious upload scanning, and per-vector WAF attack scoring"
        printBreak
      />

      <div className="space-y-4">
        {/* ── Account Takeover ─────────────────────────────────────────── */}
        <div className="bg-white rounded-xl shadow-sm border border-cf-gray-200 overflow-hidden">
          <div className="px-5 py-4 border-b border-cf-gray-100 flex items-center gap-3">
            <div className="w-8 h-8 bg-red-50 rounded-lg flex items-center justify-center">
              <UserX size={16} className="text-red-600" />
            </div>
            <div className="flex-1">
              <h3 className="text-sm font-semibold text-cf-navy">Account Takeover</h3>
              <p className="text-xs text-cf-gray-500 mt-0.5">
                Bot Management detection signals: repeated login failures, high-volume login attempts, and anomalous login-success-rate deviation
              </p>
            </div>
            {accountTakeover.totalRequests > 0 && (
              <div className="bg-red-50 border border-red-200 rounded-lg px-3 py-2 text-right flex-shrink-0">
                <p className="text-lg font-bold text-red-700">{formatNumber(accountTakeover.totalRequests)}</p>
                <p className="text-[10px] text-red-600">flagged requests</p>
              </div>
            )}
          </div>
          {accountTakeover.totalRequests > 0 ? (
            <div className="p-5">
              <h4 className="text-xs font-semibold text-cf-gray-600 uppercase tracking-wide mb-2">Top Targeted Paths</h4>
              <table className="w-full text-xs">
                <thead>
                  <tr className="bg-cf-gray-50 text-cf-gray-500 uppercase tracking-wide text-[10px]">
                    <th className="px-3 py-2 text-left font-semibold">Host</th>
                    <th className="px-3 py-2 text-left font-semibold">Path</th>
                    <th className="px-3 py-2 text-right font-semibold">Requests</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-cf-gray-100">
                  {accountTakeover.topPaths.slice(0, 10).map((p, i) => (
                    <tr key={`${p.host}${p.path}`} className={i % 2 === 0 ? "bg-white" : "bg-cf-gray-50/40"}>
                      <td className="px-3 py-1.5 font-mono text-cf-gray-500 text-[11px] max-w-[160px] truncate" title={p.host}>{p.host || "—"}</td>
                      <td className="px-3 py-1.5 font-mono text-cf-navy text-[11px] max-w-[240px] truncate" title={p.path}>{p.path}</td>
                      <td className="px-3 py-1.5 text-right font-mono font-bold text-red-600 text-[11px]">{formatNumber(p.requests)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <div className="p-5 text-xs text-cf-gray-500">No account-takeover signals detected this period.</div>
          )}
        </div>

        {/* ── Leaked Credential Check + Malicious Uploads ─────────────────── */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {/* Leaked Credential Check */}
          <div className="bg-white rounded-xl shadow-sm border border-cf-gray-200 p-4">
            <div className="flex items-start justify-between gap-2 mb-2">
              <div className="flex items-center gap-2">
                <KeyRound size={15} className="text-yellow-600 flex-shrink-0" />
                <h3 className="text-sm font-semibold text-cf-navy">Leaked Credential Check</h3>
              </div>
              <StatusPill enabled={leakedCredCheck.enabled} />
            </div>
            <p className="text-[11px] text-cf-gray-500 mb-2">
              Flags logins using username/password pairs known to be compromised in third-party breaches.
            </p>
            {leakedCredCheck.enabled && leakedCredCheck.totalChecked > 0 ? (
              <>
                <div className="flex items-baseline gap-2 mb-2">
                  <span className={`text-xl font-black ${leakedCredCheck.breachedCount > 0 ? "text-red-600" : "text-green-600"}`}>
                    {formatNumber(leakedCredCheck.breachedCount)}
                  </span>
                  <span className="text-[11px] text-cf-gray-500">breached out of {formatNumber(leakedCredCheck.totalChecked)} checked</span>
                </div>
                <div className="space-y-1">
                  {leakedCredCheck.byResult.map((r) => (
                    <div key={r.result} className="flex justify-between text-[11px]">
                      <span className={r.result === "clean" ? "text-cf-gray-500" : "text-red-600 font-medium"}>{resultLabel(r.result)}</span>
                      <span className="font-mono text-cf-gray-600">{formatNumber(r.count)}</span>
                    </div>
                  ))}
                </div>
                <p className="text-[10px] text-cf-gray-400 mt-2">{leakedCredCheck.customDetections} custom detection location{leakedCredCheck.customDetections === 1 ? "" : "s"} configured</p>
              </>
            ) : leakedCredCheck.enabled ? (
              <p className="text-[11px] text-cf-gray-400">Enabled — no login checks recorded this period.</p>
            ) : (
              <p className="text-[11px] text-red-600 font-medium mt-1">Not protecting login endpoints against breached-password reuse.</p>
            )}
          </div>

          {/* Malicious Uploads */}
          <div className="bg-white rounded-xl shadow-sm border border-cf-gray-200 p-4">
            <div className="flex items-start justify-between gap-2 mb-2">
              <div className="flex items-center gap-2">
                <FileWarning size={15} className="text-orange-600 flex-shrink-0" />
                <h3 className="text-sm font-semibold text-cf-navy">Malicious Uploads</h3>
              </div>
              <StatusPill enabled={contentScanning.enabled} />
            </div>
            <p className="text-[11px] text-cf-gray-500 mb-2">
              Content Scanning inspects uploaded files (images, documents, archives) for malware before they reach origin.
            </p>
            {contentScanning.enabled && contentScanning.totalScannedRequests > 0 ? (
              <>
                <div className="flex items-baseline gap-2 mb-2">
                  <span className={`text-xl font-black ${contentScanning.requestsWithMaliciousObject > 0 ? "text-red-600" : "text-green-600"}`}>
                    {formatNumber(contentScanning.requestsWithMaliciousObject)}
                  </span>
                  <span className="text-[11px] text-cf-gray-500">malicious out of {formatNumber(contentScanning.totalScannedRequests)} scanned</span>
                </div>
                {contentScanning.objResultsBreakdown.length > 0 && (
                  <div className="space-y-1">
                    {contentScanning.objResultsBreakdown.slice(0, 5).map((r) => (
                      <div key={r.result} className="flex justify-between text-[11px]">
                        <span className={r.result?.toLowerCase().includes("clean") ? "text-cf-gray-500" : "text-red-600 font-medium"}>{resultLabel(r.result)}</span>
                        <span className="font-mono text-cf-gray-600">{formatNumber(r.count)}</span>
                      </div>
                    ))}
                  </div>
                )}
                {contentScanning.scanFailedCount > 0 && (
                  <p className="text-[10px] text-amber-600 mt-2">{formatNumber(contentScanning.scanFailedCount)} scan(s) failed to complete</p>
                )}
              </>
            ) : contentScanning.enabled ? (
              <p className="text-[11px] text-cf-gray-400">Enabled — no upload objects scanned this period.</p>
            ) : (
              <p className="text-[11px] text-red-600 font-medium mt-1">File upload endpoints are not scanned for malicious content.</p>
            )}
          </div>
        </div>

        {/* ── Per-Vector WAF Attack Score ───────────────────────────────── */}
        {wafPerVector && wafPerVector.scoredCount > 0 && (
          <div className="bg-white rounded-xl shadow-sm border border-cf-gray-200 p-4">
            <div className="flex items-center gap-2 mb-3">
              <Gauge size={15} className="text-cf-orange" />
              <h3 className="text-sm font-semibold text-cf-navy">WAF Attack Score — By Vector</h3>
            </div>
            <p className="text-[11px] text-cf-gray-400 mb-3">
              Average sub-score (1-99, lower = more confident attack) across {formatNumber(wafPerVector.scoredCount)} non-clean-scored request(s) this period.
            </p>
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
              {[
                { label: "SQL Injection", value: wafPerVector.avgSqliScore },
                { label: "Cross-Site Scripting", value: wafPerVector.avgXssScore },
                { label: "Remote Code Execution", value: wafPerVector.avgRceScore },
                { label: "Path Traversal", value: wafPerVector.avgPathTraversalScore },
              ].map((v) => (
                <div key={v.label} className="rounded-lg border border-cf-gray-200 p-3 text-center">
                  <p className="text-[10px] text-cf-gray-500 uppercase tracking-wide mb-1">{v.label}</p>
                  <p
                    className="text-2xl font-black"
                    style={{ color: v.value != null && v.value < 30 ? "#DC2626" : v.value != null && v.value < 60 ? "#F59E0B" : "#10B981" }}
                  >
                    {v.value != null ? Math.round(v.value) : "—"}
                  </p>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </section>
  );
}
