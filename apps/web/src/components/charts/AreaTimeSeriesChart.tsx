/**
 * AreaTimeSeriesChart — filled area chart for time-series data.
 * Richer alternative to the plain line TimeSeriesChart — use for
 * single-metric trends (requests, bandwidth, WAF events).
 */
import {
  AreaChart, Area, XAxis, YAxis, CartesianGrid,
  Tooltip, ResponsiveContainer, Legend,
} from "recharts";

interface Series {
  key: string;
  label: string;
  color: string;
  fillOpacity?: number;
}

interface Props {
  data: Record<string, unknown>[];
  series: Series[];
  title: string;
  subtitle?: string;
  height?: number;
  tickFormatter?: (v: number) => string;
  xDataKey?: string;
}

export default function AreaTimeSeriesChart({
  data,
  series,
  title,
  subtitle,
  height = 260,
  tickFormatter = (v) => v.toLocaleString(),
  xDataKey = "date",
}: Props) {
  return (
    <div className="bg-white rounded-xl shadow-sm border border-cf-gray-200 p-5">
      <div className="mb-4">
        <h3 className="text-sm font-semibold text-cf-navy">{title}</h3>
        {subtitle && <p className="text-xs text-cf-gray-500 mt-0.5">{subtitle}</p>}
      </div>
      <ResponsiveContainer width="100%" height={height}>
        <AreaChart data={data} margin={{ top: 5, right: 15, left: 0, bottom: 5 }}>
          <defs>
            {series.map((s) => (
              <linearGradient key={s.key} id={`grad-${s.key}`} x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor={s.color} stopOpacity={0.25} />
                <stop offset="95%" stopColor={s.color} stopOpacity={0.03} />
              </linearGradient>
            ))}
          </defs>
          <CartesianGrid strokeDasharray="3 3" stroke="#E8E6E3" vertical={false} />
          <XAxis
            dataKey={xDataKey}
            tick={{ fontSize: 10, fill: "#78716C" }}
            tickLine={false}
            axisLine={false}
            interval="preserveStartEnd"
          />
          <YAxis
            tickFormatter={tickFormatter}
            tick={{ fontSize: 10, fill: "#78716C" }}
            tickLine={false}
            axisLine={false}
            width={50}
          />
          <Tooltip
            formatter={(v: number, name: string) => [tickFormatter(v), name]}
            contentStyle={{
              borderRadius: "8px",
              border: "1px solid #E8E6E3",
              fontSize: "11px",
              boxShadow: "0 2px 8px rgba(0,0,0,0.08)",
            }}
          />
          {series.length > 1 && (
            <Legend iconType="circle" iconSize={8} wrapperStyle={{ fontSize: "11px" }} />
          )}
          {series.map((s) => (
            <Area
              key={s.key}
              type="monotone"
              dataKey={s.key}
              name={s.label}
              stroke={s.color}
              strokeWidth={2}
              fill={`url(#grad-${s.key})`}
              fillOpacity={s.fillOpacity ?? 1}
              dot={false}
              activeDot={{ r: 4, strokeWidth: 0 }}
            />
          ))}
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}
