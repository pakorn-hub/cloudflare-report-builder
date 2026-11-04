import { test, expect } from "@playwright/test";
import { generateMagicTransitData } from "../../apps/api/src/services/cf-magic-transit";

// Explicit opt-in only. No fixtures, raw API responses, token values, report
// files, schedule writes or email delivery are produced by this live check.
test("live account exposes usable Magic Transit analytics", async () => {
  test.skip(!process.env.MT_LIVE_API_TOKEN || !process.env.MT_LIVE_ACCOUNT_ID, "Supply explicit live credentials to opt in");
  test.setTimeout(180000);
  const token = process.env.MT_LIVE_API_TOKEN!, accountId = process.env.MT_LIVE_ACCOUNT_ID!;
  const started = Date.now();
  const data = await generateMagicTransitData({ token, accountId, days: 1, tzOffset: -420, rangeMode: "period", period: "yesterday" });
  // Independent status breakdown checks the enum/count interpretation used
  // for the headline probe-success measurement, without logging raw rows.
  const probeResponse = await fetch("https://api.cloudflare.com/client/v4/graphql", {
    method: "POST", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ query: `query($accountTag: string, $from: string, $to: string) { viewer { accounts(filter: {accountTag: $accountTag}) { results: magicTransitTunnelHealthChecksAdaptiveGroups(limit: 100, filter: {datetime_geq: $from, datetime_lt: $to}) { count dimensions { resultStatus } avg { tunnelState } } } } }`, variables: { accountTag: accountId, from: data.meta.sinceTs, to: new Date(Date.parse(data.meta.untilTs) + 1).toISOString() } }),
    signal: AbortSignal.timeout(25000),
  });
  expect(probeResponse.ok, "Independent probe query must succeed").toBe(true);
  const probeJson = await probeResponse.json() as { errors?: unknown[]; data?: { viewer?: { accounts?: { results: { count: number; dimensions: { resultStatus: string }; avg: { tunnelState: number } }[] }[] } } };
  expect((probeJson.errors ?? []).length, "Independent probe query must have no GraphQL errors").toBe(0);
  const probeResults = probeJson.data?.viewer?.accounts?.[0]?.results ?? [];
  const samples = probeResults.reduce((sum, r) => sum + r.count, 0);
  const successful = probeResults.filter(r => r.dimensions.resultStatus === "ok").reduce((sum, r) => sum + r.count, 0);
  if (samples) expect(data.summary.probeSuccessPct, "Headline probe success must agree with independent status counts").toBeCloseTo(successful / samples * 100, 3);
  console.log(JSON.stringify({
    elapsedSeconds: (Date.now() - started) / 1000,
    window: { since: data.meta.sinceTs, until: data.meta.untilTs },
    summary: data.summary,
    probeResults: probeResults.map(r => ({ status: r.dimensions.resultStatus, samples: r.count, meanRoutingState: r.avg.tunnelState })),
    recordCounts: { traffic: data.traffic.length, outcomes: data.outcomes.length, countries: data.rankings.sourceCountries?.length ?? null, attacks: data.attacks.length, tunnels: data.tunnels.length, health: data.health.length, tunnelTraffic: data.tunnelTraffic.length, routes: data.routes.length, prefixes: data.prefixes.length, rules: data.rules.length },
    protection: data.protections.map(p => ({ name: p.name, volume: p.volume, points: p.series.length, rules: p.rules.length })),
    datasets: Object.fromEntries(Object.entries(data.capabilities).map(([key, cap]) => [key, { enabled: cap.enabled, maxDuration: cap.maxDuration, notOlderThan: cap.notOlderThan }])),
    errors: data.errors,
  }, null, 2));
  expect(JSON.stringify(data).includes(token), "Report must omit credentials").toBe(false);
  expect(data.summary.traffic, "Live ingress analytics must be available").not.toBeNull();
  expect(data.summary.peakBps, "Live traffic series must be available").not.toBeNull();
});
