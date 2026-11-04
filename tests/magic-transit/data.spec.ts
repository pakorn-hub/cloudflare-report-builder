import { test, expect } from "@playwright/test";
import { aggregateMtSeries, generateMagicTransitData, mtAttackOverlaps, resolveMtRange } from "../../apps/api/src/services/cf-magic-transit";
import { runSchedule } from "../../apps/api/src/scheduler";
import { buildEmbeddedReportAttachment } from "../../apps/api/src/services/attachment-builder";
import { handleFetchMagicTransit } from "../../apps/api/src/routes/fetch-magic-transit";
import { Hono } from "hono";
import { fixture } from "./fixture";
import { mockUpstream, TEST_ACCOUNT, TEST_TOKEN } from "./mock-upstream";

test("collector uses ingress filters, bounded concurrency, real overlap selection and credential-free contracts", async () => {
  const mock = mockUpstream({ maxPageSize: 50 }), original = globalThis.fetch;
  globalThis.fetch = mock.fetch;
  try {
    const data = await generateMagicTransitData({ token: TEST_TOKEN, accountId: TEST_ACCOUNT, days: 30, tzOffset: -420 });
    expect(data.summary.traffic?.packets).toBe(1000);
    expect(data.summary.dropped?.packets).toBe(100);
    expect(data.summary.probeSuccessPct).toBe(90);
    expect(data.summary.attackCount).toBe(1); // Repeated chunk responses must deduplicate.
    expect(data.health[0].state).toBeCloseTo(0.9);
    expect(data.errors).toEqual({});
    expect(mock.maxConcurrent()).toBeLessThanOrEqual(4);
    expect(mock.calls.length).toBeLessThan(120);
    expect(mock.calls.filter(c => c.query.includes("rows:")).every(c => c.query.includes("limit: 50"))).toBe(true);
    expect(mock.calls.filter(c => c.query.includes("rows: magicTransitNetworkAnalytics")).every(c => (c.variables.filter as { direction: string }).direction === "ingress")).toBe(true);
    expect(JSON.stringify(data)).not.toContain(TEST_TOKEN);
    expect(JSON.stringify(data)).not.toContain("must-never-leave-upstream");
    expect(data.protocolPorts[0].protocol).toBe("TCP");
  } finally { globalThis.fetch = original; }
});

test("partial failures stay unavailable, not measured zero", async () => {
  const mock = mockUpstream({ failHealth: true, failRules: true, failMain: true }), original = globalThis.fetch;
  globalThis.fetch = mock.fetch;
  try {
    const data = await generateMagicTransitData({ token: TEST_TOKEN, accountId: TEST_ACCOUNT, days: 1, tzOffset: 0 });
    expect(data.summary.probeSuccessPct).toBeNull();
    expect(data.summary.traffic).toBeNull();
    expect(data.summary.peakBps).toBeNull();
    expect(data.errors.health).toContain("unavailable");
    expect(data.errors["rules:magic_transit"]).toContain("403");
    expect(data.summary.attackCount).toBe(1);
  } finally { globalThis.fetch = original; }
});

test("priority attack rankings use DDoS mitigation, preserve joint dimensions and never infer applications", async () => {
  const mock = mockUpstream(), original = globalThis.fetch;
  globalThis.fetch = mock.fetch;
  try {
    const data = await generateMagicTransitData({ token: TEST_TOKEN, accountId: TEST_ACCOUNT, days: 1, tzOffset: 0 });
    expect(data.attackRankings?.sources).toEqual([
      { ip: "192.0.2.9", country: "US", bits: 640000, packets: 640 },
      { ip: "192.0.2.9", country: "JP", bits: 240000, packets: 240 },
    ]);
    expect(data.attackRankings?.targets).toEqual([
      { ip: "203.0.113.10", port: 443, protocol: "TCP", application: null, bits: 640000, packets: 640 },
      { ip: "203.0.113.10", port: 53, protocol: "UDP", application: null, bits: 240000, packets: 240 },
    ]);
    expect(data.attackRankings?.sourceCountries?.[0]).toEqual({ name: "US", bits: 640000, packets: 640 });
    const calls = mock.calls.filter(c => c.query.includes("rows: dosdNetworkAnalyticsAdaptiveGroups") && /ipSourceAddress|sourceCountry|ipDestinationAddress/.test(c.query));
    expect(calls).toHaveLength(3);
    expect(calls.every(c => (c.variables.filter as { direction: string; outcome: string }).direction === "ingress" && (c.variables.filter as { outcome: string }).outcome === "drop")).toBe(true);
    expect(data.summary.traffic?.bits).toBe(1000000); // The all-traffic total is a different population.
    expect(data.attacks[0].droppedBits).toBe(80000); // Event lifetime is a different time basis.
  } finally { globalThis.fetch = original; }
});

test("unavailable DDoS source/target rankings remain null rather than borrowing all-traffic rankings", async () => {
  const mock = mockUpstream({ failAttackRankings: true }), original = globalThis.fetch;
  globalThis.fetch = mock.fetch;
  try {
    const data = await generateMagicTransitData({ token: TEST_TOKEN, accountId: TEST_ACCOUNT, days: 1, tzOffset: 0 });
    expect(data.attackRankings).toEqual({ sources: null, sourceCountries: null, targets: null });
    expect(data.errors.attackSources).toContain("unavailable");
    expect(data.rankings.sourceIps.length).toBeGreaterThan(0);
    expect(data.summary.attackCount).toBe(1);
  } finally { globalThis.fetch = original; }
});

test("missing attack measurements remain null without losing the event", async () => {
  const mock = mockUpstream({ omitAttackMeasurements: true }), original = globalThis.fetch;
  globalThis.fetch = mock.fetch;
  try {
    const data = await generateMagicTransitData({ token: TEST_TOKEN, accountId: TEST_ACCOUNT, days: 1, tzOffset: 0 });
    expect(data.summary.attackCount).toBe(1);
    expect(data.attacks[0].droppedBits).toBeNull();
    expect(data.attacks[0].packets).toBeNull();
    expect(data.attacks[0].port).toBeNull();
  } finally { globalThis.fetch = original; }
});

test("query expansion respects the hard request budget and exposes incomplete sections", async () => {
  const mock = mockUpstream({ maxDuration: 86400 }), original = globalThis.fetch;
  globalThis.fetch = mock.fetch;
  try {
    const data = await generateMagicTransitData({ token: TEST_TOKEN, accountId: TEST_ACCOUNT, days: 30, tzOffset: 0 });
    expect(mock.calls.length).toBeLessThanOrEqual(120);
    expect(mock.maxConcurrent()).toBeLessThanOrEqual(4);
    expect(Object.values(data.errors).some(e => e.includes("budget reached"))).toBe(true);
  } finally { globalThis.fetch = original; }
});

test("bucket aggregation merges split rows and uses partial-boundary duration", () => {
  const timestamp = "2026-09-01T00:00:00Z";
  const start = Date.parse("2026-09-01T00:02:00Z"), end = Date.parse("2026-09-01T00:05:00Z");
  const points = aggregateMtSeries([{ dimensions: { timestamp, outcome: "pass" }, sum: { bits: 18000, packets: 180 } }, { dimensions: { timestamp, outcome: "pass" }, sum: { bits: 18000, packets: 180 } }], "timestamp", 300, start, end);
  expect(points).toHaveLength(1);
  expect(points[0].bps).toBe(200);
  expect(points[0].pps).toBe(2);
});

test("overlap includes earlier and ongoing attacks and excludes ended or future events", () => {
  const start = Date.parse("2026-09-01T00:00:00Z"), end = Date.parse("2026-09-02T00:00:00Z");
  expect(mtAttackOverlaps({ startDatetime: "2026-08-31T00:00:00Z", endDatetime: "2026-09-01T02:00:00Z" }, start, end)).toBe(true);
  expect(mtAttackOverlaps({ startDatetime: "2026-08-31T00:00:00Z", endDatetime: null }, start, end)).toBe(true);
  expect(mtAttackOverlaps({ startDatetime: "2026-08-30T00:00:00Z", endDatetime: "2026-08-31T00:00:00Z" }, start, end)).toBe(false);
  expect(mtAttackOverlaps({ startDatetime: "2026-09-03T00:00:00Z", endDatetime: null }, start, end)).toBe(false);
});

test("custom local time range retains timezone-aware UTC boundaries", () => {
  const r = resolveMtRange({ token: TEST_TOKEN, accountId: TEST_ACCOUNT, days: 1, tzOffset: -420, rangeMode: "custom", sinceDate: "2026-09-01", untilDate: "2026-09-01", sinceTime: "09:30", untilTime: "10:45" });
  expect(r.sinceTs).toBe("2026-09-01T02:30:00.000Z");
  expect(r.untilTs).toBe("2026-09-01T03:45:59.999Z");
});

test("fetch route rejects malformed inputs without contacting Cloudflare", async () => {
  const app = new Hono(); app.post("/api/magic-transit", handleFetchMagicTransit);
  for (const body of [null, [], {}, { token: TEST_TOKEN, accountId: TEST_ACCOUNT, rangeMode: "period", period: "invalid" }, { token: TEST_TOKEN, accountId: TEST_ACCOUNT, tzOffset: "bad" }]) {
    const res = await app.request("/api/magic-transit", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
    expect(res.status).toBe(400);
  }
});

test("embedded attachment escapes active payload strings", async () => {
  const html = await buildEmbeddedReportAttachment({ ASSETS: { fetch: async (req: Request) => new Response(req.url.endsWith(".js") ? `const root = 1;${" ".repeat(11000)}` : "body{}") } } as never, { kind: "magic-transit", data: fixture(), input: { token: "", product: "magic-transit" }, scheduleName: "</script><script>alert(1)</script>", generatedAt: "2026-09-01" }, "Magic Transit");
  expect(html).toContain('"kind":"magic-transit"');
  expect(html).not.toContain("</script><script>alert(1)");
  expect(html).toContain("\\u003c/script>");
});

test("Magic Transit schedule dispatch sends an embedded MT attachment and archives both artifacts", async () => {
  const mock = mockUpstream(), original = globalThis.fetch;
  globalThis.fetch = mock.fetch;
  const sends: Record<string, unknown>[] = [], archives: string[] = [], writes: string[] = [];
  const env = {
    CF_API_TOKEN: TEST_TOKEN, CF_ACCOUNT_ID: TEST_ACCOUNT, EMAIL_FROM: "reports@example.com",
    DB: { prepare: (sql: string) => ({ all: async () => ({ results: [] }), bind: (..._args: unknown[]) => ({ run: async () => { writes.push(sql); return { success: true }; } }) }) },
    AI: { run: async () => { throw new Error("Synthetic AI unavailable"); } },
    ASSETS: { fetch: async (req: Request) => new Response(req.url.endsWith(".js") ? `const root=1;${" ".repeat(11000)}` : "body{}") },
    EMAIL: { send: async (payload: Record<string, unknown>) => { sends.push(payload); return { messageId: "offline-test" }; } },
    AUDIT_BUCKET: { put: async (key: string) => { archives.push(key); } },
  };
  try {
    const result = await runSchedule(env as never, { id: "offline-schedule", name: "Example scheduled network report", report_type: "magic-transit", days: 1, tz_offset: -420, is_poc: 0, recipients: '["recipient@example.com"]', subject: "Magic Transit {{account}}", range_mode: "period", period: "yesterday", enabled: 1 } as never, "manual");
    expect(result.ok).toBe(true);
    expect(sends).toHaveLength(1);
    const attachment = (sends[0].attachments as { content: string; filename: string }[])[0];
    expect(attachment.filename).toMatch(/^magic-transit-report-/);
    expect(attachment.content).toContain('"kind":"magic-transit"');
    expect(attachment.content).toContain('"product":"magic-transit"');
    expect(attachment.content).not.toContain(TEST_TOKEN);
    expect(attachment.content).not.toContain("must-never-leave-upstream");
    expect(archives).toHaveLength(2);
    expect(writes.some(s => s.includes("send_history"))).toBe(true);
  } finally { globalThis.fetch = original; }
});
