import type { MagicTransitData, MtHealthPoint, MtTunnelPoint } from "./magic-transit";

type HealthAccumulator = MtHealthPoint & { weightedState: number; stateWeight: number };
function addHealth(map: Map<string, HealthAccumulator>, key: string, p: MtHealthPoint, timestamp: string) {
  const row = map.get(key) ?? { timestamp, tunnel: p.tunnel, ok: 0, timeout: 0, other: 0, state: null, weightedState: 0, stateWeight: 0 };
  row.ok += p.ok; row.timeout += p.timeout; row.other += p.other;
  const weight = p.stateSamples ?? p.ok + p.timeout + p.other;
  if (p.state !== null && weight > 0) { row.weightedState += p.state * weight; row.stateWeight += weight; }
  map.set(key, row);
}
function healthValues(map: Map<string, HealthAccumulator>): MtHealthPoint[] {
  return [...map.values()].map(({ weightedState, stateWeight, ...row }) => ({ ...row, state: stateWeight ? weightedState / stateWeight : null, stateSamples: stateWeight }))
    .sort((a, b) => a.timestamp.localeCompare(b.timestamp) || a.tunnel.localeCompare(b.tunnel));
}
type TrafficAccumulator = MtTunnelPoint & { intervals: [number, number][] };
function intervalSeconds(intervals: [number, number][]) {
  let total = 0, from = 0, until = 0;
  for (const [a, b] of intervals.sort((x, y) => x[0] - y[0])) {
    if (a > until) { total += until - from; from = a; until = b; } else until = Math.max(until, b);
  }
  return (total + until - from) / 1000;
}

/** Presentation rollups only: native measurements remain intact in the report payload. */
export function consolidateMtTunnels(data: Pick<MagicTransitData, "meta" | "health" | "tunnelTraffic">) {
  const start = Date.parse(data.meta.sinceTs), end = Date.parse(data.meta.untilTs) + 1;
  const nativeMs = data.meta.bucketSeconds * 1000;
  const interval = end - start <= 86400000 ? "hour" : "day";
  const step = interval === "hour" ? 3600000 : 86400000;
  // Never divide a coarse source bucket across local days by inventing measurements.
  const offset = data.meta.tzOffset * 60000;
  const alignment = offset % nativeMs === 0 ? offset : 0;
  const bucket = (t: number) => Math.floor((t - alignment) / step) * step + alignment;
  const timestamps: string[] = [];
  for (let t = bucket(start); t < end; t += step) timestamps.push(new Date(Math.max(start, t)).toISOString());
  const health = new Map<string, HealthAccumulator>(), totals = new Map<string, HealthAccumulator>(), outcomes = new Map<string, HealthAccumulator>();
  const traffic = new Map<string, TrafficAccumulator>(), directions = new Map<string, TrafficAccumulator>();
  const pointTime = (timestamp: string) => {
    const t = Date.parse(timestamp), a = Math.max(start, t), b = Math.min(end, t + nativeMs);
    return Number.isFinite(t) && b > a ? { timestamp: new Date(Math.max(start, bucket(a))).toISOString(), a, b } : null;
  };
  for (const p of data.health) {
    const time = pointTime(p.timestamp); if (!time) continue;
    addHealth(health, JSON.stringify([p.tunnel, time.timestamp]), p, time.timestamp);
    addHealth(totals, p.tunnel, p, data.meta.sinceTs);
    addHealth(outcomes, time.timestamp, { ...p, tunnel: "All measured tunnels" }, time.timestamp);
  }
  for (const p of data.tunnelTraffic) {
    const time = pointTime(p.timestamp); if (!time) continue;
    for (const [map, key, tunnel] of [
      [traffic, JSON.stringify([p.tunnel, p.direction, time.timestamp]), p.tunnel],
      [directions, JSON.stringify([p.direction, time.timestamp]), "All measured tunnels"],
    ] as const) {
      const row = map.get(key) ?? { timestamp: time.timestamp, tunnel, direction: p.direction, bits: 0, packets: 0, bps: 0, intervals: [] };
      row.bits += p.bits; row.packets += p.packets; row.intervals.push([time.a, time.b]); map.set(key, row);
    }
  }
  const trafficValues = (map: Map<string, TrafficAccumulator>) => [...map.values()].map(({ intervals, ...p }) => ({ ...p, bps: p.bits / intervalSeconds(intervals) }))
    .sort((a, b) => a.timestamp.localeCompare(b.timestamp) || a.tunnel.localeCompare(b.tunnel) || a.direction.localeCompare(b.direction));
  const directionKeys = [...new Set(data.tunnelTraffic.map(p => p.direction))].sort();
  const directional = trafficValues(directions);
  const byTime = new Map(healthValues(outcomes).map(p => [p.timestamp, p]));
  return {
    interval, utcAligned: alignment !== offset, timestamps,
    health: healthValues(health), totals: healthValues(totals), traffic: trafficValues(traffic), directionKeys,
    probeSeries: timestamps.map(date => { const p = byTime.get(date); return { date, ok: p?.ok ?? null, timeout: p?.timeout ?? null, other: p?.other ?? null }; }),
    bandwidthSeries: timestamps.map(date => Object.fromEntries([["date", date], ...directionKeys.map(key => [key, directional.find(p => p.timestamp === date && p.direction === key)?.bps ?? null])])),
  };
}
