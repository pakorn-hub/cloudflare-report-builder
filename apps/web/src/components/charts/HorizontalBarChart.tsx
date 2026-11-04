/**
 * Horizontal bar chart for ranked/top-N data (WAF rules, countries, paths, vectors).
 * Uses Recharts BarChart with layout="vertical".
 */
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid,
  Tooltip, Cell, ResponsiveContainer,
} from "recharts";

interface DataItem {
  name: string;
  value: number;
  label?: string;
  color?: string;
}

interface Props {
  data: DataItem[];
  title: string;
  subtitle?: string;
  color?: string;
  height?: number;
  xTickFormatter?: (v: number) => string;
  maxLabelLength?: number;
}

function CustomTooltip({ active, payload, label }: {
  active?: boolean; payload?: { value: number }[]; label?: string;
}) {
  if (!active || !payload?.length) return null;
  return (
    <div className="bg-white border border-cf-orange rounded-lg shadow-lg p-3">
      <p className="text-xs font-semibold text-cf-gray-600 max-w-[200px] break-all">{label}</p>
      <p className="text-sm font-bold text-cf-navy mt-1">{payload[0].value.toLocaleString()}</p>
    </div>
  );
}

export default function HorizontalBarChart({
  data, title, subtitle,
  color = "#F6821F",
  height,
  xTickFormatter = (v) => v >= 1e6 ? `${(v / 1e6).toFixed(1)}M` : v >= 1e3 ? `${(v / 1e3).toFixed(0)}K` : String(v),
  maxLabelLength = 28,
}: Props) {
  if (!data.length) {
    return (
      <div className="bg-white rounded-xl shadow-sm border border-cf-gray-200 p-5">
        <h3 className="text-sm font-semibold text-cf-navy mb-2">{title}</h3>
        <p className="text-sm text-cf-gray-400">No data available</p>
      </div>
    );
  }

  const chartHeight = height ?? Math.max(200, data.length * 36 + 60);

  const chartData = data.map((d) => ({
    ...d,
    _label: d.name.length > maxLabelLength ? d.name.slice(0, maxLabelLength) + "…" : d.name,
  }));

  return (
    <div className="bg-white rounded-xl shadow-sm border border-cf-gray-200 p-5">
      <div className="mb-4">
        <h3 className="text-sm font-semibold text-cf-navy">{title}</h3>
        {subtitle && <p className="text-xs text-cf-gray-500 mt-0.5">{subtitle}</p>}
      </div>
      <ResponsiveContainer width="100%" height={chartHeight}>
        <BarChart
          data={chartData}
          layout="vertical"
          margin={{ top: 0, right: 16, left: 8, bottom: 0 }}
        >
          <CartesianGrid strokeDasharray="3 3" horizontal={false} stroke="#E5E7EB" />
          <XAxis
            type="number"
            tickFormatter={xTickFormatter}
            tick={{ fontSize: 10, fill: "#6B7280" }}
            tickLine={false}
            axisLine={false}
          />
          <YAxis
            type="category"
            dataKey="_label"
            width={160}
            tick={{ fontSize: 10, fill: "#374151" }}
            tickLine={false}
            axisLine={false}
          />
          <Tooltip content={<CustomTooltip />} cursor={{ fill: "#F3F4F6" }} />
          <Bar dataKey="value" radius={[0, 4, 4, 0]} maxBarSize={20}>
            {chartData.map((d, i) => (
              <Cell key={i} fill={d.color ?? color} fillOpacity={1 - i * 0.05} />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
