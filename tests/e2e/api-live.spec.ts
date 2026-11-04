/**
 * Live API Tests — tests the Worker API directly with real Cloudflare credentials.
 * Validates API responses contain expected data structures and
 * that data is correctly shaped for visualisation (Recharts pie/bar/time-series).
 *
 * Requires .env.test:
 *   CF_TOKEN=...
 *   CF_ZONE_ID=...
 *   CF_ACCOUNT_ID=...
 *
 * Performance: all tests in the main suite share ONE API call via beforeAll().
 * The AI summary test makes its own separate call (different endpoint).
 */

import { test, expect, request as pwRequest } from "@playwright/test";

const API_BASE = process.env.API_BASE ?? "http://localhost:8787";
const CF_TOKEN = process.env.CF_TOKEN;
const CF_ZONE_ID = process.env.CF_ZONE_ID;
const CF_ACCOUNT_ID = process.env.CF_ACCOUNT_ID;

const credsPresent = !!(CF_TOKEN && CF_ZONE_ID && CF_ACCOUNT_ID);

// ─── Shared state ─────────────────────────────────────────────────────────────
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let appsecData: any = null;

test.describe("API Live: AppSec Data Structure", () => {
  // One API call for the whole suite — avoids 19 × 60s timeouts
  test.beforeAll(async () => {
    if (!credsPresent) return;
    const ctx = await pwRequest.newContext();
    const res = await ctx.post(`${API_BASE}/api/appsec`, {
      data: { token: CF_TOKEN, zoneId: CF_ZONE_ID, accountId: CF_ACCOUNT_ID },
      timeout: 120_000,
    });
    const body = await res.json();
    appsecData = body.appsec;
    await ctx.dispose();
  });

  test.setTimeout(30_000);   // individual test timeout (data already fetched)

  // ── Smoke test ──────────────────────────────────────────────────────────────
  test("POST /api/appsec returns valid AppSecData structure", () => {
    test.skip(!credsPresent, "No credentials");
    expect(appsecData).toBeDefined();
    const a = appsecData;

    // Traffic overview
    expect(Array.isArray(a.requestsTimeSeries)).toBe(true);
    expect(Array.isArray(a.wafTimeSeries)).toBe(true);
    expect(Array.isArray(a.botTimeSeries)).toBe(true);
    expect(Array.isArray(a.ddosTimeSeries)).toBe(true);
    expect(Array.isArray(a.cacheTimeSeries)).toBe(true);
    expect(Array.isArray(a.errorTimeSeries)).toBe(true);

    // WAF
    expect(Array.isArray(a.wafTopRules)).toBe(true);
    expect(Array.isArray(a.wafTopCountries)).toBe(true);
    expect(Array.isArray(a.wafTopPaths)).toBe(true);

    // Breakdowns
    expect(Array.isArray(a.tlsVersionBreakdown)).toBe(true);
    expect(Array.isArray(a.cacheStatusBreakdown)).toBe(true);
    expect(Array.isArray(a.botScoreBreakdown)).toBe(true);

    // Config
    expect(Array.isArray(a.certificates)).toBe(true);

    // Log any errors (don't hard-fail — some queries may not apply to all zones)
    const errorKeys = Object.keys(a.errors ?? {});
    if (errorKeys.length > 0) {
      console.warn("⚠️  Query errors:", a.errors);
    }
    // Rate limiting (HTTP 429) can cause many queries to fail simultaneously
    // during repeated test runs. The report gracefully degrades via
    // Promise.allSettled — sections just show "no data available".
    // We only log errors here; individual field tests below validate data when present.
    if (errorKeys.length > 0) {
      console.warn(`${errorKeys.length} query errors (likely rate-limited)`);
    }

    // Cipher suites
    expect(Array.isArray(a.cipherSuites)).toBe(true);
    expect(a.cipherSuites.length).toBeGreaterThan(0);

    // WAF enrichment fields
    if (a.wafTopRules.length > 0) {
      expect(a.wafTopRules[0]).toHaveProperty("ruleName");
    }
    if (a.wafTopPaths.length > 0) {
      expect(a.wafTopPaths[0]).toHaveProperty("host");
      expect(a.wafTopPaths[0]).toHaveProperty("url");
    }

    console.log("AppSec summary:", {
      totalRequests: a.summary?.totalRequests,
      totalThreats: a.summary?.totalThreatsBlocked,
      cacheHit: a.summary?.cacheHitRatePct + "%",
      requestsDays: a.requestsTimeSeries.length,
      certs: a.certificates.length,
      tlsVersions: a.tlsVersionBreakdown.length,
      cipherSuites: a.cipherSuites,
    });
  });

  // ── Time-series shape ───────────────────────────────────────────────────────
  test("requestsTimeSeries has correct shape for Recharts TimeSeriesChart", () => {
    test.skip(!credsPresent, "No credentials");
    const series = appsecData.requestsTimeSeries as { date: string; value: number }[];
    expect(Array.isArray(series)).toBe(true);
    if (series.length > 0) {
      for (const point of series.slice(0, 5)) {
        expect(typeof point.date).toBe("string");
        expect(typeof point.value).toBe("number");
        expect(isNaN(Date.parse(point.date))).toBe(false);
      }
    }
  });

  test("WAF top rules are sorted descending by count", () => {
    test.skip(!credsPresent, "No credentials");
    const rules = appsecData.wafTopRules as { ruleId: string; count: number }[];
    if (rules.length >= 2) {
      const counts = rules.map((r) => r.count);
      for (let i = 0; i < counts.length - 1; i++) {
        expect(counts[i]).toBeGreaterThanOrEqual(counts[i + 1]);
      }
    }
  });

  test("tlsVersionBreakdown has name+value shape for PieChart", () => {
    test.skip(!credsPresent, "No credentials");
    const tls = appsecData.tlsVersionBreakdown as { version: string; requests: number; pct: number }[];
    expect(Array.isArray(tls)).toBe(true);
    if (tls.length > 0) {
      for (const item of tls) {
        expect(item).toHaveProperty("version");
        expect(item).toHaveProperty("requests");
        expect(typeof item.requests).toBe("number");
      }
    }
    console.log("TLS breakdown:", tls);
  });

  test("certificate data has required display fields", () => {
    test.skip(!credsPresent, "No credentials");
    const certs = appsecData.certificates as Record<string, unknown>[];
    expect(Array.isArray(certs)).toBe(true);
    if (certs.length > 0) {
      for (const cert of certs.slice(0, 3)) {
        expect(cert).toHaveProperty("type");
        expect(cert).toHaveProperty("status");
        expect(cert).toHaveProperty("hosts");
        expect(cert).toHaveProperty("daysUntilExpiry");
      }
    }
  });

  test("appsec data includes cost savings object", () => {
    test.skip(!credsPresent, "No credentials");
    const cs = appsecData?.summary?.costSavings;
    expect(cs).toBeDefined();
    expect(typeof cs.monthlyBandwidthSavings).toBe("number");
    expect(typeof cs.annualBandwidthSavings).toBe("number");
    expect(typeof cs.originBandwidthSavedGB).toBe("number");
    expect(typeof cs.originRequestsAvoided).toBe("number");
    expect(typeof cs.originLoadReductionPct).toBe("number");
    expect(cs.originLoadReductionPct).toBeGreaterThanOrEqual(0);
    expect(cs.originLoadReductionPct).toBeLessThanOrEqual(100);
    expect(cs.annualBandwidthSavings).toBe(cs.monthlyBandwidthSavings * 12);
    console.log("Cost savings:", cs);
  });

  test("appsec data includes security recommendations", () => {
    test.skip(!credsPresent, "No credentials");
    const recs = appsecData?.recommendations;
    expect(Array.isArray(recs)).toBe(true);
    expect(recs.length).toBeGreaterThan(0);
    expect(recs.length).toBeLessThanOrEqual(8);
    for (const rec of recs) {
      expect(["high", "medium", "low"]).toContain(rec.priority);
      expect(typeof rec.title).toBe("string");
      expect(rec.title.length).toBeGreaterThan(5);
      expect(typeof rec.description).toBe("string");
      expect(typeof rec.benefit).toBe("string");
    }
    const priorityOrder: Record<string, number> = { high: 0, medium: 1, low: 2 };
    for (let i = 0; i < recs.length - 1; i++) {
      expect(priorityOrder[recs[i].priority]).toBeLessThanOrEqual(priorityOrder[recs[i + 1].priority]);
    }
    console.log("Recommendations:", recs.map((r: { priority: string; title: string }) => `[${r.priority}] ${r.title}`));
  });

  test("appsec data includes cacheBandwidthHitRatePct", () => {
    test.skip(!credsPresent, "No credentials");
    const summary = appsecData?.summary;
    expect(typeof summary.cacheHitRatePct).toBe("number");
    expect(typeof summary.cacheBandwidthHitRatePct).toBe("number");
    expect(summary.cacheHitRatePct).toBeGreaterThanOrEqual(0);
    expect(summary.cacheHitRatePct).toBeLessThanOrEqual(100);
    expect(summary.cacheBandwidthHitRatePct).toBeGreaterThanOrEqual(0);
    expect(summary.cacheBandwidthHitRatePct).toBeLessThanOrEqual(100);
    console.log("Cache metrics:", {
      requestHitRate: summary.cacheHitRatePct + "%",
      bandwidthHitRate: summary.cacheBandwidthHitRatePct + "%",
    });
  });

  // ── Phase 1–5 new data fields ──────────────────────────────────────────────

  test("Phase 1: countryDistribution has correct shape", () => {
    test.skip(!credsPresent, "No credentials");
    const countries = appsecData?.countryDistribution;
    expect(Array.isArray(countries)).toBe(true);
    if (countries.length > 0) {
      const first = countries[0];
      expect(typeof first.clientCountryName).toBe("string");
      expect(typeof first.requests).toBe("number");
      expect(typeof first.bytes).toBe("number");
      expect(typeof first.threats).toBe("number");
      if (countries.length >= 2) {
        expect(countries[0].requests).toBeGreaterThanOrEqual(countries[1].requests);
      }
    }
    console.log("Countries:", countries.slice(0, 3).map((c: { clientCountryName: string; requests: number }) => `${c.clientCountryName}: ${c.requests}`));
  });

  test("Phase 1: browserBreakdown has pct fields", () => {
    test.skip(!credsPresent, "No credentials");
    const browsers = appsecData?.browserBreakdown;
    expect(Array.isArray(browsers)).toBe(true);
    for (const b of browsers) {
      expect(typeof b.uaBrowserFamily).toBe("string");
      expect(typeof b.requests).toBe("number");
      expect(typeof b.pct).toBe("number");
      expect(b.pct).toBeGreaterThanOrEqual(0);
      expect(b.pct).toBeLessThanOrEqual(100);
    }
    console.log("Browsers:", browsers.slice(0, 3));
  });

  test("Phase 1: deviceBreakdown has correct shape", () => {
    test.skip(!credsPresent, "No credentials");
    const devices = appsecData?.deviceBreakdown;
    expect(Array.isArray(devices)).toBe(true);
    for (const d of devices) {
      expect(typeof d.clientDeviceType).toBe("string");
      expect(typeof d.requests).toBe("number");
      expect(typeof d.pct).toBe("number");
    }
    console.log("Devices:", devices);
  });

  test("Phase 1: httpStatusSummary has all status class fields", () => {
    test.skip(!credsPresent, "No credentials");
    const status = appsecData?.httpStatusSummary;
    if (status && status.total > 0) {
      expect(typeof status.e2xx).toBe("number");
      expect(typeof status.e3xx).toBe("number");
      expect(typeof status.e4xx).toBe("number");
      expect(typeof status.e5xx).toBe("number");
      expect(typeof status.total).toBe("number");
    }
    console.log("HTTP status summary:", status);
  });

  test("Phase 2: ttfbTimeSeries has avg TTFB fields", () => {
    test.skip(!credsPresent, "No credentials");
    const ttfb = appsecData?.ttfbTimeSeries;
    expect(Array.isArray(ttfb)).toBe(true);
    if (ttfb.length > 0) {
      for (const point of ttfb.slice(0, 5)) {
        expect(typeof point.date).toBe("string");
        expect(typeof point.avg).toBe("number");
        expect(point.avg).toBeGreaterThanOrEqual(0);
      }
    }
    console.log("TTFB sample:", ttfb.slice(0, 3));
  });

  test("Phase 2: edgeColoDistribution has coloCode + bytes", () => {
    test.skip(!credsPresent, "No credentials");
    const colos = appsecData?.edgeColoDistribution;
    expect(Array.isArray(colos)).toBe(true);
    if (colos.length > 0) {
      for (const c of colos.slice(0, 5)) {
        expect(typeof c.coloCode).toBe("string");
        expect(typeof c.bytes).toBe("number");
      }
    }
    console.log("Edge colos:", colos.slice(0, 5).map((c: { coloCode: string; bytes: number }) => `${c.coloCode}: ${(c.bytes / 1e6).toFixed(0)}MB`));
  });

  test("Phase 3: topThreatIps has ip/country/action/count fields", () => {
    test.skip(!credsPresent, "No credentials");
    const ips = appsecData?.topThreatIps;
    expect(Array.isArray(ips)).toBe(true);
    for (const ip of ips.slice(0, 5)) {
      expect(typeof ip.ip).toBe("string");
      expect(typeof ip.country).toBe("string");
      expect(typeof ip.action).toBe("string");
      expect(typeof ip.count).toBe("number");
    }
    console.log("Top threat IPs:", ips.slice(0, 3));
  });

  test("Phase 3: topUserAgents has category field", () => {
    test.skip(!credsPresent, "No credentials");
    const uas = appsecData?.topUserAgents;
    expect(Array.isArray(uas)).toBe(true);
    for (const ua of uas.slice(0, 5)) {
      expect(typeof ua.userAgent).toBe("string");
      expect(typeof ua.count).toBe("number");
      expect(["browser", "bot", "scanner", "unknown"]).toContain(ua.category);
    }
    console.log("Top user agents:", uas.slice(0, 3));
  });

  test("Phase 4: contentTypeBreakdown has edgeResponseContentTypeName", () => {
    test.skip(!credsPresent, "No credentials");
    const content = appsecData?.contentTypeBreakdown;
    expect(Array.isArray(content)).toBe(true);
    for (const ct of content.slice(0, 5)) {
      expect(typeof ct.edgeResponseContentTypeName).toBe("string");
      expect(typeof ct.requests).toBe("number");
      expect(typeof ct.bytes).toBe("number");
    }
    console.log("Content types:", content.slice(0, 5).map((c: { edgeResponseContentTypeName: string; requests: number }) => `${c.edgeResponseContentTypeName}: ${c.requests}`));
  });

  test("Phase 5: topReferrers has category field", () => {
    test.skip(!credsPresent, "No credentials");
    const refs = appsecData?.topReferrers;
    expect(Array.isArray(refs)).toBe(true);
    for (const r of refs.slice(0, 5)) {
      expect(typeof r.refererHost).toBe("string");
      expect(typeof r.requests).toBe("number");
      expect(["direct", "search", "social", "referral"]).toContain(r.category);
    }
    console.log("Top referrers:", refs.slice(0, 5));
  });
});

// ── AI Summary — separate describe so it has its own beforeAll + longer timeout ──
test.describe("API Live: AI Summary", () => {
  test.setTimeout(120_000);

  test("POST /api/summary returns AI-generated text summary", async ({ request }) => {
    test.skip(!credsPresent, "No credentials");

    // Fetch appsec data (needs fresh context here)
    const appsecRes = await request.post(`${API_BASE}/api/appsec`, {
      data: { token: CF_TOKEN, zoneId: CF_ZONE_ID, accountId: CF_ACCOUNT_ID },
      timeout: 90_000,
    });
    const appsecBody = await appsecRes.json();

    const summaryRes = await request.post(`${API_BASE}/api/summary`, {
      data: { appsec: appsecBody.appsec },
      timeout: 60_000,
    });

    expect(summaryRes.status()).toBe(200);
    const summaryBody = await summaryRes.json();
    expect(summaryBody.ok).toBe(true);
    expect(typeof summaryBody.summary).toBe("string");
    expect(summaryBody.summary.length).toBeGreaterThan(100);

    const sentences = summaryBody.summary.split(/[.\n]/).filter((s: string) => s.trim().length > 0);
    expect(sentences.length).toBeGreaterThanOrEqual(3);
    console.log("AI Summary preview:", summaryBody.summary.substring(0, 300));
  });
});
