/**
 * Cloudflare Zero Trust dashboard analytics API.
 *
 * These are the EXACT endpoints the Cloudflare dashboard's Zero Trust
 * Analytics Overview page uses (confirmed live via HAR capture + direct
 * verification with a standard API token against a real production
 * account — NOT dashboard-session-only). They are marked "API in beta:
 * expect breaking changes" by Cloudflare itself, so every function here
 * fails soft (returns null/[] on any error) — a breaking change degrades
 * the report to the existing GraphQL-derived numbers, it never breaks
 * report generation.
 *
 * Why this file exists at all: the GraphQL `accessLoginRequestsAdaptiveGroups`
 * dataset (used elsewhere in this codebase) counts EVERY login request,
 * including WARP client device session events (app type "warp") and
 * service-token validations — confirmed live on a real account where this
 * inflated "total auth events" to 4,070 while the dashboard's own Access
 * card showed 12 real interactive login attempts for the same period and
 * account. These `/analytics/query/access-logins/*` endpoints are what the
 * dashboard itself uses to compute that 12 — so this is the source of
 * truth for headline KPIs, not a second opinion.
 *
 * Verified live (2026-09-10) against a real Cloudflare One account:
 *   access-logins/summary   → matches dashboard "Access" card
 *   gateway-dns/summary     → matches dashboard "DNS" card (queries, blocked, unique users/devices)
 *   gateway-http/summary    → matches dashboard "HTTP" card (requests, DLP matches, MCP stats)
 *   gateway-network/summary → matches dashboard "Network" card
 *   gateway_nsl/*           → matches dashboard "Network sessions" card (bytes by offramp)
 *   /analytics/gateway/proxy/http?groupBy=dlpProfiles|dlpActivity|dlpWebsite
 *                           → real per-profile DLP match counts (previously
 *                             claimed as "not available via API" — it is).
 */

const CF_API = "https://api.cloudflare.com/client/v4";

// ─── Generic POST helper for /analytics/query/{dataset}/{endpoint} ───────────

async function analyticsPost<T = unknown>(
  token: string, accountId: string, path: string, body: Record<string, unknown>
): Promise<T | null> {
  try {
    const res = await fetch(`${CF_API}/accounts/${accountId}/${path}`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!res.ok) return null;
    const j = (await res.json()) as { success?: boolean; result?: T };
    return j.success ? (j.result ?? null) : null;
  } catch { return null; }
}

async function analyticsGet<T = unknown>(token: string, accountId: string, pathWithQuery: string): Promise<T | null> {
  try {
    const res = await fetch(`${CF_API}/accounts/${accountId}/${pathWithQuery}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok) return null;
    const j = (await res.json()) as { success?: boolean; result?: T };
    return j.success ? (j.result ?? null) : null;
  } catch { return null; }
}

// =============================================================================
// ACCESS LOGINS — /analytics/query/access-logins/*
// =============================================================================

export interface AccessLoginsSummary {
  attemptsAllowed: number;
  attemptsBlocked: number;
  attemptsTotal: number;
  prevAttemptsTotal: number;
}

/** Real interactive Access login attempts — excludes WARP client session
 *  events and service-token validations (confirmed: dashboard's own "Access"
 *  KPI card uses exactly this endpoint). */
export async function fetchAccessLoginsSummary(
  token: string, accountId: string, since: string, until: string
): Promise<AccessLoginsSummary | null> {
  const result = await analyticsPost<{
    currentTotal?: Array<{ allowed: boolean; attemptsTotal: number }>;
    previousTotal?: Array<{ allowed: boolean; attemptsTotal: number }>;
  }>(token, accountId, "analytics/query/access-logins/summary", {
    from: since, to: until, groupBy: ["allowed"], filters: [],
  });
  if (!result) return null;
  const cur = result.currentTotal ?? [];
  const prev = result.previousTotal ?? [];
  const allowed = cur.find((r) => r.allowed)?.attemptsTotal ?? 0;
  const blocked = cur.find((r) => !r.allowed)?.attemptsTotal ?? 0;
  return {
    attemptsAllowed: allowed,
    attemptsBlocked: blocked,
    attemptsTotal: allowed + blocked,
    prevAttemptsTotal: prev.reduce((s, r) => s + r.attemptsTotal, 0),
  };
}

export interface AccessLoginsDay { date: string; allow: number; block: number }

export async function fetchAccessLoginsTimeSeries(
  token: string, accountId: string, since: string, until: string
): Promise<AccessLoginsDay[]> {
  const result = await analyticsPost<{
    slots?: Array<{ allowed: boolean; attemptsTotal: number; timestamp: string }>;
  }>(token, accountId, "analytics/query/access-logins/timeseries", {
    from: since, to: until, groupBy: ["allowed"], stats: ["attemptsTotal"], filters: [],
  });
  if (!result?.slots) return [];
  const byDate = new Map<string, AccessLoginsDay>();
  for (const s of result.slots) {
    const date = s.timestamp.slice(0, 10);
    if (!byDate.has(date)) byDate.set(date, { date, allow: 0, block: 0 });
    const d = byDate.get(date)!;
    if (s.allowed) d.allow += s.attemptsTotal; else d.block += s.attemptsTotal;
  }
  return Array.from(byDate.values()).sort((a, b) => a.date.localeCompare(b.date));
}

export async function fetchAccessLoginsTopApps(
  token: string, accountId: string, since: string, until: string, n = 10
): Promise<{ appId: string; appName: string; attemptsTotal: number }[]> {
  const result = await analyticsPost<Array<{ appId: string; appName?: string; attemptsTotal: number }>>(
    token, accountId, "analytics/query/access-logins/top-n",
    { from: since, to: until, groupBy: ["appId"], orderBy: "attemptsTotal", n, filters: [] }
  );
  return (result ?? []).map((r) => ({ appId: r.appId, appName: r.appName ?? r.appId, attemptsTotal: r.attemptsTotal }));
}

export async function fetchAccessLoginsTopUsers(
  token: string, accountId: string, since: string, until: string, n = 15
): Promise<{ email: string; attemptsTotal: number }[]> {
  const result = await analyticsPost<Array<{ email: string; attemptsTotal: number }>>(
    token, accountId, "analytics/query/access-logins/top-n",
    { from: since, to: until, groupBy: ["email"], orderBy: "attemptsTotal", n, filters: [] }
  );
  return result ?? [];
}

// =============================================================================
// GATEWAY DNS — /analytics/query/gateway-dns/*
// =============================================================================

export interface GatewayDnsAnalyticsSummary {
  queriesTotal: number;
  queriesBlocked: number;
  uniqueUserCount: number;
  uniqueDeviceCount: number;
  queryBytesTotal: number;
  responseBytesTotal: number;
}

export async function fetchGatewayDnsAnalyticsSummary(
  token: string, accountId: string, since: string, until: string
): Promise<GatewayDnsAnalyticsSummary | null> {
  const [totalsResult, byDecisionResult] = await Promise.all([
    analyticsPost<{
      currentTotal?: Array<{
        queriesTotal: number; queryBytesTotal: number; responseBytesTotal: number;
        uniqueDeviceCount: number; uniqueUserCount: number;
      }>;
    }>(token, accountId, "analytics/query/gateway-dns/summary", { from: since, to: until, groupBy: [], stats: [], filters: [] }),
    analyticsPost<{
      currentTotal?: Array<{ resolverDecision: string; queriesTotal: number }>;
    }>(token, accountId, "analytics/query/gateway-dns/summary", { from: since, to: until, groupBy: ["resolverDecision"], stats: ["queriesTotal"] }),
  ]);
  const totals = totalsResult?.currentTotal?.[0];
  if (!totals) return null;
  // "Blocked" = blockedRule + blockedAlwaysCategory — the exact filter set
  // the dashboard's own top-n blocked-domains query uses.
  const BLOCKED_DECISIONS = new Set(["blockedRule", "blockedAlwaysCategory", "blockedAlways"]);
  const queriesBlocked = (byDecisionResult?.currentTotal ?? [])
    .filter((r) => BLOCKED_DECISIONS.has(r.resolverDecision))
    .reduce((s, r) => s + r.queriesTotal, 0);
  return {
    queriesTotal: totals.queriesTotal,
    queriesBlocked,
    uniqueUserCount: totals.uniqueUserCount ?? 0,
    uniqueDeviceCount: totals.uniqueDeviceCount ?? 0,
    queryBytesTotal: totals.queryBytesTotal ?? 0,
    responseBytesTotal: totals.responseBytesTotal ?? 0,
  };
}

export async function fetchGatewayDnsTopBlockedDestinations(
  token: string, accountId: string, since: string, until: string, n = 15
): Promise<{ destination: string; queriesTotal: number }[]> {
  const result = await analyticsPost<Array<{ destination: string; queriesTotal: number }>>(
    token, accountId, "analytics/query/gateway-dns/top-n",
    {
      from: since, to: until, groupBy: ["destination"], orderBy: "queriesTotal", n,
      filters: [{ name: "resolverDecision", op: "eq", values: ["blockedRule", "blockedAlwaysCategory"] }],
      stats: ["queriesTotal"],
    }
  );
  return result ?? [];
}

// =============================================================================
// GATEWAY HTTP — /analytics/query/gateway-http/*
// =============================================================================

export interface GatewayHttpAnalyticsSummary {
  requestsTotal: number;
  requestsBlocked: number;
  requestsIsolated: number;
  bandwidthConsumedBytes: number;
  uploadedBytes: number;
  downloadedBytes: number;
  uniqueAppCount: number;
  uniqueUserCount: number;
  dlpProfileMatchesTotal: number;
  mcpDistinctUsers: number;
  mcpUrlCountTotal: number;
}

export async function fetchGatewayHttpAnalyticsSummary(
  token: string, accountId: string, since: string, until: string
): Promise<GatewayHttpAnalyticsSummary | null> {
  const [totalsResult, byActionResult] = await Promise.all([
    analyticsPost<{
      currentTotal?: Array<{
        bandwidthConsumedBytes: number; dlpProfileMatchesTotal: number;
        downloadedBytes: number; httpHostDownloadedBytes: number; httpHostUploadedBytes: number;
        mcpDistinctUsers: number; mcpUrlCountTotal: number; requestsTotal: number;
        uniqueAppCount: number; uniqueUserCount: number; uploadedBytes: number;
      }>;
    }>(token, accountId, "analytics/query/gateway-http/summary", { from: since, to: until, groupBy: [], stats: [], filters: [] }),
    analyticsPost<{ currentTotal?: Array<{ action: string; requestsTotal: number }> }>(
      token, accountId, "analytics/query/gateway-http/summary", { from: since, to: until, groupBy: ["action"], stats: ["requestsTotal"] }
    ),
  ]);
  const totals = totalsResult?.currentTotal?.[0];
  if (!totals) return null;
  const byAction = byActionResult?.currentTotal ?? [];
  return {
    requestsTotal: totals.requestsTotal,
    requestsBlocked: byAction.find((r) => r.action === "block")?.requestsTotal ?? 0,
    requestsIsolated: byAction.find((r) => r.action === "isolate")?.requestsTotal ?? 0,
    bandwidthConsumedBytes: totals.bandwidthConsumedBytes ?? 0,
    uploadedBytes: totals.uploadedBytes ?? 0,
    downloadedBytes: totals.downloadedBytes ?? 0,
    uniqueAppCount: totals.uniqueAppCount ?? 0,
    uniqueUserCount: totals.uniqueUserCount ?? 0,
    dlpProfileMatchesTotal: totals.dlpProfileMatchesTotal ?? 0,
    mcpDistinctUsers: totals.mcpDistinctUsers ?? 0,
    mcpUrlCountTotal: totals.mcpUrlCountTotal ?? 0,
  };
}

export async function fetchGatewayHttpTopBandwidthUsers(
  token: string, accountId: string, since: string, until: string, n = 10
): Promise<{ email: string; bandwidthConsumedBytes: number }[]> {
  const result = await analyticsPost<Array<{ email: string; bandwidthConsumedBytes: number }>>(
    token, accountId, "analytics/query/gateway-http/top-n",
    { from: since, to: until, groupBy: ["email"], orderBy: "bandwidthConsumedBytes", n, filters: [], stats: ["bandwidthConsumedBytes"] }
  );
  return result ?? [];
}

export async function fetchGatewayHttpTopCountries(
  token: string, accountId: string, since: string, until: string, n = 10
): Promise<{ country: string; requestsTotal: number }[]> {
  const result = await analyticsPost<Array<{ country: string; requestsTotal: number }>>(
    token, accountId, "analytics/query/gateway-http/top-n",
    { from: since, to: until, groupBy: ["country"], orderBy: "requestsTotal", n, filters: [], stats: ["requestsTotal"] }
  );
  return result ?? [];
}

// =============================================================================
// GATEWAY NETWORK (L4) — /analytics/query/gateway-network/*
// =============================================================================

export interface GatewayNetworkAnalyticsSummary {
  requestsTotal: number;
  requestsBlocked: number;
  bandwidthConsumedBytes: number;
}

export async function fetchGatewayNetworkAnalyticsSummary(
  token: string, accountId: string, since: string, until: string
): Promise<GatewayNetworkAnalyticsSummary | null> {
  const [totalsResult, byActionResult] = await Promise.all([
    analyticsPost<{ currentTotal?: Array<{ bandwidthConsumedBytes: number; requestsTotal: number }> }>(
      token, accountId, "analytics/query/gateway-network/summary", { from: since, to: until, groupBy: [], stats: [], filters: [] }
    ),
    analyticsPost<{ currentTotal?: Array<{ action: string; requestsTotal: number }> }>(
      token, accountId, "analytics/query/gateway-network/summary", { from: since, to: until, groupBy: ["action"], stats: ["requestsTotal"] }
    ),
  ]);
  const totals = totalsResult?.currentTotal?.[0];
  if (!totals) return null;
  const blocked = (byActionResult?.currentTotal ?? [])
    .filter((r) => r.action === "blockByRule")
    .reduce((s, r) => s + r.requestsTotal, 0);
  return {
    requestsTotal: totals.requestsTotal,
    requestsBlocked: blocked,
    bandwidthConsumedBytes: totals.bandwidthConsumedBytes ?? 0,
  };
}

// =============================================================================
// GATEWAY NETWORK SESSION LOG (NSL) — /analytics/query/gateway_nsl/*
// Real bandwidth split by egress path (WARP / Cloudflare Tunnel / Internet) —
// a trust/adoption signal no other dataset in this codebase provides.
// =============================================================================

export async function fetchGatewayNslTotalBytes(
  token: string, accountId: string, since: string, until: string
): Promise<number | null> {
  const result = await analyticsPost<{ currentTotal?: Array<{ bytesTotal: number }> }>(
    token, accountId, "analytics/query/gateway_nsl/summary", { from: since, to: until, groupBy: [], stats: ["bytesTotal"], filters: [] }
  );
  return result?.currentTotal?.[0]?.bytesTotal ?? null;
}

export async function fetchGatewayNslByOfframp(
  token: string, accountId: string, since: string, until: string
): Promise<{ offramp: string; bytesTotal: number }[]> {
  // NOTE: /analytics/query/{dataset}/timeseries always wraps its rows in
  // `{ slots: [...] }` — unlike /summary (`{ currentTotal, previousTotal }`)
  // and /top-n (a bare array). Confirmed live; a bare-array assumption here
  // silently threw "result is not iterable" and dropped this widget.
  const result = await analyticsPost<{ slots?: Array<{ offramp: string; bytesTotal: number; timestamp: string }> }>(
    token, accountId, "analytics/query/gateway_nsl/timeseries",
    { from: since, to: until, stats: ["bytesTotal"], groupBy: ["offramp"] }
  );
  if (!result?.slots) return [];
  const byOfframp = new Map<string, number>();
  for (const r of result.slots) byOfframp.set(r.offramp, (byOfframp.get(r.offramp) ?? 0) + r.bytesTotal);
  return Array.from(byOfframp.entries())
    .map(([offramp, bytesTotal]) => ({ offramp, bytesTotal }))
    .sort((a, b) => b.bytesTotal - a.bytesTotal);
}

export async function fetchGatewayNslTopUsers(
  token: string, accountId: string, since: string, until: string, n = 10
): Promise<{ email: string; bytesTotal: number }[]> {
  const result = await analyticsPost<Array<{ email: string; bytesTotal: number }>>(
    token, accountId, "analytics/query/gateway_nsl/top-n",
    { from: since, to: until, stats: ["bytesTotal"], groupBy: ["email"], orderBy: "bytesTotal", n }
  );
  return result ?? [];
}

// =============================================================================
// DLP MATCH DATA — GET /analytics/gateway/proxy/http?groupBy=...
// Real per-period DLP match counts. Previously this codebase claimed "no
// per-period match counts are exposed by GraphQL" — true for GraphQL, but
// this REST analytics endpoint exposes exactly that, confirmed live
// (47.25M hits / 18.7M scans, 16 named profiles with real hit counts) on a
// real production account with active DLP policies.
// =============================================================================

export interface DlpActivitySummary {
  dlpHitCount: number;
  dlpScanCount: number;
  prevDlpHitCount: number;
  prevDlpScanCount: number;
}

export async function fetchDlpActivitySummary(token: string, accountId: string, since: string): Promise<DlpActivitySummary | null> {
  const result = await analyticsGet<Array<DlpActivitySummary>>(
    token, accountId, `analytics/gateway/proxy/http?from=${encodeURIComponent(since)}&groupBy=dlpActivity&includeTrend=true`
  );
  return result?.[0] ?? null;
}

export async function fetchDlpProfileMatches(
  token: string, accountId: string, since: string
): Promise<{ profileName: string; hitCount: number }[]> {
  const result = await analyticsGet<Array<{ matchedDlpProfilesName: string; dlpHitCount: number }>>(
    token, accountId, `analytics/gateway/proxy/http?from=${encodeURIComponent(since)}&groupBy=dlpProfiles`
  );
  return (result ?? [])
    .map((r) => ({ profileName: r.matchedDlpProfilesName, hitCount: r.dlpHitCount }))
    .sort((a, b) => b.hitCount - a.hitCount);
}

export async function fetchDlpTopWebsites(
  token: string, accountId: string, since: string
): Promise<{ host: string; hitCount: number }[]> {
  const result = await analyticsGet<Array<{ httpHost: string; dlpHitCount: number }>>(
    token, accountId, `analytics/gateway/proxy/http?from=${encodeURIComponent(since)}&groupBy=dlpWebsite`
  );
  return (result ?? []).map((r) => ({ host: r.httpHost, hitCount: r.dlpHitCount })).sort((a, b) => b.hitCount - a.hitCount);
}

// =============================================================================
// CASB / CDS SCAN RESULTS
// =============================================================================

/** Real-time CASB DLP finding count (distinct from REST
 *  /data-security/posture/findings used elsewhere for config-drift-style
 *  findings — this is the dashboard's own "CASB findings" trend number). */
export async function fetchCasbDlpFindingsCount(
  token: string, accountId: string, since: string
): Promise<{ currentTotal: number; previousTotal: number } | null> {
  return analyticsGet<{ currentTotal: number; previousTotal: number }>(
    token, accountId, `analytics/casb/findings/dlp?from=${encodeURIComponent(since)}`
  );
}

/** Cloud Data Security (CDS) scan match totals — at-rest SaaS DLP scanning,
 *  distinct from inline HTTP DLP (dlpActivity above). 0 on accounts without
 *  CDS/at-rest scanning configured — a real "not configured" 0, not a stub. */
export async function fetchCdsScanResultsSummary(
  token: string, accountId: string, since: string, until: string
): Promise<{ matchesTotal: number } | null> {
  const result = await analyticsPost<{ currentTotal?: Array<{ matchesTotal: number }> }>(
    token, accountId, "analytics/query/cds-scan-results/summary", { from: since, to: until }
  );
  return result?.currentTotal?.[0] ?? null;
}
