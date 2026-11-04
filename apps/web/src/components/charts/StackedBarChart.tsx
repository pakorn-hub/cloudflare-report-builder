/**
 * Stacked bar chart for daily WAF actions (block/challenge/log/skip).
 */
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid,
  Tooltip, Legend, ResponsiveContainer,
} from "recharts";
import { shortDate } from "../../utils/formatters";

export interface StackSeries {
  key: string;
  label: string;
  color: string;
}

interface Props {
  data: Record<string, unknown>[];
  series: StackSeries[];
  title: string;
  subtitle?: string;
  height?: number;
  xKey?: string;
  labelFormatter?: (value: string) => string;
}

function CustomTooltip({ active, payload, label }: {
  active?: boolean;
  payload?: { name: string; value: number; color: string }[];
  label?: string;
}) {
  if (!active || !payload?.length) return null;
  const total = payload.reduce((s, p) => s + (p.value || 0), 0);
  return (
    <div className="bg-white border border-cf-orange rounded-lg shadow-lg p-3 min-w-[160px]">
      <p className="text-xs font-semibold text-cf-gray-600 mb-2">{label}</p>
      {payload.map((p) => (
        <div key={p.name} className="flex items-center justify-between gap-4">
          <span className="flex items-center gap-1.5 text-xs text-cf-gray-600">
            <span className="w-2 h-2 rounded-sm inline-block" style={{ background: p.color }} />
            {p.name}
          </span>
          <span className="text-xs font-bold text-cf-navy">{p.value.toLocaleString()}</span>
        </div>
      ))}
      <div className="border-t border-cf-gray-100 mt-2 pt-2 flex justify-between">
        <span className="text-xs text-cf-gray-500">Total</span>
        <span className="text-xs font-bold text-cf-navy">{total.toLocaleString()}</span>
      </div>
    </div>
  );
}

export default function StackedBarChart({
  data, series, title, subtitle, height = 240, xKey = "date", labelFormatter = shortDate,
}: Props) {
  const chartData = data.map((d) => ({
    ...d,
    _label: labelFormatter(String(d[xKey])),
  }));

  return (
    <div className="bg-white rounded-xl shadow-sm border border-cf-gray-200 p-5">
      <div className="mb-4">
        <h3 className="text-sm font-semibold text-cf-navy">{title}</h3>
        {subtitle && <p className="text-xs text-cf-gray-500 mt-0.5">{subtitle}</p>}
      </div>
      <ResponsiveContainer width="100%" height={height}>
        <BarChart data={chartData} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#E5E7EB" />
          <XAxis
            dataKey="_label"
            tick={{ fontSize: 10, fill: "#6B7280" }}
            tickLine={false}
            axisLine={false}
            interval="preserveStartEnd"
          />
          <YAxis
            tickFormatter={(v) =>
              v >= 1e6 ? `${(v / 1e6).toFixed(1)}M` : v >= 1e3 ? `${(v / 1e3).toFixed(0)}K` : String(v)
            }
            tick={{ fontSize: 10, fill: "#6B7280" }}
            tickLine={false}
            axisLine={false}
            width={48}
          />
          <Tooltip content={<CustomTooltip />} />
          <Legend
            wrapperStyle={{ fontSize: "11px", paddingTop: "12px" }}
            iconType="square"
            iconSize={8}
          />
          {series.map((s) => (
            <Bar
              key={s.key}
              dataKey={s.key}
              name={s.label}
              fill={s.color}
              stackId="stack"
              maxBarSize={24}
            />
          ))}
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
