/**
 * SpeedOptimizationSection — Speed settings and recommendations
 * Shows: Image Optimization, Content Optimization, Protocol Optimization
 * grouped into three recommendation panels, mirroring the Cloudflare dashboard
 * Speed tab structure.
 */
import { Zap, ImageIcon, FileText, Network, CheckCircle2, XCircle, Info } from "lucide-react";
import type { AppSecData } from "../../types";
import SectionHeader from "../../components/SectionHeader";

interface Props { data: AppSecData }

type SettingVal = string | boolean | null | undefined | Record<string, unknown>;

function isEnabled(v: SettingVal): boolean {
  if (v === "on" || v === true) return true;
  if (typeof v === "string" && !["off","disabled","0","false",""].includes(v.toLowerCase())) {
    if (v === "off" || v === "no") return false;
    if (v !== "") return true;
  }
  return false;
}

interface SettingRowProps {
  label: string;
  desc: string;
  value: SettingVal;
  display?: string;
  recommendation?: string;
}

function SettingRow({ label, desc, value, display, recommendation }: SettingRowProps) {
  const enabled = isEnabled(value);
  const showVal = display ?? (enabled ? "Enabled" : value === null || value === undefined ? "Not available" : "Disabled");
  return (
    <div className="flex items-start gap-3 py-3 border-b border-cf-gray-100 last:border-0">
      <div className="mt-0.5 flex-shrink-0">
        {enabled
          ? <CheckCircle2 size={14} className="text-green-500" />
          : <XCircle size={14} className="text-cf-gray-300" />}
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center justify-between gap-2">
          <p className="text-xs font-semibold text-cf-navy">{label}</p>
          <span className={`inline-block px-2 py-0.5 rounded-full text-[10px] font-semibold border flex-shrink-0 ${
            enabled
              ? "bg-green-50 text-green-700 border-green-200"
              : "bg-cf-gray-100 text-cf-gray-500 border-cf-gray-200"
          }`}>
            {showVal}
          </span>
        </div>
        <p className="text-[10px] text-cf-gray-500 mt-0.5">{desc}</p>
        {!enabled && recommendation && (
          <p className="text-[10px] text-blue-600 mt-1 flex items-center gap-1">
            <Info size={10} /> {recommendation}
          </p>
        )}
      </div>
    </div>
  );
}

export default function SpeedOptimizationSection({ data }: Props) {
  const s = data.zoneSettings ?? {};

  if (Object.keys(s).length === 0) return null;

  const sv = (k: string): SettingVal => s[k] as SettingVal;

  // ── Performance score (minify removed — deprecated by Cloudflare) ─────────
  const perfChecks = [
    isEnabled(sv("http2")),
    isEnabled(sv("http3")),
    isEnabled(sv("0rtt")),
    isEnabled(sv("brotli")),
    isEnabled(sv("early_hints")),
    isEnabled(sv("rocket_loader")),
    isEnabled(sv("webp")),
    isEnabled(sv("http2_prioritization") ?? sv("h2_prioritization")),
  ];
  const perfScore = Math.round((perfChecks.filter(Boolean).length / perfChecks.length) * 100);

  return (
    <section className="report-section">
      <SectionHeader
        icon={<Zap size={20} />}
        title="Speed Optimization"
        subtitle="Image optimization, content delivery, and protocol settings that affect your site's performance"
        printBreak
      />

      <div className="space-y-4">
        {/* Overall performance score */}
        <div className="bg-white rounded-xl shadow-sm border border-cf-gray-200 p-5 flex items-center gap-6">
          <div className="text-center">
            <div className={`w-20 h-20 rounded-full flex items-center justify-center text-2xl font-black border-4 mx-auto ${
              perfScore >= 75 ? "border-green-400 text-green-700 bg-green-50"
              : perfScore >= 50 ? "border-yellow-400 text-yellow-700 bg-yellow-50"
              : "border-red-400 text-red-700 bg-red-50"
            }`}>
              {perfScore}%
            </div>
            <p className="text-[10px] text-cf-gray-500 mt-2">Speed Score</p>
          </div>
          <div className="flex-1">
            <h3 className="text-sm font-semibold text-cf-navy">Performance Optimization Coverage</h3>
            <p className="text-xs text-cf-gray-500 mt-1">
              {perfChecks.filter(Boolean).length} of {perfChecks.length} recommended speed optimizations are active.
              {perfScore < 75 && " Enabling the remaining settings could significantly improve page load times."}
            </p>
            <div className="mt-3 w-full bg-cf-gray-100 rounded-full h-2 overflow-hidden">
              <div
                className={`h-full rounded-full ${perfScore >= 75 ? "bg-green-500" : perfScore >= 50 ? "bg-yellow-500" : "bg-red-500"}`}
                style={{ width: `${perfScore}%` }}
              />
            </div>
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
          {/* ── Image Optimization ────────────────────────────────────────── */}
          <div className="bg-white rounded-xl shadow-sm border border-cf-gray-200 p-5">
            <div className="flex items-center gap-2 mb-4">
              <div className="w-8 h-8 bg-purple-50 rounded-lg flex items-center justify-center">
                <ImageIcon size={14} className="text-purple-600" />
              </div>
              <h3 className="text-sm font-semibold text-cf-navy">Image Optimization</h3>
            </div>
            <SettingRow
              label="Polish"
              desc="Losslessly strip metadata and reduce image size. Optionally convert to WebP."
              value={sv("polish")}
              display={(s["polish"] as string) !== "off" && s["polish"] ? (s["polish"] as string) : "Disabled"}
              recommendation="Enable Polish (Lossless or Lossy) to reduce image transfer sizes."
            />
            <SettingRow
              label="WebP Conversion"
              desc="Serve WebP images to supported browsers (up to 35% smaller than JPEG/PNG)."
              value={sv("webp")}
              recommendation="Enable WebP alongside Polish for maximum image optimization."
            />
            <SettingRow
              label="Mirage (Mobile)"
              desc="Lazy-load and resize images for mobile connections automatically."
              value={sv("mirage")}
              recommendation="Enable Mirage to improve mobile page load performance."
            />
            <SettingRow
              label="Image Resizing"
              desc="On-demand image resizing and format conversion via URL parameters."
              value={sv("image_resizing")}
            />
          </div>

          {/* ── Content Optimization ──────────────────────────────────────── */}
          <div className="bg-white rounded-xl shadow-sm border border-cf-gray-200 p-5">
            <div className="flex items-center gap-2 mb-4">
              <div className="w-8 h-8 bg-blue-50 rounded-lg flex items-center justify-center">
                <FileText size={14} className="text-blue-600" />
              </div>
              <h3 className="text-sm font-semibold text-cf-navy">Content Optimization</h3>
            </div>
            <SettingRow
              label="Brotli Compression"
              desc="Compress text-based resources with Brotli (20-25% better than Gzip)."
              value={sv("brotli")}
              recommendation="Enable Brotli for better text compression than Gzip."
            />
            <SettingRow
              label="Rocket Loader"
              desc="Asynchronously load JavaScript to reduce render-blocking and improve LCP."
              value={sv("rocket_loader")}
              recommendation="Enable Rocket Loader to defer non-critical JS and improve Web Vitals."
            />
            <SettingRow
              label="Early Hints (103)"
              desc="Pre-send Link headers so browsers prefetch resources before the full response."
              value={sv("early_hints")}
              recommendation="Enable Early Hints to reduce time-to-first-render."
            />
          </div>

          {/* ── Protocol Optimization ─────────────────────────────────────── */}
          <div className="bg-white rounded-xl shadow-sm border border-cf-gray-200 p-5">
            <div className="flex items-center gap-2 mb-4">
              <div className="w-8 h-8 bg-green-50 rounded-lg flex items-center justify-center">
                <Network size={14} className="text-green-600" />
              </div>
              <h3 className="text-sm font-semibold text-cf-navy">Protocol Optimization</h3>
            </div>
            <SettingRow
              label="HTTP/2"
              desc="Multiplexed connections — deliver multiple requests over a single TCP connection."
              value={sv("http2")}
            />
            <SettingRow
              label="HTTP/3 (QUIC)"
              desc="UDP-based transport — eliminates head-of-line blocking and improves mobile performance."
              value={sv("http3")}
              recommendation="Enable HTTP/3 for better performance on mobile and unstable connections."
            />
            <SettingRow
              label="0-RTT Connection Resumption"
              desc="Allows clients to resume TLS sessions with zero round-trip overhead."
              value={sv("0rtt")}
              recommendation="Enable 0-RTT to reduce connection overhead for returning visitors."
            />
            <SettingRow
              label="HTTP/2 Prioritization"
              desc="Optimize delivery order of assets for faster page rendering (Enterprise)."
              value={(s["http2_prioritization"] ?? s["h2_prioritization"]) as SettingVal}
            />
            <SettingRow
              label="gRPC Support"
              desc="Route gRPC requests through Cloudflare's network."
              value={sv("grpc")}
            />
            <SettingRow
              label="WebSockets"
              desc="Proxy WebSocket connections through the Cloudflare edge."
              value={sv("websockets")}
            />
          </div>
        </div>
      </div>
    </section>
  );
}
