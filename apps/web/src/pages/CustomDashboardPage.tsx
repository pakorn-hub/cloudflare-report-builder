import { useMemo, useRef, useState } from "react";
import { ArrowDown, ArrowLeft, ArrowUp, Download, FileText, Upload } from "lucide-react";
import {
  dashboardColumns, dashboardMetrics, dashboardReference, demoDashboardSnapshot,
  MAX_DASHBOARD_IMPORT_BYTES, parseDashboardImport,
  type DashboardSnapshot, type DashboardWidget,
} from "../../../../shared/custom-dashboard";
import { saveToHtml, saveToPdf } from "../utils/pdf-export";
import DashboardTemplateEditor from "../components/DashboardTemplateEditor";
import SavedDashboardSelector from "../components/SavedDashboardSelector";
import ReportDroid from "../components/ReportDroid";
import { narrateDashboard } from "../../../../shared/report-narration";
import { defaultDashboardTemplate, validateDashboardTemplate } from "../../../../shared/custom-dashboard-template";
import { fetchCustomDashboard } from "../services/api";
import "./custom-dashboard.css";

const number = (value: unknown, unit = ""): string => typeof value === "number" && Number.isFinite(value)
  ? `${new Intl.NumberFormat("en-US", { maximumSignificantDigits: 17 }).format(value)}${unit ? ` ${unit}` : ""}` : "Unavailable";
const label = (value: unknown): string => value === null || value === undefined ? "Unavailable" : String(value);

function TimePlot({ widget }: { widget: DashboardWidget }) {
  const points = widget.rows.map(row => ({
    time: typeof row[widget.dimension] === "string" && /^\d{4}-\d{2}-\d{2}(?:$|T.*(?:Z|[+-]\d{2}:\d{2})$)/.test(String(row[widget.dimension])) ? Date.parse(String(row[widget.dimension])) : NaN,
    value: typeof row[widget.metric] === "number" ? row[widget.metric] as number : null,
  })).sort((a, b) => a.time - b.time);
  if (points.length < 2 || points.some(p => !Number.isFinite(p.time)) || new Set(points.map(p => p.time)).size !== points.length) {
    return <p className="cd-empty">A time-series chart needs at least two distinct ISO timestamps, one row per timestamp. Use a table for multiple series or ambiguous dates.</p>;
  }
  const values = points.flatMap(p => p.value === null ? [] : [p.value]);
  if (!values.length) return <p className="cd-empty">No numeric observations returned.</p>;
  const minT = points[0].time, spanT = points[points.length - 1].time - minT;
  const minV = Math.min(0, ...values), maxV = Math.max(0, ...values), spanV = maxV - minV || 1;
  if (!Number.isFinite(spanV)) return <p className="cd-empty">The numeric range is too large to plot. Original values remain in the evidence table.</p>;
  let pen = false;
  const path = points.map(p => {
    if (p.value === null) { pen = false; return ""; }
    const command = pen ? "L" : "M"; pen = true;
    return `${command}${(70 + (p.time - minT) / spanT * 680).toFixed(2)},${(174 - (p.value - minV) / spanV * 150).toFixed(2)}`;
  }).join(" ");
  return <svg viewBox="0 0 800 220" role="img" aria-label={`${widget.title} time series`} className="cd-plot">
    {[24, 99, 174].map(y => <line key={y} x1="70" x2="750" y1={y} y2={y} stroke="#dedede" />)}
    <text x="64" y="28" textAnchor="end">{number(maxV)}</text><text x="64" y="178" textAnchor="end">{number(minV)}</text>
    <path d={path} fill="none" stroke="#ba0816" strokeWidth="2.5" />
    {points.map((p, i) => p.value === null ? null : <circle key={i} cx={70 + (p.time - minT) / spanT * 680} cy={174 - (p.value - minV) / spanV * 150} r="3" fill="#ba0816" />)}
    <text x="70" y="201">{new Date(minT).toISOString().replace(".000Z", " UTC")}</text>
    <text x="750" y="216" textAnchor="end">{new Date(points[points.length - 1].time).toISOString().replace(".000Z", " UTC")}</text>
  </svg>;
}

function Evidence({ widget }: { widget: DashboardWidget }) {
  const columns = dashboardColumns(widget.rows);
  return <div className="cd-evidence"><table aria-label={`${widget.title} evidence`}>
    <thead><tr>{columns.map(key => <th key={key} scope="col">{key}</th>)}</tr></thead>
    <tbody>{widget.rows.map((row, i) => <tr key={i}>{columns.map(key => <td key={key}>{typeof row[key] === "number" ? number(row[key]) : label(row[key])}</td>)}</tr>)}</tbody>
  </table></div>;
}

function Widget({ widget }: { widget: DashboardWidget }) {
  const ranked = widget.type === "top-n" ? widget.rows.filter(row => typeof row[widget.metric] === "number").sort((a, b) => (b[widget.metric] as number) - (a[widget.metric] as number)).slice(0, 10) : [];
  const max = Math.max(1, ...ranked.map(row => Math.abs(row[widget.metric] as number)));
  return <section className={`cd-widget cd-widget-${widget.type}`} data-widget-id={widget.id}>
    <h2>{widget.title}</h2>
    <div className="cd-measure">{widget.metric || "No numeric metric selected"}{widget.unit ? ` · ${widget.unit}` : ""}</div>
    {!widget.rows.length ? <p className="cd-empty">No observations returned. Unavailable data is not reported as zero.</p>
      : widget.type === "stat" ? <div className="cd-stat">{widget.rows.length === 1 ? number(widget.rows[0][widget.metric], widget.unit) : <span className="cd-empty">Stat cards require one aggregate row. Values have not been summed.</span>}</div>
      : widget.type === "timeseries" ? <TimePlot widget={widget} />
      : widget.type === "top-n" ? <>{ranked.some(row => (row[widget.metric] as number) < 0) ? <p className="cd-empty">Negative observations cannot be represented as volume bars. Use the signed values in the evidence table.</p> : <ol className="cd-ranking">{ranked.map((row, i) => <li key={i}>
        <div><span>{label(row[widget.dimension])}</span><strong>{number(row[widget.metric], widget.unit)}</strong></div>
        <div className="cd-bar"><span style={{ width: `${Math.abs(row[widget.metric] as number) / max * 100}%` }} /></div>
      </li>)}</ol>}<p className="cd-caption">Top {ranked.length} returned rows by {widget.metric || "selected metric"}. Full returned evidence below.</p></> : null}
    {widget.note && <p className="cd-note">{widget.note}</p>}
    {widget.rows.length > 0 && (widget.type === "table" ? <Evidence widget={widget} /> : widget.type !== "stat" || widget.rows.length !== 1 ? <div className="cd-details"><h3>Returned evidence · {widget.rows.length} rows</h3><Evidence widget={widget} /></div> : null)}
  </section>;
}

function WidgetEditor({ widget, enabled, onToggle, onChange, onMove, first, last }: {
  widget: DashboardWidget; enabled: boolean; onToggle: () => void;
  onChange: (patch: Partial<DashboardWidget>) => void; onMove: (direction: number) => void; first: boolean; last: boolean;
}) {
  const id = `cd-${widget.id}`;
  return <fieldset className="cd-widget-editor">
    <legend><label><input type="checkbox" checked={enabled} onChange={onToggle} /> Include {widget.title}</label></legend>
    <div className="cd-fields">
      <label htmlFor={`${id}-title`}>Widget title<input id={`${id}-title`} value={widget.title} maxLength={200} onChange={e => onChange({ title: e.target.value })} /></label>
      <label htmlFor={`${id}-type`}>Chart type<select id={`${id}-type`} value={widget.type} onChange={e => onChange({ type: e.target.value as DashboardWidget["type"] })}>
        <option value="stat">Stat</option><option value="timeseries">Time series</option><option value="top-n">Top N</option><option value="table">Table</option>
      </select></label>
      <label htmlFor={`${id}-metric`}>Numeric metric<select id={`${id}-metric`} value={widget.metric} onChange={e => onChange({ metric: e.target.value })}>
        <option value="">Not selected</option>{dashboardMetrics(widget.rows).map(key => <option key={key}>{key}</option>)}
      </select></label>
      <label htmlFor={`${id}-dimension`}>Dimension / timestamp<select id={`${id}-dimension`} value={widget.dimension} onChange={e => onChange({ dimension: e.target.value })}>
        <option value="">Not selected</option>{dashboardColumns(widget.rows).map(key => <option key={key}>{key}</option>)}
      </select></label>
      <label htmlFor={`${id}-unit`}>Unit (explicit)<input id={`${id}-unit`} value={widget.unit} maxLength={40} placeholder="e.g. requests, bytes, %, ms" onChange={e => onChange({ unit: e.target.value })} /></label>
      <div className="cd-order"><button type="button" disabled={first} aria-label={`Move ${widget.title} up`} onClick={() => onMove(-1)}><ArrowUp size={14} /> Up</button><button type="button" disabled={last} aria-label={`Move ${widget.title} down`} onClick={() => onMove(1)}><ArrowDown size={14} /> Down</button></div>
    </div>
  </fieldset>;
}

export default function CustomDashboardPage({ onBack, initialData, embedded = false, onOpenSchedules }: { onBack: () => void; initialData?: DashboardSnapshot; embedded?: boolean; onOpenSchedules?: () => void }) {
  const [data, setData] = useState<DashboardSnapshot | null>(initialData ?? null);
  const [included, setIncluded] = useState<Set<string>>(new Set(initialData?.widgets.map(w => w.id) ?? []));
  const [template, setTemplate] = useState(defaultDashboardTemplate);
  const [token, setToken] = useState(""), [accountId, setAccountId] = useState(""), [zoneId, setZoneId] = useState(""), [zoneName, setZoneName] = useState("");
  const [period, setPeriod] = useState<"yesterday" | "last_week" | "last_month">("yesterday");
  const [fetching, setFetching] = useState(false);
  const [dashboardBlocked, setDashboardBlocked] = useState(false);
  const [source, setSource] = useState("");
  const [error, setError] = useState("");
  const [preview, setPreview] = useState(!!initialData);
  const [busy, setBusy] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);
  function load(next: DashboardSnapshot) {
    setData(next); setIncluded(new Set(next.widgets.map(w => w.id))); setError(""); setSource(""); setPreview(false);
  }
  function importText(value: string) { try { load(parseDashboardImport(value)); } catch (e) { setError(e instanceof Error ? e.message : "Import failed."); } }
  const selected = data?.widgets.filter(w => included.has(w.id)) ?? [];
  const narration = useMemo(() => data && preview ? narrateDashboard(data, data.widgets.filter(w => included.has(w.id))) : [], [data, included, preview]);
  function prepare() {
    if (!data) return;
    try {
      const reference = data.dashboardUrl ? dashboardReference(data.dashboardUrl) : null;
      setData({ ...data, dashboardUrl: reference?.url ?? "", zoneName: data.zoneName || reference?.zoneName || "" });
      if (!selected.length) throw new Error("Include at least one widget.");
      setError(""); setPreview(true); window.scrollTo(0, 0);
    } catch (e) { setError(e instanceof Error ? e.message : "Check the report settings."); }
  }
  function downloadSnapshot() {
    if (!data) return;
    const blob = new Blob([JSON.stringify({ ...data, widgets: selected }, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob), link = document.createElement("a");
    link.href = url; link.download = "custom-dashboard-snapshot.json"; link.click(); setTimeout(() => URL.revokeObjectURL(url), 5000);
  }
  return <div className="cd-page">
    {!embedded && <nav className="cd-toolbar print:hidden" aria-label="Custom dashboard actions">
      <button type="button" onClick={onBack}><ArrowLeft size={15} /> Report types</button><span>Custom Dashboard</span>
      {preview && <><button type="button" onClick={() => setPreview(false)}>Edit widgets</button><button type="button" onClick={saveToPdf}><FileText size={15} /> Save PDF</button><button type="button" disabled={busy} onClick={async () => { setBusy(true); try { await saveToHtml(data?.zoneName || "custom-dashboard", data ? { ...data, widgets: selected } : undefined); } catch { setError("HTML export failed. Try again."); } finally { setBusy(false); } }}><Download size={15} /> {busy ? "Exporting…" : "Save HTML"}</button><button type="button" onClick={downloadSnapshot}>Save snapshot</button></>}
    </nav>}
    {error && <p className="cd-error print:hidden" role="alert">{error}</p>}
    {!preview ? <main className="cd-editor print:hidden">
      <header><p className="cd-eyebrow">Cloudflare Report Builder / Custom Dashboard</p><h1>Your widgets.<br />A shareable report.</h1>
        <p>Query fresh analytics with an API token, choose your widgets, and export or schedule a PDF and HTML report.</p></header>
      <section className="cd-import" aria-labelledby="cd-live-title"><h2 id="cd-live-title">Fresh analytics with an API token</h2>
        <p>Use an Analytics Read token with access to the selected zone. Configure the template once; scheduled runs fetch fresh data without a browser login or HAR upload. Selecting a saved Cloudflare dashboard additionally requires API-token access to its dashboard definitions.</p>
        <div className="cd-fields">
          <label>Analytics API token<input type="password" autoComplete="new-password" value={token} maxLength={500} onChange={e => setToken(e.target.value)} /></label>
          <label>Account ID<input value={accountId} maxLength={32} onChange={e => setAccountId(e.target.value)} /></label>
          <label>Zone ID<input value={zoneId} maxLength={32} onChange={e => setZoneId(e.target.value)} /></label>
          <label>Zone label (optional)<input value={zoneName} maxLength={200} placeholder="example.com" onChange={e => setZoneName(e.target.value)} /></label>
          <label>Complete reporting period<select value={period} onChange={e => setPeriod(e.target.value as typeof period)}><option value="yesterday">Yesterday</option><option value="last_week">Last week</option><option value="last_month">Last month</option></select></label>
        </div>
        {data?.origin === "api" && !token ? <p className="cd-caption">Analytics token cleared after fetching. Enter credentials again to choose another saved dashboard.</p> : <SavedDashboardSelector credentials={{ apiToken: token.trim() || undefined, accountId: accountId.trim() || undefined }} zoneId={zoneId} value={template} onBlockedChange={setDashboardBlocked} onChange={next => { setTemplate(next); setData(null); setIncluded(new Set()); }} />}
        <details><summary>Configure live query widgets</summary><DashboardTemplateEditor value={template} onChange={setTemplate} /></details>
        <div className="cd-actions"><button type="button" disabled={fetching || dashboardBlocked || !token || !accountId || !zoneId} onClick={async () => {
          setFetching(true); setError("");
          try { const validated = validateDashboardTemplate(template); load(await fetchCustomDashboard({ token: token.trim(), accountId: accountId.trim(), zoneId: zoneId.trim(), zoneName, template: validated, days: 1, tzOffset: new Date().getTimezoneOffset(), rangeMode: "period", period })); setToken(""); }
          catch (e) { setError(e instanceof Error ? e.message : "Analytics request failed."); }
          finally { setFetching(false); }
        }}>{fetching ? "Fetching analytics…" : "Fetch fresh analytics"}</button>{onOpenSchedules && <button type="button" onClick={onOpenSchedules}>Configure scheduled delivery</button>}</div>
        <p className="cd-caption">Save the query template above to reuse it in Scheduled Reports. Preview edits below change only this snapshot.</p>
      </section>
      <section className="cd-import" aria-labelledby="cd-import-title"><h2 id="cd-import-title">Import dashboard data</h2>
        <p>Choose a JSON snapshot, a GraphQL response, or a HAR with GraphQL response bodies. Files are parsed locally; their headers, cookies and request queries are discarded. No report data is uploaded.</p>
        <p>Local imports are point-in-time snapshots. For automated refresh and scheduled delivery, use an API-token query template above. A PDF provides a visual reference, not the underlying query data.</p>
        <div className="cd-actions"><button type="button" onClick={() => fileInput.current?.click()}><Upload size={15} /> Import JSON / HAR</button><button type="button" onClick={() => load(demoDashboardSnapshot())}>Load synthetic example</button></div>
        <input ref={fileInput} type="file" accept=".json,.har,application/json" aria-label="Dashboard data file" className="cd-file" onChange={async e => {
          const file = e.target.files?.[0]; e.target.value = ""; if (!file) return;
          if (file.size > MAX_DASHBOARD_IMPORT_BYTES) { setError("Import must be under 20 MB."); return; }
          try { importText(await file.text()); } catch { setError("Could not read the file. Choose a JSON snapshot or HAR."); }
        }} />
        <details><summary>Paste JSON instead</summary><label htmlFor="cd-source">Snapshot / GraphQL response / HAR JSON</label><textarea id="cd-source" value={source} onChange={e => setSource(e.target.value)} rows={6} spellCheck={false} /><button type="button" onClick={() => importText(source)} disabled={!source.trim()}>Import pasted JSON</button></details>
        <a href="https://developers.cloudflare.com/analytics/graphql-api/tutorials/capture-graphql-queries-from-dashboard/" target="_blank" rel="noreferrer">How to capture dashboard queries</a>
      </section>
      {data && <>
        <section className="cd-settings"><h2>Report details</h2><div className="cd-fields">
          <label htmlFor="cd-title">Report title<input id="cd-title" value={data.title} maxLength={200} onChange={e => setData({ ...data, title: e.target.value })} /></label>
          <label htmlFor="cd-zone">Zone / scope label<input id="cd-zone" value={data.zoneName} maxLength={200} onChange={e => setData({ ...data, zoneName: e.target.value })} placeholder="example.com or account-wide" /></label>
          <label htmlFor="cd-url">Cloudflare custom dashboard URL (optional)<input id="cd-url" value={data.dashboardUrl} onChange={e => setData({ ...data, dashboardUrl: e.target.value })} placeholder="https://dash.cloudflare.com/…/dashboards/…" /></label>
          <label htmlFor="cd-period">Observation period and timezone<input id="cd-period" value={data.period} maxLength={300} onChange={e => setData({ ...data, period: e.target.value })} placeholder="Copy the selected dashboard interval and timezone" /></label>
          <label htmlFor="cd-captured">Data captured at (optional)<input id="cd-captured" value={data.capturedAt} maxLength={100} onChange={e => setData({ ...data, capturedAt: e.target.value })} placeholder="ISO timestamp; not the observation interval" /></label>
          <label htmlFor="cd-notes">Report notes<textarea id="cd-notes" value={data.notes} maxLength={2000} onChange={e => setData({ ...data, notes: e.target.value })} rows={2} /></label>
        </div></section>
        {data.warnings.length > 0 && <aside className="cd-warnings"><h2>Import notes</h2><ul>{data.warnings.map((warning, i) => <li key={i}>{warning}</li>)}</ul></aside>}
        <section><h2>Select and arrange widgets <span className="cd-caption">{selected.length} of {data.widgets.length} included</span></h2>
          <p className="cd-caption">Metric names and units are explicit. Stat cards need one aggregate row; this mode never sums averages, rates, percentiles or top-N results.</p>
          {data.widgets.map((widget, i) => <WidgetEditor key={widget.id} widget={widget} enabled={included.has(widget.id)} first={i === 0} last={i === data.widgets.length - 1}
            onToggle={() => setIncluded(current => { const next = new Set(current); if (next.has(widget.id)) next.delete(widget.id); else next.add(widget.id); return next; })}
            onChange={patch => setData({ ...data, widgets: data.widgets.map(w => w.id === widget.id ? { ...w, ...patch } : w) })}
            onMove={direction => { const widgets = [...data.widgets]; [widgets[i], widgets[i + direction]] = [widgets[i + direction], widgets[i]]; setData({ ...data, widgets }); }} />)}
        </section>
        <div className="cd-actions"><button type="button" className="cd-primary" onClick={prepare} disabled={(dashboardBlocked && data.origin === "api") || !selected.length}>Build report · {selected.length} widgets</button></div>
      </>}
    </main> : data && <main id="report-content" className="cd-report">
      <table className="cd-document" role="presentation"><thead><tr><td><header className="cd-running-header"><strong>Cloudflare / Custom Dashboard</strong><span>{data.zoneName || "Scope not supplied"} · {data.period || "Observation period not supplied"}</span></header></td></tr></thead>
        <tbody><tr><td><header className="cd-report-heading"><p className="cd-eyebrow">{data.origin === "api" ? "API-generated dashboard report" : "Imported dashboard snapshot"}</p><h1>{data.title || "Custom dashboard"}</h1>
          <p>{data.zoneName || "Scope not supplied"}</p><p>{data.period || "Observation period and timezone not supplied"}</p>
          {data.capturedAt && <p className="cd-caption">Data captured at: {data.capturedAt}</p>}
          {data.dashboardUrl && <a href={data.dashboardUrl} target="_blank" rel="noreferrer">Source custom dashboard ↗</a>}
          {data.notes && <p className="cd-report-note">{data.notes}</p>}
        </header>
        {data.warnings.length > 0 && <aside className="cd-warnings"><h2>Data coverage and import notes</h2><ul>{data.warnings.map((warning, i) => <li key={i}>{warning}</li>)}</ul></aside>}
        <div className="cd-widgets">{selected.map(widget => <Widget key={widget.id} widget={widget} />)}</div>
         <footer className="cd-footer">{data.origin === "api" ? "Fresh API queries at generation time." : "Imported, point-in-time data."} Sampling, dataset limits and original filters apply. Missing values remain unavailable; returned rankings are not population totals.</footer>
        </td></tr></tbody></table>
    </main>}
    {preview && data && narration.length > 0 && <ReportDroid segments={narration} />}
  </div>;
}
