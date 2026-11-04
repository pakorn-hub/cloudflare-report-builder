export function formatNumber(n: number | undefined | null): string {
  if (n === undefined || n === null) return "N/A";
  if (n >= 1e9) return `${(n / 1e9).toFixed(1)}B`;
  if (n >= 1e6) return `${(n / 1e6).toFixed(1)}M`;
  if (n >= 1e3) return `${(n / 1e3).toFixed(1)}K`;
  return n.toLocaleString();
}

export function formatBytes(bytes: number | undefined | null): string {
  if (!bytes) return "0 B";
  if (bytes >= 1e12) return `${(bytes / 1e12).toFixed(2)} TB`;
  if (bytes >= 1e9) return `${(bytes / 1e9).toFixed(2)} GB`;
  if (bytes >= 1e6) return `${(bytes / 1e6).toFixed(2)} MB`;
  if (bytes >= 1e3) return `${(bytes / 1e3).toFixed(2)} KB`;
  return `${bytes} B`;
}

export function formatDate(iso: string): string {
  // Parse YYYY-MM-DD as LOCAL date (not UTC) to avoid off-by-one across timezones.
  // new Date("2026-03-25") parses as UTC midnight which shifts the date in +UTC zones.
  // Appending T12:00:00 makes it midday local time — safe in all timezones ±12h.
  const safe = iso.length === 10 ? `${iso}T12:00:00` : iso;
  return new Date(safe).toLocaleDateString("en-US", {
    year: "numeric", month: "short", day: "numeric",
  });
}

export function pct(num: number, den: number): string {
  if (!den) return "0%";
  return `${Math.round((num / den) * 100)}%`;
}

/**
 * Formats a rate/percentage for DISPLAY, without rounding small-but-real
 * values down to a misleading "0%". `Math.round()` alone turns anything
 * under 0.5% into "0%" — on a high-volume Gateway account, "3.5K blocked
 * of 171M inspected" (0.002%) genuinely IS non-zero and worth showing, not
 * indistinguishable from "0 blocked". Precision scales with magnitude so
 * normal-sized rates (e.g. 12%) still render as clean integers.
 */
export function formatRate(num: number, den: number): string {
  if (!den || den <= 0) return "0%";
  const value = (num / den) * 100;
  if (value <= 0) return "0%";
  if (value < 0.01) return "<0.01%";
  if (value < 1) return `${value.toFixed(2)}%`;
  if (value < 10) return `${value.toFixed(1)}%`;
  return `${Math.round(value)}%`;
}

export function daysLabel(days: number): string {
  if (days < 0) return "Expired";
  if (days === 0) return "Expires today";
  if (days === 1) return "1 day";
  return `${days} days`;
}

export function certStatusColor(days: number): string {
  if (days < 0) return "text-red-600";
  if (days < 30) return "text-orange-500";
  if (days < 90) return "text-yellow-600";
  return "text-green-600";
}

/** Short date for chart axis labels */
export function shortDate(dateStr: string): string {
  const d = new Date(dateStr);
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}
