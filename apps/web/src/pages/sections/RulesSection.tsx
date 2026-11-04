/**
 * RulesSection — Custom WAF Rules & Rate Limiting Rules inventory.
 *
 * Shows every rule deployed on the zone:
 *   - Custom WAF rules (block, challenge, skip, log, managed_challenge)
 *   - Rate limiting rules (threshold / period / action)
 *
 * For each rule: description, action badge, enabled/disabled status,
 * and the full Cloudflare Rules Language expression.
 */
import { useState } from "react";
import { ShieldCheck, Clock, ChevronDown, ChevronRight, CheckCircle2, XCircle } from "lucide-react";
import type { AppSecData, CustomWafRule, RateLimitRule } from "../../types";
import SectionHeader from "../../components/SectionHeader";

interface Props { data: AppSecData }

// Action → color
const ACTION_COLORS: Record<string, { bg: string; text: string; border: string }> = {
  block:              { bg: "#FEE2E2", text: "#DC2626", border: "#FECACA" },
  drop:               { bg: "#FEE2E2", text: "#B91C1C", border: "#FECACA" },
  managed_challenge:  { bg: "#FEF3C7", text: "#D97706", border: "#FDE68A" },
  js_challenge:       { bg: "#FEF9C3", text: "#CA8A04", border: "#FEF08A" },
  challenge:          { bg: "#FEF9C3", text: "#B45309", border: "#FEF08A" },
  log:                { bg: "#DBEAFE", text: "#2563EB", border: "#BFDBFE" },
  skip:               { bg: "#F3F4F6", text: "#6B7280", border: "#E5E7EB" },
  allow:              { bg: "#DCFCE7", text: "#16A34A", border: "#BBF7D0" },
};

// Phase → human label
const PHASE_LABEL: Record<string, string> = {
  http_request_firewall_custom: "WAF Custom Rule",
  http_ratelimit:               "Rate Limiting",
  http_request_sbfm:            "Super Bot Fight Mode",
};

function ActionBadge({ action }: { action: string }) {
  const c = ACTION_COLORS[action] ?? ACTION_COLORS["skip"];
  return (
    <span
      className="inline-block px-2 py-0.5 rounded-full text-[10px] font-bold border"
      style={{ backgroundColor: c.bg, color: c.text, borderColor: c.border }}
    >
      {action.replace(/_/g, " ")}
    </span>
  );
}

function Expression({ expr }: { expr: string }) {
  const [expanded, setExpanded] = useState(false);
  if (!expr) return <span className="text-cf-gray-400 text-[10px] italic">No expression</span>;
  const isLong = expr.length > 80;
  const display = isLong && !expanded ? expr.slice(0, 80) + "…" : expr;
  return (
    <div className="mt-1.5">
      <code
        className="block text-[10px] font-mono bg-cf-gray-900 text-green-400 rounded-lg px-3 py-2 leading-relaxed break-all cursor-pointer"
        onClick={() => isLong && setExpanded((v) => !v)}
        title={isLong ? (expanded ? "Click to collapse" : "Click to expand") : undefined}
      >
        {display}
        {isLong && (
          <span className="ml-2 text-cf-gray-500 not-italic font-sans text-[9px]">
            {expanded ? "▲ collapse" : "▼ expand"}
          </span>
        )}
      </code>
    </div>
  );
}

export default function RulesSection({ data }: Props) {
  const customWafRules = data.customWafRules ?? [];
  const rateLimitRules = data.rateLimitRules ?? [];
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());

  const toggle = (id: string) =>
    setExpandedIds((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });

  const enabledWaf  = customWafRules.filter((r) => r.enabled).length;
  const enabledRL   = rateLimitRules.filter((r) => r.enabled).length;
  const totalRules  = customWafRules.length + rateLimitRules.length;

  if (totalRules === 0) {
    return (
      <section className="report-section">
        <SectionHeader
          icon={<ShieldCheck size={20} />}
          title="Security Rules"
          subtitle="Custom WAF rules and rate limiting rules deployed on this zone"
        />
        <div className="bg-white rounded-xl border border-cf-gray-200 p-8 text-center">
          <ShieldCheck size={32} className="text-cf-gray-300 mx-auto mb-3" />
          <p className="text-cf-gray-500 text-sm font-medium">No custom rules configured</p>
          <p className="text-cf-gray-400 text-xs mt-1">
            Create WAF Custom Rules and Rate Limiting Rules in the Cloudflare dashboard to protect your zone.
          </p>
        </div>
      </section>
    );
  }

  return (
    <section className="report-section">
      <SectionHeader
        icon={<ShieldCheck size={20} />}
        title="Security Rules"
        subtitle="Custom WAF rules and rate limiting rules deployed on this zone — expressions included"
        printBreak
      />

      {/* ── KPI summary ─────────────────────────────────────────────────── */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {[
          { label: "Custom WAF Rules",   value: customWafRules.length, sub: `${enabledWaf} enabled`,  color: "#DC2626" },
          { label: "Rate Limit Rules",   value: rateLimitRules.length, sub: `${enabledRL} enabled`,   color: "#8B5CF6" },
          { label: "Block Rules",        value: customWafRules.filter(r => r.action === "block").length,             sub: "Hard block",          color: "#EF4444" },
          { label: "Challenge Rules",    value: customWafRules.filter(r => ["challenge","managed_challenge","js_challenge"].includes(r.action)).length, sub: "CAPTCHA / JS challenge", color: "#F59E0B" },
        ].map((k) => (
          <div key={k.label} className="bg-white rounded-xl shadow-sm border border-cf-gray-200 p-4">
            <p className="text-[10px] font-semibold text-cf-gray-500 uppercase tracking-wide mb-1">{k.label}</p>
            <p className="text-2xl font-black" style={{ color: k.color }}>{k.value}</p>
            <p className="text-[10px] text-cf-gray-400 mt-0.5">{k.sub}</p>
          </div>
        ))}
      </div>

      {/* ── Custom WAF Rules ─────────────────────────────────────────────── */}
      {customWafRules.length > 0 && (
        <div className="bg-white rounded-xl shadow-sm border border-cf-gray-200 overflow-hidden">
          <div className="px-5 py-4 border-b border-cf-gray-100 flex items-center gap-2">
            <ShieldCheck size={15} className="text-red-500" />
            <div>
              <h3 className="text-sm font-semibold text-cf-navy">Custom WAF Rules</h3>
              <p className="text-[10px] text-cf-gray-400 mt-0.5">
                {enabledWaf} of {customWafRules.length} enabled · click a rule to see the expression
              </p>
            </div>
          </div>

          <div className="divide-y divide-cf-gray-100">
            {customWafRules.map((rule, i) => {
              const expanded = expandedIds.has(rule.id);
              return (
                <div key={rule.id}>
                  {/* Rule header row — always visible */}
                  <button
                    className="w-full flex items-start gap-3 px-5 py-3 hover:bg-cf-gray-50 transition text-left"
                    onClick={() => toggle(rule.id)}
                  >
                    {/* Index */}
                    <span className="text-cf-gray-400 font-mono text-[11px] w-6 flex-shrink-0 mt-0.5">{i + 1}</span>

                    {/* Enabled indicator */}
                    <span className="mt-0.5 flex-shrink-0">
                      {rule.enabled
                        ? <CheckCircle2 size={14} className="text-green-500" />
                        : <XCircle     size={14} className="text-cf-gray-400" />
                      }
                    </span>

                    {/* Description + phase tag */}
                    <div className="flex-1 min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="text-xs font-semibold text-cf-navy leading-tight">{rule.description}</span>
                        <span className="text-[9px] font-medium text-cf-gray-400 bg-cf-gray-100 px-1.5 py-0.5 rounded">
                          {PHASE_LABEL[rule.phase] ?? rule.phase}
                        </span>
                        {!rule.enabled && (
                          <span className="text-[9px] font-medium text-cf-gray-400 bg-cf-gray-100 px-1.5 py-0.5 rounded">disabled</span>
                        )}
                      </div>
                    </div>

                    {/* Action badge */}
                    <ActionBadge action={rule.action} />

                    {/* Expand chevron */}
                    {rule.expression && (
                      expanded
                        ? <ChevronDown size={14} className="text-cf-gray-400 flex-shrink-0 mt-0.5" />
                        : <ChevronRight size={14} className="text-cf-gray-400 flex-shrink-0 mt-0.5" />
                    )}
                  </button>

                  {/* Expression — expanded */}
                  {expanded && rule.expression && (
                    <div className="px-5 pb-3 bg-cf-gray-50">
                      <p className="text-[10px] text-cf-gray-500 mb-1 font-semibold uppercase tracking-wide">Expression</p>
                      <code className="block text-[11px] font-mono bg-cf-gray-900 text-green-400 rounded-lg px-4 py-3 leading-relaxed break-all whitespace-pre-wrap">
                        {rule.expression}
                      </code>
                      {rule.phase === "http_ratelimit" && rule.ratelimit && (
                        <div className="mt-2 flex flex-wrap gap-4 text-[10px] text-cf-gray-500">
                          {rule.ratelimit.requests_per_period != null && rule.ratelimit.period != null && (
                            <span>
                              <strong className="text-cf-navy">{rule.ratelimit.requests_per_period}</strong> requests /{" "}
                              {rule.ratelimit.period >= 3600 ? `${rule.ratelimit.period / 3600}h` : rule.ratelimit.period >= 60 ? `${rule.ratelimit.period / 60}m` : `${rule.ratelimit.period}s`}
                            </span>
                          )}
                          {rule.ratelimit.characteristics && rule.ratelimit.characteristics.length > 0 && (
                            <span>Tracked by: <strong className="text-cf-navy font-mono">{rule.ratelimit.characteristics.join(", ")}</strong></span>
                          )}
                          {rule.ratelimit.mitigation_timeout != null && (
                            <span>
                              Mitigation: {rule.ratelimit.mitigation_timeout === 0
                                ? "throttle only (no duration)"
                                : `${rule.ratelimit.mitigation_timeout >= 3600 ? `${rule.ratelimit.mitigation_timeout / 3600}h` : rule.ratelimit.mitigation_timeout >= 60 ? `${rule.ratelimit.mitigation_timeout / 60}m` : `${rule.ratelimit.mitigation_timeout}s`} duration`}
                            </span>
                          )}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* ── Rate Limiting Rules ──────────────────────────────────────────── */}
      {rateLimitRules.length > 0 && (
        <div className="bg-white rounded-xl shadow-sm border border-cf-gray-200 overflow-hidden">
          <div className="px-5 py-4 border-b border-cf-gray-100 flex items-center gap-2">
            <Clock size={15} className="text-purple-500" />
            <div>
              <h3 className="text-sm font-semibold text-cf-navy">Rate Limiting Rules</h3>
              <p className="text-[10px] text-cf-gray-400 mt-0.5">
                {enabledRL} of {rateLimitRules.length} enabled · protects endpoints from abuse and DDoS
              </p>
            </div>
          </div>

          <div className="overflow-x-auto overflow-y-auto" style={{ maxHeight: 400 }}>
            <table className="w-full text-xs">
              <thead className="sticky top-0">
                <tr className="bg-cf-gray-50 text-cf-gray-500 uppercase tracking-wide text-[10px]">
                  <th className="px-4 py-2.5 text-left font-semibold w-6">#</th>
                  <th className="px-4 py-2.5 text-left font-semibold">Rule</th>
                  <th className="px-4 py-2.5 text-center font-semibold">Threshold</th>
                  <th className="px-4 py-2.5 text-center font-semibold">Period</th>
                  <th className="px-4 py-2.5 text-center font-semibold">Action</th>
                  <th className="px-4 py-2.5 text-center font-semibold">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-cf-gray-100">
                {rateLimitRules.map((rule, i) => (
                  <tr key={rule.id} className={i % 2 === 0 ? "bg-white" : "bg-cf-gray-50/40"}>
                    <td className="px-4 py-2.5 text-cf-gray-400 font-mono text-[11px]">{i + 1}</td>
                    <td className="px-4 py-2.5">
                      <span className="text-xs font-medium text-cf-navy">
                        {rule.description || "(no description)"}
                      </span>
                    </td>
                    <td className="px-4 py-2.5 text-center">
                      <span className="font-mono font-bold text-cf-navy text-[11px]">{rule.threshold.toLocaleString()}</span>
                      <span className="text-[10px] text-cf-gray-400 ml-0.5">req</span>
                    </td>
                    <td className="px-4 py-2.5 text-center">
                      <span className="font-mono text-[11px] text-cf-gray-600">
                        {rule.period >= 3600 ? `${rule.period / 3600}h` : rule.period >= 60 ? `${rule.period / 60}m` : `${rule.period}s`}
                      </span>
                    </td>
                    <td className="px-4 py-2.5 text-center">
                      <ActionBadge action={rule.action} />
                    </td>
                    <td className="px-4 py-2.5 text-center">
                      {rule.enabled
                        ? <CheckCircle2 size={14} className="text-green-500 mx-auto" />
                        : <XCircle     size={14} className="text-cf-gray-400 mx-auto" />
                      }
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </section>
  );
}
