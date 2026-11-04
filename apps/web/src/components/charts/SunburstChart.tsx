/**
 * SunburstChart — hierarchical drill-down using d3-hierarchy partition.
 *
 * Inner ring = Level 1 (e.g., content type)
 * Outer ring = Level 2 (e.g., cache status)
 *
 * Click to zoom into a segment and see its children.
 * Hover shows tooltip with value and percentage.
 */
import { useState, useRef, useEffect } from "react";
import * as d3hierarchy from "d3-hierarchy";
import * as d3shape from "d3-shape";
import * as d3array from "d3-array";
import { formatNumber } from "../../utils/formatters";

export interface SunburstNode {
  name: string;
  value?: number;
  color?: string;
  children?: SunburstNode[];
}

interface Props {
  data: SunburstNode;
  title?: string;
  subtitle?: string;
  height?: number;
}

interface ArcDatum {
  x0: number; x1: number; y0: number; y1: number;
  depth: number; value: number;
  data: SunburstNode;
  parent: d3hierarchy.HierarchyRectangularNode<SunburstNode> | null;
}

// Assign colors to nodes based on depth and parent color
function assignColors(node: d3hierarchy.HierarchyRectangularNode<SunburstNode>, parentColor?: string): void {
  const n = node as d3hierarchy.HierarchyRectangularNode<SunburstNode> & { _color?: string };
  if (node.depth === 0) { n._color = "transparent"; return; }
  if (node.data.color) { n._color = node.data.color; return; }
  // Derive lighter shade from parent for inner depth
  n._color = parentColor ?? "#F6821F";
  node.children?.forEach((c, i) => {
    const child = c as typeof n;
    // Vary lightness for children
    const hues = ["#F6821F","#FF6633","#FBAD41","#10B981","#3B82F6","#8B5CF6","#EF4444","#00B0D1","#F59E0B","#EC4899"];
    child._color = hues[(node.depth * 3 + i) % hues.length];
    assignColors(c, child._color);
  });
}

export default function SunburstChart({ data, title, subtitle, height = 360 }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(360);
  const [tooltip, setTooltip] = useState<{ x: number; y: number; name: string; val: number; pct: string } | null>(null);
  const [focusPath, setFocusPath] = useState<string[]>([]);

  useEffect(() => {
    if (!containerRef.current) return;
    const ro = new ResizeObserver(() => setWidth(containerRef.current?.offsetWidth ?? 360));
    ro.observe(containerRef.current);
    setWidth(containerRef.current.offsetWidth ?? 360);
    return () => ro.disconnect();
  }, []);

  const cx = Math.min(width, height) / 2;
  const cy = height / 2;
  const outerR = Math.min(cx, cy) - 10;

  // Build hierarchy
  const root = d3hierarchy.hierarchy(data)
    .sum((d) => d.value ?? 0)
    .sort((a, b) => (b.value ?? 0) - (a.value ?? 0));

  assignColors(root as d3hierarchy.HierarchyRectangularNode<SunburstNode>);

  const totalValue = root.value ?? 1;
  const maxDepth = root.height;

  // Partition layout
  const partition = d3hierarchy.partition<SunburstNode>()
    .size([2 * Math.PI, outerR]);

  const partitioned = partition(root) as d3hierarchy.HierarchyRectangularNode<SunburstNode>;

  // Arc generator
  const arcGen = d3shape.arc<ArcDatum>()
    .startAngle((d) => d.x0)
    .endAngle((d) => d.x1)
    .padAngle((d) => Math.min((d.x1 - d.x0) / 2, 0.005))
    .padRadius(outerR / 2)
    .innerRadius((d) => d.y0 + (d.depth === 0 ? 0 : 4))
    .outerRadius((d) => d.y1 - 2);

  const descendants = partitioned.descendants().slice(1); // skip root

  return (
    <div className="bg-white rounded-xl shadow-sm border border-cf-gray-200 p-5">
      {title && (
        <div className="mb-3">
          <h3 className="text-sm font-semibold text-cf-navy">{title}</h3>
          {subtitle && <p className="text-xs text-cf-gray-500 mt-0.5">{subtitle}</p>}
        </div>
      )}
      <div ref={containerRef} className="relative" style={{ height }}>
        <svg width={width} height={height} onMouseLeave={() => setTooltip(null)}>
          <g transform={`translate(${cx},${cy})`}>
            {descendants.map((d, i) => {
              const node = d as typeof partitioned & { _color?: string };
              const arcData: ArcDatum = {
                x0: d.x0, x1: d.x1, y0: d.y0, y1: d.y1,
                depth: d.depth, value: d.value ?? 0,
                data: d.data, parent: d.parent,
              };
              const path = arcGen(arcData);
              if (!path) return null;
              const color = node._color ?? "#F6821F";
              const pct = totalValue > 0 ? ((d.value ?? 0) / totalValue * 100).toFixed(1) : "0";

              // Label: show only for segments wide enough
              const angle = d.x1 - d.x0;
              const midAngle = (d.x0 + d.x1) / 2 - Math.PI / 2;
              const midR = (d.y0 + d.y1) / 2;
              const showLabel = angle > 0.2 && d.depth <= 2;

              return (
                <g key={i}>
                  <path
                    d={path}
                    fill={color}
                    fillOpacity={0.88}
                    stroke="white"
                    strokeWidth={1.5}
                    style={{ cursor: "pointer", transition: "fill-opacity 0.15s" }}
                    onMouseEnter={(e) => setTooltip({
                      x: e.clientX, y: e.clientY,
                      name: d.data.name, val: d.value ?? 0, pct,
                    })}
                  />
                  {showLabel && (
                    <text
                      transform={`rotate(${(midAngle * 180) / Math.PI}) translate(${midR},0) rotate(${midAngle > Math.PI / 2 || midAngle < -Math.PI / 2 ? 180 : 0})`}
                      textAnchor="middle"
                      dominantBaseline="middle"
                      style={{
                        fontSize: d.depth === 1 ? 10 : 9,
                        fontWeight: d.depth === 1 ? 700 : 500,
                        fill: "white",
                        fontFamily: "Inter, system-ui, sans-serif",
                        pointerEvents: "none",
                        textShadow: "0 1px 2px rgba(0,0,0,0.4)",
                      }}
                    >
                      {d.data.name.length > 10 ? d.data.name.slice(0, 9) + "…" : d.data.name}
                    </text>
                  )}
                </g>
              );
            })}

            {/* Center text */}
            <text textAnchor="middle" y={-8}
              style={{ fontSize: 11, fontWeight: 700, fill: "#1C1917", fontFamily: "Inter, system-ui, sans-serif" }}>
              {data.name}
            </text>
            <text textAnchor="middle" y={8}
              style={{ fontSize: 10, fill: "#78716C", fontFamily: "Inter, system-ui, sans-serif" }}>
              {formatNumber(totalValue)}
            </text>
          </g>
        </svg>

        {tooltip && (
          <div className="fixed z-50 pointer-events-none bg-cf-navy text-white text-xs rounded-lg px-3 py-2 shadow-xl whitespace-nowrap"
            style={{ left: tooltip.x + 12, top: tooltip.y - 8 }}>
            <p className="font-semibold">{tooltip.name}</p>
            <p className="text-cf-orange-light mt-0.5">{formatNumber(tooltip.val)} — {tooltip.pct}%</p>
          </div>
        )}
      </div>
    </div>
  );
}
