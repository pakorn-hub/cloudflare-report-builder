/**
 * EmailSecuritySection — DMARC Management & Email Security Overview
 * Shows: SPF / DMARC / DKIM status, MX records, email authentication grade,
 *        actionable issues, Cloudflare Email Security routing detection.
 */
import { Mail, ShieldCheck, ShieldX, AlertTriangle, CheckCircle2, Server } from "lucide-react";
import type { AppSecData } from "../../types";
import SectionHeader from "../../components/SectionHeader";

interface Props { data: AppSecData }

// Grade badge
const GRADE_STYLE: Record<string, string> = {
  A: "bg-green-50 text-green-700 border-green-300",
  B: "bg-blue-50 text-blue-700 border-blue-300",
  C: "bg-yellow-50 text-yellow-700 border-yellow-300",
  D: "bg-orange-50 text-orange-700 border-orange-300",
  F: "bg-red-50 text-red-700 border-red-300",
};

// Policy badge colour
function policyBadge(policy: string): string {
  const p = policy.toLowerCase();
  if (p === "reject")                return "bg-green-50 text-green-700 border-green-200";
  if (p === "quarantine")            return "bg-blue-50 text-blue-700 border-blue-200";
  if (p === "none")                  return "bg-yellow-50 text-yellow-700 border-yellow-200";
  if (p.includes("fail") && !p.includes("soft")) return "bg-green-50 text-green-700 border-green-200";
  if (p.includes("soft"))            return "bg-yellow-50 text-yellow-700 border-yellow-200";
  if (p.includes("no "))             return "bg-red-50 text-red-700 border-red-200";
  return "bg-cf-gray-100 text-cf-gray-600 border-cf-gray-200";
}

function StatusRow({ label, value, ok, detail }: { label: string; value: string; ok: boolean | null; detail?: string }) {
  return (
    <div className="flex items-start justify-between py-2.5 border-b border-cf-gray-100 last:border-0">
      <div>
        <span className="text-xs font-semibold text-cf-gray-700">{label}</span>
        {detail && <p className="text-[10px] text-cf-gray-400 mt-0.5 font-mono">{detail}</p>}
      </div>
      <div className="flex items-center gap-2 ml-4 flex-shrink-0">
        {ok === true  && <CheckCircle2 size={14} className="text-green-500" />}
        {ok === false && <ShieldX size={14} className="text-red-500" />}
        {ok === null  && <AlertTriangle size={14} className="text-yellow-500" />}
        <span className={`inline-block px-2 py-0.5 rounded-full text-[10px] font-semibold border ${policyBadge(value)}`}>
          {value}
        </span>
      </div>
    </div>
  );
}

export default function EmailSecuritySection({ data }: Props) {
  const em = data.emailSecurity;
  if (!em) return null;

  const dkimFound = em.dkimSelectors.length > 0;
  const spfOk = !!em.spfRecord && !em.spfRecord.includes("+all");
  const dmarcOk = !!em.dmarcRecord && em.dmarcPolicy !== "none";
  const dkimOk = dkimFound;

  return (
    <section className="report-section">
      <SectionHeader
        icon={<Mail size={20} />}
        title="Email Security (DMARC Management)"
        subtitle={`Email authentication status for ${em.domain} — SPF · DMARC · DKIM · MX routing`}
        printBreak
      />

      <div className="space-y-4">
        {/* Overall grade + quick summary */}
        <div className="grid grid-cols-2 lg:grid-cols-5 gap-3">
          {/* Grade */}
          <div className="bg-white rounded-xl shadow-sm border border-cf-gray-200 p-4 text-center lg:col-span-1">
            <p className="text-xs text-cf-gray-500 mb-2">Email Auth Grade</p>
            <div className={`w-16 h-16 mx-auto rounded-full flex items-center justify-center text-3xl font-black border-2 ${GRADE_STYLE[em.grade]}`}>
              {em.grade}
            </div>
            <p className="text-[10px] text-cf-gray-400 mt-2">
              {em.grade === "A" ? "Excellent" : em.grade === "B" ? "Good" : em.grade === "C" ? "Fair" : em.grade === "D" ? "Weak" : "Critical"}
            </p>
          </div>

          {/* SPF */}
          <div className={`bg-white rounded-xl shadow-sm border p-4 ${spfOk ? "border-green-200" : "border-red-200"}`}>
            <div className="flex items-center gap-2 mb-2">
              {spfOk ? <CheckCircle2 size={14} className="text-green-500" /> : <ShieldX size={14} className="text-red-500" />}
              <p className="text-xs font-semibold text-cf-navy">SPF</p>
            </div>
            <p className={`text-sm font-bold ${spfOk ? "text-green-700" : "text-red-700"}`}>
              {em.spfRecord ? "Configured" : "Missing"}
            </p>
            <p className="text-[10px] text-cf-gray-500 mt-0.5">{em.spfPolicy}</p>
          </div>

          {/* DMARC */}
          <div className={`bg-white rounded-xl shadow-sm border p-4 ${dmarcOk ? "border-green-200" : em.dmarcRecord ? "border-yellow-200" : "border-red-200"}`}>
            <div className="flex items-center gap-2 mb-2">
              {dmarcOk ? <CheckCircle2 size={14} className="text-green-500" />
                : em.dmarcRecord ? <AlertTriangle size={14} className="text-yellow-500" />
                : <ShieldX size={14} className="text-red-500" />}
              <p className="text-xs font-semibold text-cf-navy">DMARC</p>
            </div>
            <p className={`text-sm font-bold capitalize ${dmarcOk ? "text-green-700" : em.dmarcRecord ? "text-yellow-700" : "text-red-700"}`}>
              {em.dmarcRecord ? `Policy: ${em.dmarcPolicy}` : "Missing"}
            </p>
            <p className="text-[10px] text-cf-gray-500 mt-0.5">{em.dmarcPct < 100 ? `${em.dmarcPct}% enforced` : "100% enforced"}</p>
          </div>

          {/* DKIM */}
          <div className={`bg-white rounded-xl shadow-sm border p-4 ${dkimOk ? "border-green-200" : "border-red-200"}`}>
            <div className="flex items-center gap-2 mb-2">
              {dkimOk ? <CheckCircle2 size={14} className="text-green-500" /> : <ShieldX size={14} className="text-red-500" />}
              <p className="text-xs font-semibold text-cf-navy">DKIM</p>
            </div>
            <p className={`text-sm font-bold ${dkimOk ? "text-green-700" : "text-red-700"}`}>
              {dkimOk ? `${em.dkimSelectors.length} selector${em.dkimSelectors.length !== 1 ? "s" : ""} found` : "Not detected"}
            </p>
            <p className="text-[10px] text-cf-gray-500 mt-0.5">
              {dkimOk ? em.dkimSelectors.map((s) => s.selector).join(", ") : "Check provider settings"}
            </p>
          </div>

          {/* MX / Cloudflare Email */}
          <div className={`bg-white rounded-xl shadow-sm border p-4 ${em.usingCloudflareEmailSecurity ? "border-cf-orange/30 bg-orange-50/20" : "border-cf-gray-200"}`}>
            <div className="flex items-center gap-2 mb-2">
              <Server size={14} className={em.usingCloudflareEmailSecurity ? "text-cf-orange" : "text-cf-gray-400"} />
              <p className="text-xs font-semibold text-cf-navy">MX Routing</p>
            </div>
            <p className="text-sm font-bold text-cf-navy">{em.mxRecords.length} MX record{em.mxRecords.length !== 1 ? "s" : ""}</p>
            <p className="text-[10px] mt-0.5">
              {em.usingCloudflareEmailSecurity
                ? <span className="text-cf-orange font-semibold">Cloudflare Email Security</span>
                : <span className="text-cf-gray-500">{em.mxRecords[0]?.exchange.split(".").slice(-3).join(".") ?? "Unknown provider"}</span>}
            </p>
          </div>
        </div>

        {/* Issues */}
        {em.issues.length > 0 && (
          <div className="bg-red-50 border border-red-200 rounded-xl p-4">
            <div className="flex items-center gap-2 mb-2">
              <AlertTriangle size={14} className="text-red-600" />
              <p className="text-xs font-semibold text-red-700">Email Security Issues ({em.issues.length})</p>
            </div>
            <ul className="space-y-1">
              {em.issues.map((issue, i) => (
                <li key={i} className="flex items-start gap-2 text-xs text-red-700">
                  <span className="w-1.5 h-1.5 rounded-full bg-red-400 flex-shrink-0 mt-1.5" />
                  {issue}
                </li>
              ))}
            </ul>
          </div>
        )}

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {/* SPF + DMARC detail */}
          <div className="bg-white rounded-xl shadow-sm border border-cf-gray-200 p-5">
            <div className="flex items-center gap-2 mb-4">
              <ShieldCheck size={14} className="text-blue-600" />
              <h3 className="text-sm font-semibold text-cf-navy">SPF & DMARC Configuration</h3>
            </div>
            <StatusRow
              label="SPF Policy"
              value={em.spfPolicy || "No record"}
              ok={spfOk}
              detail={em.spfRecord || undefined}
            />
            {em.spfIncludes.length > 0 && (
              <div className="py-2 border-b border-cf-gray-100">
                <p className="text-xs text-cf-gray-500 mb-1">Authorized Senders (include:)</p>
                <div className="flex flex-wrap gap-1">
                  {em.spfIncludes.map((inc) => (
                    <span key={inc} className="inline-block px-2 py-0.5 bg-blue-50 text-blue-700 text-[10px] font-mono rounded border border-blue-200">
                      {inc}
                    </span>
                  ))}
                </div>
              </div>
            )}
            <StatusRow
              label="DMARC Policy"
              value={em.dmarcRecord ? em.dmarcPolicy.toUpperCase() : "No record"}
              ok={dmarcOk}
            />
            {em.dmarcRecord && (
              <>
                <StatusRow label="Subdomain Policy" value={em.dmarcSubdomainPolicy} ok={null} />
                <StatusRow label="Enforcement %" value={`${em.dmarcPct}%`} ok={em.dmarcPct === 100} />
                <StatusRow label="DKIM Alignment" value={em.dmarcAlignment.adkim} ok={em.dmarcAlignment.adkim === "Strict"} />
                <StatusRow label="SPF Alignment" value={em.dmarcAlignment.aspf} ok={em.dmarcAlignment.aspf === "Strict"} />
                {em.dmarcRua.length > 0 && (
                  <div className="py-2">
                    <p className="text-xs text-cf-gray-500 mb-1">Aggregate Reports (rua=)</p>
                    {em.dmarcRua.map((r) => (
                      <p key={r} className="text-[10px] font-mono text-cf-navy">{r}</p>
                    ))}
                  </div>
                )}
                {em.dmarcRuf.length > 0 && (
                  <div className="py-2">
                    <p className="text-xs text-cf-gray-500 mb-1">Forensic Reports (ruf=)</p>
                    {em.dmarcRuf.map((r) => (
                      <p key={r} className="text-[10px] font-mono text-cf-navy">{r}</p>
                    ))}
                  </div>
                )}
                <div className="mt-2 pt-2 border-t border-cf-gray-100">
                  <p className="text-[10px] text-cf-gray-400 font-mono break-all">{em.dmarcRecord}</p>
                </div>
              </>
            )}
          </div>

          {/* DKIM + MX */}
          <div className="space-y-4">
            {/* DKIM selectors */}
            <div className="bg-white rounded-xl shadow-sm border border-cf-gray-200 p-5">
              <h3 className="text-sm font-semibold text-cf-navy mb-3">DKIM Selectors Found</h3>
              {em.dkimSelectors.length > 0 ? (
                <div className="space-y-2">
                  {em.dkimSelectors.map((d) => (
                    <div key={d.selector} className="rounded-lg border border-cf-gray-100 p-3">
                      <div className="flex items-center justify-between mb-1">
                        <span className="text-xs font-semibold text-cf-navy font-mono">{d.selector}._domainkey</span>
                        <span className={`inline-block px-2 py-0.5 rounded-full text-[10px] font-semibold border ${d.valid ? "bg-green-50 text-green-700 border-green-200" : "bg-red-50 text-red-700 border-red-200"}`}>
                          {d.valid ? "Valid" : "Revoked"}
                        </span>
                      </div>
                      <p className="text-[10px] text-cf-gray-400 font-mono break-all line-clamp-2">{d.record.substring(0, 120)}…</p>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="flex items-center gap-2 p-3 bg-red-50 rounded-lg border border-red-200">
                  <ShieldX size={14} className="text-red-500" />
                  <p className="text-xs text-red-700">No DKIM records found for common selectors</p>
                </div>
              )}
            </div>

            {/* MX Records */}
            <div className="bg-white rounded-xl shadow-sm border border-cf-gray-200 p-5">
              <h3 className="text-sm font-semibold text-cf-navy mb-3 flex items-center gap-2">
                <Server size={14} className="text-cf-orange" />
                MX Records
                {em.usingCloudflareEmailSecurity && (
                  <span className="ml-auto text-[10px] font-semibold px-2 py-0.5 bg-cf-orange/10 text-cf-orange rounded-full border border-cf-orange/30">
                    Cloudflare Email Security
                  </span>
                )}
              </h3>
              {em.mxRecords.length > 0 ? (
                <table className="w-full text-xs">
                  <thead>
                    <tr className="text-cf-gray-500 uppercase tracking-wide text-[10px]">
                      <th className="py-1 text-left font-semibold">Priority</th>
                      <th className="py-1 text-left font-semibold">Mail Exchange</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-cf-gray-100">
                    {em.mxRecords.map((mx, i) => (
                      <tr key={i}>
                        <td className="py-2 font-mono text-cf-gray-500">{mx.priority}</td>
                        <td className="py-2 font-mono text-cf-navy">{mx.exchange}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              ) : (
                <p className="text-xs text-cf-gray-400">No MX records found</p>
              )}
            </div>
          </div>
        </div>

        {/* Cloudflare Email Security callout */}
        {em.usingCloudflareEmailSecurity && (
          <div className="bg-gradient-to-r from-cf-orange/10 to-orange-50 rounded-xl border border-cf-orange/30 p-4 flex items-start gap-3">
            <Mail size={16} className="text-cf-orange flex-shrink-0 mt-0.5" />
            <div>
              <p className="text-sm font-semibold text-cf-navy">Cloudflare Email Security Active</p>
              <p className="text-xs text-cf-gray-600 mt-0.5">
                MX records point to Cloudflare's email security infrastructure (cf-emailsecurity.net).
                Inbound email is being scanned for phishing, malware, BEC (business email compromise), and spam before delivery.
              </p>
            </div>
          </div>
        )}
      </div>
    </section>
  );
}
