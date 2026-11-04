/**
 * DirectedChordDiagram — browser × device relationship.
 * Inspired by https://observablehq.com/@d3/directed-chord-diagram/2
 *
 * Shows flows between Device Types (Desktop/Mobile/Tablet/Bot) and
 * Browser Families (Chrome/Firefox/Safari/Edge/...).
 * Arc size = total requests from that node.
 * Ribbon width = requests for that device×browser combination.
 * Arrow heads on ribbons indicate direction of the relationship.
 */
import { useRef, useEffect, useState, useCallback } from "react";
import * as d3chord from "d3-chord";
import * as d3shape from "d3-shape";
import * as d3array from "d3-array";
import { formatNumber } from "../../utils/formatters";

export interface ChordFlowItem {
  from: string;   // device type
  to: string;     // browser
  value: number;  // request count
}

interface Props {
  data: ChordFlowItem[];
  title?: string;
  subtitle?: string;
  height?: number;
}

// Colors for groups — device types get warm tones, browsers get cool tones
const GROUP_COLORS: Record<string, string> = {
  // Device types
  Desktop:    "#F6821F",
  Mobile:     "#FF6633",
  Tablet:     "#FBAD41",
  Bot:        "#7C3AED",
  Unknown:    "#9CA3AF",
  // Browsers
  Chrome:     "#3B82F6",
  Firefox:    "#F97316",
  Safari:     "#34D399",
  Edge:       "#60A5FA",
  "Samsung Internet": "#8B5CF6",
  Opera:      "#EF4444",
  Chromium:   "#93C5FD",
  Other:      "#D1D5DB",
};

function getColor(name: string): string {
  return GROUP_COLORS[name] ?? `hsl(${(name.charCodeAt(0) * 47) % 360}, 60%, 55%)`;
}

export default function DirectedChordDiagram({ data, title, subtitle, height = 440 }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(500);
  const [tooltip, setTooltip] = useState<{ x: number; y: number; html: string } | null>(null);

  useEffect(() => {
    if (!containerRef.current) return;
    const ro = new ResizeObserver(() => setWidth(containerRef.current?.offsetWidth ?? 500));
    ro.observe(containerRef.current);
    setWidth(containerRef.current.offsetWidth ?? 500);
    return () => ro.disconnect();
  }, []);

  const showTip = useCallback((e: React.MouseEvent, html: string) => {
    setTooltip({ x: e.clientX, y: e.clientY, html });
  }, []);

  if (!data.length) return null;

  // Collect unique nodes — devices first, then browsers
  const devices = [...new Set(data.map((d) => d.from))].sort();
  const browsers = [...new Set(data.map((d) => d.to))].sort();
  const names = [...devices, ...browsers];
  const n = names.length;
  const idx = new Map(names.map((name, i) => [name, i]));

  // Build n×n matrix (devices → browsers, browsers → devices 0)
  const matrix: number[][] = Array.from({ length: n }, () => Array(n).fill(0));
  for (const item of data) {
    const fi = idx.get(item.from);
    const ti = idx.get(item.to);
    if (fi !== undefined && ti !== undefined) {
      matrix[fi][ti] += item.value;
    }
  }

  // Check there's actual data
  const total = d3array.sum(matrix.flat());
  if (total === 0) return null;

  const cx = width / 2;
  const cy = height / 2;
  const outerR = Math.min(cx, cy) - 80;
  const innerR = outerR - 20;

  // Chord layout with sorted subgroups
  const chordLayout = d3chord
    .chordDirected()
    .padAngle(12 / outerR)
    .sortSubgroups(d3array.descending)
    .sortChords(d3array.descending);

  const chords = chordLayout(matrix);

  // Arc generator
  const arcGen = d3shape
    .arc<d3chord.ChordGroup>()
    .innerRadius(innerR)
    .outerRadius(outerR);

  // Ribbon generator (directed — shows arrow)
  const ribbonGen = d3chord
    .ribbonArrow()
    .radius(innerR - 1)
    .padAngle(1 / innerR);

  return (
    <div className="bg-white rounded-xl shadow-sm border border-cf-gray-200 p-5">
      {title && (
        <div className="mb-4">
          <h3 className="text-sm font-semibold text-cf-navy">{title}</h3>
          {subtitle && <p className="text-xs text-cf-gray-500 mt-0.5">{subtitle}</p>}
        </div>
      )}

      <div ref={containerRef} className="relative" style={{ height }}>
        <svg
          width={width}
          height={height}
          style={{ overflow: "visible" }}
          onMouseLeave={() => setTooltip(null)}
        >
          <defs>
            {/* Arrow marker for directed ribbons */}
            <marker
              id="chord-arrow"
              viewBox="-5 -5 10 10"
              markerWidth="4"
              markerHeight="4"
              orient="auto-start-reverse"
            >
              <path d="M0,-5L10,0L0,5Z" fill="#44403C" fillOpacity={0.6} />
            </marker>
          </defs>

          <g transform={`translate(${cx},${cy})`}>
            {/* Ribbons (directed flows) */}
            <g fillOpacity={0.7}>
              {chords.map((chord, i) => {
                const srcName = names[chord.source.index];
                const srcColor = getColor(srcName);
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                const d = ribbonGen(chord as any) ?? "";
                return (
                  <path
                    key={`ribbon-${i}`}
                    d={d}
                    fill={srcColor}
                    stroke="white"
                    strokeWidth={0.5}
                    style={{ cursor: "pointer", transition: "fill-opacity 0.15s" }}
                    onMouseEnter={(e) => {
                      const from = names[chord.source.index];
                      const to = names[chord.target.index];
                      const val = chord.source.value;
                      showTip(e, `${from} → ${to}: ${formatNumber(val)} requests`);
                    }}
                    onMouseMove={(e) => setTooltip((t) => t ? { ...t, x: e.clientX, y: e.clientY } : null)}
                  />
                );
              })}
            </g>

            {/* Arcs */}
            <g>
              {chords.groups.map((group) => {
                const name = names[group.index];
                const color = getColor(name);
                const dArc = arcGen(group) ?? "";
                const midAngle = (group.startAngle + group.endAngle) / 2 - Math.PI / 2;
                const labelR = outerR + 14;
                const lx = Math.cos(midAngle) * labelR;
                const ly = Math.sin(midAngle) * labelR;
                const isRight = Math.cos(midAngle) >= 0;
                // Rotate label to follow arc
                const rotateDeg = (midAngle * 180) / Math.PI + (isRight ? 0 : 180);

                return (
                  <g
                    key={`group-${group.index}`}
                    style={{ cursor: "pointer" }}
                    onMouseEnter={(e) => showTip(e, `${name}: ${formatNumber(group.value)} requests`)}
                    onMouseMove={(e) => setTooltip((t) => t ? { ...t, x: e.clientX, y: e.clientY } : null)}
                  >
                    <path d={dArc} fill={color} stroke="white" strokeWidth={1.5} />
                    {/* Show label only if arc is wide enough */}
                    {group.endAngle - group.startAngle > 0.08 && (
                      <text
                        transform={`rotate(${rotateDeg},${lx},${ly})`}
                        x={lx}
                        y={ly}
                        textAnchor={isRight ? "start" : "end"}
                        dominantBaseline="middle"
                        style={{
                          fontSize: 10,
                          fontWeight: 700,
                          fill: "#1C1917",
                          fontFamily: "Inter, system-ui, sans-serif",
                        }}
                      >
                        {name}
                      </text>
                    )}
                  </g>
                );
              })}
            </g>
          </g>
        </svg>

        {tooltip && (
          <div
            className="fixed z-50 pointer-events-none bg-cf-navy text-white text-xs rounded-lg px-3 py-2 shadow-xl whitespace-nowrap"
            style={{ left: tooltip.x + 12, top: tooltip.y - 8 }}
            dangerouslySetInnerHTML={{ __html: tooltip.html }}
          />
        )}
      </div>

      {/* Legend */}
      <div className="mt-3 flex flex-wrap gap-3 pt-3 border-t border-cf-gray-100">
        <span className="text-[10px] font-semibold text-cf-gray-500 uppercase tracking-wide self-center mr-1">Devices:</span>
        {devices.map((d) => (
          <span key={d} className="flex items-center gap-1 text-[10px] text-cf-gray-600">
            <span className="w-2.5 h-2.5 rounded-sm flex-shrink-0" style={{ backgroundColor: getColor(d) }} />
            {d}
          </span>
        ))}
        <span className="text-[10px] font-semibold text-cf-gray-500 uppercase tracking-wide self-center mx-1">Browsers:</span>
        {browsers.map((b) => (
          <span key={b} className="flex items-center gap-1 text-[10px] text-cf-gray-600">
            <span className="w-2.5 h-2.5 rounded-full flex-shrink-0" style={{ backgroundColor: getColor(b) }} />
            {b}
          </span>
        ))}
      </div>
    </div>
  );
}
