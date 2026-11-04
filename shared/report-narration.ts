/**
 * Spoken read-out for a Custom Dashboard report.
 *
 * The script is derived deterministically from the report data that is already
 * on the page. It never calls an API or model, never sums returned rows, and
 * keeps the report's honesty rules: unavailable is not zero, rankings are only
 * the returned rows, and notes/warnings are read rather than hidden.
 */
import type { DashboardRow, DashboardSnapshot, DashboardWidget } from "./custom-dashboard";

export interface NarrationSegment {
  id: string;
  /** Report widget that this segment describes, used to highlight it. */
  widgetId?: string;
  text: string;
}

const MAX_WARNINGS = 5;
const UNIT_WORDS: Record<string, string> = { "%": "percent", ms: "milliseconds", s: "seconds" };
const ISO_TIME = /^\d{4}-\d{2}-\d{2}(?:$|T.*(?:Z|[+-]\d{2}:\d{2})$)/;

const formatNumber = (value: number): string => new Intl.NumberFormat("en-US", { maximumSignificantDigits: 17 }).format(value);
const unitWord = (unit: string): string => UNIT_WORDS[unit.trim()] ?? unit.trim();
function spoken(value: unknown, unit: string): string {
  if (typeof value !== "number" || !Number.isFinite(value)) return "unavailable";
  return `${formatNumber(value)}${unit.trim() ? ` ${unitWord(unit)}` : ""}`;
}
const sentence = (text: string): string => /[.!?]$/.test(text.trim()) ? text.trim() : `${text.trim()}.`;
const cleanLabel = (value: unknown): string => value === null || value === undefined || value === "" ? "unavailable" : String(value).replace(/\s+/g, " ").slice(0, 120);
const timeLabel = (ms: number): string => `${new Date(ms).toISOString().slice(0, 16).replace("T", " ")} UTC`;

function describeTimeSeries(widget: DashboardWidget): string {
  const points = widget.rows.map((row: DashboardRow) => ({
    time: typeof row[widget.dimension] === "string" && ISO_TIME.test(String(row[widget.dimension])) ? Date.parse(String(row[widget.dimension])) : NaN,
    value: typeof row[widget.metric] === "number" && Number.isFinite(row[widget.metric] as number) ? row[widget.metric] as number : null,
  }));
  const usable = points.filter(p => Number.isFinite(p.time) && p.value !== null).sort((a, b) => a.time - b.time) as Array<{ time: number; value: number }>;
  if (usable.length < 2 || new Set(usable.map(p => p.time)).size !== usable.length) {
    return `${widget.title} does not have two distinct timestamped observations, so no trend is described. See the evidence table.`;
  }
  const first = usable[0], last = usable[usable.length - 1];
  const peak = usable.reduce((a, b) => b.value > a.value ? b : a), low = usable.reduce((a, b) => b.value < a.value ? b : a);
  const missing = points.length - usable.length;
  return [
    `${widget.title} has ${usable.length} observations.`,
    `It starts at ${spoken(first.value, widget.unit)} on ${timeLabel(first.time)} and ends at ${spoken(last.value, widget.unit)} on ${timeLabel(last.time)}.`,
    `The highest returned value is ${spoken(peak.value, widget.unit)} at ${timeLabel(peak.time)}, and the lowest is ${spoken(low.value, widget.unit)} at ${timeLabel(low.time)}.`,
    missing ? `${missing} observation${missing === 1 ? " is" : "s are"} unavailable and not counted as zero.` : "",
  ].filter(Boolean).join(" ");
}

function describeWidget(widget: DashboardWidget): string {
  if (!widget.rows.length) return `${widget.title}. No observations returned. Unavailable data is not reported as zero.`;
  let body: string;
  if (widget.type === "stat") {
    body = widget.rows.length === 1
      ? `${widget.title} is ${spoken(widget.rows[0][widget.metric], widget.unit)}.`
      : `${widget.title} needs one aggregate row, but ${widget.rows.length} were returned, so no value is read out and nothing has been summed.`;
  } else if (widget.type === "timeseries") {
    body = describeTimeSeries(widget);
  } else if (widget.type === "top-n") {
    const ranked = widget.rows.filter(row => typeof row[widget.metric] === "number" && Number.isFinite(row[widget.metric] as number))
      .sort((a, b) => (b[widget.metric] as number) - (a[widget.metric] as number));
    if (!ranked.length) body = `${widget.title} has no numeric ${widget.metric || "metric"} values to rank.`;
    else if (ranked.some(row => (row[widget.metric] as number) < 0)) body = `${widget.title} includes negative values, so it is not ranked here. See the evidence table.`;
    else {
      const top = ranked.slice(0, 3).map(row => `${cleanLabel(row[widget.dimension])} with ${spoken(row[widget.metric], widget.unit)}`);
      body = `${widget.title}. The top ${top.length === 1 ? "returned row is" : `${top.length} returned rows are`} ${top.join(", ")}. These are the returned rows, not a population total.`;
    }
  } else {
    body = `${widget.title} is a table with ${widget.rows.length} returned row${widget.rows.length === 1 ? "" : "s"}. See the evidence table for the values.`;
  }
  return widget.note ? `${sentence(body)} Note: ${sentence(widget.note.replace(/\s+/g, " ").slice(0, 300))}` : body;
}

export function narrateDashboard(data: DashboardSnapshot, widgets: DashboardWidget[]): NarrationSegment[] {
  const segments: NarrationSegment[] = [];
  const intro = [
    `Cloudflare custom dashboard report: ${data.title || "untitled dashboard"}.`,
    data.zoneName ? `Scope: ${data.zoneName}.` : "The scope was not supplied.",
    data.period ? `Observation period: ${data.period}.` : "The observation period was not supplied.",
    data.origin === "api" ? "These figures come from fresh API queries at generation time." : "These figures are an imported point-in-time snapshot.",
    `This report includes ${widgets.length} widget${widgets.length === 1 ? "" : "s"}.`,
    data.notes ? `Report note: ${sentence(data.notes.replace(/\s+/g, " ").slice(0, 2000))}` : "",
  ].join(" ");
  segments.push({ id: "intro", text: intro });
  if (data.warnings.length) {
    const shown = data.warnings.slice(0, MAX_WARNINGS).map(w => sentence(w.replace(/\s+/g, " ").slice(0, 300)));
    const more = data.warnings.length - shown.length;
    segments.push({ id: "coverage", text: `Data coverage notes. ${shown.join(" ")}${more > 0 ? ` ${more} more note${more === 1 ? " is" : "s are"} listed in the report.` : ""}` });
  }
  widgets.forEach(widget => segments.push({ id: `widget-${widget.id}`, widgetId: widget.id, text: describeWidget(widget) }));
  segments.push({ id: "closing", text: "That is the end of the read-out. Sampling, dataset limits and original filters apply. Missing values remain unavailable, and returned rankings are not population totals." });
  return segments;
}
