import { ArrowUp, ArrowDown, Minus } from "lucide-react";
import type { ZeroTrustData } from "../types";

type Baseline = ZeroTrustData["baseline"];

interface Props {
  baseline: Baseline;
  field?: string;
  /** If true, an increase is shown in red and a decrease in green (use for
   *  metrics where "more" is bad, e.g. blocked events, findings). Default
   *  treats an increase as neutral/informational (blue) — most Zero Trust
   *  volume metrics aren't simply "good" or "bad" by direction alone. */
  invert?: boolean;
}

/**
 * Small "vs previous report" delta badge — reads a persisted D1 snapshot
 * baseline (see services/zt-snapshots.ts on the API side) and renders the
 * percentage change since the prior report generation for the same account.
 * Renders nothing if no baseline exists yet (e.g. the very first report for
 * an account) or the field wasn't tracked.
 */
export default function BaselineDelta({ baseline, field, invert = false }: Props) {
  const d = field ? baseline?.deltas?.[field] : undefined;
  if (!d || d.changePct === null) return null;

  const pct = d.changePct;
  const flat = Math.abs(pct) < 0.5;
  const up = pct > 0;

  let color = "#6B7280";
  if (!flat) {
    const isGood = invert ? !up : up;
    color = isGood ? "#10B981" : "#DC2626";
  }

  return (
    <span
      className="print:hidden inline-flex items-center gap-0.5 text-[10px] font-semibold rounded-full px-1.5 py-0.5"
      style={{ color, backgroundColor: `${color}14` }}
      title={`Previous report (${baseline?.previousGeneratedAt ? new Date(baseline.previousGeneratedAt).toLocaleDateString() : "n/a"}): ${d.previous.toLocaleString()}`}
    >
      {flat ? <Minus size={9}/> : up ? <ArrowUp size={9}/> : <ArrowDown size={9}/>}
      {flat ? "flat" : `${Math.abs(pct)}%`}
    </span>
  );
}
