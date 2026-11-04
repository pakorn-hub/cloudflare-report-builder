// ─── Shared types (mirrors apps/api/src/types.ts) ────────────────────────────
// Keep in sync with backend types manually — no shared package needed.

export interface DayBucket { date: string; value: number }
export interface WafDayBucket extends Record<string, unknown> { date: string; block: number; challenge: number; log: number; skip: number; managed_challenge: number }
export interface BotDayBucket { date: string; botRequests: number; likelyBotRequests: number; humanRequests: number }
export interface CacheDayBucket { date: string; hit: number; miss: number; expired: number; bypass: number; revalidated: number }
export interface BandwidthDayBucket { date: string; totalBytes: number; cachedBytes: number; uncachedBytes: number }
export interface ErrorDayBucket { date: string; e2xx: number; e3xx: number; e4xx: number; e5xx: number }
export interface DDoSEvent { date: string; mitigated: number }

export interface WafAttackScoreRow {
  scoreClass: string;
  action: string;
  count: number;
}

export interface WafTopRule {
  ruleId: string;
  description: string;
  ruleName: string | null;
  action: string;
  source: string;
  rulesetId: string;
  kind: string;
  count: number;
}
export interface WafTopCountry { country: string; countryName: string; count: number }
export interface WafTopPath { host: string; path: string; url: string; count: number }
export interface BotScoreBucket { scoreRange: string; requests: number; pct: number }
export interface CacheStatusBreakdown { status: string; requests: number; bytes: number; pct: number }
export interface TlsVersionBucket { version: string; requests: number; pct: number }
export interface DDoSAttackVector { vector: string; count: number }

export interface CertificateInfo {
  id: string; hosts: string[]; type: string; status: string;
  expiresOn: string; daysUntilExpiry: number;
}
export interface RateLimitRule { id: string; description: string; threshold: number; period: number; action: string; enabled: boolean }
export interface WafManagedRule { id: string; name: string; phase: string; enabled: boolean }
export interface CustomWafRule {
  id: string; description: string; action: string; enabled: boolean; expression: string; phase: string; rulesetName: string;
  ratelimit?: { characteristics?: string[]; period?: number; requests_per_period?: number; mitigation_timeout?: number; counting_expression?: string };
}

export interface AwsServiceCost {
  label: string;
  category: "security" | "cdn" | "dns";
  baseFee: number;
  perRequestFee?: number;
  dataTransferFee?: number;
  ruleEvalFee?: number;
  total: number;
  note: string;
  what: string;
  cfNote?: string;  // what Cloudflare charges for equivalent
}

// Monthly usage inputs for the cost calculator
export interface CostCalcInputs {
  monthlyRequestsM: number;   // millions of HTTP requests/month
  monthlyBandwidthGB: number; // GB of data transfer/month
  monthlyDnsQueriesM: number; // millions of DNS queries/month
}

export interface CostSavings {
  // CDN / bandwidth savings
  monthlyBandwidthSavings: number;
  annualBandwidthSavings: number;
  originBandwidthSavedGB: number;
  originRequestsAvoided: number;
  originLoadReductionPct: number;
  // AWS security cost comparison
  awsCosts?: {
    dns: AwsServiceCost;
    cdn: AwsServiceCost;
    waf: AwsServiceCost;
    ddos: AwsServiceCost;
    botManagement: AwsServiceCost;
  };
  awsTotalMonthly?: number;
  awsTotalAnnual?: number;
  awsSecurityTotal?: number;
  awsCdnTotal?: number;
  awsDnsTotal?: number;
  cfSavingsVsAws?: number;
  cfSavingsVsAwsAnnual?: number;
  monthlyRequestsM?: number;
}

export interface RuleTemplate {
  type: "waf_custom" | "rate_limit" | "bot" | "transform" | "config";
  name: string;
  expression?: string;
  action?: string;
  description: string;
  cfDocs?: string;
}

export interface SecurityRecommendation {
  priority: "high" | "medium" | "low";
  title: string;
  description: string;
  benefit: string;
  ruleTemplate?: RuleTemplate;
}

export interface RequestsSummary {
  totalRequests: number;
  // totalThreats: from httpRequests1dGroups.sum.threats — same exact datasource as totalRequests.
  // Use this for Sankey "Blocked" node to keep denominator consistent with totalRequests.
  totalThreats: number;
  totalThreatsBlocked: number; uniqueVisitors: number;
  totalBandwidthBytes: number; cachedBandwidthBytes: number;
  cacheHitRatePct: number; cacheBandwidthHitRatePct: number;
  avgOriginResponseTimeMs: number; crawlerRequests: number; encryptedRequests: number;
  costSavings: CostSavings;
  /** Robust bot-score percentages — computed numerically server-side, use
   *  these instead of string-matching botScoreBreakdown[].scoreRange. */
  automatedPct?: number;
  likelyAutomatedPct?: number;
  humanPct?: number;
  botTrafficPct?: number;
}

// ─── Phase 1: Web Analytics & Geographic ─────────────────────────────────────

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

// ─── Phase 2: Performance Metrics ────────────────────────────────────────────

export interface TtfbDayBucket {
  date: string;
  avg: number;    // average edge TTFB (zone-level; true percentiles not available)
  p50: number;    // alias for avg
  p75: number;    // alias for avg
  p99: number;    // alias for avg
}

export interface EdgeColoBucket {
  coloCode: string;
  requests: number;
  bytes: number;
}

// ─── Phase 3: Security Intelligence ──────────────────────────────────────────

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

export interface AppSecData {
  meta: { zoneName: string; zoneId: string; accountId: string; since: string; until: string; generatedAt: string; days: number; periodLabel: string; rangeNote?: string };
  summary: RequestsSummary;
  requestsTimeSeries: DayBucket[];
  wafTimeSeries: WafDayBucket[];
  bandwidthTimeSeries: BandwidthDayBucket[];
  cacheTimeSeries: CacheDayBucket[];
  errorTimeSeries: ErrorDayBucket[];
  botTimeSeries: BotDayBucket[];
  ddosTimeSeries: DDoSEvent[];
  wafTopRules: WafTopRule[];
  wafAttackScoreBreakdown?: WafAttackScoreRow[];
  wafTopCountries: WafTopCountry[];
  wafTopPaths: WafTopPath[];
  botScoreBreakdown: BotScoreBucket[];
  cacheStatusBreakdown: CacheStatusBreakdown[];
  tlsVersionBreakdown: TlsVersionBucket[];
  ddosAttackVectors: DDoSAttackVector[];

  // Post-Quantum Cryptography (PQC) Readiness — clientTLSKeyExchangeGroup
  // breakdown; hybrid PQC groups (X25519MLKEM768, X25519Kyber768Draft00)
  // combine classical ECDH with a quantum-resistant KEM.
  tlsKeyExchangeBreakdown?: { group: string; requests: number; pct: number; isPqc: boolean; isUnknown: boolean }[];
  pqcAdoptionPct?: number;
  pqcApplicableCoveragePct?: number;

  certificates: CertificateInfo[];
  rateLimitRules: RateLimitRule[];
  wafManagedRules: WafManagedRule[];
  customWafRules: CustomWafRule[];
  httpProtocolBreakdown?: { protocol: string; requests: number }[];
  botManagementConfig?: unknown;
  securityLevel?: string | null;
  tlsMinVersion?: string | null;
  tls13Enabled?: boolean;
  alwaysHttps?: boolean;
  sslMode?: string | null;
  cacheLevel?: string | null;
  apiShieldEnabled?: boolean;
  cipherSuites?: string[];
  recommendations?: SecurityRecommendation[];
  // Phase 1
  countryDistribution?: CountryDataRow[];
  browserBreakdown?: BrowserDataRow[];
  deviceBreakdown?: DeviceDataRow[];
  httpMethodBreakdown?: HttpMethodDataRow[];
  httpStatusSummary?: HttpStatusSummaryData;
  // Phase 2
  ttfbTimeSeries?: TtfbDayBucket[];
  edgeColoDistribution?: EdgeColoBucket[];
  // Phase 3
  topThreatIps?: ThreatIpData[];
  topThreatAsns?: ThreatAsnData[];
  topUserAgents?: UserAgentData[];
  // Phase 4
  contentTypeBreakdown?: ContentTypeData[];
  // Phase 5
  topReferrers?: ReferrerData[];
  /** Accurate direct/search/social/referral totals computed over a much
   *  larger sample than `topReferrers` — use this for category summaries. */
  referrerCategoryTotals?: { direct: number; search: number; social: number; referral: number };
  // DNS enriched records
  dnsRecordsEnriched?: Array<{
    id: string; name: string; type: string; content: string;
    proxied: boolean; ttl: number;
    asn?: number; asnHolder?: string; provider?: string;
    providerCategory?: string; providerColor?: string;
  }>;
  // DNS
  dnsRecordSummary?: DnsRecordSummaryData;
  dnsQueryTypeBreakdown?: DnsQueryTypeData[];
  dnsQueryTimeSeries?: DnsQueryDayData[];
  dnsTopHostnames?: { hostname: string; queryType: string; count: number }[];
  topHttpHostnames?: { hostname: string; requests: number; bytes: number }[];
  // Email Security
  emailSecurity?: {
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
  // Dashboard Analytics Parity
  sourceBrowsers?: { browser: string; requests: number }[];
  sourceOs?: { os: string; requests: number }[];
  ja3Fingerprints?: { hash: string; requests: number }[];
  ja4Fingerprints?: { hash: string; requests: number }[];
  sourceAsns?: { asn: number; asnName: string; requests: number }[];
  // New: matches GetZoneTopNs — top client IPs and X-Requested-With header breakdown
  topClientIps?: { ip: string; requests: number; bytes: number }[];
  topXRequestedWith?: { header: string; requests: number }[];
  // New: hourly sparklines (requestSource=eyeball), matches ZapSparklineBydatetimeHour
  dashboardSparklines?: { ts: string; requests: number; bytes: number; visits: number }[];
  // Enterprise POC Intelligence
  wafScoreAllTraffic?: { scoreClass: string; count: number }[];
  securityEventsByService?: { source: string; action: string; count: number }[];
  verifiedBotCategories?: { category: string; count: number }[];
  wafAttackClassification?: { category: string; count: number; sources: string[]; classifiedBy: "cloudflare-tag" | "heuristic" }[];
  wafRuleEffectiveness?: { ruleId: string; description: string; totalHits: number; blocks: number; challenges: number; logs: number; blockRate: number }[];
  nxdomainHotspots?: { name: string; count: number }[];

  // ── Suspicious Activity (Security Analytics parity) ──
  accountTakeover?: {
    totalRequests: number;
    topPaths: { host: string; path: string; requests: number }[];
  };
  wafPerVectorScore?: {
    scoredCount: number;
    avgSqliScore: number | null;
    avgXssScore: number | null;
    avgRceScore: number | null;
    avgPathTraversalScore: number | null;
  };
  leakedCredentialCheck?: {
    enabled: boolean;
    customDetections: number;
    totalChecked: number;
    breachedCount: number;
    byResult: { result: string; count: number }[];
  };
  contentScanning?: {
    enabled: boolean;
    totalScannedRequests: number;
    requestsWithMaliciousObject: number;
    scanFailedCount: number;
    objResultsBreakdown: { result: string; count: number }[];
  };
  aiSecurityForApps?: {
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
  sensitiveDataDetectionDeployed?: boolean;
  legacyExposedCredentialsDeployed?: boolean;

  // ── API Shield & API Traffic ──
  apiTrafficSeries?: { date: string; requests: number; bytes: number }[];
  apiTopPaths?: { host: string; path: string; requests: number; bytes: number }[];
  apiMethods?: { method: string; requests: number }[];
  apiStatus?: { status: number; requests: number }[];
  apiOperations?: {
    operation_id: string; method: string; host: string; endpoint: string; last_updated: string;
    features?: {
      thresholds?: { requests?: number; suggested_threshold?: number; p50?: number; p90?: number; p99?: number; data_points?: number; auth_id_tokens?: number; period_seconds?: number; last_updated?: string };
      schema_info?: { active_schema?: { id: string; name: string } | null; mitigation_action?: "none" | "log" | "block" };
    };
  }[];
  apiSchemas?: { schema_id: string; name: string; kind: string; created_at: string; validation_enabled: boolean }[];
  apiJwtConfigs?: { id: string; title: string; description?: string; token_type: string; token_sources: string[] }[];

  // ── API Shield — Endpoint Labeling Service ──
  // Risk labels (auto-applied by Cloudflare's daily scans): cf-risk-zombie
  // (no traffic 32+ days), cf-risk-missing-auth / cf-risk-mixed-auth (broken
  // auth), cf-risk-bola-enumeration / cf-risk-bola-pollution (BOLA), etc.
  // Use-case labels (customer-applied): cf-log-in, cf-sign-up, cf-purchase, etc.
  // Requires an active Enterprise API Shield subscription — empty otherwise.
  apiRiskLabels?: { label: string; operationCount: number; requests: number }[];
  apiUseCaseLabels?: { label: string; operationCount: number; requests: number }[];
  apiZombieEndpoints?: { operationId: string; method: string; endpoint: string; host: string; lastUpdated: string; requestsTotal: number }[];
  apiZombieEndpointsTotalCount?: number;
  apiRiskyEndpoints?: { operationId: string; method: string; endpoint: string; host: string; labels: string[] }[];
  apiOperationsTotalCount?: number;
  discoveryPendingReviewCount?: number;

  // AI Crawl Control Analytics — Generative AI bot/crawler traffic visibility
  // Detection method mirrors Cloudflare's AI Crawl Control GraphQL API
  // (user-agent based matching — works on all plans).
  aiCrawlerTimeSeries?: { date: string; requests: number }[];
  aiCrawlerBots?: { botName: string; operator: string; category: string; requests: number; bytes: number }[];
  aiCrawlerSummary?: {
    totalRequests: number;
    totalBandwidthBytes: number;
    pctOfTotal: number;
    uniqueBots: number;
    topBot: string | null;
    allowedRequests: number;
    blockedRequests: number;
    paymentRequiredRequests: number;
    otherErrorRequests: number;
    categoryBreakdown: { category: string; requests: number }[];
  };
  aiCrawlerStatusBreakdown?: { status: number; requests: number }[];
  aiCrawlerTopPaths?: { host: string; path: string; requests: number }[];
  aiReferralTraffic?: { date: string; operator: string; requests: number }[];
  zoneSettings?: Record<string, unknown>;
  pageShieldEnabled?: boolean;
  pageShieldScripts?: {
    id: string; url: string; host: string; status: string;
    js_integrity_score?: number; malware_score?: number;
    first_seen_at: string; last_seen_at: string;
  }[];
  errors: Record<string, string>;
}

export interface ReportInput {
  token: string;
  zoneId: string;       // required for appsec; empty string for zero-trust
  accountId: string;
  days?: number;
  tzOffset?: number;
  // "calendar_month" reports the previous FULL calendar month (its real
  // 28-31 days) instead of a fixed rolling window ending now — `days` is
  // ignored by the backend in that mode. Defaults to "rolling".
  rangeMode?: ReportRangeMode;
  // "custom" mode: explicit local dates for the report period.
  sinceDate?: string;   // YYYY-MM-DD (first day, inclusive)
  untilDate?: string;   // YYYY-MM-DD (last day, inclusive; may be today)
  // Optional intra-day bounds, HH:MM local (24h). Defaults: 00:00 / 23:59.
  sinceTime?: string;
  untilTime?: string;
  // "calendar_month" mode: which month to report — 1 = last month (default),
  // 2 = the month before that, etc. (1..12).
  monthsAgo?: number;
  period?: ReportPeriod;
  product?: "appsec" | "zero-trust" | "magic-transit";  // defaults to "appsec"
  // Optional branding (not sent to API)
  clientName?: string;
  partnerName?: string;
  clientLogo?: string;  // base64 data URL
  // Report framing (not sent to API — controls rendering only).
  // true (default) = "POC" framing: recommendations, cost/sizing calculator,
  // and "Proof-of-Concept"/"POC" wording are shown.
  // false = neutral assessment framing: those sections/wording are hidden.
  isPoc?: boolean;
}

export interface ZoneOption {
  id: string;
  name: string;
  status: string;
  plan: string;
}

// ─── Zero Trust Data Model ────────────────────────────────────────────────────

export interface ZeroTrustSummary {
  totalAuthEvents: number; authSuccessRate: number; uniqueUsers: number;
  uniqueApps: number; blockedAuthEvents: number; mfaChallenges: number;
  gatewayDnsQueries: number; gatewayDnsBlocked: number;
  gatewayHttpRequests: number; gatewayHttpBlocked: number; httpRbiSessions: number;
  httpQuarantinedRequests: number; gatewayMcpHttpRequests: number;
  gatewayL4Sessions: number; gatewayL4Blocked: number;
  shadowItAppsDiscovered: number;
  warpEnrolledDevices: number;
  warpOnlineDevices: number; warpOfflineDevices: number;
  tunnelsHealthy: number; tunnelsTotal: number;
  seatsTotal: number; seatsAccessTotal: number; seatsGatewayTotal: number;
  seatsActiveInPeriod: number; seatsNeverLoggedIn: number;
  gatewayBandwidthBytesSent: number; gatewayBandwidthBytesRecvd: number;
  gatewayRetransmittedBytes: number;
  casbFindingsCount: number;
  mcpServersCount?: number; mcpPortalsCount?: number; mcpServerLoginEvents?: number;

  // ── Dashboard analytics API additions (real; dashboard-exact numbers) ────
  warpAndServiceTokenLoginEvents?: number;
  gatewayDnsUniqueUsers?: number;
  gatewayDnsUniqueDevices?: number;
  gatewayHttpUniqueUsers?: number;
  gatewayHttpUniqueApps?: number;
  gatewayHttpBandwidthBytes?: number;
  gatewayHttpUploadedBytes?: number;
  gatewayHttpDownloadedBytes?: number;
  gatewayHttpDlpMatchesTotal?: number;
  gatewayMcpDistinctUsers?: number;
  gatewayNetworkBandwidthBytes?: number;
  gatewayNslTotalBytes?: number;
  casbDlpFindingsCount?: number;
  cdsScanMatchesTotal?: number;
}

export interface AccessApp { id: string; name: string; domain: string; type: string; sessionDuration: string; allowedIdps: string[]; policyCount: number; enabled: boolean }
export interface AccessPolicy { id: string; appId: string; appName: string; name: string; decision: string; requireMfa: boolean; precedence: number }
export interface AccessIdp { id: string; name: string; type: string }
export interface GatewayPolicy { id: string; name: string; ruleType: "dns" | "http" | "l4"; action: string; enabled: boolean; filters?: string[]; expression?: string }
export interface GatewayLocation { id: string; name: string; dnsOverHttps: boolean; ipv4Destination?: string }
export interface WarpDevice { id: string; name: string; user: string; os: string; enrolledAt: string; lastSeen: string; postureStatus: "compliant" | "non_compliant" | "unknown" }
export interface WarpPostureRule { id: string; name: string; type: string; enabled: boolean }
export interface TunnelStatus { id: string; name: string; status: "healthy" | "degraded" | "down" | "inactive"; createdAt: string; connections: number; routeCount: number }
export interface DlpProfile { id: string; name: string; type: "custom" | "predefined"; matchCount: number }
export interface ZtDayBucket { date: string; allow: number; block: number; mfa: number }
export interface GatewayDayBucket { date: string; total: number; blocked: number }

export interface ZeroTrustData {
  meta: { accountId: string; accountName: string; since: string; until: string; generatedAt: string; days: number; periodLabel: string };
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
  accessDailyActiveUsers: { date: string; uniqueUsers: number; logins: number }[];
  accessIdpBreakdown: { provider: string; count: number }[];
  accessAppBreakdown: { appId: string; successful: number; failed: number; total: number; failureRate: number }[];
  accessFailedLoginDetails: { appId: string; country: string; identityProvider: string; count: number }[];
  accessAnomalies: { severity: "critical" | "warning" | "info"; title: string; description: string }[];
  // Gateway DNS
  gatewayDnsTimeSeries: GatewayDayBucket[];
  gatewayDnsResolverBreakdown: { decision: string; count: number }[];
  gatewayDnsTopBlockedDomains: { domain: string; count: number; category: string; policyName: string; locationName: string }[];
  gatewayDnsTopAllowedDomains: { domain: string; count: number; category: string; policyName: string; locationName: string }[];
  gatewayDnsTopBlockedCategories: { category: string; count: number }[];
  // Gateway HTTP
  gatewayHttpTimeSeries: GatewayDayBucket[];
  gatewayHttpTopBlockedDomains: { domain: string; count: number }[];
  gatewayHttpTopAllowedDomains: { domain: string; count: number }[];
  gatewayHttpTopBlockedCategories: { category: string; count: number }[];
  gatewayHttpStatusCodes: { bucket: string; count: number }[];
  // Gateway L4 / Network Session Analytics
  gatewayL4TimeSeries: GatewayDayBucket[];
  gatewayL4BlockedDestinations: { ip: string; count: number; country: string; port: number | null; protocol: string; service: string }[];
  gatewayL4Protocols: { protocol: string; count: number }[];
  gatewayL4SourceCountries: { country: string; count: number }[];
  gatewayL4PortBreakdown: { port: number; service: string; count: number }[];
  gatewayTransportStatusBreakdown: { status: string; count: number }[];
  gatewayTokenAuthStatusBreakdown: { status: string; count: number }[];
  gatewayTopColos: { colo: string; country: string; count: number }[];
  privateNetworkOrigins: { sourceIp: string; virtualNetwork: string; count: number }[];
  // Shadow IT
  shadowItApps: { name: string; category: string; count: number; status?: string }[];
  shadowItCategoryBreakdown: { category: string; count: number }[];
  shadowItUserMappings: { email: string; apps: string[]; totalRequests: number }[];
  // Generative AI / Shadow AI usage — real Cloudflare category classification
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
  warpDeviceStatusBreakdown: { status: string; count: number; online: boolean }[];
  warpDeviceStatusTimeSeries: { date: string; connected: number; disconnected: number; other: number }[];
  // Tunnels
  tunnels: TunnelStatus[];
  tunnelRoutes: { network: string; tunnelId: string; tunnelName: string; comment?: string }[];
  // DLP / CASB
  dlpProfiles: DlpProfile[];
  casbFindingsBySeverity: { severity: string; count: number }[];
  casbFindingsDetail?: {
    id?: string; severity: string; type: string; resourceName: string; integrationId?: string;
  }[];
  recentAlerts: { id: string; name: string; alertType: string; sentAt: string; silenced: boolean }[];
  recommendations: { priority: "high" | "medium" | "low"; title: string; description: string; benefit: string }[];

  // ── Data-quality / new-perspective additions ──────────────────────────────
  accessDistinctCounts?: { uniqueUsers: number; uniqueApps: number; sampleLimit: number };
  gatewayHttpTopBlockedUsers?: { email: string; count: number }[];
  gatewayDlpQuarantineTimeSeries?: { date: string; count: number }[];
  configChanges?: {
    id: string; time: string; actorEmail: string; actionType: string;
    description: string; product: string; result: string;
  }[];
  dexFleetStatus?: {
    uniqueDevicesTotal: number;
    byStatus: { value: string; count: number }[];
    byPlatform: { value: string; count: number }[];
    byMode: { value: string; count: number }[];
    byVersion: { value: string; count: number }[];
    byColo: { value: string; count: number }[];
  } | null;
  baseline?: {
    previousGeneratedAt: string | null;
    previousDays: number | null;
    deltas: Record<string, { previous: number; current: number; changePct: number | null }>;
  } | null;
  dataConfidence?: Record<string, string>;

  // ── Dashboard analytics API additions (real; see cf-dashboard-analytics.ts) ─
  accessLoginsTopApps?: { appId: string; appName: string; attemptsTotal: number }[];
  accessLoginsTopUsers?: { email: string; attemptsTotal: number }[];
  gatewayHttpTopBandwidthUsers?: { email: string; bandwidthConsumedBytes: number }[];
  gatewayHttpTopCountries?: { country: string; requestsTotal: number }[];
  gatewayNslByOfframp?: { offramp: string; bytesTotal: number }[];
  gatewayNslTopUsers?: { email: string; bytesTotal: number }[];
  dlpActivitySummary?: { hitCount: number; scanCount: number; prevHitCount: number; prevScanCount: number };
  dlpProfileMatches?: { profileName: string; hitCount: number }[];
  dlpTopWebsites?: { host: string; hitCount: number }[];

  // ── Control Coverage & Effectiveness (real; derived from already-fetched
  // config + analytics data) ────────────────────────────────────────────────
  controlCoverage?: {
    access: {
      totalApps: number;
      enabledApps: number;
      appsWithPolicies: number;
      appsWithoutPolicies: number;
      appsWithMfa: number;
      appsWithoutMfa: number;
      mfaCoveragePct: number;
    };
    gatewayDns: {
      totalPolicies: number;
      enabledPolicies: number;
      blockPolicies: number;
      unusedPolicies: { name: string }[];
    };
    gatewayHttp: { totalPolicies: number; enabledPolicies: number };
    gatewayL4: { totalPolicies: number; enabledPolicies: number };
    seats: { total: number; activeInPeriod: number; neverLoggedIn: number; activePct: number };
  };

  // ── Remediation Register (real; D1-backed lifecycle tracking) ────────────
  remediationRegister?: RemediationItem[];

  // ── CASB Finding Register (real; D1-backed lifecycle tracking) ───────────
  casbFindingRegister?: CasbFindingItem[];

  // ── Alert Investigation Register (real; D1-backed tracking of native
  // Cloudflare alerting history) ────────────────────────────────────────
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
  ageDays: number;
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
  clearedAt: string | null;
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

// ─── Scheduled Reports ────────────────────────────────────────────────────────

export type ScheduleFrequency = "daily" | "weekly" | "monthly";
export type ScheduleReportType = "appsec" | "zero-trust" | "magic-transit" | "custom-dashboard";
// "rolling" = fixed N-day window ending now (existing behavior).
// "calendar_month" = the previous full calendar month (28-31 days,
// whichever the month actually has) — fixes monthly-frequency schedules
// silently drifting off true month boundaries when using days=30.
export type ReportRangeMode = "rolling" | "calendar_month" | "custom" | "period";

/** Period mode: the last COMPLETE period, computed at run time in the
 *  schedule's timezone — yesterday / previous Mon–Sun week / previous month. */
export type ReportPeriod = "yesterday" | "last_week" | "last_month";

export interface ScheduleConfig {
  dashboardTemplate?: import("../../../shared/custom-dashboard-template").DashboardTemplate | null;
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
  /** Period mode choice (null in other modes). */
  period: string | null;
  /** Client branding logo (base64 data URI) rendered on the report cover. */
  clientLogo: string | null;
  /** True when this schedule carries its own API token (value never returned). */
  apiTokenSet: boolean;
  /** Masked hint ("••••••••xxxx") when a per-schedule token is stored. */
  apiTokenHint: string | null;
  /** Per-schedule customer account ID (null = use the backend account). */
  accountId: string | null;
}

/** Payload for create/update — everything the dashboard configures. */
export interface ScheduleInput {
  dashboardTemplate?: import("../../../shared/custom-dashboard-template").DashboardTemplate | null;
  name: string;
  reportType: ScheduleReportType;
  zoneId: string | null;
  zoneName: string | null;
  days: number;
  tzOffset: number;
  rangeMode: ReportRangeMode;
  sinceDate?: string | null;
  untilDate?: string | null;
  sinceTime?: string | null;
  untilTime?: string | null;
  monthsAgo?: number | null;
  /** rangeMode "period": yesterday | last_week | last_month. */
  period?: ReportPeriod | null;
  /** Client branding logo (data URI). null clears. */
  clientLogo?: string | null;
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
  /** Set/replace the schedule's own token. undefined = keep stored (update);
   *  null = clear back to backend credentials; string = the customer token. */
  apiToken?: string | null;
  /** Per-schedule customer account ID (null = use the backend account). */
  accountId?: string | null;
}

export interface ScheduleHistoryEntry {
  id: string;
  scheduleId: string;
  startedAt: string;
  finishedAt: string | null;
  status: string;
  trigger: string;
  error: string | null;
  messageId: string | null;
}

// ─── Backend Settings ─────────────────────────────────────────────────────────

export type SettingSource = "d1" | "secret" | "env" | "none" | "default";

/** Masked view of the backend config — the token value is never included. */
export interface BackendSettingsState {
  tokenSet: boolean;
  tokenSource: SettingSource;
  tokenHint: string | null;
  accountId: string | null;
  accountSource: SettingSource;
  emailFrom: string;
  emailSource: SettingSource;
}

/** Update payload — omitted = unchanged, null = cleared (env fallback). */
export interface BackendSettingsUpdate {
  cfApiToken?: string | null;
  cfAccountId?: string | null;
  emailFrom?: string | null;
}
