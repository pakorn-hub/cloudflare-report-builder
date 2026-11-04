/**
 * POST /api/appsec
 * Accepts { token, zoneId, accountId } — fetches all AppSec data from
 * Cloudflare Zone REST API + Zone Analytics GraphQL.
 * Fully stateless — no data stored anywhere.
 */

import type { Context } from "hono";
import type { Env, ReportRangeMode } from "../types";
import { fetchAppSecConfig, fetchEmailSecurity, fetchDnsRecordsEnriched, getCustomWafRules, type CfCertPack, type CfRuleset, type CfRateLimit } from "../services/cf-rest";
import {
  last30Days,
  lastCalendarMonth, lastPeriodRange,
  fetchHttpRequestsTimeSeries,
  fetchHttpRequestsHourly,
  fetchHttpErrorTimeSeries,
  fetchWafTimeSeries,
  fetchWafTopRules,
  fetchWafAttackScoreBreakdown,
  fetchWafTopCountries,
  fetchWafTopPaths,
  fetchBotTimeSeries,
  fetchCacheStatusBreakdown,
  fetchTlsVersionBreakdown,
  fetchTlsKeyExchangeBreakdown,
  isPqcKeyExchangeGroup,
  isUnknownKeyExchangeGroup,
  fetchHttpProtocolBreakdown,
  fetchDdosTimeSeries,
  fetchDdosVectors,
  // Phase 1
  fetchCountryDistribution,
  fetchBrowserBreakdown,
  fetchDeviceBreakdown,
  fetchHttpMethodBreakdown,
  fetchHttpStatusSummary,
  // Phase 2
  fetchTtfbTimeSeries,
  fetchEdgeColoDistribution,
  // Phase 3
  fetchTopThreatIps,
  fetchTopThreatAsns,
  fetchTopUserAgents,
  // Phase 4
  fetchContentTypeBreakdown,
  // Phase 5
  fetchTopReferrers,
  fetchTopHttpHostnames,
  // DNS
  fetchDnsRecordSummary,
  fetchDnsQueryTypeBreakdown,
  fetchDnsQueryTimeSeries,
  fetchTopDnsHostnames,
  // Enterprise POC
  fetchWafScoreAllTraffic,
  fetchSecurityEventsByService,
  fetchVerifiedBotCategories,
  // Dashboard parity
  fetchSourceBrowsers,
  fetchSourceOs,
  fetchJa3Fingerprints,
  fetchJa4Fingerprints,
  fetchSourceAsns,
  // New dashboard-parity queries
  fetchTopClientIps,
  fetchTopXRequestedWith,
  fetchDashboardSparklines,
  // API Shield / API traffic
  fetchApiTrafficTimeSeries,
  fetchApiTopPaths,
  fetchApiMethodBreakdown,
  fetchApiStatusBreakdown,
  fetchWafAttackClassification,
  fetchWafRuleEffectiveness,
  fetchNxdomainHotspots,
  // API Shield — Endpoint Labeling Service (risk labels + business-function labels)
  fetchWebAssetLabels,
  // Suspicious Activity — Account Takeover
  fetchAccountTakeoverActivity,
  fetchWafPerVectorAttackScore,
  fetchAiSecurityDetections,
  fetchLeakedCredentialCheckResults,
  fetchContentScanResults,
  // AI Crawler analytics
  fetchAiCrawlerTimeSeries,
  fetchAiCrawlerBots,
  fetchAiCrawlerStatusBreakdown,
  fetchAiCrawlerTopPaths,
  fetchAiReferralTraffic,
  customDateRange,
  type ReportPeriod,
} from "../services/cf-graphql";
import {
  getApiShieldOperations,
  getApiShieldSchemas,
  getApiShieldJwtConfigs,
  getLowTrafficOperations,
  getApiShieldLabels,
  getApiOperationsTotalCount,
  getDiscoveryOperationsReviewCount,
  getDiscoveryOperationsLabelCounts,
  getManagedDetectionDeployment,
  getManagedRuleCategoriesMap,
  getLeakedCredentialCheckStatus,
  getLeakedCredentialCheckDetections,
  getContentScanningStatus,
  getAiSecurityStatus,
  getAiSecurityCustomTopics,
  AI_SECURITY_LOG_MODE_RULESET_ID,
  getOperationsByIds,
  type ApiOperation,
  type ApiShieldLabel,
} from "../services/cf-rest";
import type { AppSecData, CertificateInfo, WafManagedRule, RateLimitRule } from "../types";

// ─── Validate Input ────────────────────────────────────────────────────────────

const ALLOWED_DAYS = [1, 3, 5, 7, 14, 30] as const;

function validateInput(body: unknown):
  | { token: string; zoneId: string; accountId: string; days: number; tzOffset: number; rangeMode: ReportRangeMode; sinceDate?: string; untilDate?: string; sinceTime?: string; untilTime?: string; monthsAgo?: number; period?: ReportPeriod }
  | { error: string }
  | null {
  if (!body || typeof body !== "object") return null;
  const { token, zoneId, accountId, days, tzOffset, rangeMode, sinceDate, untilDate, sinceTime, untilTime, monthsAgo, period } = body as Record<string, unknown>;
  if (typeof token !== "string" || !token.trim()) return null;
  if (typeof zoneId !== "string" || !/^[a-f0-9]{32}$/.test(zoneId)) return null;
  if (typeof accountId !== "string" || !/^[a-f0-9]{32}$/.test(accountId)) return null;
  // Validate days — must be one of the allowed values, default 30
  const parsedDays = typeof days === "number" ? days : parseInt(String(days), 10);
  const validDays = ALLOWED_DAYS.includes(parsedDays as typeof ALLOWED_DAYS[number]) ? parsedDays : 30;
  // Validate tzOffset — minutes offset from UTC (negative = ahead, positive = behind)
  // e.g. GMT+7 = -420, GMT-5 = 300. Clamp to ±840 (±14 hours)
  const parsedTz = typeof tzOffset === "number" ? tzOffset : parseInt(String(tzOffset ?? "0"), 10);
  const validTz = isNaN(parsedTz) ? 0 : Math.max(-840, Math.min(840, parsedTz));
  const validRangeMode: ReportRangeMode =
    rangeMode === "calendar_month" ? "calendar_month" :
    rangeMode === "custom" ? "custom" :
    rangeMode === "period" ? "period" :
    "rolling";

  if (validRangeMode === "custom") {
    if (typeof sinceDate !== "string" || typeof untilDate !== "string")
      return { error: 'rangeMode "custom" requires sinceDate and untilDate (YYYY-MM-DD, local to tzOffset).' };
    // Optional intra-day bounds — undefined means whole days (00:00 → 23:59).
    const st = typeof sinceTime === "string" ? sinceTime : undefined;
    const et = typeof untilTime === "string" ? untilTime : undefined;
    if (!customDateRange(sinceDate, untilDate, validTz, st, et))
      return { error: `Invalid custom range ${JSON.stringify(sinceDate)} → ${JSON.stringify(untilDate)}${st || et ? ` (${JSON.stringify(st ?? "00:00")}–${JSON.stringify(et ?? "23:59")})` : ""}: dates must exist, start ≤ end, end not in the future, valid HH:MM times, span 1–366 days.` };
    return { token: token.trim(), zoneId, accountId, days: validDays, tzOffset: validTz, rangeMode: "custom", sinceDate, untilDate, ...(st ? { sinceTime: st } : {}), ...(et ? { untilTime: et } : {}) };
  }

  if (validRangeMode === "calendar_month") {
    const parsedMonthsAgo = typeof monthsAgo === "number" ? Math.round(monthsAgo) : parseInt(String(monthsAgo ?? "1"), 10);
    if (isNaN(parsedMonthsAgo) || parsedMonthsAgo < 1 || parsedMonthsAgo > 12)
      return { error: "monthsAgo must be an integer 1–12 when rangeMode is calendar_month." };
    return { token: token.trim(), zoneId, accountId, days: validDays, tzOffset: validTz, rangeMode: "calendar_month", monthsAgo: parsedMonthsAgo };
  }

  if (validRangeMode === "period") {
    if (period !== "yesterday" && period !== "last_week" && period !== "last_month")
      return { error: 'rangeMode "period" requires period: "yesterday", "last_week" or "last_month".' };
    return { token: token.trim(), zoneId, accountId, days: validDays, tzOffset: validTz, rangeMode: "period", period };
  }

  return { token: token.trim(), zoneId, accountId, days: validDays, tzOffset: validTz, rangeMode: "rolling" };
}

// ─── Transform Helpers ────────────────────────────────────────────────────────

function transformCerts(certPacks: CfCertPack[]): CertificateInfo[] {
  const now = Date.now();
  return certPacks.map((pack) => {
    const firstCert = pack.certificates?.[0];
    const expiresOn = firstCert?.expires_on ?? "";
    const expiryMs = expiresOn ? new Date(expiresOn).getTime() : 0;
    const daysUntilExpiry = expiryMs
      ? Math.ceil((expiryMs - now) / (1000 * 60 * 60 * 24))
      : -1;
    return {
      id: pack.id,
      hosts: pack.hosts ?? [],
      type: pack.type,
      status: pack.status,
      expiresOn,
      daysUntilExpiry,
    };
  });
}

function transformRateLimits(rules: CfRateLimit[]): RateLimitRule[] {
  return rules.map((r) => ({
    id: r.id,
    description: r.description ?? "",
    threshold: r.threshold,
    period: r.period,
    action: r.action?.mode ?? "unknown",
    enabled: !r.disabled,
  }));
}

function extractWafManagedRules(rulesets: CfRuleset[]): WafManagedRule[] {
  // The GET /zones/{zone}/rulesets list endpoint returns summary objects —
  // the `rules` array is NOT populated (only available on individual ruleset GET).
  //
  // Key insight: a ruleset present in the zone's ruleset list IS deployed/active.
  // Cloudflare's model: you enable a managed ruleset by deploying it to the zone
  // entrypoint ruleset. The list endpoint reflects what is deployed.
  //
  // Ruleset kinds:
  //   "managed" = Cloudflare-provided managed ruleset (OWASP, CF Managed, etc.)
  //   "zone"    = User-created zone ruleset (custom firewall rules, rate limits, etc.)
  //   "root"    = Zone entrypoint ruleset (orchestrates others)
  //
  // We show ALL rulesets so the user can see what's deployed.
  // "enabled" = true for all since presence in list = deployed.
  // We just exclude internal/irrelevant ones (root phase rulesets).
  return rulesets
    .filter((rs) => {
      const phase = rs.phase ?? "";
      const kind  = rs.kind ?? "";
      // Include: managed rulesets, zone custom rulesets, SBFM, cache, transform
      // Exclude: root entrypoints (they're orchestrators, not security rules themselves)
      return kind !== "root" && phase !== "http_config_settings";
    })
    .map((rs) => ({
      id: rs.id,
      name: rs.name,
      phase: rs.phase,
      // Present in list = deployed = enabled
      enabled: true,
    }));
}

// ─── Route Handler ────────────────────────────────────────────────────────────

export async function handleFetchAppsec(c: Context<{ Bindings: Env }>) {
  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: "Invalid JSON body" }, 400);
  }

  const input = validateInput(body);
  if (!input || "error" in input) {
    return c.json(
      {
        error:
          (input && "error" in input && input.error) ||
          "Missing or invalid fields. Required: token (string), zoneId (32-char hex), accountId (32-char hex)",
      },
      400
    );
  }

  const appsec = await generateAppsecData(input);
  return c.json({ ok: true, appsec });
}

// ─── Report Generation ────────────────────────────────────────────────────────
// Shared by the POST /api/appsec route and the scheduled report email runner.

export async function generateAppsecData(input: {
  token: string;
  zoneId: string;
  accountId: string;
  days: number;
  tzOffset: number;
  /** "calendar_month" reports a full calendar month (28-31 days, whichever
   *  the month actually has) instead of a fixed rolling window — `days` above
   *  is ignored in that mode. "custom" reports an explicit user-selected
   *  date range (`sinceDate`/`untilDate`, local to tzOffset) — `days` is
   *  ignored in that mode too. Defaults to "rolling". */
  rangeMode?: ReportRangeMode;
  /** rangeMode "calendar_month": which month — 1 = last month (default),
   *  2 = the month before that, etc. (1..12). */
  monthsAgo?: number;
  /** rangeMode "period": the last COMPLETE period, computed at run time in
   *  tzOffset's timezone — yesterday / last_week (Mon–Sun) / last_month.
   *  `days` is ignored in this mode. */
  period?: ReportPeriod;
  /** rangeMode "custom": first day, YYYY-MM-DD local. */
  sinceDate?: string;
  /** rangeMode "custom": last day, YYYY-MM-DD local (inclusive; may be today). */
  untilDate?: string;
  /** rangeMode "custom": optional intra-day start bound, HH:MM local. Default 00:00. */
  sinceTime?: string;
  /** rangeMode "custom": optional intra-day end bound, HH:MM local (inclusive minute). Default 23:59. */
  untilTime?: string;
}): Promise<AppSecData> {
  const { token, zoneId, accountId, tzOffset, rangeMode = "rolling" } = input;

  // "calendar_month" reports the previous FULL calendar month (its real
  // 28-31 days) instead of a fixed rolling window ending now — `input.days`
  // is ignored in that mode. `calendarPeriodLabel` (e.g. "August 2026")
  // overrides the default "N-Day" periodLabel further down when set.
  // "custom" reports an explicit user-selected range with the same shape.
  // All three modes return {since, until, untilQuery, sinceTs, untilTs,
  // days, periodLabel} so the rest of the pipeline is mode-agnostic.
  type DatedRange = ReturnType<typeof last30Days>;
  const dateRange: DatedRange =
    rangeMode === "calendar_month" ? (lastCalendarMonth(tzOffset, input.monthsAgo ?? 1) as unknown as DatedRange)
    : rangeMode === "period"
      ? (lastPeriodRange(input.period ?? "yesterday", tzOffset) as unknown as DatedRange)
    : rangeMode === "custom"
      ? ((input.sinceDate && input.untilDate
          ? customDateRange(input.sinceDate, input.untilDate, tzOffset, input.sinceTime, input.untilTime)
          : null) ?? last30Days(input.days, tzOffset))
    : last30Days(input.days, tzOffset);
  const since      = dateRange.since;       // YYYY-MM-DD display start date (local)
  const until      = dateRange.until;       // YYYY-MM-DD display end date — today, or last day of the target month
  const untilQuery = dateRange.untilQuery;  // YYYY-MM-DD for date_lt in httpRequests1dGroups (daily datasets)
  const sinceTs    = dateRange.sinceTs;     // ISO timestamp for datetime_geq in adaptive/hourly queries
  const untilTs    = dateRange.untilTs;     // ISO timestamp for datetime_leq — exact "now", or end of the target month
  const days       = dateRange.days;
  const calendarPeriodLabel = dateRange.periodLabel; // e.g. "August 2026" / "Sep 1–15, 2026" / "7-Day"

  // Every request-level breakdown (all *AdaptiveGroups datasets, sampled
  // like Cloudflare's own dashboard) takes the exact sinceTs/untilTs
  // instants — following the selected window precisely, local-day
  // boundaries and intra-day HH:MM bounds included. Only the two chart
  // datasets that are pre-aggregated into whole days keep date strings:
  // httpRequests1dGroups (daily overview) and its error series.
  const errors: Record<string, string> = {};

  // ── 1. REST config (parallel) ───────────────────────────────────────────────
  const config = await fetchAppSecConfig(token, zoneId);

  // Zone name fallback
  const zoneName = config.zone?.name ?? zoneId;

  // ── 1b. Email security (DoH lookup — no auth rate-limit) ─────────────────────
  const emailSecurityResult = await fetchEmailSecurity(token, zoneId, zoneName).catch(() => null);

  // ── 1c. DNS records with ASN enrichment ───────────────────────────────────────
  // Runs A/AAAA IP → ASN lookups via RIPE Stat (public API, parallel batches)
  const dnsRecordsEnrichedResult = await fetchDnsRecordsEnriched(token, zoneId).catch(() => []);

  // ── 1d. Custom WAF + Rate Limit rules with full expressions ──────────────────
  const customWafRules = await getCustomWafRules(token, zoneId).catch(() => []);

  // ── 1e. Managed WAF ruleset deployment + real rule categories ────────────────
  // Finds which managed rulesets (OWASP Core, Cloudflare Managed, Sensitive
  // Data Detection, legacy Exposed Credentials Check) are actually deployed
  // via the zone's phase entrypoint rulesets, then fetches full rule bodies
  // for the request-phase managed rulesets to build a ruleId → categories
  // map — Cloudflare's own attack classification, not a regex guess.
  const managedDetectionDeployment = await getManagedDetectionDeployment(token, zoneId).catch(() => ({
    sensitiveDataDetectionDeployed: false,
    legacyExposedCredentialsDeployed: false,
    requestPhaseManagedRulesetIds: [] as string[],
  }));
  const managedRuleCategoriesMap = await getManagedRuleCategoriesMap(
    token, zoneId, managedDetectionDeployment.requestPhaseManagedRulesetIds
  ).catch(() => new Map<string, string[]>());

  // ── 2. GraphQL analytics (all parallel, individual failures captured) ───────
  const [
    httpSeriesR,
    errorSeriesR,
    wafSeriesR,
    wafTopRulesR,
    wafAttackScoreR,
    wafTopCountriesR,
    wafTopPathsR,
    botSeriesR,
    cacheBreakdownR,
    tlsBreakdownR,
    tlsKeyExchangeR,
    httpProtocolR,
    ddosSeriesR,
    ddosVectorsR,
    // Phase 1
    countryDistributionR,
    browserBreakdownR,
    deviceBreakdownR,
    httpMethodBreakdownR,
    httpStatusSummaryR,
    // Phase 2
    ttfbSeriesR,
    edgeColoR,
    // Phase 3
    topThreatIpsR,
    topThreatAsnsR,
    topUserAgentsR,
    // Phase 4
    contentTypeR,
    // Phase 5
    topReferrersR,
    topHttpHostnamesR,
    // DNS
    dnsRecordSummaryR,
    dnsQueryTypeR,
    dnsQueryTimeSeriesR,
    dnsTopHostnamesR,
    // Enterprise POC
    wafScoreAllTrafficR,
    secEventsByServiceR,
    verifiedBotCatsR,
    // Dashboard parity
    sourceBrowsersR,
    sourceOsR,
    ja3R,
    ja4R,
    sourceAsnsR,
    // New dashboard-parity queries
    topClientIpsR,
    topXRequestedWithR,
    dashboardSparklinesR,
    // API Shield / API traffic analytics
    apiTrafficSeriesR,
    apiTopPathsR,
    apiMethodsR,
    apiStatusR,
    apiOperationsR,
    apiSchemasR,
    apiJwtConfigsR,
    lowTrafficOpsR,
    webAssetLabelsR,
    wafAttackClassifR,
    wafRuleEffectR,
    nxdomainHotspotsR,
    // API Shield — authoritative (traffic-window-independent) label counts
    apiShieldLabelsR,
    apiOperationsTotalCountR,
    discoveryReviewCountR,
    // Leaked Credential Check / Content Scanning / AI Security for Apps
    leakedCredentialStatusR,
    leakedCredentialDetectionsR,
    contentScanningStatusR,
    aiSecurityStatusR,
    aiSecurityCustomTopicsR,
    // Suspicious Activity — Account Takeover
    accountTakeoverR,
    wafPerVectorScoreR,
    aiSecurityDetectionsR,
    leakedCredentialResultsR,
    contentScanResultsR,
    // AI Crawler analytics
    aiCrawlerSeriesR,
    aiCrawlerBotsR,
    aiCrawlerStatusR,
    aiCrawlerTopPathsR,
    aiReferralTrafficR,
  ] = await Promise.allSettled([
    // For short windows (≤ 1 day), use hourly granularity to match the CF dashboard.
    // For longer windows, daily groups are more efficient (fewer API rows).
    days <= 1
      ? fetchHttpRequestsHourly(token, zoneId, sinceTs, untilTs)
      : fetchHttpRequestsTimeSeries(token, zoneId, since, untilQuery),
    fetchHttpErrorTimeSeries(token, zoneId, since, untilQuery),
    fetchWafTimeSeries(token, zoneId, sinceTs, untilTs),
    fetchWafTopRules(token, zoneId, sinceTs, untilTs, 10),
    fetchWafAttackScoreBreakdown(token, zoneId, sinceTs, untilTs, 20),
    fetchWafTopCountries(token, zoneId, sinceTs, untilTs, 10),
    fetchWafTopPaths(token, zoneId, sinceTs, untilTs, 10),
    fetchBotTimeSeries(token, zoneId, sinceTs, untilTs),
    fetchCacheStatusBreakdown(token, zoneId, sinceTs, untilTs),
    fetchTlsVersionBreakdown(token, zoneId, sinceTs, untilTs),
    fetchTlsKeyExchangeBreakdown(token, zoneId, sinceTs, untilTs),
    fetchHttpProtocolBreakdown(token, zoneId, sinceTs, untilTs),
    fetchDdosTimeSeries(token, zoneId, sinceTs, untilTs),
    fetchDdosVectors(token, zoneId, sinceTs, untilTs, 10),
    // Phase 1
    fetchCountryDistribution(token, zoneId, sinceTs, untilTs, 20),
    fetchBrowserBreakdown(token, zoneId, sinceTs, untilTs, 10),
    fetchDeviceBreakdown(token, zoneId, sinceTs, untilTs),
    fetchHttpMethodBreakdown(token, zoneId, sinceTs, untilTs, 10),
    fetchHttpStatusSummary(token, zoneId, sinceTs, untilTs),
    // Phase 2
    fetchTtfbTimeSeries(token, zoneId, sinceTs, untilTs),
    fetchEdgeColoDistribution(token, zoneId, sinceTs, untilTs, 15),
    // Phase 3
    fetchTopThreatIps(token, zoneId, sinceTs, untilTs, 20),
    fetchTopThreatAsns(token, zoneId, sinceTs, untilTs, 10),
    fetchTopUserAgents(token, zoneId, sinceTs, untilTs, 15),
    // Phase 4
    fetchContentTypeBreakdown(token, zoneId, sinceTs, untilTs, 15),
    // Phase 5
    fetchTopReferrers(token, zoneId, sinceTs, untilTs, 20),
    fetchTopHttpHostnames(token, zoneId, sinceTs, untilTs, 50),
    // DNS
    fetchDnsRecordSummary(token, zoneId),
    fetchDnsQueryTypeBreakdown(token, accountId, zoneId, sinceTs, untilTs, 15),
    fetchDnsQueryTimeSeries(token, accountId, zoneId, sinceTs, untilTs),
    fetchTopDnsHostnames(token, accountId, zoneId, sinceTs, untilTs, 30),
    // Enterprise POC
    fetchWafScoreAllTraffic(token, zoneId, sinceTs, untilTs),
    fetchSecurityEventsByService(token, zoneId, sinceTs, untilTs, 30),
    fetchVerifiedBotCategories(token, zoneId, sinceTs, untilTs, 20),
    // Dashboard parity
    fetchSourceBrowsers(token, zoneId, sinceTs, untilTs, 10),
    fetchSourceOs(token, zoneId, sinceTs, untilTs, 10),
    fetchJa3Fingerprints(token, zoneId, sinceTs, untilTs, 10),
    fetchJa4Fingerprints(token, zoneId, sinceTs, untilTs, 10),
    fetchSourceAsns(token, zoneId, sinceTs, untilTs, 10),
    // New dashboard-parity queries — use exact UTC timestamps (matches dashboard ZapSparkline)
    fetchTopClientIps(token, zoneId, sinceTs, untilTs, 25),
    fetchTopXRequestedWith(token, zoneId, sinceTs, untilTs, 10),
    fetchDashboardSparklines(token, zoneId, sinceTs, untilTs),
    // API Shield / API traffic analytics
    fetchApiTrafficTimeSeries(token, zoneId, sinceTs, untilTs),
    fetchApiTopPaths(token, zoneId, sinceTs, untilTs, 15),
    fetchApiMethodBreakdown(token, zoneId, sinceTs, untilTs),
    fetchApiStatusBreakdown(token, zoneId, sinceTs, untilTs),
    getApiShieldOperations(token, zoneId, 25),
    getApiShieldSchemas(token, zoneId),
    getApiShieldJwtConfigs(token, zoneId),
    // Least-trafficked operations — zombie API candidates (sort=asc)
    getLowTrafficOperations(token, zoneId, 50),
    // Endpoint Labeling Service — risk labels (zombie/auth/BOLA/sensitive) + business-function labels (login/signup/purchase/etc.)
    // NOTE: fetchWebAssetLabels (like every adaptive-dataset query in this
    // pipeline) uses datetime_geq/datetime_leq, which require full ISO8601
    // timestamps — passing date-only strings was the exact root cause of
    // this query always throwing "not an iso8601 time" (previously hidden by
    // the function's own try/catch before that was removed for visibility).
    fetchWebAssetLabels(token, zoneId, sinceTs, untilTs),
    // New intelligence queries (from cf-reporting patterns)
    fetchWafAttackClassification(token, zoneId, sinceTs, untilTs, managedRuleCategoriesMap),
    fetchWafRuleEffectiveness(token, zoneId, sinceTs, untilTs, 15),
    fetchNxdomainHotspots(token, accountId, zoneId, sinceTs, untilTs, 15),
    // API Shield — authoritative label counts (matches dashboard Web Assets numbers,
    // independent of the traffic query window — see getApiShieldLabels() docs)
    getApiShieldLabels(token, zoneId),
    getApiOperationsTotalCount(token, zoneId),
    getDiscoveryOperationsReviewCount(token, zoneId),
    // Leaked Credential Check (replaces the dead `leakedCredentials` stub) +
    // Content Scanning (Malicious Uploads) + AI Security for Apps status
    getLeakedCredentialCheckStatus(token, zoneId),
    getLeakedCredentialCheckDetections(token, zoneId),
    getContentScanningStatus(token, zoneId),
    getAiSecurityStatus(token, zoneId),
    getAiSecurityCustomTopics(token, zoneId),
    // Suspicious Activity — real detection data, all confirmed via live
    // GraphQL introspection against a real Cloudflare account (2026-09-01).
    // All use datetime_geq/datetime_leq — require full ISO8601 timestamps.
    fetchAccountTakeoverActivity(token, zoneId, sinceTs, untilTs, 15),
    fetchWafPerVectorAttackScore(token, zoneId, sinceTs, untilTs),
    fetchAiSecurityDetections(token, zoneId, sinceTs, untilTs),
    fetchLeakedCredentialCheckResults(token, zoneId, sinceTs, untilTs),
    fetchContentScanResults(token, zoneId, sinceTs, untilTs),
    // AI Crawler analytics — user-agent based detection (works on all plans,
    // matches Cloudflare's own AI Crawl Control GraphQL API documentation)
    fetchAiCrawlerTimeSeries(token, zoneId, sinceTs, untilTs),
    fetchAiCrawlerBots(token, zoneId, sinceTs, untilTs, 100),
    fetchAiCrawlerStatusBreakdown(token, zoneId, sinceTs, untilTs),
    fetchAiCrawlerTopPaths(token, zoneId, sinceTs, untilTs, 15),
    fetchAiReferralTraffic(token, zoneId, sinceTs, untilTs),
  ]);

  const safeGet = <T>(r: PromiseSettledResult<T>, key: string, fallback: T): T => {
    if (r.status === "fulfilled") return r.value;
    errors[key] = r.reason?.message ?? String(r.reason);
    return fallback;
  };

  const httpSeries = safeGet(httpSeriesR, "httpSeries", []);
  const errorSeries = safeGet(errorSeriesR, "errorSeries", []);
  const wafSeries = safeGet(wafSeriesR, "wafSeries", []);
  const wafTopRules = safeGet(wafTopRulesR, "wafTopRules", []);
  const wafAttackScore = safeGet(wafAttackScoreR, "wafAttackScore", []);
  const wafTopCountries = safeGet(wafTopCountriesR, "wafTopCountries", []);
  const wafTopPaths = safeGet(wafTopPathsR, "wafTopPaths", []);
  const botSeries = safeGet(botSeriesR, "botSeries", []);
  const cacheBreakdown = safeGet(cacheBreakdownR, "cacheBreakdown", []);
  const tlsBreakdown = safeGet(tlsBreakdownR, "tlsBreakdown", []);
  const tlsKeyExchange = safeGet(tlsKeyExchangeR, "tlsKeyExchange", []);
  const httpProtocol = safeGet(httpProtocolR, "httpProtocol", []);
  const ddosSeries = safeGet(ddosSeriesR, "ddosSeries", []);
  const ddosVectors = safeGet(ddosVectorsR, "ddosVectors", []);
  // Phase 1
  const countryDistributionRaw = safeGet(countryDistributionR, "countryDistribution", []);
  const browserBreakdownRaw = safeGet(browserBreakdownR, "browserBreakdown", []);
  const deviceBreakdownRaw = safeGet(deviceBreakdownR, "deviceBreakdown", []);
  const httpMethodBreakdownRaw = safeGet(httpMethodBreakdownR, "httpMethodBreakdown", []);
  const httpStatusSummaryRaw = safeGet(httpStatusSummaryR, "httpStatusSummary", {
    e1xx: 0, e2xx: 0, e3xx: 0, e4xx: 0, e5xx: 0, total: 0,
  });
  // Phase 2
  const ttfbSeries = safeGet(ttfbSeriesR, "ttfbSeries", []);
  const edgeColo = safeGet(edgeColoR, "edgeColo", []);
  // Phase 3
  const topThreatIps = safeGet(topThreatIpsR, "topThreatIps", []);
  const topThreatAsns = safeGet(topThreatAsnsR, "topThreatAsns", []);
  const topUserAgents = safeGet(topUserAgentsR, "topUserAgents", []);
  // Phase 4
  const contentTypeRaw = safeGet(contentTypeR, "contentType", []);
  // Phase 5
  const topReferrersRaw = safeGet(topReferrersR, "topReferrers", { topHosts: [], categoryTotals: { direct: 0, search: 0, social: 0, referral: 0 } });
  const topHttpHostnames = safeGet(topHttpHostnamesR, "topHttpHostnames", []);
  // Enterprise POC
  const wafScoreAllTraffic = safeGet(wafScoreAllTrafficR, "wafScoreAllTraffic", []);
  const securityEventsByService = safeGet(secEventsByServiceR, "secEventsByService", []);
  const verifiedBotCategories = safeGet(verifiedBotCatsR, "verifiedBotCats", []);
  // Dashboard parity
  const sourceBrowsers = safeGet(sourceBrowsersR, "sourceBrowsers", []);
  const sourceOs = safeGet(sourceOsR, "sourceOs", []);
  const ja3Fingerprints = safeGet(ja3R, "ja3", []);
  const ja4Fingerprints = safeGet(ja4R, "ja4", []);
  const sourceAsns = safeGet(sourceAsnsR, "sourceAsns", []);
  // New dashboard-parity data
  const topClientIps = safeGet(topClientIpsR, "topClientIps", []);
  const topXRequestedWith = safeGet(topXRequestedWithR, "topXRequestedWith", []);
  const dashboardSparklines = safeGet(dashboardSparklinesR, "dashboardSparklines", []);
  // API Shield / API traffic
  const apiTrafficSeries = safeGet(apiTrafficSeriesR, "apiTrafficSeries", []);
  const apiTopPaths       = safeGet(apiTopPathsR, "apiTopPaths", []);
  const apiMethods        = safeGet(apiMethodsR, "apiMethods", []);
  const apiStatus         = safeGet(apiStatusR, "apiStatus", []);
  const apiOperations          = safeGet(apiOperationsR,      "apiOperations",      []);
  const apiSchemas             = safeGet(apiSchemasR,         "apiSchemas",         []);
  const apiJwtConfigs          = safeGet(apiJwtConfigsR,      "apiJwtConfigs",      []);
  const lowTrafficOps          = safeGet(lowTrafficOpsR,      "lowTrafficOps",      [] as ApiOperation[]);
  const webAssetLabels         = safeGet(webAssetLabelsR,     "webAssetLabels",     { riskLabels: [], useCaseLabels: [], riskyOperationLabels: {}, zombieOperationIds: [] });
  const wafAttackClassification= safeGet(wafAttackClassifR,   "wafAttackClassif",   []);
  const wafRuleEffectiveness   = safeGet(wafRuleEffectR,      "wafRuleEffect",      []);
  const nxdomainHotspots       = safeGet(nxdomainHotspotsR,  "nxdomainHotspots",   []);
  // API Shield — authoritative label counts + discovery
  const apiShieldLabelsRest    = safeGet(apiShieldLabelsR,    "apiShieldLabels",    [] as ApiShieldLabel[]);
  const apiOperationsFullStateCount = safeGet(apiOperationsTotalCountR, "apiOperationsTotalCount", 0);
  const discoveryPendingReviewCount = safeGet(discoveryReviewCountR, "discoveryPendingReviewCount", 0);

  // ── Dashboard parity — candidate-state (discovered, unsaved) label counts ──
  // `getApiShieldLabels()`/`getApiOperationsTotalCount()` above ONLY reflect
  // "full" (saved) state operations. Cloudflare's dashboard Web Assets page
  // counts BOTH "full" AND "candidate" (discovered-but-not-saved) operations
  // together for its totals and use-case label chips (confirmed live via a
  // captured dashboard API call: candidate 1370 + full 832 = total 2202
  // exactly) — this is why `cf-api-endpoint`/`cf-log-in`/`cf-web-page`
  // undercounted vs the dashboard while every `cf-risk-*` label matched
  // exactly (risk labels are only ever applied by Cloudflare's scan to
  // SAVED endpoints, so they never need this candidate merge). Paginates
  // the discovery/candidate operations list (capped) to tally real
  // candidate-state label counts, since the public API has no per-label
  // aggregate for that state.
  const candidateLabelCountsResult = await getDiscoveryOperationsLabelCounts(
    token, zoneId, discoveryPendingReviewCount
  ).catch(() => ({ labelCounts: new Map<string, number>(), coveredCount: 0, truncated: false }));
  const candidateLabelCounts = candidateLabelCountsResult.labelCounts;
  // True total matching the dashboard's "Operations" count (full + candidate).
  const apiOperationsTotalCount = apiOperationsFullStateCount + discoveryPendingReviewCount;
  // Leaked Credential Check / Content Scanning / AI Security for Apps
  const leakedCredentialStatus     = safeGet(leakedCredentialStatusR, "leakedCredentialStatus", null as { enabled?: boolean } | null);
  const leakedCredentialDetections = safeGet(leakedCredentialDetectionsR, "leakedCredentialDetections", [] as Array<{ id?: string; username?: string; password?: string }>);
  const contentScanningStatusRaw   = safeGet(contentScanningStatusR, "contentScanningStatus", null as { value?: string } | null);
  const aiSecurityStatusRaw        = safeGet(aiSecurityStatusR, "aiSecurityStatus", null as { enabled?: boolean } | null);
  const aiSecurityCustomTopics     = safeGet(aiSecurityCustomTopicsR, "aiSecurityCustomTopics", [] as Array<{ label: string; topic: string }>);
  const aiSecurityLogModeDeployed  = managedDetectionDeployment.requestPhaseManagedRulesetIds.includes(AI_SECURITY_LOG_MODE_RULESET_ID);
  // Suspicious Activity
  const accountTakeover = safeGet(accountTakeoverR, "accountTakeover", { totalRequests: 0, topPaths: [] as Array<{ host: string; path: string; requests: number }> });
  const wafPerVectorScore = safeGet(wafPerVectorScoreR, "wafPerVectorScore", { scoredCount: 0, avgSqliScore: null as number | null, avgXssScore: null as number | null, avgRceScore: null as number | null, avgPathTraversalScore: null as number | null });
  const aiSecurityDetections = safeGet(aiSecurityDetectionsR, "aiSecurityDetections", {
    scannedCount: 0, piiDetectedCount: 0, piiCategoryBreakdown: [] as Array<{ category: string; count: number }>,
    unsafeTopicDetectedCount: 0, unsafeTopicCategoryBreakdown: [] as Array<{ category: string; count: number }>,
    injectionScoreBands: { high: 0, moderate: 0, low: 0 }, avgInjectionScore: null as number | null,
  });
  const leakedCredentialResults = safeGet(leakedCredentialResultsR, "leakedCredentialResults", {
    totalChecked: 0, byResult: [] as Array<{ result: string; count: number }>, breachedCount: 0,
  });
  const contentScanResults = safeGet(contentScanResultsR, "contentScanResults", {
    totalScannedRequests: 0, requestsWithMaliciousObject: 0, scanFailedCount: 0, objResultsBreakdown: [] as Array<{ result: string; count: number }>,
  });

  // ── API Shield — Risk & business-function label resolution ──────────────────
  // PRIMARY source: `apiShieldLabelsRest` (REST `/api_gateway/labels?with_mapped_resource_counts=true`)
  // — Cloudflare's own persisted, traffic-window-INDEPENDENT count of operations
  // per label (recomputed by a 24h risk scan). This is the same number shown on
  // the dashboard's Web Assets page. GraphQL `webAssetLabels` only reflects
  // labels seen on traffic within the queried date range, which under-reports
  // (or shows nothing) whenever labeled operations had no traffic this period
  // — the exact bug that made this section appear "mostly empty" previously.
  //
  // Labels are classified DYNAMICALLY by prefix ("cf-risk-*" = risk,
  // any other "cf-*" = use-case/managed label) from the UNION of every label
  // name Cloudflare actually returned (REST + GraphQL) — never against a
  // hardcoded allowlist. A fixed list is fragile by construction: it
  // silently drops any label added/renamed later (confirmed on a real zone:
  // the high-volume "cf-api-endpoint" label was missing from the original
  // allowlist entirely, and "cf-risk-error-anomaly" was misspelled — the
  // real label is "cf-risk-errors-anomaly").
  // IMPORTANT: store `undefined` (not 0) when the REST response has no
  // `mapped_resources` for a label, so we can distinguish "REST said zero"
  // from "REST didn't tell us" — a previous version stored a literal `0`
  // here, which is NOT nullish, so the fallback below never kicked in even
  // when REST's count was missing.
  //
  // Precedence: REST is the AUTHORITATIVE, persisted, dashboard-matching
  // source whenever it reports a defined count — always prefer it, even
  // when it's smaller than the GraphQL figure. GraphQL's per-label
  // `operationIds.length` is a distinct-operation count observed over a
  // rolling 30-day TRAFFIC window, which can legitimately be LARGER than
  // REST's current persisted snapshot for very broadly-applied labels (e.g.
  // "cf-api-endpoint" — confirmed live: REST/dashboard showed ~1.8K but a
  // naive `Math.max(rest, graphql)` incorrectly surfaced GraphQL's ~2.2K
  // rolling-window figure instead of the REST number matching the
  // dashboard). GraphQL is used ONLY as a fallback when REST has no entry
  // for that label at all.
  const restLabelCountMap = new Map<string, number | undefined>();
  for (const l of apiShieldLabelsRest) {
    restLabelCountMap.set(l.name, l.mapped_resources?.operation);
  }
  const allObservedLabelNames = new Set<string>([
    ...apiShieldLabelsRest.map((l) => l.name),
    ...webAssetLabels.riskLabels.map((r) => r.label),
    ...webAssetLabels.useCaseLabels.map((r) => r.label),
    ...candidateLabelCounts.keys(),
  ]);
  // Risk labels (`cf-risk-*`) are ONLY ever applied by Cloudflare's scan to
  // SAVED ("full" state) endpoints — never merge in the candidate count for
  // these, matching Cloudflare's own methodology (confirmed live: every
  // cf-risk-* label already matched the dashboard exactly using the
  // full-state-only REST count alone).
  const resolveOperationCount = (label: string, gqlRow: { operationIds: string[] } | undefined) => {
    const restCount = restLabelCountMap.get(label);
    return restCount ?? gqlRow?.operationIds.length ?? 0;
  };
  // Use-case/classification labels CAN be applied to candidate (discovered,
  // unsaved) operations too — merge in the real candidate-state count
  // (from paginating the discovery list) to match the dashboard's combined
  // full+candidate total for these labels.
  const resolveUseCaseOperationCount = (label: string, gqlRow: { operationIds: string[] } | undefined) =>
    resolveOperationCount(label, gqlRow) + (candidateLabelCounts.get(label) ?? 0);
  const apiRiskLabels = Array.from(allObservedLabelNames)
    .filter((name) => name.startsWith("cf-risk-"))
    .map((label) => {
      const gqlRow = webAssetLabels.riskLabels.find((r) => r.label === label);
      return {
        label,
        operationCount: resolveOperationCount(label, gqlRow),
        requests: gqlRow?.requests ?? 0, // traffic volume this period (context only)
      };
    })
    .filter((r) => r.operationCount > 0 || r.requests > 0)
    .sort((a, b) => b.operationCount - a.operationCount);
  const apiUseCaseLabels = Array.from(allObservedLabelNames)
    .filter((name) => name.startsWith("cf-") && !name.startsWith("cf-risk-"))
    .map((label) => {
      const gqlRow = webAssetLabels.useCaseLabels.find((r) => r.label === label);
      return {
        label,
        operationCount: resolveUseCaseOperationCount(label, gqlRow),
        requests: gqlRow?.requests ?? 0,
      };
    })
    .filter((r) => r.operationCount > 0 || r.requests > 0)
    .sort((a, b) => b.operationCount - a.operationCount);

  // ── API Shield — Zombie API detection ────────────────────────────────────────
  // Authoritative total comes DIRECTLY from the raw REST label list (not the
  // already-filtered `apiRiskLabels`, which drops zero-count labels) — read
  // `mapped_resources.operation` for "cf-risk-zombie" whenever REST reported
  // it at all (even a real 0), and only fall back to the heuristic sample
  // count below when REST gave no signal (e.g. the call failed entirely).
  //
  // The sample (`apiZombieEndpoints`, from the REST operations list sorted
  // by lowest traffic first) is used ONLY to show specific example endpoints
  // in the table — it is NOT reliable as a count on its own: it flags any
  // operation whose `features.thresholds.requests` is 0, but that field is
  // the rate-limit-threshold-suggestion estimate, which can simply be
  // unpopulated (defaulting to 0) for operations with real, recent traffic
  // that haven't accumulated enough data for that specific feature —
  // confirmed live: on a 37-operation zone with 18 REAL zombies (per REST),
  // this heuristic incorrectly flagged all 37 as zero-traffic.
  const restZombieCount = apiShieldLabelsRest.find((l) => l.name === "cf-risk-zombie")?.mapped_resources?.operation;
  const ZOMBIE_THRESHOLD_MS = 32 * 24 * 60 * 60 * 1000;
  const nowMs = Date.now();
  const apiZombieEndpoints = lowTrafficOps
    .filter((op) => {
      const lastUpdatedMs = op.last_updated ? new Date(op.last_updated).getTime() : 0;
      const requestsTotal = op.features?.thresholds?.requests ?? 0;
      return requestsTotal === 0 || (lastUpdatedMs > 0 && nowMs - lastUpdatedMs > ZOMBIE_THRESHOLD_MS);
    })
    .map((op) => ({
      operationId: op.operation_id,
      method: op.method,
      endpoint: op.endpoint,
      host: op.host,
      lastUpdated: op.last_updated,
      requestsTotal: op.features?.thresholds?.requests ?? 0,
    }));
  const apiZombieEndpointsTotalCount = restZombieCount ?? apiZombieEndpoints.length;

  // Build an operation_id → {method, endpoint, host} map from all fetched
  // operation lists (top-traffic + low-traffic) to resolve human-readable
  // paths for the operation IDs returned by the Endpoint Labeling Service.
  // This REST sample only covers ~75 operations (25 top-traffic + 50
  // low-traffic), while the Endpoint Labeling Service (GraphQL, limit 5000)
  // can return risk labels for hundreds of distinct operation IDs — most of
  // which fall outside that small sample and would otherwise render as
  // "(unresolved: xxxxxxxx…)" in the At-Risk Endpoints table. Fixed below by
  // resolving the specific IDs that will actually be displayed via direct
  // per-ID REST lookups, instead of trying to resolve the full (potentially
  // hundreds-large) set.
  const operationMap = new Map<string, { method: string; endpoint: string; host: string }>();
  for (const op of [...apiOperations, ...lowTrafficOps] as ApiOperation[]) {
    operationMap.set(op.operation_id, { method: op.method, endpoint: op.endpoint, host: op.host });
  }
  const RISKY_ENDPOINTS_DISPLAY_LIMIT = 15; // must match the UI's .slice(0, 15)
  const riskyOperationEntries = Object.entries(webAssetLabels.riskyOperationLabels);
  const unresolvedDisplayedIds = riskyOperationEntries
    .slice(0, RISKY_ENDPOINTS_DISPLAY_LIMIT)
    .map(([operationId]) => operationId)
    .filter((id) => !operationMap.has(id));
  if (unresolvedDisplayedIds.length > 0) {
    const resolvedById = await getOperationsByIds(token, zoneId, unresolvedDisplayedIds).catch(
      () => new Map<string, ApiOperation>()
    );
    for (const [id, op] of resolvedById) {
      operationMap.set(id, { method: op.method, endpoint: op.endpoint, host: op.host });
    }
  }
  const apiRiskyEndpoints = riskyOperationEntries.map(([operationId, labels]) => {
    const resolved = operationMap.get(operationId);
    return {
      operationId,
      method: resolved?.method ?? "",
      endpoint: resolved?.endpoint ?? `(unresolved: ${operationId.slice(0, 8)}…)`,
      host: resolved?.host ?? "",
      labels,
    };
  });
  // AI Crawler analytics
  const aiCrawlerTimeSeries    = safeGet(aiCrawlerSeriesR,    "aiCrawlerSeries",    []);
  const aiCrawlerBots          = safeGet(aiCrawlerBotsR,      "aiCrawlerBots",      []);
  const aiCrawlerStatusRaw     = safeGet(aiCrawlerStatusR,    "aiCrawlerStatus",    []);
  const aiCrawlerTopPaths      = safeGet(aiCrawlerTopPathsR,  "aiCrawlerTopPaths",  []);
  const aiReferralTraffic      = safeGet(aiReferralTrafficR,  "aiReferralTraffic",  []);

  // DNS
  const dnsRecordSummary = safeGet(dnsRecordSummaryR, "dnsRecordSummary", {
    totalRecords: 0, proxiedCount: 0, dnsOnlyCount: 0, byType: [],
  });
  const dnsQueryTypeBreakdown = safeGet(dnsQueryTypeR, "dnsQueryType", []);
  const dnsQueryTimeSeries = safeGet(dnsQueryTimeSeriesR, "dnsQueryTimeSeries", []);
  const dnsTopHostnames = safeGet(dnsTopHostnamesR, "dnsTopHostnames", []);

  // ── 3. Compute summary KPIs from time-series ─────────────────────────────────
  const totalRequests = httpSeries.reduce((s, d) => s + d.requests, 0);
  const totalCachedRequests = httpSeries.reduce((s, d) => s + d.cachedRequests, 0);
  const totalBytes = httpSeries.reduce((s, d) => s + d.bytes, 0);
  const totalCachedBytes = httpSeries.reduce((s, d) => s + d.cachedBytes, 0);
  const totalThreats = httpSeries.reduce((s, d) => s + d.threats, 0);

  const totalWafBlocked = wafSeries.reduce(
    (s, d) => s + d.block + d.challenge + d.managed_challenge,
    0
  );
  const totalDdosMitigated = ddosSeries.reduce((s, d) => s + d.mitigated, 0);

  // Cache hit rate (request-based: % of requests served from cache)
  const cacheHitRatePct =
    totalRequests > 0 ? Math.round((totalCachedRequests / totalRequests) * 100) : 0;

  // Cache hit rate (bandwidth-based: % of bytes served from cache — shows cost savings)
  const cacheBandwidthHitRatePct =
    totalBytes > 0 ? Math.round((totalCachedBytes / totalBytes) * 100) : 0;

  // Bot score summary — official Cloudflare groupings:
  //   0     = Not computed (Bot Management not active / request not scored)
  //   1     = Automated
  //   2–29  = Likely automated
  //   30–99 = Likely human
  //
  // human = total - automated - likelyAutomated
  //   Bot Mgmt not active → automated=0, likelyAutomated=0 → human=totalRequests
  //   Bot Mgmt active     → subtract the two bot bands
  const totalBotRequests  = botSeries.reduce((s, d) => s + d.botRequests, 0);
  const totalLikelyBot    = botSeries.reduce((s, d) => s + d.likelyBotRequests, 0);
  const totalScoredHuman  = botSeries.reduce((s, d) => s + d.humanRequests, 0);

  // ── 4. Build cache time-series from daily httpRequests ────────────────────
  const cacheTimeSeries = httpSeries.map((d) => ({
    date: d.date,
    hit: d.cachedRequests,
    miss: d.uncachedRequests,
    expired: 0,
    bypass: 0,
    revalidated: 0,
  }));

  // ── 5. Cache status pie enrichment ───────────────────────────────────────────
  const cacheTotal = cacheBreakdown.reduce((s, r) => s + r.requests, 0);
  const cacheStatusBreakdown = cacheBreakdown.map((r) => ({
    status: r.cacheStatus,
    requests: r.requests,
    bytes: r.bytes,
    pct: cacheTotal > 0 ? Math.round((r.requests / cacheTotal) * 100) : 0,
  }));

  // ── 6. TLS pie ────────────────────────────────────────────────────────────────
  const tlsTotal = tlsBreakdown.reduce((s, r) => s + r.requests, 0);
  const tlsVersionBreakdown = tlsBreakdown.map((r) => ({
    version: r.tlsVersion,
    requests: r.requests,
    pct: tlsTotal > 0 ? Math.round((r.requests / tlsTotal) * 100) : 0,
  }));

  // ── 6b. Post-Quantum Cryptography (PQC) key exchange adoption ────────────────
  // Hybrid PQC groups (X25519MLKEM768 / X25519Kyber768Draft00) combine a
  // classical ECDH exchange with a quantum-resistant KEM. Cloudflare enables
  // these on the edge by default — adoption reflects client (browser) support.
  //
  // IMPORTANT: Cloudflare reports the literal group "UNK" for requests where
  // no key exchange group applies at all (plaintext HTTP, TLS 1.2 static/
  // non-ephemeral ciphers, resumed sessions). That bucket is real but NOT
  // relevant to PQC adoption — including it in the denominator understates
  // adoption and clutters the breakdown with an unexplained "UNK" label.
  // We compute the adoption rate against the "applicable" subset (requests
  // that negotiated a real key exchange group) and separately report what
  // fraction of traffic even had one.
  const tlsKeyExchangeTotal = tlsKeyExchange.reduce((s, r) => s + r.requests, 0);
  const tlsKeyExchangeUnknownRequests = tlsKeyExchange
    .filter((r) => isUnknownKeyExchangeGroup(r.group))
    .reduce((s, r) => s + r.requests, 0);
  const tlsKeyExchangeApplicableTotal = tlsKeyExchangeTotal - tlsKeyExchangeUnknownRequests;

  const tlsKeyExchangeBreakdown = tlsKeyExchange
    .map((r) => ({
      group: r.group,
      requests: r.requests,
      pct: tlsKeyExchangeTotal > 0 ? Math.round((r.requests / tlsKeyExchangeTotal) * 1000) / 10 : 0,
      isPqc: isPqcKeyExchangeGroup(r.group),
      isUnknown: isUnknownKeyExchangeGroup(r.group),
    }))
    .sort((a, b) => b.requests - a.requests);

  const pqcRequests = tlsKeyExchangeBreakdown.filter((r) => r.isPqc).reduce((s, r) => s + r.requests, 0);
  // Adoption rate among handshakes where a key exchange group actually applies.
  const pqcAdoptionPct = tlsKeyExchangeApplicableTotal > 0
    ? Math.round((pqcRequests / tlsKeyExchangeApplicableTotal) * 1000) / 10
    : 0;
  // What fraction of all traffic even negotiated a key exchange group (context metric).
  const pqcApplicableCoveragePct = tlsKeyExchangeTotal > 0
    ? Math.round((tlsKeyExchangeApplicableTotal / tlsKeyExchangeTotal) * 1000) / 10
    : 0;

   // ── 7. Bot score pie ──────────────────────────────────────────────────────────
   // Official Cloudflare bot score buckets (confirmed from dashboard):
   //   1     = Automated
   //   2–29  = Likely automated
   //   30–99 = Likely human
   //   0     = Not computed (Bot Management not active / request not scored)
   //
   // totalBotRequests  = score 1    (Automated)
   // totalLikelyBot    = score 2–29 (Likely automated)
   // totalScoredHuman  = score 30–99 (Likely human) — direct from GraphQL
   //
   // If Bot Management is not active, all three GraphQL bands return 0.
   // In that case we show a single "Unscored" bucket = totalRequests.
   const botDataPresent = totalBotRequests + totalLikelyBot + totalScoredHuman > 0;
   const botDenominator = botDataPresent
     ? Math.max(totalBotRequests + totalLikelyBot + totalScoredHuman, 1)
     : 1;
   const botScoreBreakdown = botDataPresent
     ? [
         {
           scoreRange: "Automated (Score 1)",
           requests: totalBotRequests,
           pct: Math.round((totalBotRequests / botDenominator) * 100),
         },
         {
           scoreRange: "Likely Automated (Score 2–29)",
           requests: totalLikelyBot,
           pct: Math.round((totalLikelyBot / botDenominator) * 100),
         },
         {
           scoreRange: "Likely Human (Score 30–99)",
           requests: totalScoredHuman,
           pct: Math.round((totalScoredHuman / botDenominator) * 100),
         },
       ].filter((b) => b.requests > 0)
     : [
         {
           scoreRange: "Unscored (Bot Mgmt not active)",
           requests: totalRequests,
           pct: 100,
         },
       ];

  // Robust numeric percentages — computed directly from the known score
  // bands rather than string-matching `botScoreBreakdown[].scoreRange`
  // labels (e.g. `.includes("Bot")`). That pattern is fragile: the real
  // labels are "Automated (Score 1)" / "Likely Automated (Score 2–29)" /
  // "Likely Human (Score 30–99)" — none contain the substring "Bot" except
  // the Bot-Management-inactive fallback "Unscored (Bot Mgmt not active)".
  // Matching on "Bot" therefore always returns 0% on any zone with real,
  // active Bot Management data — exactly backwards from the intended
  // behaviour. Use these numeric fields everywhere instead of re-deriving
  // percentages by searching `scoreRange` strings.
  const automatedPct        = botDataPresent ? Math.round((totalBotRequests / botDenominator) * 100) : 0;
  const likelyAutomatedPct  = botDataPresent ? Math.round((totalLikelyBot / botDenominator) * 100) : 0;
  const humanPct            = botDataPresent ? Math.round((totalScoredHuman / botDenominator) * 100) : 100;
  const botTrafficPct       = automatedPct + likelyAutomatedPct;

  // ── 7b. AI Crawler summary — Generative AI bot/crawler traffic ──────────────
  const totalAiCrawlerRequests = aiCrawlerBots.reduce((s, b) => s + b.requests, 0);
  const totalAiCrawlerBytes = aiCrawlerBots.reduce((s, b) => s + b.bytes, 0);
  const aiCrawlerCategoryTotals = new Map<string, number>();
  for (const b of aiCrawlerBots) {
    aiCrawlerCategoryTotals.set(b.category, (aiCrawlerCategoryTotals.get(b.category) ?? 0) + b.requests);
  }
  // Status breakdown — mirrors AI Crawl Control's "allowed vs unsuccessful" split.
  // 2xx = allowed, 402 = payment required, 403 = blocked, other 4xx/5xx = error.
  let aiAllowedRequests = 0, aiBlockedRequests = 0, aiPaymentRequiredRequests = 0, aiOtherErrorRequests = 0;
  for (const r of aiCrawlerStatusRaw) {
    if (r.status >= 200 && r.status < 300) aiAllowedRequests += r.requests;
    else if (r.status === 402) aiPaymentRequiredRequests += r.requests;
    else if (r.status === 403) aiBlockedRequests += r.requests;
    else aiOtherErrorRequests += r.requests;
  }
  const aiCrawlerSummary = {
    totalRequests: totalAiCrawlerRequests,
    totalBandwidthBytes: totalAiCrawlerBytes,
    pctOfTotal: totalRequests > 0 ? Math.round((totalAiCrawlerRequests / totalRequests) * 1000) / 10 : 0,
    uniqueBots: aiCrawlerBots.length,
    topBot: aiCrawlerBots[0]?.botName ?? null,
    allowedRequests: aiAllowedRequests,
    blockedRequests: aiBlockedRequests,
    paymentRequiredRequests: aiPaymentRequiredRequests,
    otherErrorRequests: aiOtherErrorRequests,
    categoryBreakdown: Array.from(aiCrawlerCategoryTotals.entries())
      .map(([category, requests]) => ({ category, requests }))
      .sort((a, b) => b.requests - a.requests),
  };

  // ── 8. WAF top rules — enrich with human-readable names ──────────────────────
  const ruleNameMap = config.wafRuleNames as Map<string, string>;
  const wafTopRulesMapped = wafTopRules.map((r) => ({
    ruleId: r.ruleId,
    // Prefer GraphQL description (managed rule name), then REST name, then source
    description: r.description || (ruleNameMap.get(r.ruleId) ?? r.source),
    ruleName: r.description || (ruleNameMap.get(r.ruleId) ?? null),
    action: r.action,
    source: r.source,
    rulesetId: r.rulesetId,
    kind: r.kind,
    count: r.count,
  }));

  const wafTopCountriesMapped = wafTopCountries.map((r) => ({
    country: r.country,
    countryName: r.country,
    count: r.count,
  }));

  // Paths now include hostname for full URL display
  const wafTopPathsMapped = wafTopPaths.map((r) => ({
    host: r.host,
    path: r.path,
    url: r.url,
    count: r.count,
  }));

  // ── 9. DDoS vectors ───────────────────────────────────────────────────────────
  const ddosAttackVectors = ddosVectors.map((r) => ({
    vector: r.vector,
    count: r.count,
  }));

  // ── 10. Certificates ──────────────────────────────────────────────────────────
  const certificates = transformCerts(config.certs as CfCertPack[]);

  // ── 11. Rate limits & WAF managed rules ───────────────────────────────────────
  const rateLimitRules = transformRateLimits(config.rateLimits as CfRateLimit[]);
  const wafManagedRules = extractWafManagedRules(config.rulesets as CfRuleset[]);

  // ── 12. Error time-series ────────────────────────────────────────────────────
  const errorTimeSeries = errorSeries.map((d) => ({
    date: d.date,
    e2xx: d.e2xx,
    e3xx: d.e3xx,
    e4xx: d.e4xx,
    e5xx: d.e5xx,
  }));

  // ── 13. Bandwidth time-series ─────────────────────────────────────────────────
  const bandwidthTimeSeries = httpSeries.map((d) => ({
    date: d.date,
    totalBytes: d.bytes,
    cachedBytes: d.cachedBytes,
    uncachedBytes: d.bytes - d.cachedBytes,
  }));

  // ── 14. Requests time-series (simple daily count) ────────────────────────────
  const requestsTimeSeries = httpSeries.map((d) => ({
    date: d.date,
    value: d.requests,
  }));

  // ── 15. Cost savings analysis ─────────────────────────────────────────────────
  // Based on industry-average origin bandwidth cost ($0.09/GB for AWS/GCP egress)
  const ORIGIN_BW_COST_PER_GB = 0.09;
  const originBandwidthSavedGB = totalCachedBytes / 1e9;
  const monthlySavings = Math.round(originBandwidthSavedGB * ORIGIN_BW_COST_PER_GB);
  const annualSavings = monthlySavings * 12;
  const originLoadReductionPct =
    totalRequests > 0 ? Math.round((totalCachedRequests / totalRequests) * 100) : 0;

  // ── AWS Equivalent Cost Comparison (full stack: security + CDN + DNS) ────────
  // Source: AWS public pricing 2024/2025, us-east-1.
  // PURPOSE: Show what a customer would pay if they chose AWS instead of Cloudflare.
  // No Cloudflare pricing shown — this is purely a competitor cost reference.
  //
  // Security:
  //   AWS WAF:          $5/WebACL + $1/M requests + $1/M rule evaluations
  //   AWS Shield Adv:   $3,000/month flat (L7 DDoS; Standard is free but limited)
  //   AWS Bot Control:  $10+$10/month base + $1/M requests each group
  //   AWS Rate Limiting: ~$0.60/M requests (rate-based WAF rules)
  //   AWS Firewall Mgr: $100/month per policy
  //
  // CDN (CloudFront equivalent):
  //   $0.0085/10K HTTPS requests (first 10M/month) + $0.09/GB egress
  //
  // DNS (Route 53 equivalent):
  //   $0.50/hosted zone/month + $0.40/M queries (first 1B) + $0.60/M for health checks

  // ── Pricing table per user-provided data (corrected) ─────────────────────
  // Source: Provided pricing table 2024/2025
  // DNS:     Route 53 $0.50/zone/mo + $0.40/M queries
  // CDN:     CloudFront $0 base + $0.085/GB egress + $0.01/10K requests
  // WAF:     $5/ACL/mo + $1/M rule eval + $0.60/M requests
  // DDoS:    Shield Advanced $3,000/mo flat
  // Bot:     Bot Control $10/mo + $1/M requests

  const periodDays = days;
  const scaleFactor = 30 / Math.max(periodDays, 1); // scale POC data → monthly

  // Monthly estimates from actual POC data
  const monthlyReqM     = (totalRequests * scaleFactor) / 1_000_000; // millions
  const monthlyBytesGB  = (totalBytes * scaleFactor) / 1e9;           // GB
  const monthlyDnsQueriesM = monthlyReqM * 1.5; // DNS ≈ 1.5× HTTP requests

  // AWS pricing per corrected table
  const awsCosts = {
    // ── DNS ─────────────────────────────────────────────────────────────────
    dns: {
      label: "AWS Route 53 (DNS)",
      category: "dns" as const,
      baseFee: 0.50,                                      // $0.50/hosted zone/mo
      perRequestFee: parseFloat((monthlyDnsQueriesM * 0.40).toFixed(2)), // $0.40/M queries
      total: Math.round(0.50 + monthlyDnsQueriesM * 0.40),
      note: "$0.50/hosted zone + $0.40 per 1M DNS queries",
      what: "Authoritative DNS (Route 53)",
      cfNote: "$0 — Unmetered DNS included in all plans",
    },
    // ── CDN ─────────────────────────────────────────────────────────────────
    cdn: {
      label: "AWS CloudFront (CDN)",
      category: "cdn" as const,
      baseFee: 0,                                         // $0 base
      perRequestFee: parseFloat((monthlyReqM * 1.0).toFixed(2)),  // $0.01/10K = $1/M
      dataTransferFee: parseFloat((monthlyBytesGB * 0.085).toFixed(2)), // $0.085/GB
      total: Math.round(monthlyReqM * 1.0 + monthlyBytesGB * 0.085),
      note: "$0.085/GB egress + $0.01 per 10,000 HTTP requests",
      what: "Content Delivery Network (CloudFront)",
      cfNote: "Unmetered bandwidth + requests — standard web traffic",
    },
    // ── WAF ──────────────────────────────────────────────────────────────────
    waf: {
      label: "AWS WAF",
      category: "security" as const,
      baseFee: 5,                                         // $5/WebACL/mo
      perRequestFee: parseFloat((monthlyReqM * 0.60).toFixed(2)),  // $0.60/M requests
      ruleEvalFee: parseFloat((1.0).toFixed(2)),          // $1/rule/mo (est. 1 rule)
      total: Math.round(5 + 1 + monthlyReqM * 0.60),
      note: "$5/ACL + $1/rule/mo + $0.60 per 1M requests",
      what: "Web Application Firewall — managed + custom rules",
      cfNote: "Included in Pro ($25/mo) / Business ($250/mo) / Enterprise",
    },
    // ── DDoS ─────────────────────────────────────────────────────────────────
    ddos: {
      label: "AWS Shield Advanced",
      category: "security" as const,
      baseFee: 3000,                                      // $3,000/mo flat
      perRequestFee: 0,
      total: 3000,
      note: "$3,000/month flat — L3/L4/L7 DDoS (Advanced); Standard is free but L7 limited",
      what: "Advanced DDoS Protection — L3/L4/L7",
      cfNote: "$0 — Unmetered L3/L4/L7 DDoS protection included in all plans",
    },
    // ── Bot ───────────────────────────────────────────────────────────────────
    botManagement: {
      label: "AWS Bot Control",
      category: "security" as const,
      baseFee: 10,                                        // $10/mo base
      perRequestFee: parseFloat((monthlyReqM * 1.0).toFixed(2)),  // $1/M requests
      total: Math.round(10 + monthlyReqM * 1.0),
      note: "$10/mo + $1.00 per 1M requests",
      what: "Bot detection and management",
      cfNote: "Included in Pro / Business / Enterprise",
    },
  };

  // Category totals
  const awsDnsTotal      = awsCosts.dns.total;
  const awsCdnTotal      = awsCosts.cdn.total;
  const awsSecurityTotal = awsCosts.waf.total + awsCosts.ddos.total + awsCosts.botManagement.total;
  const awsTotalMonthly  = awsDnsTotal + awsCdnTotal + awsSecurityTotal;
  const awsTotalAnnual   = awsTotalMonthly * 12;

  const cfSavingsVsAws       = awsTotalMonthly;
  const cfSavingsVsAwsAnnual = awsTotalAnnual;

  const costSavings = {
    // CDN / bandwidth savings
    monthlyBandwidthSavings: monthlySavings,
    annualBandwidthSavings: annualSavings,
    originBandwidthSavedGB: Math.round(originBandwidthSavedGB * 10) / 10,
    originRequestsAvoided: totalCachedRequests,
    originLoadReductionPct,
    // Competitor cost reference (AWS equivalent full stack)
    awsCosts,
    awsTotalMonthly,
    awsTotalAnnual,
    awsSecurityTotal,
    awsCdnTotal,
    awsDnsTotal,
    cfSavingsVsAws,
    cfSavingsVsAwsAnnual,
    monthlyRequestsM: Math.round(monthlyReqM * 10) / 10,
  };

  // ── Phase 1 enrichment ───────────────────────────────────────────────────────

  // Country distribution (already sorted by requests desc from query fn)
  const countryDistribution = countryDistributionRaw.map((r) => ({
    clientCountryName: r.clientCountryName,
    requests: r.requests,
    bytes: r.bytes,
    threats: r.threats,
  }));

  // Browser breakdown with percentages
  const browserTotal = browserBreakdownRaw.reduce((s, r) => s + r.requests, 0);
  const browserBreakdown = browserBreakdownRaw.map((r) => ({
    uaBrowserFamily: r.uaBrowserFamily,
    requests: r.requests,
    pct: browserTotal > 0 ? Math.round((r.requests / browserTotal) * 100) : 0,
  }));

  // Device breakdown with percentages
  const deviceTotal = deviceBreakdownRaw.reduce((s, r) => s + r.requests, 0);
  const deviceBreakdown = deviceBreakdownRaw.map((r) => ({
    clientDeviceType: r.clientDeviceType,
    requests: r.requests,
    pct: deviceTotal > 0 ? Math.round((r.requests / deviceTotal) * 100) : 0,
  }));

  // HTTP method breakdown with percentages
  const methodTotal = httpMethodBreakdownRaw.reduce((s, r) => s + r.requests, 0);
  const httpMethodBreakdown = httpMethodBreakdownRaw.map((r) => ({
    method: r.method,
    requests: r.requests,
    pct: methodTotal > 0 ? Math.round((r.requests / methodTotal) * 100) : 0,
  }));

  // HTTP status summary is already computed by the query function
  const httpStatusSummary = httpStatusSummaryRaw;

  // ── Phase 2 enrichment ───────────────────────────────────────────────────────
  // TTFB time-series and edge colo are already shaped correctly
  const ttfbTimeSeries = ttfbSeries;
  const edgeColoDistribution = edgeColo;

  // ── Phase 4 enrichment ───────────────────────────────────────────────────────
  const contentTypeBreakdown = contentTypeRaw.map((r) => ({
    edgeResponseContentTypeName: r.edgeResponseContentTypeName,
    requests: r.requests,
    bytes: r.bytes,
    cachedBytes: r.cachedBytes,
    cacheHitPct: r.cacheHitPct,
  }));

  // ── Phase 5 enrichment ───────────────────────────────────────────────────────
  // `topReferrers` = compact top-N individual hosts (table display only).
  // `referrerCategoryTotals` = accurate direct/search/social/referral totals
  // computed over a much larger sample — see REFERRER_AGGREGATE_LIMIT in
  // fetchTopReferrers() for why these must NOT be derived from topReferrers.
  const topReferrers = topReferrersRaw.topHosts.map((r) => ({
    refererHost: r.refererHost,
    requests: r.requests,
    category: r.category,
  }));
  const referrerCategoryTotals = topReferrersRaw.categoryTotals;

  // ── 16. Security recommendations (with rule templates) ────────────────────────
  type RecPriority = "high" | "medium" | "low";
  type RecItem = {
    priority: RecPriority;
    title: string;
    description: string;
    benefit: string;
    ruleTemplate?: {
      type: "waf_custom" | "rate_limit" | "bot" | "transform" | "config";
      name: string;
      expression?: string;
      action?: string;
      description: string;
      cfDocs?: string;
    };
  };
  const recommendations: RecItem[] = [];

  const tlsMin = config.tlsMin?.value as string | undefined;
  const alwaysHttpsEnabled = config.alwaysHttps?.value === "on";
  const tls13On = config.tls13?.value === "on" || config.tls13?.value === "zrt";
  const settings = config.allSettings as Record<string, unknown> ?? {};
  const http3On = settings["http3"] === "on";
  const brotliOn = settings["brotli"] === "on";
  const earlyHintsOn = settings["early_hints"] === "on";

  // ── TLS / HTTPS ──────────────────────────────────────────────────────────────

  if (tlsMin && tlsMin !== "1.3") {
    recommendations.push({
      priority: "high",
      title: "Upgrade Minimum TLS to 1.3",
      description: `Current minimum TLS is ${tlsMin}. TLS 1.0/1.1 are deprecated (RFC 8996) and vulnerable to BEAST, POODLE, and LUCKY13 attacks.`,
      benefit: "Eliminates legacy cipher vulnerabilities, faster handshakes, meets PCI-DSS compliance",
      ruleTemplate: {
        type: "config",
        name: "Set Minimum TLS Version to 1.3",
        description: "Update via: Security → Settings → Minimum TLS Version → TLS 1.3",
        cfDocs: "ssl/edge-certificates/additional-options/minimum-tls/",
      },
    });
  }

  if (!alwaysHttpsEnabled) {
    recommendations.push({
      priority: "high",
      title: 'Enable "Always Use HTTPS"',
      description: "HTTP requests are not automatically redirected to HTTPS. Visitors can connect insecurely, exposing credentials and session tokens.",
      benefit: "Prevents MITM attacks, protects cookies and session data, improves Google SEO ranking",
      ruleTemplate: {
        type: "config",
        name: "Always Use HTTPS",
        description: "Enable via: SSL/TLS → Edge Certificates → Always Use HTTPS → On",
        cfDocs: "ssl/edge-certificates/additional-options/always-use-https/",
      },
    });
  }

  if (!tls13On) {
    recommendations.push({
      priority: "medium",
      title: "Enable TLS 1.3",
      description: "TLS 1.3 removes vulnerable cipher suites and reduces handshake round-trips from 2 to 1 (0-RTT for returning visitors).",
      benefit: "20-40% faster TLS handshakes, forward secrecy enforcement, improved cipher security",
      ruleTemplate: {
        type: "config",
        name: "Enable TLS 1.3",
        description: "Enable via: SSL/TLS → Edge Certificates → TLS 1.3 → On",
        cfDocs: "ssl/edge-certificates/tls-1.3/",
      },
    });
  }

  // ── Certificates ──────────────────────────────────────────────────────────────

  const expiringSoon = certificates.filter(
    (c) => c.daysUntilExpiry >= 0 && c.daysUntilExpiry < 30
  );
  if (expiringSoon.length > 0) {
    recommendations.push({
      priority: "high",
      title: `Renew ${expiringSoon.length} Expiring Certificate${expiringSoon.length > 1 ? "s" : ""}`,
      description: `${expiringSoon.length} certificate(s) expire within 30 days: ${expiringSoon.map((c) => c.hosts[0] ?? c.id).join(", ")}. Expired certs cause browser warnings and block access.`,
      benefit: "Prevents service disruption, maintains user trust, avoids security warnings",
    });
  }

  // ── Cache ─────────────────────────────────────────────────────────────────────

  if (cacheHitRatePct < 40 && totalRequests > 1000) {
    recommendations.push({
      priority: "medium",
      title: "Improve Cache Hit Rate (Currently " + cacheHitRatePct + "%)",
      description: "Cache hit rate is low. Set longer Edge Cache TTL values, create Cache Rules for static assets, and enable Tiered Cache to reduce origin load.",
      benefit: "Reduces origin load by up to 80%, improves TTFB by 50-200ms, lowers bandwidth costs",
      ruleTemplate: {
        type: "transform",
        name: "Cache Static Assets (1 Year)",
        expression: `(http.request.uri.path matches "\\.(js|css|png|jpg|jpeg|gif|ico|woff|woff2|svg)$")`,
        action: "set_cache_settings",
        description: "Cache static assets at edge for 1 year. Create via: Caching → Cache Rules",
        cfDocs: "cache/how-to/create-cache-rules/",
      },
    });
  }

  // ── Bot Management ────────────────────────────────────────────────────────────
  // Reuses the numeric botTrafficPct computed earlier (§7 Bot score pie) —
  // no need to redeclare it against a different denominator here.
  const totalBotTraffic = totalBotRequests + totalLikelyBot;

  if (botTrafficPct > 20 && totalRequests > 1000) {
    recommendations.push({
      priority: "medium",
      title: `Block High-Score Bot Traffic (${botTrafficPct}% automated)`,
      description: `${botTrafficPct}% of requests are automated (${Math.round(totalBotTraffic / 1000)}K requests). Create a custom WAF rule to challenge or block low bot-score requests that are not verified bots.`,
      benefit: "Reduce scraping, API abuse, credential stuffing, and fake account creation",
      ruleTemplate: {
        type: "waf_custom",
        name: "Block Low Bot Score Requests",
        expression: `(cf.bot_management.score lt 10 and not cf.bot_management.verified_bot)`,
        action: "block",
        description: "Blocks requests with bot score < 10 that are not verified crawlers (Google, Bing, etc.). Requires Bot Management subscription.",
        cfDocs: "bots/get-started/bot-management/",
      },
    });
  }

  // ── AI Crawlers ───────────────────────────────────────────────────────────────

  if (aiCrawlerSummary.totalRequests > 0) {
    const mostlyBlocked = aiCrawlerSummary.blockedRequests > aiCrawlerSummary.allowedRequests
      && aiCrawlerSummary.totalRequests > 0;
    recommendations.push({
      priority: mostlyBlocked ? "low" : (aiCrawlerSummary.pctOfTotal > 5 ? "medium" : "low"),
      title: mostlyBlocked
        ? `AI Crawler Traffic Already Mostly Blocked (${aiCrawlerSummary.pctOfTotal}% of requests)`
        : `Manage Generative AI Crawler Traffic (${aiCrawlerSummary.pctOfTotal}% of requests)`,
      description: mostlyBlocked
        ? `${aiCrawlerSummary.totalRequests.toLocaleString()} requests from ${aiCrawlerSummary.uniqueBots} AI crawler${aiCrawlerSummary.uniqueBots === 1 ? "" : "s"} (e.g. ${aiCrawlerSummary.topBot ?? "GPTBot"}) were detected, and most are already receiving non-2xx responses. Review the AI Crawl Control dashboard to confirm block rules match your content policy.`
        : `Detected ${aiCrawlerSummary.totalRequests.toLocaleString()} requests from ${aiCrawlerSummary.uniqueBots} AI crawler${aiCrawlerSummary.uniqueBots === 1 ? "" : "s"} (e.g. ${aiCrawlerSummary.topBot ?? "GPTBot"}) training on or referencing site content, with no explicit allow/block policy detected. Use AI Crawl Control to allow, block, or (where available) charge per crawler.`,
      benefit: "Protects content from unauthorized AI training scraping while preserving visibility for approved crawlers (e.g. search-linked AI assistants)",
      ruleTemplate: {
        type: "config",
        name: "Configure AI Crawl Control",
        description: "Go to Security → AI Crawl Control → Crawlers tab. Set Allow/Block per crawler (e.g. GPTBot, ClaudeBot, PerplexityBot, Bytespider). Optionally enable Cloudflare-managed robots.txt from the Directives tab.",
        cfDocs: "ai-crawl-control/features/manage-ai-crawlers/",
      },
    });
  }

  // ── WAF Rules ─────────────────────────────────────────────────────────────────

  const high4xx = (wafTopRules ?? []).filter((r) => r.action === "block" && r.count > 1000).length;
  if (high4xx > 0 || totalWafBlocked > 10000) {
    recommendations.push({
      priority: "medium",
      title: "Add WAF Custom Rule: Block Malicious User Agents",
      description: `Detected high WAF block volume (${Math.round(totalWafBlocked / 1000)}K events). Add a custom rule to immediately block known malicious tools and scanners by user agent.`,
      benefit: "Reduces noise in WAF logs, blocks automated attack tools before they hit managed rules",
      ruleTemplate: {
        type: "waf_custom",
        name: "Block Malicious Scanners & Tools",
        expression: `(http.user_agent contains "sqlmap") or (http.user_agent contains "nikto") or (http.user_agent contains "masscan") or (http.user_agent contains "zgrab") or (http.user_agent contains "nuclei") or (http.user_agent contains "python-requests" and http.request.method eq "POST")`,
        action: "block",
        description: "Blocks common attack tools and vulnerability scanners. Create via: Security → WAF → Custom Rules",
        cfDocs: "waf/custom-rules/",
      },
    });
  }

  if (totalWafBlocked > 50000) {
    recommendations.push({
      priority: "medium",
      title: "Enable WAF Attack Score Rule for Evasion Detection",
      description: `High WAF block volume suggests attackers may be probing. Add a custom rule using cf.waf.score to catch modified payloads that evade managed rules.`,
      benefit: "Detects fuzzing, encoding tricks, and payload mutations that bypass signature rules",
      ruleTemplate: {
        type: "waf_custom",
        name: "Block High WAF Attack Score",
        expression: `(cf.waf.score lt 20 and cf.waf.score gt 0)`,
        action: "block",
        description: "Blocks requests with WAF ML attack score below 20 (almost certainly malicious). Requires Enterprise plan.",
        cfDocs: "waf/detections/attack-score/",
      },
    });
  }

  // ── Rate Limiting ─────────────────────────────────────────────────────────────

  if (rateLimitRules.length === 0) {
    recommendations.push({
      priority: "high",
      title: "Configure Rate Limiting on Login & API Endpoints",
      description: "No rate limiting rules are configured. Login endpoints without rate limiting are vulnerable to brute-force and credential stuffing attacks.",
      benefit: "Prevents account takeovers, reduces API abuse, protects against credential stuffing",
      ruleTemplate: {
        type: "rate_limit",
        name: "Rate Limit Login Endpoint",
        expression: `(http.request.uri.path contains "/login") or (http.request.uri.path contains "/signin") or (http.request.uri.path contains "/auth")`,
        action: "block",
        description: "Limit to 5 requests per 10 seconds per IP on authentication endpoints. Create via: Security → WAF → Rate Limiting Rules",
        cfDocs: "waf/rate-limiting-rules/",
      },
    });
  } else if (rateLimitRules.length < 3) {
    recommendations.push({
      priority: "low",
      title: "Expand Rate Limiting Coverage",
      description: `Only ${rateLimitRules.length} rate limiting rule(s) configured. Add rules to protect API endpoints, password reset, and checkout flows.`,
      benefit: "Comprehensive rate limiting prevents API abuse and automated attacks across all sensitive endpoints",
      ruleTemplate: {
        type: "rate_limit",
        name: "Rate Limit API Endpoints",
        expression: `(http.request.uri.path starts_with "/api/") and (http.request.method in {"POST" "PUT" "PATCH" "DELETE"})`,
        action: "block",
        description: "Limit write operations on API endpoints to 30 requests per minute per IP.",
        cfDocs: "waf/rate-limiting-rules/",
      },
    });
  }

  // ── DDoS ─────────────────────────────────────────────────────────────────────

  if (totalDdosMitigated > 5000) {
    recommendations.push({
      priority: "medium",
      title: "Tune DDoS L7 Protection Sensitivity",
      description: `${totalDdosMitigated.toLocaleString()} DDoS events mitigated. Under sustained attack, consider overriding the DDoS managed ruleset sensitivity to 'High' and switching action to 'Block'.`,
      benefit: "Faster DDoS mitigation, reduced attack traffic reaching origin, improved uptime SLA",
      ruleTemplate: {
        type: "config",
        name: "Override DDoS Ruleset to High Sensitivity",
        description: "Security → DDoS → HTTP DDoS Attack Protection → Override → Sensitivity: High, Action: Block",
        cfDocs: "ddos-protection/managed-rulesets/http/override-parameters/",
      },
    });
  }

  // ── Email Security ────────────────────────────────────────────────────────────

  const emailInfo = emailSecurityResult;
  if (emailInfo?.dmarcPolicy === "none" && emailInfo?.dmarcRecord) {
    recommendations.push({
      priority: "high",
      title: 'Upgrade DMARC Policy from "none" to "quarantine" or "reject"',
      description: 'DMARC policy is set to "none" (monitoring only). Anyone can spoof your domain in email — no enforcement is in place.',
      benefit: "Prevents email spoofing, protects brand reputation, blocks phishing using your domain",
      ruleTemplate: {
        type: "config",
        name: "Enforce DMARC Quarantine Policy",
        expression: `v=DMARC1; p=quarantine; pct=10; rua=mailto:dmarc-reports@yourdomain.com`,
        description: "Start with p=quarantine; pct=10 (10% enforcement), monitor reports, then increase to 100% and eventually p=reject.",
        cfDocs: "email-security/dmarc-management/",
      },
    });
  }

  if (emailInfo && !emailInfo.dmarcRecord) {
    recommendations.push({
      priority: "high",
      title: "Add DMARC DNS Record",
      description: "No DMARC record found. Without DMARC, email receivers cannot enforce your authentication policy, enabling domain spoofing.",
      benefit: "Enables DMARC reporting visibility, first step to full email authentication enforcement",
      ruleTemplate: {
        type: "config",
        name: "Add DMARC TXT Record",
        expression: `v=DMARC1; p=none; rua=mailto:dmarc-reports@${emailInfo.domain}; adkim=r; aspf=r`,
        description: "Add this TXT record to _dmarc.yourdomain.com. Start with p=none for monitoring, then tighten.",
        cfDocs: "dns/manage-dns-records/how-to/create-dns-records/",
      },
    });
  }

  // ── Performance ───────────────────────────────────────────────────────────────

  if (!http3On) {
    recommendations.push({
      priority: "low",
      title: "Enable HTTP/3 (QUIC) for Better Mobile Performance",
      description: "HTTP/3 is disabled. QUIC-based transport reduces connection overhead and improves performance on lossy networks (mobile, satellite).",
      benefit: "15-30% faster page loads on mobile, eliminates head-of-line blocking, better performance on packet loss",
      ruleTemplate: {
        type: "config",
        name: "Enable HTTP/3",
        description: "Enable via: Speed → Optimization → Protocol Optimization → HTTP/3 (with QUIC) → On",
        cfDocs: "speed/optimization/protocol/http3-quic/",
      },
    });
  }

  if (!brotliOn) {
    recommendations.push({
      priority: "low",
      title: "Enable Brotli Compression",
      description: "Brotli compression is disabled. Brotli achieves 20-25% better compression than Gzip for text-based resources.",
      benefit: "Smaller transfer sizes, faster page loads, reduced bandwidth costs",
      ruleTemplate: {
        type: "config",
        name: "Enable Brotli",
        description: "Enable via: Speed → Optimization → Content Optimization → Brotli → On",
        cfDocs: "speed/optimization/content/brotli/",
      },
    });
  }

  if (!earlyHintsOn) {
    recommendations.push({
      priority: "low",
      title: "Enable Early Hints (103 Status)",
      description: "Early Hints is disabled. This allows browsers to start prefetching critical resources while the server prepares the full response.",
      benefit: "Reduces Largest Contentful Paint (LCP) by 30-60% on repeat visits",
      ruleTemplate: {
        type: "config",
        name: "Enable Early Hints",
        description: "Enable via: Speed → Optimization → Content Optimization → Early Hints → On",
        cfDocs: "cache/advanced-configuration/early-hints/",
      },
    });
  }

  if (!config.apiShield) {
    recommendations.push({
      priority: "low",
      title: "Enable API Shield for API Endpoint Protection",
      description: "If this zone serves an API, API Shield provides schema validation, JWT validation, and endpoint discovery to prevent API abuse.",
      benefit: "Prevents undocumented endpoint abuse, enforces API contracts, detects anomalous API traffic",
      ruleTemplate: {
        type: "config",
        name: "Enable API Shield",
        description: "Enable via: Security → API Shield. Requires uploading your API schema (OpenAPI) or enabling endpoint discovery.",
        cfDocs: "api-shield/get-started/",
      },
    });
  }

  // ── API Shield — Endpoint risk labels ────────────────────────────────────────

  const bolaLabels = apiRiskLabels.filter((r) => r.label.startsWith("cf-risk-bola"));
  const bolaOperationCount = new Set(
    Object.entries(webAssetLabels.riskyOperationLabels)
      .filter(([, labels]) => labels.some((l) => l.startsWith("cf-risk-bola")))
      .map(([id]) => id)
  ).size;
  if (bolaOperationCount > 0) {
    recommendations.push({
      priority: "high",
      title: `${bolaOperationCount} Endpoint${bolaOperationCount === 1 ? "" : "s"} at Risk of BOLA (Broken Object Level Authorization)`,
      description: `Cloudflare detected ${bolaLabels.map((l) => `${l.label.replace("cf-risk-", "").replace(/-/g, " ")} (${l.operationCount})`).join(", ")} signals — sessions requesting abnormally many unique objects or parameters duplicated in unexpected locations. BOLA vulnerabilities are as dangerous as an account takeover.`,
      benefit: "Prevents attackers from enumerating or manipulating object IDs to access other users' data",
      ruleTemplate: {
        type: "config",
        name: "Review BOLA-Flagged Endpoints",
        description: "Go to Security → Web Assets → filter by cf-risk-bola-enumeration / cf-risk-bola-pollution. Verify origin authorization checks with your development team.",
        cfDocs: "api-shield/security/bola-vulnerability-detection/",
      },
    });
  }

  const missingAuth = apiRiskLabels.find((r) => r.label === "cf-risk-missing-auth");
  const mixedAuth = apiRiskLabels.find((r) => r.label === "cf-risk-mixed-auth");
  if ((missingAuth?.operationCount ?? 0) + (mixedAuth?.operationCount ?? 0) > 0) {
    recommendations.push({
      priority: "high",
      title: `${(missingAuth?.operationCount ?? 0) + (mixedAuth?.operationCount ?? 0)} Endpoint(s) with Missing or Inconsistent Authentication`,
      description: `${missingAuth?.operationCount ?? 0} endpoint(s) have zero authenticated successful requests, and ${mixedAuth?.operationCount ?? 0} endpoint(s) show a mix of authenticated and unauthenticated successful requests — a possible broken-authentication vulnerability.`,
      benefit: "Closes gaps where protected resources may be reachable without valid credentials",
      ruleTemplate: {
        type: "waf_custom",
        name: "Block Requests Missing the API Session Identifier",
        expression: `(not cf.api_gateway.auth_id_present)`,
        action: "block",
        description: "Blocks requests lacking the configured API Shield session identifier. Scope with a host/path match to the affected endpoints.",
        cfDocs: "api-shield/security/authentication-posture/",
      },
    });
  }

  const sensitiveLabel = apiRiskLabels.find((r) => r.label === "cf-risk-sensitive");
  if ((sensitiveLabel?.operationCount ?? 0) > 0) {
    recommendations.push({
      priority: "medium",
      title: `${sensitiveLabel!.operationCount} Endpoint(s) Returning Sensitive Data`,
      description: `Responses from ${sensitiveLabel!.operationCount} endpoint(s) matched WAF Sensitive Data Detection (e.g. SSNs, credit card numbers). Verify sensitive data is only returned where expected and is properly authorized.`,
      benefit: "Reduces exposure of PII/financial data to unauthorized or unintended clients",
    });
  }

  if (apiZombieEndpointsTotalCount > 0) {
    recommendations.push({
      priority: "medium",
      title: `${apiZombieEndpointsTotalCount} Zombie API Endpoint(s) Detected`,
      description: `${apiZombieEndpointsTotalCount} saved endpoint(s) have received no (or near-zero) traffic in 32+ days${apiZombieEndpoints.length > 0 ? ` (e.g. ${apiZombieEndpoints.slice(0, 3).map((e) => `${e.method} ${e.endpoint}`).join(", ")})` : ""}. Dormant/forgotten API surface area is a common target for attackers probing for unmaintained access paths.`,
      benefit: "Shrinks the API attack surface by removing forgotten or deprecated endpoints",
      ruleTemplate: {
        type: "config",
        name: "Remove or Fallthrough-Block Zombie Endpoints",
        description: "Review in Security → Web Assets → filter by cf-risk-zombie. Remove unused endpoints from Endpoint Management, or add a fallthrough rule to block traffic to removed endpoints.",
        cfDocs: "api-shield/security/schema-validation/#add-validation-by-adding-a-fallthrough-rule",
      },
    });
  }

  if (discoveryPendingReviewCount > 0) {
    recommendations.push({
      priority: "low",
      title: `${discoveryPendingReviewCount} Discovered Operation(s) Pending Review`,
      description: `Cloudflare has discovered ${discoveryPendingReviewCount} operation(s) from live traffic that have not yet been saved into Endpoint Management. Unsaved operations get basic matching but do NOT receive risk scans, schema validation, or fallthrough protection.`,
      benefit: "Extends full risk scanning and schema validation coverage to the complete API surface",
      ruleTemplate: {
        type: "config",
        name: "Review and Save Discovered Operations",
        description: "Security → Web Assets → Discovery tab. Review candidate operations and select 'Learn profile' to promote them to full state.",
        cfDocs: "security/web-assets/manage-operations/",
      },
    });
  }

  // ── Suspicious Activity — Account Takeover ───────────────────────────────────
  if (accountTakeover.totalRequests > 0) {
    recommendations.push({
      priority: "high",
      title: `${accountTakeover.totalRequests.toLocaleString()} Account Takeover Signal(s) Detected`,
      description: `Bot Management flagged ${accountTakeover.totalRequests.toLocaleString()} request(s) with account-takeover detection signals (repeated login failures, high-volume login attempts, or anomalous login-success-rate deviation)${accountTakeover.topPaths[0] ? ` — concentrated on ${accountTakeover.topPaths[0].host}${accountTakeover.topPaths[0].path}` : ""}.`,
      benefit: "Identifies credential-stuffing and automated account-takeover campaigns before accounts are compromised",
      ruleTemplate: {
        type: "config",
        name: "Review Account Takeover Detections",
        description: "Security → Security Analytics → Suspicious Activity → Account Takeover. Consider a Bot Management rule action on high-confidence detection IDs.",
        cfDocs: "bots/additional-configurations/detection-ids/account-takeover-detections/",
      },
    });
  }

  // ── Leaked Credential Check ───────────────────────────────────────────────────
  if (leakedCredentialStatus?.enabled !== true) {
    recommendations.push({
      priority: "high",
      title: "Leaked Credential Check Not Enabled",
      description: "Leaked Credential Check flags login requests using username/password pairs known to be compromised in third-party breaches, before an attacker can use them to take over an account. This zone does not have it enabled.",
      benefit: "Stops credential-stuffing logins using already-breached passwords, independent of rate or volume",
      ruleTemplate: {
        type: "config",
        name: "Enable Leaked Credential Check",
        description: "Security → WAF → Leaked Credential Check. Configure the username/password field locations for your login endpoint(s).",
        cfDocs: "waf/detections/leaked-credentials/",
      },
    });
  } else if (leakedCredentialResults.breachedCount > 0) {
    recommendations.push({
      priority: "high",
      title: `${leakedCredentialResults.breachedCount} Login Request(s) Used Breached Credentials`,
      description: `Of ${leakedCredentialResults.totalChecked} login request(s) checked this period, ${leakedCredentialResults.breachedCount} matched a known data breach (${leakedCredentialResults.byResult.filter((r) => r.result !== "clean").map((r) => `${r.result.replace(/_/g, " ")}: ${r.count}`).join(", ")}). These are active credential-stuffing attempts using already-compromised passwords.`,
      benefit: "Blocking or challenging these requests stops account takeover attempts using breached credentials",
      ruleTemplate: {
        type: "waf_custom",
        name: "Block Requests Using Leaked Credentials",
        expression: `(cf.waf.credential_check.username_and_password_leaked or cf.waf.credential_check.password_leaked)`,
        action: "block",
        description: "Blocks login attempts where the WAF identified the submitted credentials as leaked.",
        cfDocs: "waf/detections/leaked-credentials/examples/",
      },
    });
  } else if (leakedCredentialDetections.length === 0) {
    recommendations.push({
      priority: "medium",
      title: "Leaked Credential Check Enabled but No Custom Detection Locations Configured",
      description: "Leaked Credential Check is on, but no custom username/password field locations are configured — it may only be covering Cloudflare's default detections and missing this zone's actual login form fields.",
      benefit: "Ensures breached-credential detection actually inspects this application's real login fields",
    });
  }

  // ── AI Security for Apps ──────────────────────────────────────────────────────
  const llmLabel = apiUseCaseLabels.find((r) => r.label === "cf-llm");
  if (aiSecurityStatusRaw?.enabled !== true) {
    recommendations.push({
      priority: llmLabel && llmLabel.operationCount > 0 ? "high" : "low",
      title: llmLabel && llmLabel.operationCount > 0
        ? `AI Security for Apps Not Enabled Despite ${llmLabel.operationCount} LLM-Labeled Endpoint(s)`
        : "AI Security for Apps Not Enabled",
      description: llmLabel && llmLabel.operationCount > 0
        ? `${llmLabel.operationCount} endpoint(s) are labeled cf-llm (receive LLM prompts) but AI Security for Apps — which detects PII exposure, unsafe content, and prompt injection in those prompts — is not enabled.`
        : "AI Security for Apps detects PII exposure, unsafe content, and prompt injection in requests to LLM-powered endpoints. Not currently enabled on this zone.",
      benefit: "Prevents sensitive data leakage and prompt-injection attacks against AI-powered application endpoints",
      ruleTemplate: {
        type: "config",
        name: "Enable AI Security for Apps",
        description: "Security → WAF → AI Security for Apps. Enable, then tag LLM-facing endpoints with the cf-llm label in Web Assets if not already auto-discovered.",
        cfDocs: "waf/detections/ai-security-for-apps/get-started/",
      },
    });
  } else if (aiSecurityDetections.piiDetectedCount > 0) {
    recommendations.push({
      priority: "high",
      title: `PII Detected in ${aiSecurityDetections.piiDetectedCount} LLM Prompt(s)`,
      description: `Of ${aiSecurityDetections.scannedCount} scanned prompt(s) this period, ${aiSecurityDetections.piiDetectedCount} contained personally identifiable information (${aiSecurityDetections.piiCategoryBreakdown.slice(0, 4).map((c) => `${c.category}: ${c.count}`).join(", ")}). Review whether this data should reach the LLM provider at all.`,
      benefit: "Reduces risk of sensitive user data being sent to third-party LLM providers or logged unnecessarily",
      ruleTemplate: {
        type: "waf_custom",
        name: "Block Prompts Containing Sensitive PII",
        expression: `(any(cf.llm.prompt.pii_categories[*] in {"CREDIT_CARD" "US_SSN"}))`,
        action: "block",
        description: "Blocks prompts containing the most sensitive PII categories. Broaden the category set based on this application's risk tolerance.",
        cfDocs: "waf/detections/ai-security-for-apps/pii-detection/",
      },
    });
  } else if (aiSecurityLogModeDeployed) {
    recommendations.push({
      priority: "medium",
      title: "AI Security for Apps Still in Log Mode",
      description: "The optional Log Mode managed ruleset is deployed, meaning detections are being logged for tuning but not yet enforced by a blocking custom rule. Review Security Analytics for false positives, then create a custom rule on cf.llm.prompt.pii_detected / unsafe_topic_detected / injection_score to take action.",
      benefit: "Moves from passive detection to active enforcement against PII exposure and prompt injection",
      ruleTemplate: {
        type: "waf_custom",
        name: "Block High-Confidence Prompt Injection",
        expression: `(cf.llm.prompt.injection_score lt 30)`,
        action: "block",
        description: "Blocks requests where the prompt-injection confidence score indicates a likely attack. Tune the threshold based on Log Mode observations first.",
        cfDocs: "waf/detections/ai-security-for-apps/log-mode-vs-production-mode/",
      },
    });
  } else if (aiSecurityCustomTopics.length === 0 && llmLabel && llmLabel.operationCount > 0) {
    recommendations.push({
      priority: "low",
      title: "No Custom Unsafe Topics Configured for AI Security",
      description: `AI Security for Apps is enabled, but no custom topics are configured — only Cloudflare's built-in categories apply. ${llmLabel.operationCount} cf-llm-labeled endpoint(s) may benefit from topics specific to this application's domain.`,
      benefit: "Improves detection relevance for application-specific unsafe or off-topic content",
      ruleTemplate: {
        type: "config",
        name: "Add Custom AI Security Topics",
        description: "Security → WAF → AI Security for Apps → Custom Topics. Define topics relevant to this application (e.g. competitor mentions, restricted advice categories).",
        cfDocs: "waf/detections/ai-security-for-apps/get-started/",
      },
    });
  }

  // Independent real-detection signals — surfaced regardless of the status
  // branch above, since prompt injection and unsafe-topic detections are
  // separate risk signals from PII exposure.
  if (aiSecurityDetections.injectionScoreBands.high > 0) {
    recommendations.push({
      priority: "high",
      title: `${aiSecurityDetections.injectionScoreBands.high} High-Confidence Prompt Injection Attempt(s)`,
      description: `${aiSecurityDetections.injectionScoreBands.high} prompt(s) scored 1-19 (high likelihood of prompt injection) out of ${aiSecurityDetections.scannedCount} scanned this period${aiSecurityDetections.avgInjectionScore != null ? `, average injection score: ${aiSecurityDetections.avgInjectionScore}` : ""}.`,
      benefit: "Blocking high-confidence injection attempts prevents attackers from subverting the LLM's intended behavior",
      ruleTemplate: {
        type: "waf_custom",
        name: "Block High-Confidence Prompt Injection",
        expression: `(cf.llm.prompt.injection_score lt 20)`,
        action: "block",
        description: "Blocks the most confident prompt-injection attempts. Start with Log to validate before switching to Block.",
        cfDocs: "waf/detections/ai-security-for-apps/prompt-injection/",
      },
    });
  }
  if (aiSecurityDetections.unsafeTopicDetectedCount > 0) {
    recommendations.push({
      priority: "medium",
      title: `${aiSecurityDetections.unsafeTopicDetectedCount} Prompt(s) Matched Unsafe Topics`,
      description: `${aiSecurityDetections.unsafeTopicDetectedCount} prompt(s) matched a built-in unsafe-topic category this period (${aiSecurityDetections.unsafeTopicCategoryBreakdown.slice(0, 4).map((c) => `${c.category}: ${c.count}`).join(", ")}).`,
      benefit: "Identifies misuse of LLM-powered endpoints for harmful or policy-violating content",
      ruleTemplate: {
        type: "waf_custom",
        name: "Challenge Unsafe Topic Matches",
        expression: `(cf.llm.prompt.unsafe_topic_detected)`,
        action: "managed_challenge",
        description: "Challenges requests where an unsafe topic was detected, without hard-blocking legitimate edge cases.",
        cfDocs: "waf/detections/ai-security-for-apps/unsafe-topics/",
      },
    });
  }

  // ── Malicious Uploads (Content Scanning) ──────────────────────────────────────
  if (contentScanningStatusRaw?.value !== "on") {
    recommendations.push({
      priority: "medium",
      title: "Malicious Upload Scanning Not Enabled",
      description: "Content Scanning inspects uploaded files (images, documents, archives) for malware before they reach your origin. Not currently enabled on this zone.",
      benefit: "Blocks malware distribution via file upload endpoints (avatars, attachments, document uploads)",
      ruleTemplate: {
        type: "config",
        name: "Enable Content Scanning",
        description: "Security → WAF → Content Scanning. Enable, then add a custom rule using cf.waf.content_scan.has_malicious_obj to block matches.",
        cfDocs: "waf/detections/malicious-uploads/",
      },
    });
  } else if (contentScanResults.requestsWithMaliciousObject > 0) {
    recommendations.push({
      priority: "high",
      title: `${contentScanResults.requestsWithMaliciousObject} Request(s) Contained Malicious Uploaded Content`,
      description: `Of ${contentScanResults.totalScannedRequests} scanned upload request(s) this period, ${contentScanResults.requestsWithMaliciousObject} contained at least one malicious object${contentScanResults.scanFailedCount > 0 ? `, and ${contentScanResults.scanFailedCount} scan(s) failed to complete` : ""}.`,
      benefit: "Blocking malicious uploads prevents malware distribution via file upload endpoints",
      ruleTemplate: {
        type: "waf_custom",
        name: "Block Malicious Uploaded Objects",
        expression: `(cf.waf.content_scan.has_malicious_obj)`,
        action: "block",
        description: "Blocks any request where Content Scanning identified a malicious uploaded object.",
        cfDocs: "waf/detections/malicious-uploads/",
      },
    });
  }

  // ── Sensitive Data Detection / Legacy Exposed Credentials Check ──────────────
  if (!managedDetectionDeployment.sensitiveDataDetectionDeployed) {
    recommendations.push({
      priority: "medium",
      title: "Sensitive Data Detection Not Deployed",
      description: "Sensitive Data Detection scans response bodies for exposed PII, credentials, and financial data (SSNs, credit card numbers, API keys). No execute rule for this managed ruleset was found in the zone's response-phase WAF configuration.",
      benefit: "Surfaces accidental sensitive-data leakage in API/application responses before it becomes a breach",
      ruleTemplate: {
        type: "config",
        name: "Deploy Sensitive Data Detection",
        description: "Security → WAF → Managed Rules → deploy the Sensitive Data Detection ruleset in Log mode first, then tune to Block.",
        cfDocs: "waf/managed-rules/reference/sensitive-data-detection/",
      },
    });
  }
  if (managedDetectionDeployment.legacyExposedCredentialsDeployed) {
    recommendations.push({
      priority: "low",
      title: "Legacy Exposed Credentials Check Still Deployed",
      description: "This zone still runs the deprecated Exposed Credentials Check managed ruleset. Cloudflare recommends migrating to Leaked Credential Check, which supports custom detection locations and is actively maintained.",
      benefit: "Moves to the actively maintained, more accurate breached-credential detection mechanism",
      ruleTemplate: {
        type: "config",
        name: "Migrate to Leaked Credential Check",
        description: "Disable the legacy Exposed Credentials Check managed ruleset and configure Leaked Credential Check instead (Security → WAF → Leaked Credential Check).",
        cfDocs: "waf/managed-rules/reference/exposed-credentials-check/",
      },
    });
  }

  const loginLabel = apiUseCaseLabels.find((r) => r.label === "cf-log-in");
  if (loginLabel && loginLabel.requests > 0 && rateLimitRules.length === 0) {
    recommendations.push({
      priority: "high",
      title: `Rate Limit Login Endpoint${loginLabel.operationCount === 1 ? "" : "s"} (${loginLabel.requests.toLocaleString()} requests observed)`,
      description: `${loginLabel.operationCount} endpoint(s) labeled cf-log-in received ${loginLabel.requests.toLocaleString()} requests in this period with no rate limiting rules configured — exposed to credential stuffing and brute-force attacks.`,
      benefit: "Blocks automated credential-stuffing and brute-force attacks against authentication endpoints",
      ruleTemplate: {
        type: "rate_limit",
        name: "Rate Limit Login Endpoint (Per Session)",
        description: "Security → WAF → Rate Limiting Rules. API Shield can also generate per-endpoint, per-session rate limit recommendations via Volumetric Abuse Detection once session identifiers are configured.",
        cfDocs: "api-shield/security/volumetric-abuse-detection/",
      },
    });
  }

  // Sort: high → medium → low, cap at 12
  const priorityOrder: Record<RecPriority, number> = { high: 0, medium: 1, low: 2 };
  recommendations.sort((a, b) => priorityOrder[a.priority] - priorityOrder[b.priority]);
  const topRecommendations = recommendations.slice(0, 12);

  // ── 17. Assemble final payload ────────────────────────────────────────────────
  const appsec: AppSecData = {
    meta: {
      zoneName,
      zoneId,
      accountId,
      since,
      until,
      generatedAt: new Date().toISOString(),
      days,
      periodLabel: calendarPeriodLabel,
      // Some zone analytics datasets (adaptive/hourly breakdowns) only keep
      // roughly the last 30 days. For a custom range reaching further back,
      // say so up front — those sections record their own upstream errors
      // and render honest empty states, but without this note a half-empty
      // older report would read like a bug.
      ...(Date.parse(sinceTs) < Date.now() - 32 * 24 * 60 * 60 * 1000
        ? { rangeNote: "This report's period reaches further back than some Cloudflare analytics datasets retain (~30 days for fine-grained breakdowns). Daily totals and time series remain accurate; some per-request detail sections may be empty — each shows its own upstream error, and none of this affects the headline numbers." }
        : {}),
    },
    summary: {
      totalRequests,
      // totalThreats: from httpRequests1dGroups.sum.threats — SAME datasource as totalRequests.
      // This is the correct denominator for the Sankey "Blocked" node because both come from
      // the exact (non-sampled) daily dataset. Using WAF firewall event counts (sampled) causes
      // blocked > total which breaks the Sankey flow diagram.
      totalThreats,
      totalThreatsBlocked: totalWafBlocked + totalDdosMitigated,
      uniqueVisitors: httpSeries.reduce((s, d) => s + d.unique, 0),
      totalBandwidthBytes: totalBytes,
      cachedBandwidthBytes: totalCachedBytes,
      cacheHitRatePct,
      cacheBandwidthHitRatePct,
      avgOriginResponseTimeMs: 0, // not directly available in zone-level httpRequests1d
      crawlerRequests: totalBotRequests,
      encryptedRequests: totalRequests, // assume all — Cloudflare enforces HTTPS
      costSavings,
      // Robust bot-score percentages — see the comment above botTrafficPct's
      // definition. Use these instead of string-matching botScoreBreakdown.
      automatedPct,
      likelyAutomatedPct,
      humanPct,
      botTrafficPct,
    },
    requestsTimeSeries,
    wafTimeSeries: wafSeries,
    bandwidthTimeSeries,
    cacheTimeSeries,
    errorTimeSeries,
    botTimeSeries: botSeries.map((d) => ({
      date: d.date,
      bot: d.botRequests,
      likelyBot: d.likelyBotRequests,
      human: d.humanRequests,
      botRequests: d.botRequests,
      likelyBotRequests: d.likelyBotRequests,
      humanRequests: d.humanRequests,
    })),
    ddosTimeSeries: ddosSeries,

    wafTopRules: wafTopRulesMapped,
    wafAttackScoreBreakdown: wafAttackScore,
    wafTopCountries: wafTopCountriesMapped,
    wafTopPaths: wafTopPathsMapped,
    botScoreBreakdown,
    cacheStatusBreakdown,
    tlsVersionBreakdown,
    ddosAttackVectors,

    // ── Post-Quantum Cryptography (PQC) Readiness ──
    tlsKeyExchangeBreakdown,
    pqcAdoptionPct,
    pqcApplicableCoveragePct,

    // ── AI Crawl Control Analytics ──
    aiCrawlerTimeSeries,
    aiCrawlerBots,
    aiCrawlerSummary,
    aiCrawlerStatusBreakdown: aiCrawlerStatusRaw,
    aiCrawlerTopPaths,
    aiReferralTraffic,

    certificates,
    rateLimitRules,
    wafManagedRules,
    customWafRules,

    // Extra context fields (used by AI summary and Security Posture section)
    httpProtocolBreakdown: httpProtocol,
    botManagementConfig: config.botMgmt ?? null,
    securityLevel: config.secLevel?.value ?? null,
    tlsMinVersion: config.tlsMin?.value ?? null,
    tls13Enabled: config.tls13?.value === "on" || config.tls13?.value === "zrt",
    alwaysHttps: config.alwaysHttps?.value === "on",
    sslMode: config.ssl?.value ?? null,
    cacheLevel: config.cacheLevel?.value ?? null,
    apiShieldEnabled: !!config.apiShield,
    cipherSuites: (config.ciphers as { id: string; value: string[] } | null)?.value ?? [],
    recommendations: topRecommendations,

    // ── Phase 1: Web Analytics & Geographic ──
    countryDistribution,
    browserBreakdown,
    deviceBreakdown,
    httpMethodBreakdown,
    httpStatusSummary,

    // ── Phase 2: Performance ──
    ttfbTimeSeries,
    edgeColoDistribution,

    // ── Phase 3: Security Intelligence ──
    topThreatIps,
    topThreatAsns,
    topUserAgents,

    // ── Phase 4: Content Analysis ──
    contentTypeBreakdown,

    // ── Phase 5: Traffic Sources ──
    topReferrers,
    referrerCategoryTotals,

    // ── DNS Summary ──
    dnsRecordSummary,
    dnsQueryTypeBreakdown,
    dnsQueryTimeSeries,
    dnsTopHostnames,
    topHttpHostnames,

    // ── Email Security ──
    emailSecurity: emailSecurityResult,

    // ── DNS Records enriched ──
    dnsRecordsEnriched: dnsRecordsEnrichedResult,

    // ── Enterprise POC Intelligence ──
    wafScoreAllTraffic,
    securityEventsByService,
    verifiedBotCategories,
    // ── WAF Attack Intelligence & DNS NXDOMAIN (cf-reporting patterns) ──
    wafAttackClassification,
    wafRuleEffectiveness,
    nxdomainHotspots,
    // ── Dashboard Analytics Parity ──
    sourceBrowsers,
    sourceOs,
    ja3Fingerprints,
    ja4Fingerprints,
    sourceAsns,
    // New dashboard-parity data (matching GetZoneTopNs + ZapSparklineBydatetimeHour)
    topClientIps,
    topXRequestedWith,
    dashboardSparklines,
    // ── API Shield & API Traffic ──
    apiTrafficSeries,
    apiTopPaths,
    apiMethods,
    apiStatus,
    apiOperations,
    apiSchemas,
    apiJwtConfigs,
    // ── API Shield — Endpoint Labeling Service ──
    apiRiskLabels,
    apiUseCaseLabels,
    apiZombieEndpoints,
    apiZombieEndpointsTotalCount,
    apiRiskyEndpoints,
    apiOperationsTotalCount,
    discoveryPendingReviewCount,
    // ── Suspicious Activity (Security Analytics parity) ──
    accountTakeover,
    wafPerVectorScore,
    leakedCredentialCheck: {
      enabled: leakedCredentialStatus?.enabled ?? false,
      customDetections: leakedCredentialDetections.length,
      totalChecked: leakedCredentialResults.totalChecked,
      breachedCount: leakedCredentialResults.breachedCount,
      byResult: leakedCredentialResults.byResult,
    },
    contentScanning: {
      enabled: contentScanningStatusRaw?.value === "on",
      totalScannedRequests: contentScanResults.totalScannedRequests,
      requestsWithMaliciousObject: contentScanResults.requestsWithMaliciousObject,
      scanFailedCount: contentScanResults.scanFailedCount,
      objResultsBreakdown: contentScanResults.objResultsBreakdown,
    },
    aiSecurityForApps: {
      enabled: aiSecurityStatusRaw?.enabled ?? false,
      customTopics: aiSecurityCustomTopics.map((t) => ({ label: t.label, topic: t.topic })),
      logModeDeployed: aiSecurityLogModeDeployed,
      scannedCount: aiSecurityDetections.scannedCount,
      piiDetectedCount: aiSecurityDetections.piiDetectedCount,
      piiCategoryBreakdown: aiSecurityDetections.piiCategoryBreakdown,
      unsafeTopicDetectedCount: aiSecurityDetections.unsafeTopicDetectedCount,
      unsafeTopicCategoryBreakdown: aiSecurityDetections.unsafeTopicCategoryBreakdown,
      injectionScoreBands: aiSecurityDetections.injectionScoreBands,
      avgInjectionScore: aiSecurityDetections.avgInjectionScore,
    },
    sensitiveDataDetectionDeployed: managedDetectionDeployment.sensitiveDataDetectionDeployed,
    legacyExposedCredentialsDeployed: managedDetectionDeployment.legacyExposedCredentialsDeployed,
    // Enhanced zone settings from bulk /settings endpoint
    zoneSettings: config.allSettings ?? {},
    // Page Shield
    pageShieldEnabled: config.pageShieldEnabled ?? false,
    pageShieldScripts: config.pageShieldScripts ?? [],

    errors,
  } as unknown as AppSecData;

  return appsec;
}
