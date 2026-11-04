import { useEffect, useId, useRef, useState } from "react";
import type { DashboardTemplate } from "../../../../shared/custom-dashboard-template";
import type { SavedDashboard } from "../../../../shared/saved-dashboard";
import { fetchSavedDashboards, type SavedDashboardCredentials } from "../services/api";

export default function SavedDashboardSelector({ credentials, zoneId, value, onChange, onBlockedChange }: {
  credentials: SavedDashboardCredentials; zoneId: string; value: DashboardTemplate;
  onChange: (template: DashboardTemplate) => void; onBlockedChange: (blocked: boolean) => void;
}) {
  const id = useId(), generation = useRef(0);
  const [mode, setMode] = useState(value.source ? "saved" : "manual"), [scope, setScope] = useState<"account" | "zone">(value.source?.scope ?? "account");
  const [options, setOptions] = useState<SavedDashboard[] | null>(null), [selectedId, setSelectedId] = useState(value.source?.dashboardId ?? "");
  const [storedAllowed, setStoredAllowed] = useState(!!value.source);
  const [loading, setLoading] = useState(false), [error, setError] = useState("");
  const { apiToken, accountId, scheduleId } = credentials;
  const previous = useRef({ apiToken, accountId, scheduleId, zoneId });
  const storedMatches = !!value.source && value.source.scope === scope && (!accountId || value.source.accountId === accountId) && (scope === "account" || value.source.zoneId === zoneId.trim());
  useEffect(() => {
    const changed = Object.entries(previous.current).some(([key, old]) => old !== ({ apiToken, accountId, scheduleId, zoneId } as Record<string, unknown>)[key]);
    previous.current = { apiToken, accountId, scheduleId, zoneId };
    generation.current++; setOptions(null); setError(""); setLoading(false);
    if (changed) setStoredAllowed(false);
    const retained = !changed && storedAllowed && storedMatches;
    setSelectedId(retained ? value.source!.dashboardId : "");
    onBlockedChange(mode === "saved" && !retained);
    return () => { generation.current++; };
  }, [apiToken, accountId, scheduleId, zoneId, mode, scope, onBlockedChange]);
  const selected = options?.find(option => option.id === selectedId);
  const validScope = scope === "account" || /^[a-f\d]{32}$/i.test(zoneId.trim());
  async function load() {
    const requestGeneration = ++generation.current;
    setLoading(true); setError(""); setOptions(null); setSelectedId(""); setStoredAllowed(false); onBlockedChange(true);
    try {
      const dashboards = await fetchSavedDashboards({ ...credentials, scope, ...(scope === "zone" ? { zoneId: zoneId.trim() } : {}) });
      if (requestGeneration === generation.current) setOptions(dashboards);
    } catch (e) {
      if (requestGeneration === generation.current) setError(e instanceof Error ? e.message : "Saved dashboards could not be loaded.");
    } finally { if (requestGeneration === generation.current) setLoading(false); }
  }
  return <section className="cd-settings cd-template" aria-label="Saved dashboard selection">
    <h2>Select dashboard</h2>
    <label htmlFor={`${id}-source`}>Dashboard source<select id={`${id}-source`} value={mode} onChange={e => { setMode(e.target.value); onBlockedChange(e.target.value === "saved"); if (e.target.value === "manual" && value.source) { const { source: _source, ...manual } = value; onChange(manual); setStoredAllowed(false); } }}>
      <option value="manual">Configure query template</option><option value="saved">Cloudflare saved dashboard</option>
    </select></label>
    {mode === "saved" && <>
      <p>Load dashboards saved in Cloudflare using the current API credentials. The saved-dashboard API must support token callers; analytics access alone does not provide this capability.</p>
      <div className="cd-fields">
        <label htmlFor={`${id}-scope`}>Dashboard scope<select id={`${id}-scope`} value={scope} onChange={e => setScope(e.target.value as typeof scope)}><option value="account">Account dashboards</option><option value="zone">Selected zone dashboards</option></select></label>
        <label htmlFor={`${id}-dashboard`}>Cloudflare saved dashboard<select id={`${id}-dashboard`} value={selectedId} disabled={loading || (!options?.length && !(storedAllowed && storedMatches))} onChange={e => {
          const dashboard = options?.find(option => option.id === e.target.value);
          setSelectedId(e.target.value); onBlockedChange(!dashboard?.template);
          if (dashboard?.template) { setStoredAllowed(true); onChange(dashboard.template); }
        }}>
          <option value="">{loading ? "Loading dashboards…" : options?.length ? "Select a saved dashboard" : "Load dashboards to select one"}</option>
          {options?.map(dashboard => <option key={dashboard.id} value={dashboard.id}>{dashboard.title}{dashboard.template ? "" : " — unsupported configuration"}</option>)}
          {!options && storedAllowed && storedMatches && <option value={value.source!.dashboardId}>{value.title} (stored configuration)</option>}
        </select></label>
      </div>
      <div className="cd-actions"><button type="button" onClick={load} disabled={loading || !validScope}>{loading ? "Loading dashboards…" : "Load saved dashboards"}</button></div>
      {!validScope && <p className="cd-caption">Enter a valid zone ID to load zone dashboards.</p>}
      {error && <p role="alert" className="cd-error">{error}</p>}
      {options?.length === 0 && <p role="status">Cloudflare returned no saved dashboards in this scope.</p>}
      {selected && !selected.template && <aside className="cd-warnings" role="alert"><strong>This dashboard cannot be generated faithfully.</strong><ul>{selected.issues.map((issue, index) => <li key={index}>{issue}</li>)}</ul><p>No charts or filters have been silently substituted. Choose a supported dashboard or explicitly configure a query template.</p></aside>}
      {selected?.template && <p role="status">Using {selected.title} · {selected.template.widgets.length} saved charts. Configuration is stored with the report; scheduled runs query fresh data. Later changes in Cloudflare require reloading and reselecting the dashboard.</p>}
      {!options && storedAllowed && storedMatches && <p role="status">Stored selection: {value.title}. Its saved configuration is retained; loading dashboards requests an updated list from Cloudflare.</p>}
      <p className="cd-caption">Reports use the selected zone and reporting period, including for account-scoped dashboards. All saved charts must be supported before generation is enabled.</p>
      {value.dashboardUrl && !selectedId && <p className="cd-caption">Current report configuration is retained. Select a dashboard to replace it.</p>}
    </>}
  </section>;
}
