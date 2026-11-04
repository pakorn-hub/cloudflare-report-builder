/**
 * TreemapChart — proportional area visualization using Recharts Treemap.
 * Used for content type distribution and country traffic breakdown.
 * Each rectangle area is proportional to the value it represents.
 */
import { Treemap, ResponsiveContainer, Tooltip } from "recharts";
import { formatNumber } from "../../utils/formatters";

export interface TreemapItem {
  name: string;
  value: number;
  color?: string;
  detail?: string;
}

interface Props {
  data: TreemapItem[];
  title?: string;
  subtitle?: string;
  height?: number;
  colorScale?: string[];
}

const DEFAULT_COLORS = [
  "#F6821F", "#FF6633", "#FBAD41", "#FEF3E2",
  "#3B82F6", "#10B981", "#8B5CF6", "#EF4444",
  "#F59E0B", "#00B0D1", "#EC4899", "#6B7280",
];

// Custom content renderer for each treemap cell
function CustomContent(props: {
  x?: number; y?: number; width?: number; height?: number;
  name?: string; value?: number; depth?: number; index?: number;
  detail?: string; color?: string; colors?: string[];
}) {
  const { x = 0, y = 0, width = 0, height = 0, name = "", value = 0, index = 0, color, colors = DEFAULT_COLORS } = props;

  const fill = color ?? colors[index % colors.length];
  const showLabel = width > 40 && height > 28;
  const showValue = width > 60 && height > 44;

  return (
    <g>
      <rect
        x={x + 1}
        y={y + 1}
        width={Math.max(0, width - 2)}
        height={Math.max(0, height - 2)}
        fill={fill}
        stroke="#ffffff"
        strokeWidth={2}
        rx={4}
        style={{ transition: "fill 0.15s" }}
      />
      {/* Subtle inner shadow effect */}
      <rect
        x={x + 1}
        y={y + 1}
        width={Math.max(0, width - 2)}
        height={Math.min(6, height - 2)}
        fill="rgba(255,255,255,0.15)"
        rx={4}
        style={{ pointerEvents: "none" }}
      />
      {showLabel && (
        <text
          x={x + width / 2}
          y={y + height / 2 - (showValue ? 8 : 0)}
          textAnchor="middle"
          dominantBaseline="middle"
          style={{
            fontSize: Math.min(13, Math.max(9, width / 8)),
            fontWeight: 700,
            fill: "#ffffff",
            fontFamily: "Inter, system-ui, sans-serif",
            pointerEvents: "none",
            textShadow: "0 1px 2px rgba(0,0,0,0.3)",
          }}
        >
          {name.length > Math.floor(width / 7) ? name.slice(0, Math.floor(width / 7)) + "…" : name}
        </text>
      )}
      {showValue && (
        <text
          x={x + width / 2}
          y={y + height / 2 + 10}
          textAnchor="middle"
          dominantBaseline="middle"
          style={{
            fontSize: Math.min(11, Math.max(8, width / 10)),
            fill: "rgba(255,255,255,0.8)",
            fontFamily: "Inter, system-ui, sans-serif",
            pointerEvents: "none",
          }}
        >
          {formatNumber(value)}
        </text>
      )}
    </g>
  );
}

function CustomTooltip({ active, payload }: { active?: boolean; payload?: { payload?: TreemapItem }[] }) {
  if (!active || !payload?.length) return null;
  const d = payload[0]?.payload;
  if (!d) return null;
  return (
    <div className="bg-white border border-cf-gray-200 rounded-lg shadow-lg px-3 py-2 text-xs">
      <p className="font-bold text-cf-navy">{d.name}</p>
      <p className="text-cf-orange font-semibold mt-0.5">{formatNumber(d.value)} requests</p>
      {d.detail && <p className="text-cf-gray-500 mt-0.5">{d.detail}</p>}
    </div>
  );
}

export default function TreemapChart({ data, title, subtitle, height = 300, colorScale }: Props) {
  if (!data.length) return null;

  const colors = colorScale ?? DEFAULT_COLORS;

  // Recharts Treemap needs data in { name, value, children? } format
  const treemapData = data.map((d, i) => ({
    ...d,
    color: d.color ?? colors[i % colors.length],
    colors,
  }));

  return (
    <div className="bg-white rounded-xl shadow-sm border border-cf-gray-200 p-5">
      {title && (
        <div className="mb-4">
          <h3 className="text-sm font-semibold text-cf-navy">{title}</h3>
          {subtitle && <p className="text-xs text-cf-gray-500 mt-0.5">{subtitle}</p>}
        </div>
      )}
      <ResponsiveContainer width="100%" height={height}>
        <Treemap
          data={treemapData}
          dataKey="value"
          nameKey="name"
          aspectRatio={4 / 3}
          stroke="#ffffff"
          content={<CustomContent colors={colors} />}
        >
          <Tooltip content={<CustomTooltip />} />
        </Treemap>
      </ResponsiveContainer>
    </div>
  );
}
