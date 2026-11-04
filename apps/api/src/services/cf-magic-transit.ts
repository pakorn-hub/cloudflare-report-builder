import type { MagicTransitData, MtCapability, MtVolume, MtRank, MtTrafficPoint } from "../../../../shared/magic-transit";
import { last30Days, lastCalendarMonth, lastPeriodRange, customDateRange, type ReportPeriod } from "./cf-graphql";
import type { ReportRangeMode } from "../types";

export interface MtInput {
  token: string; accountId: string; days: number; tzOffset: number;
  rangeMode?: ReportRangeMode; period?: ReportPeriod; monthsAgo?: number;
  sinceDate?: string; untilDate?: string; sinceTime?: string; untilTime?: string;
}
type Row = { dimensions?: Record<string, string | number>; sum?: Partial<MtVolume>; count?: number; avg?: { tunnelState?: number } };
type AttackRow = Record<string, string | number | null>;
const MAIN = "magicTransitNetworkAnalyticsAdaptiveGroups";
const DDOS = "dosdNetworkAnalyticsAdaptiveGroups";
const ATTACKS = "dosdAttackAnalyticsGroups";
const HEALTH = "magicTransitTunnelHealthChecksAdaptiveGroups";
const TUNNEL = "magicTransitTunnelTrafficAdaptiveGroups";
const FIREWALL = "magicFirewallNetworkAnalyticsAdaptiveGroups";
const OPTIONAL = ["flowtrackdNetworkAnalyticsAdaptiveGroups", "advancedDnsProtectionNetworkAnalyticsAdaptiveGroups", "programmableFlowProtectionNetworkAnalyticsAdaptiveGroups"];
const DATASETS = [MAIN, DDOS, ATTACKS, HEALTH, TUNNEL, FIREWALL, ...OPTIONAL];
const num = (v: unknown): number => typeof v === "number" && Number.isFinite(v) ? v : 0;
const nullableNum = (v: unknown): number | null => typeof v === "number" && Number.isFinite(v) ? v : null;
const str = (v: unknown): string => typeof v === "string" || typeof v === "number" ? String(v) : "";
const obj = (v: unknown): Record<string, unknown> => v && typeof v === "object" && !Array.isArray(v) ? v as Record<string, unknown> : {};
const arr = (v: unknown): Record<string, unknown>[] => Array.isArray(v) ? v.map(obj) : [];
const volume = (rows: Row[]): MtVolume => rows.reduce((v, r) => ({ bits: v.bits + num(r.sum?.bits), packets: v.packets + num(r.sum?.packets) }), { bits: 0, packets: 0 });

/** Four concurrent upstream calls; budgets and deadlines are per report, never per module. */
class Client {
  private active = 0;
  private waiters: (() => void)[] = [];
  private calls = 0;
  constructor(private token: string, private accountId: string) {}
  async request(url: string, init: RequestInit = {}): Promise<unknown> {
    if (++this.calls > 120) throw new Error("Report query budget reached; reduce the time range or number of dimensions.");
    if (this.active >= 4) await new Promise<void>(resolve => this.waiters.push(resolve));
    else this.active++;
    try {
      const res = await fetch(url, { ...init, headers: { Authorization: `Bearer ${this.token}`, "Content-Type": "application/json" }, signal: AbortSignal.timeout(25_000) });
      if (!res.ok) throw new Error(`Cloudflare API HTTP ${res.status}${res.status === 403 ? ": check account-scoped read permissions" : ""}`);
      return await res.json();
    } finally {
      const next = this.waiters.shift();
      if (next) next(); else this.active--;
    }
  }
  async gql(query: string, variables: Record<string, unknown> = {}): Promise<Record<string, unknown>> {
    const json = obj(await this.request("https://api.cloudflare.com/client/v4/graphql", {
      method: "POST", body: JSON.stringify({ query, variables: { accountTag: this.accountId, ...variables } }),
    }));
    const errors = arr(json.errors);
    if (errors.length) {
      // Do not echo upstream identifiers, token contents or customer values into stored diagnostics.
      const message = errors.map(e => str(e.message)).join("; ").replace(/[a-f0-9]{32}/gi, "[account]").replaceAll(this.token, "[redacted]");
      throw new Error(message.slice(0, 300));
    }
    const accounts = arr(obj(obj(json.data).viewer).accounts);
    if (!accounts.length) throw new Error("No account analytics returned; check Account Analytics Read and account access.");
    return accounts[0];
  }
  async rest(path: string): Promise<unknown> {
    const json = obj(await this.request(`https://api.cloudflare.com/client/v4/accounts/${this.accountId}${path ? `/${path}` : ""}`));
    if (json.success === false) throw new Error("Cloudflare configuration request failed; check permissions and feature availability.");
    if (num(obj(json.result_info).total_pages) > 1) throw new Error("Configuration is paginated; incomplete inventory omitted.");
    return json.result;
  }
}

function ranks(rows: Row[], dimensions: string[]): MtRank[] {
  const grouped = new Map<string, MtRank>();
  for (const row of rows) {
    const name = dimensions.map(d => str(row.dimensions?.[d]) || "Unclassified").join(" · ");
    const value = grouped.get(name) ?? { name, bits: 0, packets: 0 };
    value.bits += num(row.sum?.bits); value.packets += num(row.sum?.packets); grouped.set(name, value);
  }
  return [...grouped.values()].sort((a, b) => b.bits - a.bits);
}

export function aggregateMtSeries(rows: Row[], timeField: string, step: number, start: number, end: number): MtTrafficPoint[] {
  const groups = new Map<string, MtTrafficPoint>();
  for (const row of rows) {
    const timestamp = str(row.dimensions?.[timeField]);
    if (!Number.isFinite(Date.parse(timestamp))) continue;
    const outcome = str(row.dimensions?.outcome) || "unknown";
    const key = `${timestamp}|${outcome}`;
    const p = groups.get(key) ?? { timestamp, outcome, bits: 0, packets: 0, bps: 0, pps: 0 };
    p.bits += num(row.sum?.bits); p.packets += num(row.sum?.packets); groups.set(key, p);
  }
  return [...groups.values()].sort((a, b) => a.timestamp.localeCompare(b.timestamp)).map(p => {
    const t = Date.parse(p.timestamp);
    const seconds = Math.max(0.001, (Math.min(end, t + step * 1000) - Math.max(start, t)) / 1000);
    return { ...p, bps: p.bits / seconds, pps: p.packets / seconds };
  });
}

export function resolveMtRange(input: MtInput) {
  const { rangeMode = "rolling", tzOffset } = input;
  if (rangeMode === "custom") {
    const range = customDateRange(input.sinceDate ?? "", input.untilDate ?? "", tzOffset, input.sinceTime, input.untilTime);
    if (!range) throw new Error("Invalid custom report range");
    return range;
  }
  if (rangeMode === "calendar_month") return lastCalendarMonth(tzOffset, input.monthsAgo ?? 1);
  if (rangeMode === "period") return lastPeriodRange(input.period ?? "yesterday", tzOffset);
  return last30Days(input.days, tzOffset);
}

export function mtAttackOverlaps(row: AttackRow, start: number, end: number): boolean {
  const began = Date.parse(str(row.startDatetime));
  const ended = Date.parse(str(row.endDatetime));
  return Number.isFinite(began) && began < end && (!Number.isFinite(ended) || ended <= 0 || ended >= start);
}

export async function generateMagicTransitData(input: MtInput): Promise<MagicTransitData> {
  const range = resolveMtRange(input);
  const start = Date.parse(range.sinceTs);
  const end = Date.parse(range.untilTs) + 1; // Existing helpers expose inclusive last instant.
  const step = range.days <= 1 ? 300 : range.days <= 14 ? 3600 : 86400;
  const timeField = step === 300 ? "datetimeFiveMinutes" : step === 3600 ? "datetimeHour" : "date";
  const client = new Client(input.token, input.accountId);
  const errors: Record<string, string> = {};
  const notes = [
    "Network Analytics volumes are sampled estimates. Ingress and egress are reported separately and must not be added as unique traffic.",
    `Peak rates are maximum ${step / 60}-minute bucket-average rates, not instantaneous peaks. Partial boundary buckets use their observed duration.`,
    "Attack-event volumes describe the event lifetime, including portions outside the report window. Events are selected by overlap and deduplicated by attack ID.",
    "Configuration is a current snapshot, not historical configuration. Probe success is not an uptime SLA; average tunnel state is not a probe-success percentage.",
  ];
  async function safe<T>(key: string, work: () => Promise<T>, fallback: T): Promise<T> {
    try { return await work(); } catch (e) { errors[key] = e instanceof Error ? e.message : "Data unavailable"; return fallback; }
  }
  const capabilities: Record<string, MtCapability> = {};
  await Promise.all(DATASETS.map(ds => safe(`capability:${ds}`, async () => {
    const a = await client.gql(`query($accountTag: string) { viewer { accounts(filter: {accountTag: $accountTag}) { settings { ${ds} { enabled availableFields maxDuration notOlderThan maxPageSize } } } } }`);
    capabilities[ds] = obj(obj(a.settings)[ds]) as unknown as MtCapability;
  }, undefined)));
  if (!capabilities[MAIN]?.enabled) throw new Error("Magic Transit analytics unavailable. Check Account Analytics Read, account access and Magic Transit entitlement.");

  async function grouped(ds: string, dimensions: string[], filter: Record<string, unknown> = {}, bounds = { start, end }): Promise<Row[]> {
    const cap = capabilities[ds];
    if (!cap?.enabled) throw new Error("Dataset unavailable or not enabled for this account");
    if (cap.notOlderThan && bounds.start < Date.now() - cap.notOlderThan * 1000) throw new Error("Selected period exceeds this dataset's retention; choose a more recent period.");
    for (const field of dimensions) if (!cap.availableFields.includes(`dimensions_${field}`)) throw new Error(`Dataset does not expose ${field}`);
    for (const field of ["sum_bits", "sum_packets"]) if (!cap.availableFields.includes(field)) throw new Error(`Dataset does not expose ${field}; volume unavailable`);
    const limit = Math.min(cap.maxPageSize || 10000, 10000);
    const maxSpan = (cap.maxDuration || 604800) * 1000;
    const rows: Row[] = [];
    async function part(a: number, b: number, depth = 0): Promise<void> {
      const query = `query($accountTag: string, $filter: Account${ds[0].toUpperCase() + ds.slice(1)}Filter_InputObject) { viewer { accounts(filter: {accountTag: $accountTag}) { rows: ${ds}(limit: ${limit}, filter: $filter) { ${dimensions.length ? `dimensions { ${dimensions.join(" ")} }` : ""} sum { bits packets } } } } }`;
      const result = await client.gql(query, { filter: { ...filter, datetime_geq: new Date(a).toISOString(), datetime_lt: new Date(b).toISOString() } });
      const found = result.rows as Row[];
      if (!Array.isArray(found)) throw new Error("Invalid analytics response");
      if (found.some(r => nullableNum(r.sum?.bits) === null || nullableNum(r.sum?.packets) === null)) throw new Error("Incomplete volume measurements; aggregates omitted.");
      if (found.length >= limit) {
        if (depth >= 8 || b - a <= step * 1000) throw new Error("Analytics row limit reached; narrow the range. Incomplete aggregates omitted.");
        const mid = Math.floor((a + b) / 2); await part(a, mid, depth + 1); await part(mid, b, depth + 1);
      } else rows.push(...found);
    }
    for (let a = bounds.start; a < bounds.end; a += maxSpan) await part(a, Math.min(bounds.end, a + maxSpan));
    return rows;
  }
  const metric = (key: string, ds: string, dims: string[], filter: Record<string, unknown> = {}, bounds?: { start: number; end: number }) => safe<Row[] | null>(key, () => grouped(ds, dims, filter, bounds), null);
  const [totals, previous, series, systems, account] = await Promise.all([
    metric("traffic", MAIN, ["outcome"], { direction: "ingress" }),
    metric("previousTraffic", MAIN, ["outcome"], { direction: "ingress" }, { start: start - (end - start), end: start }),
    metric("trafficSeries", MAIN, [timeField, "outcome"], { direction: "ingress" }),
    metric("mitigationSystems", MAIN, ["mitigationSystem"], { direction: "ingress", outcome: "drop" }),
    safe("accountName", () => client.rest(""), null),
  ]);
  const selectedVolume = (rows: Row[] | null, outcome?: string): MtVolume | null => rows === null ? null : volume(outcome ? rows.filter(r => r.dimensions?.outcome === outcome) : rows);
  const traffic = aggregateMtSeries(series ?? [], timeField, step, start, end);
  const byTime = new Map<string, { bps: number; pps: number }>();
  for (const p of traffic) { const v = byTime.get(p.timestamp) ?? { bps: 0, pps: 0 }; v.bps += p.bps; v.pps += p.pps; byTime.set(p.timestamp, v); }

  // Query DDoS-specific joint dimensions, never relabel all-traffic IP rankings as attackers.
  // These high-priority queries run before the broader traffic fingerprint consumes the budget.
  const attackFilter = { direction: "ingress", outcome: "drop" };
  const [attackSourceRows, attackCountryRows, attackTargetRows] = await Promise.all([
    metric("attackSources", DDOS, ["ipSourceAddress", "sourceCountry"], attackFilter),
    metric("attackSourceCountries", DDOS, ["sourceCountry"], attackFilter),
    metric("attackTargets", DDOS, ["ipDestinationAddress", "destinationPort", "ipProtocolName"], attackFilter),
  ]);
  const attackRankings: NonNullable<MagicTransitData["attackRankings"]> = {
    sources: attackSourceRows === null ? null : ranks(attackSourceRows, ["ipSourceAddress", "sourceCountry"]).slice(0, 25).map(r => {
      const [ip, country] = r.name.split(" · "); return { ip, country, bits: r.bits, packets: r.packets };
    }),
    sourceCountries: attackCountryRows === null ? null : ranks(attackCountryRows, ["sourceCountry"]).slice(0, 25),
    targets: attackTargetRows === null ? null : ranks(attackTargetRows, ["ipDestinationAddress", "destinationPort", "ipProtocolName"]).slice(0, 25).map(r => {
      const [ip, port, protocol] = r.name.split(" · ");
      return { ip, port: /^\d+$/.test(port) ? Number(port) : null, protocol, application: null, bits: r.bits, packets: r.packets };
    }),
  };

  const rankings: Record<string, MtRank[]> = {};
  const rankDimensions: Record<string, string[]> = {
    sourceCountries: ["sourceCountry"], processingCountries: ["coloCountry"], sourceAsns: ["sourceAsn", "sourceAsnName"],
    sourceIps: ["ipSourceAddress"], destinationIps: ["ipDestinationAddress"], prefixes: ["ipDestinationSubnet"],
    ports: ["destinationPort"], protocols: ["ipProtocolName"], tcpFlags: ["tcpFlagsString"],
    packetSizes: ["ipTotalLengthBuckets"], colos: ["coloCode"],
  };
  await Promise.all(Object.entries(rankDimensions).map(([key, dims]) => safe(`rank:${key}`, async () => {
    rankings[key] = ranks(await grouped(MAIN, dims, { direction: "ingress" }), dims).slice(0, 25);
  }, undefined)));
  const pairs = await metric("protocolPorts", MAIN, ["ipProtocolName", "destinationPort"], { direction: "ingress" });
  const pairRanks = ranks(pairs ?? [], ["ipProtocolName", "destinationPort"]).slice(0, 80);
  const protocolPorts = pairRanks.map(r => { const [protocol, port] = r.name.split(" · "); return { protocol, port: Number(port) || 0, bits: r.bits, packets: r.packets }; });

  const attackRows = await safe<AttackRow[] | null>("attacks", async () => {
    const cap = capabilities[ATTACKS];
    if (!cap?.enabled) throw new Error("Attack analytics unavailable");
    if (cap.notOlderThan && start < Date.now() - cap.notOlderThan * 1000) throw new Error("Attack events outside retention");
    for (const field of ["attackId", "startDatetime", "endDatetime"]) if (!cap.availableFields.includes(field)) throw new Error("Attack event timing/identity fields unavailable");
    const fields = ["attackId", "startDatetime", "endDatetime", "attackVector", "ipProtocolName", "destinationIp", "destinationPort", "bits", "packets", "droppedBits", "droppedPackets"].filter(f => cap.availableFields.includes(f));
    const unique = new Map<string, AttackRow>();
    const limit = Math.min(cap.maxPageSize || 10000, 10000);
    // Scan retained event start times, then select overlaps locally. This includes
    // attacks that began before the window without assuming a dashboard-only end-state filter.
    const lookback = cap.notOlderThan ? Math.max(0, Date.now() - cap.notOlderThan * 1000 + 1000) : start;
    const chunk = (cap.maxDuration || 604800) * 1000;
    for (let a = lookback; a < end; a += chunk) {
      const b = Math.min(end, a + chunk);
      const query = `query($accountTag: string, $from: string, $to: string) { viewer { accounts(filter: {accountTag: $accountTag}) { rows: ${ATTACKS}(limit: ${limit}, filter: { startDatetime_geq: $from, startDatetime_leq: $to }, orderBy: [startDatetime_ASC]) { ${fields.join(" ")} } } } }`;
      const result = await client.gql(query, { from: new Date(a).toISOString(), to: new Date(b - 1).toISOString() });
      const rows = result.rows as AttackRow[];
      if (!Array.isArray(rows) || rows.length >= limit) throw new Error("Attack event limit reached or response invalid; event count unavailable.");
      for (const row of rows) if (mtAttackOverlaps(row, start, end)) unique.set(str(row.attackId), row);
    }
    return [...unique.values()];
  }, null);
   const attacks = (attackRows ?? []).map(r => ({ id: str(r.attackId), start: str(r.startDatetime), end: !str(r.endDatetime) || !Number.isFinite(Date.parse(str(r.endDatetime))) || Date.parse(str(r.endDatetime)) <= 0 ? null : str(r.endDatetime), vector: str(r.attackVector) || "Unclassified", protocol: str(r.ipProtocolName), destination: str(r.destinationIp), port: nullableNum(r.destinationPort), bits: nullableNum(r.bits), packets: nullableNum(r.packets), droppedBits: nullableNum(r.droppedBits), droppedPackets: nullableNum(r.droppedPackets) }));

  const [gre, ipsec, cni, routesResult, prefixesResult, healthRows, tunnelRows] = await Promise.all([
    safe("tunnels:GRE", () => client.rest("magic/gre_tunnels"), null), safe("tunnels:IPsec", () => client.rest("magic/ipsec_tunnels"), null),
    safe("tunnels:CNI", () => client.rest("magic/cf_interconnects"), null), safe("routes", () => client.rest("magic/routes"), null),
    safe("prefixes", () => client.rest("addressing/prefixes"), null),
    safe<Row[] | null>("health", async () => {
      const cap = capabilities[HEALTH];
      if (!cap?.enabled) throw new Error("Tunnel health unavailable");
       if (cap.notOlderThan && start < Date.now() - cap.notOlderThan * 1000) throw new Error("Tunnel health outside retention");
       for (const field of ["count", `dimensions_${timeField}`, "dimensions_tunnelName", "dimensions_resultStatus"]) if (!cap.availableFields.includes(field)) throw new Error(`Tunnel health does not expose ${field}`);
       const limit = Math.min(cap.maxPageSize || 10000, 10000);
       const chunk = Math.min(cap.maxDuration || 604800, 604800) * 1000;
      const rows: Row[] = [];
      async function part(a: number, b: number, depth = 0): Promise<void> {
         const query = `query($accountTag: string, $filter: AccountMagicTransitTunnelHealthChecksAdaptiveGroupsFilter_InputObject) { viewer { accounts(filter: {accountTag: $accountTag}) { rows: ${HEALTH}(limit: ${limit}, filter: $filter) { count ${cap.availableFields.includes("avg_tunnelState") ? "avg { tunnelState }" : ""} dimensions { ${timeField} tunnelName resultStatus } } } } }`;
        const r = await client.gql(query, { filter: { datetime_geq: new Date(a).toISOString(), datetime_lt: new Date(b).toISOString() } });
        const found = r.rows as Row[];
         if (!Array.isArray(found)) throw new Error("Invalid tunnel health response");
         if (found.some(r => nullableNum(r.count) === null)) throw new Error("Probe counts unavailable");
         if (found.length >= limit) {
           if (depth >= 8 || b - a <= step * 1000) throw new Error("Tunnel health row limit reached; use a shorter period.");
          const mid = Math.floor((a + b) / 2); await part(a, mid, depth + 1); await part(mid, b, depth + 1);
        } else rows.push(...found);
      }
       for (let a = start; a < end; a += chunk) await part(a, Math.min(end, a + chunk));
      return rows;
    }, null),
    metric("tunnelTraffic", TUNNEL, [timeField, "tunnelName", "direction"]),
  ]);
  const tunnels: MagicTransitData["tunnels"] = [];
  for (const [result, type, key] of [[gre, "GRE", "gre_tunnels"], [ipsec, "IPsec", "ipsec_tunnels"], [cni, "CNI", "interconnects"]] as const) {
    for (const r of arr(obj(result)[key])) tunnels.push({ id: str(r.id), name: str(r.name), type, endpoint: str(r.customer_gre_endpoint || r.customer_endpoint || r.pop_name), interfaceAddress: str(r.interface_address), healthChecksEnabled: typeof obj(r.health_check).enabled === "boolean" ? obj(r.health_check).enabled as boolean : null, mtu: typeof r.mtu === "number" ? r.mtu : null, bgpState: str(obj(r.bgp_status).state) || null });
  }
  const healthMap = new Map<string, MagicTransitData["health"][number] & { weighted: number; weight: number }>();
  for (const r of healthRows ?? []) {
    const timestamp = str(r.dimensions?.[timeField]), tunnel = str(r.dimensions?.tunnelName);
    const key = `${timestamp}|${tunnel}`; const p = healthMap.get(key) ?? { timestamp, tunnel, ok: 0, timeout: 0, other: 0, state: null, weighted: 0, weight: 0 };
    const count = num(r.count), status = str(r.dimensions?.resultStatus);
    if (status === "ok") p.ok += count; else if (status === "timeout") p.timeout += count; else p.other += count;
    if (typeof r.avg?.tunnelState === "number") { p.weighted += r.avg.tunnelState * count; p.weight += count; }
    healthMap.set(key, p);
  }
  const health = [...healthMap.values()].map(({ weighted, weight, ...p }) => ({ ...p, state: weight ? weighted / weight : null, stateSamples: weight })).sort((a, b) => a.timestamp.localeCompare(b.timestamp));
  const checks = health.reduce((v, p) => v + p.ok + p.timeout + p.other, 0), ok = health.reduce((v, p) => v + p.ok, 0);
  const tunnelMap = new Map<string, MagicTransitData["tunnelTraffic"][number]>();
  for (const r of tunnelRows ?? []) {
    const timestamp = str(r.dimensions?.[timeField]), tunnel = str(r.dimensions?.tunnelName), direction = str(r.dimensions?.direction);
    const key = `${timestamp}|${tunnel}|${direction}`; const p = tunnelMap.get(key) ?? { timestamp, tunnel, direction, bits: 0, packets: 0, bps: 0 }; p.bits += num(r.sum?.bits); p.packets += num(r.sum?.packets); tunnelMap.set(key, p);
  }
  const tunnelTraffic = [...tunnelMap.values()].map(p => ({ ...p, bps: p.bits / Math.max(0.001, (Math.min(end, Date.parse(p.timestamp) + step * 1000) - Math.max(start, Date.parse(p.timestamp))) / 1000) })).sort((a, b) => a.timestamp.localeCompare(b.timestamp));
  const rules: MagicTransitData["rules"] = [];
  await Promise.all(["ddos_l4", "magic_transit", "magic_transit_ratelimit", "magic_transit_managed", "magic_transit_ids_managed"].map(phase => safe(`rules:${phase}`, async () => {
    const result = obj(await client.rest(`rulesets/phases/${phase}/entrypoint`));
    for (const r of arr(result.rules)) rules.push({ id: str(r.id), name: str(r.description || r.ref || r.id), phase, action: str(r.action), enabled: r.enabled !== false, expression: str(r.expression), rateLimit: Object.keys(obj(r.ratelimit)).length ? JSON.stringify(r.ratelimit) : "" });
  }, undefined)));
  const ruleRows = await metric("ruleActivity", FIREWALL, ["ruleId"], { direction: "ingress" });
  const protections: MagicTransitData["protections"] = [];
  await Promise.all([
    [DDOS, "Network-layer DDoS", "attackVector", ""],
    [FIREWALL, "Network Firewall", "ruleId", ""],
    [OPTIONAL[0], "Advanced TCP protection", "protocolState", "magic/advanced_tcp_protection/configs/tcp_flow_protection/rules"],
    [OPTIONAL[1], "Advanced DNS protection", "dnsQueryType", "magic/advanced_dns_protection/configs/dns_protection/rules"],
    [OPTIONAL[2], "Programmable flow protection", "programName", ""],
  ].map(async ([ds, name, dimension, configPath]) => {
    const [v, s, b, config] = await Promise.all([
      metric(`protection:${name}`, ds, [], { direction: "ingress", outcome: "drop" }),
      metric(`protectionSeries:${name}`, ds, [timeField, "outcome"], { direction: "ingress" }),
      metric(`protectionRank:${name}`, ds, [dimension], { direction: "ingress", outcome: "drop" }),
      configPath ? safe(`protectionConfig:${name}`, () => client.rest(configPath), null) : Promise.resolve(null),
    ]);
    protections.push({ key: ds, name, volume: v === null ? null : volume(v), series: aggregateMtSeries(s ?? [], timeField, step, start, end), breakdown: ranks(b ?? [], [dimension]).slice(0, 15), rules: arr(config).map(r => ({ name: str(r.name || r.id), mode: str(r.mode) })) });
  }));
  protections.sort((a, b) => a.name.localeCompare(b.name));
  notes.push("Rankings show up to 25 categories, and the protocol-port matrix up to 80 measured pairs; these are not full-population distributions.");
  notes.push("Attack overlap selection scans retained event start times. Events that started before event retention cannot be reconstructed.");
  notes.push("Attack source/target rankings show up to 25 categories of sampled DDoS-mitigated ingress traffic within the selected window, not attack-event lifetime totals. Source IPs are observed packet addresses, not attribution. Application names require explicit mappings and are not inferred from ports.");
  return {
    meta: { accountId: input.accountId, accountName: str(obj(account).name) || "Magic Transit account", generatedAt: new Date().toISOString(), configurationAt: new Date().toISOString(), since: range.since, until: range.until, sinceTs: range.sinceTs, untilTs: range.untilTs, days: range.days, periodLabel: range.periodLabel ?? `${range.days}-Day`, tzOffset: input.tzOffset, bucketSeconds: step },
    summary: { traffic: selectedVolume(totals), dropped: selectedVolume(totals, "drop"), passed: selectedVolume(totals, "pass"), previousTraffic: selectedVolume(previous), previousDropped: selectedVolume(previous, "drop"), peakBps: series === null ? null : Math.max(0, ...[...byTime.values()].map(p => p.bps)), peakPps: series === null ? null : Math.max(0, ...[...byTime.values()].map(p => p.pps)), attackCount: attackRows === null ? null : attacks.length, probeSuccessPct: healthRows === null || !checks ? null : ok / checks * 100 },
    traffic, outcomes: ranks(totals ?? [], ["outcome"]), mitigationSystems: ranks(systems ?? [], ["mitigationSystem"]), rankings, protocolPorts, attacks, attackRankings, tunnels, tunnelTraffic, health,
    routes: arr(obj(routesResult).routes).map(r => ({ id: str(r.id), prefix: str(r.prefix), nextHop: str(r.nexthop), priority: num(r.priority) })),
    prefixes: arr(prefixesResult).map(r => ({ id: str(r.id), cidr: str(r.cidr), asn: typeof r.asn === "number" ? r.asn : null, advertised: typeof r.advertised === "boolean" ? r.advertised : null, rpki: str(r.rpki_validation_state) })),
    rules, ruleActivity: ranks(ruleRows ?? [], ["ruleId"]), protections, capabilities, errors, notes,
  };
}
