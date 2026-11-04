/**
 * ZTAlertRegisterSection — Alert Investigation Register
 *
 * Cloudflare's own native security/operational alert history (REST
 * /accounts/{id}/alerting/v3/history) was already being fetched into
 * ZeroTrustData.recentAlerts but never rendered anywhere in the report — a
 * dead dataset. This gives it an investigation workflow: each alert is
 * durably tracked (D1) and can be assigned an owner and moved through
 * New -> Acknowledged -> Investigating -> Resolved, mirroring the
 * incident-lifecycle reporting pattern used in Zscaler/Prisma/Netskope
 * (alert volume, disposition, ownership) without requiring a separate
 * SIEM/SOAR integration.
 */
import { useState } from "react";
import { BellRing, Clock } from "lucide-react";
import type { ZeroTrustData, AlertTrackingItem, AlertTrackingStatus } from "../../types";
import SectionHeader from "../../components/SectionHeader";
import { updateAlertItem } from "../../services/api";

const STATUS_LABEL: Record<AlertTrackingStatus, string> = {
  new: "New", acknowledged: "Acknowledged", investigating: "Investigating", resolved: "Resolved",
};
const STATUS_COLOR: Record<AlertTrackingStatus, string> = {
  new: "#EF4444", acknowledged: "#F59E0B", investigating: "#3B82F6", resolved: "#10B981",
};

function AlertRow({ item, onChange }: { item: AlertTrackingItem; onChange: (next: AlertTrackingItem) => void }) {
  const [ownerDraft, setOwnerDraft] = useState(item.ownerEmail ?? "");
  const [saving, setSaving] = useState(false);

  async function persist(update: Parameters<typeof updateAlertItem>[1]) {
    setSaving(true);
    try {
      const updated = await updateAlertItem(item.id, update);
      onChange(updated);
    } catch { /* silent — UI simply doesn't reflect the change */ }
    finally { setSaving(false); }
  }

  return (
    <tr className="align-top">
      <td className="px-3 py-2.5 max-w-[260px]">
        <p className="text-xs font-semibold text-cf-navy leading-snug">{item.name}</p>
        <p className="text-[10px] text-cf-gray-500 mt-0.5">{item.alertType}{item.silenced ? " · Silenced" : ""}</p>
      </td>
      <td className="px-3 py-2.5 text-[11px] text-cf-gray-600 whitespace-nowrap">
        {new Date(item.sentAt).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" })}
      </td>
      <td className="px-3 py-2.5 text-[11px] text-cf-gray-600 whitespace-nowrap">
        <div className="flex items-center gap-1"><Clock size={10} className="text-cf-gray-400"/>{item.ageDays}d</div>
      </td>
      <td className="px-3 py-2.5">
        <select
          className="print:hidden text-[11px] border border-cf-gray-200 rounded px-1.5 py-1 bg-white"
          value={item.status}
          disabled={saving}
          onChange={(e) => persist({ status: e.target.value as AlertTrackingStatus })}
        >
          {(Object.keys(STATUS_LABEL) as AlertTrackingStatus[]).map((s) => (
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
      </td>
    </tr>
  );
}

export default function ZTAlertRegisterSection({ data }: { data: ZeroTrustData }) {
  const initial = data.alertRegister ?? [];
  const [items, setItems] = useState<AlertTrackingItem[]>(initial);
  if (initial.length === 0) return null;

  function handleChange(next: AlertTrackingItem) {
    setItems((prev) => prev.map((it) => (it.id === next.id ? next : it)));
  }

  const open = items.filter((i) => i.status !== "resolved");
  const resolved = items.filter((i) => i.status === "resolved");
  const newCount = items.filter((i) => i.status === "new").length;

  return (
    <section className="report-section">
      <SectionHeader icon={<BellRing size={20}/>} title="Alert Investigation Register"
        subtitle="Native Cloudflare security/operational alerts, tracked with an investigation workflow — status, owner, and time since first seen" />

      <div className="flex flex-wrap gap-3 mb-4">
        <div className="flex items-center gap-2 bg-red-50 border border-red-100 rounded-full px-3 py-1.5">
          <BellRing size={13} className="text-red-500"/>
          <span className="text-xs font-semibold text-red-700">{newCount} New / Unacknowledged</span>
        </div>
        <div className="flex items-center gap-2 bg-green-50 border border-green-100 rounded-full px-3 py-1.5">
          <span className="text-xs font-semibold text-green-700">{resolved.length} Resolved</span>
        </div>
      </div>

      {open.length > 0 && (
        <div className="bg-white rounded-xl shadow-sm border border-cf-gray-200 overflow-hidden mb-4">
          <table className="w-full text-xs">
            <thead>
              <tr className="bg-cf-gray-50 text-cf-gray-500 uppercase tracking-wide text-[10px]">
                <th className="px-3 py-2 text-left font-semibold">Alert</th>
                <th className="px-3 py-2 text-left font-semibold">Sent</th>
                <th className="px-3 py-2 text-left font-semibold">Age</th>
                <th className="px-3 py-2 text-left font-semibold">Status</th>
                <th className="px-3 py-2 text-left font-semibold">Owner</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-cf-gray-100">
              {open.map((item) => <AlertRow key={item.id} item={item} onChange={handleChange} />)}
            </tbody>
          </table>
        </div>
      )}

      {resolved.length > 0 && (
        <details className="bg-white rounded-xl shadow-sm border border-cf-gray-200 overflow-hidden">
          <summary className="px-4 py-2.5 text-xs font-semibold text-cf-gray-600 cursor-pointer">
            Resolved ({resolved.length})
          </summary>
          <table className="w-full text-xs border-t border-cf-gray-100">
            <tbody className="divide-y divide-cf-gray-100">
              {resolved.map((item) => (
                <tr key={item.id}>
                  <td className="px-4 py-2 text-cf-gray-600">{item.name}</td>
                  <td className="px-4 py-2 text-cf-gray-400 text-[11px] whitespace-nowrap">
                    {new Date(item.sentAt).toLocaleDateString()}
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
