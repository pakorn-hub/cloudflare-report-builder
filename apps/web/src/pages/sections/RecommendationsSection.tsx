/**
 * RecommendationsSection — prioritized actionable recommendations with
 * ready-to-use Cloudflare Rules Language expressions and config templates.
 */
import { CheckCircle, AlertTriangle, Info, ChevronRight, Shield, Zap, Clock, Settings, Code2, Copy, ExternalLink } from "lucide-react";
import { useState } from "react";
import SectionHeader from "../../components/SectionHeader";
import type { AppSecData, SecurityRecommendation, RuleTemplate } from "../../types";

interface Props { data: AppSecData }

const PRIORITY_STYLE = {
  high:   { card: "border-red-200 bg-red-50/30",    badge: "bg-red-50 border-red-200 text-red-700",    icon: <AlertTriangle size={11} />, label: "High Priority" },
  medium: { card: "border-yellow-200 bg-yellow-50/20", badge: "bg-yellow-50 border-yellow-200 text-yellow-700", icon: <Info size={11} />, label: "Medium Priority" },
  low:    { card: "border-blue-200 bg-blue-50/20",  badge: "bg-blue-50 border-blue-200 text-blue-700", icon: <CheckCircle size={11} />, label: "Low Priority" },
};

const RULE_TYPE_META: Record<RuleTemplate["type"], { label: string; color: string; icon: React.ReactNode }> = {
  waf_custom: { label: "WAF Custom Rule",   color: "text-red-600 bg-red-50 border-red-200",    icon: <Shield size={12} /> },
  rate_limit: { label: "Rate Limiting Rule", color: "text-purple-600 bg-purple-50 border-purple-200", icon: <Clock size={12} /> },
  bot:        { label: "Bot Rule",           color: "text-orange-600 bg-orange-50 border-orange-200", icon: <Shield size={12} /> },
  transform:  { label: "Transform Rule",    color: "text-blue-600 bg-blue-50 border-blue-200",  icon: <Zap size={12} /> },
  config:     { label: "Configuration",     color: "text-green-600 bg-green-50 border-green-200", icon: <Settings size={12} /> },
};

function RuleBlock({ template }: { template: RuleTemplate }) {
  const [copied, setCopied] = useState(false);
  const meta = RULE_TYPE_META[template.type];

  function handleCopy() {
    if (template.expression) {
      navigator.clipboard.writeText(template.expression).then(() => {
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
      });
    }
  }

  return (
    <div className="mt-3 rounded-lg border border-cf-gray-200 overflow-hidden bg-white">
      {/* Rule type header */}
      <div className="flex items-center justify-between px-4 py-2 bg-cf-gray-50 border-b border-cf-gray-100">
        <div className="flex items-center gap-2">
          <Code2 size={13} className="text-cf-gray-500" />
          <span className="text-[10px] font-bold uppercase tracking-widest text-cf-gray-500">Rule Template</span>
          <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold border ${meta.color}`}>
            {meta.icon} {meta.label}
          </span>
        </div>
        {template.cfDocs && (
          <a
            href={`https://developers.cloudflare.com/${template.cfDocs}`}
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-1 text-[10px] text-cf-orange hover:underline"
          >
            Docs <ExternalLink size={9} />
          </a>
        )}
      </div>

      <div className="px-4 py-3 space-y-2">
        {/* Rule name */}
        <p className="text-xs font-semibold text-cf-navy">{template.name}</p>
        <p className="text-[11px] text-cf-gray-500">{template.description}</p>

        {/* Expression code block */}
        {template.expression && (
          <div className="relative">
            <div className="bg-cf-gray-900 rounded-lg px-4 py-3 pr-12 overflow-x-auto">
              <code className="text-[11px] text-green-400 font-mono whitespace-pre-wrap break-all leading-relaxed">
                {template.expression}
              </code>
            </div>
            <button
              onClick={handleCopy}
              title="Copy expression"
              className="absolute top-2 right-2 p-1.5 rounded bg-cf-gray-700 hover:bg-cf-gray-600 transition text-white"
            >
              {copied ? <CheckCircle size={12} className="text-green-400" /> : <Copy size={12} />}
            </button>
          </div>
        )}

        {/* Action badge */}
        {template.action && (
          <div className="flex items-center gap-2">
            <span className="text-[10px] text-cf-gray-400 uppercase tracking-wide">Action:</span>
            <span className={`inline-block px-2 py-0.5 rounded-full text-[10px] font-semibold border ${
              template.action === "block" ? "bg-red-50 text-red-700 border-red-200" :
              template.action === "managed_challenge" ? "bg-orange-50 text-orange-700 border-orange-200" :
              template.action === "challenge" ? "bg-yellow-50 text-yellow-700 border-yellow-200" :
              "bg-blue-50 text-blue-700 border-blue-200"
            }`}>
              {template.action}
            </span>
          </div>
        )}
      </div>
    </div>
  );
}

export default function RecommendationsSection({ data }: Props) {
  const recommendations = data.recommendations ?? [];
  const [expanded, setExpanded] = useState<number | null>(null);

  const highCount   = recommendations.filter((r) => r.priority === "high").length;
  const mediumCount = recommendations.filter((r) => r.priority === "medium").length;
  const lowCount    = recommendations.filter((r) => r.priority === "low").length;
  const withRules   = recommendations.filter((r) => r.ruleTemplate).length;

  return (
    <section className="report-section">
      <SectionHeader
        title="Security Recommendations"
        subtitle="Prioritized actions with ready-to-use Cloudflare Rules Language expressions and configuration templates"
        icon={<CheckCircle size={18} />}
      />

      {/* Summary pills */}
      <div className="flex flex-wrap gap-3 mt-4 mb-6">
        {highCount > 0 && (
          <span className="inline-flex items-center gap-1.5 bg-red-50 border border-red-200 text-red-700 px-3 py-1.5 rounded-full text-xs font-semibold">
            <AlertTriangle size={12} /> {highCount} High Priority
          </span>
        )}
        {mediumCount > 0 && (
          <span className="inline-flex items-center gap-1.5 bg-yellow-50 border border-yellow-200 text-yellow-700 px-3 py-1.5 rounded-full text-xs font-semibold">
            <Info size={12} /> {mediumCount} Medium Priority
          </span>
        )}
        {lowCount > 0 && (
          <span className="inline-flex items-center gap-1.5 bg-blue-50 border border-blue-200 text-blue-700 px-3 py-1.5 rounded-full text-xs font-semibold">
            <CheckCircle size={12} /> {lowCount} Low Priority
          </span>
        )}
        {withRules > 0 && (
          <span className="inline-flex items-center gap-1.5 bg-cf-gray-100 border border-cf-gray-200 text-cf-gray-600 px-3 py-1.5 rounded-full text-xs font-semibold">
            <Code2 size={12} /> {withRules} with Rule Templates
          </span>
        )}
        {recommendations.length === 0 && (
          <span className="text-sm text-cf-gray-500">No recommendations generated.</span>
        )}
      </div>

      {/* Recommendation cards */}
      <div className="space-y-3">
        {recommendations.map((rec: SecurityRecommendation, i: number) => {
          const style = PRIORITY_STYLE[rec.priority];
          const isExpanded = expanded === i;

          return (
            <div
              key={i}
              className={`border rounded-xl overflow-hidden print-keep-together transition-colors ${style.card}`}
            >
              {/* Card header — always visible */}
              <div className="p-4">
                <div className="flex items-start gap-3">
                  <div className="w-7 h-7 rounded-full bg-white border border-cf-gray-200 flex items-center justify-center text-xs font-bold text-cf-gray-500 flex-shrink-0 mt-0.5 shadow-sm">
                    {i + 1}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex flex-wrap items-center gap-2 mb-1.5">
                      <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-semibold border ${style.badge}`}>
                        {style.icon} {style.label}
                      </span>
                      {rec.ruleTemplate && (
                        <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold border ${RULE_TYPE_META[rec.ruleTemplate.type].color}`}>
                          {RULE_TYPE_META[rec.ruleTemplate.type].icon}
                          {RULE_TYPE_META[rec.ruleTemplate.type].label}
                        </span>
                      )}
                    </div>
                    <h4 className="font-semibold text-cf-navy text-sm mb-1.5">{rec.title}</h4>
                    <p className="text-sm text-cf-gray-600 leading-relaxed">{rec.description}</p>

                    <div className="flex items-start gap-2 bg-green-50 rounded-lg px-3 py-2 mt-2">
                      <ChevronRight size={12} className="text-green-600 mt-0.5 flex-shrink-0" />
                      <span className="text-xs text-green-800">
                        <strong>Expected benefit:</strong> {rec.benefit}
                      </span>
                    </div>

                    {/* Rule template — expanded on screen, always shown in print */}
                    {rec.ruleTemplate && (
                      <>
                        {/* Toggle button (screen only) */}
                        <button
                          className="print:hidden mt-3 flex items-center gap-1.5 text-xs font-semibold text-cf-orange hover:text-cf-orange-dark transition"
                          onClick={() => setExpanded(isExpanded ? null : i)}
                        >
                          <Code2 size={12} />
                          {isExpanded ? "Hide" : "Show"} Rule Template
                        </button>

                        {/* Template block — always visible in print */}
                        <div className={isExpanded ? "block" : "hidden print:block"}>
                          <RuleBlock template={rec.ruleTemplate} />
                        </div>
                      </>
                    )}
                  </div>
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {/* Call to action — post-POC framing */}
      <div className="mt-6 bg-gradient-to-r from-cf-orange/8 to-orange-50 border border-cf-orange/25 rounded-xl p-5 print:bg-white print:border-cf-gray-300">
        <div className="flex items-start gap-3">
          <div className="w-8 h-8 rounded-lg bg-cf-orange flex items-center justify-center flex-shrink-0 mt-0.5">
            <CheckCircle size={16} className="text-white" />
          </div>
          <div>
            <p className="text-sm font-semibold text-cf-navy mb-1">
              How to Improve Further with Cloudflare
            </p>
            <p className="text-sm text-cf-gray-700 leading-relaxed">
              The POC period has concluded and no further changes will be made to this environment.
              The rule templates above show exactly how you can strengthen your security posture in a full deployment —
              each expression can be created directly in the Cloudflare dashboard under
              <span className="font-semibold text-cf-navy"> Security → WAF → Custom Rules</span> or
              <span className="font-semibold text-cf-navy"> Rate Limiting Rules</span>,
              with no additional configuration required.
            </p>
            <p className="text-sm text-cf-gray-600 leading-relaxed mt-2">
              These are ready-to-deploy rules based on the actual traffic patterns observed during your POC —
              they are tailored to your zone, not generic templates.
              Your Cloudflare Solutions Engineer can walk you through deployment as part of the full onboarding.
            </p>
          </div>
        </div>
        <p className="text-xs text-cf-gray-400 mt-3 pt-3 border-t border-cf-orange/15">
          All expressions use the{" "}
          <span className="text-cf-orange font-medium">Cloudflare Rules Language</span>.
           Full reference: <span className="text-cf-orange">developers.cloudflare.com/ruleset-engine/rules-language/</span>
        </p>
      </div>
    </section>
  );
}
