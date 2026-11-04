/**
 * AiSecuritySection — dedicated section for AI Security for Apps (formerly
 * Firewall for AI). Covers all three detection capabilities Cloudflare
 * documents for this feature, WITH real live detection counts:
 *
 *   1. PII Detection          — 13 built-in categories
 *   2. Unsafe Topic Detection — 14 built-in safety categories S1-S14
 *   3. Prompt Injection Detection — 1-99 score, lower = more confident attack
 *
 * Real GraphQL field names (confirmed via live schema introspection against
 * a real Cloudflare account, 2026-09-01) are `firewallForAiAnyPiiCategory`,
 * `firewallForAiPiiCategories`, `firewallForAiUnsafeTopicCategories`, and
 * `firewallForAiInjectionScore` on `httpRequestsAdaptiveGroups` — GraphQL
 * kept the product's older "Firewall for AI" name even though the product
 * itself was renamed. These differ from the Ruleset Engine field names
 * (`cf.llm.prompt.*`), which are still shown below as reference for writing
 * custom WAF rules.
 *
 * Data honesty note: `firewallForAiAnyPiiCategory`/etc. only populate when
 * the account has Cloudflare's Enterprise "AI detection fields" paid
 * add-on provisioned (contact your account team) — if `scannedCount` is 0
 * despite real cf-llm traffic, that means the add-on isn't provisioned on
 * this account, not that the query failed. The category/score reference
 * tables are real, documented Cloudflare capabilities either way.
 */
import { Bot, ShieldAlert, Fingerprint, MessageSquareWarning, CheckCircle2, XCircle, ExternalLink } from "lucide-react";
import type { AppSecData } from "../../types";
import { formatNumber } from "../../utils/formatters";
import SectionHeader from "../../components/SectionHeader";

interface Props { data: AppSecData }

// ── Real reference data, verbatim from Cloudflare docs ─────────────────────
const PII_CATEGORIES: { code: string; label: string }[] = [
  { code: "BANK_ACCOUNT",   label: "Bank account number" },
  { code: "CREDIT_CARD",    label: "Credit card number" },
  { code: "DATE_TIME",      label: "Date or time expression" },
  { code: "DRIVER_LICENSE", label: "Driver license number" },
  { code: "EMAIL_ADDRESS",  label: "Email address" },
  { code: "IP_ADDRESS",     label: "IPv4 address" },
  { code: "LOCATION",       label: "Physical location or address" },
  { code: "PASSPORT",       label: "Passport number" },
  { code: "PERSON",         label: "Full or partial name of an individual" },
  { code: "PHONE_NUMBER",   label: "Phone number" },
  { code: "TAX_ID",         label: "Tax identification number" },
  { code: "US_SSN",         label: "US Social Security Number" },
  { code: "URL",            label: "URL" },
];

const UNSAFE_TOPIC_CATEGORIES: { code: string; label: string }[] = [
  { code: "S1",  label: "Violent crimes" },
  { code: "S2",  label: "Non-violent crimes" },
  { code: "S3",  label: "Sex-related crimes" },
  { code: "S4",  label: "Child sexual exploitation" },
  { code: "S5",  label: "Defamation" },
  { code: "S6",  label: "Specialized advice" },
  { code: "S7",  label: "Privacy" },
  { code: "S8",  label: "Intellectual property" },
  { code: "S9",  label: "Indiscriminate weapons" },
  { code: "S10", label: "Hate" },
  { code: "S11", label: "Suicide and self-harm" },
  { code: "S12", label: "Sexual content" },
  { code: "S13", label: "Elections" },
  { code: "S14", label: "Code interpreter abuse" },
];

const INJECTION_SCORE_BANDS: { range: string; meaning: string; color: string; key: "high" | "moderate" | "low" }[] = [
  { range: "1–19",  meaning: "High likelihood of prompt injection — strongly resembles known injection patterns", color: "#DC2626", key: "high" },
  { range: "20–49", meaning: "Moderate likelihood — has some characteristics of an injection attempt", color: "#F59E0B", key: "moderate" },
  { range: "50–99", meaning: "Low likelihood — appears to be normal, non-malicious input", color: "#10B981", key: "low" },
];

function StatusPill({ enabled }: { enabled: boolean }) {
  return (
    <div
      className="flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-semibold border flex-shrink-0"
      style={{
        borderColor: enabled ? "#10B98140" : "#EF444440",
        backgroundColor: enabled ? "#F0FDF4" : "#FEF2F2",
        color: enabled ? "#15803D" : "#B91C1C",
      }}
    >
      {enabled ? <CheckCircle2 size={13} /> : <XCircle size={13} />}
      {enabled ? "Enabled" : "Not Enabled"}
    </div>
  );
}

export default function AiSecuritySection({ data }: Props) {
  const aiSecurity = data.aiSecurityForApps ?? {
    enabled: false, customTopics: [], logModeDeployed: false,
    scannedCount: 0, piiDetectedCount: 0, piiCategoryBreakdown: [],
    unsafeTopicDetectedCount: 0, unsafeTopicCategoryBreakdown: [],
    injectionScoreBands: { high: 0, moderate: 0, low: 0 }, avgInjectionScore: null,
  };
  const apiUseCaseLabels = data.apiUseCaseLabels ?? [];
  const llmLabel = apiUseCaseLabels.find((l) => l.label === "cf-llm");
  const hasLlmTraffic = !!llmLabel && llmLabel.operationCount > 0;
  const hasLiveDetectionData = aiSecurity.scannedCount > 0;

  const injectionTotal = aiSecurity.injectionScoreBands.high + aiSecurity.injectionScoreBands.moderate + aiSecurity.injectionScoreBands.low;

  // Only render when there's something real to show: the feature is
  // enabled, OR there's real cf-llm-labeled traffic on this zone worth
  // flagging as unprotected.
  if (!aiSecurity.enabled && !hasLlmTraffic) return null;

  return (
    <section className="report-section">
      <SectionHeader
        icon={<Bot size={20} />}
        title="AI Security for Apps"
        subtitle="PII exposure, unsafe topics, and prompt injection detection for LLM-powered endpoints"
        printBreak
      />

      <div className="space-y-4">
        {/* ── Status + LLM traffic context ─────────────────────────────── */}
        <div className="bg-white rounded-xl shadow-sm border border-cf-gray-200 p-5">
          <div className="flex items-start justify-between gap-3 flex-wrap">
            <div>
              <div className="flex items-center gap-2 mb-1">
                <h3 className="text-sm font-semibold text-cf-navy">Feature Status</h3>
                <StatusPill enabled={aiSecurity.enabled} />
              </div>
              <p className="text-xs text-cf-gray-500 max-w-xl">
                Scans incoming requests to <code className="font-mono">cf-llm</code> labeled endpoints for LLM prompts containing PII, unsafe topics, or prompt-injection attempts. Model-agnostic — works regardless of which LLM provider is used.
              </p>
            </div>
            <div className="flex gap-3">
              <div className="text-right">
                <p className="text-2xl font-black text-purple-700">{hasLlmTraffic ? formatNumber(llmLabel!.operationCount) : "0"}</p>
                <p className="text-[10px] text-cf-gray-500">cf-llm endpoint{llmLabel?.operationCount === 1 ? "" : "s"}</p>
              </div>
              {hasLiveDetectionData && (
                <div className="text-right">
                  <p className="text-2xl font-black text-purple-700">{formatNumber(aiSecurity.scannedCount)}</p>
                  <p className="text-[10px] text-cf-gray-500">prompts scanned this period</p>
                </div>
              )}
            </div>
          </div>

          {aiSecurity.enabled && (
            <div className="flex flex-wrap gap-2 mt-3">
              <span
                className="inline-flex items-center px-2.5 py-1 rounded-full text-[11px] font-semibold border"
                style={{
                  borderColor: aiSecurity.logModeDeployed ? "#F59E0B40" : "#10B98140",
                  backgroundColor: aiSecurity.logModeDeployed ? "#FFFBEB" : "#F0FDF4",
                  color: aiSecurity.logModeDeployed ? "#B45309" : "#15803D",
                }}
              >
                {aiSecurity.logModeDeployed ? "Log Mode Ruleset Deployed (tuning phase)" : "Standard Detection"}
              </span>
              <span className="inline-flex items-center px-2.5 py-1 rounded-full text-[11px] font-semibold border border-cf-gray-200 bg-cf-gray-50 text-cf-gray-600">
                {aiSecurity.customTopics.length} custom topic{aiSecurity.customTopics.length === 1 ? "" : "s"} configured
              </span>
            </div>
          )}

          {!aiSecurity.enabled && hasLlmTraffic && (
            <div className="mt-3 p-3 bg-red-50 border border-red-200 rounded-lg">
              <p className="text-xs text-red-700 font-semibold">
                {formatNumber(llmLabel!.requests)} request(s) reached {llmLabel!.operationCount} LLM-powered endpoint(s) this period with no prompt-level protection enabled.
              </p>
            </div>
          )}

          {aiSecurity.enabled && !hasLiveDetectionData && (
            <div className="mt-3 p-3 bg-blue-50 border border-blue-200 rounded-lg flex items-start gap-2">
              <ShieldAlert size={14} className="text-blue-500 flex-shrink-0 mt-0.5" />
              <p className="text-[11px] text-blue-700">
                Live detection counts require Cloudflare's Enterprise <strong>AI detection fields</strong> paid add-on — contact your account team to enable, then results populate automatically. The categories and scoring bands below are Cloudflare's real, documented detection capabilities.
              </p>
            </div>
          )}
        </div>

        {/* ── Real live detection summary (only when data exists) ─────────── */}
        {hasLiveDetectionData && (
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
            <div className="bg-white rounded-xl shadow-sm border border-cf-gray-200 p-4">
              <p className="text-[10px] font-semibold text-cf-gray-500 uppercase tracking-wide mb-1">PII Detected</p>
              <p className={`text-2xl font-black ${aiSecurity.piiDetectedCount > 0 ? "text-red-600" : "text-green-600"}`}>{formatNumber(aiSecurity.piiDetectedCount)}</p>
              <p className="text-[10px] text-cf-gray-400 mt-1">of {formatNumber(aiSecurity.scannedCount)} scanned prompts</p>
            </div>
            <div className="bg-white rounded-xl shadow-sm border border-cf-gray-200 p-4">
              <p className="text-[10px] font-semibold text-cf-gray-500 uppercase tracking-wide mb-1">Unsafe Topics Matched</p>
              <p className={`text-2xl font-black ${aiSecurity.unsafeTopicDetectedCount > 0 ? "text-orange-600" : "text-green-600"}`}>{formatNumber(aiSecurity.unsafeTopicDetectedCount)}</p>
              <p className="text-[10px] text-cf-gray-400 mt-1">of {formatNumber(aiSecurity.scannedCount)} scanned prompts</p>
            </div>
            <div className="bg-white rounded-xl shadow-sm border border-cf-gray-200 p-4">
              <p className="text-[10px] font-semibold text-cf-gray-500 uppercase tracking-wide mb-1">Avg. Injection Score</p>
              <p className="text-2xl font-black text-cf-navy">{aiSecurity.avgInjectionScore ?? "—"}</p>
              <p className="text-[10px] text-cf-gray-400 mt-1">{formatNumber(aiSecurity.injectionScoreBands.high)} high-confidence injection attempt(s)</p>
            </div>
          </div>
        )}

        {/* ── Custom Topics ─────────────────────────────────────────────── */}
        {aiSecurity.enabled && aiSecurity.customTopics.length > 0 && (
          <div className="bg-white rounded-xl shadow-sm border border-cf-gray-200 overflow-hidden">
            <div className="px-5 py-4 border-b border-cf-gray-100">
              <h3 className="text-sm font-semibold text-cf-navy">Custom Topics Configured</h3>
              <p className="text-xs text-cf-gray-400 mt-0.5">Organization-specific topics this zone scores every LLM prompt against, in addition to the built-in unsafe-topic categories.</p>
            </div>
            <table className="w-full text-xs">
              <thead>
                <tr className="bg-cf-gray-50 text-cf-gray-500 uppercase tracking-wide text-[10px]">
                  <th className="px-4 py-2 text-left font-semibold">Label</th>
                  <th className="px-4 py-2 text-left font-semibold">Topic Description</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-cf-gray-100">
                {aiSecurity.customTopics.map((t, i) => (
                  <tr key={t.label} className={i % 2 === 0 ? "bg-white" : "bg-cf-gray-50/40"}>
                    <td className="px-4 py-2 font-mono font-semibold text-purple-700">{t.label}</td>
                    <td className="px-4 py-2 text-cf-gray-600">{t.topic}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {/* ── 3 Detection Capabilities ──────────────────────────────────── */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
          {/* PII Detection */}
          <div className="bg-white rounded-xl shadow-sm border border-cf-gray-200 overflow-hidden flex flex-col">
            <div className="px-4 py-3 border-b border-cf-gray-100 flex items-center gap-2">
              <Fingerprint size={14} className="text-blue-600 flex-shrink-0" />
              <h3 className="text-xs font-semibold text-cf-navy">PII Detection</h3>
            </div>
            <div className="p-4 flex-1">
              <p className="text-[11px] text-cf-gray-500 mb-3">
                AI-based Named Entity Recognition (NER) model scans prompts for 13 PII categories.
              </p>
              <div className="flex flex-wrap gap-1">
                {PII_CATEGORIES.map((c) => {
                  const hit = aiSecurity.piiCategoryBreakdown.find((b) => b.category === c.code);
                  return (
                    <span
                      key={c.code}
                      className={`px-1.5 py-0.5 rounded text-[9px] font-mono ${hit ? "bg-red-600 text-white font-bold" : "bg-blue-50 text-blue-700"}`}
                      title={hit ? `${c.label} — ${formatNumber(hit.count)} detected` : c.label}
                    >
                      {c.code}{hit ? ` (${formatNumber(hit.count)})` : ""}
                    </span>
                  );
                })}
              </div>
              <p className="text-[10px] text-cf-gray-400 mt-3">
                Fields: <code className="font-mono">cf.llm.prompt.pii_detected</code>, <code className="font-mono">cf.llm.prompt.pii_categories</code>
              </p>
            </div>
          </div>

          {/* Unsafe Topic Detection */}
          <div className="bg-white rounded-xl shadow-sm border border-cf-gray-200 overflow-hidden flex flex-col">
            <div className="px-4 py-3 border-b border-cf-gray-100 flex items-center gap-2">
              <MessageSquareWarning size={14} className="text-orange-600 flex-shrink-0" />
              <h3 className="text-xs font-semibold text-cf-navy">Unsafe Topic Detection</h3>
            </div>
            <div className="p-4 flex-1">
              <p className="text-[11px] text-cf-gray-500 mb-3">
                14 built-in safety categories (S1–S14), evaluated automatically when the feature is enabled.
              </p>
              <div className="flex flex-wrap gap-1">
                {UNSAFE_TOPIC_CATEGORIES.map((c) => {
                  const hit = aiSecurity.unsafeTopicCategoryBreakdown.find((b) => b.category === c.code);
                  return (
                    <span
                      key={c.code}
                      className={`px-1.5 py-0.5 rounded text-[9px] font-mono ${hit ? "bg-red-600 text-white font-bold" : "bg-orange-50 text-orange-700"}`}
                      title={hit ? `${c.label} — ${formatNumber(hit.count)} detected` : c.label}
                    >
                      {c.code} {c.label}{hit ? ` (${formatNumber(hit.count)})` : ""}
                    </span>
                  );
                })}
              </div>
              <p className="text-[10px] text-cf-gray-400 mt-3">
                Fields: <code className="font-mono">cf.llm.prompt.unsafe_topic_detected</code>, <code className="font-mono">cf.llm.prompt.unsafe_topic_categories</code>
              </p>
            </div>
          </div>

          {/* Prompt Injection Detection */}
          <div className="bg-white rounded-xl shadow-sm border border-cf-gray-200 overflow-hidden flex flex-col">
            <div className="px-4 py-3 border-b border-cf-gray-100 flex items-center gap-2">
              <ShieldAlert size={14} className="text-red-600 flex-shrink-0" />
              <h3 className="text-xs font-semibold text-cf-navy">Prompt Injection Detection</h3>
            </div>
            <div className="p-4 flex-1">
              <p className="text-[11px] text-cf-gray-500 mb-3">
                Score-based (1–99) rather than binary — lower score means higher-confidence attack.
              </p>
              <div className="space-y-1.5">
                {INJECTION_SCORE_BANDS.map((b) => {
                  const count = aiSecurity.injectionScoreBands[b.key];
                  const pct = injectionTotal > 0 ? Math.round((count / injectionTotal) * 100) : 0;
                  return (
                    <div key={b.range} className="flex items-start gap-2">
                      <span className="text-[10px] font-mono font-bold px-1.5 py-0.5 rounded text-white flex-shrink-0" style={{ backgroundColor: b.color }}>{b.range}</span>
                      <span className="text-[10px] text-cf-gray-600 leading-tight flex-1">{b.meaning}</span>
                      {injectionTotal > 0 && <span className="text-[10px] font-mono font-bold text-cf-navy flex-shrink-0">{formatNumber(count)} ({pct}%)</span>}
                    </div>
                  );
                })}
              </div>
              <p className="text-[10px] text-cf-gray-400 mt-3">
                Field: <code className="font-mono">cf.llm.prompt.injection_score</code>
              </p>
            </div>
          </div>
        </div>

        {/* ── Example custom rule (reference) ──────────────────────────── */}
        <div className="bg-cf-navy rounded-xl p-4">
          <div className="flex items-center justify-between mb-2">
            <p className="text-[11px] font-semibold text-white/70 uppercase tracking-wide">Example Custom Rule — Block High-Confidence Injection + PII Extraction</p>
            <a href="https://developers.cloudflare.com/waf/detections/ai-security-for-apps/prompt-injection/" target="_blank" rel="noreferrer" className="text-white/50 hover:text-white/80">
              <ExternalLink size={12} />
            </a>
          </div>
          <code className="block text-[11px] font-mono text-green-400 leading-relaxed break-all">
            (cf.llm.prompt.injection_score lt 40 and cf.llm.prompt.pii_detected)
          </code>
          <p className="text-[10px] text-white/50 mt-2">
            Targets prompts that look like injection attempts AND are also trying to extract personal data — a common attack pattern combining both signals reduces false positives.
          </p>
        </div>
      </div>
    </section>
  );
}
