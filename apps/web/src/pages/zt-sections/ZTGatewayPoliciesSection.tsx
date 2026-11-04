import { useState } from "react";
import { Shield, ChevronDown, ChevronRight, CheckCircle2, XCircle } from "lucide-react";
import type { ZeroTrustData, GatewayPolicy } from "../../types";
import SectionHeader from "../../components/SectionHeader";

const ACTION_COLORS: Record<string, { bg: string; text: string }> = {
  block:       { bg: "#FEE2E2", text: "#DC2626" },
  allow:       { bg: "#DCFCE7", text: "#16A34A" },
  override:    { bg: "#DBEAFE", text: "#2563EB" },
  safesearch:  { bg: "#FEF3C7", text: "#D97706" },
  l4override:  { bg: "#F3E8FF", text: "#7C3AED" },
  audit:       { bg: "#F0F9FF", text: "#0369A1" },
  isolate:     { bg: "#FFF7ED", text: "#C2410C" },
};
const TYPE_LABELS: Record<string, string> = { dns: "DNS", http: "HTTP", l4: "Network (L4)" };
const TYPE_COLORS: Record<string, string> = { dns: "#3B82F6", http: "#10B981", l4: "#8B5CF6" };

function PolicyCard({ p }: { p: GatewayPolicy }) {
  const [open, setOpen] = useState(false);
  const ac = ACTION_COLORS[p.action] ?? { bg: "#F3F4F6", text: "#6B7280" };
  return (
    <div className="border border-cf-gray-200 rounded-lg overflow-hidden">
      <button className="w-full flex items-center gap-3 px-4 py-3 hover:bg-cf-gray-50 text-left transition" onClick={() => setOpen((v) => !v)}>
        {p.enabled ? <CheckCircle2 size={14} className="text-green-500 flex-shrink-0"/> : <XCircle size={14} className="text-cf-gray-400 flex-shrink-0"/>}
        <span className="flex-1 text-xs font-semibold text-cf-navy">{p.name}</span>
        <span className="text-[9px] font-medium px-2 py-0.5 rounded border mr-1" style={{ backgroundColor: TYPE_COLORS[p.ruleType]+"20", color: TYPE_COLORS[p.ruleType], borderColor: TYPE_COLORS[p.ruleType]+"40" }}>{TYPE_LABELS[p.ruleType]}</span>
        <span className="text-[10px] font-bold px-2 py-0.5 rounded" style={{ backgroundColor: ac.bg, color: ac.text }}>{p.action}</span>
        {(p.expression || (p.filters?.length ?? 0) > 0) && (open ? <ChevronDown size={13} className="text-cf-gray-400 flex-shrink-0"/> : <ChevronRight size={13} className="text-cf-gray-400 flex-shrink-0"/>)}
      </button>
      {open && (p.expression || (p.filters?.length ?? 0) > 0) && (
        <div className="px-4 pb-3 bg-cf-gray-50 border-t border-cf-gray-100">
          {p.filters && p.filters.length > 0 && (
            <div className="mb-2 flex flex-wrap gap-1 pt-2">
              {p.filters.map((f) => <span key={f} className="text-[10px] bg-white border border-cf-gray-200 text-cf-gray-600 px-2 py-0.5 rounded">{f}</span>)}
            </div>
          )}
          {p.expression && (
            <code className="block text-[10px] font-mono bg-cf-gray-900 text-green-400 rounded px-3 py-2 leading-relaxed break-all mt-1">{p.expression}</code>
          )}
        </div>
      )}
    </div>
  );
}

export default function ZTGatewayPoliciesSection({ data }: { data: ZeroTrustData }) {
  const policies = data.gatewayPolicies;
  const [filter, setFilter] = useState<"all"|"dns"|"http"|"l4">("all");
  if (policies.length === 0) return null;

  const shown = filter === "all" ? policies : policies.filter((p) => p.ruleType === filter);
  const counts = { dns: policies.filter((p) => p.ruleType==="dns").length, http: policies.filter((p) => p.ruleType==="http").length, l4: policies.filter((p) => p.ruleType==="l4").length };

  return (
    <section className="report-section">
      <SectionHeader icon={<Shield size={20}/>} title="Gateway — Policies Audit"
        subtitle="All active DNS, HTTP, and L4 network filtering rules — click to see details" />
      <div className="flex gap-2 mb-4 flex-wrap">
        {(["all","dns","http","l4"] as const).map((t) => (
          <button key={t} onClick={() => setFilter(t)}
            className={`px-3 py-1.5 rounded-full text-xs font-semibold border transition ${filter===t ? "bg-cf-orange text-white border-cf-orange" : "bg-white text-cf-gray-600 border-cf-gray-200 hover:border-cf-orange"}`}>
            {t === "all" ? `All (${policies.length})` : `${TYPE_LABELS[t]} (${counts[t]})`}
          </button>
        ))}
      </div>
      <div className="space-y-2">
        {shown.map((p) => <PolicyCard key={p.id} p={p}/>)}
        {shown.length === 0 && <p className="text-sm text-cf-gray-400 text-center py-8">No {filter} policies configured.</p>}
      </div>
    </section>
  );
}
