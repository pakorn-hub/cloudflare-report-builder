import { useState } from "react";
import { AlertTriangle, Shield, Clock } from "lucide-react";
import { ResponsiveContainer, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip } from "recharts";
import type { ZeroTrustData, CasbFindingItem, CasbFindingStatus } from "../../types";
import { formatNumber } from "../../utils/formatters";
import SectionHeader from "../../components/SectionHeader";
import { updateCasbFindingItem } from "../../services/api";

const SEVERITY_COLORS: Record<string, string> = {
  critical: "#EF4444", high: "#F97316", medium: "#F59E0B", low: "#3B82F6", unknown: "#9CA3AF",
};

const CASB_STATUS_LABEL: Record<CasbFindingStatus, string> = {
  open: "Open", investigating: "Investigating", remediated: "Remediated",
  false_positive: "False Positive", accepted_risk: "Accepted Risk",
};
const CASB_STATUS_COLOR: Record<CasbFindingStatus, string> = {
  open: "#EF4444", investigating: "#3B82F6", remediated: "#10B981",
  false_positive: "#9CA3AF", accepted_risk: "#8B5CF6",
};

function CasbFindingRow({ item, onChange }: { item: CasbFindingItem; onChange: (next: CasbFindingItem) => void }) {
  const [ownerDraft, setOwnerDraft] = useState(item.ownerEmail ?? "");
  const [saving, setSaving] = useState(false);

  async function persist(update: Parameters<typeof updateCasbFindingItem>[1]) {
    setSaving(true);
    try {
      const updated = await updateCasbFindingItem(item.id, update);
      onChange(updated);
    } catch { /* surfaced implicitly via unchanged UI state */ }
    finally { setSaving(false); }
  }

  return (
    <tr className="border-b border-cf-gray-50 last:border-0 align-top">
      <td className="py-1.5 pr-3">
        <span className="text-[10px] px-2 py-0.5 rounded-full font-medium capitalize"
          style={{ color: SEVERITY_COLORS[item.severity.toLowerCase()] ?? SEVERITY_COLORS.unknown, backgroundColor: `${SEVERITY_COLORS[item.severity.toLowerCase()] ?? SEVERITY_COLORS.unknown}14` }}>
          {item.severity}
        </span>
      </td>
      <td className="py-1.5 pr-3 text-cf-navy">{item.type}</td>
      <td className="py-1.5 pr-3 text-cf-gray-500 font-mono truncate max-w-[180px]">{item.resourceName}</td>
      <td className="py-1.5 pr-3 text-[11px] text-cf-gray-500 whitespace-nowrap">
        <div className="flex items-center gap-1"><Clock size={10} className="text-cf-gray-400"/>{item.ageDays}d</div>
      </td>
      <td className="py-1.5 pr-3">
        <select
          className="print:hidden text-[11px] border border-cf-gray-200 rounded px-1 py-0.5 bg-white"
          value={item.status}
          disabled={saving}
          onChange={(e) => persist({ status: e.target.value as CasbFindingStatus })}
        >
          {(Object.keys(CASB_STATUS_LABEL) as CasbFindingStatus[]).map((s) => (
            <option key={s} value={s}>{CASB_STATUS_LABEL[s]}</option>
          ))}
        </select>
        <span className="hidden print:inline text-[11px] font-semibold" style={{ color: CASB_STATUS_COLOR[item.status] }}>
          {CASB_STATUS_LABEL[item.status]}
        </span>
      </td>
      <td className="py-1.5">
        <input
          type="email"
          placeholder="owner@company.com"
          className="print:hidden text-[11px] border border-cf-gray-200 rounded px-1 py-0.5 w-[140px]"
          value={ownerDraft}
          disabled={saving}
          onChange={(e) => setOwnerDraft(e.target.value)}
          onBlur={() => { if (ownerDraft !== (item.ownerEmail ?? "")) persist({ ownerEmail: ownerDraft || null }); }}
        />
        <span className="hidden print:inline text-[11px] text-cf-gray-600">{item.ownerEmail || "Unassigned"}</span>
      </td>
    </tr>
  );
}

export default function ZTDlpSection({ data }: { data: ZeroTrustData }) {
  const profiles = data.dlpProfiles;
  const casbBySeverity = data.casbFindingsBySeverity ?? [];
  const quarantineSeries = data.gatewayDlpQuarantineTimeSeries ?? [];
  const s = data.summary;
  const [register, setRegister] = useState<CasbFindingItem[]>(data.casbFindingRegister ?? []);
  const dlpActivity = data.dlpActivitySummary;
  const dlpProfileMatches = data.dlpProfileMatches ?? [];
  const dlpTopWebsites = data.dlpTopWebsites ?? [];

  function handleChange(next: CasbFindingItem) {
    setRegister((prev) => prev.map((it) => (it.id === next.id ? next : it)));
  }
  const activeFindings  = register.filter((f) => f.clearedAt === null);
  const clearedFindings = register.filter((f) => f.clearedAt !== null);

  if (profiles.length === 0 && (s.casbFindingsCount ?? 0) === 0 && !dlpActivity) return (
    <section className="report-section">
      <SectionHeader icon={<Shield size={20}/>} title="Data Loss Prevention (DLP) & CASB" subtitle="Sensitive data detection and SaaS security posture" />
      <div className="bg-yellow-50 border border-yellow-200 rounded-xl p-6 text-center">
        <AlertTriangle size={28} className="text-yellow-500 mx-auto mb-2"/>
        <p className="text-sm font-semibold text-yellow-700">No DLP profiles or CASB findings configured</p>
        <p className="text-xs text-yellow-600 mt-1">Configure DLP profiles to detect PII, credit cards, and sensitive data before it leaves your organization, and connect SaaS integrations for CASB posture monitoring.</p>
      </div>
    </section>
  );

  return (
    <section className="report-section">
      <SectionHeader icon={<Shield size={20}/>} title="Data Loss Prevention (DLP) & CASB"
        subtitle="DLP profile configuration and real CASB (Data Security Posture) findings" />
      <div className={`grid grid-cols-2 gap-4 mb-5 ${dlpActivity ? "sm:grid-cols-5" : "sm:grid-cols-3"}`}>
        {[
          { label: "DLP Profiles",     value: formatNumber(profiles.length), color: "#8B5CF6" },
          { label: "Predefined",       value: formatNumber(profiles.filter((p) => p.type === "predefined").length), color: "#3B82F6" },
          { label: "CASB Findings",    value: formatNumber(s.casbFindingsCount ?? 0), color: (s.casbFindingsCount ?? 0) > 0 ? "#EF4444" : "#10B981" },
          ...(dlpActivity ? [
            { label: "DLP Matches (Real)", value: formatNumber(dlpActivity.hitCount), color: dlpActivity.hitCount > 0 ? "#EF4444" : "#10B981" },
            { label: "Files/Requests Scanned", value: formatNumber(dlpActivity.scanCount), color: "#F59E0B" },
          ] : []),
        ].map((k) => (
          <div key={k.label} className="bg-white rounded-xl shadow-sm border border-cf-gray-200 p-4">
            <p className="text-[10px] font-semibold text-cf-gray-500 uppercase tracking-wide mb-1">{k.label}</p>
            <p className="text-2xl font-black" style={{ color: k.color }}>{k.value}</p>
          </div>
        ))}
      </div>

      {/* Real per-period DLP match data — REST /analytics/gateway/proxy/http.
          Previously this codebase claimed no per-period match counts were
          exposed by any API; confirmed live that this specific REST
          analytics endpoint does expose them (per-profile hit counts, total
          hits/scans, and top DLP-affected websites). */}
      {(dlpProfileMatches.length > 0 || dlpTopWebsites.length > 0) && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-5 items-start mb-5">
          {dlpProfileMatches.length > 0 && (
            <div className="bg-white rounded-xl shadow-sm border border-cf-gray-200 p-4">
              <h3 className="text-sm font-semibold text-cf-navy mb-3">DLP Matches by Profile ({dlpProfileMatches.length})</h3>
              <div className="space-y-2 max-h-72 overflow-y-auto">
                {dlpProfileMatches.slice(0, 15).map((p) => {
                  const maxVal = Math.max(...dlpProfileMatches.map((x) => x.hitCount), 1);
                  const pct = Math.round((p.hitCount / maxVal) * 100);
                  return (
                    <div key={p.profileName}>
                      <div className="flex justify-between text-xs mb-1">
                        <span className="font-medium text-cf-navy truncate pr-2">{p.profileName}</span>
                        <span className="font-mono text-red-600 flex-shrink-0">{formatNumber(p.hitCount)}</span>
                      </div>
                      <div className="h-1.5 bg-cf-gray-100 rounded-full overflow-hidden">
                        <div className="h-full rounded-full bg-red-500" style={{ width: `${pct}%` }}/>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
          {dlpTopWebsites.length > 0 && (
            <div className="bg-white rounded-xl shadow-sm border border-cf-gray-200 p-4">
              <h3 className="text-sm font-semibold text-cf-navy mb-3">Top Websites by DLP Matches</h3>
              <div className="space-y-1.5">
                {dlpTopWebsites.slice(0, 8).map((w) => (
                  <div key={w.host} className="flex items-center justify-between text-xs">
                    <span className="text-cf-gray-600 truncate font-mono pr-2">{w.host}</span>
                    <span className="font-mono font-semibold text-red-600 flex-shrink-0">{formatNumber(w.hitCount)}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
      <div className={`grid gap-5 items-start ${casbBySeverity.length > 0 && profiles.length > 0 ? "grid-cols-1 lg:grid-cols-2" : "grid-cols-1"}`}>
        {casbBySeverity.length > 0 && (
          <div className="bg-white rounded-xl shadow-sm border border-cf-gray-200 p-4">
            <h3 className="text-sm font-semibold text-cf-navy mb-3">CASB Findings by Severity</h3>
            <div className="space-y-2">
              {casbBySeverity.map((f) => {
                const maxVal = Math.max(...casbBySeverity.map((x) => x.count), 1);
                const pct = Math.round((f.count / maxVal) * 100);
                return (
                  <div key={f.severity}>
                    <div className="flex justify-between text-xs mb-1">
                      <span className="font-medium text-cf-navy capitalize">{f.severity}</span>
                      <span className="font-mono text-red-600">{formatNumber(f.count)}</span>
                    </div>
                    <div className="h-1.5 bg-cf-gray-100 rounded-full overflow-hidden">
                      <div className="h-full rounded-full" style={{ width: `${pct}%`, backgroundColor: SEVERITY_COLORS[f.severity.toLowerCase()] ?? SEVERITY_COLORS.unknown }}/>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}
        {profiles.length > 0 && (
          <div className="bg-white rounded-xl shadow-sm border border-cf-gray-200 p-4">
            <h3 className="text-sm font-semibold text-cf-navy mb-3">Configured DLP Profiles ({profiles.length})</h3>
            <div className={`gap-x-4 ${casbBySeverity.length > 0 ? "" : "grid grid-cols-1 sm:grid-cols-2"}`}>
              {profiles.map((p) => (
                <div key={p.id} className="flex items-center justify-between gap-2 py-1 border-b border-cf-gray-50 last:border-0">
                  <span className="text-xs text-cf-navy font-medium truncate">{p.name}</span>
                  <span className={`text-[10px] px-2 py-0.5 rounded-full font-medium flex-shrink-0 ${p.type === "predefined" ? "bg-blue-50 text-blue-600" : "bg-purple-50 text-purple-600"}`}>{p.type}</span>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Real DLP outcome signal: HTTP requests quarantined by a DLP action
          over time — an indirect but genuinely measured trend (Cloudflare
          exposes no per-match/per-profile dataset via GraphQL). */}
      {quarantineSeries.some((d) => d.count > 0) && (
        <div className="bg-white rounded-xl shadow-sm border border-cf-gray-200 p-4 mt-5">
          <h3 className="text-sm font-semibold text-cf-navy mb-3">DLP Quarantine Actions Over Time</h3>
          <ResponsiveContainer width="100%" height={200}>
            <BarChart data={quarantineSeries} margin={{ top: 4, right: 8, bottom: 0, left: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#F1F5F9"/>
              <XAxis dataKey="date" tick={{ fontSize: 10 }} tickFormatter={(v) => v.slice(5)}/>
              <YAxis tick={{ fontSize: 10 }}/>
              <Tooltip contentStyle={{ fontSize: 11, borderRadius: 8 }} formatter={(v: number) => formatNumber(v)}/>
              <Bar dataKey="count" name="Quarantined requests" fill="#8B5CF6" radius={[3,3,0,0]}/>
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}

      {/* CASB Finding Register — lifecycle-tracked (age, status, owner)
          version of the REST /data-security/posture/findings feed. Each
          finding is tracked by Cloudflare's own finding id across report
          runs; auto-clears (status → Remediated) when Cloudflare stops
          reporting it, unless already marked False Positive / Accepted
          Risk — mirrors the SaaS Risk Assessment tracking pattern used in
          Zscaler/Prisma/Netskope reporting. */}
      {activeFindings.length > 0 && (
        <div className="bg-white rounded-xl shadow-sm border border-cf-gray-200 p-4 mt-5">
          <h3 className="text-sm font-semibold text-cf-navy mb-1">CASB Finding Register ({activeFindings.length})</h3>
          <p className="text-[10px] text-cf-gray-400 mb-3">
            Tracked across report runs — age since first detected, investigation status, and assignable owner. Auto-clears when Cloudflare no longer reports the finding.
          </p>
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="text-left text-[10px] uppercase tracking-wide text-cf-gray-400 border-b border-cf-gray-100">
                  <th className="py-1.5 pr-3">Severity</th>
                  <th className="py-1.5 pr-3">Type</th>
                  <th className="py-1.5 pr-3">Resource</th>
                  <th className="py-1.5 pr-3">Age</th>
                  <th className="py-1.5 pr-3">Status</th>
                  <th className="py-1.5">Owner</th>
                </tr>
              </thead>
              <tbody>
                {activeFindings.slice(0, 30).map((f) => (
                  <CasbFindingRow key={f.id} item={f} onChange={handleChange} />
                ))}
              </tbody>
            </table>
          </div>
          {clearedFindings.length > 0 && (
            <details className="mt-3">
              <summary className="text-[11px] text-cf-gray-500 cursor-pointer">Cleared findings ({clearedFindings.length})</summary>
              <table className="w-full text-xs mt-2">
                <tbody>
                  {clearedFindings.slice(0, 20).map((f) => (
                    <tr key={f.id} className="border-b border-cf-gray-50 last:border-0">
                      <td className="py-1 pr-3 text-cf-gray-500">{f.type} — {f.resourceName}</td>
                      <td className="py-1 text-cf-gray-400 text-[10px] whitespace-nowrap">
                        {CASB_STATUS_LABEL[f.status]} {f.clearedAt ? new Date(f.clearedAt).toLocaleDateString() : ""}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </details>
          )}
        </div>
      )}

    </section>
  );
}
