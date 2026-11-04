/**
 * SecurityScoreSection — radar chart showing security posture across 6 dimensions.
 * Also shows a request lifecycle funnel (total → cached → origin → blocked).
 */
import { ShieldCheck } from "lucide-react";
import type { AppSecData } from "../../types";
import { formatNumber } from "../../utils/formatters";
import SectionHeader from "../../components/SectionHeader";
import SecurityRadarChart from "../../components/charts/SecurityRadarChart";
import SankeyFlowChart from "../../components/charts/SankeyFlowChart";

interface Props { data: AppSecData }

function clamp(v: number, min = 0, max = 100) { return Math.min(max, Math.max(min, v)); }

export default function SecurityScoreSection({ data }: Props) {
  const ap = data as AppSecData & Record<string, unknown>;
  const summary = data.summary as unknown as Record<string, number>;

  // ── Compute radar dimensions ──────────────────────────────────────────────

  // 1. WAF coverage (0-100): based on managed rules enabled + top rules firing
  const wafRules = data.wafManagedRules ?? [];
  const enabledWaf = wafRules.filter((r) => r.enabled).length;
  const wafScore = clamp(
    (enabledWaf > 0 ? 50 : 0) +
    ((ap["tls13Enabled"] as boolean) ? 10 : 0) +
    (data.wafTopRules.length > 0 ? 20 : 0) +
    ((ap["alwaysHttps"] as boolean) ? 20 : 0)
  );

  // 2. DDoS protection score — based on PROTECTION DEPTH, not attack volume.
  //    Zero DDoS events is GOOD (protection is working, attackers didn't succeed).
  //    Score is driven by how much DDoS protection is configured and active.
  const ddosMitigated = data.ddosTimeSeries.reduce((s, d) => s + d.mitigated, 0);
  const allSettings = ap["zoneSettings"] as Record<string, unknown> | undefined ?? {};
  const advancedDdos = allSettings["advanced_ddos"] === "on";
  const ddosScore = clamp(
    60 +                                   // base: Cloudflare always-on L3/L4/L7 DDoS protection for ALL zones
    (enabledWaf > 0 ? 15 : 0) +           // WAF managed rules deployed = additional L7 protection
    (advancedDdos ? 15 : 0) +             // Advanced DDoS ruleset active (Enterprise/Business)
    (ddosMitigated > 0 ? 10 : 0)          // Bonus: active mitigation observed (optional — not penalised if zero attacks)
  );

  // 3. Bot management: based on bot score data + config
  const botMgmt = (ap["botManagementConfig"] as Record<string, boolean> | null);
  // Robust numeric field, not scoreRange string-matching (real bucket
  // labels never contain the substring being searched for once Bot
  // Management is actually active — see fetch-appsec.ts's botTrafficPct comment).
  // `humanPct` is always a real computed number server-side (defaults to
  // 100 when Bot Management has no scored data — see fetch-appsec.ts) — the
  // `?? 100` here only guards against an unexpected missing field, matching
  // that same server-side default rather than an inconsistent placeholder.
  const humanPct = data.summary.humanPct ?? 100;
  const botScore = clamp(
    (botMgmt?.enable_js ? 40 : 20) +
    (botMgmt?.using_latest_model ? 20 : 0) +
    (humanPct > 70 ? 20 : 10) +
    (data.botScoreBreakdown.length > 0 ? 20 : 0)
  );

  // 4. Cache / CDN: based on cache hit rate
  const cacheHit = summary["cacheHitRatePct"] ?? 0;
  const cacheScore = clamp(Math.round(cacheHit * 0.8) + (cacheHit > 70 ? 20 : 0));

  // 5. TLS / Encryption: based on TLS version, cipher suites, certificates
  const cipherSuites = (ap["cipherSuites"] as string[] | undefined) ?? [];
  const strongCiphers = cipherSuites.filter((c) => c.includes("CHACHA20") || c.includes("AES256")).length;
  const expiringSoon = data.certificates.filter((c) => c.daysUntilExpiry >= 0 && c.daysUntilExpiry < 30).length;
  const tlsScore = clamp(
    ((ap["tls13Enabled"] as boolean) ? 40 : 20) +
    ((ap["alwaysHttps"] as boolean) ? 20 : 0) +
    (strongCiphers > 0 ? 20 : 0) +
    (expiringSoon === 0 ? 20 : 0)
  );

  // 6. Email security: based on DMARC/SPF/DKIM grade.
  // When email security data is unavailable, EXCLUDE this dimension from
  // the radar/overall score entirely rather than fabricating a placeholder
  // score for it — a fictional "30" here would silently pull down (or, for
  // a different placeholder, inflate) the overall composite score based on
  // data that doesn't exist.
  const email = ap["emailSecurity"] as { grade: string } | null | undefined;
  const emailScoreMap: Record<string, number> = { A: 95, B: 75, C: 55, D: 35, F: 15 };
  const emailScore = email ? (emailScoreMap[email.grade] ?? null) : null;

  const radarData = [
    { subject: "WAF",          score: wafScore,   fullMark: 100, description: `${enabledWaf} rulesets enabled, Always HTTPS: ${ap["alwaysHttps"] ? "Yes" : "No"}` },
    { subject: "DDoS",         score: ddosScore,  fullMark: 100, description: ddosMitigated > 0 ? `${ddosMitigated.toLocaleString()} events mitigated` : "Always-on protection active" },
    { subject: "Bot Mgmt",     score: botScore,   fullMark: 100, description: `${humanPct}% human traffic` },
    { subject: "CDN/Cache",    score: cacheScore, fullMark: 100, description: `${cacheHit}% cache hit rate` },
    { subject: "TLS/Crypto",   score: tlsScore,   fullMark: 100, description: `TLS 1.3: ${ap["tls13Enabled"] ? "Yes" : "No"}, ${strongCiphers} strong ciphers` },
    ...(emailScore != null
      ? [{ subject: "Email Auth", score: emailScore, fullMark: 100, description: `Grade: ${email?.grade ?? "N/A"}` }]
      : []),
  ];

  const overallScore = Math.round(radarData.reduce((s, d) => s + d.score, 0) / radarData.length);

  // ── Sankey: Correct flow — Total → Blocked/Allowed → Cache/Origin ────────
  //
  // Flow logic:
  //   Total Requests
  //     ├─► Blocked (WAF + DDoS + Bot + RateLimit) — never reaches cache/origin
  //     └─► Allowed
  //           ├─► Cache Hit  — served from edge, no origin contact
  //           └─► Cache Miss — passed to origin
  //
  // IMPORTANT: Use `totalThreats` from httpRequests1dGroups (same dataset as totalRequests)
  // NOT totalThreatsBlocked (which sums WAF + DDoS firewall events — sampled, different dataset).
  // Using sampled firewall event counts against exact httpRequests1dGroups totals causes
  // Blocked to appear larger than Total Requests (the bug shown in the screenshot).
  //
  // `threats` from httpRequests1dGroups.sum = number of requests that triggered a security rule.
  // This is from the SAME dataset as totalRequests, so percentages are always consistent.
  const totalReqs = summary["totalRequests"] ?? 0;
  // Use the threats field from httpRequests1dGroups as the blocked count — same datasource as totalRequests
  const totalThreatsFromSameSource = summary["totalThreats"] ?? 0;
  // Fallback: if threats field is 0, use WAF blocked but cap at 95% of total (sanity check)
  const totalBlockedRaw = summary["totalThreatsBlocked"] ?? 0;
  const totalBlocked = totalThreatsFromSameSource > 0
    ? totalThreatsFromSameSource
    : Math.min(totalBlockedRaw, Math.round(totalReqs * 0.95));
  const allowedReqs  = Math.max(0, totalReqs - totalBlocked);
  const cachedReqs   = Math.round((summary["cacheHitRatePct"] ?? 0) / 100 * allowedReqs);
  const originReqs   = Math.max(0, allowedReqs - cachedReqs);

  // Split blocked by service for detail layer.
  // Use securityEventsByService for proportional breakdown ONLY — not absolute counts.
  // The service event counts are sampled and may not match totalBlocked exactly.
  // We scale them proportionally so they sum to totalBlocked (consistent with totalRequests).
  const secEvents = (ap["securityEventsByService"] as Array<{ source: string; action: string; count: number }> | undefined) ?? [];
  const bySource = new Map<string, number>();
  for (const e of secEvents) {
    // Only count blocking actions (exclude log/skip/allow which don't reduce allowed traffic)
    if (["block", "challenge", "managed_challenge", "jschallenge", "drop"].includes(e.action)) {
      bySource.set(e.source, (bySource.get(e.source) ?? 0) + e.count);
    }
  }

  const rawWaf  = (bySource.get("firewallManaged") ?? 0) + (bySource.get("firewallCustom") ?? 0);
  const rawDdos = bySource.get("l7ddos") ?? 0;
  const rawBot  = bySource.get("botManagement") ?? 0;
  const rawRl   = bySource.get("firewallRateLimit") ?? 0;
  const rawTotal = rawWaf + rawDdos + rawBot + rawRl;

  // Scale proportionally so breakdown sums to totalBlocked (fixes cross-dataset mismatch)
  const scale = rawTotal > 0 && totalBlocked > 0 ? totalBlocked / rawTotal : 0;
  const wafBlocked  = scale > 0 ? Math.round(rawWaf  * scale) : totalBlocked;
  const ddosBlocked = scale > 0 ? Math.round(rawDdos * scale) : 0;
  const botBlocked  = scale > 0 ? Math.round(rawBot  * scale) : 0;
  const rlBlocked   = scale > 0 ? Math.round(rawRl   * scale) : 0;
  // No "other" needed — proportional scaling absorbs the difference
  const otherBlocked = 0;
  const hasServiceBreakdown = secEvents.length > 0 && rawTotal > 0;

  // Node definitions — indices must stay stable
  const NODES = [
    { name: "Total Requests", color: "#3B82F6" },   // 0  layer 0
    { name: "Blocked",        color: "#DC2626" },   // 1  Blocked = dark red
    { name: "Allowed",        color: "#16A34A" },   // 2  Allowed = green
    { name: "WAF Blocked",    color: "#DC2626" },   // 3  WAF = dark red
    { name: "DDoS Mitigated", color: "#991B1B" },   // 4  DDoS = darkest red
    { name: "Bot Blocked",    color: "#6D28D9" },   // 5  Bot = dark purple
    { name: "Rate Limited",   color: "#7C3AED" },   // 6  Rate limit = purple
    { name: "Other Blocked",  color: "#B45309" },   // 7  Other = dark amber
    { name: "Cache Hit",      color: "#16A34A" },   // 8  Cache Hit = green
    { name: "Cache Miss",     color: "#D97706" },   // 9  Cache Miss = amber
  ];

  const links: { source: number; target: number; value: number }[] = [];
  const addLink = (src: number, tgt: number, val: number) => {
    if (val > 0) links.push({ source: src, target: tgt, value: val });
  };

  // Layer 0 → Layer 1
  if (totalBlocked > 0) addLink(0, 1, totalBlocked);
  if (allowedReqs  > 0) addLink(0, 2, allowedReqs);

  // Layer 1 (Blocked) → Layer 2 (security services)
  if (hasServiceBreakdown) {
    addLink(1, 3, wafBlocked);
    addLink(1, 4, ddosBlocked);
    addLink(1, 5, botBlocked);
    addLink(1, 6, rlBlocked);
    if (otherBlocked > 0) addLink(1, 7, otherBlocked);
  }
  // If no service breakdown, don't fan out — Blocked is a leaf

  // Layer 1 (Allowed) → Layer 2 (cache outcome)
  if (cachedReqs > 0) addLink(2, 8, cachedReqs);
  if (originReqs > 0) addLink(2, 9, originReqs);

  // Filter to only nodes actually used in links, then re-index sequentially
  const usedNodeIds = new Set(links.flatMap((l) => [l.source, l.target]));

  // Build compact index: old index → new sequential index
  const nodeIndexMap = new Map<number, number>();
  let newIdx = 0;
  NODES.forEach((_, i) => {
    if (usedNodeIds.has(i)) {
      nodeIndexMap.set(i, newIdx);
      newIdx++;
    }
  });

  const filteredNodes = NODES.filter((_, i) => usedNodeIds.has(i));

  // Re-map all link source/target to new indices
  const reindexedLinks = links
    .filter((l) => nodeIndexMap.has(l.source) && nodeIndexMap.has(l.target))
    .map((l) => ({
      source: nodeIndexMap.get(l.source)!,
      target: nodeIndexMap.get(l.target)!,
      value: l.value,
    }));

  const sankeyData = { nodes: filteredNodes, links: reindexedLinks };

  return (
    <section className="report-section">
      <SectionHeader
        icon={<ShieldCheck size={20} />}
        title="Security Posture Score"
        subtitle="Radar overview of security strength across 6 dimensions + request lifecycle funnel"
        printBreak
      />

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Radar chart + overall score */}
        <div className="relative">
          <SecurityRadarChart
            data={radarData}
            title="Security Posture Radar"
            subtitle="Score 0-100 across WAF, DDoS, Bot, CDN, TLS, Email"
            height={310}
          />
          {/* Overall score badge */}
          <div className="absolute top-5 right-5">
            <div className={`w-16 h-16 rounded-full border-4 flex flex-col items-center justify-center shadow-sm ${
              overallScore >= 80 ? "border-green-400 bg-green-50" :
              overallScore >= 60 ? "border-yellow-400 bg-yellow-50" :
              "border-red-400 bg-red-50"
            }`}>
              <span className={`text-xl font-black ${
                overallScore >= 80 ? "text-green-700" :
                overallScore >= 60 ? "text-yellow-700" : "text-red-700"
              }`}>{overallScore}</span>
              <span className="text-[8px] text-cf-gray-500 font-semibold">/100</span>
            </div>
          </div>
        </div>

        {/* Per-dimension breakdown table */}
        <div className="bg-white rounded-xl shadow-sm border border-cf-gray-200 p-5">
          <h3 className="text-sm font-semibold text-cf-navy mb-4">Dimension Scores</h3>
          <div className="space-y-3">
            {radarData.map((d) => {
              const pct = d.score;
              const color = pct >= 80 ? "#10B981" : pct >= 60 ? "#F6821F" : "#EF4444";
              const label = pct >= 80 ? "Strong" : pct >= 60 ? "Moderate" : pct >= 40 ? "Weak" : "Critical";
              return (
                <div key={d.subject}>
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-xs font-semibold text-cf-navy">{d.subject}</span>
                    <div className="flex items-center gap-2">
                      <span className="text-[10px] text-cf-gray-400">{d.description}</span>
                      <span className="text-xs font-bold" style={{ color }}>{pct}/100</span>
                      <span className="text-[10px] px-1.5 py-0.5 rounded-full font-semibold border"
                        style={{ color, backgroundColor: color + "15", borderColor: color + "40" }}>
                        {label}
                      </span>
                    </div>
                  </div>
                  <div className="w-full bg-cf-gray-100 rounded-full h-2 overflow-hidden">
                    <div className="h-full rounded-full transition-all"
                      style={{ width: `${pct}%`, backgroundColor: color }} />
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>

      {/* ── Scoring Methodology ──────────────────────────────────────────── */}
      <div className="bg-cf-gray-50 rounded-xl border border-cf-gray-200 px-5 py-4">
        <h3 className="text-xs font-bold text-cf-navy uppercase tracking-wide mb-3">
          How this score is calculated
        </h3>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-x-6 gap-y-3 text-[11px] text-cf-gray-600 leading-snug">
          {[
            {
              dimension: "WAF",
              color: "#3B82F6",
              how: "Managed rulesets deployed (+50), WAF events detected (+20), Always HTTPS enforced (+20), TLS 1.3 enabled (+10)",
              max: 100,
            },
            {
              dimension: "DDoS",
              color: "#EF4444",
              how: "All zones get baseline always-on L3/L4/L7 protection (+60). WAF rulesets add L7 depth (+15), Advanced DDoS ruleset active (+15), active mitigation observed (+10)",
              max: 100,
            },
            {
              dimension: "Bot Management",
              color: "#8B5CF6",
              how: "JS fingerprinting enabled (+40 vs +20 without), latest ML model in use (+20), >70% human traffic (+20), bot score data present (+20)",
              max: 100,
            },
            {
              dimension: "CDN / Cache",
              color: "#F6821F",
              how: "Request cache hit rate × 0.8, plus a +20 bonus if hit rate exceeds 70%. Higher cache hit = more origin offload = better resilience",
              max: 100,
            },
            {
              dimension: "TLS / Crypto",
              color: "#10B981",
              how: "TLS 1.3 enabled (+40 vs +20), Always HTTPS enforced (+20), strong ciphers (AES-256/CHACHA20) in use (+20), no certificates expiring within 30 days (+20)",
              max: 100,
            },
            {
              dimension: "Email Auth",
              color: "#D97706",
              how: "Based on DMARC + SPF + DKIM posture grade: A=95, B=75, C=55, D=35, F=15. Grade reflects how well the domain is protected against email spoofing",
              max: 100,
            },
          ].map((item) => (
            <div key={item.dimension} className="flex gap-2">
              <span
                className="w-2 h-2 rounded-full flex-shrink-0 mt-1"
                style={{ backgroundColor: item.color }}
              />
              <div>
                <p className="font-semibold text-cf-navy">{item.dimension}</p>
                <p className="text-cf-gray-500 mt-0.5">{item.how}</p>
              </div>
            </div>
          ))}
        </div>
        <p className="text-[10px] text-cf-gray-400 mt-3 pt-3 border-t border-cf-gray-200">
          <strong className="text-cf-gray-500">Overall score</strong> = average of all 6 dimensions (0–100).
          Scores reflect configuration depth and active protection — not a pass/fail audit.
          A score of 80+ indicates strong posture; 60–79 moderate; below 60 indicates gaps to address.
        </p>
      </div>

      {/* Request lifecycle Sankey */}
      {reindexedLinks.length >= 2 && (
        <div className="mt-4 bg-white rounded-xl shadow-sm border border-cf-gray-200 overflow-hidden">
          <div className="px-5 py-4 border-b border-cf-gray-100">
            <h3 className="text-sm font-semibold text-cf-navy">Request Flow</h3>
            <p className="text-xs text-cf-gray-500 mt-0.5">
              How requests are routed at the Cloudflare edge — cached, served to origin, or blocked by security services. Link width is proportional to request volume.
            </p>
          </div>
          <div className="p-4">
            <SankeyFlowChart
              data={sankeyData}
              height={Math.max(340, filteredNodes.length * 48)}
            />
          </div>
          {/* Summary stats below Sankey */}
          {/* Summary stats */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 px-4 pb-4">
            {[
              { label: "Total Requests",   value: totalReqs,                               color: "#2563EB" },
              { label: "Security Blocked", value: summary["totalThreatsBlocked"] ?? 0,     color: "#DC2626" },
              { label: "Origin Served",    value: originReqs,                              color: "#D97706" },
              { label: "Edge Cached",      value: cachedReqs,                              color: "#16A34A" },
            ].map((s) => (
              <div key={s.label} className="rounded-lg border border-cf-gray-100 bg-cf-gray-50 p-3 text-center">
                <div className="w-2 h-2 rounded-full mx-auto mb-1.5" style={{ backgroundColor: s.color }} />
                <p className="text-sm font-bold text-cf-navy">{formatNumber(s.value)}</p>
                <p className="text-[10px] text-cf-gray-500 mt-0.5">{s.label}</p>
                <p className="text-[10px] font-semibold mt-0.5" style={{ color: s.color }}>
                  {totalReqs > 0 ? ((s.value / totalReqs) * 100).toFixed(1) : "0"}%
                </p>
              </div>
            ))}
          </div>
        </div>
      )}
    </section>
  );
}
