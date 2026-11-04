import type { MagicTransitData } from "../../shared/magic-transit";

/** Entirely synthetic documentation addresses and labels; never copied HAR data. */
export function fixture(): MagicTransitData {
  const start = Date.UTC(2026, 8, 1), step = 3600;
  const timestamps = Array.from({ length: 12 }, (_, i) => new Date(start + i * step * 1000).toISOString());
  const traffic = timestamps.flatMap((timestamp, i) => [
    { timestamp, outcome: "pass", bits: 90000000 + i * 8000000, packets: 90000 + i * 8000, bps: (90000000 + i * 8000000) / step, pps: (90000 + i * 8000) / step },
    { timestamp, outcome: "drop", bits: 10000000 + i * 2000000, packets: 10000 + i * 2000, bps: (10000000 + i * 2000000) / step, pps: (10000 + i * 2000) / step },
  ]);
  const rank = (names: string[]) => names.map((name, i) => ({ name, bits: 100000000 / (i + 1), packets: 100000 / (i + 1) }));
  return {
    meta: { accountId: "00000000000000000000000000000000", accountName: "Example network", generatedAt: "2026-09-02T00:00:00Z", since: "2026-09-01", until: "2026-09-01", sinceTs: timestamps[0], untilTs: "2026-09-01T23:59:59.999Z", days: 1, periodLabel: "September 1, 2026", tzOffset: -420, bucketSeconds: step, configurationAt: "2026-09-02T00:00:00Z" },
    summary: { traffic: { bits: 1860000000, packets: 1860000 }, dropped: { bits: 252000000, packets: 252000 }, passed: { bits: 1608000000, packets: 1608000 }, previousTraffic: { bits: 1600000000, packets: 1600000 }, previousDropped: { bits: 200000000, packets: 200000 }, peakBps: 58000, peakPps: 58, attackCount: 3, probeSuccessPct: 96.8 },
    traffic, outcomes: [{ name: "pass", bits: 1608000000, packets: 1608000 }, { name: "drop", bits: 252000000, packets: 252000 }],
    mitigationSystems: [{ name: "dosd", bits: 200000000, packets: 200000 }, { name: "magic-firewall", bits: 52000000, packets: 52000 }],
    rankings: { sourceCountries: rank(["US", "DE", "JP", "TH"]), processingCountries: rank(["SG", "US", "DE"]), sourceAsns: rank(["64500 · Example ASN", "64501 · Example ASN 2"]), sourceIps: rank(["192.0.2.1", "198.51.100.2"]), destinationIps: rank(["203.0.113.10", "203.0.113.20"]), prefixes: rank(["203.0.113.0/24"]), ports: rank(["443", "53", "80"]), protocols: rank(["TCP", "UDP", "ICMP"]), tcpFlags: rank(["SYN", "ACK", "SYN,ACK"]), packetSizes: rank(["64–128", "129–512"]), colos: rank(["SIN", "FRA", "IAD"]) },
    protocolPorts: [{ protocol: "TCP", port: 443, bits: 90000000, packets: 90000 }, { protocol: "TCP", port: 80, bits: 20000000, packets: 20000 }, { protocol: "UDP", port: 53, bits: 50000000, packets: 50000 }],
    attacks: [0, 1, 2].map(i => ({ id: `example-attack-${i}`, start: timestamps[i * 2], end: i === 2 ? null : timestamps[i * 2 + 3], vector: ["SYN flood", "UDP flood", "ICMP flood"][i], protocol: ["TCP", "UDP", "ICMP"][i], destination: "203.0.113.10", port: i === 1 ? 53 : 443, bits: 80000000, packets: 80000, droppedBits: 70000000, droppedPackets: 70000 })),
    attackRankings: {
      sources: [{ ip: "192.0.2.1", country: "US", bits: 120000000, packets: 120000 }, { ip: "198.51.100.2", country: "DE", bits: 80000000, packets: 80000 }],
      sourceCountries: [{ name: "US", bits: 120000000, packets: 120000 }, { name: "DE", bits: 80000000, packets: 80000 }],
      targets: [{ ip: "203.0.113.10", port: 443, protocol: "TCP", application: null, bits: 140000000, packets: 140000 }, { ip: "203.0.113.20", port: 53, protocol: "UDP", application: null, bits: 60000000, packets: 60000 }],
    },
    tunnels: [0, 1, 2].map(i => ({ id: `tunnel-${i}`, name: `Example tunnel ${i + 1}`, type: i === 2 ? "IPsec" : "GRE", endpoint: `192.0.2.${i + 1}`, interfaceAddress: `10.0.${i}.1/31`, healthChecksEnabled: true, mtu: 1476, bgpState: i === 2 ? null : "BGP_UP" })),
    tunnelTraffic: timestamps.flatMap((timestamp, i) => [0, 1].flatMap(t => ["ingress", "egress"].map(direction => ({ timestamp, tunnel: `Example tunnel ${t + 1}`, direction, bits: 50000000 + i * 1000000, packets: 50000, bps: (50000000 + i * 1000000) / step })))),
    health: timestamps.flatMap((timestamp, i) => [0, 1, 2].map(t => ({ timestamp, tunnel: `Example tunnel ${t + 1}`, ok: i === 4 && t === 1 ? 35 : 99, timeout: i === 4 && t === 1 ? 65 : 1, other: 0, state: i === 4 && t === 1 ? 0.5 : 1 }))),
    routes: [{ id: "route-1", prefix: "203.0.113.0/24", nextHop: "10.0.0.1", priority: 100 }, { id: "route-2", prefix: "198.51.100.0/24", nextHop: "10.0.1.1", priority: 200 }],
    prefixes: [{ id: "prefix-1", cidr: "203.0.113.0/24", asn: 64500, advertised: true, rpki: "valid" }],
    rules: [{ id: "rule-1", name: "Example UDP policy", phase: "magic_transit", action: "block", enabled: true, expression: "ip.proto eq 17 and udp.dstport eq 53", rateLimit: "" }],
    ruleActivity: rank(["rule-1"]),
    protections: ["Network-layer DDoS", "Network Firewall", "Advanced TCP protection", "Advanced DNS protection", "Programmable flow protection"].map((name, i) => ({ key: `protection-${i}`, name, volume: { bits: 50000000, packets: 50000 }, series: traffic, breakdown: rank(i === 0 ? ["SYN flood", "UDP flood"] : ["Example protection rule"]), rules: [{ name: "Example protection rule", mode: "mitigation" }] })),
    capabilities: {}, errors: {}, notes: ["Synthetic fixture for offline verification. Network analytics estimates are sampled; probe success is not SLA uptime.", "Configuration is current. Event volumes are lifetime totals."],
  };
}
