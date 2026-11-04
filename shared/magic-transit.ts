/** Public, credential-free contract shared by the Worker and report template. */
export interface MtVolume { bits: number; packets: number }
export interface MtRank extends MtVolume { name: string }
export interface MtAttackSource extends MtVolume { ip: string; country: string }
export interface MtAttackTarget extends MtVolume {
  ip: string; port: number | null; protocol: string;
  /** Only an explicit application mapping may populate this; ports are not app identities. */
  application: string | null;
}
export interface MtTrafficPoint extends MtVolume { timestamp: string; outcome: string; bps: number; pps: number }
export interface MtAttack {
  id: string; start: string; end: string | null; vector: string; protocol: string;
  destination: string; port: number | null; bits: number | null; packets: number | null;
  droppedBits: number | null; droppedPackets: number | null;
}
export interface MtTunnel {
  id: string; name: string; type: "GRE" | "IPsec" | "CNI";
  endpoint: string; interfaceAddress: string; healthChecksEnabled: boolean | null;
  mtu: number | null; bgpState: string | null;
}
export interface MtTunnelPoint extends MtVolume { timestamp: string; tunnel: string; direction: string; bps: number }
export interface MtHealthPoint {
  timestamp: string; tunnel: string; ok: number; timeout: number; other: number;
  state: number | null;
  /** Number of probes contributing to the routing-state mean, when available. */
  stateSamples?: number;
}
export interface MtRule {
  id: string; name: string; phase: string; action: string; enabled: boolean;
  expression: string; rateLimit: string;
}
export interface MtRoute { id: string; prefix: string; nextHop: string; priority: number }
export interface MtPrefix { id: string; cidr: string; asn: number | null; advertised: boolean | null; rpki: string }
export interface MtProtection {
  key: string; name: string; volume: MtVolume | null;
  series: MtTrafficPoint[]; breakdown: MtRank[];
  rules: { name: string; mode: string }[];
}
export interface MtCapability {
  enabled: boolean; availableFields: string[]; maxDuration: number;
  notOlderThan: number; maxPageSize?: number;
}
export interface MagicTransitData {
  meta: {
    accountId: string; accountName: string; generatedAt: string;
    since: string; until: string; sinceTs: string; untilTs: string;
    days: number; periodLabel: string; tzOffset: number; bucketSeconds: number;
    configurationAt: string;
  };
  summary: {
    traffic: MtVolume | null; dropped: MtVolume | null; passed: MtVolume | null;
    previousTraffic: MtVolume | null; previousDropped: MtVolume | null;
    peakBps: number | null; peakPps: number | null;
    attackCount: number | null; probeSuccessPct: number | null;
  };
  traffic: MtTrafficPoint[];
  outcomes: MtRank[];
  mitigationSystems: MtRank[];
  rankings: Record<string, MtRank[]>;
  protocolPorts: { protocol: string; port: number; bits: number; packets: number }[];
  attacks: MtAttack[];
  /** Selected-window, DDoS-mitigated ingress volumes. Optional for older archived reports. */
  attackRankings?: {
    sources: MtAttackSource[] | null;
    sourceCountries: MtRank[] | null;
    targets: MtAttackTarget[] | null;
  };
  tunnels: MtTunnel[];
  tunnelTraffic: MtTunnelPoint[];
  health: MtHealthPoint[];
  routes: MtRoute[];
  prefixes: MtPrefix[];
  rules: MtRule[];
  ruleActivity: MtRank[];
  protections: MtProtection[];
  capabilities: Record<string, MtCapability>;
  errors: Record<string, string>;
  notes: string[];
}
