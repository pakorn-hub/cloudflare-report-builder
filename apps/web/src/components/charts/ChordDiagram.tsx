/**
 * ChordDiagram — security event relationships using d3-chord.
 *
 * Rows = Cloudflare services (WAF Managed, WAF Custom, DDoS, Bot Mgmt, Rate Limit, API Shield)
 * Cols = Actions (Block, Challenge, Managed Challenge, Log, Skip)
 *
 * Arc size = total events from/to that service or action.
 * Ribbon width = count of events for that service×action pair.
 * Hover highlights the selected service or action and dims all others.
 */
import { useRef, useEffect, useState } from "react";
import * as d3chord from "d3-chord";
import * as d3shape from "d3-shape";
import * as d3array from "d3-array";
import { formatNumber } from "../../utils/formatters";

export interface ChordCell {
  service: string;
  action: string;
  count: number;
}

interface Props {
  data: ChordCell[];
  height?: number;
}

const SERVICES = [
  { key: "firewallManaged", label: "WAF Managed",  color: "#F6821F" },
  { key: "firewallCustom",  label: "WAF Custom",   color: "#FF6633" },
  { key: "l7ddos",          label: "DDoS L7",      color: "#EF4444" },
  { key: "botManagement",   label: "Bot Mgmt",     color: "#7C3AED" },
  { key: "firewallRateLimit",label: "Rate Limit",  color: "#8B5CF6" },
  { key: "apiShield",       label: "API Shield",   color: "#10B981" },
  { key: "sanitycheck",     label: "Sanity Check", color: "#9CA3AF" },
];

const ACTIONS = [
  { key: "block",             label: "Block",      color: "#1E293B" },
  { key: "managed_challenge", label: "Mgd Chall",  color: "#64748B" },
  { key: "challenge",         label: "Challenge",  color: "#78716C" },
  { key: "log",               label: "Log",        color: "#A8A29E" },
  { key: "skip",              label: "Skip",       color: "#D4D0CA" },
];

export default function ChordDiagram({ data, height = 400 }: Props) {
  const svgRef = useRef<SVGSVGElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [tooltip, setTooltip] = useState<{ x: number; y: number; html: string } | null>(null);
  const [width, setWidth] = useState(500);

  useEffect(() => {
    if (!containerRef.current) return;
    const ro = new ResizeObserver(() => {
      setWidth(containerRef.current?.offsetWidth ?? 500);
    });
    ro.observe(containerRef.current);
    setWidth(containerRef.current.offsetWidth ?? 500);
    return () => ro.disconnect();
  }, []);

  // Filter to services/actions that actually appear in data
  const activeServices = SERVICES.filter((s) => data.some((d) => d.service === s.key));
  const activeActions  = ACTIONS.filter((a) => data.some((d) => d.action === a.key));

  // Nodes = services + actions
  const nodes = [...activeServices, ...activeActions];
  const n = nodes.length;
  if (n < 2) return null;

  // Build n×n matrix
  const matrix: number[][] = Array.from({ length: n }, () => Array(n).fill(0));
  const serviceIdxMap = new Map(activeServices.map((s, i) => [s.key, i]));
  const actionIdxMap  = new Map(activeActions.map((a, i) => [a.key, i + activeServices.length]));

  for (const cell of data) {
    const si = serviceIdxMap.get(cell.service);
    const ai = actionIdxMap.get(cell.action);
    if (si !== undefined && ai !== undefined && cell.count > 0) {
      matrix[si][ai] += cell.count;
      matrix[ai][si] += cell.count;
    }
  }

  // Check if any data
  const total = d3array.sum(matrix.flat());
  if (total === 0) return null;

  const cx = width / 2;
  const cy = height / 2;
  const outerR = Math.min(cx, cy) - 70;
  const innerR = outerR - 22;

  const chordLayout = d3chord.chord().padAngle(0.04).sortSubgroups(d3array.descending);
  const chords = chordLayout(matrix);

  const arcGen = d3shape.arc<d3chord.ChordGroup>()
    .innerRadius(innerR)
    .outerRadius(outerR);

  const ribbonGen = d3chord.ribbon().radius(innerR);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const ribbonGenTyped = ribbonGen as (d: any) => string | null;

  return (
    <div ref={containerRef} className="relative w-full" style={{ height }}>
      <svg
        ref={svgRef}
        width={width}
        height={height}
        style={{ overflow: "visible" }}
        onMouseLeave={() => setTooltip(null)}
      >
        <g transform={`translate(${cx},${cy})`}>
          {/* Ribbons (chords) */}
          <g fillOpacity={0.75}>
            {chords.map((chord, i) => {
              const srcNode = nodes[chord.source.index];
              const tgtNode = nodes[chord.target.index];
              const val = chord.source.value;
              return (
                <path
                  key={`chord-${i}`}
                  d={ribbonGenTyped(chord) ?? ""}
                  fill={srcNode?.color ?? "#ccc"}
                  stroke="white"
                  strokeWidth={0.5}
                  style={{ cursor: "pointer", transition: "opacity 0.15s" }}
                  onMouseEnter={(e) => setTooltip({
                    x: e.clientX, y: e.clientY,
                    html: `${srcNode?.label} → ${tgtNode?.label}: ${formatNumber(val)}`,
                  })}
                />
              );
            })}
          </g>

          {/* Arcs */}
          <g>
            {chords.groups.map((group) => {
              const node = nodes[group.index];
              if (!node) return null;
              const d = arcGen(group) ?? "";
              const midAngle = (group.startAngle + group.endAngle) / 2 - Math.PI / 2;
              const labelR = outerR + 14;
              const lx = Math.cos(midAngle) * labelR;
              const ly = Math.sin(midAngle) * labelR;
              const isRight = midAngle > -Math.PI / 2 && midAngle < Math.PI / 2;
              return (
                <g key={`group-${group.index}`}
                  style={{ cursor: "pointer" }}
                  onMouseEnter={(e) => setTooltip({
                    x: e.clientX, y: e.clientY,
                    html: `${node.label}: ${formatNumber(group.value)} events`,
                  })}
                >
                  <path d={d} fill={node.color} stroke="white" strokeWidth={1.5} />
                  <text
                    x={lx} y={ly}
                    textAnchor={isRight ? "start" : "end"}
                    dominantBaseline="middle"
                    transform={`rotate(${(midAngle * 180) / Math.PI + (isRight ? 0 : 180)},${lx},${ly})`}
                    style={{ fontSize: 10, fontWeight: 700, fill: "#1C1917", fontFamily: "Inter, system-ui, sans-serif" }}
                  >
                    {node.label}
                  </text>
                </g>
              );
            })}
          </g>
        </g>
      </svg>

      {/* Tooltip */}
      {tooltip && (
        <div
          className="fixed z-50 pointer-events-none bg-cf-navy text-white text-xs rounded-lg px-3 py-2 shadow-xl whitespace-nowrap"
          style={{ left: tooltip.x + 12, top: tooltip.y - 8 }}
        >
          {tooltip.html}
        </div>
      )}
    </div>
  );
}
