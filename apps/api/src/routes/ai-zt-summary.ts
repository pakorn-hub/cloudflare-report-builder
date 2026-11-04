/**
 * POST /api/zt-summary
 * Workers AI executive summary for Cloudflare One (Zero Trust) reports.
 */

import type { Context } from "hono";
import type { Env, ZeroTrustData } from "../types";

function fmt(n: number): string {
  if (n >= 1e6) return `${(n/1e6).toFixed(1)}M`;
  if (n >= 1e3) return `${(n/1e3).toFixed(1)}K`;
  return String(Math.round(n));
}

/** "a 7-Day" vs "an August 2026" — calendar-month labels can start with a
 *  vowel (August, October, ...), unlike the fixed "N-Day" labels. */
function articleFor(label: string): string {
  return /^[aeiou]/i.test(label) ? "an" : "a";
}

function buildZtPrompt(zt: ZeroTrustData, isPoc: boolean): { system: string; user: string } {
  const { summary, meta, accessApps, accessIdps, gatewayPolicies, warpDevices, tunnels, recommendations } = zt;
  const days = meta.days;
  // Only lowercase "N-Day"-style labels (existing behavior, reads as an
  // adjective phrase: "the 7-day period"). A calendar-month label like
  // "August 2026" is a proper period name and must stay capitalized —
  // lowercasing it to "august 2026" would look like a typo, not a style choice.
  const periodLabel = /-day$/i.test(meta.periodLabel) ? meta.periodLabel.toLowerCase() : meta.periodLabel;
  const highRecs = recommendations.filter((r) => r.priority === "high");
  const medRecs  = recommendations.filter((r) => r.priority === "medium");

  const dnsFiltPct = summary.gatewayDnsQueries > 0
    ? Math.round((summary.gatewayDnsBlocked / summary.gatewayDnsQueries) * 100) : 0;
  const httpFiltPct = summary.gatewayHttpRequests > 0
    ? Math.round((summary.gatewayHttpBlocked / summary.gatewayHttpRequests) * 100) : 0;
  const warpOnlinePct = summary.warpEnrolledDevices > 0
    ? Math.round((summary.warpOnlineDevices / summary.warpEnrolledDevices) * 100) : 0;
  const bandwidthGB = (summary.gatewayBandwidthBytesSent + summary.gatewayBandwidthBytesRecvd) / (1024 ** 3);

  const reportNoun = isPoc
    ? "Cloudflare One (Zero Trust / SASE) Proof-of-Concept report"
    : "Cloudflare One (Zero Trust / SASE) security posture assessment report";
  const paragraph5 = isPoc
    ? `5. NEXT STEPS: Weave top HIGH recommendations naturally into sentences. Close with one confident statement about full Zero Trust deployment ROI vs traditional VPN/proxy stack.`
    : `5. OVERALL POSTURE & OUTLOOK: Summarise the account's overall Zero Trust posture in flowing prose. Close with one confident, forward-looking sentence. Do NOT mention "recommendations", "next steps", a numbered action list, "POC", "Proof-of-Concept", or deployment ROI.`;

  const system = `You are a senior Cloudflare Solutions Engineer writing an executive summary for a \
${reportNoun}. The audience is the customer's CISO, CTO, \
and executive team${isPoc ? " deciding on a full Zero Trust deployment" : ""}.

ABSOLUTE FORMAT RULES:
- Exactly 5 paragraphs separated by ONE blank line. No headers. No bullet points. No numbered lists. No markdown.
- Each paragraph: 3-5 sentences of flowing prose. Total: 420-520 words.
- Specific numbers required — no generic statements.
- Never start a sentence with "I". Never label paragraphs.
${isPoc
  ? `- This is ${articleFor(periodLabel)} ${periodLabel} POC (${days} days: ${meta.since} to ${meta.until}). Always write "${periodLabel}".`
  : `- This report covers ${periodLabel} (${days} days: ${meta.since} to ${meta.until}). Always write "${periodLabel}". Never use the words "POC" or "Proof-of-Concept".`}

PARAGRAPH PURPOSES (write in this order, no labels):
1. IDENTITY & ACCESS: Open "Over the ${periodLabel} evaluation period, ${meta.accountName}..." — cover total auth events, success rate, unique users/apps protected, licensed seats vs active-in-period, MFA policy coverage (from Access policies, not a challenge count — see note below), most active IdPs. State what Access prevented. If PERIOD-OVER-PERIOD CHANGE data is present, mention 1-2 notable directional changes vs the previous report.
2. GATEWAY FILTERING & GENAI: DNS queries volume + blocked %, HTTP filtering (including which users had the most blocked requests, if listed), top blocked categories, L4 network policies and bandwidth, generative AI (Shadow AI) tool usage and whether it's governed. Quantify threats stopped and data volumes moved.
3. DEVICE POSTURE & CONNECTIVITY: WARP enrolled devices and real online/offline connection status, OS breakdown, tunnel health, and live device-experience (DEX) health if present. Explain value of device-aware access vs legacy VPN.
4. RISKS & GAPS: Pick top 2-3 risks from RISK SIGNALS. Be direct about the security consequence of each gap. If CONFIGURATION CHANGES occurred this period, mention the most security-relevant one by actor/action. Use actual numbers/facts.
${paragraph5}

CRITICAL ACCURACY RULE: Never state or imply an MFA "challenge count" or "MFA usage volume" — no such measurement exists in the data. You may only describe MFA COVERAGE as "X of Y Access policies require MFA" using the exact policy-level count provided.`;

  const lines: string[] = [];
  lines.push(`ACCOUNT: ${meta.accountName} (${meta.accountId})`);
  lines.push(`PERIOD: ${meta.since} to ${meta.until} (${days} days — always call it "${periodLabel}")`);
  lines.push(``);
  lines.push(`=== IDENTITY & ACCESS ===`);
  lines.push(`Total interactive Access login attempts: ${fmt(summary.totalAuthEvents)} (dashboard-exact — excludes WARP client session/reconnect events and service-token validations)`);
  lines.push(`Auth success rate: ${summary.authSuccessRate}%`);
  lines.push(`Blocked auth: ${fmt(summary.blockedAuthEvents)}`);
  if ((summary.warpAndServiceTokenLoginEvents ?? 0) > 0) {
    lines.push(`ADDITIONAL CONTEXT (do not add to the auth-events total above): ${fmt(summary.warpAndServiceTokenLoginEvents!)} WARP client session/service-token login events also occurred this period — these are device connectivity events, not application access, and are already excluded from the auth-events number.`);
  }
  lines.push(`NOTE: MFA-challenge event counts are not exposed by any Cloudflare API — do not mention an MFA challenge count. Only cite MFA POLICY coverage (below).`);
  lines.push(`Unique Access-app users: ${fmt(summary.uniqueUsers)}, Unique apps protected: ${fmt(summary.uniqueApps)}`);
  if ((summary.gatewayDnsUniqueUsers ?? 0) > 0 || (summary.gatewayHttpUniqueUsers ?? 0) > 0) {
    lines.push(`Gateway-wide unique users (DNS/HTTP, broader than Access-app users — covers all WARP client traffic): ${fmt(Math.max(summary.gatewayDnsUniqueUsers ?? 0, summary.gatewayHttpUniqueUsers ?? 0))}, unique devices: ${fmt(summary.gatewayDnsUniqueDevices ?? 0)}`);
  }
  if (zt.accessDistinctCounts) {
    lines.push(`Exact distinct counts (higher-limit sample of ${fmt(zt.accessDistinctCounts.sampleLimit)} rows): ${zt.accessDistinctCounts.uniqueUsers} users, ${zt.accessDistinctCounts.uniqueApps} apps`);
  }
  lines.push(`Licensed seats: ${summary.seatsTotal} (${summary.seatsAccessTotal} Access, ${summary.seatsGatewayTotal} Gateway), active in period: ${summary.seatsActiveInPeriod}, never logged in: ${summary.seatsNeverLoggedIn}`);
  lines.push(`Access apps: ${accessApps.length} (${accessApps.filter((a) => a.enabled).length} enabled)`);
  lines.push(`IdPs connected: ${accessIdps.map((i) => i.name).join(", ") || "None"}`);
  lines.push(`Apps with MFA required: ${zt.accessPolicies.filter((p) => p.requireMfa).length}`);
  if (zt.accessAuthMethodBreakdown && zt.accessAuthMethodBreakdown.length > 0) {
    lines.push(`Login method mix: ${zt.accessAuthMethodBreakdown.map((m) => `${m.method}: ${fmt(m.count)}`).join(", ")}`);
  }
  if ((summary.mcpServersCount ?? 0) + (summary.mcpPortalsCount ?? 0) > 0) {
    lines.push(`MCP servers protected by Access: ${summary.mcpServersCount ?? 0} server(s), ${summary.mcpPortalsCount ?? 0} portal(s), ${fmt(summary.mcpServerLoginEvents ?? 0)} login events`);
  }
  lines.push(``);
  lines.push(`=== GATEWAY DNS FILTERING ===`);
  lines.push(`Total DNS queries: ${fmt(summary.gatewayDnsQueries)}, Blocked: ${fmt(summary.gatewayDnsBlocked)} (${dnsFiltPct}%)`);
  lines.push(`Top blocked categories: ${zt.gatewayDnsTopBlockedCategories.slice(0,3).map((c) => `${c.category} (${fmt(c.count)})`).join(", ") || "N/A"}`);
  lines.push(`DNS policies: ${gatewayPolicies.filter((p) => p.ruleType === "dns").length} rules`);
  lines.push(``);
  lines.push(`=== GATEWAY HTTP FILTERING ===`);
  lines.push(`HTTP requests inspected: ${fmt(summary.gatewayHttpRequests)}, Blocked: ${fmt(summary.gatewayHttpBlocked)} (${httpFiltPct}%)`);
  lines.push(`HTTP policies: ${gatewayPolicies.filter((p) => p.ruleType === "http").length} rules`);
  lines.push(`L4 policies: ${gatewayPolicies.filter((p) => p.ruleType === "l4").length} rules`);
  if (bandwidthGB > 0) lines.push(`Gateway network-layer bandwidth: ${bandwidthGB.toFixed(1)} GB (sent+received, WARP private network traffic)`);
  lines.push(``);
  lines.push(`=== WARP & DEVICE POSTURE ===`);
  lines.push(`Enrolled devices: ${fmt(summary.warpEnrolledDevices)}`);
  lines.push(`Devices online (latest status): ${fmt(summary.warpOnlineDevices)} (${warpOnlinePct}%), offline: ${fmt(summary.warpOfflineDevices)}`);
  lines.push(`OS breakdown: ${zt.warpOsBreakdown.slice(0,3).map((o) => `${o.os}: ${o.count}`).join(", ") || "N/A"}`);
  lines.push(`Posture rules configured: ${zt.warpPostureRules.length}`);
  lines.push(``);
  lines.push(`=== TUNNELS ===`);
  lines.push(`Tunnels: ${summary.tunnelsTotal} total, ${summary.tunnelsHealthy} healthy`);
  lines.push(`Routes: ${zt.tunnelRoutes.length}`);
  if (zt.gatewayHttpTopBlockedUsers && zt.gatewayHttpTopBlockedUsers.length > 0) {
    lines.push(`Users with most blocked HTTP requests: ${zt.gatewayHttpTopBlockedUsers.slice(0,3).map((u) => `${u.email} (${fmt(u.count)})`).join(", ")}`);
  }
  lines.push(``);
  lines.push(`=== DEVICE EXPERIENCE (DEX) — live snapshot, not period-scoped ===`);
  if (zt.dexFleetStatus && zt.dexFleetStatus.uniqueDevicesTotal > 0) {
    const connected = zt.dexFleetStatus.byStatus.filter((s) => s.value.toLowerCase().includes("connect") && !s.value.toLowerCase().includes("dis")).reduce((sum, s) => sum + s.count, 0);
    lines.push(`Devices seen in the last 60 minutes: ${zt.dexFleetStatus.uniqueDevicesTotal}, currently connected: ${connected}`);
    lines.push(`Client versions in fleet: ${zt.dexFleetStatus.byVersion.length} distinct versions`);
  } else {
    lines.push(`No live DEX telemetry available for this account.`);
  }
  lines.push(``);
  lines.push(`=== DLP & DATA SECURITY ===`);
  lines.push(`DLP profiles: ${zt.dlpProfiles.length}`);
  lines.push(`CASB findings (posture): ${fmt(summary.casbFindingsCount)}`);
  if (zt.casbFindingsDetail && zt.casbFindingsDetail.length > 0) {
    const critHigh = zt.casbFindingsDetail.filter((f) => ["critical","high"].includes(f.severity.toLowerCase())).length;
    if (critHigh > 0) lines.push(`Of those, ${critHigh} are critical/high severity`);
  }
  if (zt.dlpActivitySummary && zt.dlpActivitySummary.hitCount > 0) {
    lines.push(`REAL DLP matches this period: ${fmt(zt.dlpActivitySummary.hitCount)} hits across ${fmt(zt.dlpActivitySummary.scanCount)} scanned requests/files`);
    if (zt.dlpProfileMatches && zt.dlpProfileMatches.length > 0) {
      lines.push(`Top matching DLP profiles: ${zt.dlpProfileMatches.slice(0,3).map((p) => `${p.profileName} (${fmt(p.hitCount)})`).join(", ")}`);
    }
  }
  const quarantineTotal = (zt.gatewayDlpQuarantineTimeSeries ?? []).reduce((s, d) => s + d.count, 0);
  if (quarantineTotal > 0) lines.push(`HTTP requests quarantined by DLP action this period: ${fmt(quarantineTotal)}`);
  lines.push(``);
  if (zt.configChanges && zt.configChanges.length > 0) {
    lines.push(`=== CONFIGURATION CHANGES THIS PERIOD ===`);
    lines.push(`${zt.configChanges.length} Zero-Trust-relevant configuration change(s) recorded.`);
    for (const c of zt.configChanges.slice(0, 5)) {
      lines.push(`- ${c.actionType} on ${c.product} by ${c.actorEmail}: ${c.description || "(no description)"}`);
    }
    lines.push(``);
  }
  if (zt.baseline && zt.baseline.previousGeneratedAt && Object.keys(zt.baseline.deltas).length > 0) {
    lines.push(`=== PERIOD-OVER-PERIOD CHANGE (vs report generated ${zt.baseline.previousGeneratedAt}) ===`);
    for (const [field, d] of Object.entries(zt.baseline.deltas)) {
      if (d.changePct !== null && Math.abs(d.changePct) >= 5) {
        lines.push(`${field}: ${d.previous} → ${d.current} (${d.changePct > 0 ? "+" : ""}${d.changePct}%)`);
      }
    }
    lines.push(``);
  }
  if (zt.aiAppUsage && zt.aiAppUsage.uniqueApps > 0) {
    lines.push(`=== GENERATIVE AI (SHADOW AI) USAGE ===`);
    lines.push(`GenAI apps discovered: ${zt.aiAppUsage.uniqueApps} (e.g. ${zt.aiAppUsage.apps.slice(0,3).map((a) => a.name).join(", ")})`);
    lines.push(`Requests to GenAI tools: ${fmt(zt.aiAppUsage.totalRequests)}, Users: ${fmt(zt.aiAppUsage.uniqueUsers)}`);
    lines.push(`Gateway policy governing GenAI traffic: ${zt.aiAppUsage.hasGovernancePolicy ? "yes" : "NO — ungoverned"}`);
    lines.push(``);
  }
  lines.push(`=== RISK SIGNALS ===`);
  if (zt.accessPolicies.filter((p) => p.requireMfa).length === 0) lines.push(`✗ No MFA required on any Access policy — accounts can be compromised with just a password`);
  if (gatewayPolicies.filter((p) => p.ruleType === "dns" && p.action === "block").length < 3) lines.push(`✗ Fewer than 3 DNS blocking policies — malware/phishing categories not blocked at DNS layer`);
  if (summary.warpEnrolledDevices === 0) lines.push(`✗ No WARP-enrolled devices — no device posture enforcement, no egress filtering`);
  if (gatewayPolicies.filter((p) => p.ruleType === "http").length === 0) lines.push(`✗ No HTTP Gateway policies — shadow IT and web-borne threats pass uninspected`);
  if (zt.dlpProfiles.length === 0) lines.push(`✗ No DLP profiles — sensitive data can be exfiltrated without detection`);
  if (summary.tunnelsTotal === 0) lines.push(`✗ No Cloudflare Tunnels — internal resources likely exposed via traditional VPN or public IP`);
  if (zt.aiAppUsage && zt.aiAppUsage.uniqueApps > 0 && !zt.aiAppUsage.hasGovernancePolicy)
    lines.push(`✗ ${zt.aiAppUsage.uniqueApps} generative AI app(s) in use with no Gateway policy or DLP profile governing GenAI traffic — data exfiltration risk via public AI models`);
  if (summary.warpEnrolledDevices > 0 && summary.warpOfflineDevices > summary.warpOnlineDevices)
    lines.push(`✗ ${summary.warpOfflineDevices} of ${summary.warpEnrolledDevices} enrolled WARP devices were not connected most recently in this period — unprotected while offline`);
  if (summary.seatsTotal > 0 && summary.seatsNeverLoggedIn / summary.seatsTotal > 0.3)
    lines.push(`✗ ${summary.seatsNeverLoggedIn} of ${summary.seatsTotal} provisioned seats have never logged in — licensing waste and stale-account risk`);
  lines.push(``);
  if (isPoc) {
    lines.push(`=== RECOMMENDATIONS ===`);
    lines.push(`${highRecs.length} HIGH priority, ${medRecs.length} MEDIUM priority.`);
    for (const r of [...highRecs.slice(0,3), ...medRecs.slice(0,2)]) {
      lines.push(`[${r.priority.toUpperCase()}] ${r.title}: ${r.benefit}`);
    }
    lines.push(``);
  }
  lines.push(isPoc
    ? `REMINDER: Always say "${periodLabel}" — never "30-day" unless days = 30.`
    : `REMINDER: Always say "${periodLabel}" — never "30-day" unless days = 30. Never use the words "POC" or "Proof-of-Concept".`);

  return { system, user: lines.join("\n") };
}

export async function handleZTSummary(c: Context<{ Bindings: Env }>) {
  let body: unknown;
  try { body = await c.req.json(); } catch { return c.json({ error: "Invalid JSON body" }, 400); }

  const zt = (body as Record<string, unknown>)["zerotrust"] as ZeroTrustData | undefined;
  if (!zt) return c.json({ error: "Missing zerotrust field" }, 400);
  const isPoc = (body as Record<string, unknown>)["isPoc"] !== false;

  try {
    const summary = await generateZtSummary(c.env, zt, isPoc);
    return c.json({ ok: true, summary });
  } catch (err) {
    console.error("Workers AI error:", err);
    return c.json({ error: "AI summary generation failed", detail: String(err) }, 500);
  }
}

// ─── Summary Generation ────────────────────────────────────────────────────────
// Shared by the POST /api/zt-summary route and the scheduled report email runner.
// Throws when every model attempt returns an empty/truncated response — the
// route converts that into a real 500 (so the web UI shows an explicit "AI
// summary unavailable" error instead of silently rendering a blank
// executive-summary section); the scheduler wraps this call in its own
// .catch() and sends the email without a summary rather than failing the send.

// A real 5-paragraph, 420-520 word summary is always several hundred
// characters. Anything drastically shorter is a truncated/degenerate
// completion (confirmed live: one run returned a 90-character sentence
// fragment with no ending punctuation) rather than a real short-but-valid
// answer — treated as a failure so the next fallback attempt is tried
// instead of silently shipping a broken partial summary.
const MIN_VALID_SUMMARY_LENGTH = 300;

export async function generateZtSummary(env: Env, zt: ZeroTrustData, isPoc: boolean): Promise<string> {
  const { system, user } = buildZtPrompt(zt, isPoc);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const ai = env.AI as any;

  async function attempt(model: string, maxTokens: number): Promise<string> {
    try {
      const res = await ai.run(model, {
        messages: [{ role: "system", content: system }, { role: "user", content: user }],
        max_tokens: maxTokens, temperature: 0.25,
      });
      let out = "";
      if (typeof res?.response === "string") out = res.response.trim();
      else if (Array.isArray(res?.choices)) out = (res.choices[0]?.message?.content ?? "").trim();
      if (out.length < MIN_VALID_SUMMARY_LENGTH) {
        console.warn(`[AI] ${model} returned empty/truncated (${out.length} chars):`, JSON.stringify(res)?.slice(0, 500));
        return "";
      }
      return out;
    } catch (err) {
      console.warn(`[AI] ${model} threw:`, String(err));
      return "";
    }
  }

  // glm-5.3-flash and gpt-oss-120b are both reasoning models — their
  // `reasoning` output counts against max_tokens before they ever write the
  // final `content`. Confirmed live (wrangler tail) that even a 3000-token
  // budget can still be exhausted mid-reasoning on some prompt variants
  // (finish_reason: "length", content: null) — non-deterministically, since
  // retrying the identical payload sometimes succeeds. Try three different
  // model families in order rather than accepting a truncated/empty result.
  let text = await attempt("@cf/zai-org/glm-5.3-flash", 3000);
  if (!text) text = await attempt("@cf/openai/gpt-oss-120b", 3000);
  if (!text) text = await attempt("@cf/meta/llama-3.3-70b-instruct-fp8-fast", 2000);

  if (!text) throw new Error("All Workers AI attempts returned an empty or truncated response");

  return text;
}
