/**
 * HomePage — Alfa Romeo design language.
 * Dark Deep Navy hero, sharp zero-radius inputs, uppercase labels, thin red accent lines.
 */
import { useState, useRef } from "react";
import {
  Shield, Key, Building, AlertCircle, Eye, EyeOff,
  Loader2, Globe, ChevronDown, CheckCircle, Upload, User, Users, Calendar, Clock,
} from "lucide-react";
import type { ReportInput, ZoneOption, ReportRangeMode, ReportPeriod } from "../types";
import { fetchZones } from "../services/api";
import cfLogo from "../assets/cf-logo";

interface Props {
  onSubmit: (input: ReportInput) => void;
  loading: boolean;
  error?: string;
  userEmail?: string | null;
  onOpenSchedules: () => void;
  onOpenCustomDashboard: () => void;
}

const REQUIRED_PERMISSIONS: { label: string; note?: string; required: boolean }[] = [
  { label: "Zone · Zone Read",                    required: true,  note: "Zone info, plan, status" },
  { label: "Zone · Zone Settings · Read",         required: true,  note: "All zone settings" },
  { label: "Zone · Analytics · Read",             required: true,  note: "GraphQL Analytics API" },
  { label: "Zone · Zone Rulesets · Read",         required: true,  note: "WAF managed rules" },
  { label: "Zone · WAF · Read",                   required: true,  note: "Legacy firewall rules" },
  { label: "Zone · Bot Management · Read",        required: true,  note: "Bot Management config" },
  { label: "Zone · DDoS Protection · Read",       required: true,  note: "DDoS protection ruleset" },
  { label: "Zone · Firewall Services · Read",     required: true,  note: "Firewall rules" },
  { label: "Zone · DNS · Read",                   required: true,  note: "DNS record inventory" },
  { label: "Zone · SSL and Certificates · Read",  required: true,  note: "Certificate packs" },
  { label: "Zone · Cache Rules · Read",           required: true,  note: "Cache rules" },
  { label: "Zone · API Gateway · Read",           required: false, note: "Optional — API Shield" },
  { label: "Zone · Page Shield · Read",           required: false, note: "Optional — Page Shield" },
  { label: "Account · Account Settings · Read",   required: true,  note: "Account info" },
  { label: "Account · Account Analytics · Read",  required: false, note: "Optional — DNS analytics" },
];

const ZT_PERMISSIONS: { label: string; note?: string; required: boolean }[] = [
  { label: "Account · Zero Trust Read",           required: true,  note: "Access apps, policies, auth events" },
  { label: "Account · Access · Apps · Read",      required: true,  note: "Access application inventory" },
  { label: "Account · Access · Policies · Read",  required: true,  note: "Per-app policy rules" },
  { label: "Account · Access · Audit Logs · Read", required: false, note: "Optional — real seat counts and last-login (/access/users)" },
  { label: "Account · Gateway · Read",            required: true,  note: "DNS/HTTP/L4 filtering stats, WARP device connection status" },
  { label: "Account · Zero Trust · Analytics",    required: true,  note: "GraphQL: auth events, Gateway, WARP device status, bandwidth" },
  { label: "Account · WARP · Read",               required: false, note: "Optional — enrolled devices" },
  { label: "Account · Tunnels · Read",            required: false, note: "Optional — Tunnel status" },
  { label: "Account · DLP · Read",                required: false, note: "Optional — DLP profiles" },
  { label: "Account · Zero Trust Read/Write",     required: false, note: "Optional — CASB findings (/data-security/posture/findings)" },
  { label: "Account · Notifications Read",        required: false, note: "Optional — recent alert history" },
  { label: "Account · Account Settings · Read",   required: true,  note: "Account name" },
];

const TIMEFRAME_OPTIONS = [
  { days: 1,  label: "1 Day"  },
  { days: 3,  label: "3 Days" },
  { days: 5,  label: "5 Days" },
  { days: 7,  label: "7 Days" },
  { days: 14, label: "14 Days"},
  { days: 30, label: "30 Days"},
];

const MT_PERMISSIONS = [
  { label: "Account · Account Analytics · Read", required: true, note: "Magic Transit traffic, DDoS and tunnel telemetry" },
  { label: "Account · Magic Transit · Read", required: false, note: "Tunnel and route inventory; required for configuration sections" },
  { label: "Account · Account Rulesets · Read", required: false, note: "DDoS and Network Firewall entrypoint rules; phase-specific read permissions are also accepted" },
  { label: "Account · Account Settings · Read", required: false, note: "Account display name" },
];

export default function HomePage({ onSubmit, loading, error, userEmail, onOpenSchedules, onOpenCustomDashboard }: Props) {
  const [product, setProduct]             = useState<"appsec" | "zero-trust" | "magic-transit">("appsec");
  const [token, setToken]                 = useState("");
  const [accountId, setAccountId]         = useState("");
  const [showToken, setShowToken]         = useState(false);
  const [touched, setTouched]             = useState({ token: false, accountId: false });
  const [zones, setZones]                 = useState<ZoneOption[]>([]);
  const [selectedZoneId, setSelectedZoneId] = useState("");
  const [fetchingZones, setFetchingZones] = useState(false);
  const [zoneError, setZoneError]         = useState("");
  const [days, setDays]                   = useState<number>(30);
  const [rangeMode, setRangeMode]         = useState<ReportRangeMode>("rolling");
  const [monthsAgo, setMonthsAgo]         = useState<number>(1);
  const [period, setPeriod]               = useState<ReportPeriod>("yesterday");
  const [sinceDate, setSinceDate]         = useState<string>("");
  const [untilDate, setUntilDate]         = useState<string>("");
  const [sinceTime, setSinceTime]         = useState<string>("");
  const [untilTime, setUntilTime]         = useState<string>("");
  const [clientName, setClientName]       = useState("");
  const [partnerName, setPartnerName]     = useState("");
  const [clientLogo, setClientLogo]       = useState<string>("");
  const [logoFileName, setLogoFileName]   = useState("");
  const [isPoc, setIsPoc]                 = useState(true);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const isValidHex32 = (s: string) => /^[a-f0-9]{32}$/i.test(s);
  const tokenOk      = token.trim().length > 10;
  const accountOk    = isValidHex32(accountId);
  const zoneOk       = isValidHex32(selectedZoneId);

  // Custom-range validation (mirrors the backend's customDateRange()).
  const todayLocalStr = () => {
    const n = new Date();
    return new Date(n.getTime() - n.getTimezoneOffset() * 60000).toISOString().split("T")[0];
  };
  const validSince = /^\d{4}-\d{2}-\d{2}$/.test(sinceDate) ? new Date(sinceDate + "T00:00:00") : null;
  const validUntil = /^\d{4}-\d{2}-\d{2}$/.test(untilDate) ? new Date(untilDate + "T00:00:00") : null;
  const sameDayReversedTimes = sinceDate === untilDate
    && sinceTime && untilTime && untilTime < sinceTime;
  const customDateError =
    rangeMode !== "custom" ? ""
    : !sinceDate || !untilDate ? "Pick a start and end date."
    : !validSince || !validUntil ? "Dates must be valid (YYYY-MM-DD)."
    : validUntil < validSince ? "The end date can't be before the start date."
    : sameDayReversedTimes ? "The end time can't be before the start time on the same day."
    : untilDate > todayLocalStr() ? "The end date can't be in the future."
    : Math.round((validUntil.getTime() - validSince.getTime()) / 86400000) + 1 > 366
      ? "Range can't exceed 366 days."
      : "";
  const customDatesOk = rangeMode !== "custom" || customDateError === "";

  const canFetchZones = tokenOk && accountOk && !fetchingZones;
  const canSubmit = product !== "appsec"
    ? tokenOk && accountOk && customDatesOk && !loading
    : tokenOk && accountOk && zoneOk && customDatesOk && !loading;
  const showConfig    = product !== "appsec" || (zones.length > 0 && selectedZoneId);

  // Month options for the calendar-month selector: the 12 months before
  // the current one, labeled with the month the report would actually cover.
  const MONTH_LABELS = ["January","February","March","April","May","June","July","August","September","October","November","December"];
  const monthOptions = Array.from({ length: 12 }, (_, i) => {
    const monthsAgoIdx = i + 1;
    const d = new Date();
    d.setDate(1); // avoid month-overflow when shifting (e.g. May 31 - 1 month)
    d.setMonth(d.getMonth() - monthsAgoIdx);
    return { value: monthsAgoIdx, label: `${MONTH_LABELS[d.getMonth()]} ${d.getFullYear()}` };
  });

  async function handleFetchZones() {
    setZoneError(""); setZones([]); setSelectedZoneId(""); setFetchingZones(true);
    try {
      const list = await fetchZones(token.trim(), accountId.trim().toLowerCase());
      if (list.length === 0) setZoneError("No active zones found for this account.");
      else { setZones(list); if (list.length === 1) setSelectedZoneId(list[0].id); }
    } catch (e: unknown) {
      setZoneError(e instanceof Error ? e.message : "Failed to fetch zones.");
    } finally { setFetchingZones(false); }
  }

  function handleLogoUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.size > 2 * 1024 * 1024) { alert("Logo must be under 2MB"); return; }
    if (!["image/png","image/jpeg","image/svg+xml","image/webp"].includes(file.type)) {
      alert("Only PNG, JPG, SVG, or WebP"); return;
    }
    setLogoFileName(file.name);
    const reader = new FileReader();
    reader.onload = () => setClientLogo(reader.result as string);
    reader.readAsDataURL(file);
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!canSubmit) return;
    onSubmit({
      token: token.trim(),
      zoneId: product !== "appsec" ? "" : selectedZoneId,
      accountId: accountId.trim().toLowerCase(),
      days, tzOffset: new Date().getTimezoneOffset(),
      rangeMode,
      ...(rangeMode === "custom" ? { sinceDate, untilDate, ...(sinceTime ? { sinceTime } : {}), ...(untilTime ? { untilTime } : {}) } : {}),
      ...(rangeMode === "calendar_month" ? { monthsAgo } : {}),
      ...(rangeMode === "period" ? { period } : {}),
      product,
      clientName:  clientName.trim()  || undefined,
      partnerName: partnerName.trim() || undefined,
      clientLogo:  clientLogo         || undefined,
      isPoc,
    });
  }

  const perms = product === "magic-transit" ? MT_PERMISSIONS : product === "zero-trust" ? ZT_PERMISSIONS : REQUIRED_PERMISSIONS;

  return (
    <div className="min-h-screen" style={{ backgroundColor: "#1c1f2a" }}>

      {/* ── Nav bar ────────────────────────────────────────────────────────── */}
      <nav className="sticky top-0 z-50 h-[67px] flex items-center px-8"
        style={{ backgroundColor: "#1c1f2a", borderBottom: "3px solid #ba0816" }}>
        <div className="flex items-center gap-4 flex-1">
          {/* Cloudflare shield — sole brand identifier */}
          <img src={cfLogo} alt="Cloudflare"
            style={{ height: 28, objectFit: "contain", filter: "brightness(0) invert(1)", opacity: 0.9 }} />
          {/* Thin red separator */}
          <div className="h-5 w-px" style={{ backgroundColor: "#ba0816" }} />
          <span style={{
            fontSize: 11, fontWeight: 400, letterSpacing: "0.09375rem",
            textTransform: "uppercase", color: "rgba(244,244,244,0.6)"
          }}>
            Cloudflare Report Builder
          </span>
        </div>
        <div className="flex items-center gap-4">
          <button
            onClick={onOpenSchedules}
            className="flex items-center gap-2"
            style={{
              padding: "9px 16px 7px",
              fontSize: 11, letterSpacing: "0.09375rem", textTransform: "uppercase",
              color: "rgba(244,244,244,0.75)", cursor: "pointer",
              border: "1px solid rgba(244,244,244,0.25)", backgroundColor: "transparent",
              transition: "all 0.15s",
            }}
          >
            <Clock size={12} /> Scheduled Reports
          </button>
          {userEmail && (
            <div className="flex items-center gap-2">
              <User size={12} style={{ color: "rgba(244,244,244,0.4)" }} />
              <span style={{ fontSize: 11, color: "rgba(244,244,244,0.5)", letterSpacing: "0.05em" }}>
                {userEmail}
              </span>
            </div>
          )}
        </div>
      </nav>

      {/* ── Hero section — dark cinematic with red stripe ─────────────────── */}
      {/* Full-width AR Red stripe at the very top of hero */}
      <div style={{ backgroundColor: "#ba0816", height: 4, width: "100%" }} />
      <div className="px-8 pt-14 pb-14" style={{
        backgroundColor: "#1c1f2a",
        backgroundImage: "linear-gradient(135deg, rgba(186,8,22,0.08) 0%, transparent 60%)",
      }}>
        <div className="max-w-2xl">
          {/* Red accent line + label */}
          <div className="flex items-center gap-3 mb-8">
            <div style={{ width: 56, height: 3, backgroundColor: "#ba0816" }} />
            <span style={{
              fontSize: 11, letterSpacing: "0.09375rem", textTransform: "uppercase",
              color: "#ba0816", fontWeight: 400
            }}>
              Cloudflare · Security Analytics
            </span>
          </div>
          {/* Hero headline */}
          <h1 style={{
            fontSize: "clamp(2.2rem, 5vw, 3.6rem)", fontWeight: 700, lineHeight: 1.05,
            letterSpacing: "-0.04em", textTransform: "uppercase", color: "#f4f4f4",
            marginBottom: "1.25rem"
          }}>
            Report<br />
            <span style={{ color: "#ba0816" }}>Builder</span>
          </h1>
          <p style={{ fontSize: 15, color: "rgba(244,244,244,0.55)", lineHeight: 1.65, maxWidth: 480 }}>
            Generate a comprehensive security posture report from your Cloudflare account data.
          </p>
        </div>
      </div>

      {/* ── Main content — light section ───────────────────────────────────── */}
      <div style={{ backgroundColor: "#f4f4f4" }}>
        <div className="max-w-3xl mx-auto px-8 py-12">

          {/* Product selector */}
          <div className="mb-8">
            <div className="flex items-center gap-3 mb-4">
              <div style={{ width: 40, height: 2, backgroundColor: "#ba0816" }} />
              <span style={{ fontSize: 11, letterSpacing: "0.09375rem", textTransform: "uppercase", color: "#5d5e65" }}>
                Select Report Type
              </span>
            </div>
            <div className="flex gap-0 flex-wrap">
              {(["appsec", "zero-trust", "magic-transit"] as const).map((p) => (
                <button key={p} onClick={() => { setProduct(p); setSelectedZoneId(""); setZones([]); }}
                  style={{
                    padding: "15px 32px 13px",
                    fontSize: 11, fontWeight: 400, letterSpacing: "0.09375rem",
                    textTransform: "uppercase" as const, cursor: "pointer",
                    border: "1px solid",
                    borderColor: product === p ? "#ba0816" : "#c4c4c4",
                    backgroundColor: product === p ? "#ba0816" : "transparent",
                    color: product === p ? "#ffffff" : "#5d5e65",
                    transition: "all 0.15s",
                    marginRight: -1,
                  }}>
                  {p === "appsec" ? "App Security" : p === "magic-transit" ? "Magic Transit" : "Cloudflare One"}
                </button>
              ))}
              <button type="button" onClick={onOpenCustomDashboard} disabled={loading}
                style={{ padding: "15px 24px 13px", fontSize: 11, letterSpacing: "0.09375rem", textTransform: "uppercase", border: "1px solid #c4c4c4", color: "#5d5e65", background: "transparent", cursor: "pointer" }}>
                Custom Dashboard
              </button>
            </div>
          </div>

          {/* Form */}
          <form onSubmit={handleSubmit}>

            {/* Error banner */}
            {error && (
              <div className="flex items-start gap-3 mb-6 p-4"
                style={{ backgroundColor: "#fef2f2", border: "1px solid #fecaca" }}>
                <AlertCircle size={15} style={{ color: "#d51121", flexShrink: 0, marginTop: 1 }} />
                <p style={{ fontSize: 13, color: "#7f1d1d" }}>{error}</p>
              </div>
            )}

            <div className="grid grid-cols-1 gap-6">

              {/* API Token */}
              <div>
                <label className="ar-input-label">
                  <Key size={10} style={{ display: "inline", marginRight: 4 }} />
                  API Token
                </label>
                <div style={{ position: "relative" }}>
                  <input
                    type={showToken ? "text" : "password"}
                    value={token}
                    onChange={(e) => { setToken(e.target.value); setZones([]); setSelectedZoneId(""); }}
                    onBlur={() => setTouched((t) => ({ ...t, token: true }))}
                    placeholder="Paste your Cloudflare API token"
                    className={`ar-input ${touched.token && !tokenOk ? "ar-input-error" : ""}`}
                    style={{ paddingRight: 44, fontFamily: "monospace" }}
                    autoComplete="off"
                  />
                  <button type="button" onClick={() => setShowToken((s) => !s)}
                    style={{ position: "absolute", right: 14, top: "50%", transform: "translateY(-50%)", background: "none", border: "none", cursor: "pointer", color: "#5d5e65" }}>
                    {showToken ? <EyeOff size={14} /> : <Eye size={14} />}
                  </button>
                </div>
                {touched.token && !tokenOk && (
                  <p style={{ fontSize: 11, color: "#d51121", marginTop: 4 }}>API token is required</p>
                )}
              </div>

              {/* Account ID + Fetch Zones */}
              <div>
                <label className="ar-input-label">
                  <Building size={10} style={{ display: "inline", marginRight: 4 }} />
                  Account ID
                </label>
                <div style={{ display: "flex", gap: 0 }}>
                  <input
                    type="text"
                    value={accountId}
                    onChange={(e) => { setAccountId(e.target.value); setZones([]); setSelectedZoneId(""); }}
                    onBlur={() => setTouched((t) => ({ ...t, accountId: true }))}
                    placeholder="32-character hex account ID"
                    maxLength={32}
                    className={`ar-input ${touched.accountId && !accountOk ? "ar-input-error" : ""}`}
                    style={{ flex: 1, fontFamily: "monospace" }}
                  />
                  {product === "appsec" && (
                    <button type="button" onClick={handleFetchZones} disabled={!canFetchZones}
                      className="ar-btn" style={{ borderLeft: "none", flexShrink: 0 }}>
                      {fetchingZones ? <><Loader2 size={12} style={{ animation: "spin 1s linear infinite" }} /> Fetching…</> : <><Globe size={12} /> Fetch Zones</>}
                    </button>
                  )}
                </div>
                {touched.accountId && !accountOk && (
                  <p style={{ fontSize: 11, color: "#d51121", marginTop: 4 }}>Account ID must be a 32-character hex string</p>
                )}
                <p style={{ fontSize: 11, color: "#5d5e65", marginTop: 4 }}>
                  Found in Cloudflare Dashboard → right sidebar under "Account ID"
                </p>
              </div>

              {/* Zone picker */}
              {product === "appsec" && zoneError && (
                <div className="flex items-start gap-3 p-4"
                  style={{ backgroundColor: "#fef2f2", border: "1px solid #fecaca" }}>
                  <AlertCircle size={14} style={{ color: "#d51121", flexShrink: 0 }} />
                  <p style={{ fontSize: 12, color: "#7f1d1d" }}>{zoneError}</p>
                </div>
              )}

              {product === "appsec" && zones.length > 0 && (
                <div>
                  <label className="ar-input-label">
                    <Globe size={10} style={{ display: "inline", marginRight: 4 }} />
                    Select Zone
                    <span style={{ textTransform: "none", fontWeight: 400, marginLeft: 8, color: "#5d5e65" }}>
                      ({zones.length} zone{zones.length !== 1 ? "s" : ""} found)
                    </span>
                  </label>
                  <div style={{ position: "relative" }}>
                    <select value={selectedZoneId} onChange={(e) => setSelectedZoneId(e.target.value)}
                      className="ar-input" style={{ appearance: "none", paddingRight: 36, cursor: "pointer" }}>
                      <option value="">— Select a zone —</option>
                      {zones.map((z) => (
                        <option key={z.id} value={z.id}>{z.name} ({z.plan})</option>
                      ))}
                    </select>
                    <ChevronDown size={14} style={{ position: "absolute", right: 14, top: "50%", transform: "translateY(-50%)", color: "#5d5e65", pointerEvents: "none" }} />
                  </div>
                  {zones.find((z) => z.id === selectedZoneId) && (
                    <p style={{ fontSize: 11, color: "#1d5b40", marginTop: 4, display: "flex", alignItems: "center", gap: 4 }}>
                      <CheckCircle size={11} /> {zones.find((z) => z.id === selectedZoneId)?.name}
                    </p>
                  )}
                </div>
              )}

              {/* ZT info */}
              {product !== "appsec" && (
                <div className="p-4" style={{ backgroundColor: "#1c1f2a", border: "1px solid #ba0816", borderLeft: "4px solid #ba0816" }}>
                  <div className="flex items-start gap-3">
                    <Shield size={14} style={{ color: "#ba0816", flexShrink: 0, marginTop: 1 }} />
                    <div>
                      <p style={{ fontSize: 11, fontWeight: 600, color: "#f4f4f4", textTransform: "uppercase", letterSpacing: "0.09375rem", marginBottom: 4 }}>
                        {product === "magic-transit" ? "Magic Transit" : "Cloudflare One"} — Account-Level Report
                      </p>
                      <p style={{ fontSize: 12, color: "rgba(244,244,244,0.55)", lineHeight: 1.6 }}>
                        {product === "magic-transit" ? "Network traffic, L3/L4 DDoS, tunnel health, Network Firewall and advanced protection. Includes an interactive globe and an export-friendly report. Configuration APIs may need additional product-specific read permissions; unavailable sections are identified. No zone selection needed." : "Covers Access (identity), Gateway (DNS/HTTP/L4), WARP (device posture), Tunnels, and DLP. No zone selection needed."}
                      </p>
                    </div>
                  </div>
                </div>
              )}

              {/* Timeframe */}
              {showConfig && (
                <div>
                  <label className="ar-input-label">
                    <Calendar size={10} style={{ display: "inline", marginRight: 4 }} />
                    Report Timeframe
                  </label>
                  <div style={{ display: "flex", gap: 0 }}>
                    {TIMEFRAME_OPTIONS.map((opt) => (
                      <button key={opt.days} type="button" onClick={() => { setDays(opt.days); setRangeMode("rolling"); }}
                        style={{
                          flex: 1, padding: "13px 8px 11px",
                          fontSize: 11, fontWeight: 400, letterSpacing: "0.09375rem",
                          textTransform: "uppercase" as const, cursor: "pointer",
                          border: "1px solid",
                          borderColor: rangeMode === "rolling" && days === opt.days ? "#ba0816" : "#c4c4c4",
                          backgroundColor: rangeMode === "rolling" && days === opt.days ? "#ba0816" : "transparent",
                          color: rangeMode === "rolling" && days === opt.days ? "#ffffff" : "#5d5e65",
                          marginRight: -1, transition: "all 0.15s",
                          textAlign: "center" as const,
                        }}>
                        {opt.label}
                      </button>
                    ))}
                    <button type="button" onClick={() => setRangeMode("calendar_month")}
                      style={{
                        flex: 1, padding: "13px 8px 11px",
                        fontSize: 11, fontWeight: 400, letterSpacing: "0.09375rem",
                        textTransform: "uppercase" as const, cursor: "pointer",
                        border: "1px solid",
                        borderColor: rangeMode === "calendar_month" ? "#ba0816" : "#c4c4c4",
                        backgroundColor: rangeMode === "calendar_month" ? "#ba0816" : "transparent",
                        color: rangeMode === "calendar_month" ? "#ffffff" : "#5d5e65",
                        transition: "all 0.15s",
                        textAlign: "center" as const,
                      }}>
                      Month
                    </button>
                    <button type="button" onClick={() => setRangeMode("period")}
                      style={{
                        flex: 1, padding: "13px 8px 11px",
                        fontSize: 11, fontWeight: 400, letterSpacing: "0.09375rem",
                        textTransform: "uppercase" as const, cursor: "pointer",
                        border: "1px solid",
                        borderColor: rangeMode === "period" ? "#ba0816" : "#c4c4c4",
                        backgroundColor: rangeMode === "period" ? "#ba0816" : "transparent",
                        color: rangeMode === "period" ? "#ffffff" : "#5d5e65",
                        transition: "all 0.15s",
                        textAlign: "center" as const,
                      }}>
                      Period
                    </button>
                    <button type="button" onClick={() => setRangeMode("custom")}
                      style={{
                        flex: 1, padding: "13px 8px 11px",
                        fontSize: 11, fontWeight: 400, letterSpacing: "0.09375rem",
                        textTransform: "uppercase" as const, cursor: "pointer",
                        border: "1px solid",
                        borderColor: rangeMode === "custom" ? "#ba0816" : "#c4c4c4",
                        backgroundColor: rangeMode === "custom" ? "#ba0816" : "transparent",
                        color: rangeMode === "custom" ? "#ffffff" : "#5d5e65",
                        transition: "all 0.15s",
                        textAlign: "center" as const,
                      }}>
                      Custom
                    </button>
                  </div>
                  {rangeMode === "period" && (
                    <div style={{ marginTop: 8, display: "flex", gap: 0 }}>
                      {([
                        { value: "yesterday", label: "Daily — yesterday" },
                        { value: "last_week", label: "Weekly — last Mon–Sun" },
                        { value: "last_month", label: "Monthly — last month" },
                      ] as const).map((opt) => (
                        <button key={opt.value} type="button" onClick={() => setPeriod(opt.value)}
                          style={{
                            flex: 1, padding: "10px 8px 8px",
                            fontSize: 10, fontWeight: 400, letterSpacing: "0.05em",
                            textTransform: "uppercase" as const, cursor: "pointer",
                            border: "1px solid",
                            borderColor: period === opt.value ? "#ba0816" : "#c4c4c4",
                            backgroundColor: period === opt.value ? "#ba0816" : "transparent",
                            color: period === opt.value ? "#ffffff" : "#5d5e65",
                            marginRight: -1, transition: "all 0.15s", textAlign: "center" as const,
                          }}>
                          {opt.label}
                        </button>
                      ))}
                    </div>
                  )}
                  {rangeMode === "period" && (
                    <p style={{ marginTop: 8, fontSize: 11, color: "#5d5e65", lineHeight: 1.5 }}>
                      Reports the last COMPLETE period in your timezone — Daily covers yesterday 00:00:00–23:59:59, Weekly the previous Monday–Sunday, Monthly the previous calendar month (real 28–31 days). The window is computed when the report runs, so it never goes stale.
                    </p>
                  )}
                  {rangeMode === "calendar_month" && (
                    <div style={{ marginTop: 8, display: "flex", gap: 8, alignItems: "center" }}>
                      <select
                        value={monthsAgo}
                        onChange={(e) => setMonthsAgo(Number(e.target.value))}
                        className="ar-input"
                        style={{ appearance: "none", paddingRight: 36, cursor: "pointer", flex: 1 }}
                      >
                        {monthOptions.map((o) => (
                          <option key={o.value} value={o.value}>
                            {o.label}{o.value === 1 ? " (last month)" : ""}
                          </option>
                        ))}
                      </select>
                      <p style={{ fontSize: 11, color: "#5d5e65", margin: 0, flex: 1.6, lineHeight: 1.5 }}>
                        Reports that full calendar month (28–31 days) instead of a fixed rolling window.
                      </p>
                    </div>
                  )}
                  {rangeMode === "custom" && (
                    <div style={{ marginTop: 8 }}>
                      <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
                        <input
                          type="date"
                          value={sinceDate}
                          max={todayLocalStr()}
                          onChange={(e) => setSinceDate(e.target.value)}
                          className="ar-input"
                          style={{ flex: 1, minWidth: 130, cursor: "pointer" }}
                          aria-label="Report period start date"
                        />
                        <input
                          type="time"
                          value={sinceTime}
                          onChange={(e) => setSinceTime(e.target.value)}
                          className="ar-input"
                          style={{ flex: 0.7, minWidth: 84, cursor: "pointer" }}
                          aria-label="Report period start time (optional, default 00:00)"
                          title="Start time — optional, defaults to 00:00"
                        />
                        <span style={{ fontSize: 12, color: "#5d5e65" }}>→</span>
                        <input
                          type="date"
                          value={untilDate}
                          max={todayLocalStr()}
                          onChange={(e) => setUntilDate(e.target.value)}
                          className="ar-input"
                          style={{ flex: 1, minWidth: 130, cursor: "pointer" }}
                          aria-label="Report period end date"
                        />
                        <input
                          type="time"
                          value={untilTime}
                          onChange={(e) => setUntilTime(e.target.value)}
                          className="ar-input"
                          style={{ flex: 0.7, minWidth: 84, cursor: "pointer" }}
                          aria-label="Report period end time (optional, default 23:59)"
                          title="End time — optional, defaults to 23:59 (inclusive)"
                        />
                      </div>
                      {customDateError ? (
                        <p style={{ fontSize: 11, color: "#b45309", marginTop: 6, marginBottom: 0 }}>{customDateError}</p>
                      ) : (
                        <p style={{ fontSize: 11, color: "#5d5e65", marginTop: 6, marginBottom: 0 }}>
                          Exact period in your timezone; times are optional (default 00:00 → 23:59, end time inclusive). Request-level breakdowns (TLS/PQC, WAF, bots, AI crawlers, DNS analytics, countries, browsers, status codes, content types, top IPs/ASNs…) follow the exact window — sampled like Cloudflare's own dashboard; only the daily overview + error charts cover whole days. Fine-grained data only reaches ~30 days back.
                        </p>
                      )}
                    </div>
                  )}
                </div>
              )}

              {/* Report Framing — POC vs. neutral assessment */}
              {showConfig && (
                <div>
                  <label
                    htmlFor="isPocCheckbox"
                    style={{
                      display: "flex", alignItems: "flex-start", gap: 12,
                      padding: "14px 16px", cursor: "pointer",
                      border: "1px solid #c4c4c4", backgroundColor: "#fafafa",
                    }}
                  >
                    <input
                      id="isPocCheckbox"
                      type="checkbox"
                      checked={isPoc}
                      onChange={(e) => setIsPoc(e.target.checked)}
                      style={{ marginTop: 2, width: 16, height: 16, accentColor: "#ba0816", cursor: "pointer", flexShrink: 0 }}
                    />
                    <div>
                      <span style={{
                        fontSize: 12, fontWeight: 600, color: "#292b35",
                        display: "block", marginBottom: 2,
                      }}>
                        This is a POC (Proof-of-Concept) report
                      </span>
                      <span style={{ fontSize: 11, color: "#5d5e65", lineHeight: 1.5 }}>
                        Includes security recommendations, the cost/sizing calculator, and POC-specific wording
                        (e.g. "Proof-of-Concept", "POC period"). Uncheck for a neutral assessment report without
                        these — useful for existing customers or non-trial reviews.
                      </span>
                    </div>
                  </label>
                </div>
              )}

              {/* Branding */}
              {showConfig && (
                <div>
                  <div className="flex items-center gap-3 mb-4">
                    <div style={{ height: 1, width: 40, backgroundColor: "#ba0816" }} />
                    <span style={{ fontSize: 11, letterSpacing: "0.09375rem", textTransform: "uppercase", color: "#5d5e65" }}>
                      Report Branding (Optional)
                    </span>
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <div>
                      <label className="ar-input-label">
                        <User size={10} style={{ display: "inline", marginRight: 4 }} /> Client Name
                      </label>
                      <input type="text" value={clientName}
                        onChange={(e) => setClientName(e.target.value)}
                        placeholder="e.g. Acme Corp" className="ar-input" />
                    </div>
                    <div>
                      <label className="ar-input-label">
                        <Users size={10} style={{ display: "inline", marginRight: 4 }} /> Partner / Reseller
                      </label>
                      <input type="text" value={partnerName}
                        onChange={(e) => setPartnerName(e.target.value)}
                        placeholder="e.g. Cloud Solutions" className="ar-input" />
                    </div>
                  </div>
                  <div className="mt-4">
                    <label className="ar-input-label">
                      <Upload size={10} style={{ display: "inline", marginRight: 4 }} /> Client Logo
                    </label>
                    <input ref={fileInputRef} type="file"
                      accept="image/png,image/jpeg,image/svg+xml,image/webp"
                      onChange={handleLogoUpload} style={{ display: "none" }} />
                    <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                      <button type="button" onClick={() => fileInputRef.current?.click()}
                        className="ar-btn-ghost" style={{ padding: "11px 20px 9px" }}>
                        <Upload size={12} /> {clientLogo ? "Change Logo" : "Upload Logo"}
                      </button>
                      {clientLogo && (
                        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                          <img src={clientLogo} alt="Logo" style={{ height: 32, width: 32, objectFit: "contain" }} />
                          <span style={{ fontSize: 11, color: "#5d5e65" }}>{logoFileName}</span>
                          <button type="button" onClick={() => { setClientLogo(""); setLogoFileName(""); }}
                            style={{ fontSize: 11, color: "#d51121", background: "none", border: "none", cursor: "pointer" }}>
                            Remove
                          </button>
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              )}

              {/* Submit */}
              <div style={{ paddingTop: 8 }}>
                <button type="submit" disabled={!canSubmit}
                  style={{
                    display: "flex", alignItems: "center", justifyContent: "center", gap: 8,
                    width: "100%", padding: "17px 24px 15px",
                    fontSize: 11, fontWeight: 600, letterSpacing: "0.12rem",
                    textTransform: "uppercase" as const,
                    backgroundColor: canSubmit ? "#ba0816" : "#c4c4c4",
                    color: canSubmit ? "#ffffff" : "#5d5e65",
                    border: `1px solid ${canSubmit ? "#ba0816" : "#c4c4c4"}`,
                    cursor: canSubmit ? "pointer" : "not-allowed",
                    transition: "all 0.15s",
                  }}>
                  {loading
                    ? <><Loader2 size={14} style={{ animation: "spin 1s linear infinite" }} /> Fetching data from Cloudflare…</>
                    : <><Shield size={14} /> Generate {isPoc ? "POC" : "Assessment"} Report</>
                  }
                </button>
                <p style={{ fontSize: 11, color: "#5d5e65", textAlign: "center", marginTop: 12 }}>
                  Your API token is used only to fetch data and is never stored.
                </p>
              </div>
            </div>
          </form>
        </div>
      </div>

      {/* ── Permissions — dark section ──────────────────────────────────────── */}
      <div style={{ backgroundColor: "#1c1f2a", padding: "3rem 2rem 4rem" }}>
        <div className="max-w-3xl mx-auto">
          {/* Label */}
          <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: "1.5rem" }}>
            <div style={{ width: 40, height: 2, backgroundColor: "#ba0816", flexShrink: 0 }} />
            <span style={{ fontSize: 11, letterSpacing: "0.09375rem", textTransform: "uppercase", color: "rgba(244,244,244,0.4)" }}>
              API Token Permissions Required
            </span>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-8 gap-y-2">
            {perms.map((p) => (
              <div key={p.label} style={{ display: "flex", alignItems: "flex-start", gap: 8 }}>
                <div style={{
                  width: 4, height: 4, marginTop: 5, flexShrink: 0,
                  backgroundColor: p.required ? "#ba0816" : "#5d5e65",
                }} />
                <div>
                  <span style={{
                    fontSize: 11, fontFamily: "monospace",
                    color: p.required ? "rgba(244,244,244,0.7)" : "rgba(244,244,244,0.35)"
                  }}>
                    {p.label}
                    {!p.required && <span style={{ marginLeft: 6, fontSize: 10, fontStyle: "italic", color: "#5d5e65" }}>optional</span>}
                  </span>
                  {p.note && (
                    <p style={{ fontSize: 10, color: "rgba(244,244,244,0.25)", marginTop: 2 }}>{p.note}</p>
                  )}
                </div>
              </div>
            ))}
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 16, marginTop: "1.5rem", paddingTop: "1.5rem", borderTop: "1px solid rgba(255,255,255,0.06)" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
              <div style={{ width: 4, height: 4, backgroundColor: "#ba0816" }} />
              <span style={{ fontSize: 10, color: "rgba(244,244,244,0.35)", letterSpacing: "0.05em", textTransform: "uppercase" }}>Required</span>
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
              <div style={{ width: 4, height: 4, backgroundColor: "#5d5e65" }} />
              <span style={{ fontSize: 10, color: "rgba(244,244,244,0.25)", letterSpacing: "0.05em", textTransform: "uppercase" }}>Optional</span>
            </div>
          </div>
        </div>
      </div>

    </div>
  );
}
