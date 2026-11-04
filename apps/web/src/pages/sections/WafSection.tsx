/**
 * WAF Section — WAF KPIs, stacked bar time-series, split managed/custom rule tables,
 * top countries, top attacked paths.
 */
import { Shield, ShieldCheck, Settings, Gauge, Activity } from "lucide-react";
import { ResponsiveContainer, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Cell } from "recharts";
import type { AppSecData, WafTopRule } from "../../types";
import { formatNumber } from "../../utils/formatters";
import StatCard from "../../components/StatCard";
import SectionHeader from "../../components/SectionHeader";
import StackedBarChart from "../../components/charts/StackedBarChart";
import HorizontalBarChart from "../../components/charts/HorizontalBarChart";
import PieBreakdownChart from "../../components/charts/PieBreakdownChart";

const ATTACK_CAT_COLORS = ["#EF4444","#F97316","#F59E0B","#8B5CF6","#3B82F6","#10B981","#6B7280","#EC4899"];

function WafAttackClassificationChart({ data }: { data: AppSecData }) {
  const cats = (data.wafAttackClassification ?? []).filter((c) => c.count > 0);
  if (cats.length === 0) return null;
  const realTagCount = cats.filter((c) => c.classifiedBy === "cloudflare-tag").reduce((s, c) => s + c.count, 0);
  const totalCount = cats.reduce((s, c) => s + c.count, 0);
  return (
    <div className="mt-6">
      <h3 className="text-sm font-semibold text-cf-navy mb-1">WAF Attack Classification</h3>
      <p className="text-xs text-cf-gray-500 mb-3">
        Block events categorised by attack type
        {realTagCount > 0 && (
          <> · <span className="text-cf-gray-400">{Math.round((realTagCount / Math.max(totalCount, 1)) * 100)}% classified via Cloudflare's own rule tags, remainder via pattern heuristics</span></>
        )}
      </p>
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5 items-start">
        <div className="bg-white rounded-xl shadow-sm border border-cf-gray-200 p-4">
          <ResponsiveContainer width="100%" height={220}>
            <BarChart data={cats.slice(0, 8)} layout="vertical" margin={{ top: 4, right: 16, bottom: 0, left: 120 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#F1F5F9"/>
              <XAxis type="number" tick={{ fontSize: 10 }} tickFormatter={(v) => v >= 1e3 ? `${(v/1e3).toFixed(0)}K` : String(v)}/>
              <YAxis type="category" dataKey="category" tick={{ fontSize: 10 }} width={116}/>
              <Tooltip contentStyle={{ fontSize: 11, borderRadius: 8 }} formatter={(v: number) => formatNumber(v)}/>
              <Bar dataKey="count" radius={[0,4,4,0]}>
                {cats.slice(0,8).map((_, i) => <Cell key={i} fill={ATTACK_CAT_COLORS[i % ATTACK_CAT_COLORS.length]}/>)}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
        {/* Rule effectiveness table */}
        {(data.wafRuleEffectiveness ?? []).length > 0 && (
          <div className="bg-white rounded-xl shadow-sm border border-cf-gray-200 overflow-hidden">
            <div className="px-4 py-3 border-b border-cf-gray-100">
              <h4 className="text-sm font-semibold text-cf-navy">Rule Effectiveness</h4>
              <p className="text-[10px] text-cf-gray-500 mt-0.5">Block rate per WAF rule (block / total events)</p>
            </div>
            <div className="overflow-y-auto" style={{ maxHeight: 220 }}>
              <table className="w-full text-xs">
                <thead className="sticky top-0">
                  <tr className="bg-cf-gray-50 text-cf-gray-500 uppercase tracking-wide text-[10px]">
                    <th className="px-3 py-2 text-left font-semibold">Rule</th>
                    <th className="px-3 py-2 text-right font-semibold">Hits</th>
                    <th className="px-3 py-2 text-right font-semibold">Block%</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-cf-gray-100">
                  {(data.wafRuleEffectiveness ?? []).slice(0, 10).map((r, i) => (
                    <tr key={r.ruleId} className={i % 2 === 0 ? "bg-white" : "bg-cf-gray-50/40"}>
                      <td className="px-3 py-1.5">
                        <div className="font-medium text-cf-navy text-[11px]">{r.description?.slice(0, 30) || r.ruleId.slice(0, 12)}</div>
                      </td>
                      <td className="px-3 py-1.5 text-right font-mono text-cf-gray-600 text-[11px]">{formatNumber(r.totalHits)}</td>
                      <td className="px-3 py-1.5 text-right font-mono font-bold text-[11px]"
                        style={{ color: r.blockRate >= 80 ? "#EF4444" : r.blockRate >= 50 ? "#F59E0B" : "#10B981" }}>
                        {r.blockRate}%
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

// ─── Color palette ───────────────────────────────────────────────────────────
const WAF_COLORS = {
  block: "#DC2626",
  challenge: "#F59E0B",
  managed_challenge: "#D97706",
  log: "#3B82F6",
  skip: "#6B7280",
};

const ACTION_STYLE: Record<string, string> = {
  block: "bg-red-100 text-red-800 border-red-300",
  managed_challenge: "bg-amber-50 text-amber-700 border-amber-200",
  challenge: "bg-yellow-50 text-yellow-700 border-yellow-200",
  log: "bg-blue-50 text-blue-700 border-blue-200",
  skip: "bg-gray-50 text-gray-600 border-gray-200",
};

// ─── Reusable rule table ─────────────────────────────────────────────────────
function RuleTable({
  rules,
  showRuleset,
}: {
  rules: WafTopRule[];
  showRuleset: boolean;
}) {
  if (rules.length === 0) return null;
  return (
    <div className="overflow-x-auto overflow-y-auto" style={{ maxHeight: 360 }}>
      <table className="w-full text-xs">
        <thead className="sticky top-0">
          <tr className="bg-cf-gray-50 text-cf-gray-500 uppercase tracking-wide text-[10px]">
            <th className="px-4 py-2.5 text-left font-semibold w-8">#</th>
            <th className="px-4 py-2.5 text-left font-semibold">Rule Name / Description</th>
            <th className="px-4 py-2.5 text-left font-semibold">Action</th>
            <th className="px-4 py-2.5 text-right font-semibold">Events</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-cf-gray-100">
          {rules.map((r, i) => (
            <tr key={`${r.ruleId}-${i}`} className={i % 2 === 0 ? "bg-white" : "bg-cf-gray-50/40"}>
              <td className="px-4 py-2.5 text-cf-gray-400 font-mono">{i + 1}</td>
              <td className="px-4 py-2.5">
                <div className="font-medium text-cf-navy">
                  {r.ruleName ?? r.description ?? "Unnamed Rule"}
                </div>
                <div className="text-[10px] text-cf-gray-400 font-mono mt-0.5">
                  ID: {r.ruleId}
                  {showRuleset && r.rulesetId && (
                    <span className="ml-2">Ruleset: {r.rulesetId.slice(0, 12)}...</span>
                  )}
                </div>
              </td>
              <td className="px-4 py-2.5">
                <span className={`inline-block px-2 py-0.5 rounded-full text-[10px] font-semibold border ${ACTION_STYLE[r.action] ?? ACTION_STYLE.skip}`}>
                  {r.action}
                </span>
              </td>
              <td className="px-4 py-2.5 text-right font-mono font-bold text-cf-navy">
                {formatNumber(r.count)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export default function WafSection({ data }: { data: AppSecData }) {
  const { wafTimeSeries, wafTopRules, wafTopCountries, wafTopPaths, wafManagedRules } = data;

  // Total = ALL actions (block + challenge + managed_challenge + log + skip)
  const totalWafEvents = wafTimeSeries.reduce(
    (s, d) => s + d.block + d.challenge + d.managed_challenge + (d.log ?? 0) + (d.skip ?? 0), 0,
  );
  const totalBlocked = wafTimeSeries.reduce((s, d) => s + d.block, 0);
  const totalChallenged = wafTimeSeries.reduce((s, d) => s + d.challenge + d.managed_challenge, 0);
  const totalSkipped = wafTimeSeries.reduce((s, d) => s + (d.skip ?? 0), 0);
  const totalLogged = wafTimeSeries.reduce((s, d) => s + (d.log ?? 0), 0);

  // WAF stacked bar series
  const wafSeries = [
    { key: "block", label: "Block", color: WAF_COLORS.block },
    { key: "managed_challenge", label: "Managed Challenge", color: WAF_COLORS.managed_challenge },
    { key: "challenge", label: "Challenge", color: WAF_COLORS.challenge },
    { key: "log", label: "Log", color: WAF_COLORS.log },
    { key: "skip", label: "Skip", color: WAF_COLORS.skip },
  ];

  // ── Split rules by source ─────────────────────────────────────────────────
  const managedRules = wafTopRules.filter((r) => r.source === "firewallManaged");
  const customRules = wafTopRules.filter((r) => r.source === "firewallCustom");

  const managedEvents = managedRules.reduce((s, r) => s + r.count, 0);
  const customEvents = customRules.reduce((s, r) => s + r.count, 0);

  // WAF Attack Score breakdown
  const attackScoreRows = data.wafAttackScoreBreakdown ?? [];
  const attackScoreTotal = attackScoreRows.reduce((s, r) => s + r.count, 0);

  // Aggregate score classes for summary display
  const scoreClassAgg = new Map<string, { count: number; actions: Map<string, number> }>();
  for (const row of attackScoreRows) {
    const existing = scoreClassAgg.get(row.scoreClass);
    if (existing) {
      existing.count += row.count;
      existing.actions.set(row.action, (existing.actions.get(row.action) ?? 0) + row.count);
    } else {
      const actions = new Map<string, number>();
      actions.set(row.action, row.count);
      scoreClassAgg.set(row.scoreClass, { count: row.count, actions });
    }
  }

  // Score ranges per Cloudflare docs:
  // cf.waf.score 1-99 (1 = almost certainly malicious, 99 = likely clean)
  const SCORE_CLASS_META: Record<string, { label: string; desc: string; scoreRange: string; color: string; bgColor: string }> = {
    attack: {
      label: "Attack",
      scoreRange: "Score 1-20",
      desc: "Almost certainly malicious — ML model high confidence",
      color: "text-red-700",
      bgColor: "bg-red-50 border-red-200",
    },
    likely_attack: {
      label: "Likely Attack",
      scoreRange: "Score 21-50",
      desc: "Probable malicious intent — may include fuzzing/evasion attempts",
      color: "text-orange-700",
      bgColor: "bg-orange-50 border-orange-200",
    },
    likely_clean: {
      label: "Likely Clean",
      scoreRange: "Score 51-80",
      desc: "Low suspicion — flagged but likely legitimate traffic",
      color: "text-yellow-700",
      bgColor: "bg-yellow-50 border-yellow-200",
    },
  };

  const wafCountryBar = wafTopCountries.map((c) => ({
    name: c.countryName,
    value: c.count,
  }));

  const wafPathBar = wafTopPaths.map((p) => ({
    name: p.url ?? p.path,
    value: p.count,
  }));

  return (
    <div className="report-section">
      <SectionHeader
        title="WAF & Firewall Events"
        subtitle="Web Application Firewall events and rule activity"
        icon={<Shield size={18} />}
        printBreak
      />

      {/* WAF KPI row */}
      <div className="grid grid-cols-2 lg:grid-cols-5 gap-4 mb-4">
        <StatCard
          title="WAF Events"
          value={formatNumber(totalWafEvents)}
          subtitle={`All actions (${data.meta?.periodLabel ?? "30-Day"} period)`}
          color="orange"
        />
        <StatCard
          title="Blocked"
          value={formatNumber(totalBlocked)}
          subtitle="Hard block action"
          color="red"
        />
        <StatCard
          title="Challenged"
          value={formatNumber(totalChallenged)}
          subtitle="Managed / JS challenge"
          color="purple"
        />
        <StatCard
          title="Skipped"
          value={formatNumber(totalSkipped)}
          subtitle={`Logged: ${formatNumber(totalLogged)}`}
          color="teal"
        />
        <StatCard
          title="Active Rulesets"
          value={wafManagedRules.filter((r) => r.enabled).length}
          subtitle={`of ${wafManagedRules.length} rulesets`}
          color="teal"
        />
      </div>

      {/* WAF time-series stacked bar */}
      <div className="mb-4">
        <StackedBarChart
          data={wafTimeSeries}
          series={wafSeries}
          title="WAF Events by Action — Daily"
          subtitle="Daily breakdown of WAF actions (block, challenge, log, skip)"
          height={240}
        />
      </div>

      {/* ── 1. Custom Rules ─────────────────────────────────────────────── */}
      {customRules.length > 0 && (
        <div className="mt-4 bg-white rounded-xl shadow-sm border border-cf-gray-200 overflow-hidden">
          <div className="px-5 py-4 border-b border-cf-gray-100 flex items-center gap-3">
            <div className="w-8 h-8 bg-orange-50 rounded-lg flex items-center justify-center">
              <Settings size={16} className="text-cf-orange" />
            </div>
            <div className="flex-1">
              <h3 className="text-sm font-semibold text-cf-navy">Custom Rules</h3>
              <p className="text-xs text-cf-gray-500 mt-0.5">
                User-defined WAF custom rules and firewall expressions
              </p>
            </div>
            <div className="text-right">
              <p className="text-lg font-bold text-cf-navy">{formatNumber(customEvents)}</p>
              <p className="text-[10px] text-cf-gray-400">events</p>
            </div>
          </div>
          <RuleTable rules={customRules} showRuleset={false} />
        </div>
      )}

      {/* ── 2. Managed Rulesets ────────────────────────────────────────────── */}
      {managedRules.length > 0 && (
        <div className="mt-4 bg-white rounded-xl shadow-sm border border-cf-gray-200 overflow-hidden">
          <div className="px-5 py-4 border-b border-cf-gray-100 flex items-center gap-3">
            <div className="w-8 h-8 bg-blue-50 rounded-lg flex items-center justify-center">
              <ShieldCheck size={16} className="text-blue-600" />
            </div>
            <div className="flex-1">
              <h3 className="text-sm font-semibold text-cf-navy">Managed Rulesets</h3>
              <p className="text-xs text-cf-gray-500 mt-0.5">
                Cloudflare-managed rulesets — OWASP Core, Cloudflare Managed, Leaked Credentials, etc.
              </p>
            </div>
            <div className="text-right">
              <p className="text-lg font-bold text-cf-navy">{formatNumber(managedEvents)}</p>
              <p className="text-[10px] text-cf-gray-400">events</p>
            </div>
          </div>
          <RuleTable rules={managedRules} showRuleset />
        </div>
      )}

      {/* ── 3. WAF Attack Score ────────────────────────────────────────────── */}
      {attackScoreRows.length > 0 && (
        <div className="mt-4 bg-white rounded-xl shadow-sm border border-cf-gray-200 overflow-hidden">
          <div className="px-5 py-4 border-b border-cf-gray-100 flex items-center gap-3">
            <div className="w-8 h-8 bg-red-50 rounded-lg flex items-center justify-center">
              <Gauge size={16} className="text-red-600" />
            </div>
            <div className="flex-1">
              <h3 className="text-sm font-semibold text-cf-navy">WAF Attack Score (ML Detection)</h3>
              <p className="text-xs text-cf-gray-500 mt-0.5">
                Machine learning model scores each request 1-99 (1 = malicious, 99 = clean). Complements Managed Rules by detecting evasion/fuzzing variants.
              </p>
            </div>
            <div className="text-right">
              <p className="text-lg font-bold text-cf-navy">{formatNumber(attackScoreTotal)}</p>
              <p className="text-[10px] text-cf-gray-400">events</p>
            </div>
          </div>

          {/* Score class cards */}
          <div className="px-5 py-4 grid grid-cols-1 sm:grid-cols-3 gap-3">
            {(["attack", "likely_attack", "likely_clean"] as const).map((cls) => {
              const meta = SCORE_CLASS_META[cls];
              const agg = scoreClassAgg.get(cls);
              if (!agg || !meta) return null;
              const actions = Array.from(agg.actions.entries()).sort((a, b) => b[1] - a[1]);
              return (
                <div key={cls} className={`rounded-lg border p-3 ${meta.bgColor}`}>
                  <div className="flex items-center justify-between">
                    <p className={`text-xs font-semibold ${meta.color}`}>{meta.label}</p>
                    <span className="text-[10px] font-mono text-cf-gray-400">{meta.scoreRange}</span>
                  </div>
                  <p className="text-[10px] text-cf-gray-500 mt-0.5">{meta.desc}</p>
                  <p className={`text-xl font-bold mt-2 ${meta.color}`}>{formatNumber(agg.count)}</p>
                  <div className="mt-2 space-y-1">
                    {actions.map(([action, count]) => (
                      <div key={action} className="flex items-center justify-between text-[10px]">
                        <span className={`inline-block px-1.5 py-0.5 rounded-full font-medium border ${ACTION_STYLE[action] ?? ACTION_STYLE.skip}`}>
                          {action}
                        </span>
                        <span className="font-mono font-semibold text-cf-gray-700">
                          {formatNumber(count)}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              );
            })}
          </div>

          {/* Detail table */}
          <div className="border-t border-cf-gray-100">
            <table className="w-full text-xs">
              <thead>
                <tr className="bg-cf-gray-50 text-cf-gray-500 uppercase tracking-wide text-[10px]">
                  <th className="px-4 py-2.5 text-left font-semibold">Score Class</th>
                  <th className="px-4 py-2.5 text-left font-semibold">Action</th>
                  <th className="px-4 py-2.5 text-right font-semibold">Events</th>
                  <th className="px-4 py-2.5 text-right font-semibold">% of Total</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-cf-gray-100">
                {attackScoreRows.map((r, i) => {
                  const meta = SCORE_CLASS_META[r.scoreClass];
                  const pct = attackScoreTotal > 0
                    ? ((r.count / attackScoreTotal) * 100).toFixed(1)
                    : "0.0";
                  return (
                    <tr key={`${r.scoreClass}-${r.action}-${i}`} className={i % 2 === 0 ? "bg-white" : "bg-cf-gray-50/40"}>
                      <td className="px-4 py-2.5">
                        <span className={`font-semibold ${meta?.color ?? "text-cf-gray-600"}`}>
                          {meta?.label ?? r.scoreClass}
                        </span>
                        {meta?.scoreRange && (
                          <span className="block text-[10px] text-cf-gray-400 font-mono">{meta.scoreRange}</span>
                        )}
                      </td>
                      <td className="px-4 py-2.5">
                        <span className={`inline-block px-2 py-0.5 rounded-full text-[10px] font-semibold border ${ACTION_STYLE[r.action] ?? ACTION_STYLE.skip}`}>
                          {r.action}
                        </span>
                      </td>
                      <td className="px-4 py-2.5 text-right font-mono font-bold text-cf-navy">
                        {formatNumber(r.count)}
                      </td>
                      <td className="px-4 py-2.5 text-right">
                        <div className="flex items-center justify-end gap-2">
                          <div className="w-16 bg-cf-gray-100 rounded-full h-1.5 overflow-hidden">
                            <div
                              className="h-full bg-red-400 rounded-full"
                              style={{ width: `${Math.min(parseFloat(pct), 100)}%` }}
                            />
                          </div>
                          <span className="text-cf-gray-600 w-10 text-right">{pct}%</span>
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

      {/* ── Top attack countries + paths ───────────────────────────────────── */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 mt-4">
        <HorizontalBarChart
          data={wafCountryBar}
          title="Top Attack Source Countries"
          subtitle="Countries with most WAF events blocked"
          color="#EF4444"
        />
        {wafPathBar.length > 0 && (
          <HorizontalBarChart
            data={wafPathBar}
            title="Top Attacked URLs"
            subtitle="Most targeted host + path combinations"
            color="#8B5CF6"
          />
        )}
      </div>

      {/* ── WAF Attack Score — All Traffic ─────────────────────────────── */}
      {(() => {
        const scoreAllTraffic = data.wafAttackScoreBreakdown ?? [];
        // Also use all-traffic score if available
        const allTraffic = data.wafScoreAllTraffic ?? [];
        const source = allTraffic.length > 0 ? allTraffic : scoreAllTraffic.map((r) => ({
          scoreClass: r.scoreClass,
          count: r.count,
        }));
        if (!source.length) return null;

        const SCORE_CONFIG: Record<string, { label: string; range: string; color: string }> = {
          attack:        { label: "Attack",        range: "1–20",  color: "#DC2626" },
          likely_attack: { label: "Likely Attack", range: "21–50", color: "#F97316" },
          likely_clean:  { label: "Likely Clean",  range: "51–80", color: "#EAB308" },
          clean:         { label: "Clean",         range: "81–99", color: "#16A34A" },
        };

        const totalScored = source.reduce((s, r) => s + r.count, 0);
        const pieData = source
          .filter((r) => SCORE_CONFIG[r.scoreClass])
          .map((r) => ({
            name: `${SCORE_CONFIG[r.scoreClass]?.label} (${SCORE_CONFIG[r.scoreClass]?.range})`,
            value: r.count,
          }));
        const pieColors = source
          .filter((r) => SCORE_CONFIG[r.scoreClass])
          .map((r) => SCORE_CONFIG[r.scoreClass]?.color ?? "#9CA3AF");
        const attackCount = source
          .filter((r) => r.scoreClass === "attack" || r.scoreClass === "likely_attack")
          .reduce((s, r) => s + r.count, 0);

        return (
          <div className="mt-4 bg-white rounded-xl shadow-sm border border-cf-gray-200 overflow-hidden">
            <div className="px-5 py-4 border-b border-cf-gray-100 flex items-center gap-3">
              <div className="w-8 h-8 bg-red-50 rounded-lg flex items-center justify-center">
                <Gauge size={16} className="text-red-600" />
              </div>
              <div>
                <h3 className="text-sm font-semibold text-cf-navy">WAF Attack Score — All Incoming Traffic</h3>
                <p className="text-xs text-cf-gray-500 mt-0.5">
                  ML model scores every request 1–99. Detects evasion and fuzzing beyond explicit rule signatures.
                </p>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-0 divide-x divide-cf-gray-100">
              <div className="p-4">
                {pieData.length > 0 && (
                  <PieBreakdownChart
                    data={pieData}
                    title="Score Class Distribution"
                    subtitle={`All requests — ${data.meta?.periodLabel ?? "30-Day"} period`}
                    colors={pieColors}
                    height={240}
                    innerRadius={50}
                  />
                )}
              </div>
              <div className="p-4">
                <p className="text-xs font-semibold text-cf-gray-500 uppercase tracking-wide mb-3">Score Breakdown</p>
                <div className="space-y-3">
                  {source.map((r) => {
                    const cfg = SCORE_CONFIG[r.scoreClass];
                    if (!cfg) return null;
                    const pct = totalScored > 0 ? ((r.count / totalScored) * 100).toFixed(1) : "0";
                    return (
                      <div key={r.scoreClass}>
                        <div className="flex items-center justify-between mb-1">
                          <div>
                            <span className="text-xs font-semibold text-cf-navy">{cfg.label}</span>
                            <span className="text-[10px] text-cf-gray-400 font-mono ml-2">Score {cfg.range}</span>
                          </div>
                          <div className="text-right">
                            <span className="text-xs font-bold text-cf-navy">{formatNumber(r.count)}</span>
                            <span className="text-[10px] text-cf-gray-400 ml-1">({pct}%)</span>
                          </div>
                        </div>
                        <div className="w-full bg-cf-gray-100 rounded-full h-1.5 overflow-hidden">
                          <div className="h-full rounded-full" style={{ width: `${pct}%`, backgroundColor: cfg.color }} />
                        </div>
                      </div>
                    );
                  })}
                </div>
                {attackCount > 0 && (
                  <div className="mt-4 p-3 bg-red-50 border border-red-200 rounded-lg">
                    <p className="text-xs font-semibold text-red-700">
                      {formatNumber(attackCount)} requests scored as Attack or Likely Attack
                    </p>
                    <p className="text-[10px] text-red-600 mt-0.5">
                      ML-detected threats that complement your WAF managed rules — including fuzzing and payload evasion.
                    </p>
                  </div>
                )}
              </div>
            </div>
          </div>
        );
      })()}
      {/* WAF Attack Classification + Rule Effectiveness */}
      <WafAttackClassificationChart data={data} />
    </div>
  );
}
