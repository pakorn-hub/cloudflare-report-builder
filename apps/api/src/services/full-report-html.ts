/**
 * Full-report HTML renderer — the "run the same as on-demand" half of the
 * scheduled email feature.
 *
 * The email body stays the compact email-safe digest (email clients strip
 * <style> and JS), but the COMPLETE report — every section the on-demand
 * dashboard renders from the same generated data — is attached as a
 * standalone .html file. Because it's an attachment opened in a real
 * browser, it may use a <style> block, hover, and print-friendly layout.
 *
 * Honesty rules (same as the dashboard):
 *   - Every section is backed by the same generated data — nothing is invented.
 *   - A section whose data is empty or unavailable renders an honest empty
 *     state explaining why, or is omitted entirely when the whole dataset
 *     could not be fetched (e.g. retention-limited adaptive data).
 */

import type { AppSecData, ZeroTrustData } from "../types";
import type { MagicTransitData } from "../../../../shared/magic-transit";
import { consolidateMtTunnels } from "../../../../shared/magic-transit-tunnels";

/** Reduced, script-free fallback only when the complete React bundle is unavailable. */
export function renderMtFullReport(data: MagicTransitData, p: FullReportParams): string {
  const bytes = (bits: number | null | undefined) => bits == null ? "Unavailable" : fmtBytes(bits / 8);
  const grid = kpiGrid([
    { label: "Ingress traffic", value: bytes(data.summary.traffic?.bits) },
    { label: "Dropped traffic", value: bytes(data.summary.dropped?.bits) },
    { label: "Attack events", value: data.summary.attackCount === null ? "Unavailable" : fmtNum(data.summary.attackCount) },
  ]);
  const tab = (headers: string[], rows: unknown[][]) => table(headers.map(h => ({ h })), rows.map(row => ({ cells: row.map(esc) })));
  const sources = [...(data.attackRankings?.sources ?? [])].sort((a, b) => b.bits - a.bits);
  const targets = [...(data.attackRankings?.targets ?? [])].sort((a, b) => b.bits - a.bits);
  const attackFocus = tab(["Source IP", "Country", "Mitigated bytes", "Packets"], sources.map(r => [r.ip, r.country, bytes(r.bits), fmtNum(r.packets)]))
    + tab(["Target IP", "Port / protocol", "Mitigated bytes", "Packets"], targets.map(r => [r.ip, `${r.port ?? "Unknown"} / ${r.protocol}`, bytes(r.bits), fmtNum(r.packets)]))
    + (!sources.length || !targets.length ? "<p>Some attack rankings are empty or unavailable. See collection status; older reports require regeneration.</p>" : "");
  const sections = [section("attack-priority", "Top attack sources & targets", attackFocus, "Ranked by selected-period DDoS-mitigated ingress volume, not all traffic or event-lifetime totals. Application names require explicit mappings."), section("summary", "Executive assessment", summaryBlock(p.aiSummary)), section("traffic", "Traffic overview", grid + barChart(data.traffic.map(t => ({ date: t.timestamp, value: t.bps })), "#078dad", v => `${fmtNum(v)} bps`), "Reduced fallback rendering: the full interactive bundle was unavailable. Peaks are bucket averages.")];
  sections.push(section("outcomes", "Traffic outcomes", tab(["Outcome", "Packets", "Bytes"], data.outcomes.map(r => [r.name, fmtNum(r.packets), bytes(r.bits)]))));
  sections.push(section("mitigation", "Mitigation systems", tab(["System", "Packets", "Bytes"], data.mitigationSystems.map(r => [r.name, fmtNum(r.packets), bytes(r.bits)]))));
  for (const [key, ranks] of Object.entries(data.rankings)) sections.push(section(key, key, tab(["Category", "Packets", "Bytes"], ranks.map(r => [r.name, fmtNum(r.packets), bytes(r.bits)]))));
  sections.push(section("pairs", "Protocol-port measurements", tab(["Protocol", "Port", "Packets", "Bytes"], data.protocolPorts.map(r => [r.protocol, r.port, fmtNum(r.packets), bytes(r.bits)]))));
  sections.push(section("attacks", "Overlapping attack events", tab(["Vector", "Start", "End", "Destination", "Lifetime dropped bytes"], data.attacks.map(a => [a.vector, a.start, a.end ?? "Ongoing", `${a.destination}:${a.port}`, bytes(a.droppedBits)]))));
  sections.push(section("tunnels", "Tunnel inventory", tab(["Name", "Type", "Endpoint", "Checks", "BGP"], data.tunnels.map(t => [t.name, t.type, t.endpoint, t.healthChecksEnabled === null ? "Unknown" : t.healthChecksEnabled, t.bgpState ?? "Unavailable"]))));
  const tunnels = consolidateMtTunnels(data);
  const cadence = tunnels.interval === "hour" ? "Hourly" : "Daily";
  sections.push(section("health", "Tunnel health summary", tab(["Tunnel", "OK", "Timeout", "Other", "Probe success", "Mean state"], tunnels.totals.map(t => { const total = t.ok + t.timeout + t.other; return [t.tunnel, t.ok, t.timeout, t.other, total ? `${(t.ok / total * 100).toFixed(1)}%` : "Unavailable", t.state ?? "Unavailable"]; })) + `<details><summary>${cadence} health evidence</summary>${tab(["UTC period start", "Tunnel", "OK", "Timeout", "Other", "Mean state"], tunnels.health.map(t => [t.timestamp, t.tunnel, t.ok, t.timeout, t.other, t.state ?? "Unavailable"]))}</details>`));
  sections.push(section("tunnel-traffic", `${cadence} tunnel traffic`, tunnels.traffic.length ? `<details><summary>${cadence} throughput evidence</summary>${tab(["UTC period start", "Tunnel", "Direction", "Bytes", "Mean bps"], tunnels.traffic.map(t => [t.timestamp, t.tunnel, t.direction, bytes(t.bits), t.bps]))}</details>` : `<p>No tunnel throughput measurements returned. This is not measured zero traffic.</p>`));
  for (const protection of data.protections) sections.push(section(protection.key, protection.name, tab(["Category", "Packets", "Bytes"], protection.breakdown.map(r => [r.name, fmtNum(r.packets), bytes(r.bits)])) + tab(["Rule", "Mode"], protection.rules.map(r => [r.name, r.mode]))));
  sections.push(section("rules", "Protection rules", tab(["Name", "Phase", "Action", "Enabled", "Expression"], data.rules.map(r => [r.name, r.phase, r.action, r.enabled, r.expression]))));
  sections.push(section("rule-activity", "Firewall rule activity", tab(["Rule", "Packets", "Bytes"], data.ruleActivity.map(r => [r.name, fmtNum(r.packets), bytes(r.bits)]))));
  sections.push(section("routes", "Current routes", tab(["Prefix", "Next hop", "Priority"], data.routes.map(r => [r.prefix, r.nextHop, r.priority]))));
  sections.push(section("prefixes", "Current prefixes", tab(["CIDR", "ASN", "Advertisement snapshot", "RPKI"], data.prefixes.map(r => [r.cidr, r.asn ?? "Unavailable", r.advertised ?? "Unavailable", r.rpki]))));
  sections.push(section("quality", "Data quality", data.notes.map(n => `<p>${esc(n)}</p>`).join("") + tab(["Section", "Collection error"], Object.entries(data.errors))));
  return document(`${clientLabelOf(p)}Magic Transit`, data.meta.periodLabel, [["Account", data.meta.accountName], ["UTC range", `${data.meta.sinceTs} → ${data.meta.untilTs}`], ["Current configuration at", data.meta.configurationAt]], p.message, sections.join("\n"));
}

export interface FullReportParams {
  scheduleName: string;
  message: string;
  isPoc: boolean;
  clientName?: string | null;
  aiSummary: string; // may be "" when Workers AI was unavailable
}

// ─── Utilities ────────────────────────────────────────────────────────────────

function esc(s: unknown): string {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function fmtNum(n: unknown): string {
  const v = typeof n === "number" && isFinite(n) ? n : 0;
  if (v >= 1e9) return `${(v / 1e9).toFixed(1)}B`;
  if (v >= 1e6) return `${(v / 1e6).toFixed(1)}M`;
  if (v >= 1e3) return `${(v / 1e3).toFixed(1)}K`;
  return String(Math.round(v));
}

function fmtBytes(bytes: unknown): string {
  const v = typeof bytes === "number" && isFinite(bytes) ? bytes : 0;
  if (v >= 1e12) return `${(v / 1e12).toFixed(1)} TB`;
  if (v >= 1e9) return `${(v / 1e9).toFixed(1)} GB`;
  if (v >= 1e6) return `${(v / 1e6).toFixed(1)} MB`;
  if (v >= 1e3) return `${(v / 1e3).toFixed(1)} KB`;
  return `${Math.round(v)} B`;
}

function fmtPct(n: unknown): string {
  const v = typeof n === "number" && isFinite(n) ? n : 0;
  return `${Math.round(v)}%`;
}

function dateLabel(iso: unknown): string {
  const s = String(iso ?? "");
  return s.length >= 10 ? s.slice(0, 10) : s;
}

// ─── Layout building blocks ───────────────────────────────────────────────────

interface Kpi { label: string; value: string; sub?: string }

function kpiGrid(kpis: Kpi[]): string {
  if (!kpis.length) return "";
  const cards = kpis
    .map(
      (k) => `<div class="kpi">
  <div class="kpi-value">${esc(k.value)}</div>
  <div class="kpi-label">${esc(k.label)}</div>
  ${k.sub ? `<div class="kpi-sub">${esc(k.sub)}</div>` : ""}
</div>`
    )
    .join("\n");
  return `<div class="kpi-grid">${cards}</div>`;
}

/** Pure-CSS bar chart from a date/value series — robust in every browser. */
function barChart(series: { date: string; value: number }[], color: string, valueFmt: (n: number) => string = fmtNum): string {
  const pts = series.filter((d) => typeof d.value === "number" && d.value >= 0);
  if (pts.length === 0) return `<div class="empty">No data for this period.</div>`;
  const max = Math.max(...pts.map((d) => d.value), 1);
  const bars = pts
    .map((d) => {
      const h = Math.max((d.value / max) * 100, d.value > 0 ? 2 : 0.5);
      return `<div class="bar" title="${esc(dateLabel(d.date))}: ${esc(valueFmt(d.value))}">
  <div class="bar-fill" style="height:${h.toFixed(1)}%;background-color:${color}"></div>
</div>`;
    })
    .join("\n");
  const first = dateLabel(pts[0].date);
  const last = dateLabel(pts[pts.length - 1].date);
  const peak = pts.reduce((a, b) => (b.value > a.value ? b : a), pts[0]);
  return `<div class="chart">
  <div class="chart-bars">${bars}</div>
  <div class="chart-axis"><span>${esc(first)}</span><span>peak ${esc(valueFmt(peak.value))} on ${esc(dateLabel(peak.date))}</span><span>${esc(last)}</span></div>
</div>`;
}

interface TableCol { h: string; align?: "left" | "right" }
interface TableRow { cells: string[]; bar?: number } // bar: 0–100 — share of this row's value within the table max

function table(cols: TableCol[], rows: TableRow[]): string {
  if (!rows.length) return `<div class="empty">No data for this period.</div>`;
  const head = cols.map((c) => `<th style="text-align:${c.align ?? "left"}">${esc(c.h)}</th>`).join("");
  const body = rows
    .map((r) => {
      const tds = r.cells.map((cell, i) => `<td style="text-align:${cols[i]?.align ?? "left"}">${cell}</td>`).join("");
      const bar = r.bar !== undefined
        ? `<td class="bar-cell"><div class="table-bar"><div class="table-bar-fill" style="width:${Math.max(1, r.bar).toFixed(1)}%"></div></div></td>`
        : "";
      return `<tr>${tds}${bar}</tr>`;
    })
    .join("\n");
  return `<table class="data"><thead><tr>${head}${rows.some((r) => r.bar !== undefined) ? "<th></th>" : ""}</tr></thead><tbody>${body}</tbody></table>`;
}

/** Rows with an implicit share-bar as the last column. */
function rankedTable(
  cols: TableCol[],
  data: { label: string; values: (string | number)[]; sortValue: number }[],
  fmts: ((v: unknown) => string)[] = []
): string {
  const max = Math.max(...data.map((d) => d.sortValue), 1);
  const rows: TableRow[] = data.map((d) => ({
    cells: [esc(d.label), ...d.values.map((v, i) => esc((fmts[i] ?? fmtNum)(v)))],
    bar: (d.sortValue / max) * 100,
  }));
  return table(cols, rows);
}

function section(id: string, title: string, body: string, note?: string): string {
  if (!body) return "";
  return `<section id="${esc(id)}">
  <h2>${esc(title)}</h2>
  ${note ? `<p class="section-note">${esc(note)}</p>` : ""}
  ${body}
</section>`;
}

function kvTable(rows: [string, string][]): string {
  if (!rows.length) return "";
  return `<table class="kv">${rows.map(([k, v]) => `<tr><td>${esc(k)}</td><td>${esc(v)}</td></tr>`).join("")}</table>`;
}

function summaryBlock(text: string): string {
  const t = (text ?? "").trim();
  if (!t) return `<div class="empty">Executive summary was unavailable for this run (Workers AI) — the numbers below are unaffected.</div>`;
  return t
    .split(/\n{2,}/)
    .map((p) => `<p>${esc(p).replace(/\n/g, "<br/>")}</p>`)
    .join("");
}

// ─── Document shell ───────────────────────────────────────────────────────────

function document(title: string, subtitle: string, metaRows: [string, string][], message: string, body: string): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8"/>
<meta name="viewport" content="width=device-width, initial-scale=1"/>
<title>${esc(title)}</title>
<style>
  :root { --ink:#1c1f2a; --muted:#5d5e65; --line:#e2e2e2; --red:#ba0816; --bg:#f4f4f4; }
  * { box-sizing: border-box; }
  body { margin:0; font:14px/1.6 -apple-system,Helvetica,Arial,sans-serif; color:var(--ink); background:var(--bg); }
  .cover { background:var(--ink); color:#f4f4f4; padding:40px 32px 32px; }
  .cover h1 { margin:0 0 6px; font-size:26px; letter-spacing:-0.02em; }
  .cover p { margin:0; color:rgba(244,244,244,0.6); font-size:13px; }
  .cover .rule { width:48px; height:3px; background:var(--red); margin-bottom:18px; }
  .wrap { max-width:1080px; margin:0 auto; padding:28px 24px 64px; }
  section { background:#fff; border:1px solid var(--line); border-top:3px solid var(--red); padding:24px; margin:24px 0; }
  h2 { margin:0 0 6px; font-size:17px; letter-spacing:-0.01em; }
  .section-note { margin:0 0 14px; font-size:12px; color:var(--muted); }
  .kpi-grid { display:grid; grid-template-columns:repeat(auto-fit,minmax(150px,1fr)); gap:12px; }
  .kpi { border:1px solid var(--line); background:#fafafa; padding:14px; }
  .kpi-value { font-size:22px; font-weight:700; letter-spacing:-0.02em; }
  .kpi-label { font-size:11px; text-transform:uppercase; letter-spacing:0.08em; color:var(--muted); margin-top:2px; }
  .kpi-sub { font-size:11px; color:var(--muted); margin-top:4px; }
  table.data { width:100%; border-collapse:collapse; font-size:13px; }
  table.data th { font-size:10px; text-transform:uppercase; letter-spacing:0.08em; color:var(--muted); border-bottom:1px solid var(--ink); padding:0 10px 8px; }
  table.data td { padding:8px 10px; border-bottom:1px solid var(--line); }
  table.data td.bar-cell { width:30%; }
  .table-bar { background:#f0f0f0; height:6px; border-radius:3px; overflow:hidden; }
  .table-bar-fill { height:100%; background:var(--red); border-radius:3px; }
  table.kv { border-collapse:collapse; font-size:12px; margin:0 0 16px; }
  table.kv td { padding:5px 16px 5px 0; color:var(--muted); }
  table.kv td:last-child { color:var(--ink); }
  .chart { margin:8px 0; }
  .chart-bars { display:flex; align-items:flex-end; gap:2px; height:140px; border-bottom:1px solid var(--line); padding:0 2px; }
  .bar { flex:1; height:100%; display:flex; align-items:flex-end; }
  .bar-fill { width:100%; border-radius:2px 2px 0 0; }
  .chart-axis { display:flex; justify-content:space-between; font-size:10px; color:var(--muted); padding-top:6px; }
  .empty { font-size:12px; color:var(--muted); border:1px dashed var(--line); background:#fafafa; padding:14px; }
  .msg { border:1px solid var(--line); border-left:3px solid var(--red); background:#fafafa; padding:14px 18px; font-size:13px; margin:18px 0; }
  .footer { text-align:center; font-size:11px; color:var(--muted); padding:18px 0 6px; }
  @media print { body { background:#fff; } section { border-color:#ccc; page-break-inside:avoid; } }
</style>
</head>
<body>
<div class="cover">
  <div class="wrap" style="padding:0">
    <div class="rule"></div>
    <h1>${esc(title)}</h1>
    <p>${esc(subtitle)}</p>
  </div>
</div>
<div class="wrap">
  ${kvTable(metaRows)}
  ${message.trim() ? `<div class="msg">${esc(message).replace(/\n/g, "<br/>")}</div>` : ""}
  ${body}
  <div class="footer">Generated by Cloudflare Report Builder — every figure comes from the Cloudflare API for the stated period.</div>
</div>
</body>
</html>`;
}

function clientLabelOf(p: FullReportParams): string {
  return p.clientName ? `${p.clientName} — ` : "";
}

// ─── AppSec full report ──────────────────────────────────────────────────────

export function renderAppsecFullReport(appsec: AppSecData, p: FullReportParams): string {
  const s = appsec.summary ?? ({} as AppSecData["summary"]);
  const meta = appsec.meta ?? ({} as AppSecData["meta"]);
  const periodLabel = meta.periodLabel ?? `${meta.days ?? 30}-Day`;
  const any = appsec as Record<string, any>;

  const sections: string[] = [];

  // 1. Executive summary
  sections.push(section("summary", "Executive Summary", summaryBlock(p.aiSummary)));

  // 2. Traffic & performance
  const ttfbAvg = (appsec.ttfbTimeSeries ?? []).length > 0
    ? Math.round(appsec.ttfbTimeSeries.reduce((a, d) => a + (d.avg ?? 0), 0) / appsec.ttfbTimeSeries.length)
    : 0;
  sections.push(section(
    "traffic",
    "Traffic & Performance",
    kpiGrid([
      { label: "Total Requests", value: fmtNum(s.totalRequests), sub: `${fmtNum(s.uniqueVisitors)} unique visitors` },
      { label: "Bandwidth", value: fmtBytes(s.totalBandwidthBytes), sub: `${fmtBytes(s.cachedBandwidthBytes)} cached` },
      { label: "Cache Hit Rate", value: fmtPct(s.cacheHitRatePct), sub: `bytes: ${fmtPct(s.cacheBandwidthHitRatePct)}` },
      { label: "Avg TTFB", value: ttfbAvg > 0 ? `${ttfbAvg} ms` : "N/A", sub: `origin: ${Math.round(s.avgOriginResponseTimeMs ?? 0)} ms` },
      { label: "Encrypted Requests", value: fmtNum(s.encryptedRequests) },
      { label: "Total Threats", value: fmtNum(s.totalThreatsBlocked), sub: `of ${fmtNum(s.totalThreats)} flagged` },
    ]) +
    "<h3>Requests per day</h3>" +
    barChart((appsec.requestsTimeSeries ?? []).map((d: any) => ({ date: d.date, value: d.requests })), "#ba0816") +
    "<h3>Cache status</h3>" +
    rankedTable([{ h: "Status" }, { h: "Requests", align: "right" }],
      (appsec.cacheStatusBreakdown ?? []).map((c: any) => ({ label: c.cacheStatus ?? c.status ?? "—", values: [c.requests], sortValue: c.requests }))) +
    "<h3>Top edge data centers</h3>" +
    rankedTable([{ h: "Data center" }, { h: "Requests", align: "right" }],
      (appsec.edgeColoDistribution ?? []).map((c: any) => ({ label: c.colo ?? c.coloName ?? "—", values: [c.requests], sortValue: c.requests }))),
    "Daily buckets come from Cloudflare's httpRequests1dGroups (exact); fine-grained sections are sampled like the Cloudflare dashboard."
  ));

  // 3. Security & WAF
  const ddosMitigated = (appsec.ddosTimeSeries ?? []).reduce((a, d: any) => a + (d.mitigated ?? 0), 0);
  sections.push(section(
    "security",
    "Security & WAF",
    "<h3>Top WAF rules triggered</h3>" +
    rankedTable([{ h: "Rule" }, { h: "Count", align: "right" }],
      (appsec.wafTopRules ?? []).map((r: any) => ({ label: r.description ?? r.ruleId ?? r.rule ?? "—", values: [r.count], sortValue: r.count }))) +
    "<h3>Attack classification</h3>" +
    rankedTable([{ h: "Category" }, { h: "Count", align: "right" }],
      (any.wafAttackClassification ?? []).map((r: any) => ({ label: r.category, values: [r.count], sortValue: r.count }))) +
    "<h3>Security events by service</h3>" +
    rankedTable([{ h: "Service / action" }, { h: "Count", align: "right" }],
      (appsec.securityEventsByService ?? []).map((r: any) => ({ label: `${r.source} → ${r.action}`, values: [r.count], sortValue: r.count }))) +
    "<h3>Top threat sources (IP)</h3>" +
    rankedTable([{ h: "IP" }, { h: "Requests", align: "right" }],
      (appsec.topThreatIps ?? []).map((t: any) => ({ label: `${t.ip}${t.country ? ` (${t.country})` : ""}`, values: [t.count], sortValue: t.count }))) +
    "<h3>Top threat ASNs</h3>" +
    rankedTable([{ h: "ASN" }, { h: "Requests", align: "right" }],
      (appsec.topThreatAsns ?? []).map((t: any) => ({ label: `AS${t.asn}${t.asnName ? ` — ${t.asnName}` : ""}`, values: [t.count], sortValue: t.count }))) +
    "<h3>DDoS</h3>" +
    `<p class="section-note">L7 DDoS mitigated in this period: ${fmtNum(ddosMitigated)}.</p>` +
    rankedTable([{ h: "Attack vector" }, { h: "Count", align: "right" }],
      (appsec.ddosAttackVectors ?? []).map((v: any) => ({ label: v.vector ?? v.type ?? "—", values: [v.count], sortValue: v.count })))
  ));

  // 4. Bot management
  sections.push(section(
    "bots",
    "Bot Management",
    kpiGrid([
      { label: "Automated", value: fmtPct(s.automatedPct) },
      { label: "Likely Automated", value: fmtPct(s.likelyAutomatedPct) },
      { label: "Human", value: fmtPct(s.humanPct) },
      { label: "Bot Traffic", value: fmtPct(s.botTrafficPct), sub: `crawler requests: ${fmtNum(s.crawlerRequests)}` },
    ]) +
    "<h3>Verified bot categories</h3>" +
    rankedTable([{ h: "Category" }, { h: "Requests", align: "right" }],
      (appsec.verifiedBotCategories ?? []).map((c: any) => ({ label: c.category, values: [c.count], sortValue: c.count })))
  ));

  // 5. Geography & audience
  sections.push(section(
    "geo",
    "Geography & Audience",
    "<h3>Top countries</h3>" +
    rankedTable([{ h: "Country" }, { h: "Requests", align: "right" }, { h: "Bytes", align: "right" }, { h: "Threats", align: "right" }],
      (appsec.countryDistribution ?? []).map((c: any) => ({
        label: c.clientCountryName ?? "—",
        values: [c.requests, c.bytes, c.threats],
        sortValue: c.requests,
      })), [fmtNum, fmtBytes, fmtNum]) +
    "<h3>Browsers</h3>" +
    rankedTable([{ h: "Browser" }, { h: "Requests", align: "right" }],
      (appsec.sourceBrowsers ?? []).map((b: any) => ({ label: b.browser, values: [b.requests], sortValue: b.requests }))) +
    "<h3>Operating systems</h3>" +
    rankedTable([{ h: "OS" }, { h: "Requests", align: "right" }],
      (appsec.sourceOs ?? []).map((o: any) => ({ label: o.os, values: [o.requests], sortValue: o.requests }))) +
    "<h3>Devices</h3>" +
    rankedTable([{ h: "Device" }, { h: "Requests", align: "right" }],
      (appsec.deviceBreakdown ?? []).map((d: any) => ({ label: d.clientDeviceType ?? "—", values: [d.requests], sortValue: d.requests }))) +
    "<h3>Top client IPs</h3>" +
    rankedTable([{ h: "IP" }, { h: "Requests", align: "right" }, { h: "Bytes", align: "right" }],
      (appsec.topClientIps ?? []).map((t: any) => ({ label: t.ip, values: [t.requests, t.bytes], sortValue: t.requests })),
      [fmtNum, fmtBytes])
  ));

  // 6. Technology — TLS / PQC / protocols
  const pqcRows = (appsec.tlsKeyExchangeBreakdown ?? []).filter((k: any) => k.isPqc);
  const pqcPct = typeof appsec.pqcAdoptionPct === "number" ? appsec.pqcAdoptionPct : null;
  sections.push(section(
    "tech",
    "Technology — TLS, PQC & Protocols",
    (pqcPct !== null
      ? kpiGrid([{ label: "PQC Adoption", value: fmtPct(pqcPct), sub: "hybrid post-quantum key exchange share" }])
      : "") +
    "<h3>TLS versions</h3>" +
    rankedTable([{ h: "TLS" }, { h: "Requests", align: "right" }],
      (appsec.tlsVersionBreakdown ?? []).map((t: any) => ({ label: t.version ?? t.tlsVersion ?? "—", values: [t.requests], sortValue: t.requests }))) +
    "<h3>Key exchange groups (PQC highlighted)</h3>" +
    table(
      [{ h: "Group" }, { h: "Requests", align: "right" }, { h: "Share", align: "right" }],
      (appsec.tlsKeyExchangeBreakdown ?? []).map((k: any) => ({
        cells: [
          `${esc(k.group)}${k.isPqc ? ' <strong style="color:#ba0816">PQC</strong>' : ""}${k.isUnknown ? ' <span style="color:#5d5e65">(n/a — not negotiated)</span>' : ""}`,
          fmtNum(k.requests),
          fmtPct(k.pct),
        ],
      }))
    ) +
    "<h3>HTTP protocols</h3>" +
    rankedTable([{ h: "Protocol" }, { h: "Requests", align: "right" }],
      (any.httpProtocolBreakdown ?? []).map((r: any) => ({ label: r.protocol ?? "—", values: [r.requests], sortValue: r.requests }))) +
    "<h3>HTTP methods</h3>" +
    rankedTable([{ h: "Method" }, { h: "Requests", align: "right" }],
      (appsec.httpMethodBreakdown ?? []).map((m: any) => ({ label: m.method ?? "—", values: [m.requests], sortValue: m.requests }))),
    pqcRows.length === 0
      ? "No hybrid post-quantum key exchanges were observed in this period — PQC adoption is 0% among negotiated TLS handshakes."
      : "X25519MLKEM768 / X25519Kyber768Draft00 are hybrid post-quantum groups; adoption depends on client browser support."
  ));

  // 7. HTTP status & content
  const st = appsec.httpStatusSummary ?? ({} as any);
  sections.push(section(
    "http",
    "HTTP Status & Content",
    kpiGrid([
      { label: "2xx Success", value: fmtNum(st.e2xx) },
      { label: "3xx Redirect", value: fmtNum(st.e3xx) },
      { label: "4xx Client Err", value: fmtNum(st.e4xx) },
      { label: "5xx Server Err", value: fmtNum(st.e5xx) },
    ]) +
    "<h3>Content types</h3>" +
    rankedTable([{ h: "Type" }, { h: "Requests", align: "right" }, { h: "Bytes", align: "right" }],
      (appsec.contentTypeBreakdown ?? []).map((c: any) => ({
        label: c.edgeResponseContentTypeName ?? "—",
        values: [c.requests, c.bytes],
        sortValue: c.requests,
      })), [fmtNum, fmtBytes]) +
    "<h3>Top hostnames</h3>" +
    rankedTable([{ h: "Hostname" }, { h: "Requests", align: "right" }, { h: "Bytes", align: "right" }],
      (appsec.topHttpHostnames ?? []).map((h: any) => ({ label: h.hostname, values: [h.requests, h.bytes], sortValue: h.requests })),
      [fmtNum, fmtBytes]) +
    "<h3>Top referrers</h3>" +
    rankedTable([{ h: "Referrer" }, { h: "Requests", align: "right" }],
      (appsec.topReferrers ?? []).map((r: any) => ({ label: r.referrer ?? r.host ?? "—", values: [r.requests], sortValue: r.requests })))
  ));

  // 8. DNS analytics
  sections.push(section(
    "dns",
    "DNS Analytics",
    "<h3>Query types</h3>" +
    rankedTable([{ h: "Type" }, { h: "Queries", align: "right" }, { h: "p95 (ms)", align: "right" }],
      (appsec.dnsQueryTypeBreakdown ?? []).map((d: any) => ({
        label: `${d.queryType ?? "—"} · ${d.responseCode ?? ""}`.trim(),
        values: [d.count, (d.p95Us ?? 0) / 1000],
        sortValue: d.count,
      })), [fmtNum, (v) => `${(typeof v === "number" ? v : 0).toFixed(2)}`]) +
    "<h3>Top queried hostnames</h3>" +
    rankedTable([{ h: "Hostname" }, { h: "Queries", align: "right" }],
      (appsec.dnsTopHostnames ?? []).map((h: any) => ({ label: h.hostname, values: [h.count], sortValue: h.count }))) +
    "<h3>NXDOMAIN hotspots</h3>" +
    rankedTable([{ h: "Hostname" }, { h: "Count", align: "right" }],
      (any.nxdomainHotspots ?? []).map((n: any) => ({ label: n.name, values: [n.count], sortValue: n.count })))
  ));

  // 9. AI crawlers
  const aiBots = (any.aiCrawlerBots ?? []) as any[];
  if (aiBots.length > 0) {
    const aiTotal = aiBots.reduce((a, b) => a + (b.requests ?? 0), 0);
    sections.push(section(
      "ai",
      "AI Crawler Traffic",
      kpiGrid([
        { label: "AI Requests", value: fmtNum(aiTotal) },
        { label: "Crawler Bots", value: fmtNum(aiBots.length) },
        { label: "AI Bytes", value: fmtBytes(aiBots.reduce((a, b) => a + (b.bytes ?? 0), 0)) },
      ]) +
      "<h3>Bots</h3>" +
      rankedTable([{ h: "Bot" }, { h: "Operator" }, { h: "Category" }, { h: "Requests", align: "right" }],
        aiBots.map((b) => ({ label: b.botName, values: [b.operator ?? "", b.category ?? "", b.requests], sortValue: b.requests })),
        [fmtNum, fmtNum, fmtNum])
    ));
  }

  // 10. Certificates
  sections.push(section(
    "certs",
    "Certificates",
    table(
      [{ h: "Hosts" }, { h: "Type" }, { h: "Status" }, { h: "Expires", align: "right" }],
      (appsec.certificates ?? []).map((c: any) => ({
        cells: [esc(c.hosts?.join(", ") || c.id), esc(c.type), esc(c.status),
          `${dateLabel(c.expiresOn)} (${c.daysUntilExpiry}d${c.daysUntilExpiry < 30 ? " ⚠" : ""})`],
      }))
    ),
    "⚠ marks certificates expiring within 30 days."
  ));

  return document(
    `App Security Report — ${meta.zoneName ?? "Zone"}`,
    `${clientLabelOf(p)}${periodLabel} · Full report (same data as the on-demand view)`,
    [
      ["Zone", meta.zoneName ?? "—"],
      ["Period", `${meta.since ?? ""} → ${meta.until ?? ""} (${periodLabel})`],
      ["Generated", `${meta.generatedAt ?? new Date().toISOString()} (UTC)`],
      ["Schedule", p.scheduleName],
    ],
    p.message,
    sections.join("\n")
  );
}

// ─── Zero Trust full report ──────────────────────────────────────────────────

export function renderZtFullReport(zt: ZeroTrustData, p: FullReportParams): string {
  const s = zt.summary;
  const meta = zt.meta;
  const any = zt as unknown as Record<string, any>;
  const periodLabel = meta?.periodLabel ?? `${meta?.days ?? 30}-Day`;
  const sections: string[] = [];

  // 1. Executive summary
  sections.push(section("summary", "Executive Summary", summaryBlock(p.aiSummary)));

  // 2. Overview KPIs
  sections.push(section(
    "overview",
    "Account Overview",
    kpiGrid([
      { label: "Auth Events", value: fmtNum(s.totalAuthEvents), sub: `${fmtPct(s.authSuccessRate)} success rate` },
      { label: "Unique Users", value: fmtNum(s.uniqueUsers) },
      { label: "Access Apps", value: fmtNum(s.uniqueApps) },
      { label: "Blocked Logins", value: fmtNum(s.blockedAuthEvents) },
      { label: "MFA Challenges", value: fmtNum(s.mfaChallenges) },
      { label: "Seats", value: fmtNum(s.seatsTotal), sub: `${fmtNum(s.seatsActiveInPeriod)} active in period` },
    ])
  ));

  // 3. Access
  sections.push(section(
    "access",
    "Zero Trust Access",
    "<h3>Auth events per day</h3>" +
    barChart((zt.accessAuthTimeSeries ?? []).map((d: any) => ({ date: d.date, value: d.requests ?? d.count })), "#1c1f2a") +
    "<h3>Top applications</h3>" +
    rankedTable([{ h: "Application" }, { h: "Requests", align: "right" }],
      (zt.accessTopApps ?? []).map((a: any) => ({ label: a.name, values: [a.requests], sortValue: a.requests }))) +
    "<h3>Top users</h3>" +
    rankedTable([{ h: "User" }, { h: "Requests", align: "right" }, { h: "Blocked", align: "right" }],
      (zt.accessTopUsers ?? []).map((u: any) => ({ label: u.email, values: [u.requests, u.blocked], sortValue: u.requests }))) +
    "<h3>Top blocked users</h3>" +
    rankedTable([{ h: "User" }, { h: "Blocked attempts", align: "right" }],
      (zt.accessTopBlockedUsers ?? []).map((u: any) => ({ label: `${u.email}${u.country ? ` (${u.country})` : ""}`, values: [u.count], sortValue: u.count }))) +
    "<h3>Identity providers</h3>" +
    rankedTable([{ h: "IdP" }, { h: "Logins", align: "right" }],
      (zt.accessIdpBreakdown ?? []).map((i: any) => ({ label: i.provider, values: [i.count], sortValue: i.count }))) +
    ((zt.accessAnomalies ?? []).length
      ? "<h3>Anomalies</h3>" +
        table([{ h: "Severity" }, { h: "Finding" }, { h: "Detail" }],
          zt.accessAnomalies.map((a) => ({
            cells: [
              `<strong style="color:${a.severity === "critical" ? "#ba0816" : a.severity === "warning" ? "#b45309" : "#5d5e65"}">${esc(a.severity)}</strong>`,
              esc(a.title), esc(a.description),
            ],
          })))
      : "")
  ));

  // 4. Gateway DNS
  const dnsPct = s.gatewayDnsQueries > 0 ? Math.round((s.gatewayDnsBlocked / s.gatewayDnsQueries) * 100) : 0;
  sections.push(section(
    "dns",
    "Gateway DNS",
    kpiGrid([
      { label: "DNS Queries", value: fmtNum(s.gatewayDnsQueries) },
      { label: "Blocked", value: fmtNum(s.gatewayDnsBlocked), sub: `${dnsPct}% of queries` },
      { label: "Bandwidth Sent", value: fmtBytes(s.gatewayBandwidthBytesSent) },
      { label: "Bandwidth Received", value: fmtBytes(s.gatewayBandwidthBytesRecvd) },
    ]) +
    "<h3>Queries per day</h3>" +
    barChart((zt.gatewayDnsTimeSeries ?? []).map((d: any) => ({ date: d.date, value: d.count ?? d.requests })), "#ba0816") +
    "<h3>Top blocked domains</h3>" +
    rankedTable([{ h: "Domain" }, { h: "Count", align: "right" }],
      (zt.gatewayDnsTopBlockedDomains ?? []).map((d: any) => ({ label: d.domain ?? d.hostname ?? "—", values: [d.count], sortValue: d.count }))) +
    "<h3>Top allowed domains</h3>" +
    rankedTable([{ h: "Domain" }, { h: "Count", align: "right" }],
      (zt.gatewayDnsTopAllowedDomains ?? []).map((d: any) => ({ label: d.domain ?? d.hostname ?? "—", values: [d.count], sortValue: d.count }))) +
    "<h3>Blocked categories</h3>" +
    rankedTable([{ h: "Category" }, { h: "Count", align: "right" }],
      (zt.gatewayDnsTopBlockedCategories ?? []).map((c: any) => ({ label: c.category, values: [c.count], sortValue: c.count })))
  ));

  // 5. Gateway HTTP & network
  sections.push(section(
    "http",
    "Gateway HTTP & Network",
    kpiGrid([
      { label: "HTTP Requests", value: fmtNum(s.gatewayHttpRequests) },
      { label: "HTTP Blocked", value: fmtNum(s.gatewayHttpBlocked) },
      { label: "RBI Sessions", value: fmtNum(s.httpRbiSessions), sub: `${fmtNum(s.httpQuarantinedRequests)} quarantined` },
      { label: "MCP HTTP", value: fmtNum(s.gatewayMcpHttpRequests) },
    ]) +
    "<h3>Requests per day</h3>" +
    barChart((zt.gatewayHttpTimeSeries ?? []).map((d: any) => ({ date: d.date, value: d.count ?? d.requests })), "#1c1f2a") +
    "<h3>Top blocked domains (HTTP)</h3>" +
    rankedTable([{ h: "Domain" }, { h: "Count", align: "right" }],
      (zt.gatewayHttpTopBlockedDomains ?? []).map((d: any) => ({ label: d.domain, values: [d.count], sortValue: d.count }))) +
    "<h3>Top allowed domains (HTTP)</h3>" +
    rankedTable([{ h: "Domain" }, { h: "Count", align: "right" }],
      (zt.gatewayHttpTopAllowedDomains ?? []).map((d: any) => ({ label: d.domain, values: [d.count], sortValue: d.count }))) +
    "<h3>Tunnels</h3>" +
    `<p class="section-note">${s.tunnelsHealthy ?? 0} of ${s.tunnelsTotal ?? 0} Cloudflare Tunnel connectors healthy.</p>` +
    "<h3>WARP devices</h3>" +
    kpiGrid([
      { label: "Enrolled", value: fmtNum(s.warpEnrolledDevices) },
      { label: "Online", value: fmtNum(s.warpOnlineDevices) },
      { label: "Offline", value: fmtNum(s.warpOfflineDevices) },
    ]) +
    "<h3>Private network origins</h3>" +
    rankedTable([{ h: "Source IP" }, { h: "Virtual network" }, { h: "Count", align: "right" }],
      (zt.privateNetworkOrigins ?? []).map((o: any) => ({ label: o.sourceIp, values: [o.virtualNetwork, o.count], sortValue: o.count })))
  ));

  // 6. Shadow IT
  if ((zt.shadowItApps ?? []).length > 0) {
    sections.push(section(
      "shadowit",
      "Shadow IT",
      kpiGrid([{ label: "Apps Discovered", value: fmtNum(s.shadowItAppsDiscovered ?? zt.shadowItApps.length) }]) +
      rankedTable([{ h: "Application" }, { h: "Category" }, { h: "Requests", align: "right" }],
        (zt.shadowItApps ?? []).map((a: any) => ({ label: a.name, values: [a.category, a.count], sortValue: a.count })))
    ));
  }

  // 7. Posture & findings
  sections.push(section(
    "posture",
    "Security Posture & Findings",
    kvTable([
      ["CASB findings tracked", String(s.casbFindingsCount ?? 0)],
      ["Seats never logged in", String(s.seatsNeverLoggedIn ?? 0)],
      ["Access policies", String(zt.accessPolicies?.length ?? 0)],
      ["Access applications", String(zt.accessApps?.length ?? 0)],
      ["IdP integrations", String(zt.accessIdps?.length ?? 0)],
    ]),
    "Finding counts reflect the registers at generation time; see the dashboard for per-finding detail and owner tracking."
  ));

  return document(
    `Cloudflare One Report — ${meta?.accountName ?? "Account"}`,
    `${clientLabelOf(p)}${periodLabel} · Full report (same data as the on-demand view)`,
    [
      ["Account", meta?.accountName ?? "—"],
      ["Period", `${meta?.since ?? ""} → ${meta?.until ?? ""} (${periodLabel})`],
      ["Generated", `${meta?.generatedAt ?? new Date().toISOString()} (UTC)`],
      ["Schedule", p.scheduleName],
    ],
    p.message,
    sections.join("\n")
  );
}
