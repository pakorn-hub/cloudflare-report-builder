import type { MagicTransitData, MtAttack, MtHealthPoint } from "../../../../../shared/magic-transit";

export const mtNumber = (v: number | null | undefined, unit = "") => v == null ? "Unavailable" : `${Intl.NumberFormat("en", { notation: "compact", maximumFractionDigits: 1 }).format(v)}${unit ? ` ${unit}` : ""}`;
export const mtBytes = (bits: number | null | undefined) => bits == null ? "Unavailable" : mtNumber(bits / 8, "B");
export const mtRate = (bits: number) => mtNumber(bits, "bps");
export function mtDate(t: string, tzOffset = 0) {
  return new Date(Date.parse(t) - tzOffset * 60000).toLocaleString("en-GB", { month: "short", day: "2-digit", hour: "2-digit", minute: "2-digit", timeZone: "UTC" });
}

export function HealthHeatmap({ health, tzOffset, timestamps }: { health: MtHealthPoint[]; tzOffset: number; timestamps?: string[] }) {
  const times = timestamps ?? [...new Set(health.map(p => p.timestamp))].sort();
  const tunnels = [...new Set(health.map(p => p.tunnel))].sort();
  const cells = new Map(health.map(p => [`${p.tunnel}|${p.timestamp}`, p]));
  if (!health.length) return <p className="mt-empty">Tunnel probe measurements are unavailable for this period.</p>;
  // Pagination keeps every tunnel available without creating an unprintable single giant chart.
  const pages = Array.from({ length: Math.ceil(tunnels.length / 12) }, (_, page) => {
    const names = tunnels.slice(page * 12, page * 12 + 12), left = 210, width = 750 / times.length;
    return <svg key={page} viewBox={`0 0 990 ${names.length * 30 + 60}`} className="mt-svg" role="img" aria-label="Tunnel probe success heatmap">
      {names.map((name, row) => <g key={name}>
        <text x="0" y={row * 30 + 27} fontSize="11" fill="#355269">{name.slice(0, 29)}<title>{name}</title></text>
        {times.map((t, col) => { const p = cells.get(`${name}|${t}`), total = p ? p.ok + p.timeout + p.other : 0, ratio = total ? p!.ok / total : null;
          const color = ratio == null ? "#e2e8f0" : ratio >= 0.99 ? "#149d91" : ratio >= 0.8 ? "#9ecdb5" : ratio >= 0.4 ? "#efb76d" : "#dd5864";
          return <rect key={t} x={left + col * width} y={row * 30 + 10} width={Math.max(0.5, width - 1)} height="23" rx="2" fill={color}><title>{name} · {mtDate(t, tzOffset)} · {ratio == null ? "No samples" : `${(ratio * 100).toFixed(1)}% probes passed (${total} samples)`}</title></rect>;
        })}
      </g>)}
      <text x={left} y={names.length * 30 + 35} fontSize="10" fill="#64748b">{mtDate(times[0], tzOffset)}</text>
      <text x="960" y={names.length * 30 + 35} textAnchor="end" fontSize="10" fill="#64748b">{mtDate(times[times.length - 1], tzOffset)}</text>
    </svg>;
  });
  return <div>{pages[0]}{pages.length > 1 && <details className="mt-visual-evidence"><summary>More tunnel heatmaps · {tunnels.length - 12} tunnels</summary><div className="mt-visual-scroll">{pages.slice(1)}</div></details>}<p className="mt-caption">Teal ≥99% · light green ≥80% · amber ≥40% · red &lt;40% · gray: no samples. These are display bands for probe success, not routing-state thresholds.</p></div>;
}

export function AttackTimeline({ attacks, start, end, tzOffset }: { attacks: MtAttack[]; start: string; end: string; tzOffset: number }) {
  const a = Date.parse(start), b = Date.parse(end), duration = Math.max(1, b - a);
  if (!attacks.length) return <p className="mt-empty">No attack events returned. Check the data-availability notes if attack analytics could not be queried.</p>;
  const top = [...attacks].sort((x, y) => (y.droppedBits ?? -1) - (x.droppedBits ?? -1)).slice(0, 8);
  return <><svg viewBox={`0 0 990 ${top.length * 30 + 65}`} className="mt-svg" role="img" aria-label="Attack timeline clipped to the report period">
    {top.map((attack, i) => { const x = 240 + Math.max(0, Date.parse(attack.start) - a) / duration * 700;
      const right = 240 + Math.min(duration, (attack.end ? Date.parse(attack.end) : b) - a) / duration * 700;
      return <g key={attack.id}>
        <text x="0" y={i * 30 + 24} fontSize="11" fill="#355269">{attack.vector.slice(0, 32)}</text>
        <line x1="240" x2="940" y1={i * 30 + 18} y2={i * 30 + 18} stroke="#eef2f6" />
        <rect x={x} y={i * 30 + 9} width={Math.max(3, right - x)} height="18" rx="4" fill={attack.end ? "#ef8740" : "#db5263"}><title>{attack.vector} · {mtDate(attack.start, tzOffset)} → {attack.end ? mtDate(attack.end, tzOffset) : "ongoing"} · {mtBytes(attack.droppedBits)} dropped (event lifetime)</title></rect>
      </g>;
    })}
    <text x="240" y={top.length * 30 + 35} fontSize="10" fill="#64748b">{mtDate(start, tzOffset)}</text>
    <text x="940" y={top.length * 30 + 35} textAnchor="end" fontSize="10" fill="#64748b">{mtDate(end, tzOffset)}</text>
  </svg><p className="mt-caption">Up to 8 events ranked by lifetime dropped volume; all returned events remain in the evidence table. Timeline bars are clipped to the selected period; red marks ongoing events.</p></>;
}

export function ProtocolPortMatrix({ data }: { data: MagicTransitData["protocolPorts"] }) {
  const protocols = [...new Set(data.map(p => p.protocol))];
  const ports = [...new Set(data.slice(0, 24).map(p => p.port))];
  if (!data.length) return <p className="mt-empty">No joint protocol/port measurements available.</p>;
  const maximum = Math.max(1, ...data.map(p => p.bits)), cell = 780 / Math.max(1, ports.length);
  return <><svg className="mt-svg" viewBox={`0 0 990 ${protocols.length * 45 + 65}`} role="img" aria-label="Measured protocol and destination-port traffic matrix">
    {protocols.map((protocol, row) => <g key={protocol}><text x="0" y={row * 45 + 27} fontSize="12" fill="#355269">{protocol}</text>
      {ports.map((port, col) => { const value = data.find(p => p.protocol === protocol && p.port === port);
        return <g key={port}><rect x={180 + col * cell} y={row * 45} width={cell - 2} height="42" fill="#f1f5f9" />{value && <circle cx={180 + col * cell + cell / 2} cy={row * 45 + 21} r={Math.min(cell / 2 - 2, 18) * Math.sqrt(value.bits / maximum)} fill="#098fac"><title>{protocol} · port {port} · {mtBytes(value.bits)} · {mtNumber(value.packets, "packets")}</title></circle>}</g>;
      })}</g>)}
    {ports.map((port, col) => <text key={port} x={180 + col * cell + cell / 2} y={protocols.length * 45 + 25} textAnchor="middle" fontSize="10" fill="#64748b">{port}</text>)}
  </svg><p className="mt-caption">Bubble area represents measured bytes for each pair. Up to 24 ports from the top measured pairs; absent cells are not asserted as zero.</p></>;
}

/** Deterministic SVG relationship graph: no invented geographical or traffic paths. */
export function RouteTopology({ routes, tunnels }: Pick<MagicTransitData, "routes" | "tunnels">) {
  const shown = routes.slice(0, 8);
  if (!shown.length) return <p className="mt-empty">No static routes available to visualize.</p>;
  return <><svg className="mt-svg" viewBox={`0 0 990 ${shown.length * 54 + 65}`} role="img" aria-label="Configured prefix, route and tunnel relationships">
    {["DESTINATION PREFIX", "STATIC NEXT HOP", "MATCHED TUNNEL"].map((label, i) => <text key={label} x={20 + i * 330} y="20" fontSize="10" letterSpacing="1.5" fill="#6b8191">{label}</text>)}
    {shown.map((route, i) => {
      const tunnel = tunnels.find(t => t.interfaceAddress.split("/")[0] === route.nextHop || t.endpoint === route.nextHop);
      const y = 38 + i * 54;
      return <g key={route.id}>
        <path d={`M270 ${y + 15} C305 ${y + 15} 305 ${y + 15} 350 ${y + 15}`} stroke="#9cb7c6" fill="none" strokeWidth="2" />
        {tunnel && <path d={`M600 ${y + 15} C645 ${y + 15} 645 ${y + 15} 680 ${y + 15}`} stroke="#1199a4" fill="none" strokeWidth="2" />}
        {[route.prefix, `${route.nextHop} · priority ${route.priority}`, tunnel ? `${tunnel.type} · ${tunnel.name}` : "Tunnel relationship unavailable"].map((label, j) => <g key={j}><rect x={20 + j * 330} y={y} width="250" height="32" rx="6" fill={j === 2 && tunnel ? "#e5f7f4" : "#f0f5f8"} /><text x={30 + j * 330} y={y + 21} fontSize="11" fill="#264c67">{label.slice(0, 36)}<title>{label}</title></text></g>)}
      </g>;
    })}
  </svg><p className="mt-caption">Up to 8 configured routes; all returned routes remain in the evidence table. Tunnel links require an exact endpoint/interface match; unresolved relationships are left disconnected.</p></>;
}
