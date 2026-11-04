/**
 * ParallelCoordinates — multi-dimensional threat IP fingerprinting.
 *
 * Each vertical axis = one dimension (request count, block rate, etc.)
 * Each polyline = one threat IP, colored by its primary action type.
 * Hover highlights the selected IP and shows its values.
 */
import { useState, useRef, useEffect } from "react";
import * as d3scale from "d3-scale";
import * as d3array from "d3-array";
import { formatNumber } from "../../utils/formatters";

export interface PCDimension {
  key: string;
  label: string;
  format?: (v: number) => string;
  log?: boolean;
}

export interface PCRow {
  id: string;
  label: string;
  color: string;
  values: Record<string, number>;
}

interface Props {
  dimensions: PCDimension[];
  rows: PCRow[];
  title?: string;
  subtitle?: string;
  height?: number;
}

export default function ParallelCoordinates({ dimensions, rows, title, subtitle, height = 320 }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(600);
  const [hovered, setHovered] = useState<string | null>(null);
  const [tooltip, setTooltip] = useState<{ x: number; y: number; row: PCRow } | null>(null);

  useEffect(() => {
    if (!containerRef.current) return;
    const ro = new ResizeObserver(() => setWidth(containerRef.current?.offsetWidth ?? 600));
    ro.observe(containerRef.current);
    setWidth(containerRef.current.offsetWidth ?? 600);
    return () => ro.disconnect();
  }, []);

  if (!dimensions.length || !rows.length) return null;

  const MARGIN = { top: 32, right: 20, bottom: 16, left: 20 };
  const innerW = width - MARGIN.left - MARGIN.right;
  const innerH = height - MARGIN.top - MARGIN.bottom;

  // x positions for each axis
  const xScale = d3scale.scalePoint<string>()
    .domain(dimensions.map((d) => d.key))
    .range([0, innerW]);

  // y scale per dimension
  const yScales = new Map<string, d3scale.ScaleLinear<number, number> | d3scale.ScaleLogarithmic<number, number>>();
  for (const dim of dimensions) {
    const vals = rows.map((r) => r.values[dim.key] ?? 0).filter((v) => isFinite(v));
    const [lo, hi] = [d3array.min(vals) ?? 0, d3array.max(vals) ?? 1];
    const scale = dim.log
      ? d3scale.scaleLog().domain([Math.max(1, lo), Math.max(2, hi)]).range([innerH, 0]).clamp(true)
      : d3scale.scaleLinear().domain([lo, hi]).range([innerH, 0]).clamp(true);
    yScales.set(dim.key, scale);
  }

  function pathForRow(row: PCRow): string {
    const pts = dimensions
      .map((dim) => {
        const x = xScale(dim.key) ?? 0;
        const ys = yScales.get(dim.key);
        const v = row.values[dim.key] ?? 0;
        const y = ys ? ys(v) : innerH / 2;
        return `${x},${y}`;
      });
    return `M${pts.join("L")}`;
  }

  return (
    <div className="bg-white rounded-xl shadow-sm border border-cf-gray-200 p-5">
      {title && (
        <div className="mb-3">
          <h3 className="text-sm font-semibold text-cf-navy">{title}</h3>
          {subtitle && <p className="text-xs text-cf-gray-500 mt-0.5">{subtitle}</p>}
        </div>
      )}
      <div ref={containerRef} className="relative" style={{ height }}
        onMouseLeave={() => { setHovered(null); setTooltip(null); }}>
        <svg width={width} height={height}>
          <g transform={`translate(${MARGIN.left},${MARGIN.top})`}>
            {/* Polylines */}
            <g>
              {rows.map((row) => {
                const isHov = hovered === row.id;
                const isDim = hovered !== null && !isHov;
                return (
                  <path
                    key={row.id}
                    d={pathForRow(row)}
                    fill="none"
                    stroke={row.color}
                    strokeWidth={isHov ? 2.5 : 1.5}
                    strokeOpacity={isDim ? 0.08 : isHov ? 1 : 0.45}
                    style={{ cursor: "pointer", transition: "stroke-opacity 0.15s, stroke-width 0.15s" }}
                    onMouseEnter={(e) => {
                      setHovered(row.id);
                      setTooltip({ x: e.clientX, y: e.clientY, row });
                    }}
                    onMouseMove={(e) => setTooltip((t) => t ? { ...t, x: e.clientX, y: e.clientY } : null)}
                  />
                );
              })}
            </g>

            {/* Axes */}
            {dimensions.map((dim) => {
              const x = xScale(dim.key) ?? 0;
              const ys = yScales.get(dim.key);
              const ticks = ys?.ticks(4) ?? [];
              return (
                <g key={dim.key} transform={`translate(${x},0)`}>
                  {/* Axis line */}
                  <line y1={0} y2={innerH} stroke="#D4D0CA" strokeWidth={1} />
                  {/* Ticks */}
                  {ticks.map((t) => {
                    const y = ys ? ys(t) : 0;
                    const fmt = dim.format ?? ((v: number) => v >= 1e3 ? `${(v / 1e3).toFixed(0)}K` : String(Math.round(v)));
                    return (
                      <g key={t} transform={`translate(0,${y})`}>
                        <line x1={-3} x2={3} stroke="#D4D0CA" />
                        <text x={6} textAnchor="start" dominantBaseline="middle"
                          style={{ fontSize: 8, fill: "#A8A29E", fontFamily: "Inter, system-ui, sans-serif" }}>
                          {fmt(t)}
                        </text>
                      </g>
                    );
                  })}
                  {/* Label */}
                  <text y={-14} textAnchor="middle"
                    style={{ fontSize: 10, fontWeight: 700, fill: "#1C1917", fontFamily: "Inter, system-ui, sans-serif" }}>
                    {dim.label}
                  </text>
                </g>
              );
            })}
          </g>
        </svg>

        {tooltip && (
          <div className="fixed z-50 pointer-events-none bg-cf-navy text-white text-xs rounded-lg px-3 py-2 shadow-xl"
            style={{ left: tooltip.x + 12, top: tooltip.y - 8, maxWidth: 240 }}>
            <p className="font-semibold mb-1">{tooltip.row.label}</p>
            {dimensions.map((dim) => {
              const v = tooltip.row.values[dim.key] ?? 0;
              const fmt = dim.format ?? formatNumber;
              return (
                <div key={dim.key} className="flex justify-between gap-3">
                  <span className="text-white/70">{dim.label}:</span>
                  <span className="font-semibold">{fmt(v)}</span>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Legend */}
      <div className="flex flex-wrap gap-3 mt-3">
        {rows.slice(0, 8).map((row) => (
          <div key={row.id}
            className="flex items-center gap-1.5 cursor-pointer"
            onMouseEnter={() => setHovered(row.id)}
            onMouseLeave={() => setHovered(null)}>
            <span className="w-6 h-1.5 rounded-full" style={{ backgroundColor: row.color }} />
            <span className="text-[10px] text-cf-gray-600 font-mono">{row.label}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
