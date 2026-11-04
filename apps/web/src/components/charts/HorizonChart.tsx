/**
 * HorizonChart — compact multi-series time overview using layered area fills.
 *
 * Each series is rendered as a 40px-tall horizontal strip. Values are
 * normalized to [0, 1] and split into 3 color bands (light → medium → dark).
 * Positive values use the series color; negative values (if any) use a
 * contrasting hue mirrored below the baseline.
 *
 * This compresses 5 separate area charts into one 200px panel — ideal for
 * the overview page where space is precious.
 */
import { useMemo, useRef, useEffect, useState } from "react";
import * as d3scale from "d3-scale";
import * as d3array from "d3-array";
import * as d3shape from "d3-shape";
import { format, parseISO } from "date-fns";

export interface HorizonSeries {
  key: string;
  label: string;
  color: string;
  data: { date: string; value: number }[];
  unit?: string;
  formatter?: (v: number) => string;
}

interface Props {
  series: HorizonSeries[];
  bandHeight?: number;     // px per series band
  overlap?: number;        // number of color bands (2 or 3)
  title?: string;
  subtitle?: string;
  dateFormat?: string;
}

const BANDS = 3;

export default function HorizonChart({
  series,
  bandHeight = 44,
  overlap = BANDS,
  title,
  subtitle,
  dateFormat = "MMM d",
}: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(600);
  const [tooltip, setTooltip] = useState<{ x: number; y: number; html: string } | null>(null);

  useEffect(() => {
    if (!containerRef.current) return;
    const ro = new ResizeObserver(() => setWidth(containerRef.current?.offsetWidth ?? 600));
    ro.observe(containerRef.current);
    setWidth(containerRef.current.offsetWidth ?? 600);
    return () => ro.disconnect();
  }, []);

  // Filter out series with no data
  const activeSeries = series.filter((s) => s.data.length > 0);
  if (!activeSeries.length) return null;

  // Shared x-scale across all series
  const allDates = activeSeries[0].data.map((d) => d.date);
  const xScale = d3scale.scalePoint<string>()
    .domain(allDates)
    .range([0, width - 2]);

  // Total SVG height
  const totalH = activeSeries.length * bandHeight;

  return (
    <div className="bg-white rounded-xl shadow-sm border border-cf-gray-200 p-5">
      {title && (
        <div className="mb-3">
          <h3 className="text-sm font-semibold text-cf-navy">{title}</h3>
          {subtitle && <p className="text-xs text-cf-gray-500 mt-0.5">{subtitle}</p>}
        </div>
      )}
      <div ref={containerRef} className="relative" style={{ height: totalH + 20 }}
        onMouseLeave={() => setTooltip(null)}>
        <svg width={width} height={totalH + 20} style={{ overflow: "visible" }}>
          {activeSeries.map((s, si) => (
            <HorizonBand
              key={s.key}
              series={s}
              xScale={xScale}
              y={si * bandHeight}
              bandHeight={bandHeight}
              overlap={overlap}
              width={width}
              onHover={(x, y, html) => setTooltip({ x, y, html })}
            />
          ))}

          {/* Shared x-axis: show first, middle, last dates */}
          {allDates.length > 0 && (
            <g transform={`translate(0,${totalH + 2})`}>
              {[0, Math.floor(allDates.length / 2), allDates.length - 1].map((i) => {
                const d = allDates[i];
                const x = xScale(d) ?? 0;
                return (
                  <text key={i} x={x} y={12}
                    textAnchor={i === 0 ? "start" : i === allDates.length - 1 ? "end" : "middle"}
                    style={{ fontSize: 9, fill: "#A8A29E", fontFamily: "Inter, system-ui, sans-serif" }}>
                     {format(parseISO(d), dateFormat)}
                  </text>
                );
              })}
            </g>
          )}
        </svg>

        {tooltip && (
          <div className="fixed z-50 pointer-events-none bg-cf-navy text-white text-xs rounded-lg px-3 py-2 shadow-xl whitespace-nowrap"
            style={{ left: tooltip.x + 12, top: tooltip.y - 8 }}>
            {tooltip.html}
          </div>
        )}
      </div>
    </div>
  );
}

interface BandProps {
  series: HorizonSeries;
  xScale: d3scale.ScalePoint<string>;
  y: number;
  bandHeight: number;
  overlap: number;
  width: number;
  onHover: (x: number, y: number, html: string) => void;
}

function HorizonBand({ series, xScale, y, bandHeight, overlap, width, onHover }: BandProps) {
  const { data, color, label, formatter, unit } = series;
  if (!data.length) return null;

  const max = d3array.max(data, (d) => d.value) ?? 1;
  const clipId = `horizon-clip-${label.replace(/\s+/g, "-")}`;

  // y-scale: maps [0, max] to [bandHeight, 0]
  const yScale = d3scale.scaleLinear().domain([0, max]).range([bandHeight, 0]);

  // Area generator
  const areaGen = d3shape.area<{ date: string; value: number }>()
    .x((d) => xScale(d.date) ?? 0)
    .y0(bandHeight)
    .y1((d) => yScale(d.value))
    .curve(d3shape.curveCatmullRom);

  const path = areaGen(data) ?? "";

  // Compute band opacity layers
  const bands = Array.from({ length: overlap }, (_, i) => ({
    opacity: (i + 1) / overlap,
    translateY: -i * bandHeight,
  }));

  const fmt = formatter ?? ((v: number) => {
    if (v >= 1e6) return `${(v / 1e6).toFixed(1)}M`;
    if (v >= 1e3) return `${(v / 1e3).toFixed(0)}K`;
    return String(Math.round(v));
  });

  return (
    <g transform={`translate(0,${y})`}>
      {/* Clip to band height */}
      <defs>
        <clipPath id={clipId}>
          <rect x={0} y={0} width={width} height={bandHeight} />
        </clipPath>
      </defs>

      {/* Background */}
      <rect x={0} y={0} width={width} height={bandHeight} fill="#FAFAF9" />

      {/* Layered fills */}
      <g clipPath={`url(#${clipId})`}>
        {bands.map((band, bi) => (
          <path
            key={bi}
            d={path}
            fill={color}
            fillOpacity={band.opacity * 0.8}
            transform={`translate(0,${band.translateY})`}
          />
        ))}
      </g>

      {/* Series label */}
      <text x={6} y={bandHeight - 6}
        style={{ fontSize: 10, fontWeight: 700, fill: color, fontFamily: "Inter, system-ui, sans-serif" }}>
        {label}
      </text>

      {/* Max value */}
      <text x={width - 4} y={bandHeight - 6} textAnchor="end"
        style={{ fontSize: 9, fill: "#78716C", fontFamily: "Inter, system-ui, sans-serif" }}>
        max {fmt(max)}{unit ? ` ${unit}` : ""}
      </text>

      {/* Bottom border */}
      <line x1={0} y1={bandHeight - 0.5} x2={width} y2={bandHeight - 0.5}
        stroke="#E8E6E3" strokeWidth={1} />

      {/* Hover area */}
      <rect x={0} y={0} width={width} height={bandHeight}
        fill="transparent"
        style={{ cursor: "crosshair" }}
        onMouseMove={(e) => {
          const rect = e.currentTarget.getBoundingClientRect();
          const xPos = e.clientX - rect.left;
          // Find closest data point
          const step = width / data.length;
          const idx = Math.min(Math.round(xPos / step), data.length - 1);
          const pt = data[Math.max(0, idx)];
          if (pt) onHover(e.clientX, e.clientY, `${label}: ${fmt(pt.value)}${unit ? ` ${unit}` : ""} (${format(parseISO(pt.date), "MMM d")})`);
        }}
      />
    </g>
  );
}
