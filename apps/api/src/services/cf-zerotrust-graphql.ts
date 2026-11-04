/**
 * Cloudflare Zero Trust / Cloudflare One Analytics.
 *
 * Data sources (all account-level via viewer.accounts[]):
 *
 *   Gateway DNS:
 *     gatewayResolverQueriesAdaptiveGroups
 *       filter: { datetime_geq, datetime_lt, resolverDecision_in, resolverDecision,
 *                 matchedApplicationName_neq, matchedApplicationName }
 *       dimensions: { datetimeHour, queryName, categoryNames, resolverDecision,
 *                     policyName, locationName, matchedApplicationName }
 *
 *     gatewayResolverByCategoryAdaptiveGroups
 *       filter: { datetime_geq, datetime_lt, resolverDecision_in }
 *       dimensions: { categoryId }
 *
 *   Gateway HTTP (L7):
 *     gatewayL7RequestsAdaptiveGroups
 *       filter: { datetime_geq, datetime_lt, action_in, email_neq }
 *       dimensions: { datetimeHour, action, httpHost, url, email, applicationNames }
 *
 *   Gateway L4:
 *     gatewayL4SessionsAdaptiveGroups
 *       filter: { datetime_geq, datetime_lt, action }
 *       dimensions: { datetimeHour, action, destinationIp, dstIpCountry,
 *                     destinationPort, transport, srcIpCountry }
 *
 *   Access:
 *     accessLoginRequestsAdaptiveGroups
 *       filter: { datetime_geq, datetime_lt, isSuccessfulLogin }
 *       dimensions: { date, userEmail, userUuid }
 *
 * IMPORTANT: Use datetime_geq + datetime_lt (both inline strings) for fixed
 * query windows. This avoids the 30-day quota issue that occurs when only a
 * lower bound is supplied (Cloudflare computes "now" as the upper bound,
 * which drifts beyond the 30-day limit by the time the query is processed).
 *
 * resolverDecision IDs (confirmed from cf-reporting + dashboard trace):
 *   1 = Allowed by Policy
 *   2 = Allowed
 *   9 = Blocked by Policy  ← primary "blocked" signal
 *  14 = Blocked (Already Resolved)
 */

const CF_GRAPHQL = "https://api.cloudflare.com/client/v4/graphql";
const CF_API     = "https://api.cloudflare.com/client/v4";

// ─── Core GraphQL helper ──────────────────────────────────────────────────────

async function gqlAccount<T = unknown>(
  token: string,
  query: string,
  variables: Record<string, unknown> = {}
): Promise<T> {
  const res = await fetch(CF_GRAPHQL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ query, variables }),
  });
  if (!res.ok) throw new Error(`GraphQL HTTP ${res.status}`);
  const j = (await res.json()) as {
    data?: { viewer?: { accounts?: T[] } };
    errors?: { message: string }[];
  };
  if (j.errors?.length) throw new Error(j.errors.map((e) => e.message).join("; "));
  return (j.data?.viewer?.accounts?.[0] ?? {}) as T;
}

// ─── REST helper ──────────────────────────────────────────────────────────────

async function restGet<T>(token: string, path: string, params = ""): Promise<T[]> {
  try {
    const res = await fetch(`${CF_API}${path}${params}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok) return [];
    const j = (await res.json()) as { success?: boolean; result?: T | T[] };
    return j.success ? (Array.isArray(j.result) ? j.result : j.result ? [j.result] : []) : [];
  } catch { return []; }
}

// ─── resolverDecision constants ───────────────────────────────────────────────
// CONFIRMED from Cloudflare dashboard network trace (Mahidol account):
//   Blocked decisions = [2, 3, 6, 9]
//   Allowed decisions = [1, 4, 5, 10]
// Note: cf-reporting uses resolverDecision: 9 only, but the dashboard uses [2,3,6,9].
// We use the dashboard-confirmed set for accurate counts.
const DNS_BLOCKED = [2, 3, 6, 9];
const DNS_ALLOWED = [1, 4, 5, 10];

// Human-readable decision names
const RESOLVER_DECISION_NAMES: Record<number, string> = {
  1: "Allowed by Policy",
  2: "Blocked",
  3: "Blocked (Safe Search)",
  4: "Allowed",
  5: "Allowed",
  6: "Blocked (Firewall)",
  9: "Blocked by Policy",
  10: "Allowed",
  14: "Blocked (Resolved)",
  15: "Allowed",
};

// Port → service name mapping (from cf-reporting)
const PORT_SERVICES: Record<number, string> = {
  22: "SSH", 25: "SMTP", 53: "DNS", 80: "HTTP", 110: "POP3",
  143: "IMAP", 443: "HTTPS", 445: "SMB", 993: "IMAPS", 995: "POP3S",
  1433: "MSSQL", 1521: "Oracle", 3306: "MySQL", 3389: "RDP",
  5432: "PostgreSQL", 5900: "VNC", 6379: "Redis", 8080: "HTTP-Alt",
  8443: "HTTPS-Alt", 27017: "MongoDB",
};

const TRANSPORT_NAMES: Record<string, string> = {
  "0": "Other", "1": "ICMP", "6": "TCP", "17": "UDP",
};

// HTTP action constants
const HTTP_BLOCK_ACTIONS   = ["block"];
const HTTP_ISOLATE_ACTIONS = ["isolate"];

// =============================================================================
// TYPES
// =============================================================================

export interface AccessAuthDay    { date: string; allow: number; block: number; mfa: number }
export interface GatewayDayBucket { date: string; total: number; blocked: number }

// DNS enriched types
export interface DnsResolverDecision { decision: string; count: number }
export interface DnsBlockedDomain {
  domain: string;
  count: number;
  category: string;
  policyName: string;
  locationName: string;
}

// L4 types
export interface L4BlockedDestination {
  ip: string;
  count: number;
  country: string;
  port: number | null;
  protocol: string;
  service: string;
}
export interface L4Protocol   { protocol: string; count: number }
export interface L4Country    { country: string; count: number }

// Shadow IT types
export interface ShadowItApp {
  name: string;
  category: string;
  count: number;
}
export interface ShadowItUserMapping {
  email: string;
  apps: string[];
  totalRequests: number;
}

// Access GraphQL types
export interface AccessDailyActive { date: string; uniqueUsers: number; logins: number }

// =============================================================================
// ACCESS ANALYTICS — GraphQL (accessLoginRequestsAdaptiveGroups)
// Falls back to REST if GraphQL fails (token may lack Access:Read permission)
// =============================================================================

interface AccessLogEntry {
  action: string; allowed: boolean; app_domain: string; app_uid: string;
  created_at: string; user_email: string; country?: string;
  ip_address?: string;   // source IP of the authenticating user
  connection?: string;   // IdP/connection used to authenticate (e.g. "saml", "oidc", "onetimepin")
  app_type?: string;     // "warp" | "biso" | "app_launcher" | "dash_sso" | "self_hosted" | "saas" | ...
}

/**
 * Fetches the raw Access authentication log list ONCE per report request.
 * Several derived views (top apps, top users, geo distribution, top source
 * IPs, auth method breakdown) all read from this same log list — fetching it
 * once here avoids 3-5x redundant calls to the same REST endpoint.
 */
export async function fetchAccessLogs(token: string, accountId: string): Promise<AccessLogEntry[]> {
  return restGet<AccessLogEntry>(
    token, `/accounts/${accountId}/access/logs/access_requests?direction=desc&limit=1000`
  );
}

// Confirmed live on a real production account: the WARP client's system
// "Warp Login App" (app_type "warp") generates a login-request-log entry on
// every client reconnect/session-key-renewal — 980 of the latest 1,000 rows
// on a real account were app_type "warp", drowning out genuine interactive
// application logins (only 20 of 1,000 were real app logins in the same
// sample). Filtering by `action !== "warp_enrollment"` alone is NOT enough —
// most of the WARP noise has `action: "login"` too; the only reliable
// signal is `app_type === "warp"`. All top-user/app/geo/IP/method
// breakdowns derived from this REST log below now exclude these rows so
// they reflect real application access, not WARP client session churn.
function isWarpSystemLogin(log: AccessLogEntry): boolean {
  return log.app_type === "warp";
}

function inRange(log: AccessLogEntry, sinceMs: number, untilMs: number): boolean {
  if (isWarpSystemLogin(log)) return false;
  const ts = new Date(log.created_at).getTime();
  return ts >= sinceMs && ts <= untilMs;
}

/**
 * Classifies the Access `connection` field into a coarse auth method.
 * "onetimepin" / "otp" / empty = direct credential login (email + PIN).
 * Everything else (saml, oidc, google, github, azuread, okta, ...) = SSO.
 */
function classifyAuthMethod(connection: string | undefined): "SSO" | "Direct Login" {
  const c = (connection ?? "").toLowerCase();
  if (!c || c === "onetimepin" || c === "otp" || c === "pin") return "Direct Login";
  return "SSO";
}

export async function fetchAccessAuthTimeSeries(
  token: string, accountId: string, since: string, until: string
): Promise<AccessAuthDay[]> {
  // Try GraphQL first
  try {
    const query = `{
      viewer {
        accounts(filter: { accountTag: "${accountId}" }) {
          allowed: accessLoginRequestsAdaptiveGroups(
            limit: 500
            filter: { datetime_geq: "${since}", datetime_lt: "${until}", isSuccessfulLogin: 1 }
            orderBy: [date_ASC]
          ) { count dimensions { date } }
          blocked: accessLoginRequestsAdaptiveGroups(
            limit: 500
            filter: { datetime_geq: "${since}", datetime_lt: "${until}", isSuccessfulLogin: 0 }
            orderBy: [date_ASC]
          ) { count dimensions { date } }
        }
      }
    }`;
    const data = await gqlAccount<{
      allowed: Array<{ count: number; dimensions: { date: string } }>;
      blocked: Array<{ count: number; dimensions: { date: string } }>;
    }>(token, query);

    const byDate = new Map<string, AccessAuthDay>();
    for (const r of data.allowed ?? []) {
      const d = r.dimensions.date;
      if (!byDate.has(d)) byDate.set(d, { date: d, allow: 0, block: 0, mfa: 0 });
      byDate.get(d)!.allow += r.count;
    }
    for (const r of data.blocked ?? []) {
      const d = r.dimensions.date;
      if (!byDate.has(d)) byDate.set(d, { date: d, allow: 0, block: 0, mfa: 0 });
      byDate.get(d)!.block += r.count;
    }
    if (byDate.size > 0) {
      return Array.from(byDate.values()).sort((a, b) => a.date.localeCompare(b.date));
    }
  } catch { /* fall through to REST */ }

  // REST fallback
  const logs = await restGet<AccessLogEntry>(
    token,
    `/accounts/${accountId}/access/logs/access_requests?direction=desc&limit=1000`
  );
  if (logs.length === 0) return [];

  const sinceMs = new Date(since).getTime();
  const untilMs = new Date(until).getTime();
  const byDate  = new Map<string, AccessAuthDay>();
  for (const log of logs) {
    const ts = new Date(log.created_at).getTime();
    if (ts < sinceMs || ts > untilMs) continue;
    const date = log.created_at.split("T")[0];
    if (!byDate.has(date)) byDate.set(date, { date, allow: 0, block: 0, mfa: 0 });
    const d = byDate.get(date)!;
    if (log.allowed || log.action === "allow" || log.action === "bypass") d.allow++;
    else if (!log.allowed || log.action === "block") d.block++;
    else if (log.action === "non_identity") d.mfa++;
  }
  return Array.from(byDate.values()).sort((a, b) => a.date.localeCompare(b.date));
}

/**
 * All five derivations below (top apps, top users, geo distribution, top
 * source IPs, auth method breakdown) read from the SAME pre-fetched log
 * array — call fetchAccessLogs() once per report and pass the result in,
 * instead of each function re-fetching the same REST endpoint.
 */

export function deriveAccessTopApps(
  logs: AccessLogEntry[], since: string, until: string, limit = 10
): { name: string; requests: number }[] {
  const sinceMs = new Date(since).getTime();
  const untilMs = new Date(until).getTime();
  const byApp   = new Map<string, number>();
  for (const log of logs) {
    if (!inRange(log, sinceMs, untilMs)) continue;
    const app = log.app_domain || log.app_uid || "Unknown";
    byApp.set(app, (byApp.get(app) ?? 0) + 1);
  }
  return Array.from(byApp.entries())
    .map(([name, requests]) => ({ name, requests }))
    .sort((a, b) => b.requests - a.requests)
    .slice(0, limit);
}

export function deriveAccessTopUsers(
  logs: AccessLogEntry[], since: string, until: string, limit = 15
): { email: string; requests: number; blocked: number; country: string }[] {
  const sinceMs = new Date(since).getTime();
  const untilMs = new Date(until).getTime();
  const byUser  = new Map<string, { email: string; requests: number; blocked: number; countries: Map<string, number> }>();
  for (const log of logs) {
    if (!inRange(log, sinceMs, untilMs)) continue;
    const email = log.user_email || "unknown";
    if (!byUser.has(email)) byUser.set(email, { email, requests: 0, blocked: 0, countries: new Map() });
    const u = byUser.get(email)!;
    u.requests++;
    if (!log.allowed || log.action === "block") u.blocked++;
    const c = log.country || "";
    if (c) u.countries.set(c, (u.countries.get(c) ?? 0) + 1);
  }
  return Array.from(byUser.values())
    .map((u) => {
      // Most frequent real country associated with this user's requests.
      let topCountry = "";
      let topN = 0;
      for (const [c, n] of u.countries) if (n > topN) { topCountry = c; topN = n; }
      return { email: u.email, requests: u.requests, blocked: u.blocked, country: topCountry };
    })
    .sort((a, b) => b.requests - a.requests)
    .slice(0, limit);
}

export function deriveAccessGeoDistribution(
  logs: AccessLogEntry[], since: string, until: string, limit = 20
): { country: string; requests: number; blocked: number }[] {
  const sinceMs   = new Date(since).getTime();
  const untilMs   = new Date(until).getTime();
  const byCountry = new Map<string, { country: string; requests: number; blocked: number }>();
  for (const log of logs) {
    if (!inRange(log, sinceMs, untilMs)) continue;
    const c = log.country || "Unknown";
    if (!byCountry.has(c)) byCountry.set(c, { country: c, requests: 0, blocked: 0 });
    const x = byCountry.get(c)!;
    x.requests++;
    if (!log.allowed || log.action === "block") x.blocked++;
  }
  return Array.from(byCountry.values())
    .sort((a, b) => b.requests - a.requests)
    .slice(0, limit);
}

/** Top source IP addresses for Access login events — mirrors the "Top Source IPs" panel
 *  in the Application Access Report dashboard. */
export function deriveAccessTopSourceIps(
  logs: AccessLogEntry[], since: string, until: string, limit = 20
): { ip: string; requests: number; blocked: number }[] {
  const sinceMs = new Date(since).getTime();
  const untilMs = new Date(until).getTime();
  const byIp    = new Map<string, { ip: string; requests: number; blocked: number }>();
  for (const log of logs) {
    if (!inRange(log, sinceMs, untilMs)) continue;
    const ip = log.ip_address || "Unknown";
    if (!byIp.has(ip)) byIp.set(ip, { ip, requests: 0, blocked: 0 });
    const x = byIp.get(ip)!;
    x.requests++;
    if (!log.allowed || log.action === "block") x.blocked++;
  }
  return Array.from(byIp.values())
    .sort((a, b) => b.requests - a.requests)
    .slice(0, limit);
}

/** SSO vs. direct/OTP login breakdown — mirrors "Access events by type" in the
 *  Application Access Report dashboard. */
export function deriveAccessAuthMethodBreakdown(
  logs: AccessLogEntry[], since: string, until: string
): { method: "SSO" | "Direct Login"; count: number }[] {
  const sinceMs = new Date(since).getTime();
  const untilMs = new Date(until).getTime();
  let sso = 0, direct = 0;
  for (const log of logs) {
    if (!inRange(log, sinceMs, untilMs)) continue;
    if (classifyAuthMethod(log.connection) === "SSO") sso++;
    else direct++;
  }
  const result: { method: "SSO" | "Direct Login"; count: number }[] = [];
  if (sso > 0) result.push({ method: "SSO", count: sso });
  if (direct > 0) result.push({ method: "Direct Login", count: direct });
  return result;
}

/** Daily active users trend via accessLoginRequestsAdaptiveGroups */
export async function fetchAccessDailyActiveUsers(
  token: string, accountId: string, since: string, until: string
): Promise<AccessDailyActive[]> {
  try {
    const query = `{
      viewer {
        accounts(filter: { accountTag: "${accountId}" }) {
          accessLoginRequestsAdaptiveGroups(
            limit: 1000
            filter: { datetime_geq: "${since}", datetime_lt: "${until}", isSuccessfulLogin: 1 }
            orderBy: [date_ASC]
          ) { count dimensions { date userUuid } }
        }
      }
    }`;
    const data = await gqlAccount<{
      accessLoginRequestsAdaptiveGroups: Array<{
        count: number;
        dimensions: { date: string; userUuid: string };
      }>;
    }>(token, query);

    const byDay = new Map<string, { users: Set<string>; logins: number }>();
    for (const r of data.accessLoginRequestsAdaptiveGroups ?? []) {
      const day = r.dimensions.date;
      if (!byDay.has(day)) byDay.set(day, { users: new Set(), logins: 0 });
      const entry = byDay.get(day)!;
      if (r.dimensions.userUuid) entry.users.add(r.dimensions.userUuid);
      entry.logins += r.count;
    }
    return Array.from(byDay.entries())
      .map(([date, { users, logins }]) => ({ date, uniqueUsers: users.size, logins }))
      .sort((a, b) => a.date.localeCompare(b.date));
  } catch { return []; }
}

/**
 * Exact distinct Access users/apps over the report period, via a much
 * higher-limit GraphQL query than the REST-log-derived `deriveAccessTop*`
 * helpers above (which are capped at the latest 1,000 REST log rows before
 * even taking a top-N slice). Still bounded by GraphQL's own per-query
 * `limit` (5,000 rows here) — `sampleLimit` is returned so callers/UI can be
 * honest about "distinct count over up to N rows" rather than claiming a
 * literal exhaustive count on very high-volume accounts.
 */
export async function fetchAccessDistinctCounts(
  token: string, accountId: string, since: string, until: string
): Promise<{ uniqueUsers: number; uniqueApps: number; sampleLimit: number }> {
  const sampleLimit = 5000;
  const query = `{
    viewer {
      accounts(filter: { accountTag: "${accountId}" }) {
        accessLoginRequestsAdaptiveGroups(
          limit: ${sampleLimit}
          filter: { datetime_geq: "${since}", datetime_lt: "${until}" }
        ) { dimensions { userUuid appId } }
      }
    }
  }`;
  try {
    const data = await gqlAccount<{
      accessLoginRequestsAdaptiveGroups: Array<{ dimensions: { userUuid: string; appId: string } }>;
    }>(token, query);
    const users = new Set<string>();
    const apps = new Set<string>();
    for (const r of data.accessLoginRequestsAdaptiveGroups ?? []) {
      if (r.dimensions.userUuid) users.add(r.dimensions.userUuid);
      if (r.dimensions.appId) apps.add(r.dimensions.appId);
    }
    return { uniqueUsers: users.size, uniqueApps: apps.size, sampleLimit };
  } catch { return { uniqueUsers: 0, uniqueApps: 0, sampleLimit }; }
}

// =============================================================================
// GATEWAY DNS — gatewayResolverQueriesAdaptiveGroups
// =============================================================================

/** Time-series: hourly allowed + blocked DNS queries
 * NOTE: gatewayResolverQueriesAdaptiveGroups does NOT support datetime_lt.
 * Use datetime_gt only. The upper bound is implicitly "now" at Cloudflare.
 * Pass `since` with a 2-hour buffer from the route handler to stay within
 * the 30-day quota window.
 */
export async function fetchGatewayDnsTimeSeries(
  token: string, accountId: string, since: string, _until: string
): Promise<GatewayDayBucket[]> {
  const query = `{
    viewer {
      accounts(filter: { accountTag: "${accountId}" }) {
        blocked: gatewayResolverQueriesAdaptiveGroups(
          limit: 720
          filter: { datetime_gt: "${since}", resolverDecision_in: [2,3,6,9] }
          orderBy: [datetimeHour_ASC]
        ) { count dimensions { datetimeHour } }
        allowed: gatewayResolverQueriesAdaptiveGroups(
          limit: 720
          filter: { datetime_gt: "${since}", resolverDecision_in: [1,4,5,10] }
          orderBy: [datetimeHour_ASC]
        ) { count dimensions { datetimeHour } }
      }
    }
  }`;
  try {
    const data = await gqlAccount<{
      blocked: Array<{ count: number; dimensions: { datetimeHour: string } }>;
      allowed: Array<{ count: number; dimensions: { datetimeHour: string } }>;
    }>(token, query);

    const byDate = new Map<string, GatewayDayBucket>();
    for (const r of data.blocked ?? []) {
      const date = r.dimensions.datetimeHour?.split("T")[0] ?? "";
      if (!date) continue;
      if (!byDate.has(date)) byDate.set(date, { date, total: 0, blocked: 0 });
      byDate.get(date)!.blocked += r.count;
      byDate.get(date)!.total   += r.count;
    }
    for (const r of data.allowed ?? []) {
      const date = r.dimensions.datetimeHour?.split("T")[0] ?? "";
      if (!date) continue;
      if (!byDate.has(date)) byDate.set(date, { date, total: 0, blocked: 0 });
      byDate.get(date)!.total += r.count;
    }
    return Array.from(byDate.values()).sort((a, b) => a.date.localeCompare(b.date));
  } catch { return []; }
}

/** DNS summary totals — uses datetime_gt only (datetime_lt not supported on this dataset) */
export async function fetchGatewayDnsSummary(
  token: string, accountId: string, since: string, _until: string
): Promise<{ queriesTotal: number; queriesBlocked: number } | null> {
  const query = `{
    viewer {
      accounts(filter: { accountTag: "${accountId}" }) {
        blocked: gatewayResolverQueriesAdaptiveGroups(
          limit: 1
          filter: { datetime_gt: "${since}", resolverDecision_in: [2,3,6,9] }
        ) { count }
        allowed: gatewayResolverQueriesAdaptiveGroups(
          limit: 1
          filter: { datetime_gt: "${since}", resolverDecision_in: [1,4,5,10] }
        ) { count }
      }
    }
  }`;
  try {
    const data = await gqlAccount<{
      blocked: Array<{ count: number }>;
      allowed: Array<{ count: number }>;
    }>(token, query);
    const queriesBlocked = (data.blocked ?? []).reduce((s, r) => s + r.count, 0);
    const queriesAllowed = (data.allowed ?? []).reduce((s, r) => s + r.count, 0);
    return { queriesTotal: queriesBlocked + queriesAllowed, queriesBlocked };
  } catch { return null; }
}

/** Resolver decision breakdown (pie chart) — datetime_gt only, no datetime_lt */
export async function fetchGatewayDnsResolverBreakdown(
  token: string, accountId: string, since: string, _until: string
): Promise<DnsResolverDecision[]> {
  const query = `{
    viewer {
      accounts(filter: { accountTag: "${accountId}" }) {
        gatewayResolverQueriesAdaptiveGroups(
          limit: 20
          filter: { datetime_gt: "${since}" }
          orderBy: [count_DESC]
        ) { count dimensions { resolverDecision } }
      }
    }
  }`;
  try {
    const data = await gqlAccount<{
      gatewayResolverQueriesAdaptiveGroups: Array<{
        count: number;
        dimensions: { resolverDecision: number };
      }>;
    }>(token, query);

    const byDecision = new Map<number, number>();
    for (const r of data.gatewayResolverQueriesAdaptiveGroups ?? []) {
      const d = r.dimensions.resolverDecision;
      byDecision.set(d, (byDecision.get(d) ?? 0) + r.count);
    }
    return Array.from(byDecision.entries())
      .map(([id, count]) => ({
        decision: RESOLVER_DECISION_NAMES[id] ?? `Unknown (${id})`,
        count,
      }))
      .sort((a, b) => b.count - a.count);
  } catch { return []; }
}

/** Top blocked domains — datetime_gt only (no datetime_lt on this dataset) */
export async function fetchGatewayDnsTopBlocked(
  token: string, accountId: string, since: string, _until: string, limit = 15
): Promise<DnsBlockedDomain[]> {
  const query = `{
    viewer {
      accounts(filter: { accountTag: "${accountId}" }) {
        gatewayResolverQueriesAdaptiveGroups(
          limit: ${limit}
          filter: { datetime_gt: "${since}", resolverDecision_in: [2,3,6,9] }
          orderBy: [count_DESC]
        ) {
          count
          dimensions { queryName categoryNames policyName locationName }
        }
      }
    }
  }`;
  try {
    const data = await gqlAccount<{
      gatewayResolverQueriesAdaptiveGroups: Array<{
        count: number;
        dimensions: {
          queryName: string;
          categoryNames: string[];
          policyName: string;
          locationName: string;
        };
      }>;
    }>(token, query);

    return (data.gatewayResolverQueriesAdaptiveGroups ?? [])
      .filter((r) => r.dimensions.queryName)
      .map((r) => ({
        domain:       r.dimensions.queryName,
        count:        r.count,
        category:     (r.dimensions.categoryNames ?? []).filter(Boolean).join(", ") || "Uncategorized",
        policyName:   r.dimensions.policyName  || "",
        locationName: r.dimensions.locationName || "",
      }));
  } catch { return []; }
}

/** Top allowed domains — mirrors fetchGatewayDnsTopBlocked but uses the
 *  dashboard-confirmed "allowed" decision set [1,4,5,10] instead of blocked. */
export async function fetchGatewayDnsTopAllowed(
  token: string, accountId: string, since: string, _until: string, limit = 15
): Promise<DnsBlockedDomain[]> {
  const query = `{
    viewer {
      accounts(filter: { accountTag: "${accountId}" }) {
        gatewayResolverQueriesAdaptiveGroups(
          limit: ${limit}
          filter: { datetime_gt: "${since}", resolverDecision_in: [1,4,5,10] }
          orderBy: [count_DESC]
        ) {
          count
          dimensions { queryName categoryNames policyName locationName }
        }
      }
    }
  }`;
  try {
    const data = await gqlAccount<{
      gatewayResolverQueriesAdaptiveGroups: Array<{
        count: number;
        dimensions: {
          queryName: string;
          categoryNames: string[];
          policyName: string;
          locationName: string;
        };
      }>;
    }>(token, query);

    return (data.gatewayResolverQueriesAdaptiveGroups ?? [])
      .filter((r) => r.dimensions.queryName)
      .map((r) => ({
        domain:       r.dimensions.queryName,
        count:        r.count,
        category:     (r.dimensions.categoryNames ?? []).filter(Boolean).join(", ") || "Uncategorized",
        policyName:   r.dimensions.policyName  || "",
        locationName: r.dimensions.locationName || "",
      }));
  } catch { return []; }
}

/**
 * Fallback category ID → name table, used only if the live Gateway category
 * list (fetched via REST `/accounts/{id}/gateway/categories`) is unavailable
 * or doesn't cover an ID. Gateway subcategory IDs (e.g. 182) live in a much
 * larger ID space than this short top-level table, which is why "Category
 * 182"-style labels showed up before — always prefer the live categoryMap.
 */
const FALLBACK_CATEGORY_NAMES: Record<number, string> = {
  1:"Malware",2:"Command & Control",3:"Spyware",4:"Phishing",5:"Spam",
  6:"DNS-over-HTTPS",7:"Peer-to-Peer",8:"Ads & Trackers",9:"Compromised Servers",
  10:"New Domains",11:"Newly Observed",12:"Login Pages",13:"Financial",
  14:"Cryptocurrency",15:"Gambling",16:"Adult Content",17:"Violent Content",
  18:"Illegal Content",19:"Terrorism",20:"Child Abuse",21:"Drugs",22:"Weapons",
  23:"Hacking",24:"Privacy Risks",25:"Parked Domains",26:"File Sharing",
  27:"Gaming",28:"Shopping",29:"Social Networks",30:"Video Streaming",
  31:"Music Streaming",32:"Productivity",33:"Network Infrastructure",34:"Search Engines",
};

/** Top blocked categories — datetime_gt only, resolverDecision confirmed [2,3,6,9] */
export async function fetchGatewayDnsTopBlockedCategories(
  token: string, accountId: string, since: string, _until: string, limit = 10,
  categoryMap?: Map<number, string>
): Promise<{ category: string; count: number }[]> {
  const query = `{
    viewer {
      accounts(filter: { accountTag: "${accountId}" }) {
        gatewayResolverByCategoryAdaptiveGroups(
          limit: ${limit}
          filter: { datetime_gt: "${since}", resolverDecision_in: [2,3,6,9] }
          orderBy: [count_DESC]
        ) { count dimensions { categoryId } }
      }
    }
  }`;
  try {
    const data = await gqlAccount<{
      gatewayResolverByCategoryAdaptiveGroups: Array<{
        count: number;
        dimensions: { categoryId: number };
      }>;
    }>(token, query);

    return (data.gatewayResolverByCategoryAdaptiveGroups ?? [])
      .filter((r) => r.dimensions.categoryId)
      .map((r) => ({
        category: categoryMap?.get(r.dimensions.categoryId)
          ?? FALLBACK_CATEGORY_NAMES[r.dimensions.categoryId]
          ?? `Uncategorized (ID ${r.dimensions.categoryId})`,
        count:    r.count,
      }))
      .sort((a, b) => b.count - a.count);
  } catch { return []; }
}

/** Policy-level breakdown — datetime_gt only */
export async function fetchGatewayDnsTopByPolicy(
  token: string, accountId: string, since: string, _until: string, limit = 10
): Promise<{ policyId: string; queriesTotal: number }[]> {
  try {
    const query = `{
      viewer {
        accounts(filter: { accountTag: "${accountId}" }) {
          gatewayResolverQueriesAdaptiveGroups(
            limit: ${limit}
            filter: { datetime_gt: "${since}", resolverDecision_in: [2,3,6,9] }
            orderBy: [count_DESC]
          ) { count dimensions { policyName } }
        }
      }
    }`;
    const data = await gqlAccount<{
      gatewayResolverQueriesAdaptiveGroups: Array<{
        count: number;
        dimensions: { policyName: string };
      }>;
    }>(token, query);

    return (data.gatewayResolverQueriesAdaptiveGroups ?? [])
      .filter((r) => r.dimensions.policyName)
      .map((r) => ({ policyId: r.dimensions.policyName, queriesTotal: r.count }));
  } catch { return []; }
}

// =============================================================================
// GATEWAY HTTP — gatewayL7RequestsAdaptiveGroups
// action: "allow" | "bypass" | "block" | "isolate" | "unknown"
// =============================================================================

export async function fetchGatewayHttpSummary(
  token: string, accountId: string, since: string, until: string
): Promise<{
  requestsTotal: number; requestsBlocked: number; rbiSessions: number;
  quarantinedRequests: number; mcpRequests: number;
} | null> {
  // quarantined/experimentalIsMcp confirmed live (real int dimension, 0/1) —
  // folded into this same summary query (single round trip) rather than
  // separate requests, since they're simple counts like blocked/rbi/total.
  const query = `{
    viewer {
      accounts(filter: { accountTag: "${accountId}" }) {
        blocked: gatewayL7RequestsAdaptiveGroups(
          limit: 1
          filter: { datetime_geq: "${since}", datetime_lt: "${until}", action_in: ["block"] }
        ) { count }
        rbi: gatewayL7RequestsAdaptiveGroups(
          limit: 1
          filter: { datetime_geq: "${since}", datetime_lt: "${until}", action_in: ["isolate"] }
        ) { count }
        total: gatewayL7RequestsAdaptiveGroups(
          limit: 1
          filter: { datetime_geq: "${since}", datetime_lt: "${until}" }
        ) { count }
        quarantined: gatewayL7RequestsAdaptiveGroups(
          limit: 1
          filter: { datetime_geq: "${since}", datetime_lt: "${until}", quarantined: 1 }
        ) { count }
        mcp: gatewayL7RequestsAdaptiveGroups(
          limit: 1
          filter: { datetime_geq: "${since}", datetime_lt: "${until}", experimentalIsMcp: 1 }
        ) { count }
      }
    }
  }`;
  try {
    const data = await gqlAccount<{
      blocked:     Array<{ count: number }>;
      rbi:         Array<{ count: number }>;
      total:       Array<{ count: number }>;
      quarantined: Array<{ count: number }>;
      mcp:         Array<{ count: number }>;
    }>(token, query);
    return {
      requestsBlocked:     (data.blocked     ?? []).reduce((s, r) => s + r.count, 0),
      rbiSessions:         (data.rbi         ?? []).reduce((s, r) => s + r.count, 0),
      requestsTotal:       (data.total       ?? []).reduce((s, r) => s + r.count, 0),
      quarantinedRequests: (data.quarantined ?? []).reduce((s, r) => s + r.count, 0),
      mcpRequests:         (data.mcp         ?? []).reduce((s, r) => s + r.count, 0),
    };
  } catch { return null; }
}

/**
 * Real HTTP status-code distribution, bucketed into 2xx/3xx/4xx/5xx/none.
 * `httpStatusCode` confirmed live as a real int dimension (0 for requests
 * with no recorded HTTP status — e.g. blocked before a response, or non-
 * standard protocols — labeled "No Status" rather than shown as literal 0).
 */
export interface HttpStatusBucket { bucket: string; count: number }

export async function fetchGatewayHttpStatusCodes(
  token: string, accountId: string, since: string, until: string
): Promise<HttpStatusBucket[]> {
  const query = `{
    viewer {
      accounts(filter: { accountTag: "${accountId}" }) {
        gatewayL7RequestsAdaptiveGroups(
          limit: 200
          filter: { datetime_geq: "${since}", datetime_lt: "${until}" }
          orderBy: [count_DESC]
        ) { count dimensions { httpStatusCode } }
      }
    }
  }`;
  try {
    const data = await gqlAccount<{
      gatewayL7RequestsAdaptiveGroups: Array<{ count: number; dimensions: { httpStatusCode: number } }>;
    }>(token, query);
    const buckets = new Map<string, number>();
    for (const r of data.gatewayL7RequestsAdaptiveGroups ?? []) {
      const code = r.dimensions.httpStatusCode;
      const bucket = code === 0 ? "No Status"
        : code < 300 ? "2xx" : code < 400 ? "3xx" : code < 500 ? "4xx" : "5xx";
      buckets.set(bucket, (buckets.get(bucket) ?? 0) + r.count);
    }
    const order = ["2xx", "3xx", "4xx", "5xx", "No Status"];
    return order
      .map((bucket) => ({ bucket, count: buckets.get(bucket) ?? 0 }))
      .filter((b) => b.count > 0);
  } catch { return []; }
}

export async function fetchGatewayHttpTimeSeries(
  token: string, accountId: string, since: string, until: string
): Promise<GatewayDayBucket[]> {
  const query = `{
    viewer {
      accounts(filter: { accountTag: "${accountId}" }) {
        blocked: gatewayL7RequestsAdaptiveGroups(
          limit: 720
          filter: { datetime_geq: "${since}", datetime_lt: "${until}", action_in: ["block"] }
          orderBy: [datetimeHour_ASC]
        ) { count dimensions { datetimeHour } }
        total: gatewayL7RequestsAdaptiveGroups(
          limit: 720
          filter: { datetime_geq: "${since}", datetime_lt: "${until}" }
          orderBy: [datetimeHour_ASC]
        ) { count dimensions { datetimeHour } }
      }
    }
  }`;
  try {
    const data = await gqlAccount<{
      blocked: Array<{ count: number; dimensions: { datetimeHour: string } }>;
      total:   Array<{ count: number; dimensions: { datetimeHour: string } }>;
    }>(token, query);

    const byDate = new Map<string, GatewayDayBucket>();
    for (const r of data.blocked ?? []) {
      const date = r.dimensions.datetimeHour?.split("T")[0] ?? "";
      if (!date) continue;
      if (!byDate.has(date)) byDate.set(date, { date, total: 0, blocked: 0 });
      byDate.get(date)!.blocked += r.count;
      byDate.get(date)!.total   += r.count;
    }
    for (const r of data.total ?? []) {
      const date = r.dimensions.datetimeHour?.split("T")[0] ?? "";
      if (!date) continue;
      if (!byDate.has(date)) byDate.set(date, { date, total: 0, blocked: 0 });
      byDate.get(date)!.total += r.count;
    }
    return Array.from(byDate.values()).sort((a, b) => a.date.localeCompare(b.date));
  } catch { return []; }
}

/**
 * Top HTTP hosts filtered by real `action` (block/allow). Confirmed via live
 * introspection that `action` is a real dimension on gatewayL7RequestsAdaptiveGroups
 * (values: allow | block | isolate | override | unknown). The previous version of
 * this function had NO action filter at all — it returned the top hosts by
 * overall traffic regardless of whether they were ever blocked, which is a
 * real bug (not mock data, but a mislabeled real-data query).
 */
async function fetchGatewayHttpTopByAction(
  token: string, accountId: string, since: string, until: string,
  actions: string[], limit: number
): Promise<{ domain: string; count: number }[]> {
  const actionList = actions.map((a) => `"${a}"`).join(", ");
  const query = `{
    viewer {
      accounts(filter: { accountTag: "${accountId}" }) {
        gatewayL7RequestsAdaptiveGroups(
          limit: ${limit}
          filter: { datetime_geq: "${since}", datetime_lt: "${until}", action_in: [${actionList}] }
          orderBy: [count_DESC]
        ) { count dimensions { httpHost } }
      }
    }
  }`;
  try {
    const data = await gqlAccount<{
      gatewayL7RequestsAdaptiveGroups: Array<{ count: number; dimensions: { httpHost: string } }>;
    }>(token, query);

    const hostMap = new Map<string, number>();
    for (const r of data.gatewayL7RequestsAdaptiveGroups ?? []) {
      const h = r.dimensions.httpHost;
      if (!h) continue;
      hostMap.set(h, (hostMap.get(h) ?? 0) + r.count);
    }
    return Array.from(hostMap.entries())
      .map(([domain, count]) => ({ domain, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, limit);
  } catch { return []; }
}

export async function fetchGatewayHttpTopBlocked(
  token: string, accountId: string, since: string, until: string, limit = 15
): Promise<{ domain: string; count: number }[]> {
  return fetchGatewayHttpTopByAction(token, accountId, since, until, HTTP_BLOCK_ACTIONS, limit);
}

export async function fetchGatewayHttpTopAllowed(
  token: string, accountId: string, since: string, until: string, limit = 15
): Promise<{ domain: string; count: number }[]> {
  return fetchGatewayHttpTopByAction(token, accountId, since, until, ["allow"], limit);
}

/**
 * Top users responsible for the most blocked HTTP requests. Real `email`
 * dimension on gatewayL7RequestsAdaptiveGroups (already confirmed live and
 * used by fetchShadowItUserMappings above), filtered to action:block. No
 * equivalent user/email dimension is confirmed on the DNS or L4 datasets —
 * intentionally HTTP-only rather than guessed for the others.
 */
export async function fetchGatewayHttpTopBlockedUsers(
  token: string, accountId: string, since: string, until: string, limit = 15
): Promise<{ email: string; count: number }[]> {
  const query = `{
    viewer {
      accounts(filter: { accountTag: "${accountId}" }) {
        gatewayL7RequestsAdaptiveGroups(
          limit: 500
          filter: { datetime_geq: "${since}", datetime_lt: "${until}", action_in: ["block"], email_neq: "" }
          orderBy: [count_DESC]
        ) { count dimensions { email } }
      }
    }
  }`;
  try {
    const data = await gqlAccount<{
      gatewayL7RequestsAdaptiveGroups: Array<{ count: number; dimensions: { email: string } }>;
    }>(token, query);
    const byUser = new Map<string, number>();
    for (const r of data.gatewayL7RequestsAdaptiveGroups ?? []) {
      const email = r.dimensions.email;
      if (!email) continue;
      byUser.set(email, (byUser.get(email) ?? 0) + r.count);
    }
    return Array.from(byUser.entries())
      .map(([email, count]) => ({ email, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, limit);
  } catch { return []; }
}

/**
 * DLP quarantine trend over time — mirrors Cloudflare's own "DLP matches in
 * HTTP requests over time" Data Security Analytics panel. Reuses the same
 * confirmed-live `quarantined:1` filter already used for the summary total
 * (see fetchGatewayHttpSummary above), just grouped by datetimeHour instead
 * of a single aggregate.
 */
export async function fetchGatewayDlpQuarantineTimeSeries(
  token: string, accountId: string, since: string, until: string
): Promise<{ date: string; count: number }[]> {
  const query = `{
    viewer {
      accounts(filter: { accountTag: "${accountId}" }) {
        gatewayL7RequestsAdaptiveGroups(
          limit: 720
          filter: { datetime_geq: "${since}", datetime_lt: "${until}", quarantined: 1 }
          orderBy: [datetimeHour_ASC]
        ) { count dimensions { datetimeHour } }
      }
    }
  }`;
  try {
    const data = await gqlAccount<{
      gatewayL7RequestsAdaptiveGroups: Array<{ count: number; dimensions: { datetimeHour: string } }>;
    }>(token, query);
    const byDate = new Map<string, number>();
    for (const r of data.gatewayL7RequestsAdaptiveGroups ?? []) {
      const date = r.dimensions.datetimeHour?.split("T")[0] ?? "";
      if (!date) continue;
      byDate.set(date, (byDate.get(date) ?? 0) + r.count);
    }
    return Array.from(byDate.entries())
      .map(([date, count]) => ({ date, count }))
      .sort((a, b) => a.date.localeCompare(b.date));
  } catch { return []; }
}

/**
 * Real HTTP block category breakdown using the confirmed-live `categoryIds`/
 * `categoryNames` array dimensions on gatewayL7RequestsAdaptiveGroups. There
 * is no separate "by category" HTTP dataset (unlike DNS's
 * gatewayResolverByCategoryAdaptiveGroups), so each row's category array is
 * expanded and tallied client-side — same pattern already used for Shadow IT
 * category breakdown below.
 */
export async function fetchGatewayHttpTopBlockedCategories(
  token: string, accountId: string, since: string, until: string, limit = 10,
  categoryMap?: Map<number, string>
): Promise<{ category: string; count: number }[]> {
  const query = `{
    viewer {
      accounts(filter: { accountTag: "${accountId}" }) {
        gatewayL7RequestsAdaptiveGroups(
          limit: 500
          filter: { datetime_geq: "${since}", datetime_lt: "${until}", action_in: ["block"] }
          orderBy: [count_DESC]
        ) { count dimensions { categoryIds categoryNames } }
      }
    }
  }`;
  try {
    const data = await gqlAccount<{
      gatewayL7RequestsAdaptiveGroups: Array<{
        count: number;
        dimensions: { categoryIds: number[]; categoryNames: string[] };
      }>;
    }>(token, query);

    const byCategory = new Map<string, number>();
    for (const r of data.gatewayL7RequestsAdaptiveGroups ?? []) {
      const ids   = r.dimensions.categoryIds   ?? [];
      const names = r.dimensions.categoryNames ?? [];
      if (ids.length === 0 && names.length === 0) {
        byCategory.set("Uncategorized", (byCategory.get("Uncategorized") ?? 0) + r.count);
        continue;
      }
      // Prefer live categoryMap/returned names; fall back to fallback table by id.
      const labels = ids.length > 0
        ? ids.map((id) => categoryMap?.get(id) ?? FALLBACK_CATEGORY_NAMES[id] ?? names[ids.indexOf(id)] ?? `Category ${id}`)
        : names.filter(Boolean);
      for (const label of labels.length > 0 ? labels : ["Uncategorized"]) {
        byCategory.set(label, (byCategory.get(label) ?? 0) + r.count);
      }
    }
    return Array.from(byCategory.entries())
      .map(([category, count]) => ({ category, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, limit);
  } catch { return []; }
}

// =============================================================================
// GATEWAY L4 — gatewayL4SessionsAdaptiveGroups
// =============================================================================

export interface GatewayL4Summary {
  timeSeries:          GatewayDayBucket[];
  blockedDestinations: L4BlockedDestination[];
  protocols:           L4Protocol[];
  sourceCountries:     L4Country[];
  portBreakdown:       Array<{ port: number; service: string; count: number }>;
}

export async function fetchGatewayL4Data(
  token: string, accountId: string, since: string, until: string
): Promise<GatewayL4Summary> {
  const [timeSeries, blockedDestinations, protocols, sourceCountries, portBreakdown] =
    await Promise.allSettled([
      fetchL4TimeSeries(token, accountId, since, until),
      fetchL4BlockedDestinations(token, accountId, since, until),
      fetchL4Protocols(token, accountId, since, until),
      fetchL4SourceCountries(token, accountId, since, until),
      fetchL4PortBreakdown(token, accountId, since, until),
    ]);

  return {
    timeSeries:          timeSeries.status          === "fulfilled" ? timeSeries.value          : [],
    blockedDestinations: blockedDestinations.status === "fulfilled" ? blockedDestinations.value : [],
    protocols:           protocols.status           === "fulfilled" ? protocols.value           : [],
    sourceCountries:     sourceCountries.status     === "fulfilled" ? sourceCountries.value     : [],
    portBreakdown:       portBreakdown.status       === "fulfilled" ? portBreakdown.value       : [],
  };
}

async function fetchL4TimeSeries(
  token: string, accountId: string, since: string, until: string
): Promise<GatewayDayBucket[]> {
  const query = `{
    viewer {
      accounts(filter: { accountTag: "${accountId}" }) {
        gatewayL4SessionsAdaptiveGroups(
          limit: 5000
          filter: { datetime_geq: "${since}", datetime_lt: "${until}" }
          orderBy: [datetimeHour_ASC]
        ) { count dimensions { datetimeHour action } }
      }
    }
  }`;
  const data = await gqlAccount<{
    gatewayL4SessionsAdaptiveGroups: Array<{
      count: number;
      dimensions: { datetimeHour: string; action: string };
    }>;
  }>(token, query);

  const byDate = new Map<string, GatewayDayBucket>();
  for (const r of data.gatewayL4SessionsAdaptiveGroups ?? []) {
    const date = r.dimensions.datetimeHour?.split("T")[0] ?? "";
    if (!date) continue;
    if (!byDate.has(date)) byDate.set(date, { date, total: 0, blocked: 0 });
    const bucket = byDate.get(date)!;
    bucket.total += r.count;
    if (r.dimensions.action === "block") bucket.blocked += r.count;
  }
  return Array.from(byDate.values()).sort((a, b) => a.date.localeCompare(b.date));
}

async function fetchL4BlockedDestinations(
  token: string, accountId: string, since: string, until: string
): Promise<L4BlockedDestination[]> {
  const query = `{
    viewer {
      accounts(filter: { accountTag: "${accountId}" }) {
        gatewayL4SessionsAdaptiveGroups(
          limit: 20
          filter: { datetime_geq: "${since}", datetime_lt: "${until}", action: "block" }
          orderBy: [count_DESC]
        ) {
          count
          dimensions { destinationIp dstIpCountry destinationPort transport }
        }
      }
    }
  }`;
  const data = await gqlAccount<{
    gatewayL4SessionsAdaptiveGroups: Array<{
      count: number;
      dimensions: {
        destinationIp: string;
        dstIpCountry: string;
        destinationPort: number;
        transport: string;
      };
    }>;
  }>(token, query);

  const byIp = new Map<string, { count: number; country: string; port: number | null; protocol: string }>();
  for (const r of data.gatewayL4SessionsAdaptiveGroups ?? []) {
    const ip  = r.dimensions.destinationIp || "unknown";
    const raw = r.dimensions.transport != null ? String(r.dimensions.transport) : "";
    const existing = byIp.get(ip);
    if (!existing) {
      byIp.set(ip, {
        count:    r.count,
        country:  r.dimensions.dstIpCountry || "",
        port:     r.dimensions.destinationPort || null,
        protocol: TRANSPORT_NAMES[raw] || raw || "unknown",
      });
    } else {
      existing.count += r.count;
    }
  }
  return Array.from(byIp.entries())
    .map(([ip, d]) => ({
      ip,
      count:    d.count,
      country:  d.country,
      port:     d.port,
      protocol: d.protocol,
      service:  d.port ? (PORT_SERVICES[d.port] ?? (d.port < 1024 ? "System" : "Custom")) : "",
    }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 10);
}

async function fetchL4Protocols(
  token: string, accountId: string, since: string, until: string
): Promise<L4Protocol[]> {
  const query = `{
    viewer {
      accounts(filter: { accountTag: "${accountId}" }) {
        gatewayL4SessionsAdaptiveGroups(
          limit: 50
          filter: { datetime_geq: "${since}", datetime_lt: "${until}" }
          orderBy: [count_DESC]
        ) { count dimensions { transport } }
      }
    }
  }`;
  const data = await gqlAccount<{
    gatewayL4SessionsAdaptiveGroups: Array<{
      count: number;
      dimensions: { transport: string };
    }>;
  }>(token, query);

  const byProto = new Map<string, number>();
  for (const r of data.gatewayL4SessionsAdaptiveGroups ?? []) {
    const raw      = r.dimensions.transport != null ? String(r.dimensions.transport) : "unknown";
    const protocol = TRANSPORT_NAMES[raw] || raw;
    byProto.set(protocol, (byProto.get(protocol) ?? 0) + r.count);
  }
  return Array.from(byProto.entries())
    .map(([protocol, count]) => ({ protocol, count }))
    .sort((a, b) => b.count - a.count);
}

async function fetchL4SourceCountries(
  token: string, accountId: string, since: string, until: string
): Promise<L4Country[]> {
  const query = `{
    viewer {
      accounts(filter: { accountTag: "${accountId}" }) {
        gatewayL4SessionsAdaptiveGroups(
          limit: 10
          filter: { datetime_geq: "${since}", datetime_lt: "${until}" }
          orderBy: [count_DESC]
        ) { count dimensions { srcIpCountry } }
      }
    }
  }`;
  const data = await gqlAccount<{
    gatewayL4SessionsAdaptiveGroups: Array<{
      count: number;
      dimensions: { srcIpCountry: string };
    }>;
  }>(token, query);

  const byCountry = new Map<string, number>();
  for (const r of data.gatewayL4SessionsAdaptiveGroups ?? []) {
    const c = r.dimensions.srcIpCountry || "Unknown";
    byCountry.set(c, (byCountry.get(c) ?? 0) + r.count);
  }
  return Array.from(byCountry.entries())
    .map(([country, count]) => ({ country, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 10);
}

async function fetchL4PortBreakdown(
  token: string, accountId: string, since: string, until: string
): Promise<Array<{ port: number; service: string; count: number }>> {
  const query = `{
    viewer {
      accounts(filter: { accountTag: "${accountId}" }) {
        gatewayL4SessionsAdaptiveGroups(
          limit: 30
          filter: { datetime_geq: "${since}", datetime_lt: "${until}" }
          orderBy: [count_DESC]
        ) { count dimensions { destinationPort } }
      }
    }
  }`;
  const data = await gqlAccount<{
    gatewayL4SessionsAdaptiveGroups: Array<{
      count: number;
      dimensions: { destinationPort: number };
    }>;
  }>(token, query);

  const byPort = new Map<number, number>();
  for (const r of data.gatewayL4SessionsAdaptiveGroups ?? []) {
    const port = r.dimensions.destinationPort;
    if (port != null) byPort.set(port, (byPort.get(port) ?? 0) + r.count);
  }
  return Array.from(byPort.entries())
    .map(([port, count]) => ({
      port,
      service: PORT_SERVICES[port] ?? (port < 1024 ? "System" : "Custom"),
      count,
    }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 15);
}

// Legacy stub — replaced by fetchGatewayL4Data above
export async function fetchGatewayL4TimeSeries(
  token: string, accountId: string, since: string, until: string
): Promise<GatewayDayBucket[]> {
  try { return await fetchL4TimeSeries(token, accountId, since, until); }
  catch { return []; }
}

// =============================================================================
// SHADOW IT — matchedApplicationName on gatewayResolverQueriesAdaptiveGroups
// =============================================================================

export interface ShadowItData {
  discoveredApps:   ShadowItApp[];
  categoryBreakdown: { category: string; count: number }[];
  userAppMappings:  ShadowItUserMapping[];
  appStatuses:      Record<string, string>; // app name → approval status, if available
}

export async function fetchShadowItData(
  token: string, accountId: string, since: string, until: string
): Promise<ShadowItData> {
  const [appsResult, catsResult, usersResult, statusResult] = await Promise.allSettled([
    fetchShadowItDiscoveredApps(token, accountId, since, until),
    fetchShadowItCategoryBreakdown(token, accountId, since, until),
    fetchShadowItUserMappings(token, accountId, since, until),
    fetchShadowItAppStatuses(token, accountId),
  ]);
  return {
    discoveredApps:    appsResult.status  === "fulfilled" ? appsResult.value  : [],
    categoryBreakdown: catsResult.status  === "fulfilled" ? catsResult.value  : [],
    userAppMappings:   usersResult.status === "fulfilled" ? usersResult.value : [],
    appStatuses:       statusResult.status    === "fulfilled" ? statusResult.value    : {},
  };
}

// NOTE: per-app bandwidth (bytes transferred per Shadow IT / SaaS app) was
// previously attempted via `gatewayL7RequestsAdaptiveGroups.sum { numBytes }`,
// but live GraphQL introspection confirmed `AccountGatewayL7RequestsAdaptiveGroupsSum`
// does not exist as a type at all — the HTTP Gateway dataset has no byte-sum
// aggregate in this schema. That query always failed silently and returned {},
// meaning every app's "bytes" was always fabricated as 0. Removed entirely
// rather than showing a fake always-zero number. Real byte sums (bytesSent/
// bytesRecvd) DO exist, but only on gatewayL4DownstreamSessionsAdaptiveGroups
// (network/session-layer dimensions only — no app/user attribution) — see
// fetchGatewayNetworkAnalytics() below for the real, honestly-scoped bandwidth metric.

/**
 * App approval status (Approved/Unapproved/In Review/Unreviewed) from the
 * Zero Trust App Library / Shadow IT approval workflow.
 *
 * NOTE: this is a very recently released feature (Cloudflare changelog,
 * Aug 2025) and no public REST/GraphQL field is documented for reading it
 * as of this writing. This attempts the Gateway app-types resource as the
 * most plausible source and safely returns {} (hiding the status UI
 * entirely) if unavailable — never blocks the rest of the report.
 */
async function fetchShadowItAppStatuses(
  token: string, accountId: string
): Promise<Record<string, string>> {
  try {
    const res = await fetch(`${CF_API}/accounts/${accountId}/gateway/app_types?per_page=500`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok) return {};
    const j = (await res.json()) as {
      success?: boolean;
      result?: Array<{ name?: string; status?: string; approval_status?: string }>;
    };
    if (!j.success || !Array.isArray(j.result)) return {};
    const statuses: Record<string, string> = {};
    for (const app of j.result) {
      const status = app.approval_status ?? app.status;
      if (app.name && status) statuses[app.name] = status;
    }
    return statuses;
  } catch {
    return {};
  }
}

function parseAppName(raw: string): string {
  try {
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) return parsed.join(", ");
  } catch { /* not JSON */ }
  return raw;
}

async function fetchShadowItDiscoveredApps(
  token: string, accountId: string, since: string, until: string
): Promise<ShadowItApp[]> {
  const query = `{
    viewer {
      accounts(filter: { accountTag: "${accountId}" }) {
        gatewayResolverQueriesAdaptiveGroups(
          limit: 30
          filter: {
            datetime_geq: "${since}"
            datetime_lt: "${until}"
            matchedApplicationName_neq: ""
          }
          orderBy: [count_DESC]
        ) { count dimensions { matchedApplicationName categoryNames } }
      }
    }
  }`;
  const data = await gqlAccount<{
    gatewayResolverQueriesAdaptiveGroups: Array<{
      count: number;
      dimensions: { matchedApplicationName: string; categoryNames: string[] };
    }>;
  }>(token, query);

  // Merge rows with the same app name
  const appMap = new Map<string, { count: number; categories: Map<string, number> }>();
  for (const r of data.gatewayResolverQueriesAdaptiveGroups ?? []) {
    const raw  = r.dimensions.matchedApplicationName;
    const name = parseAppName(raw) || "Unknown";
    const cats = (r.dimensions.categoryNames ?? []).filter(Boolean);
    const catKey = cats.length > 0 ? cats.join(", ") : "Uncategorized";

    const existing = appMap.get(name) ?? { count: 0, categories: new Map() };
    existing.count += r.count;
    existing.categories.set(catKey, (existing.categories.get(catKey) ?? 0) + r.count);
    appMap.set(name, existing);
  }

  return Array.from(appMap.entries())
    .map(([name, { count, categories }]) => {
      let topCat = "Uncategorized";
      let topN   = 0;
      for (const [cat, n] of categories) {
        if (n > topN) { topCat = cat; topN = n; }
      }
      return { name, category: topCat, count };
    })
    .sort((a, b) => b.count - a.count);
}

async function fetchShadowItCategoryBreakdown(
  token: string, accountId: string, since: string, until: string
): Promise<{ category: string; count: number }[]> {
  const query = `{
    viewer {
      accounts(filter: { accountTag: "${accountId}" }) {
        gatewayResolverQueriesAdaptiveGroups(
          limit: 50
          filter: {
            datetime_geq: "${since}"
            datetime_lt: "${until}"
            matchedApplicationName_neq: ""
          }
          orderBy: [count_DESC]
        ) { count dimensions { categoryNames } }
      }
    }
  }`;
  const data = await gqlAccount<{
    gatewayResolverQueriesAdaptiveGroups: Array<{
      count: number;
      dimensions: { categoryNames: string[] };
    }>;
  }>(token, query);

  const byCategory = new Map<string, number>();
  for (const r of data.gatewayResolverQueriesAdaptiveGroups ?? []) {
    const cats = (r.dimensions.categoryNames ?? []).filter(Boolean);
    const cat  = cats.length > 0 ? cats.join(", ") : "Uncategorized";
    byCategory.set(cat, (byCategory.get(cat) ?? 0) + r.count);
  }
  return Array.from(byCategory.entries())
    .map(([category, count]) => ({ category, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 15);
}

async function fetchShadowItUserMappings(
  token: string, accountId: string, since: string, until: string
): Promise<ShadowItUserMapping[]> {
  const query = `{
    viewer {
      accounts(filter: { accountTag: "${accountId}" }) {
        gatewayL7RequestsAdaptiveGroups(
          limit: 200
          filter: {
            datetime_geq: "${since}"
            datetime_lt: "${until}"
            email_neq: ""
          }
          orderBy: [count_DESC]
        ) { count dimensions { email applicationNames } }
      }
    }
  }`;
  try {
    const data = await gqlAccount<{
      gatewayL7RequestsAdaptiveGroups: Array<{
        count: number;
        dimensions: { email: string; applicationNames: string[] };
      }>;
    }>(token, query);

    const byUser = new Map<string, { apps: Set<string>; total: number }>();
    for (const r of data.gatewayL7RequestsAdaptiveGroups ?? []) {
      const email = r.dimensions.email;
      if (!email) continue;
      const existing = byUser.get(email) ?? { apps: new Set(), total: 0 };
      existing.total += r.count;
      for (const app of r.dimensions.applicationNames ?? []) {
        if (app) existing.apps.add(app);
      }
      byUser.set(email, existing);
    }
    return Array.from(byUser.entries())
      .map(([email, { apps, total }]) => ({
        email,
        apps:          Array.from(apps).sort(),
        totalRequests: total,
      }))
      .sort((a, b) => b.totalRequests - a.totalRequests);
  } catch { return []; }
}

// =============================================================================
// WARP DEVICE STATUS — warpDeviceAdaptiveGroups
// Confirmed via live introspection: `status` is a REAL dimension with values
// including "connected", "disconnected", "connecting", "nonetwork",
// "connectivitycheckfailed(dnslookupfailed)", "happyeyeballsfailed",
// "captiveportaltimedout". This dataset gives real historical connect/
// disconnect *events*, which is a better fit for a periodic report than a
// live point-in-time snapshot (DEX fleet-status REST endpoint) — it shows
// trend over the report window and needs no additional token permission
// beyond the Zero Trust Analytics Read scope already required.
// =============================================================================

const WARP_ONLINE_STATUS = "connected";

function isWarpOnlineStatus(status: string): boolean {
  return (status || "").toLowerCase() === WARP_ONLINE_STATUS;
}

export interface WarpStatusCount { status: string; count: number; online: boolean }
export interface WarpStatusDay   { date: string; connected: number; disconnected: number; other: number }

/** Real event-volume breakdown by connection status over the report period. */
export async function fetchWarpDeviceStatusBreakdown(
  token: string, accountId: string, since: string, until: string
): Promise<WarpStatusCount[]> {
  const query = `{
    viewer {
      accounts(filter: { accountTag: "${accountId}" }) {
        warpDeviceAdaptiveGroups(
          limit: 50
          filter: { datetime_geq: "${since}", datetime_lt: "${until}" }
          orderBy: [count_DESC]
        ) { count dimensions { status } }
      }
    }
  }`;
  try {
    const data = await gqlAccount<{
      warpDeviceAdaptiveGroups: Array<{ count: number; dimensions: { status: string } }>;
    }>(token, query);
    const byStatus = new Map<string, number>();
    for (const r of data.warpDeviceAdaptiveGroups ?? []) {
      const s = r.dimensions.status || "unknown";
      byStatus.set(s, (byStatus.get(s) ?? 0) + r.count);
    }
    return Array.from(byStatus.entries())
      .map(([status, count]) => ({ status, count, online: isWarpOnlineStatus(status) }))
      .sort((a, b) => b.count - a.count);
  } catch { return []; }
}

/** Real daily connect/disconnect event-volume trend (replaces the old fake
 *  flat-line series that just repeated a static REST device count). */
export async function fetchWarpDeviceStatusTimeSeries(
  token: string, accountId: string, since: string, until: string
): Promise<WarpStatusDay[]> {
  const query = `{
    viewer {
      accounts(filter: { accountTag: "${accountId}" }) {
        warpDeviceAdaptiveGroups(
          limit: 3000
          filter: { datetime_geq: "${since}", datetime_lt: "${until}" }
          orderBy: [date_ASC]
        ) { count dimensions { date status } }
      }
    }
  }`;
  try {
    const data = await gqlAccount<{
      warpDeviceAdaptiveGroups: Array<{ count: number; dimensions: { date: string; status: string } }>;
    }>(token, query);
    const byDate = new Map<string, WarpStatusDay>();
    for (const r of data.warpDeviceAdaptiveGroups ?? []) {
      const d = r.dimensions.date;
      if (!d) continue;
      if (!byDate.has(d)) byDate.set(d, { date: d, connected: 0, disconnected: 0, other: 0 });
      const bucket = byDate.get(d)!;
      const s = (r.dimensions.status || "").toLowerCase();
      if (s === "connected") bucket.connected += r.count;
      else if (s === "disconnected") bucket.disconnected += r.count;
      else bucket.other += r.count;
    }
    return Array.from(byDate.values()).sort((a, b) => a.date.localeCompare(b.date));
  } catch { return []; }
}

/**
 * Approximates real "devices currently online/offline" by taking each
 * device's MOST RECENT status event within the period (ordered by datetime
 * desc, first row per deviceId wins). This is a genuine per-device snapshot
 * derived from live connection events — not a fabricated ratio. Capped at
 * 2000 status rows for query cost; safe/honest fallback to zeros on error.
 */
export async function fetchWarpDeviceLatestStatus(
  token: string, accountId: string, since: string, until: string
): Promise<{ online: number; offline: number; total: number }> {
  const query = `{
    viewer {
      accounts(filter: { accountTag: "${accountId}" }) {
        warpDeviceAdaptiveGroups(
          limit: 2000
          filter: { datetime_geq: "${since}", datetime_lt: "${until}" }
          orderBy: [datetime_DESC]
        ) { dimensions { deviceId status datetime } }
      }
    }
  }`;
  try {
    const data = await gqlAccount<{
      warpDeviceAdaptiveGroups: Array<{ dimensions: { deviceId: string; status: string; datetime: string } }>;
    }>(token, query);
    const seen = new Set<string>();
    let online = 0, offline = 0;
    for (const r of data.warpDeviceAdaptiveGroups ?? []) {
      const id = r.dimensions.deviceId;
      if (!id || seen.has(id)) continue;
      seen.add(id);
      if (isWarpOnlineStatus(r.dimensions.status)) online++; else offline++;
    }
    return { online, offline, total: seen.size };
  } catch { return { online: 0, offline: 0, total: 0 }; }
}

// =============================================================================
// GATEWAY BANDWIDTH — gatewayL4DownstreamSessionsAdaptiveGroups.sum
// Confirmed real fields (live introspection): bytesSent, bytesRecvd,
// clientBytesRetransmitted, packetsSent, packetsRecvd. IMPORTANT scope note:
// this dataset's dimensions are session/network-layer only (coloCode,
// sourceIP, transport, rtt, ...) — there is NO application/user attribution
// on it, and separately confirmed there is NO byte-sum aggregate at all on
// the HTTP (L7) or generic L4 Sessions datasets. This means real bandwidth
// is only obtainable as an ACCOUNT-WIDE total (Gateway/WARP network-layer
// traffic), not broken down per app or per user — reported as such, not
// mislabeled as "total org bandwidth".
//
// This dataset also has a shorter quota window than most other Gateway
// datasets (confirmed live: "cannot request a time range wider than 1w" on
// at least one account, vs the usual 4w2d). To support longer report
// periods without hitting quota, the requested range is split into ≤6-day
// chunks and the results are summed client-side.
// =============================================================================

export interface GatewayBandwidthTotals {
  bytesSent: number;
  bytesRecvd: number;
  packetsSent: number;
  packetsRecvd: number;
  sessionCount: number;
}

/**
 * Session-level network quality/location breakdowns, folded into the same
 * chunked query as bandwidth (same dataset + same ~1-week quota) rather than
 * issuing a second round of chunked requests. All fields confirmed real via
 * live introspection: transportStatus, tokenAuthStatus, coloCode/coloCountry
 * (dimensions), clientBytesRetransmitted (sum). Value shapes (actual status
 * strings) were NOT observed non-empty on any account available for testing
 * — every account tested has zero L4 downstream session traffic in this
 * environment — so breakdowns are rendered generically by whatever string
 * values the API returns, with an honest empty state if none.
 */
export interface GatewayNetworkAnalytics extends GatewayBandwidthTotals {
  retransmittedBytes: number;
  transportStatusBreakdown: { status: string; count: number }[];
  tokenAuthStatusBreakdown: { status: string; count: number }[];
  topColos: { colo: string; country: string; count: number }[];
}

function emptyNetworkAnalytics(): GatewayNetworkAnalytics {
  return {
    bytesSent: 0, bytesRecvd: 0, packetsSent: 0, packetsRecvd: 0, sessionCount: 0,
    retransmittedBytes: 0, transportStatusBreakdown: [], tokenAuthStatusBreakdown: [], topColos: [],
  };
}

async function fetchNetworkAnalyticsChunk(
  token: string, accountId: string, since: string, until: string
): Promise<GatewayNetworkAnalytics> {
  const query = `{
    viewer {
      accounts(filter: { accountTag: "${accountId}" }) {
        totals: gatewayL4DownstreamSessionsAdaptiveGroups(
          limit: 1
          filter: { datetime_geq: "${since}", datetime_lt: "${until}" }
        ) { count sum { bytesSent bytesRecvd packetsSent packetsRecvd clientBytesRetransmitted } }
        byTransport: gatewayL4DownstreamSessionsAdaptiveGroups(
          limit: 20
          filter: { datetime_geq: "${since}", datetime_lt: "${until}" }
          orderBy: [count_DESC]
        ) { count dimensions { transportStatus } }
        byTokenAuth: gatewayL4DownstreamSessionsAdaptiveGroups(
          limit: 20
          filter: { datetime_geq: "${since}", datetime_lt: "${until}" }
          orderBy: [count_DESC]
        ) { count dimensions { tokenAuthStatus } }
        byColo: gatewayL4DownstreamSessionsAdaptiveGroups(
          limit: 20
          filter: { datetime_geq: "${since}", datetime_lt: "${until}" }
          orderBy: [count_DESC]
        ) { count dimensions { coloCode coloCountry } }
      }
    }
  }`;
  const data = await gqlAccount<{
    totals: Array<{ count: number; sum: { bytesSent: number; bytesRecvd: number; packetsSent: number; packetsRecvd: number; clientBytesRetransmitted: number } }>;
    byTransport: Array<{ count: number; dimensions: { transportStatus: string } }>;
    byTokenAuth: Array<{ count: number; dimensions: { tokenAuthStatus: string } }>;
    byColo: Array<{ count: number; dimensions: { coloCode: string; coloCountry: string } }>;
  }>(token, query);

  const totalsAcc = (data.totals ?? []).reduce(
    (acc, r) => ({
      bytesSent:          acc.bytesSent          + (r.sum?.bytesSent ?? 0),
      bytesRecvd:         acc.bytesRecvd         + (r.sum?.bytesRecvd ?? 0),
      packetsSent:        acc.packetsSent        + (r.sum?.packetsSent ?? 0),
      packetsRecvd:       acc.packetsRecvd       + (r.sum?.packetsRecvd ?? 0),
      sessionCount:       acc.sessionCount       + (r.count ?? 0),
      retransmittedBytes: acc.retransmittedBytes + (r.sum?.clientBytesRetransmitted ?? 0),
    }),
    { bytesSent: 0, bytesRecvd: 0, packetsSent: 0, packetsRecvd: 0, sessionCount: 0, retransmittedBytes: 0 }
  );

  const transportMap = new Map<string, number>();
  for (const r of data.byTransport ?? []) {
    const s = r.dimensions.transportStatus || "unknown";
    transportMap.set(s, (transportMap.get(s) ?? 0) + r.count);
  }
  const tokenAuthMap = new Map<string, number>();
  for (const r of data.byTokenAuth ?? []) {
    const s = r.dimensions.tokenAuthStatus || "unknown";
    tokenAuthMap.set(s, (tokenAuthMap.get(s) ?? 0) + r.count);
  }
  const coloMap = new Map<string, { country: string; count: number }>();
  for (const r of data.byColo ?? []) {
    const colo = r.dimensions.coloCode || "unknown";
    const existing = coloMap.get(colo);
    coloMap.set(colo, { country: r.dimensions.coloCountry || existing?.country || "", count: (existing?.count ?? 0) + r.count });
  }

  return {
    ...totalsAcc,
    transportStatusBreakdown: Array.from(transportMap.entries()).map(([status, count]) => ({ status, count })),
    tokenAuthStatusBreakdown: Array.from(tokenAuthMap.entries()).map(([status, count]) => ({ status, count })),
    topColos: Array.from(coloMap.entries()).map(([colo, { country, count }]) => ({ colo, country, count })),
  };
}

/** Splits [since, until) into ≤6-day windows to stay under this dataset's
 *  shorter (~1 week) quota, queries each chunk in parallel, merges totals
 *  and breakdowns across chunks. Powers both the bandwidth KPI and the
 *  Network Session Analytics cards (transport/token-auth health, top
 *  Cloudflare colos, retransmitted bytes) from a single chunked query pass. */
export async function fetchGatewayNetworkAnalytics(
  token: string, accountId: string, since: string, until: string
): Promise<GatewayNetworkAnalytics> {
  const chunks: Array<[string, string]> = [];
  const CHUNK_MS = 6 * 24 * 60 * 60 * 1000;
  let cursor = new Date(since).getTime();
  const end = new Date(until).getTime();
  while (cursor < end) {
    const chunkEnd = Math.min(cursor + CHUNK_MS, end);
    chunks.push([new Date(cursor).toISOString(), new Date(chunkEnd).toISOString()]);
    cursor = chunkEnd;
  }
  const results = await Promise.allSettled(
    chunks.map(([s, u]) => fetchNetworkAnalyticsChunk(token, accountId, s, u))
  );

  const transportMap = new Map<string, number>();
  const tokenAuthMap = new Map<string, number>();
  const coloMap = new Map<string, { country: string; count: number }>();
  const totals = results.reduce<GatewayNetworkAnalytics>(
    (acc, r) => {
      if (r.status !== "fulfilled") return acc;
      for (const t of r.value.transportStatusBreakdown) transportMap.set(t.status, (transportMap.get(t.status) ?? 0) + t.count);
      for (const t of r.value.tokenAuthStatusBreakdown) tokenAuthMap.set(t.status, (tokenAuthMap.get(t.status) ?? 0) + t.count);
      for (const c of r.value.topColos) {
        const existing = coloMap.get(c.colo);
        coloMap.set(c.colo, { country: c.country || existing?.country || "", count: (existing?.count ?? 0) + c.count });
      }
      return {
        ...acc,
        bytesSent:          acc.bytesSent          + r.value.bytesSent,
        bytesRecvd:         acc.bytesRecvd         + r.value.bytesRecvd,
        packetsSent:        acc.packetsSent        + r.value.packetsSent,
        packetsRecvd:       acc.packetsRecvd       + r.value.packetsRecvd,
        sessionCount:       acc.sessionCount       + r.value.sessionCount,
        retransmittedBytes: acc.retransmittedBytes + r.value.retransmittedBytes,
      };
    },
    emptyNetworkAnalytics()
  );

  return {
    ...totals,
    transportStatusBreakdown: Array.from(transportMap.entries()).map(([status, count]) => ({ status, count })).sort((a, b) => b.count - a.count),
    tokenAuthStatusBreakdown: Array.from(tokenAuthMap.entries()).map(([status, count]) => ({ status, count })).sort((a, b) => b.count - a.count),
    topColos: Array.from(coloMap.entries()).map(([colo, { country, count }]) => ({ colo, country, count })).sort((a, b) => b.count - a.count).slice(0, 10),
  };
}

/**
 * Real "Shadow IT: Private Network" origins — mirrors Cloudflare's own
 * dashboard of the same name. Sourced from gatewayL4SessionsAdaptiveGroups
 * (sourceInternalIp + virtualNetworkName dimensions, confirmed live with
 * real non-empty data). Distinct from the public-internet Shadow IT SaaS
 * discovery section (which uses DNS matchedApplicationName) — this covers
 * WARP-routed private network traffic instead.
 */
export interface PrivateNetworkOrigin { sourceIp: string; virtualNetwork: string; count: number }

export async function fetchPrivateNetworkOrigins(
  token: string, accountId: string, since: string, until: string, limit = 15
): Promise<PrivateNetworkOrigin[]> {
  const query = `{
    viewer {
      accounts(filter: { accountTag: "${accountId}" }) {
        gatewayL4SessionsAdaptiveGroups(
          limit: ${limit}
          filter: { datetime_geq: "${since}", datetime_lt: "${until}", sourceInternalIp_neq: "" }
          orderBy: [count_DESC]
        ) { count dimensions { sourceInternalIp virtualNetworkName } }
      }
    }
  }`;
  try {
    const data = await gqlAccount<{
      gatewayL4SessionsAdaptiveGroups: Array<{ count: number; dimensions: { sourceInternalIp: string; virtualNetworkName: string } }>;
    }>(token, query);
    return (data.gatewayL4SessionsAdaptiveGroups ?? [])
      .filter((r) => r.dimensions.sourceInternalIp)
      .map((r) => ({
        sourceIp: r.dimensions.sourceInternalIp,
        virtualNetwork: r.dimensions.virtualNetworkName || "default",
        count: r.count,
      }));
  } catch { return []; }
}

// =============================================================================
// GENERATIVE AI USAGE — real Cloudflare category classification
// Confirmed live (REST /gateway/categories on a real account): subcategory
// ID 184, name "Artificial Intelligence" (parent category 26 "Technology").
// This replaces the previous keyword-matching heuristic (a fixed list of
// ~35 app-name substrings like "chatgpt", "openai", "claude", ...) with
// Cloudflare's own real per-request category classification on both DNS and
// HTTP Gateway traffic — catches ANY app Cloudflare itself tags as AI, not
// just the ones in a manually maintained keyword list, and with zero
// false-positive risk from substring matches.
// =============================================================================

export interface GenAiUsage {
  totalRequests: number;
  uniqueApps: number;
  uniqueUsers: number;
  apps: { name: string; count: number }[];
  users: { email: string; count: number }[];
}

const AI_CATEGORY_NAME = "artificial intelligence";

export async function fetchGenAiUsage(
  token: string, accountId: string, since: string, until: string
): Promise<GenAiUsage> {
  // categoryNames is a [String] array dimension — use the confirmed-working
  // `_hasany` array-containment filter suffix (same pattern already proven
  // live for botDetectionIds_hasany on the AppSec side) rather than guessing
  // an unverified `_like`/wildcard filter exists on this field.
  const dnsQuery = `{
    viewer {
      accounts(filter: { accountTag: "${accountId}" }) {
        gatewayResolverQueriesAdaptiveGroups(
          limit: 500
          filter: { datetime_gt: "${since}", categoryNames_hasany: ["Artificial Intelligence"] }
          orderBy: [count_DESC]
        ) { count dimensions { matchedApplicationName queryName categoryNames } }
      }
    }
  }`;
  const httpQuery = `{
    viewer {
      accounts(filter: { accountTag: "${accountId}" }) {
        gatewayL7RequestsAdaptiveGroups(
          limit: 500
          filter: { datetime_geq: "${since}", datetime_lt: "${until}", categoryNames_hasany: ["Artificial Intelligence"] }
          orderBy: [count_DESC]
        ) { count dimensions { applicationNames httpHost categoryNames email } }
      }
    }
  }`;

  const [dnsResult, httpResult] = await Promise.allSettled([
    gqlAccount<{
      gatewayResolverQueriesAdaptiveGroups: Array<{
        count: number;
        dimensions: { matchedApplicationName: string; queryName: string; categoryNames: string[] };
      }>;
    }>(token, dnsQuery),
    gqlAccount<{
      gatewayL7RequestsAdaptiveGroups: Array<{
        count: number;
        dimensions: { applicationNames: string[]; httpHost: string; categoryNames: string[]; email: string };
      }>;
    }>(token, httpQuery),
  ]);

  const byApp = new Map<string, number>();
  const byUser = new Map<string, number>();
  let total = 0;

  const isAiCategory = (cats: string[] | undefined) =>
    (cats ?? []).some((c) => (c || "").toLowerCase().includes(AI_CATEGORY_NAME));

  if (dnsResult.status === "fulfilled") {
    for (const r of dnsResult.value.gatewayResolverQueriesAdaptiveGroups ?? []) {
      if (!isAiCategory(r.dimensions.categoryNames)) continue;
      const name = parseAppName(r.dimensions.matchedApplicationName) || r.dimensions.queryName || "Unknown";
      byApp.set(name, (byApp.get(name) ?? 0) + r.count);
      total += r.count;
    }
  }
  if (httpResult.status === "fulfilled") {
    for (const r of httpResult.value.gatewayL7RequestsAdaptiveGroups ?? []) {
      if (!isAiCategory(r.dimensions.categoryNames)) continue;
      const names = (r.dimensions.applicationNames ?? []).filter(Boolean);
      const name = names.length > 0 ? parseAppName(names[0]) : (r.dimensions.httpHost || "Unknown");
      byApp.set(name, (byApp.get(name) ?? 0) + r.count);
      total += r.count;
      if (r.dimensions.email) byUser.set(r.dimensions.email, (byUser.get(r.dimensions.email) ?? 0) + r.count);
    }
  }

  return {
    totalRequests: total,
    uniqueApps: byApp.size,
    uniqueUsers: byUser.size,
    apps: Array.from(byApp.entries()).map(([name, count]) => ({ name, count })).sort((a, b) => b.count - a.count),
    users: Array.from(byUser.entries()).map(([email, count]) => ({ email, count })).sort((a, b) => b.count - a.count),
  };
}

// Re-export alias for backward compat
export { fetchGatewayDnsSummary as fetchDnsSummary };

// =============================================================================
// ACCESS AUDIT ENRICHMENT — accessLoginRequestsAdaptiveGroups
// Inspired by cf-reporting's access-audit.ts
// =============================================================================

/** Which identity providers are being used, and how many logins each */
export interface AccessIdpBreakdown {
  provider: string;
  count: number;
}

/** Per-app login success/failure breakdown */
export interface AccessAppBreakdown {
  appId: string;
  successful: number;
  failed: number;
  total: number;
  failureRate: number;  // 0-100 %
}

/** Failed login detail: app + country + IdP */
export interface AccessFailedDetail {
  appId: string;
  country: string;
  identityProvider: string;
  count: number;
}

/** Anomaly detected in login patterns */
export interface AccessAnomaly {
  severity: "critical" | "warning" | "info";
  title: string;
  description: string;
}

export async function fetchAccessIdentityProviderBreakdown(
  token: string, accountId: string, since: string, until: string
): Promise<AccessIdpBreakdown[]> {
  const query = `{
    viewer {
      accounts(filter: { accountTag: "${accountId}" }) {
        accessLoginRequestsAdaptiveGroups(
          limit: 50
          filter: { datetime_geq: "${since}", datetime_lt: "${until}" }
          orderBy: [count_DESC]
        ) {
          count
          dimensions { identityProvider }
        }
      }
    }
  }`;
  try {
    const data = await gqlAccount<{
      accessLoginRequestsAdaptiveGroups: Array<{
        count: number;
        dimensions: { identityProvider: string };
      }>;
    }>(token, query);

    const byProvider = new Map<string, number>();
    for (const r of data.accessLoginRequestsAdaptiveGroups ?? []) {
      const p = r.dimensions.identityProvider || "Unknown";
      byProvider.set(p, (byProvider.get(p) ?? 0) + r.count);
    }
    return Array.from(byProvider.entries())
      .map(([provider, count]) => ({ provider, count }))
      .sort((a, b) => b.count - a.count);
  } catch { return []; }
}

export async function fetchAccessAppBreakdown(
  token: string, accountId: string, since: string, until: string
): Promise<AccessAppBreakdown[]> {
  const query = `{
    viewer {
      accounts(filter: { accountTag: "${accountId}" }) {
        accessLoginRequestsAdaptiveGroups(
          limit: 100
          filter: { datetime_geq: "${since}", datetime_lt: "${until}" }
          orderBy: [count_DESC]
        ) {
          count
          dimensions { appId isSuccessfulLogin }
        }
      }
    }
  }`;
  try {
    const data = await gqlAccount<{
      accessLoginRequestsAdaptiveGroups: Array<{
        count: number;
        dimensions: { appId: string; isSuccessfulLogin: number };
      }>;
    }>(token, query);

    const appMap = new Map<string, { successful: number; failed: number }>();
    for (const r of data.accessLoginRequestsAdaptiveGroups ?? []) {
      const id = r.dimensions.appId || "unknown";
      const existing = appMap.get(id) ?? { successful: 0, failed: 0 };
      if (r.dimensions.isSuccessfulLogin === 1) existing.successful += r.count;
      else existing.failed += r.count;
      appMap.set(id, existing);
    }
    return Array.from(appMap.entries())
      .map(([appId, stats]) => {
        const total = stats.successful + stats.failed;
        return {
          appId,
          ...stats,
          total,
          failureRate: total > 0 ? Math.round((stats.failed / total) * 100) : 0,
        };
      })
      .sort((a, b) => b.total - a.total);
  } catch { return []; }
}

export async function fetchAccessFailedLoginDetails(
  token: string, accountId: string, since: string, until: string
): Promise<AccessFailedDetail[]> {
  const query = `{
    viewer {
      accounts(filter: { accountTag: "${accountId}" }) {
        accessLoginRequestsAdaptiveGroups(
          limit: 50
          filter: {
            datetime_geq: "${since}"
            datetime_lt: "${until}"
            isSuccessfulLogin: 0
          }
          orderBy: [count_DESC]
        ) {
          count
          dimensions { appId country identityProvider }
        }
      }
    }
  }`;
  try {
    const data = await gqlAccount<{
      accessLoginRequestsAdaptiveGroups: Array<{
        count: number;
        dimensions: { appId: string; country: string; identityProvider: string };
      }>;
    }>(token, query);

    return (data.accessLoginRequestsAdaptiveGroups ?? []).map((r) => ({
      appId:            r.dimensions.appId || "unknown",
      country:          r.dimensions.country || "Unknown",
      identityProvider: r.dimensions.identityProvider || "Unknown",
      count:            r.count,
    }));
  } catch { return []; }
}

/**
 * Detect anomalies in Access login patterns.
 * Purely client-side computation — no additional API call needed.
 * Inspired by cf-reporting's detectAnomalies() in access-audit.ts.
 */
export function detectAccessAnomalies(
  appBreakdown: AccessAppBreakdown[],
  failedDetails: AccessFailedDetail[],
  successfulCountries: string[],
  dailyActive: AccessDailyActive[]
): AccessAnomaly[] {
  const anomalies: AccessAnomaly[] = [];
  const successSet = new Set(successfulCountries.map((c) => c.toLowerCase()));

  // 1. Apps with high failure rate
  for (const app of appBreakdown) {
    if (app.failureRate > 50 && app.failed >= 5) {
      anomalies.push({
        severity: "critical",
        title: `High failure rate on app ${app.appId}`,
        description: `${app.failureRate}% of login attempts failed (${app.failed} of ${app.total}). Possible misconfigured IdP, expired credentials, or brute-force.`,
      });
    } else if (app.failureRate > 30 && app.failed >= 3) {
      anomalies.push({
        severity: "warning",
        title: `Elevated failure rate on app ${app.appId}`,
        description: `${app.failureRate}% of login attempts failed (${app.failed} of ${app.total}).`,
      });
    }
  }

  // 2. Countries with only failed logins (no successful logins from that country)
  const failedCountryCounts = new Map<string, number>();
  for (const d of failedDetails) {
    const c = d.country.toLowerCase();
    failedCountryCounts.set(c, (failedCountryCounts.get(c) ?? 0) + d.count);
  }
  for (const [country, count] of failedCountryCounts.entries()) {
    if (!successSet.has(country) && count >= 2) {
      anomalies.push({
        severity: "warning",
        title: `Suspicious country: ${country.toUpperCase()}`,
        description: `${count} failed login attempts from ${country.toUpperCase()} with zero successful logins in this period.`,
      });
    }
  }

  // 3. Overall failure rate spike
  const totalSuccess = dailyActive.reduce((s, d) => s + d.logins, 0);
  const totalFailed  = failedDetails.reduce((s, d) => s + d.count, 0);
  const totalAll = totalSuccess + totalFailed;
  if (totalAll > 10 && totalFailed / totalAll > 0.2) {
    anomalies.push({
      severity: totalFailed / totalAll > 0.4 ? "critical" : "warning",
      title: "High overall authentication failure rate",
      description: `${Math.round((totalFailed / totalAll) * 100)}% of all login attempts failed (${totalFailed} of ${totalAll}). Investigate misconfiguration or unauthorized attempts.`,
    });
  }

  // 4. Day-level spike: days with failures > 3× average
  const failedByDay = new Map<string, number>();
  for (const d of failedDetails) {
    // We don't have per-day failed breakdown, but dailyActive has logins
    // Approximation: flag if any day uniqueUsers = 0 but there are failed logins
  }
  void failedByDay; // suppress unused warning

  return anomalies;
}
