/**
 * CostCalculator — interactive AWS vs Cloudflare cost comparison.
 *
 * Pre-filled from actual API data but user can edit:
 *   - Monthly HTTP Requests (millions)
 *   - Monthly Data Transfer (GB)
 *   - Monthly DNS Queries (millions)
 *
 * Recalculates live as user types. Shows AWS cost breakdown and
 * the Cloudflare equivalent (unmetered / plan-included).
 */
import { useState, useCallback } from "react";
import { Calculator, RefreshCw, Info } from "lucide-react";
import type { AwsServiceCost } from "../types";

interface Props {
  /** Pre-filled defaults from API data */
  defaultRequestsM: number;
  defaultBandwidthGB: number;
  defaultDnsQueriesM: number;
}

function fmt$(v: number) {
  if (v >= 1000) return `$${(v / 1000).toFixed(1)}K`;
  return `$${v.toFixed(0)}`;
}

function calcAws(reqM: number, gbBw: number, dnsM: number): {
  costs: AwsServiceCost[];
  total: number;
  dnsTotal: number;
  cdnTotal: number;
  secTotal: number;
} {
  const dns: AwsServiceCost = {
    label: "AWS Route 53 (DNS)",
    category: "dns",
    baseFee: 0.50,
    perRequestFee: parseFloat((dnsM * 0.40).toFixed(2)),
    total: Math.round(0.50 + dnsM * 0.40),
    note: "$0.50/hosted zone + $0.40 per 1M DNS queries",
    what: "Authoritative DNS",
    cfNote: "$0 — Unmetered, included in all plans",
  };

  const cdn: AwsServiceCost = {
    label: "AWS CloudFront (CDN)",
    category: "cdn",
    baseFee: 0,
    perRequestFee: parseFloat((reqM * 1.0).toFixed(2)),
    dataTransferFee: parseFloat((gbBw * 0.085).toFixed(2)),
    total: Math.round(reqM * 1.0 + gbBw * 0.085),
    note: "$0.085/GB egress + $0.01 per 10,000 requests",
    what: "Content Delivery Network (global edge caching)",
    cfNote: "Unmetered bandwidth + requests for standard web traffic",
  };

  const waf: AwsServiceCost = {
    label: "AWS WAF",
    category: "security",
    baseFee: 5,
    perRequestFee: parseFloat((reqM * 0.60).toFixed(2)),
    ruleEvalFee: 1,
    total: Math.round(5 + 1 + reqM * 0.60),
    note: "$5/ACL + $1/rule/mo + $0.60 per 1M requests",
    what: "Web Application Firewall — managed + custom rules",
    cfNote: "Included in Pro ($25/mo) / Business ($250/mo) / Enterprise",
  };

  const ddos: AwsServiceCost = {
    label: "AWS Shield Advanced",
    category: "security",
    baseFee: 3000,
    perRequestFee: 0,
    total: 3000,
    note: "$3,000/month flat — L3/L4/L7 DDoS protection",
    what: "Advanced DDoS Protection",
    cfNote: "$0 — Unmetered L3/L4/L7 DDoS included in all plans",
  };

  const bot: AwsServiceCost = {
    label: "AWS Bot Control",
    category: "security",
    baseFee: 10,
    perRequestFee: parseFloat((reqM * 1.0).toFixed(2)),
    total: Math.round(10 + reqM * 1.0),
    note: "$10/mo base + $1.00 per 1M requests",
    what: "Bot detection and management",
    cfNote: "Included in Pro / Business / Enterprise",
  };

  const costs = [dns, cdn, waf, ddos, bot];
  const dnsTotal = dns.total;
  const cdnTotal = cdn.total;
  const secTotal = waf.total + ddos.total + bot.total;
  return { costs, total: dnsTotal + cdnTotal + secTotal, dnsTotal, cdnTotal, secTotal };
}

const CATEGORY_LABEL: Record<string, { label: string; color: string }> = {
  dns:      { label: "DNS",       color: "#F6821F" },
  cdn:      { label: "CDN",       color: "#3B82F6" },
  security: { label: "Security",  color: "#DC2626" },
};

export default function CostCalculator({ defaultRequestsM, defaultBandwidthGB, defaultDnsQueriesM }: Props) {
  const [reqM,   setReqM]   = useState(defaultRequestsM);
  const [gbBw,   setGbBw]   = useState(defaultBandwidthGB);
  const [dnsM,   setDnsM]   = useState(defaultDnsQueriesM);
  const [edited, setEdited] = useState(false);

  const reset = useCallback(() => {
    setReqM(defaultRequestsM);
    setGbBw(defaultBandwidthGB);
    setDnsM(defaultDnsQueriesM);
    setEdited(false);
  }, [defaultRequestsM, defaultBandwidthGB, defaultDnsQueriesM]);

  const { costs, total, dnsTotal, cdnTotal, secTotal } = calcAws(reqM, gbBw, dnsM);

  const inputClass = "w-full border border-cf-gray-200 rounded-lg px-3 py-2 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-cf-orange transition bg-white";

  return (
    <div className="space-y-4">
      {/* Input row */}
      <div className="bg-cf-orange/5 border border-cf-orange/20 rounded-xl p-5">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2">
            <Calculator size={16} className="text-cf-orange" />
            <p className="text-sm font-semibold text-cf-navy">Monthly Usage Inputs</p>
            {edited && (
              <span className="text-[10px] bg-cf-orange text-white px-2 py-0.5 rounded-full font-semibold">Custom</span>
            )}
          </div>
          {edited && (
            <button
              onClick={reset}
              className="flex items-center gap-1.5 text-xs text-cf-gray-500 hover:text-cf-orange transition"
            >
              <RefreshCw size={11} /> Reset to POC data
            </button>
          )}
        </div>
        <div className="grid grid-cols-3 gap-4">
          {[
            { label: "HTTP Requests", unit: "M / month", value: reqM, setter: setReqM, step: 0.1, hint: "From POC data × 30/days" },
            { label: "Data Transfer", unit: "GB / month", value: gbBw, setter: setGbBw, step: 1, hint: "Total bandwidth served" },
            { label: "DNS Queries",   unit: "M / month", value: dnsM, setter: setDnsM, step: 0.1, hint: "Est. ≈ 1.5× HTTP requests" },
          ].map(({ label, unit, value, setter, step, hint }) => (
            <div key={label}>
              <label className="block text-[10px] font-bold text-cf-gray-500 uppercase tracking-wide mb-1.5">
                {label}
              </label>
              <div className="relative">
                <input
                  type="number"
                  min={0}
                  step={step}
                  value={value}
                  onChange={(e) => {
                    setter(Math.max(0, parseFloat(e.target.value) || 0));
                    setEdited(true);
                  }}
                  className={inputClass}
                />
                <span className="absolute right-3 top-1/2 -translate-y-1/2 text-[10px] text-cf-gray-400 pointer-events-none">
                  {unit}
                </span>
              </div>
              <p className="text-[10px] text-cf-gray-400 mt-1 flex items-center gap-1">
                <Info size={9} /> {hint}
              </p>
            </div>
          ))}
        </div>
      </div>

      {/* Results */}
      <div className="grid grid-cols-3 gap-3">
        {[
          { label: "DNS Cost (AWS)",      value: dnsTotal,  color: "#F6821F", sub: "Route 53" },
          { label: "CDN Cost (AWS)",      value: cdnTotal,  color: "#3B82F6", sub: "CloudFront" },
          { label: "Security Cost (AWS)", value: secTotal,  color: "#DC2626", sub: "WAF + Shield + Bot" },
        ].map(({ label, value, color, sub }) => (
          <div key={label} className="bg-white rounded-xl border border-cf-gray-200 p-4 text-center">
            <p className="text-xs text-cf-gray-500 mb-1">{label}</p>
            <p className="text-2xl font-black" style={{ color }}>{fmt$(value)}</p>
            <p className="text-[10px] text-cf-gray-400 mt-0.5">{sub}</p>
          </div>
        ))}
      </div>

      {/* Grand total */}
      <div className="bg-red-50 border border-red-200 rounded-xl p-5 grid grid-cols-2 gap-4">
        <div>
          <p className="text-xs text-red-600 font-semibold uppercase tracking-wide mb-2">Monthly Bill (AWS)</p>
          <p className="text-3xl font-black text-red-700">
            {fmt$(total)}<span className="text-base font-semibold text-cf-gray-500">/month</span>
          </p>
        </div>
        <div className="border-l border-red-200 pl-4">
          <p className="text-xs text-red-600 font-semibold uppercase tracking-wide mb-2">Yearly Bill (AWS)</p>
          <p className="text-3xl font-black text-red-800">
            {fmt$(total * 12)}<span className="text-base font-semibold text-cf-gray-500">/year</span>
          </p>
          <p className="text-[10px] text-cf-gray-400 mt-1">{fmt$(total)}/mo × 12 months</p>
        </div>
      </div>

      {/* Detailed breakdown table */}
      <div className="bg-white rounded-xl border border-cf-gray-200 overflow-hidden">
        <div className="px-5 py-3 bg-cf-gray-50 border-b border-cf-gray-100">
          <div className="grid grid-cols-12 gap-2 text-[10px] font-bold text-cf-gray-500 uppercase tracking-wide">
            <div className="col-span-3">AWS Service</div>
            <div className="col-span-4 text-cf-gray-400">What it covers</div>
            <div className="col-span-2 text-right">AWS Cost/Mo</div>
            <div className="col-span-3">Cloudflare</div>
          </div>
        </div>

        {costs.map((svc, i) => {
          const catStyle = CATEGORY_LABEL[svc.category];
          return (
            <div key={svc.label}
              className={`px-5 py-3.5 border-b border-cf-gray-100 ${i % 2 === 0 ? "bg-white" : "bg-cf-gray-50/30"}`}>
              <div className="grid grid-cols-12 gap-2 items-start">
                <div className="col-span-3">
                  <div className="flex items-center gap-1.5 mb-0.5">
                    <span className="inline-block w-1.5 h-4 rounded-sm flex-shrink-0"
                      style={{ backgroundColor: catStyle?.color ?? "#9CA3AF" }} />
                    <p className="text-xs font-semibold text-cf-navy leading-tight">{svc.label}</p>
                  </div>
                  <p className="text-[10px] text-cf-gray-400 ml-3 italic leading-tight">{svc.note}</p>
                </div>
                <div className="col-span-4">
                  <p className="text-[11px] text-cf-gray-600">{svc.what}</p>
                </div>
                <div className="col-span-2 text-right">
                  <p className="text-base font-black" style={{ color: catStyle?.color ?? "#DC2626" }}>
                    {fmt$(svc.total)}
                  </p>
                  <p className="text-[9px] text-cf-gray-400">/month</p>
                </div>
                <div className="col-span-3">
                  <span className="inline-block px-2 py-1 bg-green-50 border border-green-200 text-green-700 text-[10px] font-semibold rounded-lg leading-tight">
                    ✓ {svc.cfNote}
                  </span>
                </div>
              </div>
            </div>
          );
        })}

            {/* Total row */}
            <div className="px-5 py-4 bg-red-50 border-t-2 border-red-200 grid grid-cols-12 gap-2 items-center">
              <div className="col-span-7 font-bold text-cf-navy text-sm">Total AWS Stack (DNS + CDN + Security)</div>
              <div className="col-span-2 text-right">
                <p className="text-xl font-black text-red-700">{fmt$(total)}<span className="text-xs font-medium text-cf-gray-500">/mo</span></p>
                <p className="text-xs text-red-600 font-semibold mt-0.5">{fmt$(total * 12)}/year</p>
              </div>
              <div className="col-span-3" />
            </div>
      </div>

      <p className="text-[10px] text-cf-gray-400 flex items-start gap-1.5">
        <Info size={10} className="flex-shrink-0 mt-0.5" />
        AWS pricing based on public rates (2024/2025, us-east-1). CloudFront first 1TB/month free tier not applied.
        Shield Advanced requires 12-month commitment. Actual AWS costs may vary by region and committed use discounts.
      </p>
    </div>
  );
}
