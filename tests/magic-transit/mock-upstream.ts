export const TEST_TOKEN = "test-token-for-offline-fixture-only";
export const TEST_ACCOUNT = "00000000000000000000000000000000";
export function mockUpstream(options: { failHealth?: boolean; failRules?: boolean; failMain?: boolean; failAttackRankings?: boolean; omitAttackMeasurements?: boolean; maxDuration?: number; maxPageSize?: number } = {}) {
  let active = 0, maximum = 0;
  const calls: { url: string; query: string; variables: Record<string, unknown> }[] = [];
  const send = (account: unknown) => new Response(JSON.stringify({ data: { viewer: { accounts: [account] } }, errors: null }), { headers: { "content-type": "application/json" } });
  const fetchMock = async (url: string | URL | Request, init?: RequestInit): Promise<Response> => {
    active++; maximum = Math.max(active, maximum);
    await new Promise(resolve => setTimeout(resolve, 1));
    try {
      const address = String(url), body = init?.body ? JSON.parse(String(init.body)) : null;
      const query = body?.query ?? "", variables = body?.variables ?? {};
      calls.push({ url: address, query, variables });
      if (address.endsWith("/graphql")) {
        if (query.includes("settings {")) {
          const dataset = /settings\s*\{\s*(\w+)/.exec(query)![1];
          const dims = ["outcome", "mitigationSystem", "date", "datetimeHour", "datetimeFiveMinutes", "sourceCountry", "coloCountry", "sourceAsn", "sourceAsnName", "ipSourceAddress", "ipDestinationAddress", "ipDestinationSubnet", "destinationPort", "ipProtocolName", "tcpFlagsString", "ipTotalLengthBuckets", "coloCode", "tunnelName", "direction", "resultStatus", "ruleId", "attackVector", "protocolState", "dnsQueryType", "programName"];
          return send({ settings: { [dataset]: { enabled: true, maxDuration: options.maxDuration ?? 2764800, notOlderThan: 9676800, maxPageSize: options.maxPageSize ?? 10000, availableFields: [...dims.map(d => `dimensions_${d}`), "sum_bits", "sum_packets", "avg_tunnelState", "count", "attackId", "startDatetime", "endDatetime", "attackVector", "ipProtocolName", "destinationIp", "destinationPort", "bits", "packets", "droppedBits", "droppedPackets"] } } });
        }
        if ((options.failMain && query.includes("rows: magicTransitNetworkAnalytics")) || (options.failHealth && query.includes("rows: magicTransitTunnelHealthChecks"))) return new Response(JSON.stringify({ data: null, errors: [{ message: "Synthetic dataset unavailable" }] }));
        if (query.includes("rows: dosdAttackAnalyticsGroups")) return send({ rows: [{ attackId: "example-overlap", startDatetime: new Date(Date.now() - 2 * 3600000).toISOString(), endDatetime: null, attackVector: "SYN flood", ipProtocolName: "TCP", destinationIp: "203.0.113.10", ...(options.omitAttackMeasurements ? {} : { destinationPort: 443, bits: 100000, packets: 100, droppedBits: 80000, droppedPackets: 80 }) }] });
        const dims = /dimensions\s*\{([^}]+)\}/.exec(query)?.[1].trim().split(/\s+/) ?? [];
        if (query.includes("rows: dosdNetworkAnalyticsAdaptiveGroups") && dims.some(d => ["ipSourceAddress", "sourceCountry", "ipDestinationAddress"].includes(d))) {
          if (options.failAttackRankings) return new Response(JSON.stringify({ data: null, errors: [{ message: "Synthetic DDoS rankings unavailable" }] }));
          const values = [
            { ipSourceAddress: "192.0.2.9", sourceCountry: "JP", ipDestinationAddress: "203.0.113.10", destinationPort: 53, ipProtocolName: "UDP", bits: 240000, packets: 240 },
            { ipSourceAddress: "192.0.2.9", sourceCountry: "US", ipDestinationAddress: "203.0.113.10", destinationPort: 443, ipProtocolName: "TCP", bits: 640000, packets: 640 },
          ];
          return send({ rows: values.map(v => ({ dimensions: Object.fromEntries(dims.map(d => [d, v[d as keyof typeof v]])), sum: { bits: v.bits, packets: v.packets } })) });
        }
        const filter = variables.filter ?? {};
        const timestamp = new Date(filter.datetime_geq ?? Date.now() - 3600000).toISOString();
        const values: Record<string, string | number> = { sourceCountry: "US", coloCountry: "SG", sourceAsn: 64500, sourceAsnName: "Example ASN", ipSourceAddress: "192.0.2.1", ipDestinationAddress: "203.0.113.10", ipDestinationSubnet: "203.0.113.0/24", destinationPort: 443, ipProtocolName: "TCP", tcpFlagsString: "SYN", ipTotalLengthBuckets: "64–128", coloCode: "SIN", tunnelName: "Example tunnel", direction: "ingress", ruleId: "rule-1", attackVector: "SYN flood", protocolState: "new", dnsQueryType: "A", programName: "Example program", mitigationSystem: "dosd", outcome: "pass" };
        const dimensions = Object.fromEntries(dims.map(d => [d, d.startsWith("datetime") ? timestamp : d === "date" ? timestamp.slice(0, 10) : values[d] ?? "unknown"]));
        if (query.includes("rows: magicTransitTunnelHealthChecks")) return send({ rows: [{ count: 90, dimensions: { ...dimensions, resultStatus: "ok" }, avg: { tunnelState: 1 } }, { count: 10, dimensions: { ...dimensions, resultStatus: "timeout" }, avg: { tunnelState: 0 } }] });
        const rows = [{ dimensions, sum: { bits: 900000, packets: 900 } }];
        if (dims.includes("outcome")) rows.push({ dimensions: { ...dimensions, outcome: "drop" }, sum: { bits: 100000, packets: 100 } });
        return send({ rows });
      }
      if (options.failRules && address.includes("/rulesets/")) return new Response("", { status: 403 });
      let result: unknown = [];
      if (address.endsWith(TEST_ACCOUNT)) result = { name: "Example account" };
      if (address.includes("/gre_tunnels")) result = { gre_tunnels: [{ id: "tunnel-1", name: "Example tunnel", customer_gre_endpoint: "192.0.2.1", interface_address: "10.0.0.1/31", mtu: 1476, health_check: { enabled: true }, bgp: { md5_key: "must-never-leave-upstream" } }] };
      if (address.includes("/ipsec_tunnels")) result = { ipsec_tunnels: [] };
      if (address.includes("/cf_interconnects")) result = { interconnects: [] };
      if (address.includes("/magic/routes")) result = { routes: [{ id: "route-1", prefix: "203.0.113.0/24", nexthop: "10.0.0.1", priority: 100 }] };
      if (address.includes("/addressing/prefixes")) result = [{ id: "prefix-1", cidr: "203.0.113.0/24", asn: 64500, advertised: true, rpki_validation_state: "valid", ownership_validation_token: "must-never-leave-upstream" }];
      if (address.includes("/rulesets/")) result = { rules: [{ id: "rule-1", description: "Example rule", action: "block", enabled: true, expression: "ip.proto eq 17" }] };
      return new Response(JSON.stringify({ success: true, result }));
    } finally { active--; }
  };
  return { fetch: fetchMock as typeof fetch, calls, maxConcurrent: () => maximum };
}
