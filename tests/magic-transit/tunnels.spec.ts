import { test, expect } from "@playwright/test";
import { consolidateMtTunnels } from "../../shared/magic-transit-tunnels";
import { fixture } from "./fixture";

test("288 five-minute measurements consolidate to 24 local hours without changing counts", () => {
  const data = fixture();
  data.meta.sinceTs = "2026-09-01T17:00:00.000Z";
  data.meta.untilTs = "2026-09-02T16:59:59.999Z";
  data.meta.bucketSeconds = 300;
  data.health = Array.from({ length: 288 }, (_, i) => ({ timestamp: new Date(Date.parse(data.meta.sinceTs) + i * 300000).toISOString(), tunnel: "Example tunnel", ok: i + 1, timeout: 3, other: 1, state: i % 2 ? 0 : 1 }));
  const result = consolidateMtTunnels(data);
  expect(result.interval).toBe("hour");
  expect(result.timestamps).toHaveLength(24);
  expect(result.health).toHaveLength(24);
  expect(result.health[0].timestamp).toBe(data.meta.sinceTs);
  for (const key of ["ok", "timeout", "other"] as const) {
    expect(result.health.reduce((s, p) => s + p[key], 0)).toBe(data.health.reduce((s, p) => s + p[key], 0));
    expect(result.totals[0][key]).toBe(data.health.reduce((s, p) => s + p[key], 0));
  }
  expect(result.totals[0].state).toBeCloseTo(data.health.reduce((s, p) => s + p.state! * (p.ok + p.timeout + p.other), 0) / data.health.reduce((s, p) => s + p.ok + p.timeout + p.other, 0));
  expect(data.health).toHaveLength(288);
});

test("routing-state consolidation uses its own known sample weights and preserves unavailable means", () => {
  const data = fixture(), timestamp = data.meta.sinceTs;
  data.health = [
    { timestamp, tunnel: "A", ok: 90, timeout: 10, other: 0, state: 1, stateSamples: 10 },
    { timestamp, tunnel: "A", ok: 0, timeout: 100, other: 0, state: 0, stateSamples: 90 },
    { timestamp, tunnel: "A", ok: 100, timeout: 0, other: 0, state: null, stateSamples: 0 },
    { timestamp, tunnel: "B", ok: 0, timeout: 0, other: 0, state: null },
  ];
  const result = consolidateMtTunnels(data);
  expect(result.totals[0].state).toBeCloseTo(0.1);
  expect(result.totals[0].stateSamples).toBe(100);
  expect(result.totals[0].ok).toBe(190);
  expect(result.totals[1].state).toBeNull();
});

test("bandwidth uses summed bits and unique observed durations, with separate directions and null gaps", () => {
  const data = fixture(); data.meta.bucketSeconds = 300; data.health = [];
  const timestamp = data.meta.sinceTs, later = new Date(Date.parse(timestamp) + 300000).toISOString();
  data.tunnelTraffic = [
    { timestamp, tunnel: "A", direction: "ingress", bits: 300000, packets: 30, bps: 1000 },
    { timestamp: later, tunnel: "A", direction: "ingress", bits: 900000, packets: 90, bps: 3000 },
    { timestamp, tunnel: "B", direction: "ingress", bits: 600000, packets: 60, bps: 2000 },
    { timestamp, tunnel: "A", direction: "egress", bits: 150000, packets: 15, bps: 500 },
    { timestamp: new Date(Date.parse(timestamp) + 7200000).toISOString(), tunnel: "A", direction: "ingress", bits: 0, packets: 0, bps: 0 },
  ];
  const result = consolidateMtTunnels(data);
  expect(result.traffic.find(p => p.tunnel === "A" && p.direction === "ingress")?.bps).toBe(2000);
  expect(result.bandwidthSeries[0].ingress).toBe(3000); // 1.8M bits / 600 seconds, not 6K bps.
  expect(result.bandwidthSeries[0].egress).toBe(500);
  expect(result.bandwidthSeries[1].ingress).toBeNull();
  expect(result.bandwidthSeries[2].ingress).toBe(0);
  expect(result.probeSeries[0].ok).toBeNull();
});

test("custom partial windows use observed boundary durations in a half-hour timezone", () => {
  const data = fixture(); data.meta.tzOffset = -330; data.meta.bucketSeconds = 300;
  data.meta.sinceTs = "2026-09-01T00:37:00.000Z"; data.meta.untilTs = "2026-09-01T00:42:59.999Z";
  data.health = [];
  data.tunnelTraffic = ["2026-09-01T00:35:00Z", "2026-09-01T00:40:00Z"].map(timestamp => ({ timestamp, tunnel: "A", direction: "ingress", bits: 180000, packets: 18, bps: 1000 }));
  const result = consolidateMtTunnels(data);
  expect(result.timestamps).toEqual([data.meta.sinceTs]);
  expect(result.traffic[0].bps).toBe(1000);
  expect(result.utcAligned).toBe(false);
});

test("multi-day summaries remain daily and never split coarse UTC daily source buckets", () => {
  const data = fixture(); data.meta.bucketSeconds = 86400;
  data.meta.sinceTs = "2026-09-01T17:00:00Z"; data.meta.untilTs = "2026-09-03T16:59:59.999Z";
  data.health = ["2026-09-01", "2026-09-02", "2026-09-03"].map(timestamp => ({ timestamp, tunnel: "A", ok: 10, timeout: 1, other: 0, state: 1 }));
  data.tunnelTraffic = [];
  const result = consolidateMtTunnels(data);
  expect(result.interval).toBe("day");
  expect(result.utcAligned).toBe(true);
  expect(result.health).toHaveLength(3);
  expect(result.totals[0].ok).toBe(30);
});
