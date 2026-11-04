/**
 * ZoneSettingsSection — Enhanced Zone Settings Audit
 * Parses the full /settings bulk endpoint to show:
 *   - Security settings (HSTS, browser integrity, email obfuscation, hotlink)
 *   - Performance settings (Brotli, HTTP/2, HTTP/3, 0-RTT, Early Hints, Polish, WebP)
 *   - Enterprise-only features active callout box
 */
import { Settings2, Zap, Star } from "lucide-react";
import type { AppSecData } from "../../types";
import SectionHeader from "../../components/SectionHeader";

interface Props { data: AppSecData }

type OnOff = "on" | "off" | "lossless" | "lossy" | "webp" | "basic" | string | boolean | null | undefined;

function isOn(v: OnOff): boolean {
  return v === "on" || v === true || v === "zrt" || v === "1";
}

function Badge({ value, label }: { value: OnOff; label: string }) {
  const active = isOn(value);
  return (
    <div className="flex items-center justify-between py-2 border-b border-cf-gray-50 last:border-0">
      <span className="text-xs text-cf-gray-600">{label}</span>
      <span className={`inline-block px-2 py-0.5 rounded-full text-[10px] font-semibold ${
        active
          ? "bg-green-50 text-green-700 border border-green-200"
          : "bg-cf-gray-100 text-cf-gray-500 border border-cf-gray-200"
      }`}>
        {typeof value === "string" && !["on","off"].includes(value) ? value : (active ? "Enabled" : "Disabled")}
      </span>
    </div>
  );
}

export default function ZoneSettingsSection({ data }: Props) {
  const s = data.zoneSettings ?? {};

  const hasData = Object.keys(s).length > 0;
  if (!hasData) return null;

  // ── Enterprise-only feature detection ────────────────────────────────────
  const enterpriseFeatures: { name: string; enabled: boolean; desc: string }[] = [
    { name: "TLS Client Auth (mTLS)",      enabled: isOn(s["tls_client_auth"] as OnOff),         desc: "Mutual TLS for origin authentication" },
    { name: "True Client IP Header",        enabled: isOn(s["true_client_ip_header"] as OnOff),   desc: "Preserves original client IP behind CF (Akamai migration)" },
    { name: "Origin Error Page Pass-Thru",  enabled: isOn(s["origin_error_page_pass_thru"] as OnOff), desc: "Passes origin error pages directly to visitors" },
    { name: "Proxy Read Timeout",           enabled: !!(s["proxy_read_timeout"]),                 desc: `Custom timeout: ${s["proxy_read_timeout"] ?? "default"}s` },
    { name: "Sort Query String for Cache",  enabled: isOn(s["sort_query_string_for_cache"] as OnOff), desc: "Normalizes query strings to improve cache hit rate" },
    { name: "H2 Prioritization",            enabled: isOn(s["h2_prioritization"] as OnOff),       desc: "HTTP/2 server push prioritization" },
    { name: "Prefetch Preload",             enabled: isOn(s["prefetch_preload"] as OnOff),         desc: "Prefetches linked resources in HTML" },
    { name: "Response Buffering",           enabled: isOn(s["response_buffering"] as OnOff),       desc: "Buffers origin responses at edge" },
    { name: "Image Resizing",               enabled: isOn(s["image_resizing"] as OnOff),           desc: "On-demand image resizing and format conversion" },
  ];
  const enterpriseActive = enterpriseFeatures.filter((f) => f.enabled);

  // ── HSTS config ───────────────────────────────────────────────────────────
  const hsts = s["security_header"] as { strict_transport_security?: { enabled?: boolean; max_age?: number; include_subdomains?: boolean; preload?: boolean; nosniff?: boolean } } | null | undefined;
  const hstsConfig = hsts?.strict_transport_security;

  return (
    <section className="report-section">
      <SectionHeader
        icon={<Settings2 size={20} />}
        title="Zone Settings Audit"
        subtitle="Security hardening, performance optimizations, and Enterprise-exclusive features"
        printBreak
      />

      <div className="space-y-4">
        {/* ── Enterprise Features Active ─────────────────────────────────── */}
        {enterpriseActive.length > 0 && (
          <div className="bg-gradient-to-r from-cf-orange/10 to-orange-50 rounded-xl border border-cf-orange/30 p-5">
            <div className="flex items-center gap-2 mb-3">
              <Star size={16} className="text-cf-orange" />
              <h3 className="text-sm font-bold text-cf-navy">Enterprise-Only Features Active ({enterpriseActive.length})</h3>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              {enterpriseActive.map((f) => (
                <div key={f.name} className="flex items-start gap-2 bg-white/60 rounded-lg px-3 py-2">
                  <span className="w-1.5 h-1.5 rounded-full bg-cf-orange flex-shrink-0 mt-1.5" />
                  <div>
                    <p className="text-xs font-semibold text-cf-navy">{f.name}</p>
                    <p className="text-[10px] text-cf-gray-500">{f.desc}</p>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
          {/* ── Security Settings ────────────────────────────────────────── */}
          <div className="bg-white rounded-xl shadow-sm border border-cf-gray-200 p-5">
            <h3 className="text-sm font-semibold text-cf-navy mb-3">Security Hardening</h3>
            <Badge value={s["browser_check"] as OnOff} label="Browser Integrity Check" />
            <Badge value={s["email_obfuscation"] as OnOff} label="Email Obfuscation" />
            <Badge value={s["hotlink_protection"] as OnOff} label="Hotlink Protection" />
            <Badge value={s["server_side_exclude"] as OnOff} label="Server Side Excludes" />
            <Badge value={s["waf"] as OnOff} label="WAF (Legacy)" />
            <Badge value={s["security_level"] as OnOff} label={`Security Level: ${s["security_level"] ?? "N/A"}`} />
            <Badge value={s["challenge_ttl"] as OnOff} label={`Challenge TTL: ${s["challenge_ttl"] ?? "N/A"}s`} />
            <Badge value={s["privacy_pass"] as OnOff} label="Privacy Pass Support" />

            {/* HSTS */}
            {hstsConfig && (
              <div className="mt-3 pt-3 border-t border-cf-gray-100">
                <p className="text-[10px] font-semibold text-cf-gray-500 uppercase tracking-wide mb-2">HSTS Configuration</p>
                <Badge value={hstsConfig.enabled ? "on" : "off"} label="HSTS Enabled" />
                {hstsConfig.enabled && (
                  <>
                    <Badge value={`${((hstsConfig.max_age ?? 0) / 86400 / 365).toFixed(0)}yr`} label="Max Age" />
                    <Badge value={hstsConfig.include_subdomains ? "on" : "off"} label="Include Subdomains" />
                    <Badge value={hstsConfig.preload ? "on" : "off"} label="Preload" />
                    <Badge value={hstsConfig.nosniff ? "on" : "off"} label="nosniff" />
                  </>
                )}
              </div>
            )}
          </div>

          {/* ── Performance Settings ─────────────────────────────────────── */}
          <div className="bg-white rounded-xl shadow-sm border border-cf-gray-200 p-5">
            <div className="flex items-center gap-2 mb-3">
              <Zap size={14} className="text-cf-orange" />
              <h3 className="text-sm font-semibold text-cf-navy">Performance</h3>
            </div>
            <Badge value={s["http2"] as OnOff} label="HTTP/2" />
            <Badge value={s["http3"] as OnOff} label="HTTP/3 (QUIC)" />
            <Badge value={s["0rtt"] as OnOff} label="0-RTT Connection Resumption" />
            <Badge value={s["early_hints"] as OnOff} label="Early Hints (103)" />
            <Badge value={s["brotli"] as OnOff} label="Brotli Compression" />
            <Badge value={s["rocket_loader"] as OnOff} label="Rocket Loader" />
            <Badge value={(s["polish"] as string) || "off"} label={`Polish: ${s["polish"] ?? "off"}`} />
            <Badge value={s["webp"] as OnOff} label="WebP Conversion" />
            <Badge value={s["mirage"] as OnOff} label="Mirage (Mobile Images)" />
          </div>

          {/* ── Protocol & Origin Settings ────────────────────────────────── */}
          <div className="bg-white rounded-xl shadow-sm border border-cf-gray-200 p-5">
            <h3 className="text-sm font-semibold text-cf-navy mb-3">Protocol & Origin</h3>
            <Badge value={s["ipv6"] as OnOff} label="IPv6 Compatibility" />
            <Badge value={s["websockets"] as OnOff} label="WebSockets" />
            <Badge value={s["grpc"] as OnOff} label="gRPC" />
            <Badge value={s["orange_to_orange"] as OnOff} label="Orange-to-Orange (O2O)" />
            <Badge value={s["argo_smart_routing"] as OnOff} label="Argo Smart Routing" />
            <Badge value={s["always_online"] as OnOff} label="Always Online" />
            <Badge value={s["development_mode"] as OnOff} label="Development Mode" />
            <Badge value={s["automatic_https_rewrites"] as OnOff} label="Auto HTTPS Rewrites" />
            <Badge value={s["opportunistic_encryption"] as OnOff} label="Opportunistic Encryption" />
            <Badge value={s["pseudo_ipv4"] as OnOff} label={`Pseudo IPv4: ${s["pseudo_ipv4"] ?? "off"}`} />
          </div>
        </div>
      </div>
    </section>
  );
}
