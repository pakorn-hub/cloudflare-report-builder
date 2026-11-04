/**
 * FunnelChart — request lifecycle funnel.
 * Shows how requests flow: Total → Cached → Origin-served → Blocked.
 * Built with Recharts FunnelChart.
 */
import { FunnelChart as ReFunnelChart, Funnel, LabelList, Tooltip, ResponsiveContainer } from "recharts";

interface FunnelStep {
  name: string;
  value: number;
  fill: string;
  label?: string;
}

interface Props {
  data: FunnelStep[];
  title: string;
  subtitle?: string;
  height?: number;
}

function CustomTooltip({ active, payload }: { active?: boolean; payload?: { payload: FunnelStep }[] }) {
  if (!active || !payload?.length) return null;
  const d = payload[0].payload;
  return (
    <div className="bg-white border border-cf-gray-200 rounded-lg shadow-lg p-3 text-xs">
      <p className="font-bold text-cf-navy">{d.name}</p>
      <p style={{ color: d.fill }} className="font-semibold mt-0.5">
        {d.value.toLocaleString()}
      </p>
      {d.label && <p className="text-cf-gray-500 mt-0.5">{d.label}</p>}
    </div>
  );
}

export default function FunnelChart({ data, title, subtitle, height = 300 }: Props) {
  return (
    <div className="bg-white rounded-xl shadow-sm border border-cf-gray-200 p-5">
      <div className="mb-4">
        <h3 className="text-sm font-semibold text-cf-navy">{title}</h3>
        {subtitle && <p className="text-xs text-cf-gray-500 mt-0.5">{subtitle}</p>}
      </div>
      <ResponsiveContainer width="100%" height={height}>
        <ReFunnelChart>
          <Tooltip content={<CustomTooltip />} />
          <Funnel dataKey="value" data={data} isAnimationActive>
            <LabelList
              position="right"
              content={({ value, name }) => (
                <text
                  x={0}
                  y={0}
                  fill="#44403C"
                  style={{ fontSize: 11, fontWeight: 600 }}
                >
                  {name}: {typeof value === "number" ? value.toLocaleString() : value}
                </text>
              )}
            />
          </Funnel>
        </ReFunnelChart>
      </ResponsiveContainer>
    </div>
  );
}
