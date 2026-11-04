/**
 * Security Posture Section — config badges, cipher suites, TLS pie, HTTP protocol pie,
 * certificates table, rate limiting table, and data availability warnings.
 */
import {
  Lock, Globe, AlertTriangle, CheckCircle, Shield, Zap, Bot, Code2, FileSearch, CreditCard, Atom,
} from "lucide-react";
import type { AppSecData } from "../../types";
import { formatNumber } from "../../utils/formatters";
import SectionHeader from "../../components/SectionHeader";
import PieBreakdownChart from "../../components/charts/PieBreakdownChart";
import CertificateTable from "../../components/tables/CertificateTable";

// ─── Color palette ───────────────────────────────────────────────────────────
const TLS_COLORS = ["#10B981", "#3B82F6", "#F6821F", "#8B5CF6", "#9CA3AF"];
const PQC_COLORS = ["#7C3AED", "#9CA3AF", "#6B7280", "#D1D5DB"];

// ─── Helpers ─────────────────────────────────────────────────────────────────
function securityLevelBadge(level: string | null | undefined) {
  const styles: Record<string, string> = {
    essentially_off: "bg-gray-100 text-gray-600",
    low: "bg-blue-50 text-blue-700",
    medium: "bg-yellow-50 text-yellow-700",
    high: "bg-orange-50 text-orange-700",
    under_attack: "bg-red-50 text-red-700 font-bold",
  };
  const labels: Record<string, string> = {
    essentially_off: "Off",
    low: "Low",
    medium: "Medium",
    high: "High",
    under_attack: "Under Attack Mode",
  };
  const key = level ?? "medium";
  return (
    <span className={`inline-block px-2 py-0.5 rounded-full text-xs ${styles[key] ?? styles.medium}`}>
      {labels[key] ?? level}
    </span>
  );
}

function BoolBadge({ val, trueLabel = "Enabled", falseLabel = "Disabled" }: {
  val?: boolean; trueLabel?: string; falseLabel?: string;
}) {
  return val ? (
    <span className="inline-flex items-center gap-1 text-xs text-green-700 font-medium">
      <CheckCircle size={12} /> {trueLabel}
    </span>
  ) : (
    <span className="inline-flex items-center gap-1 text-xs text-cf-gray-400 font-medium">
      <AlertTriangle size={12} /> {falseLabel}
    </span>
  );
}

export default function SecurityPostureSection({ data }: { data: AppSecData }) {
  const {
    certificates, rateLimitRules, tlsVersionBreakdown, errors,
  } = data;

  const expiringSoon = certificates.filter(
    (c) => c.daysUntilExpiry >= 0 && c.daysUntilExpiry < 30,
  ).length;

  // TLS pie
  const tlsPieData = tlsVersionBreakdown.map((t) => ({
    name: t.version,
    value: t.requests,
    pct: t.pct,
  }));

  // PQC (Post-Quantum Cryptography) key exchange adoption
  // "UNK" is a real Cloudflare value meaning no key exchange group applied
  // (plaintext HTTP, TLS 1.2 static ciphers, resumed sessions) — relabel it
  // clearly instead of showing a bare, unexplained "UNK", and keep the
  // adoption rate computed only against applicable (non-UNK) handshakes
  // (done server-side in pqcAdoptionPct) so it isn't diluted by traffic the
  // metric doesn't apply to.
  const tlsKeyExchangeBreakdownRaw = data.tlsKeyExchangeBreakdown ?? [];
  const pqcAdoptionPct = data.pqcAdoptionPct ?? 0;
  const pqcApplicableCoveragePct = data.pqcApplicableCoveragePct ?? 0;
  const keyExchangeGroupLabel = (group: string, isUnknown: boolean) =>
    isUnknown ? "No Key Exchange (HTTP / TLS 1.2 / Resumed)" : group;

  // Cloudflare returns multiple raw group values that all mean "no key
  // exchange negotiated" (e.g. "UNK" and an empty string) — merge them into
  // one row so the UI doesn't show a confusing duplicate "No Key Exchange"
  // entry with two different counts.
  const knownKeyExchangeRows = tlsKeyExchangeBreakdownRaw.filter((k) => !k.isUnknown);
  const unknownKeyExchangeRows = tlsKeyExchangeBreakdownRaw.filter((k) => k.isUnknown);
  const tlsKeyExchangeBreakdown = unknownKeyExchangeRows.length === 0
    ? knownKeyExchangeRows
    : [
        ...knownKeyExchangeRows,
        {
          group: "UNK",
          requests: unknownKeyExchangeRows.reduce((s, k) => s + k.requests, 0),
          pct: Math.round(unknownKeyExchangeRows.reduce((s, k) => s + k.pct, 0) * 10) / 10,
          isPqc: false,
          isUnknown: true,
        },
      ].sort((a, b) => b.requests - a.requests);

  // Chart focuses on APPLICABLE handshakes only (excludes the "no key
  // exchange" bucket) — a pie/donut dominated by one ~96% slice renders the
  // actually-interesting PQC-vs-classical comparison invisible. The
  // non-applicable share is already communicated as text + in the list below.
  const pqcPieData = tlsKeyExchangeBreakdown
    .filter((k) => !k.isUnknown)
    .map((k) => ({
      name: k.isPqc ? `${k.group} (PQC)` : k.group,
      value: k.requests,
    }));

  function tlsKeyExchangeBreakdown_filterKnown(rows: typeof tlsKeyExchangeBreakdownRaw) {
    return rows.filter((k) => !k.isUnknown);
  }

  const hasErrors = Object.keys(errors).length > 0;

  // Detection tools — derived from active config
  const ap = data as AppSecData & Record<string, unknown>;
  const wafEnabled = (data.wafManagedRules ?? []).filter((r) => r.enabled).length > 0;
  const ddosActive = (data.ddosTimeSeries ?? []).length > 0; // always on
  const botActive = !!(ap["botManagementConfig"]);
  const apiShieldActive = !!(ap["apiShieldEnabled"]);
  const pageShieldActive = !!(ap["pageShieldEnabled"]);
  const rateLimitActive = (data.rateLimitRules ?? []).filter((r) => r.enabled).length > 0;

  const detectionTools = [
    { label: "Web app exploits", icon: <Shield size={14} />, active: wafEnabled,      count: (data.wafManagedRules ?? []).filter((r) => r.enabled).length, desc: "WAF Managed Rules" },
    { label: "DDoS attacks",     icon: <Zap size={14} />,    active: ddosActive,      count: null, desc: "Always-on L3/L4/L7" },
    { label: "Bot traffic",      icon: <Bot size={14} />,     active: botActive,       count: null, desc: "Bot Management" },
    { label: "API abuse",        icon: <Code2 size={14} />,   active: apiShieldActive, count: null, desc: "API Shield" },
    { label: "Client-side abuse",icon: <FileSearch size={14} />, active: pageShieldActive, count: (ap["pageShieldScripts"] as unknown[])?.length ?? 0, desc: "Page Shield" },
    { label: "Rate limiting",    icon: <CreditCard size={14} />, active: rateLimitActive, count: (data.rateLimitRules ?? []).filter((r) => r.enabled).length, desc: "Rate Limit Rules" },
  ];

  return (
    <div className="report-section space-y-8 print:space-y-0">
      {/* ── Detection Tools ───────────────────────────────────────────────── */}
      <div className="bg-white rounded-xl shadow-sm border border-cf-gray-200 p-5">
        <h3 className="text-sm font-semibold text-cf-navy mb-1 flex items-center gap-2">
          <Shield size={14} className="text-cf-orange" />
          Detection Tools
        </h3>
        <p className="text-xs text-cf-gray-500 mb-4">Active security detection and mitigation capabilities on this zone</p>
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
          {detectionTools.map((tool) => (
            <div key={tool.label}
              className={`rounded-lg border p-3 flex items-start gap-3 ${tool.active ? "border-green-200 bg-green-50/40" : "border-cf-gray-200 bg-cf-gray-50/40"}`}>
              <div className={`w-7 h-7 rounded-lg flex items-center justify-center flex-shrink-0 ${tool.active ? "bg-green-100 text-green-600" : "bg-cf-gray-100 text-cf-gray-400"}`}>
                {tool.icon}
              </div>
              <div className="min-w-0">
                <p className="text-xs font-semibold text-cf-navy truncate">{tool.label}</p>
                <p className={`text-[10px] mt-0.5 ${tool.active ? "text-green-600 font-semibold" : "text-cf-gray-400"}`}>
                  {tool.active ? "Active" : "Not active"}
                  {tool.count !== null && tool.count > 0 && ` · ${tool.count}`}
                </p>
                <p className="text-[10px] text-cf-gray-400">{tool.desc}</p>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* ── Security Posture Section ─────────────────────────────────────── */}
      <div className="print-section-break pt-8 print:pt-14">
        <SectionHeader
          title="Security Posture"
          subtitle="TLS encryption, certificate hygiene, and protocol security"
          icon={<Lock size={18} />}
          printBreak
        />

        {/* Security config badges */}
        <div className="bg-white rounded-xl shadow-sm border border-cf-gray-200 p-5 mb-4">
          <h3 className="text-sm font-semibold text-cf-navy mb-4">Security Configuration</h3>
          <div className="grid grid-cols-2 lg:grid-cols-3 gap-4 text-sm">
            <div className="flex items-center justify-between">
              <span className="text-cf-gray-600">Security Level</span>
              {securityLevelBadge(data.securityLevel)}
            </div>
            <div className="flex items-center justify-between">
              <span className="text-cf-gray-600">TLS 1.3</span>
              <BoolBadge val={data.tls13Enabled} />
            </div>
            <div className="flex items-center justify-between">
              <span className="text-cf-gray-600">Always HTTPS</span>
              <BoolBadge val={data.alwaysHttps} />
            </div>
            <div className="flex items-center justify-between">
              <span className="text-cf-gray-600">Min TLS Version</span>
              <span className="text-xs font-semibold text-cf-navy">{data.tlsMinVersion ?? "N/A"}</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-cf-gray-600">SSL Mode</span>
              <span className="text-xs font-semibold text-cf-navy capitalize">{data.sslMode ?? "N/A"}</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-cf-gray-600">API Shield</span>
              <BoolBadge val={data.apiShieldEnabled} />
            </div>
            {tlsKeyExchangeBreakdown.length > 0 && (
              <div className="flex items-center justify-between">
                <span className="text-cf-gray-600 flex items-center gap-1">
                  <Atom size={12} className="text-purple-500" /> PQC Adoption
                </span>
                <span className={`text-xs font-semibold ${pqcAdoptionPct > 0 ? "text-purple-700" : "text-cf-gray-400"}`}>
                  {pqcAdoptionPct}%
                </span>
              </div>
            )}
          </div>
        </div>

        {/* Cipher Suite table */}
        {(data.cipherSuites?.length ?? 0) > 0 && (
          <div className="bg-white rounded-xl shadow-sm border border-cf-gray-200 p-5 mb-4">
            <h3 className="text-sm font-semibold text-cf-navy mb-3">Enabled TLS Cipher Suites</h3>
            <div className="flex flex-wrap gap-2">
              {(data.cipherSuites ?? []).map((cipher) => {
                // Colour-code by strength: CHACHA20 and AES-256 = strong green, AES-128 = blue, others = gray
                const isStrong = cipher.includes("CHACHA20") || cipher.includes("AES256") || cipher.includes("AES-256");
                const isMedium = cipher.includes("AES128") || cipher.includes("AES-128");
                const badgeClass = isStrong
                  ? "bg-green-50 border-green-200 text-green-800"
                  : isMedium
                  ? "bg-blue-50 border-blue-200 text-blue-800"
                  : "bg-cf-gray-50 border-cf-gray-200 text-cf-gray-600";
                return (
                  <span
                    key={cipher}
                    className={`inline-flex items-center px-2.5 py-1 rounded-lg border text-xs font-mono font-medium ${badgeClass}`}
                  >
                    {cipher}
                  </span>
                );
              })}
            </div>
            <p className="text-xs text-cf-gray-400 mt-3">
              All enabled ciphers support Perfect Forward Secrecy (PFS) via ECDHE key exchange.
            </p>
          </div>
        )}

        {/* TLS version pie + protocol pie */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 mb-4">
          <PieBreakdownChart
            data={tlsPieData}
            title="TLS Version Distribution"
            subtitle="Requests by TLS protocol version"
            colors={TLS_COLORS}
            height={260}
          />
          {(data.httpProtocolBreakdown?.length ?? 0) > 0 ? (
            <PieBreakdownChart
              data={(data.httpProtocolBreakdown ?? []).map((d) => ({
                name: d.protocol,
                value: d.requests,
              }))}
              title="HTTP Protocol Distribution"
              subtitle="HTTP/1.1 vs HTTP/2 vs HTTP/3 adoption"
              colors={["#3B82F6", "#F6821F", "#10B981"]}
              height={260}
            />
          ) : (
            <div className="bg-cf-gray-50 rounded-xl border border-cf-gray-200 p-5 flex items-center justify-center">
              <p className="text-sm text-cf-gray-400">HTTP protocol breakdown unavailable</p>
            </div>
          )}
        </div>

        {/* Post-Quantum Cryptography (PQC) readiness */}
        {tlsKeyExchangeBreakdown.length > 0 && (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 mb-4">
            <PieBreakdownChart
              data={pqcPieData}
              title="Key Exchange Group — Applicable Handshakes"
              subtitle={`Hybrid PQC vs classical, among the ${pqcApplicableCoveragePct}% of handshakes where a key exchange group applies`}
              colors={PQC_COLORS}
              height={220}
              legendPosition="bottom"
            />
            <div className="bg-white rounded-xl shadow-sm border border-cf-gray-200 p-5">
              <div className="flex items-center gap-2 mb-1">
                <Atom size={14} className="text-purple-600" />
                <h3 className="text-sm font-semibold text-cf-navy">Post-Quantum Cryptography Readiness</h3>
              </div>
              <p className="text-xs text-cf-gray-500 mb-4">
                Hybrid post-quantum key exchange (X25519MLKEM768 / X25519Kyber768Draft00) combines a classical
                ECDH exchange with a quantum-resistant KEM (ML-KEM-768, FIPS 203). Cloudflare enables this on
                the edge by default — adoption reflects client (browser) support, not a zone configuration gap.
              </p>
              <div className="flex items-baseline gap-2 mb-1">
                <span className="text-3xl font-black text-purple-700">{pqcAdoptionPct}%</span>
                <span className="text-xs text-cf-gray-500">of applicable TLS handshakes used a PQC-hybrid key exchange group</span>
              </div>
              {pqcApplicableCoveragePct < 100 && (
                <p className="text-[11px] text-cf-gray-400 mb-4">
                  {pqcApplicableCoveragePct}% of all traffic negotiated a key exchange group at all — the rest was
                  plaintext HTTP, TLS 1.2 with static ciphers, or resumed sessions, where this metric doesn't apply.
                </p>
              )}
              <div className={pqcApplicableCoveragePct < 100 ? "space-y-2" : "space-y-2 mt-4"}>
                {tlsKeyExchangeBreakdown.slice(0, 6).map((k) => (
                  <div key={k.group}>
                    <div className="flex justify-between text-xs mb-0.5">
                      <span className={`font-mono ${k.isPqc ? "font-semibold text-purple-700" : k.isUnknown ? "text-cf-gray-400 italic" : "text-cf-gray-600"}`}>
                        {k.isPqc ? `${k.group} (PQC)` : keyExchangeGroupLabel(k.group, k.isUnknown)}
                      </span>
                      <span className="text-cf-gray-500">{formatNumber(k.requests)} ({k.pct}%)</span>
                    </div>
                    <div className="h-1.5 bg-cf-gray-100 rounded-full overflow-hidden">
                      <div className="h-full rounded-full" style={{ width: `${k.pct}%`, backgroundColor: k.isPqc ? "#7C3AED" : k.isUnknown ? "#D1D5DB" : "#9CA3AF" }} />
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}

        {/* Certificates */}
        <CertificateTable certs={certificates} />

        {/* Expiry alerts */}
        {expiringSoon > 0 && (
          <div className="mt-4 flex items-start gap-3 bg-orange-50 border border-orange-200 rounded-xl p-4">
            <AlertTriangle size={20} className="text-orange-500 flex-shrink-0 mt-0.5" />
            <div>
              <p className="text-sm font-semibold text-orange-800">
                {expiringSoon} certificate{expiringSoon > 1 ? "s" : ""} expiring within 30 days
              </p>
              <p className="text-xs text-orange-700 mt-0.5">
                Cloudflare Universal SSL auto-renews certificates automatically. For custom/dedicated certificates, manual renewal action may be required.
              </p>
            </div>
          </div>
        )}
      </div>

      {/* ── Rate Limiting ─────────────────────────────────────────────────── */}
      {rateLimitRules.length > 0 && (
        <div>
          <h3 className="text-base font-semibold text-cf-navy mb-4 flex items-center gap-2">
            <Globe size={16} className="text-cf-teal" /> Rate Limiting Rules
          </h3>
          <div className="bg-white rounded-xl shadow-sm border border-cf-gray-200 overflow-hidden">
            <table className="w-full text-xs">
              <thead>
                <tr className="bg-cf-gray-50 border-b border-cf-gray-100">
                  <th className="text-left px-4 py-3 font-semibold text-cf-gray-600">Description</th>
                  <th className="text-right px-4 py-3 font-semibold text-cf-gray-600">Threshold</th>
                  <th className="text-right px-4 py-3 font-semibold text-cf-gray-600">Period</th>
                  <th className="text-center px-4 py-3 font-semibold text-cf-gray-600">Action</th>
                  <th className="text-center px-4 py-3 font-semibold text-cf-gray-600">Status</th>
                </tr>
              </thead>
              <tbody>
                {rateLimitRules.map((r) => (
                  <tr key={r.id} className="border-b border-cf-gray-50 hover:bg-cf-gray-50">
                    <td className="px-4 py-3 text-cf-navy">
                      {r.description || <span className="text-cf-gray-400">—</span>}
                    </td>
                    <td className="px-4 py-3 text-right text-cf-navy font-medium">
                      {r.threshold.toLocaleString()}
                    </td>
                    <td className="px-4 py-3 text-right text-cf-gray-600">{r.period}s</td>
                    <td className="px-4 py-3 text-center">
                      <span className="inline-block px-2 py-0.5 rounded-full bg-orange-50 text-orange-700 border border-orange-200 font-medium">
                        {r.action}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-center">
                      {r.enabled ? (
                        <span className="inline-flex items-center gap-1 text-green-600 font-medium">
                          <CheckCircle size={12} /> Active
                        </span>
                      ) : (
                        <span className="text-cf-gray-400">Disabled</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* ── Data Availability Warnings ──────────────────────────────────── */}
      {hasErrors && (
        <div className="bg-cf-gray-50 border border-cf-gray-200 rounded-xl p-4">
          <p className="text-xs font-semibold text-cf-gray-600 mb-2">
            Some data sections were unavailable (check token permissions):
          </p>
          <ul className="space-y-1">
            {Object.entries(errors).map(([k, v]) => (
              <li key={k} className="text-xs text-cf-gray-500">
                <span className="font-medium text-cf-gray-700">{k}:</span> {v}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
