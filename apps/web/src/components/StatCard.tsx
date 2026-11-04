import clsx from "clsx";

type Color = "orange" | "blue" | "green" | "red" | "purple" | "teal";

interface Props {
  title: string;
  value: string | number;
  subtitle?: string;
  icon?: React.ReactNode;
  color?: Color;
  trend?: "up" | "down" | "neutral";
  trendLabel?: string;
  className?: string;
}

const COLOR_MAP: Record<Color, { border: string; icon: string; trend: string }> = {
  orange: { border: "border-cf-orange", icon: "bg-orange-50 text-cf-orange", trend: "text-cf-orange" },
  blue:   { border: "border-blue-500",  icon: "bg-blue-50 text-blue-600",    trend: "text-blue-600" },
  green:  { border: "border-green-500", icon: "bg-green-50 text-green-600",  trend: "text-green-600" },
  red:    { border: "border-red-500",   icon: "bg-red-50 text-red-600",      trend: "text-red-600" },
  purple: { border: "border-purple-500",icon: "bg-purple-50 text-purple-600",trend: "text-purple-600" },
  teal:   { border: "border-cf-teal",   icon: "bg-cyan-50 text-cf-teal",     trend: "text-cf-teal" },
};

const TREND_ICON: Record<string, string> = { up: "↑", down: "↓", neutral: "→" };

export default function StatCard({
  title, value, subtitle, icon, color = "orange", trend, trendLabel, className,
}: Props) {
  const c = COLOR_MAP[color];
  return (
    <div
      className={clsx(
        "bg-white rounded-xl shadow-sm border border-cf-gray-200 border-l-4 p-5 flex items-start gap-4",
        c.border,
        className
      )}
    >
      {icon && (
        <div className={clsx("rounded-lg p-2 flex-shrink-0", c.icon)}>
          {icon}
        </div>
      )}
      <div className="min-w-0 flex-1">
        <p className="text-xs font-medium text-cf-gray-500 uppercase tracking-wide truncate">{title}</p>
        <p className="text-2xl font-bold text-cf-navy mt-0.5 leading-tight">{value}</p>
        {subtitle && (
          <p className="text-xs text-cf-gray-500 mt-0.5">{subtitle}</p>
        )}
        {trend && trendLabel && (
          <p className={clsx("text-xs font-medium mt-1", c.trend)}>
            {TREND_ICON[trend]} {trendLabel}
          </p>
        )}
      </div>
    </div>
  );
}
