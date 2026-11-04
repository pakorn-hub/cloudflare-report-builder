/**
 * SankeyFlowChart — proper Sankey diagram using d3-sankey layout + React SVG.
 *
 * d3-sankey computes exact node x/y/width/height positions and link paths.
 * We render pure SVG with React — no Recharts, no DOM manipulation.
 * Hover highlights the hovered link or node and all connected elements.
 *
 * Cloudflare brand color palette applied per node.
 */
import { useState, useCallback, useRef, useEffect } from "react";
import { sankey, sankeyLinkHorizontal, sankeyJustify } from "d3-sankey";
import { formatNumber } from "../../utils/formatters";

export interface SankeyNodeDef {
  name: string;
  color: string;
}

export interface SankeyLinkDef {
  source: number;
  target: number;
  value: number;
}

export interface SankeyData {
  nodes: SankeyNodeDef[];
  links: SankeyLinkDef[];
}

interface Props {
  data: SankeyData;
  height?: number;
  unit?: string;
}

// d3-sankey augments nodes/links with layout data
interface ComputedNode extends SankeyNodeDef {
  x0: number; x1: number; y0: number; y1: number;
  value: number; index: number;
}
interface ComputedLink {
  source: ComputedNode; target: ComputedNode;
  value: number; width: number;
  y0: number; y1: number;
  index: number;
}

const NODE_WIDTH = 18;
const NODE_PADDING = 24;
const MARGIN = { top: 16, right: 8, bottom: 16, left: 8 };
const LABEL_PAD = 10;

export default function SankeyFlowChart({ data, height = 380, unit = "requests" }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(700);
  const [hoveredNode, setHoveredNode] = useState<number | null>(null);
  const [hoveredLink, setHoveredLink] = useState<number | null>(null);
  const [tooltip, setTooltip] = useState<{ x: number; y: number; content: string } | null>(null);

  // Measure container width responsively
  useEffect(() => {
    if (!containerRef.current) return;
    const ro = new ResizeObserver((entries) => {
      const w = entries[0]?.contentRect.width;
      if (w && w > 0) setWidth(w);
    });
    ro.observe(containerRef.current);
    setWidth(containerRef.current.offsetWidth || 700);
    return () => ro.disconnect();
  }, []);

  if (!data.nodes.length || !data.links.length) return null;

  // Run d3-sankey layout
  const sankeyGen = sankey<SankeyNodeDef, SankeyLinkDef>()
    .nodeId((d) => (d as ComputedNode).index)
    .nodeAlign(sankeyJustify)
    .nodeWidth(NODE_WIDTH)
    .nodePadding(NODE_PADDING)
    .extent([
      [MARGIN.left, MARGIN.top],
      [width - MARGIN.right, height - MARGIN.bottom],
    ]);

  // d3-sankey mutates input — clone to avoid React state conflicts
  const graph = sankeyGen({
    nodes: data.nodes.map((n, i) => ({ ...n, index: i })),
    links: data.links.map((l) => ({ ...l })),
  });

  const nodes = graph.nodes as ComputedNode[];
  const links = graph.links as ComputedLink[];
  const linkPath = sankeyLinkHorizontal();

  // Determine which nodes connect to a hovered link
  const linkedNodeIds = hoveredLink !== null
    ? new Set([links[hoveredLink].source.index, links[hoveredLink].target.index])
    : null;

  // Determine which links connect to a hovered node
  const connectedLinkIds = hoveredNode !== null
    ? new Set(links.filter((l) => l.source.index === hoveredNode || l.target.index === hoveredNode).map((l) => l.index))
    : null;

  const isAnyHovered = hoveredLink !== null || hoveredNode !== null;

  const handleNodeEnter = useCallback((idx: number, e: React.MouseEvent) => {
    setHoveredNode(idx);
    setHoveredLink(null);
    const n = nodes[idx];
    setTooltip({
      x: e.nativeEvent.offsetX,
      y: e.nativeEvent.offsetY,
      content: `${n.name}: ${formatNumber(n.value)} ${unit}`,
    });
  }, [nodes, unit]);

  const handleLinkEnter = useCallback((idx: number, e: React.MouseEvent) => {
    setHoveredLink(idx);
    setHoveredNode(null);
    const l = links[idx];
    setTooltip({
      x: e.nativeEvent.offsetX,
      y: e.nativeEvent.offsetY,
      content: `${l.source.name} → ${l.target.name}: ${formatNumber(l.value)} ${unit}`,
    });
  }, [links, unit]);

  const handleLeave = useCallback(() => {
    setHoveredNode(null);
    setHoveredLink(null);
    setTooltip(null);
  }, []);

  return (
    <div ref={containerRef} className="relative w-full select-none" style={{ height }}>
      <svg
        width={width}
        height={height}
        style={{ overflow: "visible" }}
        onMouseLeave={handleLeave}
      >
        <defs>
          {links.map((l, i) => (
            <linearGradient
              key={`grad-${i}`}
              id={`sg-${i}`}
              gradientUnits="userSpaceOnUse"
              x1={l.source.x1} x2={l.target.x0}
              y1={(l.source.y0 + l.source.y1) / 2}
              y2={(l.target.y0 + l.target.y1) / 2}
            >
              <stop offset="0%"   stopColor={l.source.color} stopOpacity={0.5} />
              <stop offset="100%" stopColor={l.target.color} stopOpacity={0.5} />
            </linearGradient>
          ))}
        </defs>

        {/* ── Links ─────────────────────────────────────────────────── */}
        <g>
          {links.map((l, i) => {
            const isActive = hoveredLink === i || (connectedLinkIds?.has(i) ?? false);
            const isDimmed = isAnyHovered && !isActive;
            const path = linkPath(l as Parameters<typeof linkPath>[0]);
            if (!path) return null;
            return (
              <path
                key={`link-${i}`}
                d={path}
                fill="none"
                stroke={`url(#sg-${i})`}
                strokeWidth={Math.max(1, l.width)}
                strokeOpacity={isDimmed ? 0.08 : isActive ? 0.75 : 0.35}
                style={{ cursor: "pointer", transition: "stroke-opacity 0.15s" }}
                onMouseEnter={(e) => handleLinkEnter(i, e)}
              />
            );
          })}
        </g>

        {/* ── Nodes ─────────────────────────────────────────────────── */}
        <g>
          {nodes.map((n, i) => {
            const isActive = hoveredNode === i || (linkedNodeIds?.has(i) ?? false);
            const isDimmed = isAnyHovered && !isActive;
            const nodeH = Math.max(2, n.y1 - n.y0);
            const isRight = n.x0 > width / 2;
            const labelX = isRight ? n.x0 - LABEL_PAD : n.x1 + LABEL_PAD;
            const anchor = isRight ? "end" : "start";
            const midY = (n.y0 + n.y1) / 2;

            return (
              <g key={`node-${i}`}
                style={{ cursor: "pointer" }}
                onMouseEnter={(e) => handleNodeEnter(i, e)}
              >
                {/* Node rect */}
                <rect
                  x={n.x0} y={n.y0}
                  width={n.x1 - n.x0} height={nodeH}
                  fill={n.color}
                  fillOpacity={isDimmed ? 0.25 : 1}
                  rx={3}
                  style={{ transition: "fill-opacity 0.15s" }}
                />
                {/* Subtle highlight on top edge */}
                <rect
                  x={n.x0} y={n.y0}
                  width={n.x1 - n.x0} height={Math.min(4, nodeH / 3)}
                  fill="rgba(255,255,255,0.25)"
                  rx={3}
                  style={{ pointerEvents: "none" }}
                />

                {/* Node label — name */}
                <text
                  x={labelX}
                  y={midY - (nodeH > 24 ? 7 : 0)}
                  textAnchor={anchor}
                  dominantBaseline="middle"
                  fill={isDimmed ? "#A8A29E" : "#1C1917"}
                  style={{
                    fontSize: 11,
                    fontWeight: 700,
                    fontFamily: "Inter, system-ui, sans-serif",
                    pointerEvents: "none",
                    transition: "fill 0.15s",
                  }}
                >
                  {n.name}
                </text>

                {/* Node label — value (only if node is tall enough) */}
                {nodeH > 24 && (
                  <text
                    x={labelX}
                    y={midY + 7}
                    textAnchor={anchor}
                    dominantBaseline="middle"
                    fill={isDimmed ? "#D4D0CA" : "#78716C"}
                    style={{
                      fontSize: 10,
                      fontFamily: "Inter, system-ui, sans-serif",
                      pointerEvents: "none",
                      transition: "fill 0.15s",
                    }}
                  >
                    {formatNumber(n.value)}
                  </text>
                )}
              </g>
            );
          })}
        </g>
      </svg>

      {/* Tooltip */}
      {tooltip && (
        <div
          className="absolute pointer-events-none z-50 bg-cf-navy text-white text-xs rounded-lg px-3 py-2 shadow-xl whitespace-nowrap"
          style={{
            left: tooltip.x + 12,
            top: tooltip.y - 8,
            transform: tooltip.x > width * 0.6 ? "translateX(-110%)" : undefined,
          }}
        >
          {tooltip.content}
        </div>
      )}
    </div>
  );
}
