import type { AppSecData, ZeroTrustData } from "../apps/web/src/types.ts";
import { fixture as magicTransitFixture } from "../tests/magic-transit/fixture.ts";

/** Public examples are invented from scratch, never copied from live responses. */
export const DEMO_ACCOUNT = "00000000000000000000000000000000";
export const DEMO_GENERATED_AT = "2026-09-08T08:00:00.000Z";
const dates = Array.from({ length: 7 }, (_, i) => `2026-09-0${i + 1}`);
const sum = (values: number[]) => values.reduce((a, b) => a + b, 0);
const split = (total: number, shares: number[]) => {
  const values = shares.map(s => Math.round(total * s));
  values[values.length - 1] += total - sum(values);
  return values;
};

export function appsecExample(): AppSecData {
  const requests = [180000, 210000, 205000, 248000, 225000, 260000, 272000];
  const total = sum(requests), blocked = total * 0.02, bytes = total * 4000;
  const distribution = (names: string[], shares: number[]) => names.map((name, i) => ({ name, requests: split(total, shares)[i], pct: shares[i] * 100 }));
  const countries = ["US", "DE", "JP", "SG", "TH", "GB"].map((clientCountryName, i) => {
    const count = split(total, [0.34, 0.22, 0.16, 0.12, 0.09, 0.07])[i];
    return { clientCountryName, requests: count, bytes: count * 4000, threats: Math.round(count * 0.02) };
  });
  return {
    meta: { zoneName: "app.example.com", zoneId: DEMO_ACCOUNT, accountId: DEMO_ACCOUNT, since: dates[0], until: dates[6], generatedAt: DEMO_GENERATED_AT, days: 7, periodLabel: "7-Day Synthetic Example", rangeNote: "All values are invented for this demonstration." },
    summary: { totalRequests: total, totalThreats: blocked, totalThreatsBlocked: blocked, uniqueVisitors: 48000, totalBandwidthBytes: bytes, cachedBandwidthBytes: bytes * 0.72, cacheHitRatePct: 72, cacheBandwidthHitRatePct: 72, avgOriginResponseTimeMs: 180, crawlerRequests: total * 0.1, encryptedRequests: total, automatedPct: 15, likelyAutomatedPct: 10, humanPct: 75, botTrafficPct: 25, costSavings: { monthlyBandwidthSavings: 0, annualBandwidthSavings: 0, originBandwidthSavedGB: bytes * 0.72 / 1e9, originRequestsAvoided: total * 0.72, originLoadReductionPct: 72 } },
    requestsTimeSeries: dates.map((date, i) => ({ date, value: requests[i] })),
    wafTimeSeries: dates.map((date, i) => ({ date, block: requests[i] * 0.02, challenge: requests[i] * 0.008, managed_challenge: requests[i] * 0.006, log: requests[i] * 0.004, skip: requests[i] * 0.01 })),
    bandwidthTimeSeries: dates.map((date, i) => ({ date, totalBytes: requests[i] * 4000, cachedBytes: requests[i] * 4000 * 0.72, uncachedBytes: requests[i] * 4000 * 0.28 })),
    cacheTimeSeries: dates.map((date, i) => ({ date, hit: requests[i] * 0.72, miss: requests[i] * 0.2, expired: requests[i] * 0.03, bypass: requests[i] * 0.04, revalidated: requests[i] * 0.01 })),
    errorTimeSeries: dates.map((date, i) => ({ date, e2xx: requests[i] * 0.97, e3xx: requests[i] * 0.02, e4xx: requests[i] * 0.008, e5xx: requests[i] * 0.002 })),
    botTimeSeries: dates.map((date, i) => ({ date, botRequests: requests[i] * 0.15, likelyBotRequests: requests[i] * 0.1, humanRequests: requests[i] * 0.75 })),
    ddosTimeSeries: dates.map((date, i) => ({ date, mitigated: requests[i] * 0.004 })),
    wafTopRules: [{ ruleId: "demo-rule-sqli", description: "Synthetic SQL injection example", ruleName: "Example SQLi rule", action: "block", source: "firewallManaged", rulesetId: "demo-managed-ruleset", kind: "managed", count: blocked * 0.6 }, { ruleId: "demo-rule-path", description: "Synthetic sensitive-path example", ruleName: "Example path rule", action: "block", source: "firewallCustom", rulesetId: "demo-custom-ruleset", kind: "custom", count: blocked * 0.4 }],
    wafAttackScoreBreakdown: [{ scoreClass: "attack", action: "block", count: blocked }, { scoreClass: "likely_attack", action: "managed_challenge", count: total * 0.006 }],
    wafTopCountries: countries.map(r => ({ country: r.clientCountryName, countryName: r.clientCountryName, count: r.threats })),
    wafTopPaths: [{ host: "app.example.com", path: "/login", url: "https://app.example.com/login", count: blocked * 0.7 }, { host: "app.example.com", path: "/api/search", url: "https://app.example.com/api/search", count: blocked * 0.3 }],
    botScoreBreakdown: [{ scoreRange: "Automated (Score 1)", requests: total * 0.15, pct: 15 }, { scoreRange: "Likely Automated (Score 2–29)", requests: total * 0.1, pct: 10 }, { scoreRange: "Human (Score 30–99)", requests: total * 0.75, pct: 75 }],
    cacheStatusBreakdown: ["hit", "miss", "expired", "bypass", "revalidated"].map((status, i) => ({ status, requests: split(total, [0.72, 0.2, 0.03, 0.04, 0.01])[i], bytes: split(bytes, [0.72, 0.2, 0.03, 0.04, 0.01])[i], pct: [72, 20, 3, 4, 1][i] })),
    tlsVersionBreakdown: [{ version: "TLSv1.3", requests: total * 0.85, pct: 85 }, { version: "TLSv1.2", requests: total * 0.15, pct: 15 }],
    ddosAttackVectors: [{ vector: "Synthetic HTTP flood", count: total * 0.004 }],
    certificates: [{ id: "demo-certificate", hosts: ["app.example.com"], type: "universal", status: "active", expiresOn: "2027-09-01T00:00:00Z", daysUntilExpiry: 358 }],
    rateLimitRules: [{ id: "demo-rate-limit", description: "Example login limit", threshold: 100, period: 60, action: "managed_challenge", enabled: true }],
    wafManagedRules: [{ id: "demo-managed-ruleset", name: "Example managed rules", phase: "http_request_firewall_managed", enabled: true }],
    customWafRules: [{ id: "demo-rule-path", description: "Example sensitive paths — synthetic configuration", expression: "http.request.uri.path eq \"/admin\"", action: "block", enabled: true, phase: "http_request_firewall_custom", rulesetName: "Example custom rules" }],
    httpProtocolBreakdown: [{ protocol: "HTTP/2", requests: total * 0.6 }, { protocol: "HTTP/3", requests: total * 0.3 }, { protocol: "HTTP/1.1", requests: total * 0.1 }],
    countryDistribution: countries,
    browserBreakdown: distribution(["Chrome", "Safari", "Firefox", "Edge"], [0.5, 0.3, 0.15, 0.05]).map(r => ({ uaBrowserFamily: r.name, requests: r.requests, pct: r.pct })),
    deviceBreakdown: distribution(["desktop", "mobile", "tablet"], [0.58, 0.38, 0.04]).map(r => ({ clientDeviceType: r.name, requests: r.requests, pct: r.pct })),
    httpMethodBreakdown: distribution(["GET", "POST", "HEAD"], [0.78, 0.2, 0.02]).map(r => ({ method: r.name, requests: r.requests, pct: r.pct })),
    httpStatusSummary: { e1xx: 0, e2xx: total * 0.97, e3xx: total * 0.02, e4xx: total * 0.008, e5xx: total * 0.002, total },
    ttfbTimeSeries: dates.map((date, i) => ({ date, avg: 85 + i * 4, p50: 85 + i * 4, p75: 85 + i * 4, p99: 85 + i * 4 })),
    edgeColoDistribution: ["SIN", "FRA", "IAD"].map((coloCode, i) => ({ coloCode, requests: split(total, [0.4, 0.35, 0.25])[i], bytes: split(bytes, [0.4, 0.35, 0.25])[i] })),
    topThreatIps: [{ ip: "192.0.2.10", country: "US", action: "block", count: 5400 }, { ip: "198.51.100.20", country: "DE", action: "managed_challenge", count: 3200 }],
    topThreatAsns: [{ asn: 64500, asnName: "Example documentation ASN", count: 5400 }, { asn: 64501, asnName: "Another example ASN", count: 3200 }],
    topUserAgents: [{ userAgent: "ExampleBrowser/1.0", count: total * 0.75, category: "browser" }, { userAgent: "ExampleCrawler/1.0", count: total * 0.1, category: "bot" }],
    contentTypeBreakdown: [{ edgeResponseContentTypeName: "text/html", requests: total * 0.5, bytes: bytes * 0.3, cachedBytes: bytes * 0.2, cacheHitPct: 66.7 }, { edgeResponseContentTypeName: "image/webp", requests: total * 0.3, bytes: bytes * 0.5, cachedBytes: bytes * 0.45, cacheHitPct: 90 }, { edgeResponseContentTypeName: "application/json", requests: total * 0.2, bytes: bytes * 0.2, cachedBytes: bytes * 0.07, cacheHitPct: 35 }],
    topReferrers: [{ refererHost: "(direct)", requests: total * 0.65, category: "direct" }, { refererHost: "search.example.com", requests: total * 0.25, category: "search" }, { refererHost: "partner.example.com", requests: total * 0.1, category: "referral" }],
    referrerCategoryTotals: { direct: total * 0.65, search: total * 0.25, social: 0, referral: total * 0.1 },
    dnsRecordsEnriched: [{ id: "demo-dns-app", name: "app.example.com", type: "A", content: "203.0.113.10", proxied: true, ttl: 1, asn: 64500, provider: "Example hosting", providerColor: "#078dad" }, { id: "demo-dns-api", name: "api.example.com", type: "CNAME", content: "app.example.com", proxied: true, ttl: 1 }, { id: "demo-dns-mail", name: "example.com", type: "MX", content: "mail.example.com", proxied: false, ttl: 3600 }],
    dnsRecordSummary: { totalRecords: 3, proxiedCount: 2, dnsOnlyCount: 1, byType: [{ type: "A", count: 1 }, { type: "CNAME", count: 1 }, { type: "MX", count: 1 }] },
    dnsQueryTypeBreakdown: [{ queryType: "A", responseCode: "NOERROR", count: 280000, p50Us: 700, p95Us: 1400, p99Us: 2100 }, { queryType: "AAAA", responseCode: "NOERROR", count: 70000, p50Us: 800, p95Us: 1600, p99Us: 2200 }],
    dnsQueryTimeSeries: dates.map((date, i) => ({ date, count: 50000, p50Us: 700 + i * 10, p95Us: 1400 + i * 20 })),
    dnsTopHostnames: [{ hostname: "app.example.com", queryType: "A", count: 280000 }, { hostname: "api.example.com", queryType: "AAAA", count: 70000 }],
    topHttpHostnames: [{ hostname: "app.example.com", requests: total * 0.8, bytes: bytes * 0.8 }, { hostname: "api.example.com", requests: total * 0.2, bytes: bytes * 0.2 }],
    securityLevel: "medium", tlsMinVersion: "1.2", tls13Enabled: true, alwaysHttps: true, sslMode: "strict", cacheLevel: "aggressive", apiShieldEnabled: true, pageShieldEnabled: false,
    tlsKeyExchangeBreakdown: [{ group: "X25519MLKEM768", requests: total * 0.6, pct: 60, isPqc: true, isUnknown: false }, { group: "X25519", requests: total * 0.35, pct: 35, isPqc: false, isUnknown: false }, { group: "unknown", requests: total * 0.05, pct: 5, isPqc: false, isUnknown: true }], pqcAdoptionPct: 60 / 95 * 100, pqcApplicableCoveragePct: 95,
    apiTrafficSeries: dates.map((date, i) => ({ date, requests: requests[i] * 0.2, bytes: requests[i] * 800 })),
    apiTopPaths: [{ host: "api.example.com", path: "/v1/catalog", requests: total * 0.2, bytes: bytes * 0.2 }], apiMethods: [{ method: "GET", requests: total * 0.2 }], apiStatus: [{ status: 200, requests: total * 0.2 }],
    zoneSettings: { ssl: "strict", min_tls_version: "1.2", tls_1_3: "on", always_use_https: "on", http2: "on", http3: "on", brotli: "on", cache_level: "aggressive" },
    recommendations: [{ priority: "medium", title: "Illustrative API review", description: "Synthetic recommendation for demonstrating the report layout.", benefit: "Example only; not an assessment of an actual deployment." }],
    errors: {},
  };
}

export function zeroTrustExample(): ZeroTrustData {
  const auth = [1500, 1700, 1600, 1800, 1900, 2200, 2300], total = sum(auth);
  const dns = dates.map((date, i) => ({ date, total: 170000 + i * 12500, blocked: (170000 + i * 12500) * 0.02 }));
  const http = dates.map((date, i) => ({ date, total: 25000 + i * 1200, blocked: (25000 + i * 1200) * 0.015 }));
  const l4 = dates.map((date, i) => ({ date, total: 8000 + i * 500, blocked: (8000 + i * 500) * 0.01 }));
  const apps = ["Team Portal", "Source Repository", "Operations Console"].map((name, i) => ({ id: `demo-app-${i}`, name, domain: ["portal.example.com", "code.example.com", "ops.example.com"][i], type: "self_hosted", sessionDuration: "24h", allowedIdps: ["demo-idp"], policyCount: 1, enabled: true }));
  const policies = apps.map(a => ({ id: `demo-policy-${a.id}`, appId: a.id, appName: a.name, name: "Example employee policy", decision: "allow", requireMfa: true, precedence: 1 }));
  const devices = Array.from({ length: 12 }, (_, i) => ({ id: `demo-device-${i}`, name: `Example device ${i + 1}`, user: `user${i + 1}@example.com`, os: ["Windows", "macOS", "Linux"][i % 3], enrolledAt: "2026-08-01T00:00:00Z", lastSeen: i < 10 ? DEMO_GENERATED_AT : "2026-09-05T00:00:00Z", postureStatus: i < 9 ? "compliant" as const : i < 11 ? "non_compliant" as const : "unknown" as const }));
  return {
    meta: { accountId: DEMO_ACCOUNT, accountName: "ExampleCo — Synthetic Demo", since: dates[0], until: dates[6], generatedAt: DEMO_GENERATED_AT, days: 7, periodLabel: "7-Day Synthetic Example" },
    summary: { totalAuthEvents: total, authSuccessRate: 98, uniqueUsers: 250, uniqueApps: 3, blockedAuthEvents: total * 0.015, mfaChallenges: total * 0.005, gatewayDnsQueries: sum(dns.map(p => p.total)), gatewayDnsBlocked: sum(dns.map(p => p.blocked)), gatewayHttpRequests: sum(http.map(p => p.total)), gatewayHttpBlocked: sum(http.map(p => p.blocked)), httpRbiSessions: 320, httpQuarantinedRequests: 24, gatewayMcpHttpRequests: 0, gatewayL4Sessions: sum(l4.map(p => p.total)), gatewayL4Blocked: sum(l4.map(p => p.blocked)), shadowItAppsDiscovered: 3, warpEnrolledDevices: 12, warpOnlineDevices: 10, warpOfflineDevices: 2, tunnelsHealthy: 1, tunnelsTotal: 2, seatsTotal: 300, seatsAccessTotal: 300, seatsGatewayTotal: 300, seatsActiveInPeriod: 250, seatsNeverLoggedIn: 50, gatewayBandwidthBytesSent: 4200000000, gatewayBandwidthBytesRecvd: 12500000000, gatewayRetransmittedBytes: 50000000, casbFindingsCount: 6, gatewayDnsUniqueUsers: 250, gatewayHttpUniqueUsers: 220, gatewayHttpBandwidthBytes: 8500000000, gatewayHttpUploadedBytes: 1800000000, gatewayHttpDownloadedBytes: 6700000000, gatewayHttpDlpMatchesTotal: 24, gatewayNslTotalBytes: 16700000000 },
    accessApps: apps, accessPolicies: policies, accessIdps: [{ id: "demo-idp", name: "Example Identity Provider", type: "saml" }],
    accessAuthTimeSeries: dates.map((date, i) => ({ date, allow: auth[i] * 0.98, block: auth[i] * 0.015, mfa: auth[i] * 0.005 })),
    accessTopApps: apps.map((a, i) => ({ name: a.name, requests: split(total, [0.5, 0.3, 0.2])[i] })),
    accessTopUsers: ["user1@example.com", "user2@example.com", "user3@example.com"].map((email, i) => ({ email, requests: [4200, 3300, 1800][i], blocked: [60, 35, 15][i] })),
    accessTopBlockedUsers: [{ email: "user4@example.com", count: 85, country: "US" }],
    accessGeoDistribution: ["US", "DE", "JP", "SG"].map((country, i) => ({ country, requests: split(total, [0.4, 0.3, 0.2, 0.1])[i], blocked: split(total * 0.015, [0.4, 0.3, 0.2, 0.1])[i] })),
    accessDailyActiveUsers: dates.map((date, i) => ({ date, uniqueUsers: 180 + i * 10, logins: auth[i] })),
    accessIdpBreakdown: [{ provider: "Example Identity Provider", count: total }],
    accessAppBreakdown: apps.map((a, i) => { const n = split(total, [0.5, 0.3, 0.2])[i], failed = split(total * 0.015, [0.5, 0.3, 0.2])[i]; return { appId: a.id, successful: n - failed, failed, total: n, failureRate: failed / n * 100 }; }),
    accessFailedLoginDetails: [{ appId: "demo-app-0", country: "US", identityProvider: "Example Identity Provider", count: 78 }],
    accessAnomalies: [{ severity: "info", title: "Illustrative sign-in observation", description: "Invented example for demonstrating the evidence layout." }],
    accessAuthMethodBreakdown: [{ method: "SSO", count: total }], accessAppTypeBreakdown: [{ type: "self_hosted", count: 3 }], accessPolicyActionBreakdown: [{ action: "Allow", count: 3 }],
    gatewayDnsTimeSeries: dns, gatewayDnsResolverBreakdown: [{ decision: "allow", count: sum(dns.map(p => p.total - p.blocked)) }, { decision: "block", count: sum(dns.map(p => p.blocked)) }],
    gatewayDnsTopBlockedDomains: [{ domain: "phishing.example.com", count: 19000, category: "Phishing", policyName: "Example phishing protection", locationName: "Example office" }, { domain: "malware.example.com", count: 10050, category: "Malware", policyName: "Example malware protection", locationName: "Example office" }],
    gatewayDnsTopAllowedDomains: [{ domain: "portal.example.com", count: 650000, category: "Business", policyName: "Example default allow", locationName: "Example office" }], gatewayDnsTopBlockedCategories: [{ category: "Phishing", count: 19000 }, { category: "Malware", count: 10050 }],
    gatewayHttpTimeSeries: http, gatewayHttpTopBlockedDomains: [{ domain: "blocked.example.com", count: sum(http.map(p => p.blocked)) }], gatewayHttpTopAllowedDomains: [{ domain: "code.example.com", count: 87000 }, { domain: "portal.example.com", count: 82000 }], gatewayHttpTopBlockedCategories: [{ category: "Malware", count: sum(http.map(p => p.blocked)) }], gatewayHttpStatusCodes: [{ bucket: "2xx", count: 193000 }, { bucket: "3xx", count: 4500 }, { bucket: "4xx", count: 2000 }, { bucket: "5xx", count: 700 }],
    gatewayL4TimeSeries: l4, gatewayL4BlockedDestinations: [{ ip: "198.51.100.10", count: 665, country: "US", port: 22, protocol: "TCP", service: "SSH" }], gatewayL4Protocols: [{ protocol: "TCP", count: 50000 }, { protocol: "UDP", count: 16500 }], gatewayL4SourceCountries: [{ country: "US", count: 40000 }, { country: "DE", count: 26500 }], gatewayL4PortBreakdown: [{ port: 443, service: "HTTPS", count: 50000 }, { port: 53, service: "DNS", count: 16500 }], gatewayTransportStatusBreakdown: [{ status: "connected", count: 65835 }, { status: "blocked", count: 665 }], gatewayTokenAuthStatusBreakdown: [{ status: "valid", count: 66500 }], gatewayTopColos: [{ colo: "SIN", country: "SG", count: 40000 }, { colo: "FRA", country: "DE", count: 26500 }], privateNetworkOrigins: [{ sourceIp: "192.0.2.40", virtualNetwork: "Example private network", count: 18000 }],
    gatewayNslByOfframp: [{ offramp: "Cloudflare Tunnel", bytesTotal: 10000000000 }, { offramp: "Internet", bytesTotal: 6700000000 }], gatewayNslTopUsers: [{ email: "user1@example.com", bytesTotal: 5400000000 }, { email: "user2@example.com", bytesTotal: 3600000000 }],
    shadowItApps: [{ name: "Example Collaboration", category: "Collaboration", count: 50000 }, { name: "Example Storage", category: "Storage", count: 30000 }, { name: "Example AI Assistant", category: "Generative AI", count: 500 }], shadowItCategoryBreakdown: [{ category: "Collaboration", count: 50000 }, { category: "Storage", count: 30000 }, { category: "Generative AI", count: 500 }], shadowItUserMappings: [{ email: "user1@example.com", apps: ["Example Collaboration", "Example Storage"], totalRequests: 25000 }],
    aiAppUsage: { apps: [{ name: "Example AI Assistant", category: "Generative AI", count: 500 }], users: [{ email: "user1@example.com", count: 500 }], totalRequests: 500, uniqueApps: 1, uniqueUsers: 1, hasGovernancePolicy: true },
    gatewayPolicies: [{ id: "demo-dns-phishing", name: "Example phishing protection", ruleType: "dns", action: "block", enabled: true }, { id: "demo-dns-malware", name: "Example malware protection", ruleType: "dns", action: "block", enabled: true }, { id: "demo-http", name: "Example HTTP protection", ruleType: "http", action: "block", enabled: true }, { id: "demo-l4", name: "Example network policy", ruleType: "l4", action: "block", enabled: true }], gatewayLocations: [{ id: "demo-office", name: "Example office", dnsOverHttps: true, ipv4Destination: "192.0.2.53" }],
    warpDevices: devices, warpPostureRules: [{ id: "demo-posture", name: "Example disk encryption check", type: "disk_encryption", enabled: true }], warpOsBreakdown: ["Windows", "macOS", "Linux"].map(os => ({ os, count: 4 })), warpDeviceStatusBreakdown: [{ status: "connected", count: 10, online: true }, { status: "disconnected", count: 2, online: false }], warpDeviceStatusTimeSeries: dates.map(date => ({ date, connected: 10, disconnected: 2, other: 0 })),
    tunnels: [{ id: "demo-tunnel-1", name: "Example primary tunnel", status: "healthy", createdAt: "2026-08-01T00:00:00Z", connections: 2, routeCount: 1 }, { id: "demo-tunnel-2", name: "Example secondary tunnel", status: "degraded", createdAt: "2026-08-01T00:00:00Z", connections: 1, routeCount: 1 }], tunnelRoutes: [{ network: "10.0.0.0/24", tunnelId: "demo-tunnel-1", tunnelName: "Example primary tunnel", comment: "Synthetic private route" }, { network: "10.1.0.0/24", tunnelId: "demo-tunnel-2", tunnelName: "Example secondary tunnel", comment: "Synthetic private route" }],
    dlpProfiles: [{ id: "demo-dlp", name: "Example sensitive-data profile", type: "custom", matchCount: 24 }], casbFindingsBySeverity: [{ severity: "high", count: 1 }, { severity: "medium", count: 2 }, { severity: "low", count: 3 }], recentAlerts: [{ id: "demo-alert", name: "Example posture notification", alertType: "device_posture", sentAt: DEMO_GENERATED_AT, silenced: false }],
    dlpActivitySummary: { hitCount: 24, scanCount: 2800, prevHitCount: 30, prevScanCount: 2600 }, dlpProfileMatches: [{ profileName: "Example sensitive-data profile", hitCount: 24 }], dlpTopWebsites: [{ host: "upload.example.com", hitCount: 24 }],
    controlCoverage: { access: { totalApps: 3, enabledApps: 3, appsWithPolicies: 3, appsWithoutPolicies: 0, appsWithMfa: 3, appsWithoutMfa: 0, mfaCoveragePct: 100 }, gatewayDns: { totalPolicies: 2, enabledPolicies: 2, blockPolicies: 2, unusedPolicies: [] }, gatewayHttp: { totalPolicies: 1, enabledPolicies: 1 }, gatewayL4: { totalPolicies: 1, enabledPolicies: 1 }, seats: { total: 300, activeInPeriod: 250, neverLoggedIn: 50, activePct: 250 / 300 * 100 } },
    recommendations: [{ priority: "medium", title: "Illustrative device review", description: "Synthetic recommendation for demonstrating the report layout.", benefit: "Example only; not an assessment of an actual deployment." }], errors: {},
  };
}

export function magicTransitExample() {
  const data = magicTransitFixture();
  data.meta.accountName = "ExampleCo — Synthetic Demo";
  data.meta.sinceTs = "2026-09-01T00:00:00.000Z";
  data.meta.untilTs = "2026-09-01T23:59:59.999Z";
  data.meta.tzOffset = 0; data.meta.bucketSeconds = 300;
  data.meta.periodLabel = "1-Day Synthetic Example";
  data.health = Array.from({ length: 288 }, (_, i) => data.tunnels.map((t, j) => ({ timestamp: new Date(Date.parse(data.meta.sinceTs) + i * 300000).toISOString(), tunnel: t.name, ok: j === 1 && i >= 108 && i < 120 ? 35 : 99, timeout: j === 1 && i >= 108 && i < 120 ? 65 : 1, other: 0, state: j === 1 && i >= 108 && i < 120 ? 0.5 : 1, stateSamples: 100 }))).flat();
  const checks = data.health.reduce((s, p) => s + p.ok + p.timeout + p.other, 0);
  data.summary.probeSuccessPct = data.health.reduce((s, p) => s + p.ok, 0) / checks * 100;
  // Traffic fixtures are hourly, so keep their documented native duration.
  // Expand them to five-minute rows, conserving volume and hourly-average rates.
  data.traffic = data.traffic.flatMap(p => Array.from({ length: 12 }, (_, i) => ({ ...p, timestamp: new Date(Date.parse(p.timestamp) + i * 300000).toISOString(), bits: p.bits / 12, packets: p.packets / 12 })));
  data.tunnelTraffic = data.tunnelTraffic.flatMap(p => Array.from({ length: 12 }, (_, i) => ({ ...p, timestamp: new Date(Date.parse(p.timestamp) + i * 300000).toISOString(), bits: p.bits / 12, packets: p.packets / 12 })));
  const trafficTotal = { bits: sum(data.traffic.map(p => p.bits)), packets: sum(data.traffic.map(p => p.packets)) };
  data.summary.traffic = trafficTotal;
  data.outcomes = ["pass", "drop"].map(name => ({ name, bits: sum(data.traffic.filter(p => p.outcome === name).map(p => p.bits)), packets: sum(data.traffic.filter(p => p.outcome === name).map(p => p.packets)) }));
  data.summary.passed = data.outcomes.find(p => p.name === "pass")!;
  data.summary.dropped = data.outcomes.find(p => p.name === "drop")!;
  data.summary.peakBps = Math.max(...Array.from(new Set(data.traffic.map(p => p.timestamp)), t => sum(data.traffic.filter(p => p.timestamp === t).map(p => p.bps))));
  data.summary.peakPps = Math.max(...Array.from(new Set(data.traffic.map(p => p.timestamp)), t => sum(data.traffic.filter(p => p.timestamp === t).map(p => p.pps))));
  data.ruleActivity = [{ name: "rule-1", bits: 52000000, packets: 52000 }];
  data.protections = data.protections.map(p => {
    if (p.name === "Network-layer DDoS") p = { ...p, volume: { bits: 200000000, packets: 200000 } };
    if (p.name === "Network Firewall") p = { ...p, volume: { bits: 52000000, packets: 52000 } };
    if (!p.volume) return p;
    const volume = p.volume;
    const shares = p.breakdown.map(() => 1 / p.breakdown.length);
    return { ...p,
      series: data.traffic.map(t => ({ ...t, bits: t.bits / trafficTotal.bits * volume.bits, packets: t.packets / trafficTotal.packets * volume.packets, bps: t.bits / trafficTotal.bits * volume.bits / 300, pps: t.packets / trafficTotal.packets * volume.packets / 300 })),
      breakdown: p.breakdown.map((b, i) => ({ ...b, bits: split(volume.bits, shares)[i], packets: split(volume.packets, shares)[i] })),
    };
  });
  data.notes = ["Demonstration only: all values, configurations and narratives are synthetic; no customer telemetry or credentials were used.", "The sample includes intentionally incomplete traffic coverage; absent intervals are not measured zero.", "Probe success and mean routing state have separate meanings. Ingress and egress stay separate. Attack volumes are event-lifetime values."];
  return data;
}
