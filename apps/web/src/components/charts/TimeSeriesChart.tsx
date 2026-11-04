/**
 * Generic multi-series area/line chart for daily time-series data.
 * Built on Recharts AreaChart — reused pattern from cloudflare-radar-attack-report.
 */
import {
  AreaChart, Area, XAxis, YAxis, CartesianGrid,
  Tooltip, Legend, ResponsiveContainer,
} from "recharts";
import { shortDate } from "../../utils/formatters";

export interface SeriesDef {
  key: string;
  label: string;
  color: string;
  strokeDasharray?: string;
}

interface Props {
  data: Record<string, unknown>[];
  series: SeriesDef[];
  title: string;
  subtitle?: string;
  height?: number;
  yTickFormatter?: (v: number) => string;
  xKey?: string;
}

// Custom tooltip styled with Cloudflare brand
function CustomTooltip({ active, payload, label }: {
  active?: boolean;
  payload?: { name: string; value: number; color: string }[];
  label?: string;
}) {
  if (!active || !payload?.length) return null;
  return (
    <div className="bg-white border border-cf-orange rounded-lg shadow-lg p-3 min-w-[160px]">
      <p className="text-xs font-semibold text-cf-gray-600 mb-2">{label}</p>
      {payload.map((p) => (
        <div key={p.name} className="flex items-center justify-between gap-4">
          <span className="flex items-center gap-1.5 text-xs text-cf-gray-600">
            <span className="w-2 h-2 rounded-full inline-block" style={{ background: p.color }} />
            {p.name}
          </span>
          <span className="text-xs font-bold text-cf-navy">{p.value.toLocaleString()}</span>
        </div>
      ))}
    </div>
  );
}

export default function TimeSeriesChart({
  data, series, title, subtitle, height = 240,
  yTickFormatter = (v) => v >= 1e6 ? `${(v / 1e6).toFixed(1)}M` : v >= 1e3 ? `${(v / 1e3).toFixed(0)}K` : String(v),
  xKey = "date",
}: Props) {
  const chartData = data.map((d) => ({
    ...d,
    _label: shortDate(String(d[xKey])),
  }));

  return (
    <div className="bg-white rounded-xl shadow-sm border border-cf-gray-200 p-5">
      <div className="mb-4">
        <h3 className="text-sm font-semibold text-cf-navy">{title}</h3>
        {subtitle && <p className="text-xs text-cf-gray-500 mt-0.5">{subtitle}</p>}
      </div>
      <ResponsiveContainer width="100%" height={height}>
        <AreaChart data={chartData} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
          <defs>
            {series.map((s) => (
              <linearGradient key={s.key} id={`grad-${s.key}`} x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor={s.color} stopOpacity={0.2} />
                <stop offset="95%" stopColor={s.color} stopOpacity={0} />
              </linearGradient>
            ))}
          </defs>
          <CartesianGrid strokeDasharray="3 3" stroke="#E5E7EB" />
          <XAxis
            dataKey="_label"
            tick={{ fontSize: 10, fill: "#6B7280" }}
            tickLine={false}
            axisLine={false}
            interval="preserveStartEnd"
          />
          <YAxis
            tickFormatter={yTickFormatter}
            tick={{ fontSize: 10, fill: "#6B7280" }}
            tickLine={false}
            axisLine={false}
            width={48}
          />
          <Tooltip content={<CustomTooltip />} />
          <Legend
            wrapperStyle={{ fontSize: "11px", paddingTop: "12px" }}
            iconType="circle"
            iconSize={8}
          />
          {series.map((s) => (
            <Area
              key={s.key}
              type="monotone"
              dataKey={s.key}
              name={s.label}
              stroke={s.color}
              strokeWidth={2}
              fill={`url(#grad-${s.key})`}
              dot={false}
              activeDot={{ r: 4, strokeWidth: 0 }}
              strokeDasharray={s.strokeDasharray}
            />
          ))}
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}
