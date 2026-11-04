/**
 * POST /api/summary
 * Accepts { appsec: AppSecData } — generates an executive summary using
 * Workers AI (llama-3.3-70b-instruct).
 *
 * Output: 5 structured paragraphs covering all major report sections,
 * explicitly calling out what's good, what's at risk, and what to do next.
 * Feeds the full computed recommendations list so the AI synthesises them.
 */

import type { Context } from "hono";
import type { Env, AppSecData } from "../types";

function formatBytes(bytes: number): string {
  if (bytes >= 1e12) return `${(bytes / 1e12).toFixed(1)} TB`;
  if (bytes >= 1e9)  return `${(bytes / 1e9).toFixed(1)} GB`;
  if (bytes >= 1e6)  return `${(bytes / 1e6).toFixed(1)} MB`;
  return `${(bytes / 1e3).toFixed(1)} KB`;
}

function formatNum(n: number): string {
  if (n >= 1e9) return `${(n / 1e9).toFixed(1)}B`;
  if (n >= 1e6) return `${(n / 1e6).toFixed(1)}M`;
  if (n >= 1e3) return `${(n / 1e3).toFixed(1)}K`;
  return String(Math.round(n));
}

function pct(part: number, total: number): string {
  if (!total) return "0%";
  return `${Math.round((part / total) * 100)}%`;
}

/** "a 7-Day" vs "an August 2026" — calendar-month labels can start with a
 *  vowel (August, October, ...), unlike the fixed "N-Day" labels. */
function articleFor(label: string): string {
  return /^[aeiou]/i.test(label) ? "an" : "a";
}

// ─── Source → human-readable label ───────────────────────────────────────────
const SOURCE_LABEL: Record<string, string> = {
  firewallManaged:   "WAF Managed Rules",
  firewallCustom:    "WAF Custom Rules",
  firewallRateLimit: "Rate Limiting",
  l7ddos:            "DDoS L7 Protection",
  apiShield:         "API Shield",
  botManagement:     "Bot Management",
  hot:               "IP Reputation Block",
  securitylevel:     "Security Level",
  uaBlock:           "User-Agent Block",
  zonelockdown:      "Zone Lockdown",
  waf:               "WAF",
};

const EXCLUDED_SOURCES = new Set(["dlp", "sanitycheck", "unknown", ""]);

function buildPrompt(appsec: AppSecData, isPoc: boolean): { system: string; user: string } {
  const ap = appsec as AppSecData & Record<string, unknown>;
  const { summary, meta, certificates, wafTopRules, ddosTimeSeries, botScoreBreakdown } = ap;
  const cipherSuites = ap["cipherSuites"] as string[] | undefined ?? [];

  // ── Period ────────────────────────────────────────────────────────────────
  const actualDays = (meta as unknown as Record<string, number>)["days"] ?? 30;
  // Prefer the backend-computed label — for a "Last Month" report (rangeMode
  // calendar_month) this is a real calendar-month name like "August 2026",
  // not a generic "31-day" phrase that would silently ignore the framing
  // the user actually selected. Only lowercase the "N-Day" style labels
  // (existing behavior, reads as an adjective phrase: "the 7-day period") —
  // a month name is a proper noun and must stay capitalized.
  const rawPeriodLabel = (meta as unknown as Record<string, string>)["periodLabel"]
    ?? (actualDays === 1 ? "1-Day" : `${actualDays}-Day`);
  const periodLabel = /-day$/i.test(rawPeriodLabel) ? rawPeriodLabel.toLowerCase() : rawPeriodLabel;
  const periodPhrase = `the ${periodLabel} evaluation period (${meta.since} to ${meta.until})`;

  // ── Traffic ───────────────────────────────────────────────────────────────
  const totalReqs   = summary.totalRequests;
  const totalBytes  = summary.totalBandwidthBytes;
  const cachedBytes = summary.cachedBandwidthBytes;
  const cacheReqPct = summary.cacheHitRatePct;
  const cacheBwPct  = (summary as unknown as Record<string, number>)["cacheBandwidthHitRatePct"] ?? 0;

  const countries = ap["countryDistribution"] as Array<{ clientCountryName: string; requests: number }> | undefined ?? [];
  const topCountries = countries.slice(0, 3).map((c) => `${c.clientCountryName} (${formatNum(c.requests)})`).join(", ");

  const hostnames = ap["topHttpHostnames"] as Array<{ hostname: string; requests: number }> | undefined ?? [];
  const topHost = hostnames[0];

  // ── TTFB performance ──────────────────────────────────────────────────────
  const ttfb = ap["ttfbTimeSeries"] as Array<{ avg: number }> | undefined ?? [];
  const avgTtfb = ttfb.length > 0
    ? Math.round(ttfb.reduce((s, d) => s + d.avg, 0) / ttfb.length)
    : 0;

  // ── CDN / cost savings ────────────────────────────────────────────────────
  const costSavings   = (summary as unknown as Record<string, Record<string, number>>)["costSavings"];
  const monthlySaving = costSavings?.["totalMonthlySavings"] ?? costSavings?.["monthlyBandwidthSavings"] ?? 0;

  const zoneSettings  = ap["zoneSettings"] as Record<string, unknown> | undefined ?? {};
  const http3On       = zoneSettings["http3"] === "on";
  const brotliOn      = zoneSettings["brotli"] === "on";
  const earlyHintsOn  = zoneSettings["early_hints"] === "on";
  const minifyOn      = zoneSettings["minify"];

  // ── WAF ───────────────────────────────────────────────────────────────────
  const totalThreats    = (summary as unknown as Record<string, number>)["totalThreats"] ?? 0;
  const totalBlocked    = summary.totalThreatsBlocked;
  const topRule         = wafTopRules[0];
  const topRuleLabel    = topRule
    ? `"${topRule.ruleName ?? topRule.description ?? topRule.ruleId}" (${formatNum(topRule.count)} events, ${topRule.action}, source: ${SOURCE_LABEL[topRule.source ?? ""] ?? topRule.source})`
    : "no events";
  const wafRulesCount   = ap["wafManagedRules"] as unknown[] | undefined ?? [];
  const rateLimitRules  = ap["rateLimitRules"] as unknown[] | undefined ?? [];
  const wafAttackClassification = ap["wafAttackClassification"] as Array<{ category: string; count: number }> | undefined ?? [];

  // ── DDoS ──────────────────────────────────────────────────────────────────
  const totalDdos = ddosTimeSeries.reduce((s, d) => s + d.mitigated, 0);
  const ddosVectors = ap["ddosAttackVectors"] as Array<{ vector: string; count: number }> | undefined ?? [];
  const topDdosVector = ddosVectors[0];

  // ── Security events by service ────────────────────────────────────────────
  const secEvents = (ap["securityEventsByService"] as Array<{ source: string; action: string; count: number }> | undefined ?? [])
    .filter((e) => !EXCLUDED_SOURCES.has(e.source));
  // Aggregate by source for top services
  const byServiceMap = new Map<string, number>();
  for (const e of secEvents) byServiceMap.set(e.source, (byServiceMap.get(e.source) ?? 0) + e.count);
  const topServices = Array.from(byServiceMap.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3)
    .map(([src, cnt]) => `${SOURCE_LABEL[src] ?? src}: ${formatNum(cnt)}`)
    .join("; ");

  // ── Bot management ────────────────────────────────────────────────────────
  // Use the robust numeric fields on `summary`, not scoreRange string-
  // matching — the real bucket labels ("Automated (Score 1)" / "Likely
  // Automated (Score 2–29)" / "Likely Human (Score 30–99)") never contain
  // the substring "Bot" (only the Bot-Management-inactive fallback label
  // does), so `.includes("Bot")` always returned 0 on zones with real,
  // active Bot Management data.
  const botMgmt     = ap["botManagementConfig"] as Record<string, boolean> | null | undefined;
  const humanPct    = (summary as unknown as Record<string, number>)["humanPct"] ?? 0;
  const botTrafficPct = (summary as unknown as Record<string, number>)["botTrafficPct"] ?? 0;
  const verifiedBots = ap["verifiedBotCategories"] as Array<{ category: string; count: number }> | undefined ?? [];
  const topVerifiedBot = verifiedBots[0];
  const aiCrawlerSummary = ap["aiCrawlerSummary"] as {
    totalRequests: number; pctOfTotal: number; uniqueBots: number; topBot: string | null;
  } | undefined;

  // ── API Shield — Endpoint risk labels ────────────────────────────────────
  const apiRiskLabels = ap["apiRiskLabels"] as Array<{ label: string; operationCount: number; requests: number }> | undefined ?? [];
  const apiZombieEndpoints = ap["apiZombieEndpoints"] as Array<{ endpoint: string }> | undefined ?? [];
  const apiRiskyEndpoints  = ap["apiRiskyEndpoints"]  as Array<{ labels: string[] }> | undefined ?? [];
  const bolaOpCount = apiRiskyEndpoints.filter((e) => e.labels.some((l) => l.startsWith("cf-risk-bola"))).length;
  const missingAuthCount = (apiRiskLabels.find((r) => r.label === "cf-risk-missing-auth")?.operationCount ?? 0)
    + (apiRiskLabels.find((r) => r.label === "cf-risk-mixed-auth")?.operationCount ?? 0);

  // ── WAF ML attack score ───────────────────────────────────────────────────
  const wafScore    = ap["wafScoreAllTraffic"] as Array<{ scoreClass: string; count: number }> | undefined ?? [];
  const scoredAttack = wafScore.filter((r) => r.scoreClass === "attack").reduce((s, r) => s + r.count, 0);
  const scoredLikely = wafScore.filter((r) => r.scoreClass === "likely_attack").reduce((s, r) => s + r.count, 0);
  const totalScored  = wafScore.reduce((s, r) => s + r.count, 0);

  // ── TLS / Certs ───────────────────────────────────────────────────────────
  const tls13On       = ap["tls13Enabled"] as boolean | undefined ?? false;
  const alwaysHttps   = ap["alwaysHttps"] as boolean | undefined ?? false;
  const sslMode       = ap["sslMode"] as string | undefined ?? "N/A";
  const expiringSoon  = certificates.filter((c) => c.daysUntilExpiry >= 0 && c.daysUntilExpiry < 30).length;
  const strongCiphers = cipherSuites.filter((c) => c.includes("CHACHA20") || c.includes("AES256") || c.includes("AES-256")).length;

  // ── Email security ────────────────────────────────────────────────────────
  const email = ap["emailSecurity"] as {
    spfPolicy: string; dmarcPolicy: string; dmarcSubdomainPolicy: string;
    dkimSelectors: Array<{ valid: boolean }>; usingCloudflareEmailSecurity: boolean;
    grade: string; issues: string[];
  } | null | undefined;
  const emailGrade    = email?.grade ?? "N/A";
  const dmarcPolicy   = email?.dmarcPolicy ?? "none";
  const spfPolicy     = email?.spfPolicy ?? "?softfail?";
  const dkimCount     = email?.dkimSelectors?.length ?? 0;
  const emailIssues   = email?.issues?.slice(0, 4) ?? [];

  // ── DNS ───────────────────────────────────────────────────────────────────
  const dns = ap["dnsRecordSummary"] as { totalRecords: number; proxiedCount: number; dnsOnlyCount: number } | undefined;
  const dnsQueries = (ap["dnsQueryTimeSeries"] as Array<{ count: number }> | undefined ?? []).reduce((s, d) => s + d.count, 0);
  const dnsProxiedPct = dns ? Math.round((dns.proxiedCount / Math.max(dns.totalRecords, 1)) * 100) : 0;

  // ── Page Shield ───────────────────────────────────────────────────────────
  const pageShield     = ap["pageShieldScripts"] as Array<{ js_integrity_score?: number; malware_score?: number }> | undefined ?? [];
  const flaggedScripts = pageShield.filter((s) => (s.js_integrity_score ?? 100) < 30 || (s.malware_score ?? 100) < 30).length;

  // ── Suspicious Activity (Account Takeover, Leaked Cred Check, AI Security, Malicious Uploads) ──
  const accountTakeover = ap["accountTakeover"] as { totalRequests: number; topPaths: Array<{ host: string; path: string; requests: number }> } | undefined
    ?? { totalRequests: 0, topPaths: [] };
  const leakedCredCheck = ap["leakedCredentialCheck"] as { enabled: boolean; customDetections: number } | undefined
    ?? { enabled: false, customDetections: 0 };
  const aiSecurityForApps = ap["aiSecurityForApps"] as { enabled: boolean } | undefined ?? { enabled: false };
  const contentScanning = ap["contentScanning"] as { enabled: boolean } | undefined ?? { enabled: false };
  const sensitiveDataDetectionDeployed = ap["sensitiveDataDetectionDeployed"] as boolean | undefined ?? false;
  const legacyExposedCredentialsDeployed = ap["legacyExposedCredentialsDeployed"] as boolean | undefined ?? false;

  // ── Recommendations (already computed by backend) ─────────────────────────
  const recommendations = ap["recommendations"] as Array<{
    priority: string; title: string; description: string; benefit: string;
  }> | undefined ?? [];
  const highRecs  = recommendations.filter((r) => r.priority === "high");
  const medRecs   = recommendations.filter((r) => r.priority === "medium");
  const recSummary = recommendations.slice(0, 5)
    .map((r) => `[${r.priority.toUpperCase()}] ${r.title}: ${r.benefit}`)
    .join("\n");

  // ── Good/Bad classification for the AI ───────────────────────────────────
  const goodPoints: string[] = [];
  const badPoints:  string[] = [];
  const nextSteps:  string[] = [];

  if (totalBlocked > 0) goodPoints.push(`${formatNum(totalBlocked)} threats actively blocked (${pct(totalBlocked, totalReqs)} of traffic)`);
  if (cacheReqPct >= 70) goodPoints.push(`Strong cache hit rate of ${cacheReqPct}% reduces origin load significantly`);
  if (tls13On)           goodPoints.push("TLS 1.3 enabled — latest encryption standard active");
  if (alwaysHttps)       goodPoints.push("Always HTTPS enforced — all traffic encrypted");
  if (http3On)           goodPoints.push("HTTP/3 (QUIC) enabled — improved connection performance");
  if (brotliOn)          goodPoints.push("Brotli compression active — reduced transfer sizes");
  if (wafRulesCount.length > 0) goodPoints.push(`${wafRulesCount.length} WAF rulesets deployed`);
  if (email?.usingCloudflareEmailSecurity) goodPoints.push("Cloudflare Email Security active — MX routed through Cloudflare");
  if (expiringSoon === 0 && certificates.length > 0) goodPoints.push("All certificates healthy — none expiring within 30 days");
  if (leakedCredCheck.enabled) goodPoints.push("Leaked Credential Check active — login requests screened against known breached password databases");
  if (aiSecurityForApps.enabled) goodPoints.push("AI Security for Apps active — LLM-facing endpoints screened for PII exposure and prompt injection");
  if (contentScanning.enabled) goodPoints.push("Malicious Upload scanning (Content Scanning) active on file upload endpoints");

  if (cacheReqPct < 40)          badPoints.push(`Low cache hit rate (${cacheReqPct}%) — most requests hitting origin`);
  if (!tls13On)                   badPoints.push("TLS 1.3 not enabled — using older encryption");
  if (!alwaysHttps)               badPoints.push("Always HTTPS not enforced — plain HTTP connections possible");
  if (rateLimitRules.length === 0) badPoints.push("No rate limiting rules configured — APIs/login endpoints unprotected against abuse");
  if (dmarcPolicy === "none" || dmarcPolicy === "")
                                   badPoints.push(`DMARC policy is "${dmarcPolicy || "missing"}" — email spoofing risk`);
  if (spfPolicy.includes("~all")) badPoints.push("SPF uses ~all (softfail) instead of -all (reject) — phishing risk");
  if (expiringSoon > 0)           badPoints.push(`${expiringSoon} certificate(s) expiring within 30 days`);
  if (!leakedCredCheck.enabled)   badPoints.push("Leaked Credential Check not enabled — login endpoints unprotected against breached-password reuse");
  if (accountTakeover.totalRequests > 0)
    badPoints.push(`CRITICAL: ${formatNum(accountTakeover.totalRequests)} account-takeover signal(s) detected (login failures / high-volume login attempts / anomalous login patterns)`);
  if (!aiSecurityForApps.enabled)
    badPoints.push("AI Security for Apps not enabled — no protection against PII exposure or prompt injection on LLM-facing endpoints");
  if (!contentScanning.enabled)   badPoints.push("Malicious Upload scanning (Content Scanning) not enabled — file uploads are not screened for malware");
  if (!sensitiveDataDetectionDeployed) badPoints.push("Sensitive Data Detection not deployed — no automated scanning for exposed PII/financial data in responses");
  if (legacyExposedCredentialsDeployed) badPoints.push("Legacy Exposed Credentials Check still deployed — should be migrated to Leaked Credential Check");
  if (flaggedScripts > 0)         badPoints.push(`${flaggedScripts} suspicious scripts flagged by Page Shield`);
  if (dnsProxiedPct < 60 && (dns?.totalRecords ?? 0) > 0)
                                   badPoints.push(`Only ${dnsProxiedPct}% of DNS records proxied through Cloudflare — attack surface exposed`);
  if (!earlyHintsOn)              badPoints.push("Early Hints (103) disabled — LCP optimization opportunity missed");
  if (botTrafficPct > 30)         badPoints.push(`High automated traffic: ${botTrafficPct}% of requests are bots/likely bots`);
  if (aiCrawlerSummary && aiCrawlerSummary.pctOfTotal > 5)
    badPoints.push(`Generative AI crawlers account for ${aiCrawlerSummary.pctOfTotal}% of traffic (top: ${aiCrawlerSummary.topBot}) with no explicit AI bot policy configured`);
  if (bolaOpCount > 0)
    badPoints.push(`CRITICAL: ${bolaOpCount} API endpoint(s) flagged for BOLA (Broken Object Level Authorization) risk — as dangerous as an account takeover`);
  if (missingAuthCount > 0)
    badPoints.push(`${missingAuthCount} API endpoint(s) have missing or inconsistent authentication on successful requests`);
  if (apiZombieEndpoints.length > 0)
    badPoints.push(`${apiZombieEndpoints.length} zombie API endpoint(s) detected — saved endpoints with no traffic in 32+ days, expanding the attack surface unnecessarily`);

  for (const r of highRecs.slice(0, 3)) nextSteps.push(`HIGH: ${r.title}`);
  for (const r of medRecs.slice(0, 2))  nextSteps.push(`MEDIUM: ${r.title}`);

  // ── System prompt ─────────────────────────────────────────────────────────
  const reportNoun  = isPoc ? "Proof-of-Concept (POC) security and performance report" : "security and performance assessment report";
  const periodPhraseLabel = isPoc ? `${periodLabel} POC` : `${periodLabel} assessment`;

  const paragraph4 = isPoc
    ? `Paragraph 4 — Performance and cost value. Cover cache hit rate (requests and bandwidth), estimated monthly cost savings vs AWS, average TTFB, protocol optimisations active. One sentence on DNS proxy coverage and certificate health.`
    : `Paragraph 4 — Performance and posture. Cover cache hit rate (requests and bandwidth), average TTFB, protocol optimisations active, DNS proxy coverage, and certificate health. Do NOT mention cost savings, pricing, or AWS comparisons.`;
  const paragraph5 = isPoc
    ? `Paragraph 5 — Next steps and forward look. In continuous prose (no list), name the top HIGH-priority actions from the recommendations by weaving them naturally into sentences (e.g. "The most urgent action is to... followed by... and..."). Close with one confident sentence on full deployment ROI.`
    : `Paragraph 5 — Overall posture and outlook. In continuous prose (no list), summarise the zone's overall security posture and close with one confident, forward-looking sentence. Do NOT mention "recommendations", "next steps", a numbered action list, or deployment ROI.`;

  const system = `You are a senior Cloudflare Solutions Engineer writing an executive summary \
for a ${reportNoun}. The audience is the customer's \
CISO, CTO, and executive team${isPoc ? " who will decide on a full Cloudflare deployment" : ""}.

ABSOLUTE FORMAT RULES — violating any of these is a failure:
- Output ONLY plain prose. Zero bullet points. Zero numbered lists. Zero hyphens as list markers. Zero headers. Zero markdown.
- Exactly 5 paragraphs. Separate each paragraph with ONE blank line. Nothing else between paragraphs.
- Each paragraph is 3-5 sentences of continuous flowing prose.
- Total length: 420-520 words.
- Do NOT label or title the paragraphs — no "Paragraph 1:", no "Traffic & Protection:", no "1.", nothing.
- Do NOT use "1.", "2.", "3." or any numbering inside a paragraph.
- Do NOT repeat the section name from the paragraph purpose inside the text.
- Professional, confident, C-suite language. Specific numbers required — no vague generalisations.
- Never start a sentence with "I". Never refer to yourself.
${isPoc
  ? `- This is ${articleFor(periodPhraseLabel)} ${periodPhraseLabel} (${actualDays} days: ${meta.since} to ${meta.until}). Always write "${periodLabel}" — never "30-day" unless actualDays equals 30.`
  : `- This report covers ${periodPhraseLabel} (${actualDays} days: ${meta.since} to ${meta.until}). Always write "${periodLabel}" — never "30-day" unless actualDays equals 30. Never use the words "POC", "Proof-of-Concept", or "proof of concept" anywhere in the output.`}

PARAGRAPH PURPOSES (write in this order, NO labels):
Paragraph 1 — Traffic scale and protection headline. Open with "Over ${periodPhrase}, ${meta.zoneName}..." then state total requests, top geographies, top hostname, total threats blocked, most active security service and top WAF rule. Close with one sentence on what exposure would exist without Cloudflare.
Paragraph 2 — Strengths. Pick the 3-4 strongest items from GOOD SIGNALS. Weave them into flowing sentences explaining the business value (uptime, compliance, cost, performance). Use the actual numbers.
Paragraph 3 — Risks. Pick the 2-3 most critical items from RISK SIGNALS. Be direct about the business consequence of each gap. Use the actual values (exact policy names, exact percentages). Do NOT soften the language.
${paragraph4}
${paragraph5}`;

  // ── User prompt (structured data) ─────────────────────────────────────────
  const lines: string[] = [];

  lines.push(`ZONE: ${meta.zoneName}`);
  lines.push(`PERIOD: ${meta.since} to ${meta.until} (${actualDays} days — always call it "${periodLabel}")`);
  lines.push(``);

  lines.push(`=== TRAFFIC SCALE ===`);
  lines.push(`Total requests: ${formatNum(totalReqs)}`);
  lines.push(`Total bandwidth: ${formatBytes(totalBytes)}`);
  lines.push(`Top countries: ${topCountries || "N/A"}`);
  lines.push(`Top hostname: ${topHost ? `${topHost.hostname} (${formatNum(topHost.requests)} requests)` : "N/A"}`);
  lines.push(`Average TTFB: ${avgTtfb > 0 ? `${avgTtfb}ms` : "N/A"}`);
  lines.push(``);

  lines.push(`=== SECURITY PROTECTION ===`);
  lines.push(`Threats blocked (from exact httpRequests1dGroups.threats): ${formatNum(totalThreats)}`);
  lines.push(`WAF + DDoS events total: ${formatNum(totalBlocked)}`);
  lines.push(`DDoS L7 events mitigated: ${formatNum(totalDdos)}`);
  lines.push(topDdosVector ? `Top DDoS vector: ${topDdosVector.vector} (${formatNum(topDdosVector.count)} events)` : `DDoS vector detail: not available`);
  lines.push(`Top WAF rule: ${topRuleLabel}`);
  lines.push(`WAF rulesets deployed: ${wafRulesCount.length}`);
  lines.push(`Rate limiting rules: ${rateLimitRules.length}`);
  lines.push(`Security events by service: ${topServices || "N/A"}`);
  if (wafAttackClassification.length > 0) {
    const topCats = wafAttackClassification.slice(0, 3)
      .map((c) => `${c.category} (${formatNum(c.count)})`)
      .join(", ");
    lines.push(`Top attack categories (Cloudflare rule tags where available): ${topCats}`);
  }
  lines.push(``);

  lines.push(`=== BOT MANAGEMENT ===`);
  lines.push(`Bot Management active: ${botMgmt?.enable_js ? "yes (JS fingerprinting)" : "no or limited"}`);
  lines.push(`Bot traffic (score 1-29 automated): ${formatNum(summary.crawlerRequests)} requests`);
  lines.push(`Automated traffic %: ${botTrafficPct}%`);
  lines.push(`Likely human traffic: ${humanPct}%`);
  lines.push(topVerifiedBot ? `Top verified bot category: ${topVerifiedBot.category} (${formatNum(topVerifiedBot.count)} requests)` : ``);
  if (aiCrawlerSummary && aiCrawlerSummary.totalRequests > 0) {
    lines.push(`Generative AI crawler traffic: ${formatNum(aiCrawlerSummary.totalRequests)} requests (${aiCrawlerSummary.pctOfTotal}% of total) from ${aiCrawlerSummary.uniqueBots} distinct AI bot(s), top: ${aiCrawlerSummary.topBot ?? "n/a"}`);
  }
  if (apiRiskLabels.length > 0 || apiZombieEndpoints.length > 0) {
    lines.push(`API Shield endpoint risk labels: ${apiRiskLabels.map((r) => `${r.label} (${r.operationCount} endpoints)`).join(", ") || "none"}`);
    if (apiZombieEndpoints.length > 0) lines.push(`Zombie API endpoints (no traffic 32+ days): ${apiZombieEndpoints.length}`);
    if (bolaOpCount > 0) lines.push(`BOLA-risk endpoints: ${bolaOpCount}`);
  }
  lines.push(``);

  lines.push(`=== WAF ML ATTACK SCORE (all traffic — not just rule matches) ===`);
  if (totalScored > 0) {
    lines.push(`Requests scored as "attack" by ML: ${formatNum(scoredAttack)} (${pct(scoredAttack, totalReqs)} of traffic)`);
    lines.push(`Requests scored as "likely attack" by ML: ${formatNum(scoredLikely)}`);
    lines.push(`Total scored: ${formatNum(totalScored)}`);
  } else {
    lines.push(`WAF ML attack score: not available / no scored requests`);
  }
  lines.push(``);

  lines.push(`=== CDN & CACHE ===`);
  lines.push(`Request cache hit rate: ${cacheReqPct}% (${cacheReqPct >= 70 ? "GOOD" : cacheReqPct >= 40 ? "MODERATE" : "LOW — NEEDS IMPROVEMENT"})`);
  lines.push(`Bandwidth cache hit rate: ${cacheBwPct}%`);
  lines.push(`Bandwidth saved from cache: ${formatBytes(cachedBytes)}`);
  lines.push(monthlySaving > 0 ? `Estimated monthly cost savings vs AWS equivalent: $${Math.round(monthlySaving).toLocaleString()}` : `Cost savings: not computed`);
  lines.push(`HTTP/3: ${http3On ? "enabled ✓" : "disabled ✗"}`);
  lines.push(`Brotli: ${brotliOn ? "enabled ✓" : "disabled ✗"}`);
  lines.push(`Early Hints: ${earlyHintsOn ? "enabled ✓" : "disabled ✗"}`);
  lines.push(`Minify: ${minifyOn ? "configured" : "not configured"}`);
  lines.push(``);

  lines.push(`=== DNS ===`);
  lines.push(`Total DNS records: ${dns?.totalRecords ?? 0} (${dns?.proxiedCount ?? 0} proxied [${dnsProxiedPct}%], ${dns?.dnsOnlyCount ?? 0} DNS-only)`);
  lines.push(`DNS query volume: ${formatNum(dnsQueries)} queries`);
  lines.push(dnsProxiedPct < 60 ? `WARNING: Only ${dnsProxiedPct}% of records proxied — significant attack surface exposed` : `DNS proxy coverage: adequate`);
  lines.push(``);

  lines.push(`=== TLS & CERTIFICATES ===`);
  lines.push(`TLS 1.3: ${tls13On ? "enabled ✓" : "NOT enabled ✗"}`);
  lines.push(`Always HTTPS: ${alwaysHttps ? "enforced ✓" : "NOT enforced ✗"}`);
  lines.push(`SSL mode: ${sslMode}`);
  lines.push(`Certificates: ${certificates.length} managed, ${expiringSoon} expiring within 30 days${expiringSoon > 0 ? " ⚠ ACTION REQUIRED" : " ✓"}`);
  lines.push(`Strong ciphers (AES-256/CHACHA20): ${strongCiphers} of ${cipherSuites.length}`);
  const pqcAdoptionPct = ap["pqcAdoptionPct"] as number | undefined ?? 0;
  if (pqcAdoptionPct > 0) {
    lines.push(`Post-Quantum Cryptography (PQC) hybrid key exchange adoption: ${pqcAdoptionPct}% of applicable TLS handshakes (X25519MLKEM768) — client-side support, not a zone config gap`);
  }
  lines.push(``);

  lines.push(`=== EMAIL SECURITY ===`);
  lines.push(`Overall grade: ${emailGrade}${emailGrade === "A" ? " ✓ STRONG" : emailGrade === "B" ? " — GOOD" : " ✗ NEEDS WORK"}`);
  lines.push(`DMARC policy: ${dmarcPolicy}${dmarcPolicy === "reject" ? " ✓ STRICT" : dmarcPolicy === "quarantine" ? " — MODERATE" : " ✗ WEAK/MISSING"}`);
  lines.push(`SPF policy: ${spfPolicy}${spfPolicy.includes("-all") ? " ✓ STRICT" : " ✗ WEAK"}`);
  lines.push(`DKIM selectors: ${dkimCount}`);
  lines.push(`Cloudflare Email Security (MX-based): ${email?.usingCloudflareEmailSecurity ? "ACTIVE ✓" : "not in use"}`);
  if (emailIssues.length > 0) lines.push(`Issues: ${emailIssues.join("; ")}`);
  lines.push(``);

  lines.push(`=== CLIENT-SIDE SECURITY ===`);
  lines.push(`Page Shield scripts monitored: ${pageShield.length}`);
  lines.push(`Suspicious/flagged scripts: ${flaggedScripts}${flaggedScripts > 0 ? " ⚠ REVIEW REQUIRED" : " ✓"}`);
  lines.push(``);

  lines.push(`=== SUSPICIOUS ACTIVITY (Security Analytics parity) ===`);
  lines.push(accountTakeover.totalRequests > 0
    ? `CRITICAL: ${formatNum(accountTakeover.totalRequests)} account-takeover signal(s) detected (Bot Management: login failures / high-volume attempts / anomalous patterns)${accountTakeover.topPaths[0] ? `, concentrated on ${accountTakeover.topPaths[0].host}${accountTakeover.topPaths[0].path}` : ""}`
    : `Account takeover: no signals detected this period`);
  lines.push(`Leaked Credential Check: ${leakedCredCheck.enabled ? `ACTIVE ✓ (${leakedCredCheck.customDetections} custom detection location(s))` : "NOT ENABLED ✗"}`);
  lines.push(`AI Security for Apps (PII/unsafe-content/prompt-injection detection): ${aiSecurityForApps.enabled ? "ACTIVE ✓" : "NOT ENABLED ✗"}`);
  lines.push(`Malicious Upload scanning (Content Scanning): ${contentScanning.enabled ? "ACTIVE ✓" : "NOT ENABLED ✗"}`);
  lines.push(`Sensitive Data Detection (response-body PII/financial scanning): ${sensitiveDataDetectionDeployed ? "DEPLOYED ✓" : "NOT DEPLOYED ✗"}`);
  if (legacyExposedCredentialsDeployed) lines.push(`⚠ Legacy Exposed Credentials Check still deployed — recommend migrating to Leaked Credential Check`);
  lines.push(``);

  lines.push(`=== GOOD SIGNALS (things working well) ===`);
  for (const g of goodPoints) lines.push(`✓ ${g}`);
  lines.push(``);

  lines.push(`=== RISK SIGNALS (things that need attention) ===`);
  for (const b of badPoints) lines.push(`✗ ${b}`);
  lines.push(``);

  if (isPoc) {
    lines.push(`=== COMPUTED RECOMMENDATIONS (from backend analysis) ===`);
    lines.push(`${highRecs.length} HIGH priority, ${medRecs.length} MEDIUM priority recommendations.`);
    if (recSummary) lines.push(recSummary);
    lines.push(``);
  }

  lines.push(`=== REMINDER ===`);
  lines.push(isPoc
    ? `This is ${articleFor(periodLabel)} ${periodLabel} POC (${actualDays} days). Never write "30-day" unless that is the actual period. Always write "${periodLabel}".`
    : `This report covers ${periodLabel} (${actualDays} days). Never write "30-day" unless that is the actual period. Always write "${periodLabel}". Never use the words "POC" or "Proof-of-Concept".`);

  return { system, user: lines.join("\n") };
}

export async function handleAiSummary(c: Context<{ Bindings: Env }>) {
  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: "Invalid JSON body" }, 400);
  }

  if (!body || typeof body !== "object" || !(body as Record<string, unknown>)["appsec"]) {
    return c.json({ error: "Missing appsec field in body" }, 400);
  }

  const appsec = (body as Record<string, unknown>)["appsec"] as AppSecData;
  const isPoc = (body as Record<string, unknown>)["isPoc"] !== false;

  try {
    const summary = await generateAiSummary(c.env, appsec, isPoc);
    return c.json({ ok: true, summary });
  } catch (err) {
    console.error("Workers AI error:", err);
    return c.json({ error: "AI summary generation failed", detail: String(err) }, 500);
  }
}

// ─── Summary Generation ────────────────────────────────────────────────────────
// Shared by the POST /api/summary route and the scheduled report email runner.
// Throws if both AI attempts fail (route returns 500; scheduler degrades to "").

// A real 5-paragraph, ~450-600 word summary is always several hundred
// characters. Anything drastically shorter is a truncated/degenerate
// completion (confirmed live on the Zero Trust summary endpoint: a run
// returned a 90-character sentence fragment with no ending punctuation, a
// finish_reason "length" cutoff, not a real short-but-valid answer) —
// treated as a failure so the next fallback attempt is tried instead of
// silently shipping a broken partial summary.
const MIN_VALID_SUMMARY_LENGTH = 300;

export async function generateAiSummary(env: Env, appsec: AppSecData, isPoc: boolean): Promise<string> {
  const { system, user } = buildPrompt(appsec, isPoc);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const ai = env.AI as any;

  async function attempt(model: string, maxTokens: number): Promise<string> {
    try {
      const response = await ai.run(model, {
        messages: [
          { role: "system", content: system },
          { role: "user",   content: user },
        ],
        max_tokens: maxTokens,
        temperature: 0.25,
      });
      let out = "";
      if (typeof response?.response === "string") out = response.response.trim();
      else if (Array.isArray(response?.choices) && response.choices.length > 0) out = (response.choices[0]?.message?.content ?? response.choices[0]?.text ?? "").trim();
      else if (typeof response === "string") out = response.trim();
      if (out.length < MIN_VALID_SUMMARY_LENGTH) {
        console.warn(`[AI] ${model} returned empty/truncated (${out.length} chars):`, JSON.stringify(response)?.slice(0, 500));
        return "";
      }
      return out;
    } catch (err) {
      console.warn(`[AI] ${model} failed:`, String(err));
      return "";
    }
  }

  // glm-5.3-flash and gpt-oss-120b are both reasoning models — their
  // `reasoning` output counts against max_tokens before they ever write the
  // final `content`. Confirmed live (wrangler tail) that even a 3000-token
  // budget can still be exhausted mid-reasoning on some prompt variants
  // (finish_reason "length", content: null) — non-deterministically, since
  // retrying the identical payload sometimes succeeds. Try three different
  // model families in order rather than accepting a truncated/empty result.
  let text = await attempt("@cf/zai-org/glm-5.3-flash", 3000);
  if (!text) text = await attempt("@cf/openai/gpt-oss-120b", 3000);
  if (!text) text = await attempt("@cf/meta/llama-3.3-70b-instruct-fp8-fast", 2000);

  // Preserve the original contract (documented above): throw when every
  // attempt failed, so the route returns a real 500 with an explanation and
  // the web UI shows an explicit "AI summary unavailable" error — silently
  // returning "" here would instead render as a blank executive summary
  // section with no indication anything went wrong.
  if (!text) throw new Error("All Workers AI attempts returned an empty or truncated response");

  return text;
}
