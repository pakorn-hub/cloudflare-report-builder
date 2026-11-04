import { History } from "lucide-react";
import type { ZeroTrustData } from "../../types";
import SectionHeader from "../../components/SectionHeader";

const ACTION_COLORS: Record<string, string> = {
  create: "#10B981", update: "#3B82F6", delete: "#EF4444", view: "#9CA3AF",
};

const PRODUCT_LABELS: Record<string, string> = {
  access: "Access", gateway: "Gateway", teams: "Zero Trust", dlp: "DLP",
  casb: "CASB", warp: "WARP", zerotrust: "Zero Trust", zero_trust: "Zero Trust",
  tunnel: "Tunnel", cfd_tunnel: "Tunnel", dex: "DEX",
  waf_tls_client_certificates: "Client Certificates",
};

/**
 * Configuration changes made during the report period — real data from
 * REST /accounts/{id}/logs/audit, filtered to Zero-Trust-relevant products.
 * Answers "what changed" alongside "what happened" — the missing half of a
 * point-in-time telemetry report. Renders nothing if no ZT-relevant changes
 * occurred (a genuinely stable period, not a data gap).
 */
export default function ZTConfigChangesSection({ data }: { data: ZeroTrustData }) {
  const changes = data.configChanges ?? [];
  if (changes.length === 0) return null;

  const byProduct = new Map<string, number>();
  for (const c of changes) byProduct.set(c.product, (byProduct.get(c.product) ?? 0) + 1);

  return (
    <section className="report-section">
      <SectionHeader icon={<History size={20}/>} title="Configuration Changes"
        subtitle={`${changes.length} Zero-Trust-relevant configuration change${changes.length === 1 ? "" : "s"} in this period — who changed what, and when`} />
      <div className="flex flex-wrap gap-2 mb-4">
        {Array.from(byProduct.entries()).map(([product, count]) => (
          <span key={product} className="text-[11px] font-medium px-2.5 py-1 rounded-full bg-blue-50 text-blue-600">
            {PRODUCT_LABELS[product] ?? product}: {count}
          </span>
        ))}
      </div>
      <div className="bg-white rounded-xl shadow-sm border border-cf-gray-200 overflow-hidden">
        <div className="overflow-y-auto" style={{ maxHeight: 360 }}>
          <table className="w-full text-xs">
            <thead className="sticky top-0">
              <tr className="bg-cf-gray-50 text-cf-gray-500 uppercase tracking-wide text-[10px]">
                <th className="px-4 py-2 text-left font-semibold">When</th>
                <th className="px-4 py-2 text-left font-semibold">Actor</th>
                <th className="px-4 py-2 text-left font-semibold">Product</th>
                <th className="px-4 py-2 text-left font-semibold">Action</th>
                <th className="px-4 py-2 text-left font-semibold">Description</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-cf-gray-100">
              {changes.map((c) => (
                <tr key={c.id}>
                  <td className="px-4 py-1.5 font-mono text-cf-gray-500 text-[11px] whitespace-nowrap">
                    {c.time ? new Date(c.time).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" }) : "Unknown"}
                  </td>
                  <td className="px-4 py-1.5 font-mono text-cf-navy text-[11px] truncate max-w-[180px]">{c.actorEmail}</td>
                  <td className="px-4 py-1.5 text-[11px]">{PRODUCT_LABELS[c.product] ?? c.product}</td>
                  <td className="px-4 py-1.5 text-[11px]">
                    <span className="capitalize font-medium" style={{ color: ACTION_COLORS[c.actionType] ?? "#6B7280" }}>{c.actionType}</span>
                  </td>
                  <td className="px-4 py-1.5 text-cf-gray-600 text-[11px]">{c.description}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </section>
  );
}
