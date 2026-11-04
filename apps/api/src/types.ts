// ─── Env Bindings ──────────────────────────────────────────────────────────────
export interface Env {
  AI: Ai;
  ENVIRONMENT: string;
  ALLOWED_ORIGIN: string;
  AUDIT_BUCKET: R2Bucket;
  /** Workers static assets — the deployed web build, including the
   *  single-chunk static-report bundle used for scheduled email attachments. */
  ASSETS: Fetcher;
  /** D1 — scheduled report configuration + send history */
  DB: D1Database;
  /** Cloudflare Email Sending binding — delivers scheduled report emails */
  EMAIL: SendEmail;
  /** Cloudflare API token (secret) used by the scheduled report runner */
  CF_API_TOKEN: string;
  /** Account (secret/var) the scheduled reports are generated from */
  CF_ACCOUNT_ID: string;
  /** Sender address for scheduled emails — domain must be onboarded to Email Sending */
  EMAIL_FROM: string;
  /** Operator-owned Browser Run credentials, separate from customer analytics. */
  PDF_API_TOKEN?: string;
  PDF_ACCOUNT_ID?: string;
  /** Browser Rendering binding for PDFs without a separate API token. */
  BROWSER?: Fetcher;
  /** Optional: Cloudflare Access team domain (e.g. "myteam.cloudflareaccess.com").
   *  When set together with CF_ACCESS_AUD, /api/* requires a signature-verified
   *  Cloudflare Access JWT (Cf-Access-Jwt-Assertion header or __CF_Authorization cookie). */
  CF_ACCESS_TEAM_DOMAIN?: string;
  /** Optional: this application's Cloudflare Access AUD tag (required with CF_ACCESS_TEAM_DOMAIN). */
  CF_ACCESS_AUD?: string;
  /** Optional: server-held bearer secret (npx wrangler secret put MANAGE_SECRET) —
   *  used as the caller gate when CF_ACCESS_TEAM_DOMAIN/CF_ACCESS_AUD are not configured.
   *  When none of the three is configured, every /api/* route fails closed with 503. */
  MANAGE_SECRET?: string;
}

// ─── Scheduled Reports ────────────────────────────────────────────────────────

export type ScheduleFrequency = "daily" | "weekly" | "monthly";
export type ScheduleReportType = "appsec" | "zero-trust" | "magic-transit" | "custom-dashboard";
// "rolling" = fixed N-day window ending now (existing behavior).
// "calendar_month" = the previous full calendar month (28-31 days,
// whichever the month actually has) — see lastCalendarMonth() in
// cf-graphql.ts. Fixes monthly-frequency schedules silently drifting off
// true month boundaries when using a fixed 30-day rolling window.
export type ReportRangeMode = "rolling" | "calendar_month" | "custom" | "period";

/** Raw D1 row from the `schedules` table */
export interface ScheduleRow {
  id: string;
  name: string;
  report_type: ScheduleReportType;
  zone_id: string | null;
  zone_name: string | null;
  days: number;
  tz_offset: number;
  frequency: ScheduleFrequency;
  day_of_week: number | null;
  day_of_month: number | null;
  send_hour_utc: number;
  recipients: string;              // JSON array
  subject: string;
  message: string;
  is_poc: number;
  client_name: string | null;
  enabled: number;
  created_at: string;
  updated_at: string;
  last_run_at: string | null;
  last_status: string | null;
  last_error: string | null;
  range_mode: ReportRangeMode;
  since_date: string | null;
  until_date: string | null;
  since_time: string | null;
  until_time: string | null;
  months_ago: number | null;
  period: string | null;         // period mode: yesterday | last_week | last_month
  client_logo: string | null;    // per-schedule branding: base64 data URI for the report cover
  api_token: string | null;      // per-schedule customer token (write-only via API)
  account_id: string | null;     // per-schedule customer account (falls back to backend)
  dashboard_template?: string | null;
}

/** Schedule as returned to the dashboard (recipients parsed, booleans coerced) */
export interface ScheduleConfig {
  id: string;
  name: string;
  reportType: ScheduleReportType;
  zoneId: string | null;
  zoneName: string | null;
  days: number;
  tzOffset: number;
  frequency: ScheduleFrequency;
  dayOfWeek: number | null;
  dayOfMonth: number | null;
  sendHourUtc: number;
  recipients: string[];
  subject: string;
  message: string;
  isPoc: boolean;
  clientName: string | null;
  enabled: boolean;
  createdAt: string;
  updatedAt: string;
  lastRunAt: string | null;
  lastStatus: string | null;
  lastError: string | null;
  rangeMode: ReportRangeMode;
  sinceDate: string | null;
  untilDate: string | null;
  sinceTime: string | null;
  untilTime: string | null;
  monthsAgo: number | null;
  /** Period mode choice: yesterday | last_week | last_month (null in other modes). */
  period: string | null;
  /** Client branding logo (base64 data URI) rendered on the report cover. */
  clientLogo: string | null;
  /** True when this schedule carries its own API token (value never returned). */
  apiTokenSet: boolean;
  /** Masked hint ("••••••••xxxx") when a per-schedule token is stored. */
  apiTokenHint: string | null;
  /** Per-schedule customer account ID (null = use the backend account). */
  accountId: string | null;
  dashboardTemplate?: import("../../../shared/custom-dashboard-template").DashboardTemplate | null;
}

export interface SendHistoryRow {
  id: string;
  schedule_id: string;
  started_at: string;
  finished_at: string | null;
  status: string;
  trigger: string;
  error: string | null;
  recipients: string;
  message_id: string | null;
}

// ─── Request Payloads ─────────────────────────────────────────────────────────
export interface FetchDataRequest {
  token: string;       // Cloudflare API token (scoped: Zone Read + Account Read)
  zoneId: string;      // Zone ID (hex, 32 chars)
  accountId: string;   // Account ID (hex, 32 chars)
}

export interface SummaryRequest {
  appsec: AppSecData;
}

// ─── Zero Trust Data Model ────────────────────────────────────────────────────

export interface ZeroTrustSummary {
  totalAuthEvents: number;
  authSuccessRate: number;       // 0-100 %
  uniqueUsers: number;
  uniqueApps: number;
  blockedAuthEvents: number;
  mfaChallenges: number;
  gatewayDnsQueries: number;
  gatewayDnsBlocked: number;
  gatewayHttpRequests: number;
  gatewayHttpBlocked: number;
  httpRbiSessions: number;
  // Real, from gatewayL7RequestsAdaptiveGroups.quarantined / .experimentalIsMcp
  // (confirmed live int dimensions, folded into the same summary query as
  // blocked/rbi/total — no extra round trip).
  httpQuarantinedRequests: number;
  gatewayMcpHttpRequests: number;
  gatewayL4Sessions: number;
  gatewayL4Blocked: number;
  shadowItAppsDiscovered: number;
  warpEnrolledDevices: number;
  // Real online/offline breakdown from warpDeviceAdaptiveGroups.status (each
  // device's most recent connection-status event within the report period).
  // Replaces the old `warpCompliantDevices` field, which had no real posture
  // pass/fail data source and was always just set equal to enrolled-device
  // count (i.e. always claimed 100% compliant — a fabricated number).
  warpOnlineDevices: number;
  warpOfflineDevices: number;
  tunnelsHealthy: number;
  tunnelsTotal: number;
  // Real per-user seat data from REST /access/users (no GraphQL equivalent exists).
  seatsTotal: number;
  seatsAccessTotal: number;
  seatsGatewayTotal: number;
  seatsActiveInPeriod: number;
  seatsNeverLoggedIn: number;
  // Real account-wide Gateway network-layer (L4) bandwidth — see
  // fetchGatewayNetworkAnalytics() for scope notes (no per-app/per-user attribution).
  gatewayBandwidthBytesSent: number;
  gatewayBandwidthBytesRecvd: number;
  // Real, from gatewayL4DownstreamSessionsAdaptiveGroups.sum.clientBytesRetransmitted
  // — a network-quality signal (high retransmission = poor connectivity).
  gatewayRetransmittedBytes: number;
  // Real CASB findings count from REST /data-security/posture/findings
  // (0 is an honest "no findings / no CASB integration configured", not a stub).
  casbFindingsCount: number;
  mcpServersCount?: number;
  mcpPortalsCount?: number;
  mcpServerLoginEvents?: number;

  // ── Dashboard analytics API additions (real; see cf-dashboard-analytics.ts) ─
  // `totalAuthEvents`/`blockedAuthEvents` above now source from
  // access-logins/summary when available (real interactive login attempts —
  // confirmed live that the GraphQL fallback counts WARP client session
  // events too, a 300x inflation on a real account). This field surfaces
  // that excluded noise rather than hiding it.
  warpAndServiceTokenLoginEvents?: number;
  // Gateway-wide unique users/devices (DNS analytics) — distinct from
  // `uniqueUsers`/`uniqueApps` above, which are Access-login-derived. A
  // real account can have far more Gateway (WARP/DNS) users than Access
  // app users (e.g. 1,734 vs ~300) since DNS filtering covers all WARP
  // client traffic, not just Access-gated applications.
  gatewayDnsUniqueUsers?: number;
  gatewayDnsUniqueDevices?: number;
  gatewayHttpUniqueUsers?: number;
  gatewayHttpUniqueApps?: number;
  gatewayHttpBandwidthBytes?: number;
  gatewayHttpUploadedBytes?: number;
  gatewayHttpDownloadedBytes?: number;
  // Real per-period DLP match count (HTTP inline DLP) — previously claimed
  // as "not exposed by any API" (true for GraphQL; false for this REST
  // analytics endpoint, confirmed live: 47.25M hits / 18.7M scans on a real
  // account with active DLP policies).
  gatewayHttpDlpMatchesTotal?: number;
  gatewayMcpDistinctUsers?: number;
  // Real account-wide L4 (Network) bandwidth from gateway-network/summary —
  // a different dataset/scope than gatewayBandwidthBytesSent/Recvd above
  // (gatewayL4DownstreamSessionsAdaptiveGroups), kept separate rather than
  // merged since the two are not directly additive.
  gatewayNetworkBandwidthBytes?: number;
  // Real total bytes from the Network Session Log (NSL) dataset, split by
  // egress path (WARP / Cloudflare Tunnel / Internet) elsewhere in this type.
  gatewayNslTotalBytes?: number;
  // Real-time CASB DLP finding count (REST /analytics/casb/findings/dlp) —
  // distinct from `casbFindingsCount` above (REST /data-security/posture/
  // findings, a configuration/posture-style finding list). Both are real;
  // they measure different things.
  casbDlpFindingsCount?: number;
  // Cloud Data Security (CDS) at-rest SaaS scan match total — distinct from
  // inline HTTP DLP above. 0 is an honest "not configured", not a stub.
  cdsScanMatchesTotal?: number;
}

export interface AccessApp {
  id: string;
  name: string;
  domain: string;
  type: string;        // "self_hosted" | "saas" | "ssh" | "vnc" | "app_launcher"
  sessionDuration: string;
  allowedIdps: string[];
  policyCount: number;
  enabled: boolean;
}

export interface AccessPolicy {
  id: string;
  appId: string;
  appName: string;
  name: string;
  decision: string;    // "allow" | "block" | "bypass" | "non_identity"
  requireMfa: boolean;
  precedence: number;
}

export interface AccessIdp {
  id: string;
  name: string;
  type: string;        // "google" | "saml" | "oidc" | "github" | "otp" | etc.
}

export interface GatewayPolicy {
  id: string;
  name: string;
  ruleType: "dns" | "http" | "l4";
  action: string;      // "block" | "allow" | "override" | "safesearch" | "l4override"
  enabled: boolean;
  filters?: string[];  // category names, domains, etc.
  expression?: string;
}

export interface GatewayLocation {
  id: string;
  name: string;
  dnsOverHttps: boolean;
  ipv4Destination?: string;
}

export interface WarpDevice {
  id: string;
  name: string;
  user: string;
  os: string;
  enrolledAt: string;
  lastSeen: string;
  postureStatus: "compliant" | "non_compliant" | "unknown";
}

export interface WarpPostureRule {
  id: string;
  name: string;
  type: string;   // "file" | "application" | "os_version" | "firewall" | etc.
  enabled: boolean;
}

export interface TunnelStatus {
  id: string;
  name: string;
  status: "healthy" | "degraded" | "down" | "inactive";
  createdAt: string;
  connections: number;
  routeCount: number;
}

export interface DlpProfile {
  id: string;
  name: string;
  type: "custom" | "predefined";
  matchCount: number;
}

export interface ZtDayBucket {
  date: string;
  allow: number;
  block: number;
  mfa: number;
}

export interface GatewayDayBucket {
  date: string;
  total: number;
  blocked: number;
}

export interface ZeroTrustData {
  meta: {
    accountId: string;
    accountName: string;
    since: string;
    until: string;
    generatedAt: string;
    days: number;
    periodLabel: string;
  };
  summary: ZeroTrustSummary;

  // Access
  accessApps: AccessApp[];
  accessPolicies: AccessPolicy[];
  accessIdps: AccessIdp[];
  accessAuthTimeSeries: ZtDayBucket[];
  accessTopApps: { name: string; requests: number }[];
  accessTopUsers: { email: string; requests: number; blocked: number }[];
  accessTopBlockedUsers: { email: string; count: number; country: string }[];
  accessGeoDistribution: { country: string; requests: number; blocked: number }[];
  accessTopSourceIps?: { ip: string; requests: number; blocked: number }[];
  accessAuthMethodBreakdown?: { method: "SSO" | "Direct Login"; count: number }[];
  accessAppTypeBreakdown?: { type: string; count: number }[];
  accessPolicyActionBreakdown?: { action: string; count: number }[];

  // Access analytics
  accessDailyActiveUsers: { date: string; uniqueUsers: number; logins: number }[];
  accessIdpBreakdown: { provider: string; count: number }[];
  accessAppBreakdown: {
    appId: string; successful: number; failed: number; total: number; failureRate: number;
  }[];
  accessFailedLoginDetails: {
    appId: string; country: string; identityProvider: string; count: number;
  }[];
  accessAnomalies: { severity: "critical" | "warning" | "info"; title: string; description: string }[];

  // Gateway DNS
  gatewayDnsTimeSeries: GatewayDayBucket[];
  gatewayDnsResolverBreakdown: { decision: string; count: number }[];
  gatewayDnsTopBlockedDomains: {
    domain: string; count: number; category: string;
    policyName: string; locationName: string;
  }[];
  gatewayDnsTopAllowedDomains: {
    domain: string; count: number; category: string;
    policyName: string; locationName: string;
  }[];
  gatewayDnsTopBlockedCategories: { category: string; count: number }[];

  // Gateway HTTP
  gatewayHttpTimeSeries: GatewayDayBucket[];
  gatewayHttpTopBlockedDomains: { domain: string; count: number }[];
  gatewayHttpTopAllowedDomains: { domain: string; count: number }[];
  gatewayHttpTopBlockedCategories: { category: string; count: number }[];
  // Real httpStatusCode dimension bucketed into 2xx/3xx/4xx/5xx/No Status.
  gatewayHttpStatusCodes: { bucket: string; count: number }[];

  // Gateway L4 / Network Session Analytics — mirrors Cloudflare's own
  // "Network session analytics" dashboard (session health + top colos) and
  // "Shadow IT: Private Network analytics" dashboard (private origins).
  gatewayL4TimeSeries: GatewayDayBucket[];
  gatewayL4BlockedDestinations: {
    ip: string; count: number; country: string;
    port: number | null; protocol: string; service: string;
  }[];
  gatewayL4Protocols: { protocol: string; count: number }[];
  gatewayL4SourceCountries: { country: string; count: number }[];
  gatewayL4PortBreakdown: { port: number; service: string; count: number }[];
  gatewayTransportStatusBreakdown: { status: string; count: number }[];
  gatewayTokenAuthStatusBreakdown: { status: string; count: number }[];
  gatewayTopColos: { colo: string; country: string; count: number }[];
  privateNetworkOrigins: { sourceIp: string; virtualNetwork: string; count: number }[];

  // Shadow IT
  // NOTE: `bytes` per-app was removed — live introspection confirmed the
  // HTTP Gateway dataset has no byte-sum aggregate at all, so this field was
  // always fabricated as 0 (or silently omitted) rather than a real measurement.
  shadowItApps: { name: string; category: string; count: number; status?: string }[];
  shadowItCategoryBreakdown: { category: string; count: number }[];
  shadowItUserMappings: { email: string; apps: string[]; totalRequests: number }[];

  // Generative AI / Shadow AI usage — real Cloudflare category classification
  // (category id 184 "Artificial Intelligence" on DNS + HTTP Gateway traffic),
  // not a keyword/app-name guess.
  aiAppUsage?: {
    apps: { name: string; category: string; count: number; status?: string }[];
    users: { email: string; count: number }[];
    totalRequests: number;
    uniqueApps: number;
    uniqueUsers: number;
    hasGovernancePolicy: boolean;
  };

  // Gateway config
  gatewayPolicies: GatewayPolicy[];
  gatewayLocations: GatewayLocation[];

  // WARP
  warpDevices: WarpDevice[];
  warpPostureRules: WarpPostureRule[];
  warpOsBreakdown: { os: string; count: number }[];
  // Real connection-status event breakdown/trend from warpDeviceAdaptiveGroups
  // (replaces the old warpConnectivityTimeSeries, which repeated a static
  // REST device-count flat across every day in the range).
  warpDeviceStatusBreakdown: { status: string; count: number; online: boolean }[];
  warpDeviceStatusTimeSeries: { date: string; connected: number; disconnected: number; other: number }[];

  // Tunnels
  tunnels: TunnelStatus[];
  tunnelRoutes: { network: string; tunnelId: string; tunnelName: string; comment?: string }[];

  // DLP — real configuration only (profile list). Per-period match counts/
  // top-matched-profile data have no real GraphQL or REST source (confirmed
  // via live introspection: no DLP dataset exists at all) and were removed
  // rather than left as an always-empty/always-zero stub.
  dlpProfiles: DlpProfile[];

  // CASB (Data Security Posture) — real, from REST /data-security/posture/findings.
  casbFindingsBySeverity: { severity: string; count: number }[];

  // Recent account-wide alerts (real, from REST /alerting/v3/history — not
  // Zero-Trust-specific, but useful operational context for a periodic report).
  recentAlerts: { id: string; name: string; alertType: string; sentAt: string; silenced: boolean }[];

  // Recommendations
  recommendations: { priority: "high" | "medium" | "low"; title: string; description: string; benefit: string }[];

  // ── Exact distinct Access counts (GraphQL, high-limit + dedupe) ──────────
  // `summary.uniqueUsers`/`uniqueApps` are derived from capped top-N lists
  // (15/10 items) for backward compatibility with existing consumers; these
  // fields are the more accurate distinct counts over a much larger sample.
  accessDistinctCounts?: { uniqueUsers: number; uniqueApps: number; sampleLimit: number };

  // ── Gateway HTTP — users responsible for the most blocked requests ────────
  // Real `email` dimension on gatewayL7RequestsAdaptiveGroups filtered to
  // action:block. No equivalent user dimension is confirmed available on
  // the DNS or L4 datasets, so this is HTTP-only — not fabricated for others.
  gatewayHttpTopBlockedUsers?: { email: string; count: number }[];

  // ── DLP quarantine trend (real; HTTP Gateway `quarantined:1` dimension) ───
  // Mirrors Cloudflare's own "DLP matches in HTTP requests over time" panel.
  gatewayDlpQuarantineTimeSeries?: { date: string; count: number }[];

  // ── CASB findings detail (real; REST already returns these fields, only
  // severity counts were previously surfaced) ──────────────────────────────
  casbFindingsDetail?: {
    id?: string; severity: string; type: string; resourceName: string; integrationId?: string;
  }[];

  // ── Configuration changes (real; REST /accounts/{id}/logs/audit filtered
  // to Zero-Trust-relevant products within the report window) ─────────────
  configChanges?: {
    id: string; time: string; actorEmail: string; actionType: string;
    description: string; product: string; result: string;
  }[];

  // ── DEX fleet status (real; REST /accounts/{id}/dex/fleet-status/live —
  // live device telemetry, up to 60 minutes back, NOT the report window) ──
  dexFleetStatus?: {
    uniqueDevicesTotal: number;
    byStatus: { value: string; count: number }[];
    byPlatform: { value: string; count: number }[];
    byMode: { value: string; count: number }[];
    byVersion: { value: string; count: number }[];
    byColo: { value: string; count: number }[];
  } | null;

  // ── Baseline / period-over-period comparison (persisted D1 snapshot) ─────
  baseline?: {
    previousGeneratedAt: string | null;
    previousDays: number | null;
    deltas: Record<string, { previous: number; current: number; changePct: number | null }>;
  } | null;

  // ── Data confidence notes surfaced per-section (time window, sampling
  // caps, or known unsupported metrics) so "0" is never confused with "not
  // measured". Keyed by an informal section id, not a strict enum. ─────────
  dataConfidence?: Record<string, string>;

  // ── Dashboard analytics API additions (real; see cf-dashboard-analytics.ts) ─
  // Access — dashboard-exact top interactive-login apps/users (excludes
  // WARP client session events, unlike the REST-log-derived accessTopApps/
  // accessTopUsers above, which are now also filtered but over a smaller
  // 1,000-row REST sample).
  accessLoginsTopApps?: { appId: string; appName: string; attemptsTotal: number }[];
  accessLoginsTopUsers?: { email: string; attemptsTotal: number }[];

  // Gateway HTTP — real top bandwidth consumers and top request countries
  // (no equivalent existed anywhere in this codebase before).
  gatewayHttpTopBandwidthUsers?: { email: string; bandwidthConsumedBytes: number }[];
  gatewayHttpTopCountries?: { country: string; requestsTotal: number }[];

  // Network Session Log (NSL) — real bandwidth split by egress path (WARP /
  // Cloudflare Tunnel / Internet) and top bandwidth consumers. A trust/
  // adoption signal (how much traffic is actually going through Zero Trust
  // egress paths vs. direct Internet) not available anywhere else.
  gatewayNslByOfframp?: { offramp: string; bytesTotal: number }[];
  gatewayNslTopUsers?: { email: string; bytesTotal: number }[];

  // Real per-period DLP match data (REST /analytics/gateway/proxy/http) —
  // replaces the prior "no per-period match counts are exposed by any API"
  // claim, confirmed live to be false for this specific endpoint.
  dlpActivitySummary?: { hitCount: number; scanCount: number; prevHitCount: number; prevScanCount: number };
  dlpProfileMatches?: { profileName: string; hitCount: number }[];
  dlpTopWebsites?: { host: string; hitCount: number }[];

  // ── Control Coverage & Effectiveness (real; derived from already-fetched
  // config + analytics data — no new external API calls) ───────────────────
  // Answers the SSE-competitor-standard question "coverage vs total", not
  // just "here is an event count": how much of the environment is actually
  // protected, and which configured controls saw zero real-world use this
  // period (a strong misconfiguration/waste signal on its own).
  controlCoverage?: {
    access: {
      totalApps: number;
      enabledApps: number;
      appsWithPolicies: number;
      appsWithoutPolicies: number;   // policyCount === 0 — likely misconfigured, unprotected app
      appsWithMfa: number;
      appsWithoutMfa: number;
      mfaCoveragePct: number;        // 0-100, of enabled apps
    };
    gatewayDns: {
      totalPolicies: number;
      enabledPolicies: number;
      blockPolicies: number;
      // Enabled DNS policies with 0 matched queries in the report period —
      // real, via the policyName dimension on gatewayResolverQueriesAdaptiveGroups
      // (same data source as the policy-annotation fix). HTTP/L4 have no
      // confirmed per-policy dimension, so this is DNS-only, not fabricated
      // for the other rule types.
      unusedPolicies: { name: string }[];
    };
    gatewayHttp: { totalPolicies: number; enabledPolicies: number };
    gatewayL4: { totalPolicies: number; enabledPolicies: number };
    seats: {
      total: number;
      activeInPeriod: number;
      neverLoggedIn: number;
      activePct: number;             // 0-100
    };
  };

  // ── Remediation Register (real; D1-backed lifecycle tracking of the same
  // evidence-based findings used for `recommendations`, keyed by a stable
  // `findingKey` so status/owner/age persist and auto-resolve across report
  // runs instead of being a fresh, unauditable list every time) ─────────────
  remediationRegister?: RemediationItem[];

  // ── CASB Finding Register (real; D1-backed lifecycle tracking of
  // individual REST /data-security/posture/findings entries, keyed by
  // Cloudflare's own finding id — same pattern as remediationRegister but
  // for per-finding SaaS exposure/DLP posture items instead of fixed
  // boolean conditions) ──────────────────────────────────────────────────
  casbFindingRegister?: CasbFindingItem[];

  // ── Alert Investigation Register (real; D1-backed investigation-status
  // tracking of REST /accounts/{id}/alerting/v3/history entries — this
  // dataset was previously fetched into `recentAlerts` but never rendered
  // anywhere in the report) ─────────────────────────────────────────────
  alertRegister?: AlertTrackingItem[];

  errors: Record<string, string>;
}

export type RemediationStatus = "open" | "in_progress" | "accepted_risk" | "resolved";

export interface RemediationItem {
  id: string;
  accountId: string;
  findingKey: string;
  title: string;
  description: string;
  benefit: string;
  severity: "high" | "medium" | "low";
  status: RemediationStatus;
  ownerEmail: string | null;
  dueDate: string | null;
  evidence: string;
  firstSeenAt: string;
  lastSeenAt: string;
  resolvedAt: string | null;
  occurrences: number;
  ageDays: number;   // computed at read-time from firstSeenAt to now (or resolvedAt if resolved)
}

export type CasbFindingStatus = "open" | "investigating" | "remediated" | "false_positive" | "accepted_risk";

export interface CasbFindingItem {
  id: string;
  accountId: string;
  findingId: string;
  severity: string;
  type: string;
  resourceName: string;
  integrationId: string | null;
  status: CasbFindingStatus;
  ownerEmail: string | null;
  dueDate: string | null;
  firstSeenAt: string;
  lastSeenAt: string;
  clearedAt: string | null;   // set when Cloudflare stops reporting this finding (auto-detected)
  occurrences: number;
  ageDays: number;
}

export type AlertTrackingStatus = "new" | "acknowledged" | "investigating" | "resolved";

export interface AlertTrackingItem {
  id: string;
  accountId: string;
  alertId: string;
  name: string;
  alertType: string;
  sentAt: string;
  silenced: boolean;
  status: AlertTrackingStatus;
  ownerEmail: string | null;
  dueDate: string | null;
  firstSeenAt: string;
  ageDays: number;
}

// ─── Time Helpers ─────────────────────────────────────────────────────────────
export interface TimeRange {
  since: string;   // ISO 8601
  until: string;   // ISO 8601
}

// ─── GraphQL Response Shapes ──────────────────────────────────────────────────
export interface GqlResponse<T> {
  data?: {
    viewer?: {
      zones?: Array<{ [key: string]: T }>;
    };
  };
  errors?: Array<{ message: string }>;
}

// ─── AppSec Data Model ────────────────────────────────────────────────────────

/** One day bucket for any time-series chart */
export interface DayBucket {
  date: string;   // "YYYY-MM-DD"
  value: number;
}

/** WAF: daily totals split by action */
export interface WafDayBucket {
  date: string;
  block: number;
  challenge: number;
  log: number;
  skip: number;
  managed_challenge: number;
}

/** Attack events grouped by rule / source / type */
export interface WafTopRule {
  ruleId: string;
  description: string;
  action: string;
  source: string;
  rulesetId: string;
  kind: string;
  count: number;
  ruleName?: string;
}

export interface WafAttackScoreRow {
  scoreClass: string;
  action: string;
  count: number;
}

export interface WafTopCountry {
  country: string;
  countryName: string;
  count: number;
}

export interface WafTopPath {
  path: string;
  count: number;
}

/** DDoS */
export interface DDoSEvent {
  date: string;
  mitigated: number;  // L7 DDoS mitigated requests via firewallEventsAdaptive
}

export interface DDoSAttackVector {
  vector: string;
  count: number;
}

/** Bot Management */
export interface BotScoreBucket {
  scoreRange: string;   // "1-29 (Bot)", "30-99 (Likely Bot)", "100 (Human)"
  requests: number;
  pct: number;
}

export interface BotDayBucket {
  date: string;
  bot: number;          // verified bot (score 1-29)
  likelyBot: number;    // likely bot (score 30-99) — also aliased as likelyBotRequests
  human: number;        // human (score 100) — also aliased as humanRequests
  botRequests?: number;
  likelyBotRequests?: number;
  humanRequests?: number;
}

/** Cache / CDN Performance */
export interface CacheDayBucket {
  date: string;
  hit: number;
  miss: number;
  expired: number;
  bypass: number;
  revalidated: number;
}

export interface CacheStatusBreakdown {
  status: string;
  requests: number;
  bytes: number;
  pct: number;
}

/** Bandwidth */
export interface BandwidthDayBucket {
  date: string;
  totalBytes: number;
  cachedBytes: number;
  uncachedBytes: number;
}

/** HTTP Errors */
export interface ErrorDayBucket {
  date: string;
  e1xx?: number;
  e2xx: number;
  e3xx: number;
  e4xx: number;
  e5xx: number;
}

/** SSL / TLS */
export interface TlsVersionBucket {
  version: string;
  requests: number;
  pct: number;
}

/** Certificates */
export interface CertificateInfo {
  id: string;
  hosts: string[];
  type: string;      // "universal" | "dedicated" | "custom" | "lets_encrypt"
  status: string;    // "active" | "pending_validation" | "expired"
  expiresOn: string; // ISO date
  daysUntilExpiry: number;
}

/** Rate Limiting */
export interface RateLimitRule {
  id: string;
  description: string;
  threshold: number;
  period: number;
  action: string;
  enabled: boolean;
  matchesCount?: number;
}

/** WAF Managed Rules */
export interface WafManagedRule {
  id: string;
  name: string;
  phase: string;
  enabled: boolean;
}

/** Custom WAF + Rate Limit Rules with full expression */
export interface CustomWafRule {
  id: string;
  description: string;
  action: string;
  enabled: boolean;
  expression: string;
  phase: string;
  rulesetName: string;
  ratelimit?: {
    characteristics?: string[];
    period?: number;
    requests_per_period?: number;
    mitigation_timeout?: number;
    counting_expression?: string;
  };
}

/** Top IPs */
export interface TopIpEntry {
  ip: string;
  requests: number;
  country: string;
  asn?: string;
}

/** Cost savings analysis */
export interface CostSavings {
  monthlyBandwidthSavings: number;  // USD (estimated)
  annualBandwidthSavings: number;   // USD (estimated)
  originBandwidthSavedGB: number;
  originRequestsAvoided: number;
  originLoadReductionPct: number;
}

/** Security recommendation */
export interface RuleTemplate {
  type: "waf_custom" | "rate_limit" | "bot" | "transform" | "config";
  name: string;
  expression?: string;   // Cloudflare Rules Language expression
  action?: string;
  description: string;
  cfDocs?: string;       // short docs path suffix e.g. "waf/custom-rules/"
}

export interface SecurityRecommendation {
  priority: "high" | "medium" | "low";
  title: string;
  description: string;
  benefit: string;
  ruleTemplate?: RuleTemplate;  // optional ready-to-use rule template
}

/** HTTP Request summary */
export interface RequestsSummary {
  totalRequests: number;
  // totalThreats: from httpRequests1dGroups.sum.threats — exact, same datasource as totalRequests.
  // Correct number to use for Sankey "Blocked" node. Prevents blocked > total situation.
  totalThreats: number;
  totalThreatsBlocked: number;
  uniqueVisitors: number;
  totalBandwidthBytes: number;
  cachedBandwidthBytes: number;
  cacheHitRatePct: number;
  cacheBandwidthHitRatePct: number;
  avgOriginResponseTimeMs: number;
  crawlerRequests: number;
  encryptedRequests: number;
  costSavings: CostSavings;
  /** Robust bot-score percentages — computed numerically server-side. */
  automatedPct: number;
  likelyAutomatedPct: number;
  humanPct: number;
  botTrafficPct: number;
}

// ─── Phase 1: Web Analytics & Geographic ──────────────────────────────────────

export interface CountryDataRow {
  clientCountryName: string;
  requests: number;
  bytes: number;
  threats: number;
}

export interface BrowserDataRow {
  uaBrowserFamily: string;
  requests: number;
  pct: number;
}

export interface DeviceDataRow {
  clientDeviceType: string;
  requests: number;
  pct: number;
}

export interface HttpMethodDataRow {
  method: string;
  requests: number;
  pct: number;
}

export interface HttpStatusSummaryData {
  e1xx: number;
  e2xx: number;
  e3xx: number;
  e4xx: number;
  e5xx: number;
  total: number;
}

// ─── Phase 2: Performance Metrics ─────────────────────────────────────────────

export interface TtfbDayBucket {
  date: string;
  avg: number;    // ms — average edge TTFB (zone-level; true percentiles not available)
  p50: number;    // ms — alias for avg
  p75: number;    // ms — alias for avg
  p99: number;    // ms — alias for avg
}

export interface EdgeColoBucket {
  coloCode: string;
  requests: number;
  bytes: number;
}

// ─── Phase 3: Security Intelligence ───────────────────────────────────────────

export interface ThreatIpData {
  ip: string;
  country: string;
  action: string;
  count: number;
}

export interface ThreatAsnData {
  asn: number;
  asnName: string;
  count: number;
}

export interface UserAgentData {
  userAgent: string;
  count: number;
  category: "browser" | "bot" | "scanner" | "unknown";
}

// ─── Phase 4: Content Analysis ────────────────────────────────────────────────

export interface ContentTypeData {
  edgeResponseContentTypeName: string;
  requests: number;
  bytes: number;
  cachedBytes: number;
  cacheHitPct: number;
}

// ─── Phase 5: Traffic Sources ─────────────────────────────────────────────────

export interface ReferrerData {
  refererHost: string;
  requests: number;
  category: "direct" | "search" | "social" | "referral";
}

// ─── DNS Summary ──────────────────────────────────────────────────────────────

export interface DnsRecordSummaryData {
  totalRecords: number;
  proxiedCount: number;
  dnsOnlyCount: number;
  byType: { type: string; count: number }[];
}

export interface DnsQueryTypeData {
  queryType: string;
  responseCode: string;
  count: number;
  p50Us: number;
  p95Us: number;
  p99Us: number;
}

export interface DnsQueryDayData {
  date: string;
  count: number;
  p50Us: number;
  p95Us: number;
}

// ─── Assembled AppSec Report ──────────────────────────────────────────────────
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export interface AppSecData extends Record<string, any> {
  meta: {
    zoneName: string;
    zoneId: string;
    accountId: string;
    since: string;
    until: string;
    generatedAt: string;
    days: number;        // actual selected period length in days
    periodLabel: string; // e.g. "7-Day", "30-Day", "August 2026", "Sep 1-15, 2026"
    /** Set when the chosen range is older than some upstream datasets
     *  (see the report's per-section errors / dataConfidence) — explains
     *  why some sections may be empty so it never reads as a bug. */
    rangeNote?: string;
  };

  summary: RequestsSummary;

  // Time-series (30 days daily)
  requestsTimeSeries: DayBucket[];
  wafTimeSeries: WafDayBucket[];
  bandwidthTimeSeries: BandwidthDayBucket[];
  cacheTimeSeries: CacheDayBucket[];
  errorTimeSeries: ErrorDayBucket[];
  botTimeSeries: BotDayBucket[];
  ddosTimeSeries: DDoSEvent[];

  // Breakdowns (pie/bar)
  wafTopRules: WafTopRule[];
  wafAttackScoreBreakdown: WafAttackScoreRow[];
  wafTopCountries: WafTopCountry[];
  wafTopPaths: WafTopPath[];
  botScoreBreakdown: BotScoreBucket[];
  cacheStatusBreakdown: CacheStatusBreakdown[];
  tlsVersionBreakdown: TlsVersionBucket[];
  ddosAttackVectors: DDoSAttackVector[];

  // ── Post-Quantum Cryptography (PQC) Readiness ──
  // clientTLSKeyExchangeGroup breakdown; hybrid PQC groups (X25519MLKEM768,
  // X25519Kyber768Draft00) combine classical ECDH with a quantum-resistant KEM.
  tlsKeyExchangeBreakdown: { group: string; requests: number; pct: number; isPqc: boolean; isUnknown: boolean }[];
  pqcAdoptionPct: number;
  pqcApplicableCoveragePct: number;

  // Config / posture
  certificates: CertificateInfo[];
  rateLimitRules: RateLimitRule[];
  wafManagedRules: WafManagedRule[];
  customWafRules: CustomWafRule[];

  // ── Phase 1: Web Analytics & Geographic ──
  countryDistribution: CountryDataRow[];
  browserBreakdown: BrowserDataRow[];
  deviceBreakdown: DeviceDataRow[];
  httpMethodBreakdown: HttpMethodDataRow[];
  httpStatusSummary: HttpStatusSummaryData;

  // ── Phase 2: Performance ──
  ttfbTimeSeries: TtfbDayBucket[];
  edgeColoDistribution: EdgeColoBucket[];

  // ── Phase 3: Security Intelligence ──
  topThreatIps: ThreatIpData[];
  topThreatAsns: ThreatAsnData[];
  topUserAgents: UserAgentData[];

  // ── Phase 4: Content Analysis ──
  contentTypeBreakdown: ContentTypeData[];

  // ── Phase 5: Traffic Sources ──
  topReferrers: ReferrerData[];
  /** Accurate direct/search/social/referral totals computed across a much
   *  larger sample than `topReferrers` — see REFERRER_AGGREGATE_LIMIT in
   *  cf-graphql.ts. Use this for category summaries; do NOT re-derive
   *  category totals by summing `topReferrers` (that under-counts). */
  referrerCategoryTotals: { direct: number; search: number; social: number; referral: number };

  // ── Dashboard Analytics Parity ──
  sourceBrowsers: { browser: string; requests: number }[];
  sourceOs: { os: string; requests: number }[];
  ja3Fingerprints: { hash: string; requests: number }[];
  ja4Fingerprints: { hash: string; requests: number }[];
  sourceAsns: { asn: number; asnName: string; requests: number }[];
  // New: matches GetZoneTopNs — top client IPs and X-Requested-With header breakdown
  topClientIps: { ip: string; requests: number; bytes: number }[];
  topXRequestedWith: { header: string; requests: number }[];
  // New: hourly sparklines (requestSource=eyeball), matches ZapSparklineBydatetimeHour
  dashboardSparklines: { ts: string; requests: number; bytes: number; visits: number }[];

  // ── DNS Records enriched with ASN/provider info ──
  dnsRecordsEnriched: Array<{
    id: string; name: string; type: string; content: string;
    proxied: boolean; ttl: number;
    asn?: number; asnHolder?: string; provider?: string;
    providerCategory?: string; providerColor?: string;
  }>;

  // ── DNS Summary ──
  dnsRecordSummary: DnsRecordSummaryData;
  dnsQueryTypeBreakdown: DnsQueryTypeData[];
  dnsQueryTimeSeries: DnsQueryDayData[];
  dnsTopHostnames: { hostname: string; queryType: string; count: number }[];
  topHttpHostnames: { hostname: string; requests: number; bytes: number }[];

  // ── Email Security ──
  emailSecurity: {
    domain: string;
    spfRecord: string;
    spfPolicy: string;
    spfIncludes: string[];
    dmarcRecord: string;
    dmarcPolicy: string;
    dmarcSubdomainPolicy: string;
    dmarcPct: number;
    dmarcRua: string[];
    dmarcRuf: string[];
    dmarcAlignment: { adkim: string; aspf: string };
    dkimSelectors: Array<{ selector: string; record: string; valid: boolean }>;
    mxRecords: Array<{ priority: number; exchange: string }>;
    usingCloudflareEmailSecurity: boolean;
    grade: "A" | "B" | "C" | "D" | "F";
    issues: string[];
  } | null;

  // ── Enterprise POC Intelligence ──
  wafScoreAllTraffic: { scoreClass: string; count: number }[];
  securityEventsByService: { source: string; action: string; count: number }[];
  verifiedBotCategories: { category: string; count: number }[];

  // ── WAF Attack Intelligence (from cf-reporting) ──
  wafAttackClassification: { category: string; count: number; sources: string[]; classifiedBy: "cloudflare-tag" | "heuristic" }[];
  wafRuleEffectiveness: {
    ruleId: string; description: string;
    totalHits: number; blocks: number; challenges: number; logs: number; blockRate: number;
  }[];

  // ── DNS NXDOMAIN Hotspots ──
  nxdomainHotspots: { name: string; count: number }[];

  // ── API Shield & API Traffic ──
  apiTrafficSeries: { date: string; requests: number; bytes: number }[];
  apiTopPaths: { host: string; path: string; requests: number; bytes: number }[];
  apiMethods: { method: string; requests: number }[];
  apiStatus: { status: number; requests: number }[];
  apiOperations: {
    operation_id: string; method: string; host: string; endpoint: string; last_updated: string;
    features?: {
      thresholds?: { requests?: number; suggested_threshold?: number; p50?: number; p90?: number; p99?: number; data_points?: number; auth_id_tokens?: number; period_seconds?: number; last_updated?: string };
      schema_info?: { active_schema?: { id: string; name: string } | null; mitigation_action?: "none" | "log" | "block" };
    };
  }[];
  apiSchemas: { schema_id: string; name: string; kind: string; created_at: string; validation_enabled: boolean }[];
  apiJwtConfigs: { id: string; title: string; description?: string; token_type: string; token_sources: string[] }[];

  // ── API Shield — Endpoint Labeling Service ──
  apiRiskLabels: { label: string; operationCount: number; requests: number }[];
  apiUseCaseLabels: { label: string; operationCount: number; requests: number }[];
  apiZombieEndpoints: { operationId: string; method: string; endpoint: string; host: string; lastUpdated: string; requestsTotal: number }[];
  apiZombieEndpointsTotalCount: number;
  apiRiskyEndpoints: { operationId: string; method: string; endpoint: string; host: string; labels: string[] }[];
  apiOperationsTotalCount: number;
  discoveryPendingReviewCount: number;

  // ── Suspicious Activity (Security Analytics parity) ──
  accountTakeover: {
    totalRequests: number;
    topPaths: { host: string; path: string; requests: number }[];
  };
  wafPerVectorScore: {
    scoredCount: number;
    avgSqliScore: number | null;
    avgXssScore: number | null;
    avgRceScore: number | null;
    avgPathTraversalScore: number | null;
  };
  leakedCredentialCheck: {
    enabled: boolean;
    customDetections: number;
    totalChecked: number;
    breachedCount: number;
    byResult: { result: string; count: number }[];
  };
  contentScanning: {
    enabled: boolean;
    totalScannedRequests: number;
    requestsWithMaliciousObject: number;
    scanFailedCount: number;
    objResultsBreakdown: { result: string; count: number }[];
  };
  aiSecurityForApps: {
    enabled: boolean;
    customTopics: { label: string; topic: string }[];
    logModeDeployed: boolean;
    scannedCount: number;
    piiDetectedCount: number;
    piiCategoryBreakdown: { category: string; count: number }[];
    unsafeTopicDetectedCount: number;
    unsafeTopicCategoryBreakdown: { category: string; count: number }[];
    injectionScoreBands: { high: number; moderate: number; low: number };
    avgInjectionScore: number | null;
  };
  sensitiveDataDetectionDeployed: boolean;
  legacyExposedCredentialsDeployed: boolean;

  // Enhanced zone settings (parsed from /settings bulk endpoint)
  zoneSettings: Record<string, unknown>;
  // Page Shield
  pageShieldEnabled: boolean;
  pageShieldScripts: {
    id: string; url: string; host: string; status: string;
    js_integrity_score?: number; malware_score?: number;
    first_seen_at: string; last_seen_at: string;
  }[];

  // Errors / unavailable sections
  errors: Record<string, string>;
}
