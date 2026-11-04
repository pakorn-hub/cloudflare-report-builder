import { useEffect, useId, useMemo, useState } from "react";
import type { ReactNode } from "react";
import { Printer, FileText, RefreshCw, Loader2, CheckCircle } from "lucide-react";
import type { ReportInput } from "../types";
import type { MagicTransitData, MtRank, MtTrafficPoint } from "../../../../shared/magic-transit";
import { consolidateMtTunnels } from "../../../../shared/magic-transit-tunnels";
import { fetchMtSummary, saveAuditReport } from "../services/api";
import { captureReportHtml, saveToHtml, saveToPdf } from "../utils/pdf-export";
import cfLogo from "../assets/cf-logo";
import AreaTimeSeriesChart from "../components/charts/AreaTimeSeriesChart";
import HorizonChart from "../components/charts/HorizonChart";
import StackedBarChart from "../components/charts/StackedBarChart";
import PieBreakdownChart from "../components/charts/PieBreakdownChart";
import HorizontalBarChart from "../components/charts/HorizontalBarChart";
import ParallelCoordinates from "../components/charts/ParallelCoordinates";
import WorldMap from "../components/charts/WorldMap";
import SankeyFlowChart from "../components/charts/SankeyFlowChart";
import SecurityRadarChart from "../components/charts/SecurityRadarChart";
import NetworkGlobe from "../components/magic-transit/NetworkGlobe";
import { HealthHeatmap, AttackTimeline, ProtocolPortMatrix, RouteTopology, mtNumber, mtBytes, mtRate, mtDate } from "../components/magic-transit/NetworkVisuals";
import "./magic-transit.css";

const BLUE = "#078dad", ORANGE = "#f6821f", RED = "#d75267", GREEN = "#109b8d";
const countryNames = new Intl.DisplayNames(["en"], { type: "region" });
const countryLabel = (code: string) => /^[A-Z]{2}$/.test(code) ? countryNames.of(code) || code : code;
function Panel({ title, subtitle, children, id }: { title: string; subtitle?: string; children: ReactNode; id?: string }) {
  return <section className="mt-panel" id={id}><header><h2>{title}</h2>{subtitle && <p>{subtitle}</p>}</header>{children}</section>;
}
function EvidenceTable({ headers, rows, label, collapsed = false, previewRows = 6 }: { headers: string[]; rows: ReactNode[][]; label?: string; collapsed?: boolean; previewRows?: number }) {
  const id = useId(), expandable = rows.length > 0 && (collapsed || rows.length > previewRows);
  // Native checkbox disclosure works in script-free saved HTML as well as the React report.
  // All rows stay in the document; print styles reveal them without scrolling or JS.
  return <div className={`mt-evidence${collapsed ? " mt-evidence-collapsed" : ""}`}>
    {expandable && <input className="mt-evidence-toggle" type="checkbox" id={id} aria-controls={`${id}-table`} />}
    <div className="mt-table-wrap" id={`${id}-table`}><table aria-label={label ?? headers.join(" / ")}><thead><tr>{headers.map(h => <th key={h}>{h}</th>)}</tr></thead><tbody>{rows.map((row, i) => <tr className={i >= previewRows ? "mt-evidence-extra" : undefined} key={i}>{row.map((cell, j) => <td key={j}>{cell}</td>)}</tr>)}</tbody></table>{!rows.length && <p className="mt-empty">No records returned. See data availability for query errors.</p>}</div>
    {expandable && <label className="mt-evidence-control" htmlFor={id}><span className="mt-evidence-show">{collapsed ? `View data · ${rows.length.toLocaleString()} categories` : `Show all ${rows.length.toLocaleString()} rows`}</span><span className="mt-evidence-hide">{collapsed ? "Hide data" : `Show first ${previewRows} rows`}</span></label>}
  </div>;
}
function Rank({ title, rows = [] }: { title: string; rows?: MtRank[] }) {
  const top = [...rows].sort((a, b) => b.bits - a.bits).slice(0, 6);
  return <div className="mt-rank"><HorizontalBarChart title={title} height={Math.max(88, top.length * 24 + 26)} data={top.map(r => ({ name: r.name, value: r.bits / 8 }))} color={BLUE} xTickFormatter={v => mtNumber(v, "B")} subtitle={`Ranked by bytes · top ${top.length} returned categories`} />
    {rows.length > 0 && <EvidenceTable collapsed label={title} headers={["Category", "Bytes", "Packets"]} rows={[...rows].sort((a, b) => b.bits - a.bits).map(r => [r.name, mtBytes(r.bits), mtNumber(r.packets)])} />}</div>;
}
function Distribution({ title, rows }: { title: string; rows: MtRank[] }) {
  const total = rows.reduce((v, r) => v + r.packets, 0);
  if (!rows.length) return <div className="mt-rank"><h3>{title}</h3><p className="mt-caption">No distribution available. See collection status.</p></div>;
  const sorted = [...rows].sort((a, b) => b.packets - a.packets);
  const shown = sorted.length > 6 ? [...sorted.slice(0, 5), { name: "Other returned categories", packets: sorted.slice(5).reduce((v, r) => v + r.packets, 0), bits: sorted.slice(5).reduce((v, r) => v + r.bits, 0) }] : sorted;
  return <div className="mt-rank"><PieBreakdownChart title={title} height={220} innerRadius={32} subtitle="Packet share within returned categories · at most six legend entries" legendPosition="bottom" data={shown.map(r => ({ name: r.name, value: r.packets, pct: total ? Number((r.packets / total * 100).toFixed(1)) : 0 }))} colors={[BLUE, ORANGE, GREEN, RED, "#4862a6", "#93b6c8"]} />
    <EvidenceTable collapsed label={`${title} distribution`} headers={["Category", "Packets", "Bytes"]} rows={sorted.map(r => [r.name, mtNumber(r.packets), mtBytes(r.bits)])} /></div>;
}
function pivot(points: MtTrafficPoint[], tz: number) {
  const byTime = new Map<string, Record<string, string | number>>();
  for (const p of points) {
    const row = byTime.get(p.timestamp) ?? { date: p.timestamp, label: mtDate(p.timestamp, tz), bps: 0, pps: 0, bits: 0 };
    row[p.outcome] = Number(row[p.outcome] ?? 0) + p.packets;
    row.bps = Number(row.bps) + p.bps; row.pps = Number(row.pps) + p.pps; row.bits = Number(row.bits) + p.bits;
    byTime.set(p.timestamp, row);
  }
  return [...byTime.values()].sort((a, b) => String(a.date).localeCompare(String(b.date)));
}
function change(value: number | null | undefined, baseline: number | null | undefined): string {
  if (value == null || baseline == null || baseline === 0) return "Baseline unavailable";
  const delta = (value / baseline - 1) * 100;
  return `${delta > 0 ? "+" : ""}${delta.toFixed(1)}% vs preceding equivalent period`;
}

export default function MagicTransitReportPage({ data, input, onReset, userEmail }: { data: MagicTransitData; input: ReportInput; onReset: () => void; userEmail?: string | null }) {
  const embedded = (window as { __EMBEDDED_REPORT__?: { aiSummary?: string } }).__EMBEDDED_REPORT__;
  const [summary, setSummary] = useState(embedded?.aiSummary ?? "");
  const [busy, setBusy] = useState(!embedded);
  const [summaryError, setSummaryError] = useState("");
  const [exporting, setExporting] = useState(false);
  const [saved, setSaved] = useState(false);
  const [geoView, setGeoView] = useState<"sourceCountries" | "processingCountries">("sourceCountries");
  const { meta, summary: metrics } = data;
  const tz = meta.tzOffset;
  useEffect(() => {
    if (embedded) return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    void fetchMtSummary(data, input.isPoc !== false).then(text => { if (!cancelled) setSummary(text); }).catch(() => { if (!cancelled) setSummaryError("Executive summary unavailable. The measurements below remain available."); }).finally(() => {
      if (cancelled) return;
      setBusy(false);
      timer = setTimeout(() => { if (!cancelled) void captureReportHtml().then(html => saveAuditReport({ email: userEmail ?? "anonymous", hostname: `magic-transit-${meta.accountId}`, zoneName: meta.accountName, days: meta.days, generatedAt: meta.generatedAt, html })).then(r => { if (!cancelled && r) setSaved(true); }).catch(() => {}); }, 1500);
    });
    return () => { cancelled = true; if (timer) clearTimeout(timer); };
  }, [data, input.isPoc, meta.accountId, meta.accountName, meta.days, meta.generatedAt, userEmail, embedded]);
  const times = useMemo(() => pivot(data.traffic, tz), [data.traffic, tz]);
  const outcomeKeys = [...new Set(data.traffic.map(p => p.outcome))];
  const timeSeries = [{ key: "bps", label: "Ingress bandwidth", color: BLUE }];
  const horizon = [
    { key: "bandwidth", label: "Ingress bandwidth", color: BLUE, data: times.map(p => ({ date: String(p.date), value: Number(p.bps) })), formatter: mtRate },
    { key: "packets", label: "Ingress packet rate", color: GREEN, data: times.map(p => ({ date: String(p.date), value: Number(p.pps) })), formatter: (v: number) => mtNumber(v, "pps") },
    { key: "dropped", label: "Dropped packets", color: ORANGE, data: times.map(p => ({ date: String(p.date), value: Number(p.drop ?? 0) })), formatter: (v: number) => mtNumber(v, "packets") },
  ];
  const probes = data.tunnels.filter(t => t.healthChecksEnabled !== null);
  const coverage = [
    ...(metrics.probeSuccessPct !== null ? [{ subject: "Probe success", score: metrics.probeSuccessPct, fullMark: 100, description: "Successful observed probes / all observed probes" }] : []),
    ...(probes.length ? [{ subject: "Checks enabled", score: probes.filter(t => t.healthChecksEnabled).length / probes.length * 100, fullMark: 100, description: "Health-check enabled tunnels / tunnels with known configuration" }] : []),
    ...(data.rules.length ? [{ subject: "Rules enabled", score: data.rules.filter(r => r.enabled).length / data.rules.length * 100, fullMark: 100, description: "Enabled rules / returned rules; not an efficacy score" }] : []),
  ];
  const flowRows = data.outcomes.filter(r => r.packets > 0);
  const flow = { nodes: [{ name: "Ingress packets", color: BLUE }, ...flowRows.map(r => ({ name: r.name === "drop" ? "Dropped" : r.name === "pass" ? "Passed" : r.name, color: r.name === "drop" ? ORANGE : GREEN }))], links: flowRows.map((r, i) => ({ source: 0, target: i + 1, value: r.packets })) };
  const tunnelRollup = useMemo(() => consolidateMtTunnels(data), [data]);
  const tunnelNames = [...new Set([...data.tunnels.map(t => t.name), ...tunnelRollup.totals.map(p => p.tunnel), ...tunnelRollup.traffic.map(p => p.tunnel)])].sort();
  const tunnelCadence = tunnelRollup.interval === "hour" ? "Hourly" : "Daily";
  const tunnelTimeLabel = (t: string) => mtDate(t, tz);
  const attackSources = data.attackRankings?.sources, attackTargets = data.attackRankings?.targets;
  const sourceRows = [...(attackSources ?? [])].sort((a, b) => b.bits - a.bits);
  const targetRows = [...(attackTargets ?? [])].sort((a, b) => b.bits - a.bits);
  const attackCountries = [...(data.attackRankings?.sourceCountries ?? [])].sort((a, b) => b.bits - a.bits);
  const hasTargetApps = targetRows.some(r => r.application);
  const attackEmpty = (rows: unknown[] | null | undefined) => rows == null
    ? data.attackRankings ? "DDoS rankings unavailable. See collection status for dataset access or query errors." : "This older report does not include attack-specific rankings. Generate a new report to collect them."
    : "No DDoS-mitigated traffic returned for the selected period.";
  return <div className="mt-report">
    <nav className="mt-toolbar print:hidden"><img src={cfLogo} alt="Cloudflare" /><span>Magic Transit · {meta.accountName}</span>{saved && <small><CheckCircle size={13} /> Archived</small>}
      {!embedded && <button onClick={onReset}><RefreshCw size={14} /> New report</button>}
      <button disabled={exporting} onClick={async () => { setExporting(true); try { await saveToHtml(`magic-transit-${meta.accountName}`); } finally { setExporting(false); } }}>{exporting ? <Loader2 size={14} /> : <FileText size={14} />} HTML</button>
      <button onClick={saveToPdf}><Printer size={14} /> PDF</button>
    </nav>
    <main id="report-content" className="mt-content">
      <section className="mt-hero">
        <div className="mt-hero-brand"><img src={cfLogo} alt="Cloudflare" /><span>NETWORK PROTECTION / {input.isPoc !== false ? "POC" : "ASSESSMENT"} / CONFIDENTIAL</span></div>
        <div className="mt-hero-layout"><div className="mt-hero-copy">
          {input.clientLogo && <img className="mt-client-logo" src={input.clientLogo} alt={input.clientName ?? "Client logo"} />}
          <p className="mt-eyebrow">{input.clientName || meta.accountName}</p>
          <h1>Magic<br /><span>Transit.</span></h1>
          <p className="mt-hero-thesis">Your network.<br />Its traffic. Its protection.</p>
          <p className="mt-hero-period">{meta.periodLabel}<br />{mtDate(meta.sinceTs, tz)} — {mtDate(meta.untilTs, tz)}</p>
          <div className="mt-hero-ledger"><div><strong>{mtBytes(metrics.traffic?.bits)}</strong><span>Ingress processed</span></div><div><strong>{mtNumber(metrics.attackCount)}</strong><span>Overlapping attack events</span></div></div>
        </div><NetworkGlobe data={data.rankings.sourceCountries ?? []} /></div>
        <div className="mt-hero-footer"><span>Cloudflare Network Analytics + configuration APIs</span><span>{input.partnerName || "Cloudflare"} · generated {mtDate(meta.generatedAt, tz)}</span></div>
      </section>
      <nav className="mt-jump print:hidden" aria-label="Report sections">{[["attack-priority", "Top attack sources & targets"], ["attacks", "Attack events"], ["traffic", "Traffic"], ["geography", "Geography"], ["tunnels", "Tunnels"], ["policy", "Policy"], ["configuration", "Configuration"], ["quality", "Data quality"]].map(([id, label]) => <a key={id} href={`#mt-${id}`}>{label}</a>)}</nav>
      <div className="mt-kpis">
        {[
          ["Ingress traffic", mtBytes(metrics.traffic?.bits), change(metrics.traffic?.bits, metrics.previousTraffic?.bits)],
          ["Dropped traffic", mtBytes(metrics.dropped?.bits), change(metrics.dropped?.bits, metrics.previousDropped?.bits)],
          ["Peak bucket bandwidth", metrics.peakBps == null ? "Unavailable" : mtRate(metrics.peakBps), `${meta.bucketSeconds / 60}-minute averages`],
          ["Peak bucket packet rate", mtNumber(metrics.peakPps, "pps"), "Ingress only"],
          ["Probe success", metrics.probeSuccessPct == null ? "Unavailable" : `${metrics.probeSuccessPct.toFixed(1)}%`, "Observed samples · not SLA uptime"],
           ["Configured tunnels", Object.keys(data.errors).some(k => k.startsWith("tunnels:")) ? data.tunnels.length ? `${data.tunnels.length} (partial)` : "Unavailable" : mtNumber(data.tunnels.length), "Current inventory · see collection errors"],
        ].map(([label, value, note]) => <article key={label}><span>{label}</span><strong>{value}</strong><small>{note}</small></article>)}
      </div>
      <Panel id="mt-attack-priority" title="Top attack sources & targets" subtitle="Ranked by DDoS-mitigated ingress bytes during the selected period · sampled estimates">
        <div className="mt-grid mt-attack-grid">
          <div className="mt-attack-card"><h3>Top source IPs & countries</h3><p className="mt-caption">Observed packet sources · not attacker attribution</p>
            {sourceRows.length ? <EvidenceTable label="Top DDoS source IPs" headers={["Source IP", "Country", "Mitigated bytes", "Packets"]} rows={sourceRows.map(r => [r.ip, countryLabel(r.country), mtBytes(r.bits), mtNumber(r.packets)])} /> : <p className="mt-empty">{attackEmpty(attackSources)}</p>}
          </div>
          <div className="mt-attack-card"><h3>Top targeted IPs & ports</h3><p className="mt-caption">Application names require an explicit mapping; ports alone do not identify apps.</p>
            {targetRows.length ? <EvidenceTable label="Top DDoS targets" headers={["Target IP", "Port / protocol", ...(hasTargetApps ? ["Application"] : []), "Mitigated bytes", "Packets"]} rows={targetRows.map(r => [r.ip, `${r.port ?? "Unknown"} / ${r.protocol}`, ...(hasTargetApps ? [r.application || "Unmapped"] : []), mtBytes(r.bits), mtNumber(r.packets)])} /> : <p className="mt-empty">{attackEmpty(attackTargets)}</p>}
          </div>
        </div>
        {attackCountries.length ? <div className="mt-country-ranks"><h3>Top attack source countries</h3><div className="mt-country-grid">{attackCountries.slice(0, 6).map(r => <article key={r.name}><span>{countryLabel(r.name)}</span><strong>{mtBytes(r.bits)}</strong><small>{mtNumber(r.packets, "packets")}</small></article>)}</div>
          <EvidenceTable collapsed label="DDoS source country volumes" headers={["Country", "Mitigated bytes", "Packets"]} rows={attackCountries.map(r => [countryLabel(r.name), mtBytes(r.bits), mtNumber(r.packets)])} /></div> : <p className="mt-caption">{attackEmpty(data.attackRankings?.sourceCountries)}</p>}
        <p className="mt-caption">Each ranking shows up to 25 returned categories. These are selected-period DDoS mitigation volumes, separate from all-traffic rankings and attack-event lifetime totals.</p>
      </Panel>
      <Panel title="Executive assessment" subtitle="AI narrative grounded in the report measurements">
        {busy ? <p className="mt-empty">Preparing the executive assessment…</p> : summary ? <div className="mt-summary">{summary.split(/\n\s*\n/).filter(Boolean).map((p, i) => <p key={i}>{p}</p>)}</div> : <p className="mt-empty">{summaryError || "No AI narrative was included. Use the measurements and evidence below."}</p>}
      </Panel>
      <Panel id="mt-traffic" title="Traffic pulse" subtitle="Aligned ingress measurements · estimates from sampled network analytics">
        {times.length ? <><HorizonChart series={horizon} title="Network pulse" dateFormat={meta.days === 1 ? "MMM d HH:mm" : "MMM d"} />
          <div className="mt-grid"><AreaTimeSeriesChart height={200} data={times} series={timeSeries} title="Ingress bandwidth" xDataKey="label" tickFormatter={mtRate} /><AreaTimeSeriesChart height={200} data={times} series={[{ key: "pps", label: "Packets per second", color: GREEN }]} title="Ingress packet rate" xDataKey="label" tickFormatter={v => mtNumber(v, "pps")} /></div>
          <StackedBarChart height={200} data={times} series={outcomeKeys.map((key, i) => ({ key, label: `${key} packets`, color: key === "drop" ? ORANGE : [GREEN, BLUE, RED][i % 3] }))} title="Traffic outcomes" xKey="date" labelFormatter={t => mtDate(t, tz)} />
        </> : <p className="mt-empty">Traffic time series unavailable for the selected period.</p>}
        <div className="mt-grid"><Distribution title="Traffic outcomes" rows={data.outcomes} /><Distribution title="Dropped traffic by mitigation system" rows={data.mitigationSystems} /></div>
        {flow.links.length > 0 && <><h3>Ingress traffic disposition</h3><SankeyFlowChart data={flow} unit="packets" height={220} /><EvidenceTable headers={["Outcome", "Packets", "Bytes"]} rows={data.outcomes.map(r => [r.name, mtNumber(r.packets), mtBytes(r.bits)])} /></>}
      </Panel>
      <Panel id="mt-geography" title="Where the traffic comes from" subtitle="Source countries are distinct from Cloudflare processing locations">
        <div className="mt-switch print:hidden"><button aria-pressed={geoView === "sourceCountries"} onClick={() => setGeoView("sourceCountries")}>Source countries</button><button aria-pressed={geoView === "processingCountries"} onClick={() => setGeoView("processingCountries")}>Processing countries</button></div>
        <h3>{geoView === "sourceCountries" ? "Source-country packet distribution" : "Cloudflare processing-country packet distribution"}</h3>
        <WorldMap unit="packets" data={(data.rankings[geoView] ?? []).map(r => ({ clientCountryName: r.name, requests: r.packets, bytes: r.bits / 8, threats: 0 }))} />
        <div className="mt-grid"><Rank title="Source countries" rows={data.rankings.sourceCountries} /><Rank title="Source ASNs" rows={data.rankings.sourceAsns} /></div>
        <div className="mt-grid"><Rank title="Processing countries" rows={data.rankings.processingCountries} /><Rank title="Cloudflare locations" rows={data.rankings.colos} /></div>
      </Panel>
      <Panel title="Traffic fingerprint" subtitle="Protocols, destinations and measured joint protocol/port combinations">
        <div className="mt-grid"><Distribution title="Protocols" rows={data.rankings.protocols ?? []} /><Distribution title="TCP flags" rows={data.rankings.tcpFlags ?? []} /></div>
        <ProtocolPortMatrix data={data.protocolPorts} />
        <div className="mt-grid"><Rank title="Destination prefixes" rows={data.rankings.prefixes} /><Rank title="Destination ports" rows={data.rankings.ports} /><Rank title="Source IPs" rows={data.rankings.sourceIps} /><Rank title="Destination IPs" rows={data.rankings.destinationIps} /></div>
        <Rank title="Packet-size buckets" rows={data.rankings.packetSizes} />
      </Panel>
      <Panel id="mt-attacks" title="Attack activity" subtitle="Network-layer events overlapping the selected period · event volumes are lifetime totals">
        <AttackTimeline attacks={data.attacks} start={meta.sinceTs} end={meta.untilTs} tzOffset={tz} />
         {data.attacks.some(a => a.packets !== null && a.droppedBits !== null) && <ParallelCoordinates title="Attack profiles" subtitle="Top 30 with available packet and dropped-volume measurements · each line is one event" dimensions={[{ key: "duration", label: "Overlap seconds", log: true }, { key: "packets", label: "Lifetime packets", log: true }, { key: "dropped", label: "Lifetime dropped bytes", log: true }]} rows={data.attacks.filter(a => a.packets !== null && a.droppedBits !== null).sort((a, b) => b.droppedBits! - a.droppedBits!).slice(0, 30).map(a => ({ id: a.id, label: `${a.vector} · ${a.destination}`, color: a.end ? ORANGE : RED, values: { duration: Math.max(0, (Math.min(Date.parse(a.end ?? meta.untilTs), Date.parse(meta.untilTs)) - Math.max(Date.parse(a.start), Date.parse(meta.sinceTs))) / 1000), packets: a.packets!, dropped: a.droppedBits! / 8 } }))} />}
         <EvidenceTable headers={["Vector / ID", "Start", "End", "Target", "Lifetime dropped"]} rows={data.attacks.map(a => [`${a.vector} · ${a.id}`, mtDate(a.start, tz), a.end ? mtDate(a.end, tz) : "Ongoing", `${a.destination || "Unavailable"}:${a.port ?? "unknown port"} (${a.protocol || "unknown protocol"})`, mtBytes(a.droppedBits)])} />
      </Panel>
      <Panel id="mt-tunnels" title="Tunnel health & throughput" subtitle={`${tunnelCadence} summaries · probe success, routing state and bandwidth remain separate`}>
        <HealthHeatmap health={tunnelRollup.health} tzOffset={tz} timestamps={tunnelRollup.timestamps} />
        <div className="mt-grid">
          {tunnelRollup.health.length > 0 && <StackedBarChart title={`${tunnelCadence} probe outcomes`} subtitle="Counts summed across measured tunnels; gaps have no returned samples" height={200} data={tunnelRollup.probeSeries} series={[{ key: "ok", label: "OK", color: GREEN }, { key: "timeout", label: "Timeout", color: RED }, { key: "other", label: "Other", color: ORANGE }]} labelFormatter={tunnelTimeLabel} />}
          {tunnelRollup.traffic.length > 0 ? <AreaTimeSeriesChart title={`${tunnelCadence} tunnel bandwidth`} subtitle="Average over returned source buckets · ingress and egress are separate" height={200} data={tunnelRollup.bandwidthSeries.map(p => ({ ...p, label: tunnelTimeLabel(String(p.date)) }))} series={tunnelRollup.directionKeys.map((key, i) => ({ key, label: key, color: i ? ORANGE : BLUE }))} xDataKey="label" tickFormatter={mtRate} /> : <div><h3>Tunnel bandwidth</h3><p className="mt-empty">{data.errors.tunnelTraffic ? "Tunnel throughput measurements are unavailable. See collection errors." : "No tunnel throughput measurements returned for this period. This is not measured zero traffic."}</p></div>}
        </div>
        <h3>Period summary by tunnel</h3>
        <EvidenceTable headers={["Tunnel / type", "Endpoint", "Checks / BGP", "Probes", "Success", "Timeouts", "Mean routing state (0–1)"]} rows={tunnelNames.map(name => {
          const t = data.tunnels.find(t => t.name === name), p = tunnelRollup.totals.find(p => p.tunnel === name), total = p ? p.ok + p.timeout + p.other : 0;
          return [`${name} · ${t?.type ?? "Unknown type"}`, t?.endpoint || "Unavailable", <div>{t?.healthChecksEnabled == null ? "Checks unknown" : t.healthChecksEnabled ? "Checks enabled" : "Checks disabled"}<br />{t?.bgpState ?? "BGP unavailable"}</div>, total ? total.toLocaleString() : "No samples", total ? `${(p!.ok / total * 100).toFixed(1)}%` : "Unavailable", p ? p.timeout.toLocaleString() : "Unavailable", p?.state == null ? "Unavailable" : p.state.toFixed(3)];
        })} />
        <p className="mt-caption">Probe counts are summed; success and routing-state means are sample-weighted. Bandwidth is bits divided by the duration of returned source buckets, not the sum of rates. Gaps remain unavailable.{tunnelRollup.utcAligned && " Daily buckets retain UTC source alignment; labels use the report timezone."}</p>
        {(tunnelRollup.health.length > 0 || tunnelRollup.traffic.length > 0) && <details className="mt-tunnel-evidence"><summary>{tunnelCadence} evidence · {tunnelRollup.health.length.toLocaleString()} health rows / {tunnelRollup.traffic.length.toLocaleString()} throughput rows</summary>
          {tunnelRollup.health.length > 0 && <EvidenceTable headers={["Period start", "Tunnel", "OK", "Timeout", "Other", "Mean routing state (0–1)"]} rows={tunnelRollup.health.map(p => [tunnelTimeLabel(p.timestamp), p.tunnel, p.ok.toLocaleString(), p.timeout.toLocaleString(), p.other.toLocaleString(), p.state == null ? "Unavailable" : p.state.toFixed(3)])} />}
          {tunnelRollup.traffic.length > 0 && <EvidenceTable headers={["Period start", "Tunnel", "Direction", "Bytes", "Mean bandwidth"]} rows={tunnelRollup.traffic.map(p => [tunnelTimeLabel(p.timestamp), p.tunnel, p.direction, mtBytes(p.bits), mtRate(p.bps)])} />}
        </details>}
      </Panel>
      <Panel id="mt-policy" title="Protection layers & policy activity" subtitle="DDoS, firewall and advanced protection measurements are kept separate">
        {data.protections.map(p => <div key={p.key} className="mt-protection"><h3>{p.name}</h3><p className="mt-caption">Dropped volume: {mtBytes(p.volume?.bits)} · {mtNumber(p.volume?.packets, "packets")}</p>
          {p.breakdown.length > 0 || p.series.length > 0 ? <div className={`mt-grid${p.breakdown.length && p.series.length ? "" : " mt-grid-single"}`}>{p.breakdown.length > 0 && <Rank title={`${p.name} breakdown`} rows={p.breakdown} />}{p.series.length > 0 && <AreaTimeSeriesChart height={200} title={`${p.name} bandwidth`} data={pivot(p.series, tz)} series={timeSeries} xDataKey="label" tickFormatter={mtRate} />}</div> : <p className="mt-caption">No breakdown or time series returned for this layer. See collection status.</p>}
          {p.rules.length > 0 && <EvidenceTable headers={["Configuration rule", "Mode"]} rows={p.rules.map(r => [r.name, r.mode])} />}</div>)}
        <Rank title="Network Firewall rule activity" rows={data.ruleActivity.map(r => ({ ...r, name: data.rules.find(rule => rule.id === r.name)?.name || r.name }))} />
        <EvidenceTable headers={["Rule", "Phase", "Action", "Status", "Expression / rate limit"]} rows={data.rules.map(r => [r.name, r.phase, r.action, r.enabled ? "Enabled" : "Disabled", <div className="mt-rule-code" tabIndex={0} role="region" aria-label={`${r.name} expression and rate limit`}><code>{r.expression}</code>{r.rateLimit && <p><code>{r.rateLimit}</code></p>}</div>])} />
      </Panel>
      <Panel id="mt-configuration" title="Configured network" subtitle={`Current snapshot collected ${mtDate(meta.configurationAt, tz)}; not the configuration throughout the reporting period`}>
        <RouteTopology routes={data.routes} tunnels={data.tunnels} />
        {coverage.length >= 3 && <SecurityRadarChart title="Observed health & configuration ratios" subtitle="Percentages with different denominators · not a security grade or composite score" data={coverage} color={BLUE} />}
        <EvidenceTable headers={["Metric", "Percent", "Definition"]} rows={coverage.map(c => [c.subject, `${c.score.toFixed(1)}%`, c.description])} />
        <EvidenceTable headers={["Prefix", "ASN", "Advertisement snapshot", "RPKI"]} rows={data.prefixes.map(p => [p.cidr, p.asn ?? "Unavailable", p.advertised == null ? "Unavailable" : p.advertised ? "Advertised" : "Not advertised", p.rpki || "Unavailable"])} />
        <EvidenceTable headers={["Route prefix", "Next hop", "Priority"]} rows={data.routes.map(r => [r.prefix, r.nextHop, r.priority])} />
      </Panel>
      <Panel id="mt-quality" title="Data quality & collection status" subtitle="Unavailable measurements are not substituted with zero">
        <ul className="mt-notes">{data.notes.map(note => <li key={note}>{note}</li>)}</ul>
        <EvidenceTable headers={["Unavailable section", "Reason"]} rows={Object.entries(data.errors).map(([key, value]) => [key, value])} />
        <p className="mt-caption">Account: {meta.accountId} · UTC window: {meta.sinceTs} → {meta.untilTs}. Display timezone: UTC{tz <= 0 ? "+" : "−"}{Math.abs(tz / 60)}.</p>
      </Panel>
      <footer className="mt-footer">Magic Transit network assessment · Confidential · {input.clientName || meta.accountName}</footer>
    </main>
  </div>;
}
