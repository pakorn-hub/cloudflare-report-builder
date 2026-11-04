/**
 * Donut/Pie chart for categorical breakdowns (cache status, TLS version, bot score, etc.)
 */
import { PieChart, Pie, Cell, Tooltip, Legend, ResponsiveContainer } from "recharts";

interface DataItem {
  name: string;
  value: number;
  pct?: number;
}

interface Props {
  data: DataItem[];
  title: string;
  subtitle?: string;
  colors?: string[];
  height?: number;
  innerRadius?: number;
  showPct?: boolean;
  /** "right" (default, vertical legend) or "bottom" (horizontal, wraps) —
   *  use "bottom" when legend labels are long enough to overlap/crowd the
   *  chart in a vertical-right layout. */
  legendPosition?: "right" | "bottom";
}

// Cloudflare-themed default palette
const DEFAULT_COLORS = [
  "#F6821F", // cf-orange
  "#00B0D1", // cf-teal
  "#10B981", // green
  "#3B82F6", // blue
  "#8B5CF6", // purple
  "#EC4899", // pink
  "#F59E0B", // amber
  "#EF4444", // red
  "#64748B", // slate
  "#6B7280", // gray
];

function CustomTooltip({ active, payload }: {
  active?: boolean;
  payload?: { name: string; value: number; payload: DataItem }[];
}) {
  if (!active || !payload?.length) return null;
  const item = payload[0];
  return (
    <div className="bg-white border border-cf-orange rounded-lg shadow-lg p-3">
      <p className="text-xs font-semibold text-cf-gray-600">{item.name}</p>
      <p className="text-sm font-bold text-cf-navy">{item.value.toLocaleString()}</p>
      {item.payload.pct !== undefined && (
        <p className="text-xs text-cf-gray-500">{item.payload.pct}%</p>
      )}
    </div>
  );
}

function CustomLabel({ cx, cy, midAngle, innerRadius, outerRadius, pct }: {
  cx: number; cy: number; midAngle: number;
  innerRadius: number; outerRadius: number; pct: number;
}) {
  if (pct < 5) return null;
  const RADIAN = Math.PI / 180;
  const radius = innerRadius + (outerRadius - innerRadius) * 0.5;
  const x = cx + radius * Math.cos(-midAngle * RADIAN);
  const y = cy + radius * Math.sin(-midAngle * RADIAN);
  return (
    <text x={x} y={y} fill="white" textAnchor="middle" dominantBaseline="central" fontSize={11} fontWeight={600}>
      {`${pct}%`}
    </text>
  );
}

export default function PieBreakdownChart({
  data, title, subtitle, colors = DEFAULT_COLORS,
  height = 280, innerRadius = 50, showPct = true, legendPosition = "right",
}: Props) {
  if (!data.length) {
    return (
      <div className="bg-white rounded-xl shadow-sm border border-cf-gray-200 p-5 flex flex-col items-center justify-center" style={{ height }}>
        <p className="text-xs text-cf-gray-400">{title}</p>
        <p className="text-sm text-cf-gray-500 mt-1">No data available</p>
      </div>
    );
  }

  const total = data.reduce((s, d) => s + d.value, 0);
  const enriched = data.map((d) => ({
    ...d,
    pct: total > 0 ? Math.round((d.value / total) * 100) : 0,
  }));

  const isBottom = legendPosition === "bottom";
  // Bottom legend needs room below the pie; right legend needs room beside it.
  const chartHeight = isBottom ? height + Math.ceil(enriched.length / 2) * 20 : height;

  return (
    <div className="bg-white rounded-xl shadow-sm border border-cf-gray-200 p-5">
      <div className="mb-4">
        <h3 className="text-sm font-semibold text-cf-navy">{title}</h3>
        {subtitle && <p className="text-xs text-cf-gray-500 mt-0.5">{subtitle}</p>}
      </div>
      <ResponsiveContainer width="100%" height={chartHeight}>
        <PieChart margin={isBottom ? { top: 0, right: 0, bottom: 8, left: 0 } : undefined}>
          <Pie
            data={enriched}
            cx="50%"
            cy={isBottom ? "42%" : "50%"}
            innerRadius={innerRadius}
            outerRadius={innerRadius + 55}
            dataKey="value"
            nameKey="name"
            labelLine={false}
            label={showPct ? CustomLabel : undefined}
          >
            {enriched.map((_, i) => (
              <Cell key={i} fill={colors[i % colors.length]} />
            ))}
          </Pie>
          <Tooltip content={<CustomTooltip />} />
          <Legend
            layout={isBottom ? "horizontal" : "vertical"}
            align={isBottom ? "center" : "right"}
            verticalAlign={isBottom ? "bottom" : "middle"}
            iconType="circle"
            iconSize={8}
            wrapperStyle={isBottom
              ? { fontSize: "11px", paddingTop: "12px", lineHeight: "18px" }
              : { fontSize: "11px" }}
          />
        </PieChart>
      </ResponsiveContainer>
    </div>
  );
}
