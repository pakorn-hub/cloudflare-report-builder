/**
 * ZTRemediationRegisterSection — Remediation Register
 *
 * The same evidence-based findings used elsewhere in the report (no MFA
 * enforced, no DNS blocking policies, etc.) persisted in D1 and tracked
 * over time: age since first detected, status, and an assignable owner —
 * the QBR-style "remediation register" pattern used in Zscaler/Prisma/
 * Netskope executive reporting, instead of a fresh un-auditable bullet
 * list every time a report is generated.
 *
 * Interactive: status/owner/due-date edits PATCH /api/remediation/:id and
 * update local state immediately. Findings themselves are never created or
 * deleted here — only annotated; they are opened/auto-resolved as a side
 * effect of report generation (see zt-remediation.ts on the API side).
 */
import { useState } from "react";
import { ClipboardList, AlertTriangle, Clock, CheckCircle2, ShieldAlert } from "lucide-react";
import type { ZeroTrustData, RemediationItem, RemediationStatus } from "../../types";
import SectionHeader from "../../components/SectionHeader";
import { updateRemediationItem } from "../../services/api";

const SEVERITY_COLOR: Record<string, string> = { high: "#EF4444", medium: "#F59E0B", low: "#6B7280" };
const STATUS_LABEL: Record<RemediationStatus, string> = {
  open: "Open", in_progress: "In Progress", accepted_risk: "Accepted Risk", resolved: "Resolved",
};
const STATUS_COLOR: Record<RemediationStatus, string> = {
  open: "#EF4444", in_progress: "#3B82F6", accepted_risk: "#8B5CF6", resolved: "#10B981",
};

function RegisterRow({ item, onChange }: { item: RemediationItem; onChange: (next: RemediationItem) => void }) {
  const [ownerDraft, setOwnerDraft] = useState(item.ownerEmail ?? "");
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState("");

  async function persist(update: Parameters<typeof updateRemediationItem>[1]) {
    setSaving(true); setErr("");
    try {
      const updated = await updateRemediationItem(item.id, update);
      onChange(updated);
    } catch (e) {
      setErr(String(e));
    } finally {
      setSaving(false);
    }
  }

  return (
    <tr className="align-top">
      <td className="px-3 py-2.5">
        <span className="text-[10px] font-bold px-1.5 py-0.5 rounded uppercase" style={{ color: SEVERITY_COLOR[item.severity], backgroundColor: SEVERITY_COLOR[item.severity] + "18" }}>
          {item.severity}
        </span>
      </td>
      <td className="px-3 py-2.5 max-w-[260px]">
        <p className="text-xs font-semibold text-cf-navy leading-snug">{item.title}</p>
        <p className="text-[10px] text-cf-gray-500 mt-0.5">{item.evidence}</p>
      </td>
      <td className="px-3 py-2.5 text-[11px] text-cf-gray-600 whitespace-nowrap">
        <div className="flex items-center gap-1"><Clock size={10} className="text-cf-gray-400"/>{item.ageDays}d</div>
        <p className="text-[10px] text-cf-gray-400 mt-0.5">since {new Date(item.firstSeenAt).toLocaleDateString()}</p>
      </td>
      <td className="px-3 py-2.5">
        <select
          className="print:hidden text-[11px] border border-cf-gray-200 rounded px-1.5 py-1 bg-white"
          value={item.status}
          disabled={saving}
          onChange={(e) => persist({ status: e.target.value as RemediationStatus })}
        >
          {(Object.keys(STATUS_LABEL) as RemediationStatus[]).map((s) => (
            <option key={s} value={s}>{STATUS_LABEL[s]}</option>
          ))}
        </select>
        <span className="hidden print:inline text-[11px] font-semibold" style={{ color: STATUS_COLOR[item.status] }}>
          {STATUS_LABEL[item.status]}
        </span>
      </td>
      <td className="px-3 py-2.5">
        <input
          type="email"
          placeholder="owner@company.com"
          className="print:hidden text-[11px] border border-cf-gray-200 rounded px-1.5 py-1 w-[150px]"
          value={ownerDraft}
          disabled={saving}
          onChange={(e) => setOwnerDraft(e.target.value)}
          onBlur={() => { if (ownerDraft !== (item.ownerEmail ?? "")) persist({ ownerEmail: ownerDraft || null }); }}
        />
        <span className="hidden print:inline text-[11px] text-cf-gray-600">{item.ownerEmail || "Unassigned"}</span>
        {err && <p className="text-[10px] text-red-500 mt-0.5 print:hidden">{err}</p>}
      </td>
    </tr>
  );
}

export default function ZTRemediationRegisterSection({ data }: { data: ZeroTrustData }) {
  const initial = data.remediationRegister ?? [];
  const [items, setItems] = useState<RemediationItem[]>(initial);
  if (initial.length === 0) return null;

  function handleChange(next: RemediationItem) {
    setItems((prev) => prev.map((it) => (it.id === next.id ? next : it)));
  }

  const active = items.filter((i) => i.status !== "resolved").sort((a, b) => {
    const order = { high: 0, medium: 1, low: 2 } as Record<string, number>;
    return (order[a.severity] ?? 3) - (order[b.severity] ?? 3);
  });
  const resolved = items.filter((i) => i.status === "resolved");

  const openCount = active.filter((i) => i.status === "open").length;
  const highCount = active.filter((i) => i.severity === "high").length;

  return (
    <section className="report-section">
      <SectionHeader icon={<ClipboardList size={20}/>} title="Remediation Register"
        subtitle="Findings tracked across report runs — age since first detected, status, and owner. Auto-resolves when the underlying condition clears; recurrence is preserved as history, not silently reopened." />

      <div className="flex flex-wrap gap-3 mb-4">
        <div className="flex items-center gap-2 bg-red-50 border border-red-100 rounded-full px-3 py-1.5">
          <ShieldAlert size={13} className="text-red-500"/>
          <span className="text-xs font-semibold text-red-700">{highCount} High Severity Open</span>
        </div>
        <div className="flex items-center gap-2 bg-yellow-50 border border-yellow-100 rounded-full px-3 py-1.5">
          <AlertTriangle size={13} className="text-yellow-600"/>
          <span className="text-xs font-semibold text-yellow-700">{openCount} Open</span>
        </div>
        <div className="flex items-center gap-2 bg-green-50 border border-green-100 rounded-full px-3 py-1.5">
          <CheckCircle2 size={13} className="text-green-600"/>
          <span className="text-xs font-semibold text-green-700">{resolved.length} Resolved (history)</span>
        </div>
      </div>

      {active.length > 0 && (
        <div className="bg-white rounded-xl shadow-sm border border-cf-gray-200 overflow-hidden mb-4">
          <table className="w-full text-xs">
            <thead>
              <tr className="bg-cf-gray-50 text-cf-gray-500 uppercase tracking-wide text-[10px]">
                <th className="px-3 py-2 text-left font-semibold">Severity</th>
                <th className="px-3 py-2 text-left font-semibold">Finding</th>
                <th className="px-3 py-2 text-left font-semibold">Age</th>
                <th className="px-3 py-2 text-left font-semibold">Status</th>
                <th className="px-3 py-2 text-left font-semibold">Owner</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-cf-gray-100">
              {active.map((item) => <RegisterRow key={item.id} item={item} onChange={handleChange} />)}
            </tbody>
          </table>
        </div>
      )}

      {resolved.length > 0 && (
        <details className="bg-white rounded-xl shadow-sm border border-cf-gray-200 overflow-hidden">
          <summary className="px-4 py-2.5 text-xs font-semibold text-cf-gray-600 cursor-pointer">
            Resolved History ({resolved.length})
          </summary>
          <table className="w-full text-xs border-t border-cf-gray-100">
            <tbody className="divide-y divide-cf-gray-100">
              {resolved.map((item) => (
                <tr key={item.id}>
                  <td className="px-4 py-2 text-cf-gray-600">{item.title}</td>
                  <td className="px-4 py-2 text-cf-gray-400 text-[11px] whitespace-nowrap">
                    resolved {item.resolvedAt ? new Date(item.resolvedAt).toLocaleDateString() : "—"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </details>
      )}
    </section>
  );
}
