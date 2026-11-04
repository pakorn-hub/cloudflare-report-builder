/**
 * POST /api/zerotrust
 * Cloudflare One (Zero Trust) POC report data aggregation.
 * Account-level only — no zoneId required.
 * Returns ZeroTrustData.
 */

import type { Context } from "hono";
import type { Env, ZeroTrustData, ReportRangeMode } from "../types";
import {
  getAccessApps, getAccessPolicies, getAccessIdps,
  getGatewayRules, getGatewayLocations, getGatewayCategories, buildGatewayCategoryMap,
  getWarpDevices, getWarpPostureRules,
  getCloudflaredTunnels, getCloudflaredTunnelCounts, getTunnelRoutes,
  getDlpProfiles, getMcpPortals,
  getAccessUsers, getCasbFindings, getAlertsHistory,
  getAccountAuditLogs, getDexFleetStatusLive,
  type CfAccessApp, type CfGatewayRule,
} from "../services/cf-rest";
import {
  fetchAccessAuthTimeSeries, fetchAccessLogs,
  deriveAccessTopApps, deriveAccessTopUsers, deriveAccessGeoDistribution,
  deriveAccessTopSourceIps, deriveAccessAuthMethodBreakdown,
  fetchAccessDailyActiveUsers, fetchAccessDistinctCounts,
  fetchAccessIdentityProviderBreakdown, fetchAccessAppBreakdown,
  fetchAccessFailedLoginDetails, detectAccessAnomalies,
  fetchGatewayDnsTimeSeries, fetchGatewayDnsTopBlocked, fetchGatewayDnsTopAllowed,
  fetchGatewayDnsTopBlockedCategories, fetchGatewayDnsSummary,
  fetchGatewayDnsTopByPolicy, fetchGatewayDnsResolverBreakdown,
  fetchGatewayHttpTimeSeries, fetchGatewayHttpTopBlocked, fetchGatewayHttpTopAllowed,
  fetchGatewayHttpTopBlockedCategories, fetchGatewayHttpSummary, fetchGatewayHttpStatusCodes,
  fetchGatewayHttpTopBlockedUsers, fetchGatewayDlpQuarantineTimeSeries,
  fetchGatewayL4Data,
  fetchShadowItData,
  fetchWarpDeviceStatusBreakdown, fetchWarpDeviceStatusTimeSeries, fetchWarpDeviceLatestStatus,
  fetchGatewayNetworkAnalytics, fetchPrivateNetworkOrigins,
  fetchGenAiUsage,
} from "../services/cf-zerotrust-graphql";

import { last30Days as l30, lastCalendarMonth, lastPeriodRange, customDateRange, type ReportPeriod } from "../services/cf-graphql";
import { getBaseline, saveSnapshot } from "../services/zt-snapshots";
import { syncRemediationFindings, getRemediationRegister, type RemediationFinding } from "../services/zt-remediation";
import { syncCasbFindings, getCasbFindingRegister, type CasbFindingInput } from "../services/zt-casb-tracking";
import { syncAlerts, getAlertRegister, type AlertInput } from "../services/zt-alert-tracking";
import {
  fetchAccessLoginsSummary, fetchAccessLoginsTimeSeries,
  fetchAccessLoginsTopApps, fetchAccessLoginsTopUsers,
  fetchGatewayDnsAnalyticsSummary, fetchGatewayDnsTopBlockedDestinations,
  fetchGatewayHttpAnalyticsSummary, fetchGatewayHttpTopBandwidthUsers, fetchGatewayHttpTopCountries,
  fetchGatewayNetworkAnalyticsSummary,
  fetchGatewayNslTotalBytes, fetchGatewayNslByOfframp, fetchGatewayNslTopUsers,
  fetchDlpActivitySummary, fetchDlpProfileMatches, fetchDlpTopWebsites,
  fetchCasbDlpFindingsCount, fetchCdsScanResultsSummary,
} from "../services/cf-dashboard-analytics";

const ALLOWED_DAYS = [1, 3, 5, 7, 14, 30] as const;

function safeGet<T>(
  r: PromiseSettledResult<T>,
  key: string,
  fallback: T,
  errors: Record<string, string>
): T {
  if (r.status === "rejected") errors[key] = String(r.reason);
  return r.status === "fulfilled" ? r.value : fallback;
}

export async function handleFetchZeroTrust(c: Context<{ Bindings: Env }>) {
  let body: unknown;
  try { body = await c.req.json(); }
  catch { return c.json({ error: "Invalid JSON body" }, 400); }

  const { token, accountId, days: rawDays, tzOffset = 0, rangeMode: rawRangeMode, sinceDate: rawSinceDate, untilDate: rawUntilDate, sinceTime: rawSinceTime, untilTime: rawUntilTime, monthsAgo: rawMonthsAgo, period: rawPeriod } =
    body as { token?: string; accountId?: string; days?: number; tzOffset?: number; rangeMode?: string; sinceDate?: string; untilDate?: string; sinceTime?: string; untilTime?: string; monthsAgo?: number; period?: string };

  if (!token || typeof token !== "string" || token.length < 10)
    return c.json({ error: "Missing or invalid token" }, 400);
  if (!accountId || !/^[a-f0-9]{32}$/i.test(accountId))
    return c.json({ error: "Missing or invalid accountId (32-char hex)" }, 400);

  const days = ALLOWED_DAYS.includes(rawDays as typeof ALLOWED_DAYS[number])
    ? (rawDays as typeof ALLOWED_DAYS[number]) : 30;
  const rangeMode: ReportRangeMode =
    rawRangeMode === "calendar_month" ? "calendar_month"
    : rawRangeMode === "custom" ? "custom"
    : rawRangeMode === "period" ? "period"
    : "rolling";
  let period: ReportPeriod | undefined;
  if (rangeMode === "period") {
    if (rawPeriod !== "yesterday" && rawPeriod !== "last_week" && rawPeriod !== "last_month")
      return c.json({ error: 'rangeMode "period" requires period: "yesterday", "last_week" or "last_month".' }, 400);
    period = rawPeriod;
  }

  let sinceDate: string | undefined;
  let untilDate: string | undefined;
  let sinceTime: string | undefined;
  let untilTime: string | undefined;
  if (rangeMode === "custom") {
    if (typeof rawSinceDate !== "string" || typeof rawUntilDate !== "string")
      return c.json({ error: 'rangeMode "custom" requires sinceDate and untilDate (YYYY-MM-DD, local to tzOffset).' }, 400);
    if (typeof rawSinceTime === "string") sinceTime = rawSinceTime;
    if (typeof rawUntilTime === "string") untilTime = rawUntilTime;
    if (!customDateRange(rawSinceDate, rawUntilDate, tzOffset, sinceTime, untilTime))
      return c.json({ error: `Invalid custom range ${JSON.stringify(rawSinceDate)} → ${JSON.stringify(rawUntilDate)}${sinceTime || untilTime ? ` (${JSON.stringify(sinceTime ?? "00:00")}–${JSON.stringify(untilTime ?? "23:59")})` : ""}: dates must exist, start ≤ end, end not in the future, valid HH:MM times, span 1–366 days.` }, 400);
    sinceDate = rawSinceDate;
    untilDate = rawUntilDate;
  }
  let monthsAgo = 1;
  if (rangeMode === "calendar_month") {
    const parsed = typeof rawMonthsAgo === "number" ? Math.round(rawMonthsAgo) : parseInt(String(rawMonthsAgo ?? "1"), 10);
    if (isNaN(parsed) || parsed < 1 || parsed > 12)
      return c.json({ error: "monthsAgo must be an integer 1–12 when rangeMode is calendar_month." }, 400);
    monthsAgo = parsed;
  }

  const zerotrust = await generateZerotrustData({ token, accountId, days, tzOffset, rangeMode, sinceDate, untilDate, sinceTime, untilTime, monthsAgo, period, db: c.env.DB });
  return c.json({ ok: true, zerotrust });
}

// ─── Report Generation ────────────────────────────────────────────────────────
// Shared by the POST /api/zerotrust route and the scheduled report email runner.

export async function generateZerotrustData(input: {
  token: string;
  accountId: string;
  days: number;
  tzOffset: number;
  /** "calendar_month" reports a full calendar month (28-31 days, whichever
   *  the month actually has) instead of a fixed rolling window — `days`
   *  above is ignored in that mode. "custom" reports an explicit
   *  user-selected range (`sinceDate`/`untilDate`, local to tzOffset) —
   *  `days` is ignored in that mode too. Defaults to "rolling". */
  rangeMode?: ReportRangeMode;
  /** rangeMode "calendar_month": which month — 1 = last month (default),
   *  2 = the month before that, etc. (1..12). */
  monthsAgo?: number;
  /** rangeMode "period": the last COMPLETE period, computed at run time in
   *  tzOffset's timezone — yesterday / last_week (Mon–Sun) / last_month. */
  period?: ReportPeriod;
  /** rangeMode "custom": first day, YYYY-MM-DD local. */
  sinceDate?: string;
  /** rangeMode "custom": last day, YYYY-MM-DD local (inclusive; may be today). */
  untilDate?: string;
  /** rangeMode "custom": optional intra-day start bound, HH:MM local. Default 00:00. */
  sinceTime?: string;
  /** rangeMode "custom": optional intra-day end bound, HH:MM local (inclusive minute). Default 23:59. */
  untilTime?: string;
  /** D1 binding — optional. Powers baseline/period-over-period comparison;
   *  report generation works fully without it, just without deltas. */
  db?: D1Database;
}): Promise<ZeroTrustData> {
  const { token, accountId, tzOffset, rangeMode = "rolling", db } = input;

  type DatedRange = ReturnType<typeof l30>;
  const dateRange: DatedRange =
    rangeMode === "calendar_month" ? (lastCalendarMonth(tzOffset, input.monthsAgo ?? 1) as unknown as DatedRange)
    : rangeMode === "period"
      ? (lastPeriodRange((input.period ?? "yesterday") as ReportPeriod, tzOffset) as unknown as DatedRange)
    : rangeMode === "custom"
      ? ((input.sinceDate && input.untilDate
          ? customDateRange(input.sinceDate, input.untilDate, tzOffset, input.sinceTime, input.untilTime)
          : null) ?? l30(input.days, tzOffset))
    : l30(input.days, tzOffset);
  const { since, until, sinceTs, untilTs } = dateRange;
  const days = dateRange.days;
  const calendarPeriodLabel = dateRange.periodLabel; // e.g. "August 2026" / "Sep 1–15, 2026" / "7-Day"

  // Use ISO timestamps for Gateway GraphQL queries.
  const adSince = sinceTs;  // e.g. "2026-03-02T10:36:42Z" = now - 30d, or a fixed past month-start for calendar_month
  const adUntil = untilTs;  // e.g. "2026-04-01T10:36:42Z" = now, or the target month's last instant

  // IMPORTANT: gatewayResolverQueriesAdaptiveGroups does NOT support datetime_lt.
  // It only supports datetime_gt (open-ended upper bound = "now at Cloudflare"),
  // AND Cloudflare enforces its ~4-week retention quota based on (now - since)
  // regardless of any upper bound — confirmed live: a query for a date range
  // that's fully in the past (e.g. "last calendar month" requested well into
  // the following month) can still be rejected purely because `since` itself
  // is more than ~4w3d before the real "now". For rolling mode this is
  // avoided by the +2h buffer below; for calendar_month/custom modes with a
  // start more than ~4 weeks behind "now", these DNS-breakdown GraphQL
  // queries below will fail and fail SOFT (existing try/catch → empty
  // arrays) — the headline DNS totals remain correct regardless, since
  // those source from the dashboard analytics API (no such quota; verified
  // live), not this GraphQL dataset. See dataConfidence.gatewayDnsBreakdown.
  const gwAdSince = rangeMode === "rolling"
    ? new Date(new Date(adSince).getTime() + 2 * 60 * 60 * 1000).toISOString()
    : adSince;

  const fetchErrors: Record<string, string> = {};
  const sg = <T>(r: PromiseSettledResult<T>, key: string, fallback: T): T =>
    safeGet(r, key, fallback, fetchErrors);

  // ── REST: config data (apps, rules, devices, tunnels) ─────────────────────
  const config = await Promise.allSettled([
    getAccessApps(token, accountId),
    getAccessIdps(token, accountId),
    getGatewayRules(token, accountId),
    getGatewayLocations(token, accountId),
    getGatewayCategories(token, accountId),
    getWarpDevices(token, accountId),
    getWarpPostureRules(token, accountId),
    getCloudflaredTunnels(token, accountId),
    getCloudflaredTunnelCounts(token, accountId),
    getTunnelRoutes(token, accountId),
    getDlpProfiles(token, accountId),
    getMcpPortals(token, accountId),
    getAccessUsers(token, accountId),
    getCasbFindings(token, accountId),
    getAlertsHistory(token, accountId, 25),
    getAccountAuditLogs(token, accountId, adSince, adUntil),
    getDexFleetStatusLive(token, accountId, 60),
    fetch(`https://api.cloudflare.com/client/v4/accounts/${accountId}`, {
      headers: { Authorization: `Bearer ${token}` },
    }).then((r) => r.json() as Promise<{ result?: { name?: string } }>),
  ]);

  const [
    appsR, idpsR, gatewayRulesR, locationsR, gwCategoriesR,
    warpDevicesR, postureRulesR, tunnelsR, tunnelCountsR, tunnelRoutesR, dlpProfilesR,
    mcpPortalsR,
    accessUsersR, casbFindingsR, alertsHistoryR,
    auditLogsR, dexFleetStatusR,
    accountInfoR,
  ] = config;

  const rawApps      = sg(appsR,         "apps",      []) as CfAccessApp[];
  const idps         = sg(idpsR,         "idps",      []);
  const gatewayRules = sg(gatewayRulesR, "gwRules",   []) as CfGatewayRule[];
  const gwLocations  = sg(locationsR,    "gwLoc",     []);
  const gwCategories = sg(gwCategoriesR, "gwCats",    []);
  const gwCategoryMap = buildGatewayCategoryMap(gwCategories as Parameters<typeof buildGatewayCategoryMap>[0]);
  // getWarpDevices/getAccessUsers now return { sample, totalCount } — the
  // REST list truncates at per_page while totalCount (result_info) reports
  // the real fleet/seat size (confirmed live: a real account had 4,373
  // enrolled devices and 1,921 seats, both far above the old per-page caps).
  const warpDevicesResult = sg(warpDevicesR, "devices", { devices: [], totalCount: 0 });
  const rawDevices   = warpDevicesResult.devices;
  const warpDevicesTotalCount = warpDevicesResult.totalCount;
  const postureRules = sg(postureRulesR, "posture",   []);
  const rawTunnels   = sg(tunnelsR,      "tunnels",   []);
  const tunnelCounts = sg(tunnelCountsR, "tunnelCounts", { total: 0, healthy: 0 });
  const rawRoutes    = sg(tunnelRoutesR, "routes",    []);
  const rawDlpProfs  = sg(dlpProfilesR,  "dlp",       []);
  const rawMcpPortals = sg(mcpPortalsR,  "mcpPortals",[]) as Array<{ id: string; name: string; hostname: string }>;
  const accessUsersResult = sg(accessUsersR, "accessUsers", { users: [], totalCount: 0 });
  const rawAccessUsers = accessUsersResult.users as Array<{
    id: string; uid: string; name?: string; email: string;
    last_successful_login?: string; access_seat?: boolean; gateway_seat?: boolean;
  }>;
  const accessUsersTotalCount = accessUsersResult.totalCount;
  const rawCasbFindings = sg(casbFindingsR, "casbFindings", []) as Array<{ severity?: string; type?: string; resource_name?: string }>;
  const rawAlertsHistory = sg(alertsHistoryR, "alertsHistory", []) as Array<{
    id: string; name: string; alert_type: string; sent: string; silenced?: boolean;
  }>;
  const rawAuditLogs = sg(auditLogsR, "auditLogs", []) as Array<{
    id: string;
    action: { description?: string; result?: string; time: string; type?: string };
    actor: { email?: string; type?: string; context?: string };
    resource?: { product?: string; type?: string };
  }>;
  const dexFleetStatus = sg(dexFleetStatusR, "dexFleetStatus", null);
  const accountName = (accountInfoR.status === "fulfilled"
    ? (accountInfoR.value as { result?: { name?: string } })?.result?.name
    : undefined) ?? accountId;

  // Access policies per app — same 50-app cap as the displayed app list
  // (previously capped at only the first 10 apps, which meant MFA coverage,
  // policy-action totals, and policy counts for apps 11-50 were silently
  // incomplete rather than genuinely zero).
  const POLICY_FETCH_CAP = 50;
  const policyResults = await Promise.allSettled(
    rawApps.slice(0, POLICY_FETCH_CAP).map((app) => getAccessPolicies(token, accountId, app.id))
  );

  // ── GraphQL analytics (all parallel) ──────────────────────────────────────
  const [
    authSeriesR, accessLogsR, dailyActiveR, distinctCountsR,
    idpBreakdownR, appBreakdownR, failedDetailsR,
    dnsSummaryR, dnsDailyR, dnsBreakdownR, dnsTopDomsR, dnsTopAllowedR, dnsCatsR, dnsTopPoliciesR,
    httpSummaryR, httpDailyR, httpTopDomsR, httpTopAllowedR, httpCatsR, httpStatusCodesR,
    httpTopBlockedUsersR, dlpQuarantineSeriesR,
    l4DataR,
    shadowItR,
    warpStatusBreakdownR, warpStatusSeriesR, warpLatestStatusR,
    networkAnalyticsR, privateNetOriginsR,
    genAiR,
    // Dashboard analytics API — see cf-dashboard-analytics.ts. These are the
    // EXACT endpoints the Cloudflare dashboard's own Zero Trust Analytics
    // Overview page uses (verified live against a real account), and are
    // what corrects the Access "auth events" number (WARP client session
    // noise inflated it 300x on a real account — see file header comment).
    accessLoginsSummaryR, accessLoginsSeriesR, accessLoginsTopAppsR, accessLoginsTopUsersR,
    dnsAnalyticsSummaryR, dnsTopBlockedDestR,
    httpAnalyticsSummaryR, httpTopBandwidthUsersR, httpTopCountriesR,
    networkAnalyticsSummaryR,
    nslTotalBytesR, nslByOfframpR, nslTopUsersR,
    dlpActivityR, dlpProfileMatchesR, dlpTopWebsitesR,
    casbDlpFindingsR, cdsScanResultsR,
  ] = await Promise.allSettled([
    // Access
    fetchAccessAuthTimeSeries(token, accountId, adSince, adUntil),
    fetchAccessLogs(token, accountId), // single fetch — reused below for top apps/users/geo/IPs/auth method
    fetchAccessDailyActiveUsers(token, accountId, adSince, adUntil),
    fetchAccessDistinctCounts(token, accountId, adSince, adUntil),
    // Access Audit enrichment (cf-reporting patterns)
    fetchAccessIdentityProviderBreakdown(token, accountId, adSince, adUntil),
    fetchAccessAppBreakdown(token, accountId, adSince, adUntil),
    fetchAccessFailedLoginDetails(token, accountId, adSince, adUntil),
    // Gateway DNS — gwAdSince has +2h buffer to stay within 30-day quota
    // (datetime_gt only; datetime_lt is NOT supported on gatewayResolverQueriesAdaptiveGroups)
    fetchGatewayDnsSummary(token, accountId, gwAdSince, adUntil),
    fetchGatewayDnsTimeSeries(token, accountId, gwAdSince, adUntil),
    fetchGatewayDnsResolverBreakdown(token, accountId, gwAdSince, adUntil),
    fetchGatewayDnsTopBlocked(token, accountId, gwAdSince, adUntil, 15),
    fetchGatewayDnsTopAllowed(token, accountId, gwAdSince, adUntil, 15),
    fetchGatewayDnsTopBlockedCategories(token, accountId, gwAdSince, adUntil, 10, gwCategoryMap),
    fetchGatewayDnsTopByPolicy(token, accountId, gwAdSince, adUntil, 10),
    // Gateway HTTP
    fetchGatewayHttpSummary(token, accountId, adSince, adUntil),
    fetchGatewayHttpTimeSeries(token, accountId, adSince, adUntil),
    fetchGatewayHttpTopBlocked(token, accountId, adSince, adUntil, 15),
    fetchGatewayHttpTopAllowed(token, accountId, adSince, adUntil, 15),
    fetchGatewayHttpTopBlockedCategories(token, accountId, adSince, adUntil, 10),
    fetchGatewayHttpStatusCodes(token, accountId, adSince, adUntil),
    fetchGatewayHttpTopBlockedUsers(token, accountId, adSince, adUntil, 15),
    fetchGatewayDlpQuarantineTimeSeries(token, accountId, adSince, adUntil),
    // Gateway L4
    fetchGatewayL4Data(token, accountId, adSince, adUntil),
    // Shadow IT
    fetchShadowItData(token, accountId, adSince, adUntil),
    // WARP device connection status (real online/offline — see cf-zerotrust-graphql.ts)
    fetchWarpDeviceStatusBreakdown(token, accountId, adSince, adUntil),
    fetchWarpDeviceStatusTimeSeries(token, accountId, adSince, adUntil),
    fetchWarpDeviceLatestStatus(token, accountId, adSince, adUntil),
    // Gateway network-layer bandwidth + session health/location analytics
    // (account-wide only, see fetchGatewayNetworkAnalytics in cf-zerotrust-graphql.ts)
    fetchGatewayNetworkAnalytics(token, accountId, adSince, adUntil),
    // Real "Shadow IT: Private Network" origins (WARP-routed internal traffic)
    fetchPrivateNetworkOrigins(token, accountId, adSince, adUntil, 15),
    // Generative AI usage — real Cloudflare category classification (id 184 "Artificial Intelligence")
    fetchGenAiUsage(token, accountId, gwAdSince, adUntil),
    // Dashboard analytics API (beta) — dashboard-exact numbers, GraphQL
    // above remains as the fallback source if any of these fail.
    fetchAccessLoginsSummary(token, accountId, adSince, adUntil),
    fetchAccessLoginsTimeSeries(token, accountId, adSince, adUntil),
    fetchAccessLoginsTopApps(token, accountId, adSince, adUntil, 10),
    fetchAccessLoginsTopUsers(token, accountId, adSince, adUntil, 15),
    fetchGatewayDnsAnalyticsSummary(token, accountId, adSince, adUntil),
    fetchGatewayDnsTopBlockedDestinations(token, accountId, adSince, adUntil, 15),
    fetchGatewayHttpAnalyticsSummary(token, accountId, adSince, adUntil),
    fetchGatewayHttpTopBandwidthUsers(token, accountId, adSince, adUntil, 10),
    fetchGatewayHttpTopCountries(token, accountId, adSince, adUntil, 10),
    fetchGatewayNetworkAnalyticsSummary(token, accountId, adSince, adUntil),
    fetchGatewayNslTotalBytes(token, accountId, adSince, adUntil),
    fetchGatewayNslByOfframp(token, accountId, adSince, adUntil),
    fetchGatewayNslTopUsers(token, accountId, adSince, adUntil, 10),
    fetchDlpActivitySummary(token, accountId, adSince),
    fetchDlpProfileMatches(token, accountId, adSince),
    fetchDlpTopWebsites(token, accountId, adSince),
    fetchCasbDlpFindingsCount(token, accountId, adSince),
    fetchCdsScanResultsSummary(token, accountId, adSince, adUntil),
  ]);

  // Unwrap results
  const authSeries     = sg(authSeriesR,    "authSeries",    []);
  const accessLogs     = sg(accessLogsR,    "accessLogs",    []);
  // Derived synchronously from the single accessLogs fetch above.
  const topApps        = deriveAccessTopApps(accessLogs, adSince, adUntil, 10);
  const topUsers        = deriveAccessTopUsers(accessLogs, adSince, adUntil, 15);
  const geoDistrib      = deriveAccessGeoDistribution(accessLogs, adSince, adUntil, 20);
  const topSourceIps    = deriveAccessTopSourceIps(accessLogs, adSince, adUntil, 20);
  const authMethodBreak = deriveAccessAuthMethodBreakdown(accessLogs, adSince, adUntil);
  const dailyActive    = sg(dailyActiveR,   "dailyActive",   []);
  const distinctCounts = sg(distinctCountsR, "distinctCounts", { uniqueUsers: 0, uniqueApps: 0, sampleLimit: 0 });
  const idpBreakdown   = sg(idpBreakdownR,  "idpBreakdown",  []);
  const appBreakdown   = sg(appBreakdownR,  "appBreakdown",  []);
  const failedDetails  = sg(failedDetailsR, "failedDetails", []);
  const rawDnsSummary  = sg(dnsSummaryR,    "dnsSummary",  null);
  const dnsSeries      = sg(dnsDailyR,      "dnsSeries",   []);
  const dnsBreakdown   = sg(dnsBreakdownR,  "dnsBreakdown",[]);
  const dnsTopDoms     = sg(dnsTopDomsR,    "dnsTopDoms",  []);
  const dnsTopAllowed  = sg(dnsTopAllowedR, "dnsTopAllowed", []);
  const dnsCats        = sg(dnsCatsR,       "dnsCats",     []);
  const dnsTopPolics   = sg(dnsTopPoliciesR,"dnsTopPol",   []) as Array<{ policyId: string; queriesTotal: number }>;
  const rawHttpSummary = sg(httpSummaryR,   "httpSummary", null);
  const httpSeries     = sg(httpDailyR,     "httpSeries",  []);
  const httpTopDoms    = sg(httpTopDomsR,   "httpTopDoms", []);
  const httpTopAllowed = sg(httpTopAllowedR,"httpTopAllowed", []);
  const httpCats       = sg(httpCatsR,      "httpCats",    []);
  const httpStatusCodes = sg(httpStatusCodesR, "httpStatusCodes", []);
  const httpTopBlockedUsers = sg(httpTopBlockedUsersR, "httpTopBlockedUsers", []);
  const dlpQuarantineSeries = sg(dlpQuarantineSeriesR, "dlpQuarantineSeries", []);
  const l4Data         = sg(l4DataR,        "l4Data",      { timeSeries: [], blockedDestinations: [], protocols: [], sourceCountries: [], portBreakdown: [] });
  const shadowIt       = sg(shadowItR,      "shadowIt",    { discoveredApps: [], categoryBreakdown: [], userAppMappings: [], appStatuses: {} });
  const warpStatusBreakdown = sg(warpStatusBreakdownR, "warpStatusBreakdown", []);
  const warpStatusSeries   = sg(warpStatusSeriesR,     "warpStatusSeries",    []);
  const warpLatestStatus   = sg(warpLatestStatusR,     "warpLatestStatus",    { online: 0, offline: 0, total: 0 });
  const networkAnalytics   = sg(networkAnalyticsR, "networkAnalytics", {
    bytesSent: 0, bytesRecvd: 0, packetsSent: 0, packetsRecvd: 0, sessionCount: 0,
    retransmittedBytes: 0, transportStatusBreakdown: [], tokenAuthStatusBreakdown: [], topColos: [],
  });
  const privateNetOrigins  = sg(privateNetOriginsR, "privateNetOrigins", []);
  const genAi               = sg(genAiR,     "genAi",     { totalRequests: 0, uniqueApps: 0, uniqueUsers: 0, apps: [], users: [] });

  // ── Dashboard analytics API results (beta; see cf-dashboard-analytics.ts) ──
  const accessLoginsSummary = sg(accessLoginsSummaryR, "accessLoginsSummary", null);
  const accessLoginsSeries  = sg(accessLoginsSeriesR,  "accessLoginsSeries",  []);
  const accessLoginsTopApps = sg(accessLoginsTopAppsR, "accessLoginsTopApps", []);
  const accessLoginsTopUsers = sg(accessLoginsTopUsersR, "accessLoginsTopUsers", []);
  const dnsAnalyticsSummary = sg(dnsAnalyticsSummaryR, "dnsAnalyticsSummary", null);
  const dnsTopBlockedDest   = sg(dnsTopBlockedDestR,   "dnsTopBlockedDest",   []);
  const httpAnalyticsSummary = sg(httpAnalyticsSummaryR, "httpAnalyticsSummary", null);
  const httpTopBandwidthUsers = sg(httpTopBandwidthUsersR, "httpTopBandwidthUsers", []);
  const httpTopCountries    = sg(httpTopCountriesR,    "httpTopCountries",    []);
  const networkAnalyticsSummary = sg(networkAnalyticsSummaryR, "networkAnalyticsSummary", null);
  const nslTotalBytes = sg(nslTotalBytesR, "nslTotalBytes", null);
  const nslByOfframp  = sg(nslByOfframpR,  "nslByOfframp",  []);
  const nslTopUsers   = sg(nslTopUsersR,   "nslTopUsers",   []);
  const dlpActivity   = sg(dlpActivityR,   "dlpActivity",   null);
  const dlpProfileMatches = sg(dlpProfileMatchesR, "dlpProfileMatches", []);
  const dlpTopWebsites    = sg(dlpTopWebsitesR,    "dlpTopWebsites",    []);
  const casbDlpFindings   = sg(casbDlpFindingsR,   "casbDlpFindings",   null);
  const cdsScanResults    = sg(cdsScanResultsR,    "cdsScanResults",    null);

  // Dashboard-exact top blocked DNS destinations, enriched with category/
  // policy/location from the existing GraphQL breakdown by domain-name
  // match where available (best-effort — the analytics API doesn't return
  // those dimensions, only destination + queriesTotal).
  const dnsTopBlockedMerged = dnsTopBlockedDest.map((d: { destination: string; queriesTotal: number }) => {
    const match = (dnsTopDoms as Array<{ domain: string; category: string; policyName: string; locationName: string }>)
      .find((x) => x.domain === d.destination);
    return {
      domain: d.destination, count: d.queriesTotal,
      category: match?.category ?? "Uncategorized",
      policyName: match?.policyName ?? "", locationName: match?.locationName ?? "",
    };
  });

  // ── Derived KPIs ──────────────────────────────────────────────────────────
  // Headline auth events: the dashboard-exact `access-logins/summary` count
  // (real interactive login attempts) is authoritative when available —
  // confirmed live that the GraphQL-derived number below counts EVERY login
  // request including WARP client session/reconnect events and service
  // tokens (300x inflation on a real account: 4,070 raw events vs 12 real
  // interactive attempts for the same account/period). GraphQL remains the
  // fallback if the beta analytics endpoint is unavailable.
  const rawTotalAuth  = authSeries.reduce((s: number, d: { allow: number; block: number; mfa: number }) => s + d.allow + d.block + d.mfa, 0);
  const rawTotalBlock = authSeries.reduce((s: number, d: { block: number }) => s + d.block, 0);
  const totalMfa    = authSeries.reduce((s: number, d: { mfa: number }) => s + d.mfa, 0);
  const totalAuth   = accessLoginsSummary?.attemptsTotal ?? rawTotalAuth;
  const totalBlock  = accessLoginsSummary?.attemptsBlocked ?? rawTotalBlock;
  const successRate = totalAuth > 0 ? Math.round(((totalAuth - totalBlock) / totalAuth) * 100) : 100;
  // How much of the raw GraphQL total was WARP client / service-token noise
  // — real and worth showing, just not as the headline "auth events" KPI.
  const warpAndServiceTokenEvents = Math.max(0, rawTotalAuth - totalAuth);

  const uniqueUsersSet = new Set((topUsers as Array<{ email: string }>).map((u) => u.email));
  const uniqueAppsSet  = new Set((topApps  as Array<{ name: string }>).map((a) => a.name));

  // Dashboard-exact totals (analytics API) take priority; GraphQL/REST
  // summaries remain the fallback chain if the beta endpoint is unavailable.
  const totalDnsQ   = dnsAnalyticsSummary?.queriesTotal
    ?? (rawDnsSummary as { queriesTotal?: number } | null)?.queriesTotal
    ?? dnsSeries.reduce((s: number, d: { total: number }) => s + d.total, 0);
  const totalDnsBlk = dnsAnalyticsSummary?.queriesBlocked
    ?? (rawDnsSummary as { queriesBlocked?: number } | null)?.queriesBlocked
    ?? dnsSeries.reduce((s: number, d: { blocked: number }) => s + d.blocked, 0);
  const totalHttpQ   = httpAnalyticsSummary?.requestsTotal
    ?? (rawHttpSummary as { requestsTotal?: number } | null)?.requestsTotal
    ?? httpSeries.reduce((s: number, d: { total: number }) => s + d.total, 0);
  const totalHttpBlk = httpAnalyticsSummary?.requestsBlocked
    ?? (rawHttpSummary as { requestsBlocked?: number } | null)?.requestsBlocked
    ?? httpSeries.reduce((s: number, d: { blocked: number }) => s + d.blocked, 0);
  const totalHttpRbi = httpAnalyticsSummary?.requestsIsolated
    ?? (rawHttpSummary as { rbiSessions?: number } | null)?.rbiSessions ?? 0;
  const totalHttpQuarantined = (rawHttpSummary as { quarantinedRequests?: number } | null)?.quarantinedRequests ?? 0;
  const totalMcpHttp = httpAnalyticsSummary?.mcpUrlCountTotal
    ?? (rawHttpSummary as { mcpRequests?: number } | null)?.mcpRequests ?? 0;

  const l4DataObj = l4Data as { timeSeries: Array<{ date: string; total: number; blocked: number }>; blockedDestinations: unknown[]; protocols: unknown[]; sourceCountries: unknown[]; portBreakdown: unknown[] };
  const totalL4    = networkAnalyticsSummary?.requestsTotal   ?? l4DataObj.timeSeries.reduce((s, d) => s + d.total,   0);
  const totalL4Blk = networkAnalyticsSummary?.requestsBlocked ?? l4DataObj.timeSeries.reduce((s, d) => s + d.blocked, 0);

  const shadowItObj = shadowIt as {
    discoveredApps: unknown[]; categoryBreakdown: unknown[]; userAppMappings: unknown[];
    appStatuses: Record<string, string>;
  };

  // REST /accounts/{id}/devices `result_info.total_count`, the GraphQL
  // warpDeviceAdaptiveGroups dataset, and Gateway DNS analytics' own
  // uniqueDeviceCount can all disagree on device count in practice
  // (confirmed live on a real account: 4,373 via REST total_count, 2,641
  // via DNS analytics uniqueDeviceCount for the period, 841 distinct
  // deviceIds with connection-status events in the period via GraphQL).
  // These measure different things (all-time enrolled vs. active-in-period
  // vs. devices with a DNS query in-period) — take the largest as the
  // "enrolled devices" headline since it is the closest to true fleet size,
  // never the smallest/most-truncated one.
  const warpCount = Math.max(
    warpDevicesTotalCount,
    (warpLatestStatus as { total: number }).total,
    dnsAnalyticsSummary?.uniqueDeviceCount ?? 0
  );

  // ── Users & seats (real, from REST /access/users) ──────────────────────────
  // access_seat / gateway_seat are real per-user license flags; last_successful_login
  // is a real timestamp used to compute "active in this report period" honestly
  // (no fabricated MAU estimate — a user only counts as active if they actually
  // logged in within [since, until]). seatsTotal uses the REAL total from
  // result_info.total_count (see getAccessUsers) — the per-flag aggregates
  // below are computed over the fetched sample only (capped at 5,000 users)
  // and are noted as approximate on accounts whose true seat count exceeds it.
  const sinceMs = new Date(since).getTime();
  const untilMs = new Date(until).getTime();
  const seatsAccessTotal  = rawAccessUsers.filter((u) => u.access_seat).length;
  const seatsGatewayTotal = rawAccessUsers.filter((u) => u.gateway_seat).length;
  const seatsTotal        = accessUsersTotalCount || new Set(rawAccessUsers.map((u) => u.email)).size;
  const seatsActiveInPeriod = rawAccessUsers.filter((u) => {
    if (!u.last_successful_login) return false;
    const t = new Date(u.last_successful_login).getTime();
    return t >= sinceMs && t <= untilMs;
  }).length;
  const seatsNeverLoggedIn = rawAccessUsers.filter((u) => !u.last_successful_login).length;

  // ── WARP device online/offline (real, from warpDeviceAdaptiveGroups.status) ─
  const warpOnlineDevices  = (warpLatestStatus as { online: number }).online;
  const warpOfflineDevices = (warpLatestStatus as { offline: number }).offline;

  // ── Gateway network-layer bandwidth (real, account-wide only) ──────────────
  const networkAnalyticsObj = networkAnalytics as {
    bytesSent: number; bytesRecvd: number; packetsSent: number; packetsRecvd: number; sessionCount: number;
    retransmittedBytes: number;
    transportStatusBreakdown: { status: string; count: number }[];
    tokenAuthStatusBreakdown: { status: string; count: number }[];
    topColos: { colo: string; country: string; count: number }[];
  };

  // ── CASB findings (real; empty array = no findings/no CASB integration, honest) ─
  const casbFindingsCount = rawCasbFindings.length;
  const casbFindingsBySeverity = new Map<string, number>();
  for (const f of rawCasbFindings) {
    const sev = f.severity || "unknown";
    casbFindingsBySeverity.set(sev, (casbFindingsBySeverity.get(sev) ?? 0) + 1);
  }
  // Real per-finding detail (severity/type/resource/integration) — the REST
  // response already includes these fields; previously only tallied into
  // severity counts and discarded, leaving no way to see WHAT was found.
  const casbFindingsDetail = (rawCasbFindings as Array<{
    id?: string; integration_id?: string; severity?: string; type?: string; resource_name?: string;
  }>)
    .slice(0, 50)
    .map((f) => ({
      id: f.id,
      severity: f.severity || "unknown",
      type: f.type || "Unknown",
      resourceName: f.resource_name || "Unknown resource",
      integrationId: f.integration_id,
    }));

  // ── Configuration changes (real; REST /accounts/{id}/logs/audit, filtered
  // to Zero-Trust-relevant products within the report window) ───────────────
  const configChanges = rawAuditLogs
    .map((e) => ({
      id: e.id,
      time: e.action?.time ?? "",
      actorEmail: e.actor?.email || (e.actor?.type ? `(${e.actor.type})` : "Unknown"),
      actionType: e.action?.type || "unknown",
      description: e.action?.description || "",
      product: e.resource?.product || "unknown",
      result: e.action?.result || "unknown",
    }))
    .sort((a, b) => new Date(b.time).getTime() - new Date(a.time).getTime())
    .slice(0, 50);

  // ── DEX fleet status (real; live device telemetry, up to 60 min back) ─────
  const mapDexStat = (arr: Array<{ value: string; uniqueDevicesTotal: number }> | undefined) =>
    (arr ?? []).map((s) => ({ value: s.value, count: s.uniqueDevicesTotal }));
  const dexFleetStatusObj = dexFleetStatus as {
    uniqueDevicesTotal: number;
    byStatus: Array<{ value: string; uniqueDevicesTotal: number }>;
    byPlatform: Array<{ value: string; uniqueDevicesTotal: number }>;
    byMode: Array<{ value: string; uniqueDevicesTotal: number }>;
    byVersion: Array<{ value: string; uniqueDevicesTotal: number }>;
    byColo: Array<{ value: string; uniqueDevicesTotal: number }>;
  } | null;
  const dexFleetStatusMapped = dexFleetStatusObj
    ? {
        uniqueDevicesTotal: dexFleetStatusObj.uniqueDevicesTotal ?? 0,
        byStatus:   mapDexStat(dexFleetStatusObj.byStatus),
        byPlatform: mapDexStat(dexFleetStatusObj.byPlatform),
        byMode:     mapDexStat(dexFleetStatusObj.byMode),
        byVersion:  mapDexStat(dexFleetStatusObj.byVersion),
        byColo:     mapDexStat(dexFleetStatusObj.byColo),
      }
    : null;

  // ── Recent account-wide alerts (real, from /alerting/v3/history) ───────────
  const recentAlerts = rawAlertsHistory
    .slice()
    .sort((a, b) => new Date(b.sent).getTime() - new Date(a.sent).getTime())
    .slice(0, 15)
    .map((a) => ({ id: a.id, name: a.name, alertType: a.alert_type, sentAt: a.sent, silenced: !!a.silenced }));

  const tunnelList = (rawTunnels as Array<{ id: string; name: string; status: string; created_at?: string; connections?: Array<unknown> }>)
    .map((t) => ({
      id: t.id, name: t.name,
      status: (["healthy","degraded","down","inactive"].includes(t.status) ? t.status : "inactive") as "healthy"|"degraded"|"down"|"inactive",
      createdAt: t.created_at ?? "",
      connections: (t.connections ?? []).length,
      routeCount: (rawRoutes as Array<{ tunnel_id?: string }>).filter((r) => r.tunnel_id === t.id).length,
    }));
  // Exact counts from result_info.total_count (getCloudflaredTunnelCounts) —
  // the inventory list above is capped at 250 tunnels, which would silently
  // under-report totals/healthy on any account with a larger fleet.
  const tunnelsHealthy = tunnelCounts.healthy || tunnelList.filter((t) => t.status === "healthy").length;
  const tunnelsTotalCount = tunnelCounts.total || tunnelList.length;

  // ── Access apps/policies ──────────────────────────────────────────────────
  const accessApps = rawApps.slice(0, POLICY_FETCH_CAP).map((app, i) => {
    const appPolicies = policyResults[i]?.status === "fulfilled" ? policyResults[i].value : [];
    return {
      id: app.id, name: app.name,
      domain: app.domain ?? "",
      type: app.type ?? "self_hosted",
      sessionDuration: app.session_duration ?? "24h",
      allowedIdps: app.allowed_idps ?? [],
      policyCount: (appPolicies as Array<unknown>).length,
      enabled: app.enabled !== false,
    };
  });

  const accessPolicies = rawApps.slice(0, POLICY_FETCH_CAP).flatMap((app, i) => {
    const pols = policyResults[i]?.status === "fulfilled" ? policyResults[i].value as Array<{ id: string; name: string; decision: string; require?: Array<{ mfa?: unknown }>; precedence?: number }> : [];
    return pols.map((p) => ({
      id: p.id, appId: app.id, appName: app.name, name: p.name,
      decision: p.decision,
      requireMfa: Array.isArray(p.require) && p.require.some((r: { mfa?: unknown }) => r.mfa),
      precedence: p.precedence ?? 0,
    }));
  });

  // ── Access policy action breakdown ─────────────────────────────────────────
  // Mirrors "Access admin metrics — Policies configured" in the Application
  // Access Report (Allow / Block / Bypass / Service Auth / Non-Identity).
  const DECISION_LABELS: Record<string, string> = {
    allow: "Allow", block: "Block", bypass: "Bypass",
    non_identity: "Service Auth", service_auth: "Service Auth",
  };
  const policyActionCounts = new Map<string, number>();
  for (const p of accessPolicies) {
    const label = DECISION_LABELS[p.decision] ?? p.decision;
    policyActionCounts.set(label, (policyActionCounts.get(label) ?? 0) + 1);
  }
  const accessPolicyActionBreakdown = Array.from(policyActionCounts.entries())
    .map(([action, count]) => ({ action, count }))
    .sort((a, b) => b.count - a.count);

  // ── Access app-type breakdown ──────────────────────────────────────────────
  // Mirrors the "Access applications by event count" panel in the Application
  // Access Report (Self-hosted / SaaS / Private Network / Infrastructure / MCP
  // Portal). Uses the FULL app list (not the 50-item display cap) for accuracy.
  const APP_TYPE_LABELS: Record<string, string> = {
    self_hosted: "Self-hosted", saas: "SaaS", ssh: "SSH", vnc: "VNC",
    app_launcher: "App Launcher", warp: "WARP", biso: "Browser Isolation",
    bookmark: "Bookmark", dash_sso: "Dashboard SSO", infrastructure: "Infrastructure",
    mcp: "MCP Server",
  };
  const appTypeCounts = new Map<string, number>();
  for (const app of rawApps) {
    const type = app.type || "self_hosted";
    appTypeCounts.set(type, (appTypeCounts.get(type) ?? 0) + 1);
  }
  const accessAppTypeBreakdown = Array.from(appTypeCounts.entries())
    .map(([type, count]) => ({ type: APP_TYPE_LABELS[type] ?? type, count }))
    .sort((a, b) => b.count - a.count);

  // ── MCP visibility ──────────────────────────────────────────────────────────
  // Individual MCP server Access apps (type: "mcp") + MCP server portals
  // (separate resource under /access/ai-controls/mcp/portals).
  const mcpApps = rawApps.filter((a) => a.type === "mcp");
  const mcpAppIdentifiers = new Set(mcpApps.flatMap((a) => [a.id, a.domain].filter(Boolean)));
  const mcpServersCount = mcpApps.length;
  const mcpPortalsCount = rawMcpPortals.length;
  const mcpServerLoginEvents = topApps
    .filter((a) => mcpAppIdentifiers.has(a.name))
    .reduce((s, a) => s + a.requests, 0);

  // Map policy NAME → queriesTotal from DNS analytics.
  // BUG FIX: fetchGatewayDnsTopByPolicy's `policyId` field actually holds the
  // GraphQL `policyName` dimension value (there is no policyId dimension on
  // gatewayResolverQueriesAdaptiveGroups) — it was previously being compared
  // against the REST rule's `id` (a UUID), which can never match a name
  // string, so this annotation was silently always empty. Match by `r.name`.
  const policyQueryMap = new Map<string, number>();
  for (const p of dnsTopPolics) policyQueryMap.set(p.policyId, p.queriesTotal);

  const gtwPolicies = (gatewayRules as CfGatewayRule[]).map((r) => ({
    id: r.id, name: r.name,
    ruleType: (r.rule_type as "dns"|"http"|"l4") ?? "dns",
    action: r.action, enabled: r.enabled !== false,
    filters: r.filters ?? [],
    expression: r.description
      ? `${r.description}${policyQueryMap.has(r.name) ? ` [${policyQueryMap.get(r.name)!.toLocaleString()} queries]` : ""}`
      : policyQueryMap.has(r.name) ? `${policyQueryMap.get(r.name)!.toLocaleString()} queries in period` : "",
  }));

  // ── Control Coverage & Effectiveness ────────────────────────────────────────
  // Denominator-based coverage instead of only raw event counts — mirrors
  // the Zscaler/Prisma/Netskope "coverage vs total" reporting pattern.
  // "Unused" DNS policies are real (policyQueryMap, matched by rule name —
  // see the annotation fix above); HTTP/L4 have no confirmed per-policy
  // dimension so they are NOT given a fabricated unused-policy list.
  const dnsPoliciesAll  = gtwPolicies.filter((p) => p.ruleType === "dns");
  const httpPoliciesAll = gtwPolicies.filter((p) => p.ruleType === "http");
  const l4PoliciesAll   = gtwPolicies.filter((p) => p.ruleType === "l4");
  const appsWithPolicies = accessApps.filter((a) => a.policyCount > 0).length;
  const appIdsWithMfa = new Set(accessPolicies.filter((p) => p.requireMfa).map((p) => p.appId));
  const mfaAppsForCoverage = accessApps.filter((a) => appIdsWithMfa.has(a.id)).length;
  const controlCoverage: ZeroTrustData["controlCoverage"] = {
    access: {
      totalApps: accessApps.length,
      enabledApps: accessApps.filter((a) => a.enabled).length,
      appsWithPolicies,
      appsWithoutPolicies: accessApps.length - appsWithPolicies,
      appsWithMfa: mfaAppsForCoverage,
      appsWithoutMfa: accessApps.length - mfaAppsForCoverage,
      mfaCoveragePct: accessApps.length > 0 ? Math.round((mfaAppsForCoverage / accessApps.length) * 100) : 0,
    },
    gatewayDns: {
      totalPolicies: dnsPoliciesAll.length,
      enabledPolicies: dnsPoliciesAll.filter((p) => p.enabled).length,
      blockPolicies: dnsPoliciesAll.filter((p) => p.action === "block").length,
      unusedPolicies: dnsPoliciesAll
        .filter((p) => p.enabled && (policyQueryMap.get(p.name) ?? 0) === 0)
        .map((p) => ({ name: p.name })),
    },
    gatewayHttp: { totalPolicies: httpPoliciesAll.length, enabledPolicies: httpPoliciesAll.filter((p) => p.enabled).length },
    gatewayL4:   { totalPolicies: l4PoliciesAll.length,   enabledPolicies: l4PoliciesAll.filter((p) => p.enabled).length },
    seats: {
      total: seatsTotal,
      activeInPeriod: seatsActiveInPeriod,
      neverLoggedIn: seatsNeverLoggedIn,
      activePct: seatsTotal > 0 ? Math.round((seatsActiveInPeriod / seatsTotal) * 100) : 0,
    },
  };

  // ── Generative AI / Shadow AI usage ────────────────────────────────────────
  // Real Cloudflare category classification (DNS + HTTP Gateway traffic
  // tagged with category id 184 "Artificial Intelligence", confirmed live
  // via /gateway/categories) — see fetchGenAiUsage() in cf-zerotrust-graphql.ts.
  // Replaces the previous keyword/substring app-name guessing heuristic
  // entirely: this now reflects Cloudflare's own real per-request
  // classification instead of a manually maintained app-name list.
  const shadowItAppsTyped  = shadowItObj.discoveredApps  as Array<{ name: string; category: string; count: number }>;
  const appStatuses        = shadowItObj.appStatuses ?? {};
  const genAiObj = genAi as { totalRequests: number; uniqueApps: number; uniqueUsers: number; apps: { name: string; count: number }[]; users: { email: string; count: number }[] };

  // Governance check: inspect the admin's OWN real Gateway policy names/
  // descriptions/filters for AI-related terms. This is a heuristic, but it
  // inspects real policy metadata text (not traffic) so it never fabricates
  // a number — worst case it under/over-detects an admin-authored label.
  const AI_POLICY_TERMS = ["generative ai", "artificial intelligence", "genai", "chatgpt", "openai", "claude", "gemini", "copilot"];
  const hasAiGovernancePolicy = gtwPolicies.some((p) => {
    const text = `${p.name} ${p.expression ?? ""} ${(p.filters ?? []).join(" ")}`.toLowerCase();
    return AI_POLICY_TERMS.some((k) => text.includes(k));
  });

  const aiAppUsage: ZeroTrustData["aiAppUsage"] = {
    apps: genAiObj.apps.map((a) => ({
      name: a.name,
      category: "Artificial Intelligence",
      count: a.count,
      status: appStatuses[a.name],
    })),
    users: genAiObj.users.slice(0, 15),
    totalRequests: genAiObj.totalRequests,
    uniqueApps: genAiObj.uniqueApps,
    uniqueUsers: genAiObj.uniqueUsers,
    hasGovernancePolicy: hasAiGovernancePolicy,
  };

  // ── Recommendations / Remediation Findings ────────────────────────────────
  // Single source of truth: each entry drives BOTH the point-in-time
  // `recommendations` list (unchanged shape, used by the AI summary and the
  // Recommendations/Opportunity sections) AND the persisted, D1-backed
  // remediation register (`remediationFindings` — see zt-remediation.ts),
  // which is what turns a recommendation into a tracked-over-time finding
  // with age, owner, and status instead of a fresh, un-auditable bullet
  // point on every single report run.
  const mfaAppsCount = accessPolicies.filter((p) => p.requireMfa).length;
  const dnsBlockPolicyCount = gtwPolicies.filter((p) => p.ruleType === "dns" && p.action === "block").length;
  const httpPolicyCount = gtwPolicies.filter((p) => p.ruleType === "http").length;
  const dlpProfileCount = (rawDlpProfs as Array<unknown>).length;

  const findingDefs: Array<{
    key: string; active: boolean; priority: "high" | "medium" | "low";
    title: string; description: string; benefit: string; evidence: string;
  }> = [
    {
      key: "mfa-coverage", active: mfaAppsCount === 0, priority: "high",
      title: "Enforce MFA on All Access Applications",
      description: "No Access policies require MFA. Add a 'Require' rule with your IdP's MFA method to all applications.",
      benefit: "Prevents credential stuffing and account takeover — MFA blocks 99.9% of automated attacks",
      evidence: `0 of ${accessPolicies.length} Access policies require MFA`,
    },
    {
      key: "dns-blocking-policies", active: dnsBlockPolicyCount < 3, priority: "high",
      title: "Add Gateway DNS Blocking Policies for Malware & Phishing",
      description: "Less than 3 DNS blocking policies configured. Add policies blocking 'Malware', 'Phishing', and 'Command and Control' categories.",
      benefit: "DNS filtering stops threats before connections are established — zero latency impact",
      evidence: `${dnsBlockPolicyCount} DNS blocking polic${dnsBlockPolicyCount === 1 ? "y" : "ies"} configured (recommended: 3+)`,
    },
    {
      key: "warp-deployment", active: warpCount === 0, priority: "medium",
      title: "Deploy WARP Client for Device-Level Security",
      description: "No WARP-enrolled devices detected. Deploy the WARP client to route all device traffic through Cloudflare Gateway for full visibility.",
      benefit: "Enables device posture checks, split tunneling, and egress filtering for all managed devices",
      evidence: "0 WARP-enrolled devices",
    },
    {
      key: "http-gateway-filtering", active: httpPolicyCount === 0, priority: "medium",
      title: "Enable HTTP Gateway Filtering",
      description: "No HTTP filtering policies configured. Add policies to inspect and block malicious web content, shadow IT, and data exfiltration.",
      benefit: "HTTP inspection provides full visibility into SaaS usage and can detect data loss attempts",
      evidence: "0 HTTP Gateway policies configured",
    },
    {
      key: "dlp-profiles", active: dlpProfileCount === 0, priority: "medium",
      title: "Configure DLP Profiles to Prevent Data Loss",
      description: "No DLP profiles configured. Add predefined profiles for PII, credit cards, and custom sensitive data patterns.",
      benefit: "Prevents accidental or malicious exfiltration of sensitive customer and company data",
      evidence: "0 DLP profiles configured",
    },
    {
      key: "cloudflare-tunnel", active: tunnelsTotalCount === 0, priority: "low",
      title: "Replace VPN with Cloudflare Tunnel",
      description: "No Cloudflare Tunnels configured. Replace your VPN with Tunnel + Access for zero-trust network access to internal applications.",
      benefit: "Eliminates VPN attack surface — no inbound firewall rules needed, connections are outbound-only",
      evidence: "0 Cloudflare Tunnels configured",
    },
    {
      key: "genai-governance", active: aiAppUsage.uniqueApps > 0 && !aiAppUsage.hasGovernancePolicy, priority: "medium",
      title: `Govern Generative AI (Shadow AI) Usage — ${aiAppUsage.uniqueApps} App${aiAppUsage.uniqueApps === 1 ? "" : "s"} Discovered`,
      description: `Users are accessing generative AI tools (e.g. ${genAiObj.apps.slice(0,3).map((a) => a.name).join(", ") || "ChatGPT, Claude"}) with no Gateway policy specifically governing GenAI traffic. Add DNS/HTTP categories or app-based policies for "Generative AI" plus a DLP profile to inspect prompts for sensitive data.`,
      benefit: "Prevents accidental leakage of confidential data into public AI models and gives visibility/audit trail into GenAI adoption across the organization",
      evidence: `${aiAppUsage.uniqueApps} GenAI app(s), ${aiAppUsage.uniqueUsers} user(s), no governing Gateway policy`,
    },
    {
      key: "warp-offline-devices", active: warpLatestStatus.total > 0 && warpLatestStatus.offline > warpLatestStatus.online, priority: "medium",
      title: `${warpLatestStatus.offline} of ${warpLatestStatus.total} WARP Devices Not Connected`,
      description: "More than half of enrolled WARP devices had a non-connected status (disconnected, no network, or a connectivity check failure) most recently in this period. Investigate client health, captive-portal issues, or expired device certificates.",
      benefit: "Devices that are not connected to WARP are not protected by Gateway policies or posture checks",
      evidence: `${warpLatestStatus.offline} of ${warpLatestStatus.total} WARP devices not connected`,
    },
    {
      key: "stale-seats", active: seatsTotal > 0 && seatsNeverLoggedIn / seatsTotal > 0.3, priority: "low",
      title: `${seatsNeverLoggedIn} Provisioned Users Have Never Logged In`,
      description: `${seatsNeverLoggedIn} of ${seatsTotal} provisioned Access/Gateway seats have no recorded successful login. Review whether these are stale accounts consuming licensed seats.`,
      benefit: "Reduces licensing cost and shrinks the attack surface from unused/orphaned accounts",
      evidence: `${seatsNeverLoggedIn} of ${seatsTotal} seats never logged in`,
    },
  ];

  const recommendations: ZeroTrustData["recommendations"] = findingDefs
    .filter((f) => f.active)
    .map((f) => ({ priority: f.priority, title: f.title, description: f.description, benefit: f.benefit }));

  const remediationFindings: RemediationFinding[] = findingDefs
    .filter((f) => f.active)
    .map((f) => ({ key: f.key, severity: f.priority, title: f.title, description: f.description, benefit: f.benefit, evidence: f.evidence }));

  // ── Assemble response ─────────────────────────────────────────────────────
  const zerotrust: ZeroTrustData = {
    meta: {
      accountId, accountName,
      since, until,
      generatedAt: new Date().toISOString(),
      days, periodLabel: calendarPeriodLabel ?? (days === 1 ? "1-Day" : `${days}-Day`),
    },
    summary: {
      totalAuthEvents: totalAuth, authSuccessRate: successRate,
      uniqueUsers: uniqueUsersSet.size, uniqueApps: uniqueAppsSet.size,
      blockedAuthEvents: totalBlock, mfaChallenges: totalMfa,
      gatewayDnsQueries: totalDnsQ, gatewayDnsBlocked: totalDnsBlk,
      gatewayHttpRequests: totalHttpQ, gatewayHttpBlocked: totalHttpBlk,
      httpRbiSessions: totalHttpRbi,
      httpQuarantinedRequests: totalHttpQuarantined, gatewayMcpHttpRequests: totalMcpHttp,
      gatewayL4Sessions: totalL4, gatewayL4Blocked: totalL4Blk,
      shadowItAppsDiscovered: shadowItObj.discoveredApps.length,
      warpEnrolledDevices: warpCount,
      warpOnlineDevices: warpOnlineDevices, warpOfflineDevices: warpOfflineDevices,
      tunnelsHealthy, tunnelsTotal: tunnelsTotalCount,
      seatsTotal, seatsAccessTotal, seatsGatewayTotal, seatsActiveInPeriod, seatsNeverLoggedIn,
      gatewayBandwidthBytesSent: networkAnalyticsObj.bytesSent, gatewayBandwidthBytesRecvd: networkAnalyticsObj.bytesRecvd,
      gatewayRetransmittedBytes: networkAnalyticsObj.retransmittedBytes,
      casbFindingsCount,
      mcpServersCount, mcpPortalsCount, mcpServerLoginEvents,
      // Dashboard analytics API additions (see cf-dashboard-analytics.ts)
      warpAndServiceTokenLoginEvents: warpAndServiceTokenEvents,
      gatewayDnsUniqueUsers: dnsAnalyticsSummary?.uniqueUserCount ?? 0,
      gatewayDnsUniqueDevices: dnsAnalyticsSummary?.uniqueDeviceCount ?? 0,
      gatewayHttpUniqueUsers: httpAnalyticsSummary?.uniqueUserCount ?? 0,
      gatewayHttpUniqueApps: httpAnalyticsSummary?.uniqueAppCount ?? 0,
      gatewayHttpBandwidthBytes: httpAnalyticsSummary?.bandwidthConsumedBytes ?? 0,
      gatewayHttpUploadedBytes: httpAnalyticsSummary?.uploadedBytes ?? 0,
      gatewayHttpDownloadedBytes: httpAnalyticsSummary?.downloadedBytes ?? 0,
      gatewayHttpDlpMatchesTotal: httpAnalyticsSummary?.dlpProfileMatchesTotal ?? 0,
      gatewayMcpDistinctUsers: httpAnalyticsSummary?.mcpDistinctUsers ?? 0,
      gatewayNetworkBandwidthBytes: networkAnalyticsSummary?.bandwidthConsumedBytes ?? 0,
      gatewayNslTotalBytes: nslTotalBytes ?? 0,
      casbDlpFindingsCount: casbDlpFindings?.currentTotal ?? 0,
      cdsScanMatchesTotal: cdsScanResults?.matchesTotal ?? 0,
    },
    // Access
    accessApps,
    accessPolicies,
    accessIdps: (idps as Array<{ id: string; name: string; type: string }>).map((i) => ({ id: i.id, name: i.name, type: i.type })),
    accessAuthTimeSeries: accessLoginsSeries.length > 0
      ? accessLoginsSeries.map((d: { date: string; allow: number; block: number }) => ({ date: d.date, allow: d.allow, block: d.block, mfa: 0 }))
      : authSeries,
    accessLoginsTopApps, accessLoginsTopUsers,
    accessTopApps: topApps,
    accessTopUsers: topUsers,
    accessTopBlockedUsers: (topUsers as Array<{ email: string; requests: number; blocked: number; country: string }>).filter((u) => u.blocked > 0).sort((a, b) => b.blocked - a.blocked).map((u) => ({ email: u.email, count: u.blocked, country: u.country })),
    accessGeoDistribution: geoDistrib,
    accessTopSourceIps: topSourceIps,
    accessAuthMethodBreakdown: authMethodBreak,
    accessAppTypeBreakdown,
    accessPolicyActionBreakdown,
    accessDailyActiveUsers: dailyActive,
    accessIdpBreakdown: idpBreakdown,
    accessAppBreakdown: appBreakdown,
    accessFailedLoginDetails: failedDetails,
    accessAnomalies: detectAccessAnomalies(
      appBreakdown as Parameters<typeof detectAccessAnomalies>[0],
      failedDetails as Parameters<typeof detectAccessAnomalies>[1],
      (geoDistrib as Array<{ country: string }>).map((g) => g.country),
      dailyActive as Parameters<typeof detectAccessAnomalies>[3]
    ),
    // Gateway DNS
    gatewayDnsTimeSeries: dnsSeries,
    gatewayDnsResolverBreakdown: dnsBreakdown,
    gatewayDnsTopBlockedDomains: dnsTopBlockedMerged.length > 0 ? dnsTopBlockedMerged : dnsTopDoms,
    gatewayDnsTopAllowedDomains: dnsTopAllowed,
    gatewayDnsTopBlockedCategories: dnsCats,
    // Gateway HTTP
    gatewayHttpTimeSeries: httpSeries,
    gatewayHttpTopBlockedDomains: httpTopDoms,
    gatewayHttpTopAllowedDomains: httpTopAllowed,
    gatewayHttpTopBlockedCategories: httpCats,
    gatewayHttpStatusCodes: httpStatusCodes as ZeroTrustData["gatewayHttpStatusCodes"],
    // Gateway L4 / Network Session Analytics
    gatewayL4TimeSeries: l4DataObj.timeSeries,
    gatewayL4BlockedDestinations: l4DataObj.blockedDestinations as ZeroTrustData["gatewayL4BlockedDestinations"],
    gatewayL4Protocols: l4DataObj.protocols as ZeroTrustData["gatewayL4Protocols"],
    gatewayL4SourceCountries: l4DataObj.sourceCountries as ZeroTrustData["gatewayL4SourceCountries"],
    gatewayL4PortBreakdown: l4DataObj.portBreakdown as ZeroTrustData["gatewayL4PortBreakdown"],
    gatewayTransportStatusBreakdown: networkAnalyticsObj.transportStatusBreakdown,
    gatewayTokenAuthStatusBreakdown: networkAnalyticsObj.tokenAuthStatusBreakdown,
    gatewayTopColos: networkAnalyticsObj.topColos,
    privateNetworkOrigins: privateNetOrigins as ZeroTrustData["privateNetworkOrigins"],
    // Shadow IT
    shadowItApps: shadowItAppsTyped.map((a) => ({
      name: a.name, category: a.category, count: a.count,
      status: appStatuses[a.name],
    })),
    shadowItCategoryBreakdown: shadowItObj.categoryBreakdown as ZeroTrustData["shadowItCategoryBreakdown"],
    shadowItUserMappings: shadowItObj.userAppMappings as ZeroTrustData["shadowItUserMappings"],
    // Generative AI / Shadow AI usage — real Cloudflare category classification
    aiAppUsage,
    // Gateway config
    gatewayPolicies: gtwPolicies,
    gatewayLocations: (gwLocations as Array<{ id: string; name: string; doh_subdomain?: string; ip?: string[] }>).map((l) => ({ id: l.id, name: l.name, dnsOverHttps: !!l.doh_subdomain, ipv4Destination: l.ip?.[0] })),
    // WARP
    warpDevices: (rawDevices as Array<{ id: string; name: string; user?: { email?: string }; os?: string; device_type?: string; created?: string; last_seen?: string }>).slice(0, 100).map((d) => ({
      id: d.id, name: d.name,
      user: d.user?.email ?? "unknown",
      os: d.os ?? d.device_type ?? "Unknown",
      enrolledAt: d.created ?? "", lastSeen: d.last_seen ?? "",
      postureStatus: "unknown" as const,
    })),
    warpPostureRules: (postureRules as Array<{ id: string; name: string; type: string; enabled?: boolean }>).map((r) => ({ id: r.id, name: r.name, type: r.type, enabled: r.enabled !== false })),
    warpOsBreakdown: (() => {
      const byOs = new Map<string, number>();
      for (const d of rawDevices as Array<{ os?: string; device_type?: string }>) {
        const os = d.os ?? d.device_type ?? "Unknown";
        byOs.set(os, (byOs.get(os) ?? 0) + 1);
      }
      return Array.from(byOs.entries()).map(([os, count]) => ({ os, count })).sort((a, b) => b.count - a.count);
    })(),
    warpDeviceStatusBreakdown: warpStatusBreakdown as ZeroTrustData["warpDeviceStatusBreakdown"],
    warpDeviceStatusTimeSeries: warpStatusSeries as ZeroTrustData["warpDeviceStatusTimeSeries"],
    // Tunnels
    tunnels: tunnelList,
    tunnelRoutes: (rawRoutes as Array<{ network: string; tunnel_id?: string; tunnel_name?: string; comment?: string }>).map((r) => ({ network: r.network, tunnelId: r.tunnel_id ?? "", tunnelName: r.tunnel_name ?? "", comment: r.comment })),
    // DLP — configuration + real per-period match data (REST analytics API;
    // GraphQL genuinely has no per-profile match dataset, but this REST
    // endpoint does — see dlpProfileMatches/dlpActivitySummary below).
    dlpProfiles: (rawDlpProfs as Array<{ id: string; name: string; type: "custom"|"predefined" }>).map((p) => ({ id: p.id, name: p.name, type: p.type, matchCount: 0 })),
    // CASB
    casbFindingsBySeverity: Array.from(casbFindingsBySeverity.entries()).map(([severity, count]) => ({ severity, count })),
    casbFindingsDetail,
    // Alerts
    recentAlerts,
    recommendations,
    // Data-quality additions
    accessDistinctCounts: distinctCounts as ZeroTrustData["accessDistinctCounts"],
    gatewayHttpTopBlockedUsers: httpTopBlockedUsers as ZeroTrustData["gatewayHttpTopBlockedUsers"],
    gatewayDlpQuarantineTimeSeries: dlpQuarantineSeries as ZeroTrustData["gatewayDlpQuarantineTimeSeries"],
    configChanges,
    dexFleetStatus: dexFleetStatusMapped,
    // Dashboard analytics API additions (see cf-dashboard-analytics.ts)
    gatewayHttpTopBandwidthUsers: httpTopBandwidthUsers,
    gatewayHttpTopCountries: httpTopCountries,
    gatewayNslByOfframp: nslByOfframp,
    gatewayNslTopUsers: nslTopUsers,
    dlpActivitySummary: dlpActivity
      ? { hitCount: dlpActivity.dlpHitCount, scanCount: dlpActivity.dlpScanCount, prevHitCount: dlpActivity.prevDlpHitCount, prevScanCount: dlpActivity.prevDlpScanCount }
      : undefined,
    dlpProfileMatches,
    dlpTopWebsites,
    dataConfidence: {
      mfaChallenges: "No Cloudflare API or GraphQL dataset exposes MFA-challenge events for Access logins. This value is always 0 and does not mean MFA is unused — it means MFA usage is not independently measurable via API today.",
      accessTopUsers: "Derived from the latest 1,000 Access authentication log rows (REST, WARP client session events excluded), then ranked. On high-volume accounts this is a recent sample, not the full period — see accessLoginsTopUsers for the dashboard-exact top-N over the full period, or accessDistinctCounts for a higher-limit distinct-count cross-check.",
      warpPostureRules: "Lists configured posture rules only. Per-device pass/fail evaluation results are not exposed by the standard REST API — Enterprise accounts can obtain this via Logpush (Device Posture Results dataset).",
      dexFleetStatus: "Live device telemetry from the last 60 minutes — NOT scoped to the report period (since/until). Use it as a right-now device-health snapshot alongside the historical WARP connection-status trend.",
      gatewayHttpTopBlockedUsers: "HTTP Gateway only — no equivalent per-user attribution is confirmed available on the DNS or Network (L4) Gateway datasets.",
      controlCoverage: "Unused-policy detection is DNS-only — no per-policy match dimension is confirmed available for HTTP or Network (L4) Gateway rules via GraphQL today.",
      totalAuthEvents: "Real interactive Access login attempts (dashboard-exact, excludes WARP client session/reconnect events and service-token validations). See summary.warpAndServiceTokenLoginEvents for the excluded volume.",
      seatsActiveInPeriod: accessUsersTotalCount > rawAccessUsers.length
        ? `Computed over a sample of ${rawAccessUsers.length} of ${accessUsersTotalCount} total seats — seatsTotal itself is the exact total, but per-seat activity/never-logged-in figures are approximate on this large an account.`
        : "Computed over all seats returned by the Access Users API.",
      // The ~4-week quota applies to ANY range whose start is more than
      // ~4w3d before "now" (verified live) — not just calendar months. Old
      // custom ranges hit it exactly the same way, so key the note on the
      // actual age of the range rather than the selected mode. Rolling
      // windows (max 30 days, +2h buffered since) never reach it.
      ...(Date.parse(sinceTs) < Date.now() - 31 * 24 * 60 * 60 * 1000 ? {
        gatewayDnsBreakdown: "This report's period starts more than ~4 weeks ago. DNS totals (queries/blocked) come from Cloudflare's analytics API and are always accurate for the full period. However, the DNS breakdown widgets below (top blocked/allowed domains, category breakdown, resolver-decision mix, daily trend) use a GraphQL dataset that Cloudflare limits to roughly the last 4 weeks regardless of the requested date range — so for this older range those breakdowns may be empty. This is a genuine Cloudflare API retention limit, not a bug.",
      } : {}),
    },
    controlCoverage,
    errors: fetchErrors,
  };

  // ── Baseline / period-over-period comparison ──────────────────────────────
  // Compare against the most recent prior snapshot for this account (if any),
  // then persist this generation as the new snapshot. Both steps fail soft —
  // a D1 error here never blocks the report itself.
  zerotrust.baseline = await getBaseline(db, accountId, zerotrust.meta.generatedAt, zerotrust.summary);
  await saveSnapshot(db, accountId, zerotrust.meta.generatedAt, since, until, days, zerotrust.summary);

  // ── Remediation register ────────────────────────────────────────────────
  // Sync this period's findings (open/update/auto-resolve), then read back
  // the full register so the report always reflects durable state (age,
  // owner, status) rather than only this run's raw findings.
  await syncRemediationFindings(db, accountId, zerotrust.meta.generatedAt, remediationFindings);
  zerotrust.remediationRegister = await getRemediationRegister(db, accountId);

  // ── CASB finding register ──────────────────────────────────────────────
  // Same lifecycle-tracking pattern, applied to individual REST Data
  // Security Posture findings (keyed by Cloudflare's own finding id) rather
  // than a fixed set of boolean conditions.
  const casbFindingInputs: CasbFindingInput[] = casbFindingsDetail.map((f) => ({
    id: f.id, severity: f.severity, type: f.type, resourceName: f.resourceName, integrationId: f.integrationId,
  }));
  await syncCasbFindings(db, accountId, zerotrust.meta.generatedAt, casbFindingInputs);
  zerotrust.casbFindingRegister = await getCasbFindingRegister(db, accountId);

  // ── Alert investigation register ──────────────────────────────────────
  // Ingests real Cloudflare alerting history (REST /alerting/v3/history —
  // previously fetched into `recentAlerts` but never rendered anywhere)
  // into a durable, operator-tracked investigation workflow.
  const alertInputs: AlertInput[] = recentAlerts.map((a) => ({
    id: a.id, name: a.name, alertType: a.alertType, sentAt: a.sentAt, silenced: a.silenced,
  }));
  await syncAlerts(db, accountId, zerotrust.meta.generatedAt, alertInputs);
  zerotrust.alertRegister = await getAlertRegister(db, accountId);

  return zerotrust;
}
