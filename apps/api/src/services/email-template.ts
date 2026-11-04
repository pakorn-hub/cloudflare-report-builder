/**
 * Email-safe HTML digest of a generated report.
 *
 * Scheduled emails are rendered entirely server-side from AppSecData /
 * ZeroTrustData. Email clients strip <style> tags and JS, so everything is
 * inline-styled <table> markup following the report builder's design
 * language (deep navy #1c1f2a, AR red #ba0816, off-white #f4f4f4).
 */

import type { AppSecData, ZeroTrustData } from "../types";
import type { MagicTransitData } from "../../../../shared/magic-transit";

export function renderMtEmail(data: MagicTransitData, params: ReportEmailParams): RenderedEmail {
  const s = data.summary;
  const bytes = (bits: number | undefined) => bits === undefined ? "Unavailable" : fmtBytes(bits / 8);
  return buildShell({
    title: `${clientLabel(params)}Magic Transit Network Report`,
    subtitle: `${data.meta.periodLabel} · ${data.meta.accountName}`,
    metaRows: [{ k: "Account", v: data.meta.accountName }, { k: "Window (UTC)", v: `${data.meta.sinceTs} → ${data.meta.untilTs}` }, { k: "Report", v: params.scheduleName }],
    params,
    kpis: [
      { label: "Ingress traffic", value: bytes(s.traffic?.bits) }, { label: "Dropped traffic", value: bytes(s.dropped?.bits) },
      { label: "Attack events", value: s.attackCount === null ? "Unavailable" : fmtNum(s.attackCount) },
      { label: "Peak bucket bandwidth", value: s.peakBps === null ? "Unavailable" : `${fmtNum(s.peakBps)} bps` },
      { label: "Probe success", value: s.probeSuccessPct === null ? "Unavailable" : `${s.probeSuccessPct.toFixed(1)}%` },
      { label: "Configured tunnels", value: fmtNum(data.tunnels.length) },
    ],
    lists: [{ title: "Top DDoS source IPs / countries — selected-period mitigation", rows: [...(data.attackRankings?.sources ?? [])].sort((a, b) => b.bits - a.bits).slice(0, 5).map(r => ({ label: `${r.ip} · ${r.country}`, value: `${bytes(r.bits)} · ${fmtNum(r.packets)} packets` })) },
      { title: "Top DDoS targets — selected-period mitigation", rows: [...(data.attackRankings?.targets ?? [])].sort((a, b) => b.bits - a.bits).slice(0, 5).map(r => ({ label: `${r.ip}:${r.port ?? "unknown"} · ${r.protocol}`, value: `${bytes(r.bits)} · ${fmtNum(r.packets)} packets` })) },
      { title: "Dropped traffic by mitigation system", rows: data.mitigationSystems.map(r => ({ label: r.name, value: `${bytes(r.bits)} · ${fmtNum(r.packets)} packets` })) },
      { title: "Top destination prefixes", rows: (data.rankings.prefixes ?? []).slice(0, 5).map(r => ({ label: r.name, value: bytes(r.bits) })) },
      { title: "Data unavailable", rows: Object.keys(data.errors).map(key => ({ label: key, value: "See attached report" })) }],
    summaryTextBlock: summaryParagraphs(params.aiSummary),
    footerNote: "The attached HTML contains the full visual Magic Transit report. Traffic is estimated from sampled analytics; peak rates are bucket averages and probe success is not SLA uptime. Configuration is a current snapshot.",
  });
}

// ─── Shared params ────────────────────────────────────────────────────────────

export interface ReportEmailParams {
  scheduleName: string;
  message: string;          // custom message from the schedule config
  isPoc: boolean;
  clientName?: string | null;
  /** Client branding logo (base64 data URI) — rendered on the email cover.
   *  Most modern email clients render data URIs; blocked ones show alt text. */
  clientLogo?: string;
  aiSummary: string;         // may be "" when Workers AI was unavailable
}

export interface RenderedEmail {
  html: string;
  text: string;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function fmtNum(n: number): string {
  if (!isFinite(n)) return "0";
  if (n >= 1e9) return `${(n / 1e9).toFixed(1)}B`;
  if (n >= 1e6) return `${(n / 1e6).toFixed(1)}M`;
  if (n >= 1e3) return `${(n / 1e3).toFixed(1)}K`;
  return String(Math.round(n));
}

function fmtBytes(bytes: number): string {
  if (bytes >= 1e12) return `${(bytes / 1e12).toFixed(1)} TB`;
  if (bytes >= 1e9)  return `${(bytes / 1e9).toFixed(1)} GB`;
  if (bytes >= 1e6)  return `${(bytes / 1e6).toFixed(1)} MB`;
  if (bytes >= 1e3)  return `${(bytes / 1e3).toFixed(1)} KB`;
  return `${Math.round(bytes)} B`;
}

/** Replace {{zone}}, {{account}}, {{date}} tokens in a subject line. */
export function applySubjectTokens(
  subject: string,
  vars: { zone?: string | null; account?: string | null; date?: string }
): string {
  const date = vars.date ?? new Date().toISOString().slice(0, 10);
  return subject
    .replace(/\{\{\s*zone\s*\}\}/gi, vars.zone || "")
    .replace(/\{\{\s*account\s*\}\}/gi, vars.account || "")
    .replace(/\{\{\s*date\s*\}\}/gi, date)
    .trim();
}

// ─── Building blocks ──────────────────────────────────────────────────────────

interface Kpi { label: string; value: string }
interface TopList { title: string; rows: { label: string; value: string }[] }

function metaTable(rows: { k: string; v: string }[]): string {
  const trs = rows
    .map(
      (r) => `<tr>
  <td style="padding:7px 12px 7px 0;font:11px/1.4 Helvetica,Arial,sans-serif;color:#5d5e65;text-transform:uppercase;letter-spacing:1px;white-space:nowrap;vertical-align:top;">${escapeHtml(r.k)}</td>
  <td style="padding:7px 0;font:12px/1.4 Helvetica,Arial,sans-serif;color:#292b35;vertical-align:top;">${escapeHtml(r.v)}</td>
</tr>`
    )
    .join("\n");
  return `<table role="presentation" cellpadding="0" cellspacing="0" width="100%">${trs}</table>`;
}

function kpiGrid(kpis: Kpi[]): string {
  const cells = kpis.map(
    (k) => `<td width="33.33%" style="padding:14px 12px;border:1px solid #e5e5e5;vertical-align:top;">
    <div style="font:10px/1.3 Helvetica,Arial,sans-serif;color:#5d5e65;text-transform:uppercase;letter-spacing:1px;padding-bottom:6px;">${escapeHtml(k.label)}</div>
    <div style="font:bold 19px/1.1 Helvetica,Arial,sans-serif;color:#292b35;">${escapeHtml(k.value)}</div>
  </td>`
  );
  const rows: string[] = [];
  for (let i = 0; i < cells.length; i += 3) {
    rows.push(`<tr>${cells.slice(i, i + 3).join("")}</tr>`);
  }
  return `<table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="border-collapse:collapse;">${rows.join("")}</table>`;
}

function topTableList(list: TopList): string {
  if (list.rows.length === 0) return "";
  const trs = list.rows
    .map(
      (r, i) => `<tr>
    <td style="padding:8px 0;border-bottom:${i === list.rows.length - 1 ? "none" : "1px dotted #d9d9d9"};font:12px/1.4 Helvetica,Arial,sans-serif;color:#292b35;">${escapeHtml(r.label)}</td>
    <td style="padding:8px 0;border-bottom:${i === list.rows.length - 1 ? "none" : "1px dotted #d9d9d9"};font:12px/1.4 Helvetica,Arial,sans-serif;color:#5d5e65;text-align:right;white-space:nowrap;">${escapeHtml(r.value)}</td>
  </tr>`
    )
    .join("\n");
  return `<div style="padding:0 32px 24px;">
  <div style="font:11px/1 Helvetica,Arial,sans-serif;text-transform:uppercase;letter-spacing:1.5px;color:#5d5e65;padding:0 0 10px;border-bottom:2px solid #ba0816;margin-bottom:2px;">${escapeHtml(list.title)}</div>
  <table role="presentation" cellpadding="0" cellspacing="0" width="100%">${trs}</table>
</div>`;
}

function clientLabel(p: ReportEmailParams): string {
  return p.clientName ? `${p.clientName} · ` : "";
}

function summaryParagraphs(aiSummary: string): { html: string; text: string } {  const paras = aiSummary
    .split(/\n\s*\n/)
    .map((p) => p.trim())
    .filter(Boolean);
  if (paras.length === 0) {
    return {
      html: `<p style="margin:0;font:13px/1.7 Georgia,serif;color:#5d5e65;">The AI executive summary was unavailable for this run. The key figures above were generated directly from your Cloudflare analytics.</p>`,
      text: "The AI executive summary was unavailable for this run. The key figures above were generated directly from your Cloudflare analytics.",
    };
  }
  return {
    html: paras
      .map((p) => `<p style="margin:0 0 12px;font:13px/1.7 Georgia,serif;color:#292b35;">${escapeHtml(p)}</p>`)
      .join("\n"),
    text: paras.join("\n\n"),
  };
}

// ─── Shell ─────────────────────────────────────────────────────────────────────

interface ShellParams {
  title: string;
  subtitle: string;
  metaRows: { k: string; v: string }[];
  params: ReportEmailParams;
  kpis: Kpi[];
  lists: TopList[];
  summaryTextBlock: { html: string; text: string };
  footerNote: string;
}

function buildShell(p: ShellParams): { html: string; text: string } {
  const messageBlock = p.params.message.trim()
    ? `<tr><td style="padding:24px 32px 0;">
  <div style="background:#fafafa;border-left:3px solid #ba0816;padding:16px 18px;font:13px/1.7 Georgia,serif;color:#292b35;white-space:pre-wrap;">${escapeHtml(p.params.message.trim())}</div>
</td></tr>`
    : "";

  const listsHtml = p.lists.filter((l) => l.rows.length > 0).map(topTableList).join("\n");
  const listsText = p.lists
    .filter((l) => l.rows.length > 0)
    .map((l) => `${l.title.toUpperCase()}\n${l.rows.map((r) => `  ${r.label} — ${r.value}`).join("\n")}`)
    .join("\n\n");

  const framing = p.params.isPoc ? "Scheduled POC Report" : "Scheduled Security Report";
  const clientLabel = p.params.clientName ? `${p.params.clientName} · ` : "";

  const html = `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="color-scheme" content="light">
<title>${escapeHtml(p.title)}</title>
</head>
<body style="margin:0;padding:0;background-color:#f4f4f4;">
<div style="display:none;max-height:0;overflow:hidden;opacity:0;">${escapeHtml(p.subtitle)}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:#f4f4f4;padding:28px 12px;">
<tr><td align="center">
<table role="presentation" width="600" cellpadding="0" cellspacing="0" style="width:600px;max-width:100%;background-color:#ffffff;border:1px solid #e2e2e2;">

  <!-- Header -->
  <tr><td style="background-color:#1c1f2a;padding:30px 32px;">
    <div style="font:bold 11px/1 Helvetica,Arial,sans-serif;letter-spacing:3px;text-transform:uppercase;color:#ba0816;">Cloudflare</div>
    ${p.params.clientLogo
      ? `<img src="${p.params.clientLogo}" alt="${escapeHtml(p.params.clientName ?? "Client logo")}" style="display:block;margin:12px 0 0;max-height:64px;max-width:220px;border:0;"/>`
      : ""}
    <h1 style="margin:10px 0 0;font:bold 22px/1.25 Helvetica,Arial,sans-serif;color:#f4f4f4;letter-spacing:-0.02em;">${escapeHtml(p.title)}</h1>
    <p style="margin:8px 0 0;font:12px/1.4 Helvetica,Arial,sans-serif;color:rgba(244,244,244,0.55);">${escapeHtml(p.subtitle)}</p>
  </td></tr>
  <tr><td style="height:4px;background-color:#ba0816;font-size:0;line-height:0;">&nbsp;</td></tr>

  <!-- Meta strip -->
  <tr><td style="padding:20px 32px 0;">${metaTable(p.metaRows)}</td></tr>

  <!-- Custom message -->
  ${messageBlock}

  <!-- Executive summary -->
  <tr><td style="padding:28px 32px 8px;">
    <div style="font:11px/1 Helvetica,Arial,sans-serif;text-transform:uppercase;letter-spacing:1.5px;color:#5d5e65;padding-bottom:10px;border-bottom:2px solid #ba0816;margin-bottom:16px;">Executive Summary</div>
    ${p.summaryTextBlock.html}
  </td></tr>

  <!-- KPI grid -->
  <tr><td style="padding:12px 24px 24px;">
    <div style="font:11px/1 Helvetica,Arial,sans-serif;text-transform:uppercase;letter-spacing:1.5px;color:#5d5e65;padding:0 8px 10px;">Key Metrics</div>
    ${kpiGrid(p.kpis)}
  </td></tr>

  <!-- Top lists -->
  ${listsHtml}

  <!-- Footer -->
  <tr><td style="background-color:#1c1f2a;padding:20px 32px;">
    <p style="margin:0;font:11px/1.7 Helvetica,Arial,sans-serif;color:rgba(244,244,244,0.45);">${escapeHtml(p.footerNote)}</p>
  </td></tr>

</table>
</td></tr>
</table>
</body>
</html>`;

  const text = `${p.title}
${p.subtitle}

${p.metaRows.map((r) => `${r.k}: ${r.v}`).join("\n")}

${p.params.message.trim() ? `MESSAGE\n${p.params.message.trim()}\n` : ""}
EXECUTIVE SUMMARY
${p.summaryTextBlock.text}

KEY METRICS
${p.kpis.map((k) => `  ${k.label}: ${k.value}`).join("\n")}

${listsText}

${p.footerNote}`;

  return { html, text };
}

// ─── AppSec digest ────────────────────────────────────────────────────────────

export function renderAppsecEmail(appsec: AppSecData, p: ReportEmailParams): RenderedEmail {
  const s = appsec.summary ?? ({} as AppSecData["summary"]);
  const meta = appsec.meta;

  const ttfb = (appsec.ttfbTimeSeries ?? []).reduce((acc, d) => acc + (d.avg ?? 0), 0);
  const avgTtfbMs = (appsec.ttfbTimeSeries ?? []).length > 0
    ? Math.round(ttfb / appsec.ttfbTimeSeries.length)
    : 0;

  const ddosMitigated = (appsec.ddosTimeSeries ?? []).reduce((acc, d) => acc + (d.mitigated ?? 0), 0);
  const savings = s.costSavings?.monthlyBandwidthSavings ?? 0;

  const kpis: Kpi[] = [
    { label: "Total Requests", value: fmtNum(s.totalRequests ?? 0) },
    { label: "Unique Visitors", value: fmtNum(s.uniqueVisitors ?? 0) },
    { label: "Threats Blocked", value: fmtNum(s.totalThreatsBlocked ?? 0) },
    { label: "Bot Traffic", value: `${Math.round(s.botTrafficPct ?? 0)}%` },
    { label: "Cache Hit Rate", value: `${Math.round(s.cacheHitRatePct ?? 0)}%` },
    { label: "Avg TTFB", value: avgTtfbMs > 0 ? `${avgTtfbMs} ms` : "N/A" },
  ];

  const lists: TopList[] = [
    {
      title: "Top Countries",
      rows: (appsec.countryDistribution ?? []).slice(0, 5).map((c) => ({
        label: c.clientCountryName ?? "—",
        value: fmtNum(c.requests ?? 0),
      })),
    },
    {
      title: "Top Threat Sources (IP)",
      rows: (appsec.topThreatIps ?? []).slice(0, 5).map((t) => ({
        label: `${t.ip}${t.country ? ` (${t.country})` : ""}`,
        value: fmtNum(t.count ?? 0),
      })),
    },
  ];

  const periodLabel = meta?.periodLabel ?? `${meta?.days ?? 30}-Day`;
  return buildShell({
    title: `App Security Report — ${meta?.zoneName ?? "Zone"}`,
    subtitle: `${clientLabel(p)}${periodLabel} Application Security & Performance Digest`,
    metaRows: [
      { k: "Zone", v: meta?.zoneName ?? "—" },
      { k: "Period", v: `${meta?.since ?? ""} → ${meta?.until ?? ""}` },
      { k: "Timeframe", v: `${periodLabel} (${meta?.days ?? 30} days)` },
      { k: "DDoS L7 Mitigated", v: fmtNum(ddosMitigated) },
      ...(savings > 0 && p.isPoc
        ? [{ k: "Est. Monthly Savings", v: `$${Math.round(savings).toLocaleString("en-US")}` }]
        : []),
      { k: "Generated", v: `${meta?.generatedAt ?? new Date().toISOString()} (UTC)` },
      { k: "Schedule", v: p.scheduleName },
    ],
    params: p,
    kpis,
    lists,
    summaryTextBlock: summaryParagraphs(p.aiSummary),
    footerNote: `Sent automatically by the Cloudflare Report Builder — schedule "${p.scheduleName}". Bandwidth served: ${fmtBytes(s.totalBandwidthBytes ?? 0)} (${fmtBytes(s.cachedBandwidthBytes ?? 0)} cached).`,
  });
}

// ─── Zero Trust digest ─────────────────────────────────────────────────────────

export function renderZtEmail(zt: ZeroTrustData, p: ReportEmailParams): RenderedEmail {
  const s = zt.summary;
  const meta = zt.meta;

  const dnsBlockedPct = s.gatewayDnsQueries > 0
    ? Math.round((s.gatewayDnsBlocked / s.gatewayDnsQueries) * 100) : 0;

  const kpis: Kpi[] = [
    { label: "Auth Events", value: fmtNum(s.totalAuthEvents ?? 0) },
    { label: "Unique Users", value: fmtNum(s.uniqueUsers ?? 0) },
    { label: "Blocked Logins", value: fmtNum(s.blockedAuthEvents ?? 0) },
    { label: "DNS Queries", value: fmtNum(s.gatewayDnsQueries ?? 0) },
    { label: "HTTP Inspected", value: fmtNum(s.gatewayHttpRequests ?? 0) },
    { label: "WARP Devices", value: fmtNum(s.warpEnrolledDevices ?? 0) },
  ];

  const lists: TopList[] = [
    {
      title: "Top Access Applications",
      rows: (zt.accessTopApps ?? []).slice(0, 5).map((a) => ({
        label: a.name ?? "—",
        value: fmtNum(a.requests ?? 0),
      })),
    },
    {
      title: "Top Blocked DNS Categories",
      rows: (zt.gatewayDnsTopBlockedCategories ?? []).slice(0, 5).map((c) => ({
        label: c.category ?? "—",
        value: fmtNum(c.count ?? 0),
      })),
    },
  ];

  const periodLabel = meta?.periodLabel ?? `${meta?.days ?? 30}-Day`;
  return buildShell({
    title: `Cloudflare One Report — ${meta?.accountName ?? "Account"}`,
    subtitle: `${clientLabel(p)}${periodLabel} Zero Trust / SASE Digest`,
    metaRows: [
      { k: "Account", v: meta?.accountName ?? "—" },
      { k: "Period", v: `${meta?.since ?? ""} → ${meta?.until ?? ""}` },
      { k: "Timeframe", v: `${periodLabel} (${meta?.days ?? 30} days)` },
      { k: "Apps Protected", v: `${zt.accessApps?.length ?? 0} Access apps` },
      { k: "DNS Blocked", v: `${fmtNum(s.gatewayDnsBlocked ?? 0)} (${dnsBlockedPct}%)` },
      { k: "Tunnels", v: `${s.tunnelsHealthy ?? 0}/${s.tunnelsTotal ?? 0} healthy` },
      { k: "Generated", v: `${meta?.generatedAt ?? new Date().toISOString()} (UTC)` },
      { k: "Schedule", v: p.scheduleName },
    ],
    params: p,
    kpis,
    lists,
    summaryTextBlock: summaryParagraphs(p.aiSummary),
    footerNote: `Sent automatically by the Cloudflare Report Builder — schedule "${p.scheduleName}".`,
  });
}
