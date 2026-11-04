import { useRef, useState } from "react";
import { DASHBOARD_DATASETS, defaultDashboardTemplate, validateDashboardTemplate, type DashboardTemplate, type DashboardTemplateWidget } from "../../../../shared/custom-dashboard-template";
import "../pages/custom-dashboard.css";

export default function DashboardTemplateEditor({ value, onChange }: { value: DashboardTemplate; onChange: (next: DashboardTemplate) => void }) {
  const file = useRef<HTMLInputElement>(null), [error, setError] = useState("");
  function update(index: number, patch: Partial<DashboardTemplateWidget>) {
    onChange({ ...value, widgets: value.widgets.map((w, i) => i === index ? { ...w, ...patch } : w) });
  }
  function download() {
    try {
      const template = validateDashboardTemplate(value), url = URL.createObjectURL(new Blob([JSON.stringify(template, null, 2)], { type: "application/json" }));
      const a = document.createElement("a"); a.href = url; a.download = "custom-dashboard-template.json"; a.click(); setTimeout(() => URL.revokeObjectURL(url), 5000); setError("");
    } catch (e) { setError(e instanceof Error ? e.message : "Invalid template"); }
  }
  return <section className="cd-settings cd-template" aria-label="Live dashboard template">
    <h2>Reusable widget template</h2>
    <p>Each execution queries these widgets with a fresh reporting interval. A Cloudflare dashboard URL is an optional reference.</p>
    <div className="cd-fields">
      <label>Template title<input value={value.title} maxLength={200} onChange={e => onChange({ ...value, title: e.target.value })} /></label>
      <label>Dashboard reference URL<input value={value.dashboardUrl} maxLength={2000} onChange={e => onChange({ ...value, dashboardUrl: e.target.value })} /></label>
      <label>Exact hostname filter (optional)<input value={value.hostname} maxLength={255} placeholder="example.com" onChange={e => onChange({ ...value, hostname: e.target.value })} /></label>
      <label>Exact path filter (optional)<input value={value.path} maxLength={2000} placeholder="/booking" onChange={e => onChange({ ...value, path: e.target.value })} /></label>
    </div>
    {value.widgets.map((w, index) => {
      const catalog = DASHBOARD_DATASETS[w.dataset];
      return <fieldset key={w.id} className="cd-widget-editor"><legend>Query widget {index + 1}</legend><div className="cd-fields">
        <label>Query widget title<input value={w.title} maxLength={200} onChange={e => update(index, { title: e.target.value })} /></label>
        <label>Dataset<select value={w.dataset} onChange={e => update(index, { dataset: e.target.value as DashboardTemplateWidget["dataset"], metric: "count", dimension: "", type: "stat" })}>{Object.entries(DASHBOARD_DATASETS).map(([key, c]) => <option key={key} value={key}>{c.label}</option>)}</select></label>
        <label>Metric<select value={w.metric} onChange={e => update(index, { metric: e.target.value as DashboardTemplateWidget["metric"] })}>{catalog.metrics.map(m => <option key={m}>{m}</option>)}</select></label>
        <label>Query chart type<select value={w.type} onChange={e => {
          const type = e.target.value as DashboardTemplateWidget["type"];
          update(index, { type, dimension: type === "stat" ? "" : type === "timeseries" ? "datetimeHour" : type === "top-n" ? "clientCountryName" : w.dimension });
        }}><option value="stat">Stat</option><option value="timeseries">Time series</option><option value="top-n">Top N</option><option value="table">Table</option></select></label>
        <label>Query dimension<select value={w.dimension} onChange={e => update(index, { dimension: e.target.value })}>{catalog.dimensions.filter(d => w.type === "stat" ? !d : w.type === "timeseries" ? d === "datetimeHour" || d === "date" : w.type === "top-n" ? d && d !== "datetimeHour" && d !== "date" : true).map(d => <option key={d} value={d}>{d || "Aggregate (no dimension)"}</option>)}</select></label>
        <div className="cd-order"><button type="button" disabled={index === 0} aria-label={`Move query ${w.title} up`} onClick={() => { const widgets = [...value.widgets]; [widgets[index - 1], widgets[index]] = [widgets[index], widgets[index - 1]]; onChange({ ...value, widgets }); }}>Up</button><button type="button" disabled={index === value.widgets.length - 1} aria-label={`Move query ${w.title} down`} onClick={() => { const widgets = [...value.widgets]; [widgets[index + 1], widgets[index]] = [widgets[index], widgets[index + 1]]; onChange({ ...value, widgets }); }}>Down</button><button type="button" disabled={value.widgets.length === 1} aria-label={`Remove query ${w.title}`} onClick={() => onChange({ ...value, widgets: value.widgets.filter((_, i) => i !== index) })}>Remove</button></div>
      </div></fieldset>;
    })}
    <div className="cd-actions"><button type="button" disabled={value.widgets.length >= 12} onClick={() => onChange({ ...value, widgets: [...value.widgets, { ...defaultDashboardTemplate().widgets[0], id: crypto.randomUUID(), title: "New widget" }] })}>Add query widget</button><button type="button" onClick={download}>Save query template</button><button type="button" onClick={() => file.current?.click()}>Import query template</button></div>
    <input ref={file} type="file" accept=".json,application/json" className="cd-file" aria-label="Query template file" onChange={async e => {
      const f = e.target.files?.[0]; e.target.value = ""; if (!f) return;
      try { if (f.size > 64000) throw new Error("Template must be under 64 KB."); onChange(validateDashboardTemplate(JSON.parse(await f.text()))); setError(""); }
      catch (e) { setError(e instanceof Error ? e.message : "Invalid query template"); }
    }} />
    {error && <p role="alert" className="cd-error">{error}</p>}
  </section>;
}
