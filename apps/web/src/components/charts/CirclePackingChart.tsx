/**
 * CirclePackingChart — nested proportional bubbles using d3-hierarchy pack.
 *
 * Level 0: root (invisible)
 * Level 1: device type (Desktop, Mobile, Tablet, Bot)
 * Level 2: browser family (Chrome, Firefox, Safari, Edge…)
 *
 * Circle area is proportional to request count.
 * Hover shows name and count. Color coded by device type.
 */
import { useRef, useEffect, useState } from "react";
import * as d3hierarchy from "d3-hierarchy";
import { formatNumber } from "../../utils/formatters";

export interface PackNode {
  name: string;
  value?: number;
  color?: string;
  children?: PackNode[];
}

interface Props {
  data: PackNode;
  title?: string;
  subtitle?: string;
  height?: number;
}

interface ComputedCircle {
  x: number; y: number; r: number;
  depth: number; value: number;
  data: PackNode;
  _color?: string;
}

// Assign colors — children inherit a lighter tint of their parent
const LEVEL1_COLORS = ["#F6821F", "#3B82F6", "#10B981", "#8B5CF6", "#EF4444", "#F59E0B", "#00B0D1"];
const LEVEL2_ALPHA = 0.7;

function hex2rgba(hex: string, alpha: number): string {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return `rgba(${r},${g},${b},${alpha})`;
}

export default function CirclePackingChart({ data, title, subtitle, height = 380 }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(380);
  const [tooltip, setTooltip] = useState<{ x: number; y: number; name: string; value: number; pct: string } | null>(null);

  useEffect(() => {
    if (!containerRef.current) return;
    const ro = new ResizeObserver(() => setWidth(containerRef.current?.offsetWidth ?? 380));
    ro.observe(containerRef.current);
    setWidth(containerRef.current.offsetWidth ?? 380);
    return () => ro.disconnect();
  }, []);

  const size = Math.min(width, height);
  const padding = 4;

  // Build hierarchy
  const root = d3hierarchy.hierarchy(data)
    .sum((d) => d.value ?? 0)
    .sort((a, b) => (b.value ?? 0) - (a.value ?? 0));

  const totalValue = root.value ?? 1;

  // Pack layout
  const pack = d3hierarchy.pack<PackNode>()
    .size([size - padding * 2, size - padding * 2])
    .padding(6);

  const packed = pack(root);

  // Assign colors
  const allNodes = packed.descendants() as (d3hierarchy.HierarchyCircularNode<PackNode> & { _color?: string })[];
  allNodes.forEach((node) => {
    if (node.depth === 0) { node._color = "transparent"; return; }
    if (node.data.color) { node._color = node.data.color; return; }
    if (node.depth === 1) {
      const parentChildren = node.parent?.children ?? [];
      const idx = parentChildren.indexOf(node as unknown as typeof parentChildren[0]);
      node._color = LEVEL1_COLORS[idx % LEVEL1_COLORS.length];
    } else {
      const parentColor = (node.parent as typeof node)?._color ?? LEVEL1_COLORS[0];
      node._color = hex2rgba(parentColor, LEVEL2_ALPHA);
    }
  });

  const circles = allNodes.slice(1); // skip root

  return (
    <div className="bg-white rounded-xl shadow-sm border border-cf-gray-200 p-5">
      {title && (
        <div className="mb-3">
          <h3 className="text-sm font-semibold text-cf-navy">{title}</h3>
          {subtitle && <p className="text-xs text-cf-gray-500 mt-0.5">{subtitle}</p>}
        </div>
      )}
      <div ref={containerRef} className="relative flex justify-center" style={{ height }}
        onMouseLeave={() => setTooltip(null)}>
        <svg width={size} height={size}>
          <g transform={`translate(${padding},${padding})`}>
            {circles.map((node, i) => {
              const pct = totalValue > 0 ? ((node.value ?? 0) / totalValue * 100).toFixed(1) : "0";
              const showLabel = node.r > 20 && node.depth === 1;
              const showSmallLabel = node.r > 12 && node.depth === 2;
              const isLeaf = !node.children?.length;
              return (
                <g key={i}
                  style={{ cursor: "pointer" }}
                  onMouseEnter={(e) => setTooltip({ x: e.clientX, y: e.clientY, name: node.data.name, value: node.value ?? 0, pct })}
                >
                  <circle
                    cx={node.x} cy={node.y} r={Math.max(0, node.r)}
                    fill={node._color ?? "#F6821F"}
                    fillOpacity={isLeaf ? 0.9 : 0.25}
                    stroke={isLeaf ? "white" : node._color ?? "#F6821F"}
                    strokeWidth={isLeaf ? 1.5 : 1}
                    strokeOpacity={isLeaf ? 0.5 : 0.4}
                  />
                  {showLabel && (
                    <text x={node.x} y={node.y} textAnchor="middle" dominantBaseline="middle"
                      style={{ fontSize: Math.min(13, node.r / 3), fontWeight: 700, fill: "white", fontFamily: "Inter, system-ui, sans-serif", pointerEvents: "none", textShadow: "0 1px 3px rgba(0,0,0,0.4)" }}>
                      {node.data.name.length > 8 ? node.data.name.slice(0, 7) + "…" : node.data.name}
                    </text>
                  )}
                  {!showLabel && showSmallLabel && (
                    <text x={node.x} y={node.y} textAnchor="middle" dominantBaseline="middle"
                      style={{ fontSize: Math.min(10, node.r / 2.5), fontWeight: 600, fill: "white", fontFamily: "Inter, system-ui, sans-serif", pointerEvents: "none", textShadow: "0 1px 2px rgba(0,0,0,0.4)" }}>
                      {node.data.name.slice(0, Math.floor(node.r / 5))}
                    </text>
                  )}
                </g>
              );
            })}
          </g>
        </svg>

        {tooltip && (
          <div className="fixed z-50 pointer-events-none bg-cf-navy text-white text-xs rounded-lg px-3 py-2 shadow-xl whitespace-nowrap"
            style={{ left: tooltip.x + 12, top: tooltip.y - 8 }}>
            <p className="font-semibold">{tooltip.name}</p>
            <p className="text-cf-orange-light mt-0.5">{formatNumber(tooltip.value)} ({tooltip.pct}%)</p>
          </div>
        )}
      </div>
    </div>
  );
}
