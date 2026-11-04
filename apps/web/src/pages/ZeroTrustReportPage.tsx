/**
 * ZeroTrustReportPage — Cloudflare One (Zero Trust / SASE) POC or Assessment Report.
 * Assembles 17 sections covering Access, Gateway, WARP, Tunnels, DLP.
 */
import { useState, useEffect } from "react";
import {
  Printer, RefreshCw, Shield, Clock, Globe, User,
  Loader2, CheckCircle, AlertCircle, Sparkles, FileText,
} from "lucide-react";
import type { ZeroTrustData, ReportInput } from "../types";
import { saveToPdf, saveToHtml, captureReportHtml } from "../utils/pdf-export";
import { saveAuditReport, apiFetch } from "../services/api";

// ── ZT Sections ──────────────────────────────────────────────────────────────
import ZTOverviewSection         from "./zt-sections/ZTOverviewSection";
import ZTPocValueSection         from "./zt-sections/ZTPocValueSection";
import ZTPostureScoreSection     from "./zt-sections/ZTPostureScoreSection";
import ZTGatewayDnsSection       from "./zt-sections/ZTGatewayDnsSection";
import ZTGatewayHttpSection      from "./zt-sections/ZTGatewayHttpSection";
import ZTGatewayL4Section        from "./zt-sections/ZTGatewayL4Section";
import ZTShadowItSection         from "./zt-sections/ZTShadowItSection";
import ZTGenerativeAiSection     from "./zt-sections/ZTGenerativeAiSection";
import ZTGatewayPoliciesSection  from "./zt-sections/ZTGatewayPoliciesSection";
import ZTAccessAppsSection       from "./zt-sections/ZTAccessAppsSection";
import ZTAccessAuthSection       from "./zt-sections/ZTAccessAuthSection";
import ZTAccessAnomaliesSection  from "./zt-sections/ZTAccessAnomaliesSection";
import ZTAccessGeoSection        from "./zt-sections/ZTAccessGeoSection";
import ZTTopUsersSection         from "./zt-sections/ZTTopUsersSection";
import ZTIdpSection              from "./zt-sections/ZTIdpSection";
import ZTWarpPostureSection      from "./zt-sections/ZTWarpPostureSection";
import ZTWarpConnectivitySection from "./zt-sections/ZTWarpConnectivitySection";
import ZTDeviceExperienceSection from "./zt-sections/ZTDeviceExperienceSection";
import ZTTunnelHealthSection     from "./zt-sections/ZTTunnelHealthSection";
import ZTDlpSection              from "./zt-sections/ZTDlpSection";
import ZTConfigChangesSection    from "./zt-sections/ZTConfigChangesSection";
import ZTControlCoverageSection    from "./zt-sections/ZTControlCoverageSection";
import ZTRemediationRegisterSection from "./zt-sections/ZTRemediationRegisterSection";
import ZTAlertRegisterSection      from "./zt-sections/ZTAlertRegisterSection";
import ZTOpportunitySection      from "./zt-sections/ZTOpportunitySection";

import ZTRecommendationsSection    from "./zt-sections/ZTRecommendationsSection";
import ZTOperationalAlertsSection  from "./zt-sections/ZTOperationalAlertsSection";
import CoverGraphic              from "../components/CoverGraphic";
import cfLogo from "../assets/cf-logo";

// AI summary for ZT
async function fetchZTSummary(zt: ZeroTrustData, isPoc = true): Promise<string> {
  const res = await apiFetch("/api/zt-summary", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ zerotrust: zt, isPoc }),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const d = await res.json() as { ok: boolean; summary: string };
  return d.summary ?? "";
}

interface Props {
  data: ZeroTrustData;
  input: ReportInput;
  onReset: () => void;
  userEmail?: string | null;
}

export default function ZeroTrustReportPage({ data, input, onReset, userEmail }: Props) {
  const [aiSummary, setAiSummary]   = useState("");
  const [aiLoading, setAiLoading]   = useState(false);
  const [aiError, setAiError]       = useState("");
  const [htmlExporting, setHtmlExporting] = useState(false);
  const [auditSaved, setAuditSaved] = useState<string | null>(null);

  // Report framing: POC (default) shows POC value story, recommendations,
  // undeployed-opportunity upsell, and "Proof-of-Concept"/"POC" wording.
  // Unchecked = neutral assessment report without those sections/wording.
  const isPoc = input.isPoc !== false;

  // Embedded (scheduled attachment) mode: summary generated at send time,
  // no backend to call.
  const EMBEDDED = (window as { __EMBEDDED_REPORT__?: { aiSummary?: string } }).__EMBEDDED_REPORT__;
  useEffect(() => {
    if (EMBEDDED) { setAiSummary(EMBEDDED.aiSummary ?? ""); return; }
    generateSummary();
  /* eslint-disable-next-line react-hooks/exhaustive-deps */
  }, []);

  async function generateSummary() {
    setAiLoading(true); setAiError("");
    try {
      const s = await fetchZTSummary(data, isPoc);
      setAiSummary(s);
      setTimeout(() => saveAudit(s), 1500);
    } catch (e) {
      setAiError(String(e));
      setTimeout(() => saveAudit(""), 1500);
    } finally { setAiLoading(false); }
  }

  async function saveAudit(_summary: string) {
    try {
      const html   = await captureReportHtml();
      const result = await saveAuditReport({
        email: userEmail ?? "anonymous",
        hostname: `zerotrust-${data.meta.accountId}`,
        zoneName: data.meta.accountName,
        days: data.meta.days,
        generatedAt: data.meta.generatedAt,
        html,
      });
      if (result?.key) setAuditSaved(result.key);
    } catch { /* silent */ }
  }

  const generatedAt = new Date(data.meta.generatedAt).toLocaleString("en-US", { dateStyle: "long", timeStyle: "short" });
  const dateRange   = `${data.meta.since} – ${data.meta.until}`;
  const periodLabel = data.meta.periodLabel;

  const reportNoun  = isPoc ? "POC" : "Assessment";
  const coverBadge  = isPoc ? `${periodLabel} Zero Trust POC Report` : `${periodLabel} Zero Trust Assessment Report`;

  const PARA_META = [
    { label: "Identity & Access",        color: "#2563EB", bg: "#EFF6FF" },
    { label: "Gateway Filtering",        color: "#16A34A", bg: "#F0FDF4" },
    { label: "Device & Connectivity",    color: "#7C3AED", bg: "#F5F3FF" },
    { label: "Risks & Gaps",             color: "#DC2626", bg: "#FEF2F2" },
    { label: isPoc ? "Recommended Next Steps" : "Overall Posture & Outlook", color: "#D97706", bg: "#FFFBEB" },
  ];

  return (
    <div className="min-h-screen print:bg-white" style={{ backgroundColor: "#f4f4f4" }}>
      {/* ── Toolbar — Alfa Romeo style ───────────────────────────────────── */}
      <div className="print:hidden sticky top-0 z-50"
        style={{ backgroundColor: "#1c1f2a", borderBottom: "3px solid #ba0816", height: 56 }}>
        <div className="max-w-5xl mx-auto px-6 h-full flex items-center gap-4">
          {/* Brand */}
          <div className="flex items-center gap-3 flex-1 min-w-0">
            <img src={cfLogo} alt="Cloudflare"
              style={{ height: 22, objectFit: "contain", filter: "brightness(0) invert(1)", opacity: 0.85 }}/>
            <div style={{ width: 1, height: 16, backgroundColor: "#ba0816" }} />
            <span style={{
              fontSize: 11, fontWeight: 400, letterSpacing: "0.09375rem",
              textTransform: "uppercase", color: "rgba(244,244,244,0.45)"
            }}>
              Cloudflare One
            </span>
            <span style={{ fontSize: 11, color: "rgba(244,244,244,0.25)" }}>·</span>
            <span style={{ fontSize: 11, color: "rgba(244,244,244,0.55)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
              {periodLabel} {reportNoun} · {data.meta.accountName}
            </span>
          </div>
          {/* User */}
          {userEmail && (
            <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
              <User size={11} style={{ color: "rgba(244,244,244,0.3)" }}/>
              <span style={{ fontSize: 11, color: "rgba(244,244,244,0.4)" }}>{userEmail}</span>
            </div>
          )}
          {/* Actions */}
          {auditSaved && (
            <div style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 11, color: "#34D399" }}>
              <CheckCircle size={11}/> Audit saved
            </div>
          )}
          <button onClick={onReset}
            style={{
              display: "flex", alignItems: "center", gap: 6,
              padding: "9px 16px 7px", fontSize: 11, fontWeight: 400,
              letterSpacing: "0.09375rem", textTransform: "uppercase",
              background: "transparent", border: "1px solid rgba(255,255,255,0.15)",
              color: "rgba(244,244,244,0.5)", cursor: "pointer", transition: "all 0.15s",
            }}
            onMouseEnter={(e) => { (e.currentTarget as HTMLButtonElement).style.borderColor = "rgba(255,255,255,0.4)"; (e.currentTarget as HTMLButtonElement).style.color = "#f4f4f4"; }}
            onMouseLeave={(e) => { (e.currentTarget as HTMLButtonElement).style.borderColor = "rgba(255,255,255,0.15)"; (e.currentTarget as HTMLButtonElement).style.color = "rgba(244,244,244,0.5)"; }}>
            <RefreshCw size={11}/> New Report
          </button>
          <button
            onClick={async () => { setHtmlExporting(true); try { await saveToHtml(data.meta.accountName); } finally { setHtmlExporting(false); } }}
            disabled={htmlExporting}
            style={{
              display: "flex", alignItems: "center", gap: 6,
              padding: "9px 16px 7px", fontSize: 11, fontWeight: 400,
              letterSpacing: "0.09375rem", textTransform: "uppercase",
              background: "transparent", border: "1px solid rgba(186,8,22,0.5)",
              color: "#ba0816", cursor: htmlExporting ? "not-allowed" : "pointer",
              opacity: htmlExporting ? 0.4 : 1, transition: "all 0.15s",
            }}
            onMouseEnter={(e) => { if (!htmlExporting) { (e.currentTarget as HTMLButtonElement).style.backgroundColor = "#ba0816"; (e.currentTarget as HTMLButtonElement).style.color = "#fff"; } }}
            onMouseLeave={(e) => { (e.currentTarget as HTMLButtonElement).style.backgroundColor = "transparent"; (e.currentTarget as HTMLButtonElement).style.color = "#ba0816"; }}>
            {htmlExporting ? <><Loader2 size={11} className="animate-spin"/> Exporting…</> : <><FileText size={11}/> Save HTML</>}
          </button>
          <button onClick={saveToPdf}
            style={{
              display: "flex", alignItems: "center", gap: 6,
              padding: "9px 16px 7px", fontSize: 11, fontWeight: 400,
              letterSpacing: "0.09375rem", textTransform: "uppercase",
              backgroundColor: "#ba0816", border: "1px solid #ba0816",
              color: "#ffffff", cursor: "pointer", transition: "background 0.15s",
            }}
            onMouseEnter={(e) => { (e.currentTarget as HTMLButtonElement).style.backgroundColor = "#8e0d25"; (e.currentTarget as HTMLButtonElement).style.borderColor = "#8e0d25"; }}
            onMouseLeave={(e) => { (e.currentTarget as HTMLButtonElement).style.backgroundColor = "#ba0816"; (e.currentTarget as HTMLButtonElement).style.borderColor = "#ba0816"; }}>
            <Printer size={11}/> Save PDF
          </button>
        </div>
      </div>

      <div id="report-content" className="max-w-5xl mx-auto px-4 py-6 print:px-0 print:py-0 space-y-5 print:space-y-0">

        {/* ── Cover Page ───────────────────────────────────────────────────── */}
        <div className="cover-screen-preview overflow-hidden rounded-2xl print:rounded-none print:print-cover relative"
          style={{ background: "linear-gradient(135deg, #E8F4FD 0%, #EBF5FB 50%, #E3F2FD 100%)" }}>
          <div className="absolute inset-0 pointer-events-none overflow-hidden rounded-2xl print:rounded-none">
            <div className="absolute inset-y-0 right-0" style={{ width: "65%" }}>
              <CoverGraphic width={620} height={560} color="#0051A2" />
            </div>
          </div>
          {/* AR Red accent bar */}
          <div className="h-2 w-full print:h-3 relative z-10" style={{ backgroundColor: "#ba0816" }} />
          <div className="relative z-10 h-full flex flex-col justify-between print:print-cover-inner" style={{ padding: "2.5rem 3.5rem" }}>
            <div className="flex items-center justify-between">
              <img src={cfLogo} alt="Cloudflare" className="h-10 object-contain" />
              <div className="flex items-center gap-4">
                <span className="text-white text-[10px] font-bold px-3 py-1 uppercase tracking-wide" style={{ backgroundColor: "#ba0816" }}>Cloudflare One</span>
                <span className="text-cf-gray-400 text-[10px] font-semibold uppercase tracking-widest">Confidential</span>
              </div>
            </div>
            {input.clientLogo && (
              <div className="mt-6">
                <img src={input.clientLogo} alt="Client logo" style={{ height: "clamp(56px,8vw,88px)", maxWidth: "320px", objectFit: "contain", mixBlendMode: "multiply" }} />
              </div>
            )}
            <div className="flex-1 flex flex-col justify-center py-6">
              <div className="mb-6">
                <span className="inline-block px-4 py-1.5 text-white text-[10px] font-bold uppercase tracking-widest" style={{ backgroundColor: "#ba0816" }}>
                  {coverBadge}
                </span>
              </div>
              <h1 className="font-black leading-none tracking-tight text-cf-navy" style={{ fontSize: "clamp(2.4rem,5vw,3.8rem)", letterSpacing: "-0.03em" }}>
                Zero Trust<br/><span style={{ color: "#ba0816" }}>Security</span><br/>
                <span className="text-cf-gray-500">&amp; SASE</span><br/><span className="text-cf-gray-500">Analysis</span>
              </h1>
              <div className="flex items-center gap-4 my-8"><div className="h-px flex-1 bg-cf-gray-200"/><div className="w-2 h-2 rounded-full bg-blue-600"/><div className="h-px flex-1 bg-cf-gray-200"/></div>
              <div className="grid grid-cols-2 gap-8">
                <div>
                  <p className="text-[9px] font-black uppercase tracking-[0.15em] mb-2" style={{ color: "#ba0816" }}>Prepared for</p>
                  <p className="text-cf-navy font-bold leading-tight" style={{ fontSize: "clamp(1.1rem,2.5vw,1.6rem)" }}>{input.clientName || data.meta.accountName}</p>
                  {input.clientName && <p className="text-cf-gray-400 text-xs font-mono mt-1">{data.meta.accountName}</p>}
                </div>
                <div>
                  <p className="text-cf-gray-400 text-[9px] font-black uppercase tracking-[0.15em] mb-2">Delivered by</p>
                  <p className="text-cf-gray-700 font-bold leading-tight" style={{ fontSize: "clamp(1.1rem,2.5vw,1.6rem)" }}>{input.partnerName || "Cloudflare"}</p>
                </div>
              </div>
            </div>
            <div className="pt-5 border-t border-cf-gray-200 grid grid-cols-3 gap-4">
              <div><p className="text-[9px] font-black uppercase tracking-widest mb-1" style={{ color: "#ba0816" }}>Analysis Period</p><p className="text-cf-navy text-sm font-semibold">{dateRange}</p></div>
              <div><p className="text-[9px] font-black uppercase tracking-widest mb-1" style={{ color: "#ba0816" }}>Account</p><p className="text-cf-navy text-sm font-mono">{data.meta.accountName}</p></div>
              <div><p className="text-[9px] font-black uppercase tracking-widest mb-1" style={{ color: "#ba0816" }}>Report Date</p><p className="text-cf-navy text-sm font-semibold">{generatedAt}</p></div>
            </div>
          </div>
        </div>

        {/* ── Table of Contents (print only) ─────────────────────────────── */}
        <div className="hidden print-toc bg-white px-14 py-16">
          <div className="flex items-center gap-3 mb-10">
            <div className="w-10 h-10 bg-blue-600 rounded-lg flex items-center justify-center"><FileText size={20} className="text-white"/></div>
            <h2 className="text-2xl font-bold text-cf-navy">Table of Contents</h2>
          </div>
          <div className="space-y-3 text-[11pt]">
            {(() => {
              // Built from the SAME conditions used to actually render each
              // section below, so the TOC never lists a section that won't
              // appear (or omits one that will) — the previous static list
              // was stale and missing Shadow IT, HTTP, L4, Anomalies, WARP
              // Posture/Connectivity, Tunnels, and DLP entirely.
              const hasHttp   = (data.summary.gatewayHttpRequests ?? 0) > 0 || (data.gatewayHttpTimeSeries?.length ?? 0) > 0;
              const hasL4     = (data.summary.gatewayL4Sessions ?? 0) > 0 || (data.gatewayL4TimeSeries?.length ?? 0) > 0
                || ((data.summary.gatewayBandwidthBytesSent ?? 0) + (data.summary.gatewayBandwidthBytesRecvd ?? 0)) > 0;
              const hasShadowIt = (data.summary.shadowItAppsDiscovered ?? 0) > 0 || (data.shadowItApps?.length ?? 0) > 0;
              const hasGenAi    = (data.aiAppUsage?.uniqueApps ?? 0) > 0;
              const hasAnomalies = (data.accessAnomalies?.length ?? 0) > 0 || (data.accessIdpBreakdown?.length ?? 0) > 0;
              const hasWarpPosture = data.summary.warpEnrolledDevices > 0 || (data.warpPostureRules?.length ?? 0) > 0;
              const hasWarpConn    = data.summary.warpEnrolledDevices > 0;
              const hasDex         = (data.dexFleetStatus?.uniqueDevicesTotal ?? 0) > 0;
              const hasTunnels     = data.summary.tunnelsTotal > 0;
              const hasDlp         = (data.dlpProfiles?.length ?? 0) > 0 || (data.summary.casbFindingsCount ?? 0) > 0;
              const hasConfigChanges = (data.configChanges?.length ?? 0) > 0;
              const hasControlCoverage = !!data.controlCoverage;
              const hasRemediationRegister = (data.remediationRegister?.length ?? 0) > 0;
              const hasAlertRegister = (data.alertRegister?.length ?? 0) > 0;

              const entries: string[][] = [
                ["Executive Summary"],
                ["Overview — KPIs"],
                ...(isPoc ? [["POC Value Delivered"]] : []),
                ["Gateway — DNS Security"],
                ...(hasHttp ? [["Gateway — HTTP Filtering"]] : []),
                ...(hasL4 ? [["Gateway — Network (L4) & Session Analytics"]] : []),
                ["Gateway — Policies Audit"],
                ...(hasShadowIt ? [["Shadow IT Discovery"]] : []),
                ...(hasGenAi ? [["Generative AI (Shadow AI) Usage"]] : []),
                ["Access — Applications & Policies"],
                ["Access — Authentication Events"],
                ...(hasAnomalies ? [["Access — Anomalies & IdP Breakdown"]] : []),
                ["Access — Geographic Distribution"],
                ["Top Users & Applications"],
                ["Identity Providers"],
                ...(hasWarpPosture ? [["WARP — Device Posture"]] : []),
                ...(hasWarpConn ? [["WARP — Device Connectivity"]] : []),
                ...(hasDex ? [["Device Experience (DEX)"]] : []),
                ...(hasTunnels ? [["Tunnel Health"]] : []),
                ...(hasDlp ? [["Data Loss Prevention (DLP) & CASB"]] : []),
                ...(hasConfigChanges ? [["Configuration Changes"]] : []),
                ...(hasControlCoverage ? [["Control Coverage & Effectiveness"]] : []),
                ...(hasRemediationRegister ? [["Remediation Register"]] : []),
                ...(hasAlertRegister ? [["Alert Investigation Register"]] : []),
                ["Security Posture Score"],
                ...(isPoc ? [
                  ["Undeployed Capabilities"],
                  ["Deployment Roadmap & Recommendations"],
                ] : [
                  ["Operational Alerts"],
                ]),
              ];
              return entries.map((e, i) => [String(i + 1) + ".", e[0], ""] as const);
            })().map(([num, title, page]) => (
              <div key={title} className="flex items-baseline gap-2 py-2 border-b border-cf-gray-100">
                <span className="text-cf-gray-400 w-8 flex-shrink-0">{num}</span>
                <span className="flex-1 font-medium text-cf-navy">{title}</span>
                <span className="text-cf-gray-400 font-mono text-sm">{page}</span>
              </div>
            ))}
          </div>
        </div>

        {/* ── Executive Summary ───────────────────────────────────────────── */}
        <div className="bg-white rounded-2xl shadow-sm border border-cf-gray-200 p-6 print:rounded-none print:border-0 print:shadow-none print-exec-summary print:p-14">
          <div className="flex items-center justify-between mb-6">
            <div className="flex items-center gap-3">
              <div className="w-8 h-8 flex items-center justify-center" style={{ backgroundColor: "#ba0816" }}>
                <Sparkles size={16} className="text-white"/>
              </div>
              <div>
                <h2 className="text-base font-bold text-cf-navy">Executive Summary</h2>
                <p className="text-xs text-cf-gray-400">AI-generated · Workers AI · {dateRange}</p>
              </div>
            </div>
            {!aiLoading && <button onClick={generateSummary} className="print:hidden flex items-center gap-1.5 text-xs text-cf-gray-400 hover:text-blue-600 transition"><RefreshCw size={12}/> Regenerate</button>}
          </div>
          {aiLoading && <div className="flex items-center gap-3 py-8 text-cf-gray-400"><Loader2 size={18} className="animate-spin text-blue-600"/><span className="text-sm">Writing executive summary…</span></div>}
          {aiError && <div className="flex items-start gap-3 bg-red-50 border border-red-200 rounded-lg p-3"><AlertCircle size={16} className="text-red-500 flex-shrink-0 mt-0.5"/><div><p className="text-sm font-medium text-red-700">AI summary unavailable</p><p className="text-xs text-red-600 mt-0.5">{aiError}</p></div></div>}
          {aiSummary && !aiLoading && (
            <div>
              <div className="space-y-5">
                {aiSummary.split("\n\n").filter(Boolean).map((para, i) => {
                  const m = PARA_META[i] ?? PARA_META[0];
                  return (
                    <div key={i} className="rounded-xl border-l-4 px-4 py-3" style={{ borderColor: m.color, backgroundColor: m.bg }}>
                      <p className="text-[10px] font-black uppercase tracking-widest mb-1.5" style={{ color: m.color }}>{m.label}</p>
                      <p className="text-cf-gray-700 leading-relaxed text-sm">{para.trim()}</p>
                    </div>
                  );
                })}
              </div>
              <div className="flex items-center gap-1.5 mt-5 text-xs text-green-600 print:hidden">
                <CheckCircle size={12}/> Generated by Cloudflare Workers AI
              </div>
            </div>
          )}
          {/* Print KPI strip */}
          <div className="hidden print:grid print:grid-cols-3 print:gap-6 print:mt-10 print:pt-8 print:border-t print:border-cf-gray-200">
            <div className="text-center"><p className="text-3xl font-bold text-cf-navy">{data.summary.totalAuthEvents >= 1e3 ? `${(data.summary.totalAuthEvents/1e3).toFixed(0)}K` : data.summary.totalAuthEvents}</p><p className="text-[9pt] text-cf-gray-500 mt-1 uppercase tracking-wide">Auth Events</p></div>
            <div className="text-center border-x border-cf-gray-200"><p className="text-3xl font-bold text-blue-600">{data.summary.uniqueUsers}</p><p className="text-[9pt] text-cf-gray-500 mt-1 uppercase tracking-wide">Users Protected</p></div>
            <div className="text-center"><p className="text-3xl font-bold text-green-600">{data.summary.authSuccessRate}%</p><p className="text-[9pt] text-cf-gray-500 mt-1 uppercase tracking-wide">Auth Success Rate</p></div>
          </div>
        </div>

        {/* ── Metadata Strip — AR style ────────────────────────────────────── */}
        <div className="print:hidden" style={{
          backgroundColor: "#292b35", padding: "10px 20px",
          display: "flex", flexWrap: "wrap", gap: "1.5rem", alignItems: "center",
        }}>
          {[
            { icon: <Globe size={11}/>, label: "Account", value: data.meta.accountName },
            { icon: <Clock size={11}/>, label: "Period", value: `${data.meta.since} → ${data.meta.until}` },
            { icon: <Shield size={11}/>, label: "Data", value: "Cloudflare One Analytics" },
          ].map((m) => (
            <div key={m.label} style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <span style={{ color: "#ba0816" }}>{m.icon}</span>
              <span style={{ fontSize: 11, color: "rgba(244,244,244,0.4)", letterSpacing: "0.09375rem", textTransform: "uppercase" }}>{m.label}</span>
              <span style={{ fontSize: 11, color: "rgba(244,244,244,0.7)", fontWeight: 500 }}>{m.value}</span>
            </div>
          ))}
        </div>

        {/* ── Data Fetch Diagnostics — print:hidden, shown only if any source failed ── */}
        {Object.keys(data.errors ?? {}).length > 0 && (
          <details className="print:hidden bg-yellow-50 border border-yellow-200 rounded-xl px-4 py-3">
            <summary className="text-xs font-semibold text-yellow-700 cursor-pointer">
              {Object.keys(data.errors).length} data source{Object.keys(data.errors).length === 1 ? "" : "s"} failed to load — some sections may be incomplete
            </summary>
            <div className="mt-2 space-y-1">
              {Object.entries(data.errors).map(([key, msg]) => (
                <p key={key} className="text-[11px] text-yellow-700 font-mono">
                  <span className="font-bold">{key}:</span> {msg}
                </p>
              ))}
            </div>
          </details>
        )}

        {/* ── Sections ────────────────────────────────────────────────────── */}
        {/* Ordered by importance (biggest outcomes first) and grouped by
            topic, mirroring Cloudflare's own Zero Trust > Insights >
            Dashboards catalog (DNS/HTTP/Network policy analytics, Shadow IT
            SaaS + Private Network analytics, AI security, Application
            Access Report, Access event analytics, Data security analytics). */}

        {/* Overview */}
        <ZTOverviewSection         data={data} isPoc={isPoc} />
        {isPoc && <ZTPocValueSection data={data} />}

        {/* GROUP 1 — Gateway Traffic Security: threat-blocking outcomes first
            (DNS is the primary POC headline metric), config audit last. */}
        <ZTGatewayDnsSection       data={data} />
        {((data.summary.gatewayHttpRequests ?? 0) > 0 || (data.gatewayHttpTimeSeries?.length ?? 0) > 0) && (
          <ZTGatewayHttpSection    data={data} />
        )}
        {((data.summary.gatewayL4Sessions ?? 0) > 0 || (data.gatewayL4TimeSeries?.length ?? 0) > 0
          || ((data.summary.gatewayBandwidthBytesSent ?? 0) + (data.summary.gatewayBandwidthBytesRecvd ?? 0)) > 0) && (
          <ZTGatewayL4Section      data={data} />
        )}
        <ZTGatewayPoliciesSection  data={data} />

        {/* GROUP 2 — Applications & Shadow IT (SaaS + GenAI visibility) */}
        {((data.summary.shadowItAppsDiscovered ?? 0) > 0 || (data.shadowItApps?.length ?? 0) > 0) && (
          <ZTShadowItSection       data={data} />
        )}
        {((data.aiAppUsage?.uniqueApps ?? 0) > 0) && (
          <ZTGenerativeAiSection   data={data} />
        )}

        {/* GROUP 3 — Identity & Access */}
        <ZTAccessAppsSection       data={data} />
        <ZTAccessAuthSection       data={data} />
        {((data.accessAnomalies?.length ?? 0) > 0 || (data.accessIdpBreakdown?.length ?? 0) > 0) && (
          <ZTAccessAnomaliesSection data={data} />
        )}
        <ZTAccessGeoSection        data={data} />
        <ZTTopUsersSection         data={data} />
        <ZTIdpSection              data={data} />

        {/* GROUP 4 — Devices & Network — only render if deployed */}
        {(data.summary.warpEnrolledDevices > 0 || (data.warpPostureRules?.length ?? 0) > 0) && (
          <ZTWarpPostureSection    data={data} />
        )}
        {(data.summary.warpEnrolledDevices > 0) && (
          <ZTWarpConnectivitySection data={data} />
        )}
        <ZTDeviceExperienceSection data={data} />
        {(data.summary.tunnelsTotal > 0) && (
          <ZTTunnelHealthSection   data={data} />
        )}

        {/* GROUP 5 — Data Security (DLP + CASB) */}
        {((data.dlpProfiles?.length ?? 0) > 0 || (data.summary.casbFindingsCount ?? 0) > 0) && (
          <ZTDlpSection            data={data} />
        )}

        {/* GROUP 6 — Operational: what configuration changed this period */}
        <ZTConfigChangesSection    data={data} />

        {/* GROUP 7 — Executive control coverage + tracked remediation */}
        <ZTControlCoverageSection    data={data} />
        <ZTRemediationRegisterSection data={data} />
        <ZTAlertRegisterSection      data={data} />

        {/* 8. Security posture score */}
        <ZTPostureScoreSection     data={data} />

        {/* 9. Undeployed opportunity section — replaces empty section noise (POC reports only) */}
        {isPoc && <ZTOpportunitySection data={data} />}

        {/* 10. Deployment roadmap — recommendations (POC reports only) — vs.
                real operational alerts derived from this period's telemetry
                for recurring monthly/assessment reports (isPoc=false). */}
        {isPoc ? <ZTRecommendationsSection data={data} /> : <ZTOperationalAlertsSection data={data} />}

        {/* ── Footer — AR style ────────────────────────────────────────────── */}
        <div className="print:hidden" style={{
          backgroundColor: "#1c1f2a",
          padding: "2rem 1.5rem",
          display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: "1rem",
        }}>
          <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
            <img src={cfLogo} alt="Cloudflare"
              style={{ height: 18, objectFit: "contain", filter: "brightness(0) invert(1)", opacity: 0.4 }} />
            <span style={{ fontSize: 11, color: "rgba(244,244,244,0.3)", letterSpacing: "0.05em" }}>
              CLOUDFLARE ONE {reportNoun.toUpperCase()} REPORT · {generatedAt}
            </span>
          </div>
          <span style={{ fontSize: 10, color: "rgba(244,244,244,0.2)" }}>
            CONFIDENTIAL — INTENDED FOR AUTHORIZED RECIPIENTS ONLY
          </span>
        </div>
      </div>
    </div>
  );
}
