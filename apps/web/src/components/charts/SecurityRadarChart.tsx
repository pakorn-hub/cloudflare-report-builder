/**
 * SecurityRadarChart — hand-drawn SVG spider / radar chart.
 *
 * Design goals:
 *  - Clean polygon grid (5 rings: 20, 40, 60, 80, 100)
 *  - Colour-coded fill: green ≥ 70, amber 40-69, red < 40
 *  - Score labels on each axis dot
 *  - Subtle axis labels with wrapping
 *  - Hover tooltip via React state (no Recharts dependency)
 */
import { useState } from "react";

export interface RadarDimension {
  subject: string;
  score: number;
  fullMark: number;
  description?: string;
  maturityLabel?: string;
  maturityColor?: string;
}

interface Props {
  data: RadarDimension[];
  title?: string;
  subtitle?: string;
  height?: number;
  color?: string;
}

// Convert polar (angle, radius) to cartesian (x, y)
// angle 0 = top, increases clockwise
function polar(cx: number, cy: number, r: number, angleDeg: number) {
  const rad = ((angleDeg - 90) * Math.PI) / 180;
  return {
    x: cx + r * Math.cos(rad),
    y: cy + r * Math.sin(rad),
  };
}

function scoreColor(score: number): string {
  if (score >= 70) return "#10B981"; // green
  if (score >= 40) return "#F59E0B"; // amber
  return "#EF4444";                  // red
}

// Wrap long label text at natural spaces into ≤ 2 lines of ≤ 12 chars each
function wrapLabel(label: string, maxLen = 12): string[] {
  if (label.length <= maxLen) return [label];
  const words = label.split(" ");
  const lines: string[] = [];
  let current = "";
  for (const w of words) {
    if (!current) { current = w; continue; }
    if ((current + " " + w).length <= maxLen) {
      current += " " + w;
    } else {
      lines.push(current);
      current = w;
    }
  }
  if (current) lines.push(current);
  return lines.slice(0, 2);
}

interface TooltipState {
  x: number;
  y: number;
  d: RadarDimension;
} 

export default function SecurityRadarChart({ data, title, subtitle, color }: Props) {
  const [tooltip, setTooltip] = useState<TooltipState | null>(null);

  const n      = data.length;
  const cx     = 180;
  const cy     = 175;
  const maxR   = 130;   // outer ring radius
  const rings  = [20, 40, 60, 80, 100];
  const step   = 360 / n;

  // ── Ring polygons ────────────────────────────────────────────────────────
  const ringPaths = rings.map((pct) => {
    const r = (pct / 100) * maxR;
    const pts = Array.from({ length: n }, (_, i) => polar(cx, cy, r, i * step));
    return pts.map((p, i) => `${i === 0 ? "M" : "L"}${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(" ") + " Z";
  });

  // ── Spoke lines ──────────────────────────────────────────────────────────
  const spokes = Array.from({ length: n }, (_, i) => {
    const outer = polar(cx, cy, maxR, i * step);
    return `M${cx},${cy} L${outer.x.toFixed(1)},${outer.y.toFixed(1)}`;
  });

  // ── Data polygon ─────────────────────────────────────────────────────────
  const dataPoints = data.map((d, i) => {
    const r = (Math.max(0, Math.min(100, d.score)) / 100) * maxR;
    return polar(cx, cy, r, i * step);
  });
  const dataPath = dataPoints.map((p, i) =>
    `${i === 0 ? "M" : "L"}${p.x.toFixed(1)},${p.y.toFixed(1)}`
  ).join(" ") + " Z";

  // ── Determine overall tone for fill ──────────────────────────────────────
  const avg = data.reduce((s, d) => s + d.score, 0) / n;
  const fillColor = color ?? scoreColor(avg);

  // ── Axis label positions (slightly outside outer ring) ───────────────────
  const labelR = maxR + 28;

  return (
    <div className="bg-white rounded-xl shadow-sm border border-cf-gray-200 p-4">
      {title && (
        <div className="mb-3">
          <h3 className="text-sm font-semibold text-cf-navy">{title}</h3>
          {subtitle && <p className="text-xs text-cf-gray-400 mt-0.5">{subtitle}</p>}
        </div>
      )}

      <div className="relative select-none" style={{ height: 360 }}>
        <svg
          width="100%"
          height="360"
          viewBox="0 0 360 360"
          className="overflow-visible"
          onMouseLeave={() => setTooltip(null)}
        >
          {/* ── Background rings ── */}
          {ringPaths.map((d, i) => (
            <path
              key={i}
              d={d}
              fill={i % 2 === 0 ? "#F9FAFB" : "#FFFFFF"}
              stroke="#E5E7EB"
              strokeWidth={1}
            />
          ))}

          {/* ── Ring percentage labels (right side) ── */}
          {rings.map((pct, i) => {
            const r = (pct / 100) * maxR;
            return (
              <text
                key={i}
                x={cx + r + 3}
                y={cy + 3}
                fontSize={8}
                fill="#9CA3AF"
                textAnchor="start"
              >
                {pct}
              </text>
            );
          })}

          {/* ── Spoke lines ── */}
          {spokes.map((d, i) => (
            <path key={i} d={d} stroke="#D1D5DB" strokeWidth={1} strokeDasharray="3 2" />
          ))}

          {/* ── Data polygon fill ── */}
          <path
            d={dataPath}
            fill={fillColor}
            fillOpacity={0.12}
            stroke={fillColor}
            strokeWidth={2.5}
            strokeLinejoin="round"
          />

          {/* ── Score dots + labels ── */}
          {dataPoints.map((pt, i) => {
            const d     = data[i];
            const pointColor = d.maturityColor ?? color ?? scoreColor(d.score);
            return (
              <g key={i}>
                {/* Glow ring */}
                <circle cx={pt.x} cy={pt.y} r={9} fill={pointColor} fillOpacity={0.15}/>
                {/* Dot */}
                <circle
                  cx={pt.x}
                  cy={pt.y}
                  r={5}
                  fill={pointColor}
                  stroke="#fff"
                  strokeWidth={1.5}
                  style={{ cursor: "pointer" }}
                  onMouseEnter={(e) => {
                    const svg = (e.currentTarget as SVGElement).closest("svg")!.getBoundingClientRect();
                    setTooltip({
                      x: pt.x / 360 * 100,
                      y: pt.y / 360 * 100,
                      d,
                    });
                  }}
                />
                {/* Score badge */}
                <text
                  x={pt.x}
                  y={pt.y - 10}
                  fontSize={9}
                  fontWeight="700"
                  fill={pointColor}
                  textAnchor="middle"
                  dominantBaseline="middle"
                >
                  {d.score}
                </text>
              </g>
            );
          })}

          {/* ── Axis labels ── */}
          {data.map((d, i) => {
            const angle = i * step;
            const pos   = polar(cx, cy, labelR, angle);
            const lines = wrapLabel(d.subject);

            // Anchor: left side of chart → end, right → start, top/bottom → middle
            const normalised = ((angle % 360) + 360) % 360;
            const anchor =
              normalised > 200 && normalised < 340 ? "end"
              : normalised > 20  && normalised < 160 ? "start"
              : "middle";

            const lineH = 13;
            const totalH = lines.length * lineH;
            const baseY  = pos.y - totalH / 2 + lineH / 2;

            return (
              <g key={i}>
                {lines.map((line, li) => (
                  <text
                    key={li}
                    x={pos.x}
                    y={baseY + li * lineH}
                    fontSize={10}
                    fontWeight="600"
                    fill="#374151"
                    textAnchor={anchor}
                    dominantBaseline="middle"
                  >
                    {line}
                  </text>
                ))}
              </g>
            );
          })}

          {/* ── Centre dot ── */}
          <circle cx={cx} cy={cy} r={3} fill="#D1D5DB" />
        </svg>

        {/* ── Tooltip ── */}
        {tooltip && (
          <div
            className="absolute z-10 pointer-events-none bg-white border border-cf-gray-200 rounded-xl shadow-xl p-3 text-xs w-44"
            style={{
              left: `clamp(0px, calc(${tooltip.x}% - 88px), calc(100% - 176px))`,
              top:  `clamp(0px, calc(${tooltip.y}% - 80px), calc(100% - 100px))`,
            }}
          >
            <p className="font-bold text-cf-navy mb-1">{tooltip.d.subject}</p>
            <p className="font-semibold" style={{ color: tooltip.d.maturityColor ?? scoreColor(tooltip.d.score) }}>
              {tooltip.d.score}/100 · {tooltip.d.maturityLabel ?? ""}
            </p>
            {tooltip.d.description && (
              <p className="text-cf-gray-500 mt-1 leading-snug">{tooltip.d.description}</p>
            )}
          </div>
        )}
      </div>

      {/* ── Colour legend ── */}
      <div className="flex items-center justify-center gap-5 mt-1 pb-1">
        {[
          { color: "#10B981", label: "Good (70–100)" },
          { color: "#F59E0B", label: "Moderate (40–69)" },
          { color: "#EF4444", label: "Needs work (0–39)" },
        ].map((l) => (
          <div key={l.label} className="flex items-center gap-1.5">
            <span className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: l.color }}/>
            <span className="text-[10px] text-cf-gray-500">{l.label}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
