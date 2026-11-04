import clsx from "clsx";
import type { CertificateInfo } from "../../types";
import { formatDate, daysLabel, certStatusColor } from "../../utils/formatters";

interface Props {
  certs: CertificateInfo[];
}

const TYPE_LABEL: Record<string, string> = {
  universal: "Universal SSL",
  dedicated: "Dedicated",
  custom: "Custom",
  lets_encrypt: "Let's Encrypt",
  sni_custom: "SNI Custom",
};

const STATUS_STYLE: Record<string, string> = {
  active: "bg-green-50 text-green-700 border-green-200",
  pending_validation: "bg-yellow-50 text-yellow-700 border-yellow-200",
  pending_deployment: "bg-yellow-50 text-yellow-700 border-yellow-200",
  expired: "bg-red-50 text-red-700 border-red-200",
  deleted: "bg-gray-50 text-gray-500 border-gray-200",
};

export default function CertificateTable({ certs }: Props) {
  if (!certs.length) {
    return (
      <div className="bg-white rounded-xl shadow-sm border border-cf-gray-200 p-5">
        <p className="text-sm text-cf-gray-400 text-center py-4">No certificates found</p>
      </div>
    );
  }

  return (
    <div className="bg-white rounded-xl shadow-sm border border-cf-gray-200 overflow-hidden">
      <div className="px-5 py-4 border-b border-cf-gray-100">
        <h3 className="text-sm font-semibold text-cf-navy">SSL/TLS Certificates</h3>
        <p className="text-xs text-cf-gray-500 mt-0.5">
          {certs.length} certificate{certs.length !== 1 ? "s" : ""} found •{" "}
          {certs.filter((c) => c.daysUntilExpiry >= 0 && c.daysUntilExpiry < 30).length} expiring within 30 days
        </p>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-xs">
          <thead>
            <tr className="bg-cf-gray-50 border-b border-cf-gray-100">
              <th className="text-left px-4 py-3 font-semibold text-cf-gray-600">Hosts</th>
              <th className="text-left px-4 py-3 font-semibold text-cf-gray-600">Type</th>
              <th className="text-left px-4 py-3 font-semibold text-cf-gray-600">Status</th>
              <th className="text-left px-4 py-3 font-semibold text-cf-gray-600">Expires</th>
              <th className="text-right px-4 py-3 font-semibold text-cf-gray-600">Days Left</th>
            </tr>
          </thead>
          <tbody>
            {certs
              .sort((a, b) => a.daysUntilExpiry - b.daysUntilExpiry)
              .map((cert) => (
                <tr
                  key={cert.id}
                  className={clsx(
                    "border-b border-cf-gray-50 hover:bg-cf-gray-50 transition-colors",
                    cert.daysUntilExpiry < 0 && "bg-red-50",
                    cert.daysUntilExpiry >= 0 && cert.daysUntilExpiry < 7 && "bg-red-50",
                    cert.daysUntilExpiry >= 7 && cert.daysUntilExpiry < 30 && "bg-orange-50"
                  )}
                >
                  <td className="px-4 py-3">
                    <div className="flex flex-col gap-0.5">
                      {cert.hosts.slice(0, 3).map((h) => (
                        <span key={h} className="font-mono text-cf-navy">{h}</span>
                      ))}
                      {cert.hosts.length > 3 && (
                        <span className="text-cf-gray-400">+{cert.hosts.length - 3} more</span>
                      )}
                    </div>
                  </td>
                  <td className="px-4 py-3 text-cf-gray-600">
                    {TYPE_LABEL[cert.type] ?? cert.type}
                  </td>
                  <td className="px-4 py-3">
                    <span
                      className={clsx(
                        "inline-block px-2 py-0.5 rounded-full border text-xs font-medium",
                        STATUS_STYLE[cert.status] ?? "bg-gray-50 text-gray-600 border-gray-200"
                      )}
                    >
                      {cert.status.replace(/_/g, " ")}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-cf-gray-600">
                    {cert.expiresOn ? formatDate(cert.expiresOn) : "—"}
                  </td>
                  <td className={clsx("px-4 py-3 text-right font-semibold", certStatusColor(cert.daysUntilExpiry))}>
                    {daysLabel(cert.daysUntilExpiry)}
                  </td>
                </tr>
              ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
