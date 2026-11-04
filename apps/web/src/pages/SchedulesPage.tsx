/**
 * SchedulesPage — scheduled report email dashboard.
 *
 * Configuration only: report type (AppSec / Zero Trust), target zone,
 * timeframe, delivery cadence, recipients, subject and custom message.
 * The Cloudflare API token used for generation is bound on the backend —
 * nothing sensitive is entered or stored here.
 */
import { useEffect, useState, useCallback, useRef } from "react";
import {
  Shield, Globe, Clock, Plus, Pencil, Trash2, History, Send, Loader2,
  AlertCircle, CheckCircle, X, Mail, Calendar, User, ArrowLeft, KeyRound, Settings, Upload,
} from "lucide-react";
import type { ScheduleConfig, ScheduleInput, ScheduleHistoryEntry, ZoneOption, ScheduleReportType, ScheduleFrequency, ReportRangeMode, ReportPeriod } from "../types";
import {
  listSchedules, createSchedule, updateSchedule, deleteSchedule,
  sendScheduleNow, fetchScheduleHistory, fetchScheduleZones,
  fetchScheduleZonesWithCredentials, testCredentials,
} from "../services/api";
import BackendSettingsForm from "../components/BackendSettingsForm";
import DashboardTemplateEditor from "../components/DashboardTemplateEditor";
import { defaultDashboardTemplate, validateDashboardTemplate } from "../../../../shared/custom-dashboard-template";
import SavedDashboardSelector from "../components/SavedDashboardSelector";

interface Props {
  userEmail?: string | null;
  onBack: () => void;
}

const TIMEFRAME_OPTIONS = [1, 3, 5, 7, 14, 30];
const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const MONTH_DAYS = Array.from({ length: 28 }, (_, i) => i + 1);

// All timezone conversions take the schedule's offset in minutes using the
// Date#getTimezoneOffset convention (negative = ahead of UTC, e.g. GMT+7 = -420).
// Schedules display and are evaluated in their OWN configured zone — the send
// hour is stored in UTC, the weekday/day-of-month are local days in that zone
// (matches the cron runner in apps/api/src/scheduler.ts isDue()).
function utcHourToLocal(h: number, tzMinutes: number): number {
  return (((h - tzMinutes / 60) % 24) + 24) % 24;
}
function localHourToUtc(h: number, tzMinutes: number): number {
  // Math.round keeps whole-hour zones exact and tolerates half-hour zones (IST)
  return ((Math.round(h + tzMinutes / 60) % 24) + 24) % 24;
}
function tzLabel(tzMinutes: number): string {
  const h = -tzMinutes / 60;
  const sign = h >= 0 ? "+" : "−";
  const abs = Math.abs(h);
  const hours = Number.isInteger(abs) ? String(abs) : abs.toFixed(2).replace(/0+$/, "").replace(/\.$/, "");
  return `GMT${sign}${hours}`;
}

function describeSchedule(s: ScheduleConfig): string {
  const tz = s.tzOffset ?? 0;
  const localHour = utcHourToLocal(s.sendHourUtc, tz);
  const time = `${String(localHour).padStart(2, "0")}:00 ${tzLabel(tz)}`;
  if (s.frequency === "daily") return `Daily at ${time}`;
  if (s.frequency === "weekly") return `Every ${WEEKDAYS[s.dayOfWeek ?? 1]} at ${time}`;
  return `Monthly on day ${s.dayOfMonth ?? 1} at ${time}`;
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const MONTHS_FULL = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

/** Human description of a schedule's report period, mirroring the backend's
 *  range math: "last calendar month", "August 2026 (2 months back)",
 *  "custom: 2026-08-30 → 2026-09-03", or "N-day". */
function describeRange(s: ScheduleConfig): string {
  if (s.rangeMode === "custom") {
    const times = s.sinceTime || s.untilTime
      ? ` ${s.sinceTime ?? "00:00"}–${s.untilTime ?? "23:59"}`
      : "";
    return `custom ${s.sinceDate ?? "?"} → ${s.untilDate ?? "?"}${times}`;
  }
  if (s.rangeMode === "period")
    return s.period === "yesterday" ? "yesterday (full day)"
      : s.period === "last_week" ? "last full week (Mon–Sun)"
      : "last calendar month";
  if (s.rangeMode === "calendar_month") {
    const back = s.monthsAgo ?? 1;
    if (back === 1) return "last calendar month";
    const d = new Date();
    d.setDate(1);
    d.setMonth(d.getMonth() - back);
    return `${MONTHS_FULL[d.getMonth()]} ${d.getFullYear()} (${back} months back)`;
  }
  return `${s.days}-day`;
}

/** Month options for the calendar-month picker: the 12 months before now. */
function monthOptionsBack(count = 12): { value: number; label: string }[] {
  return Array.from({ length: count }, (_, i) => {
    const d = new Date();
    d.setDate(1); // avoid month-overflow when shifting back
    d.setMonth(d.getMonth() - (i + 1));
    return { value: i + 1, label: `${MONTHS_FULL[d.getMonth()]} ${d.getFullYear()}` };
  });
}
const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * The next intended occurrence as a UTC ms timestamp — the forward-looking
 * mirror of mostRecentOccurrenceMs() in apps/api/src/scheduler.ts (same
 * timezone conventions).
 */
function nextOccurrenceMs(s: ScheduleConfig, nowMs: number): number | null {
  const tzMin = s.tzOffset ?? 0;
  const tzMs = tzMin * 60 * 1000;
  const local = new Date(nowMs - tzMs);
  const nowLocalMs = local.getTime();
  const sendLocalHour = ((s.sendHourUtc - tzMin / 60) % 24 + 24) % 24;
  const atSendHour = (dayStartMs: number): number => dayStartMs + sendLocalHour * 60 * 60 * 1000;
  const daysInMonth = (y: number, m: number): number => new Date(Date.UTC(y, m + 1, 0)).getUTCDate();

  let candidateLocalMs: number;

  switch (s.frequency) {
    case "daily": {
      const todayStart = Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), local.getUTCDate());
      candidateLocalMs = atSendHour(todayStart);
      if (candidateLocalMs <= nowLocalMs) candidateLocalMs += DAY_MS;
      break;
    }
    case "weekly": {
      const daysAhead = (((s.dayOfWeek ?? 1) - local.getUTCDay()) % 7 + 7) % 7;
      const dayStart = Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), local.getUTCDate() + daysAhead);
      candidateLocalMs = atSendHour(dayStart);
      if (candidateLocalMs <= nowLocalMs) candidateLocalMs += 7 * DAY_MS;
      break;
    }
    case "monthly": {
      const dom = s.dayOfMonth ?? 1;
      let year = local.getUTCFullYear();
      let month = local.getUTCMonth();
      candidateLocalMs = atSendHour(Date.UTC(year, month, Math.min(dom, daysInMonth(year, month))));
      if (candidateLocalMs <= nowLocalMs) {
        month += 1;
        if (month > 11) { month = 0; year += 1; }
        candidateLocalMs = atSendHour(Date.UTC(year, month, Math.min(dom, daysInMonth(year, month))));
      }
      break;
    }
    default:
      return null;
  }

  return candidateLocalMs + tzMs;
}

function formatNextRun(nextMs: number, tzMin: number): string {
  const local = new Date(nextMs - tzMin * 60 * 1000);
  const datePart = `${WEEKDAYS[local.getUTCDay()].slice(0, 3)} ${local.getUTCDate()} ${MONTHS[local.getUTCMonth()]}`;
  const timePart = `${String(local.getUTCHours()).padStart(2, "0")}:${String(local.getUTCMinutes()).padStart(2, "0")}`;
  const diffMs = nextMs - Date.now();
  let rel: string;
  if (diffMs < 60 * 60 * 1000) rel = `in ${Math.max(1, Math.round(diffMs / 60_000))}m`;
  else if (diffMs < 48 * 60 * 60 * 1000) rel = `in ${(diffMs / 3_600_000).toFixed(diffMs < 10 * 3_600_000 ? 1 : 0)}h`;
  else rel = `in ${Math.round(diffMs / DAY_MS)}d`;
  return `${datePart}, ${timePart} ${tzLabel(tzMin)} · ${rel}`;
}

export default function SchedulesPage({ userEmail, onBack }: Props) {
  const [schedules, setSchedules] = useState<ScheduleConfig[] | null>(null);
  const [loadError, setLoadError] = useState("");
  const [formOpen, setFormOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [editing, setEditing] = useState<ScheduleConfig | null>(null);
  const [historyFor, setHistoryFor] = useState<ScheduleConfig | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [notice, setNotice] = useState<{ kind: "ok" | "err"; text: string } | null>(null);

  // Zone list for the appsec picker — fetched once via the backend-bound
  // token and cached for the page's lifetime (shared across form opens).
  const [zones, setZones] = useState<ZoneOption[] | null>(null);
  const [zonesError, setZonesError] = useState("");
  const [loadingZones, setLoadingZones] = useState(false);

  const loadZones = useCallback(async (force = false) => {
    if (loadingZones || (!force && zones !== null)) return;
    setLoadingZones(true);
    setZonesError("");
    try {
      setZones(await fetchScheduleZones());
    } catch (e) {
      setZonesError(e instanceof Error ? e.message : "Failed to load zones.");
    } finally {
      setLoadingZones(false);
    }
  }, [loadingZones, zones]);

  const reload = useCallback(async () => {
    setLoadError("");
    try {
      setSchedules(await listSchedules());
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : "Failed to load schedules.");
      setSchedules([]);
    }
  }, []);

  useEffect(() => { reload(); }, [reload]);

  function handleNew() {
    setEditing(null);
    setFormOpen(true);
    setSettingsOpen(false);
    setNotice(null);
    loadZones();
  }

  function handleEdit(s: ScheduleConfig) {
    setEditing(s);
    setFormOpen(true);
    setSettingsOpen(false);
    setNotice(null);
    loadZones();
  }

  async function handleDelete(s: ScheduleConfig) {
    if (!window.confirm(`Delete schedule "${s.name}"? Its run history is kept.`)) return;
    try {
      await deleteSchedule(s.id);
      setNotice({ kind: "ok", text: `Deleted "${s.name}".` });
      await reload();
    } catch (e) {
      setNotice({ kind: "err", text: e instanceof Error ? e.message : "Delete failed." });
    }
  }

  async function handleSendNow(s: ScheduleConfig) {
    const n = s.recipients.length;
    if (!window.confirm(
      `Send a test report for "${s.name}" now?\n\n` +
      `This generates the full report (~30–60s) and emails ${n} recipient${n !== 1 ? "s" : ""}.`
    )) return;
    setBusyId(s.id);
    setNotice(null);
    try {
      await sendScheduleNow(s.id);
      setNotice({ kind: "ok", text: `Report for "${s.name}" generated and sent to ${n} recipient${n !== 1 ? "s" : ""}.` });
      await reload();
    } catch (e) {
      setNotice({ kind: "err", text: `Send failed for "${s.name}": ${e instanceof Error ? e.message : "unknown error"}` });
      await reload();
    } finally {
      setBusyId(null);
    }
  }

  async function handleToggleEnabled(s: ScheduleConfig) {
    try {
      await updateSchedule(s.id, configToInput(s, !s.enabled));
      await reload();
    } catch (e) {
      setNotice({ kind: "err", text: e instanceof Error ? e.message : "Update failed." });
    }
  }

  return (
    <div className="min-h-screen" style={{ backgroundColor: "#1c1f2a" }}>

      {/* ── Nav bar ────────────────────────────────────────────────────────── */}
      <nav className="sticky top-0 z-50 h-[67px] flex items-center px-8"
        style={{ backgroundColor: "#1c1f2a", borderBottom: "3px solid #ba0816" }}>
        <div className="flex items-center gap-4 flex-1">
          <button onClick={onBack} className="ar-btn-ghost" style={{ padding: "9px 16px 7px" }}>
            <ArrowLeft size={12} /> Report Builder
          </button>
          <div className="h-5 w-px" style={{ backgroundColor: "#ba0816" }} />
          <span style={{
            fontSize: 11, fontWeight: 400, letterSpacing: "0.09375rem",
            textTransform: "uppercase", color: "rgba(244,244,244,0.6)"
          }}>
            Scheduled Reports
          </span>
        </div>
        <div className="flex items-center gap-4">
          <button
            onClick={() => { setSettingsOpen((s) => !s); setFormOpen(false); setNotice(null); }}
            className={settingsOpen ? "ar-btn" : "ar-btn-ghost"}
            style={{ padding: "9px 16px 7px", fontSize: 11 }}
            title="Backend settings — API token, account, sender address"
          >
            <Settings size={12} /> Settings
          </button>
          {userEmail && (
            <div className="flex items-center gap-2">
              <User size={12} style={{ color: "rgba(244,244,244,0.4)" }} />
              <span style={{ fontSize: 11, color: "rgba(244,244,244,0.5)", letterSpacing: "0.05em" }}>{userEmail}</span>
            </div>
          )}
        </div>
      </nav>

      <div style={{ backgroundColor: "#ba0816", height: 4, width: "100%" }} />

      {/* ── Hero ───────────────────────────────────────────────────────────── */}
      <div className="px-8 pt-12 pb-10" style={{
        backgroundColor: "#1c1f2a",
        backgroundImage: "linear-gradient(135deg, rgba(186,8,22,0.08) 0%, transparent 60%)",
      }}>
        <div className="max-w-3xl mx-auto">
          <div className="flex items-center gap-3 mb-6">
            <div style={{ width: 56, height: 3, backgroundColor: "#ba0816" }} />
            <span style={{ fontSize: 11, letterSpacing: "0.09375rem", textTransform: "uppercase", color: "#ba0816", fontWeight: 400 }}>
              Cloudflare · Email Delivery
            </span>
          </div>
          <div className="flex items-end justify-between gap-6 flex-wrap">
            <h1 style={{
              fontSize: "clamp(1.8rem, 4vw, 2.8rem)", fontWeight: 700, lineHeight: 1.05,
              letterSpacing: "-0.04em", textTransform: "uppercase", color: "#f4f4f4",
            }}>
              Scheduled<br /><span style={{ color: "#ba0816" }}>Reports</span>
            </h1>
            <button onClick={handleNew} className="ar-btn-light" style={{ padding: "13px 24px 11px" }}>
              <Plus size={13} /> New Schedule
            </button>
          </div>
          <p style={{ fontSize: 14, color: "rgba(244,244,244,0.55)", lineHeight: 1.65, maxWidth: 560, marginTop: "1rem" }}>
            Automatically generate and email report digests on a schedule. Report data is
            fetched with the API token bound on the backend — this dashboard only stores
            configuration, recipients and messages.
          </p>
        </div>
      </div>

      {/* ── Main content ───────────────────────────────────────────────────── */}
      <div style={{ backgroundColor: "#f4f4f4" }}>
        <div className="max-w-3xl mx-auto px-8 py-10">

          {notice && (
            <div className="flex items-start gap-3 mb-6 p-4" style={{
              backgroundColor: notice.kind === "ok" ? "#f0fdf4" : "#fef2f2",
              border: `1px solid ${notice.kind === "ok" ? "#bbf7d0" : "#fecaca"}`,
            }}>
              {notice.kind === "ok"
                ? <CheckCircle size={15} style={{ color: "#15803d", flexShrink: 0, marginTop: 1 }} />
                : <AlertCircle size={15} style={{ color: "#d51121", flexShrink: 0, marginTop: 1 }} />}
              <p style={{ fontSize: 13, color: notice.kind === "ok" ? "#14532d" : "#7f1d1d" }}>{notice.text}</p>
              <button onClick={() => setNotice(null)} style={{ marginLeft: "auto", background: "none", border: "none", cursor: "pointer", color: "#5d5e65" }}>
                <X size={13} />
              </button>
            </div>
          )}

          {settingsOpen ? (
            <BackendSettingsForm
              onDone={() => setSettingsOpen(false)}
              onSaved={() => {
                // Credentials changed — drop the cached zone list so the
                // next form open refetches with the new token/account.
                loadZones(true);
              }}
            />
          ) : formOpen ? (
            <ScheduleForm
              key={editing?.id ?? "new"}
              initial={editing}
              zones={zones}
              zonesError={zonesError}
              loadingZones={loadingZones}
              onRetryZones={() => loadZones(true)}
              onCancel={() => { setFormOpen(false); setEditing(null); }}
              onSaved={async (s) => {
                setFormOpen(false);
                setEditing(null);
                setNotice({ kind: "ok", text: `Schedule "${s.name}" saved.` });
                await reload();
              }}
            />
          ) : (
            <>
              {loadError && (
                <div className="flex items-start gap-3 mb-6 p-4" style={{ backgroundColor: "#fef2f2", border: "1px solid #fecaca" }}>
                  <AlertCircle size={15} style={{ color: "#d51121", flexShrink: 0, marginTop: 1 }} />
                  <p style={{ fontSize: 13, color: "#7f1d1d" }}>{loadError}</p>
                </div>
              )}

              {schedules === null ? (
                <div style={{ padding: "3rem 0", textAlign: "center", color: "#5d5e65" }}>
                  <Loader2 size={20} style={{ animation: "spin 1s linear infinite", marginBottom: 12 }} />
                  <p style={{ fontSize: 12, letterSpacing: "0.05em", textTransform: "uppercase" }}>Loading schedules…</p>
                </div>
              ) : schedules.length === 0 ? (
                <div style={{
                  padding: "3.5rem 2rem", textAlign: "center",
                  border: "1px dashed #c4c4c4", backgroundColor: "#fafafa",
                }}>
                  <Clock size={22} style={{ color: "#ba0816", margin: "0 auto 14px" }} />
                  <p style={{ fontSize: 14, fontWeight: 600, color: "#292b35", marginBottom: 6 }}>No schedules yet</p>
                  <p style={{ fontSize: 12, color: "#5d5e65", marginBottom: 20 }}>
                    Create a schedule to email report digests automatically — daily, weekly or monthly.
                  </p>
                  <button onClick={handleNew} className="ar-btn" style={{ padding: "12px 22px 10px" }}>
                    <Plus size={12} /> New Schedule
                  </button>
                </div>
              ) : (
                <div className="grid gap-4">
                  {schedules.map((s) => (
                    <ScheduleCard
                      key={s.id}
                      schedule={s}
                      busy={busyId === s.id}
                      onEdit={() => handleEdit(s)}
                      onDelete={() => handleDelete(s)}
                      onSendNow={() => handleSendNow(s)}
                      onToggle={() => handleToggleEnabled(s)}
                      onHistory={() => setHistoryFor(s)}
                    />
                  ))}
                </div>
              )}
            </>
          )}
        </div>
      </div>

      {historyFor && (
        <HistoryDrawer schedule={historyFor} onClose={() => setHistoryFor(null)} />
      )}
    </div>
  );
}

// ─── Schedule card ──────────────────────────────────────────────────────────────

function ScheduleCard({ schedule: s, busy, onEdit, onDelete, onSendNow, onToggle, onHistory }: {
  schedule: ScheduleConfig;
  busy: boolean;
  onEdit: () => void;
  onDelete: () => void;
  onSendNow: () => void;
  onToggle: () => void;
  onHistory: () => void;
}) {
  const statusOk = s.lastStatus === "success";
  const statusErr = s.lastStatus === "error";

  return (
    <div style={{ backgroundColor: "#ffffff", border: "1px solid #e2e2e2", borderTop: `3px solid ${s.enabled ? "#ba0816" : "#c4c4c4"}` }}>
      <div style={{ padding: "18px 20px 0" }}>
        <div className="flex items-start justify-between gap-4">
          <div style={{ minWidth: 0 }}>
            <div className="flex items-center gap-2 flex-wrap">
              <span style={{
                fontSize: 10, fontWeight: 600, letterSpacing: "0.09375rem", textTransform: "uppercase",
                padding: "3px 8px",
                backgroundColor: s.reportType === "appsec" ? "#1c1f2a" : "#ba0816",
                color: "#f4f4f4",
              }}>
                {s.reportType === "custom-dashboard" ? "Custom Dashboard" : s.reportType === "appsec" ? "App Security" : s.reportType === "magic-transit" ? "Magic Transit" : "Cloudflare One"}
              </span>
              {!s.enabled && (
                <span style={{ fontSize: 10, letterSpacing: "0.09375rem", textTransform: "uppercase", color: "#5d5e65", padding: "3px 0" }}>
                  Paused
                </span>
              )}
            </div>
            <h3 style={{ margin: "10px 0 0", fontSize: 16, fontWeight: 700, color: "#292b35", letterSpacing: "-0.01em" }}>
              {s.name}
            </h3>
            <p style={{ margin: "6px 0 0", fontSize: 12, color: "#5d5e65" }}>
              {describeSchedule(s)} · {describeRange(s)} report
              {(s.reportType === "appsec" || s.reportType === "custom-dashboard") && s.zoneName ? ` · ${s.zoneName}` : ""}
              {s.apiTokenSet && (
                <span title={`Uses its own Cloudflare credentials${s.accountId ? ` (account ${s.accountId})` : ""} — token ${s.apiTokenHint ?? ""}`}
                  style={{
                    display: "inline-flex", alignItems: "center", gap: 3, marginLeft: 6,
                    padding: "1px 7px", fontSize: 10, borderRadius: 999,
                    border: "1px solid #b6d4f8", backgroundColor: "#e7f1fb", color: "#1c4d8c",
                  }}>
                  <KeyRound size={9} /> own credentials
                </span>
              )}
            </p>
            <p style={{ margin: "6px 0 0", fontSize: 12, color: "#5d5e65", display: "flex", alignItems: "center", gap: 5, flexWrap: "wrap" }}>
              <Mail size={11} style={{ flexShrink: 0 }} />
              {s.recipients.join(", ")}
            </p>
            {s.enabled && (() => {
              const nextMs = nextOccurrenceMs(s, Date.now());
              return nextMs !== null ? (
                <p style={{ margin: "8px 0 0", fontSize: 11, display: "flex", alignItems: "center", gap: 5 }}>
                  <Clock size={11} style={{ color: "#ba0816", flexShrink: 0 }} />
                  <span style={{ color: "#5d5e65" }}>
                    Next run {formatNextRun(nextMs, s.tzOffset ?? 0)}
                  </span>
                </p>
              ) : null;
            })()}
            {(s.lastRunAt || s.lastStatus) && (
              <p style={{ margin: "8px 0 0", fontSize: 11, display: "flex", alignItems: "center", gap: 5 }}>
                {statusOk && <CheckCircle size={11} style={{ color: "#15803d" }} />}
                {statusErr && <AlertCircle size={11} style={{ color: "#d51121" }} />}
                <span style={{ color: "#5d5e65" }}>
                  {s.lastRunAt
                    ? <>Last run {new Date(s.lastRunAt).toLocaleString()} — {s.lastStatus}</>
                    : <>Last test send — {s.lastStatus}</>}
                  {statusErr && s.lastError ? `: ${s.lastError}` : ""}
                </span>
              </p>
            )}
          </div>

          {/* Enable toggle */}
          <button onClick={onToggle} title={s.enabled ? "Pause schedule" : "Resume schedule"}
            style={{
              flexShrink: 0, width: 42, height: 22, borderRadius: 999, cursor: "pointer",
              border: "none", position: "relative",
              backgroundColor: s.enabled ? "#ba0816" : "#c4c4c4",
              transition: "background-color 0.15s",
            }}>
            <span style={{
              position: "absolute", top: 2, left: s.enabled ? 22 : 2, width: 18, height: 18,
              borderRadius: 999, backgroundColor: "#ffffff", transition: "left 0.15s",
              display: "block",
            }} />
          </button>
        </div>
      </div>

      <div style={{ padding: "14px 20px 16px", display: "flex", gap: 8, flexWrap: "wrap", borderTop: "1px solid #f0f0f0", marginTop: 14 }}>
        <button onClick={onEdit} className="ar-btn-ghost" style={{ padding: "9px 14px 7px", fontSize: 10 }}>
          <Pencil size={11} /> Edit
        </button>
        <button onClick={onHistory} className="ar-btn-ghost" style={{ padding: "9px 14px 7px", fontSize: 10 }}>
          <History size={11} /> History
        </button>
        <button onClick={onDelete} className="ar-btn-ghost" style={{ padding: "9px 14px 7px", fontSize: 10, color: "#d51121" }}>
          <Trash2 size={11} /> Delete
        </button>
        <button onClick={onSendNow} disabled={busy} className="ar-btn" style={{ padding: "10px 16px 8px", fontSize: 10, marginLeft: "auto" }}>
          {busy
            ? <><Loader2 size={11} style={{ animation: "spin 1s linear infinite" }} /> Generating & sending…</>
            : <><Send size={11} /> Send test now</>}
        </button>
      </div>
    </div>
  );
}

// ─── Create / edit form ─────────────────────────────────────────────────────────

function configToInput(s: ScheduleConfig, enabledOverride?: boolean): ScheduleInput {
  return {
    name: s.name,
    reportType: s.reportType,
    zoneId: s.zoneId,
    zoneName: s.zoneName,
    days: s.days,
    tzOffset: s.tzOffset,
    rangeMode: s.rangeMode,
    sinceDate: s.sinceDate ?? null,
    untilDate: s.untilDate ?? null,
    sinceTime: s.sinceTime ?? null,
    untilTime: s.untilTime ?? null,
    monthsAgo: s.monthsAgo ?? null,
    period: s.period as ReportPeriod | null,
    frequency: s.frequency,
    dayOfWeek: s.dayOfWeek,
    dayOfMonth: s.dayOfMonth,
    sendHourUtc: s.sendHourUtc,
    recipients: s.recipients,
    subject: s.subject,
    message: s.message,
    isPoc: s.isPoc,
    clientName: s.clientName,
    clientLogo: s.clientLogo,
    enabled: enabledOverride ?? s.enabled,
    accountId: s.accountId,
    dashboardTemplate: s.dashboardTemplate ?? null,
  };
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function ScheduleForm({ initial, zones, zonesError, loadingZones, onRetryZones, onCancel, onSaved }: {
  initial: ScheduleConfig | null;
  /** Zone list fetched (and cached) by the page via the backend-bound token. */
  zones: ZoneOption[] | null;
  zonesError: string;
  loadingZones: boolean;
  onRetryZones: () => void;
  onCancel: () => void;
  onSaved: (s: ScheduleConfig) => void | Promise<void>;
}) {
  const [name, setName] = useState(initial?.name ?? "");
  const [reportType, setReportType] = useState<ScheduleReportType>(initial?.reportType ?? "appsec");
  const [dashboardTemplate, setDashboardTemplate] = useState(initial?.dashboardTemplate ?? defaultDashboardTemplate());
  const [dashboardBlocked, setDashboardBlocked] = useState(false);
  const [zoneId, setZoneId] = useState(initial?.zoneId ?? "");
  const [zoneName, setZoneName] = useState(initial?.zoneName ?? "");
  const [days, setDays] = useState<number>(initial?.days ?? 30);
  const [rangeMode, setRangeMode] = useState<ReportRangeMode>(initial?.rangeMode ?? "rolling");
  const [monthsAgo, setMonthsAgo] = useState<number>(initial?.monthsAgo ?? 1);
  const [period, setPeriod] = useState<ReportPeriod>((initial?.period as ReportPeriod) ?? "yesterday");
  const [sinceDate, setSinceDate] = useState<string>(initial?.sinceDate ?? "");
  const [untilDate, setUntilDate] = useState<string>(initial?.untilDate ?? "");
  const [sinceTime, setSinceTime] = useState<string>(initial?.sinceTime ?? "");
  const [untilTime, setUntilTime] = useState<string>(initial?.untilTime ?? "");
  const [frequency, setFrequency] = useState<ScheduleFrequency>(initial?.frequency ?? "weekly");
  const [dayOfWeek, setDayOfWeek] = useState<number>(initial?.dayOfWeek ?? 1);
  const [dayOfMonth, setDayOfMonth] = useState<number>(initial?.dayOfMonth ?? 1);
  // The schedule's timezone is fixed at creation (creator's browser zone) and
  // preserved across edits, so "Monday 03:00 GMT+7" can't silently drift when
  // someone in another timezone edits the form.
  const tzOffset = initial?.tzOffset ?? new Date().getTimezoneOffset();
  const [localHour, setLocalHour] = useState<number>(initial ? utcHourToLocal(initial.sendHourUtc, tzOffset) : 8);
  const [recipients, setRecipients] = useState<string[]>(initial?.recipients ?? []);
  const [recipientInput, setRecipientInput] = useState("");
  const [subject, setSubject] = useState(initial?.subject ?? "");
  const [message, setMessage] = useState(initial?.message ?? "");
  const [isPoc, setIsPoc] = useState(initial?.isPoc ?? true);
  const [clientName, setClientName] = useState(initial?.clientName ?? "");
  // Client branding — same rules as the on-demand form: data URI ≤2MB,
  // PNG/JPG/SVG/WebP. Stored on the schedule; rendered on the email cover
  // and the attached on-demand report.
  const [clientLogo, setClientLogo] = useState(initial?.clientLogo ?? "");
  const [logoFileName, setLogoFileName] = useState(initial?.clientLogo ? "stored logo" : "");
  const logoInputRef = useRef<HTMLInputElement>(null);
  function handleLogoUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.size > 2 * 1024 * 1024) { setFormError("Logo must be under 2MB"); return; }
    if (!["image/png", "image/jpeg", "image/svg+xml", "image/webp"].includes(file.type)) {
      setFormError("Only PNG, JPG, SVG, or WebP logos are supported");
      return;
    }
    setLogoFileName(file.name);
    const reader = new FileReader();
    reader.onload = () => { setClientLogo(reader.result as string); setFormError(""); };
    reader.readAsDataURL(file);
  }
  const [enabled, setEnabled] = useState(initial?.enabled ?? true);

  // Per-schedule customer credentials (multi-customer). The stored token is
  // write-only — the form never receives its value, so edits that don't touch
  // credentials send no apiToken field (server keeps the stored one), while
  // an explicit Remove sends apiToken: null.
  const [apiToken, setApiToken] = useState("");
  const [removeToken, setRemoveToken] = useState(false);
  const [accountId, setAccountId] = useState(initial?.accountId ?? "");
  const [credBusy, setCredBusy] = useState<"" | "test" | "zones">("");
  const [credNote, setCredNote] = useState<{ kind: "ok" | "err"; text: string } | null>(null);
  // Zones listed with the typed customer credentials — replaces the backend
  // list for this form session once loaded.
  const [custZones, setCustZones] = useState<ZoneOption[] | null>(null);

  const [formError, setFormError] = useState("");
  const [saving, setSaving] = useState(false);

  // Local "today" as YYYY-MM-DD for the date inputs' max attribute. The
  // backend re-validates in the schedule's own timezone and returns a
  // precise error if the range is out of bounds there.
  const todayLocalStr = () => {
    const n = new Date();
    return new Date(n.getTime() - n.getTimezoneOffset() * 60000).toISOString().split("T")[0];
  };

  function addRecipient(raw: string) {
    // Split pasted lists — "a@x.com, b@y.com; c@z.com" adds all three.
    const tokens = raw.split(/[,;\s]+/).map((t) => t.trim().toLowerCase()).filter(Boolean);
    if (tokens.length === 0) return;

    const invalid = tokens.find((t) => !EMAIL_RE.test(t));
    if (invalid) { setFormError(`"${invalid}" is not a valid email address.`); return; }

    const next = [...recipients];
    for (const t of tokens) {
      if (!next.includes(t)) next.push(t);
    }
    if (next.length > 50) { setFormError("Maximum 50 recipients per schedule."); return; }

    setRecipients(next);
    setRecipientInput("");
    setFormError("");
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setFormError("");

    if (!name.trim()) { setFormError("Schedule name is required."); return; }
    if ((reportType === "appsec" || reportType === "custom-dashboard") && !zoneId) { setFormError("Select a zone for the report."); return; }
    if (reportType === "custom-dashboard") {
      if (dashboardBlocked) { setFormError("Select a supported saved dashboard, or explicitly choose Configure query template."); return; }
      try { validateDashboardTemplate(dashboardTemplate); }
      catch (e) { setFormError(e instanceof Error ? e.message : "Invalid dashboard template"); return; }
    }
    if (recipients.length === 0) { setFormError("Add at least one recipient email address."); return; }
    if (!subject.trim()) { setFormError("Email subject is required."); return; }
    if (rangeMode === "custom") {
      const n = new Date();
      const todayStr = new Date(n.getTime() - n.getTimezoneOffset() * 60000).toISOString().split("T")[0];
      const sv = /^\d{4}-\d{2}-\d{2}$/.test(sinceDate) ? new Date(sinceDate + "T00:00:00") : null;
      const uv = /^\d{4}-\d{2}-\d{2}$/.test(untilDate) ? new Date(untilDate + "T00:00:00") : null;
      if (!sinceDate || !untilDate) { setFormError("Pick a start and end date for the custom range."); return; }
      if (!sv || !uv) { setFormError("Custom range dates must be valid (YYYY-MM-DD)."); return; }
      if (uv < sv) { setFormError("The end date can't be before the start date."); return; }
      if (sinceDate === untilDate && sinceTime && untilTime && untilTime < sinceTime) { setFormError("The end time can't be before the start time on the same day."); return; }
      if (sinceTime && !/^([01]\d|2[0-3]):[0-5]\d$/.test(sinceTime)) { setFormError("Start time must be a valid HH:MM (24h)."); return; }
      if (untilTime && !/^([01]\d|2[0-3]):[0-5]\d$/.test(untilTime)) { setFormError("End time must be a valid HH:MM (24h)."); return; }
      if (untilDate > todayStr) { setFormError("The end date can't be in the future."); return; }
      if (Math.round((uv.getTime() - sv.getTime()) / 86400000) + 1 > 366) { setFormError("Custom range can't exceed 366 days."); return; }
    }

    const selectedZone = (custZones ?? zones ?? []).find((z) => z.id === zoneId);
    const input: ScheduleInput = {
      name: name.trim(),
      reportType,
      zoneId: reportType === "appsec" || reportType === "custom-dashboard" ? zoneId : null,
      zoneName: reportType === "appsec" || reportType === "custom-dashboard" ? (selectedZone?.name ?? zoneName ?? null) : null,
      dashboardTemplate: reportType === "custom-dashboard" ? validateDashboardTemplate(dashboardTemplate) : null,
      days,
      tzOffset,
      rangeMode,
      sinceDate: rangeMode === "custom" ? sinceDate : null,
      untilDate: rangeMode === "custom" ? untilDate : null,
      sinceTime: rangeMode === "custom" && sinceTime ? sinceTime : null,
      untilTime: rangeMode === "custom" && untilTime ? untilTime : null,
      monthsAgo: rangeMode === "calendar_month" ? monthsAgo : null,
      period: rangeMode === "period" ? period : null,
      frequency,
      dayOfWeek: frequency === "weekly" ? dayOfWeek : null,
      dayOfMonth: frequency === "monthly" ? dayOfMonth : null,
      sendHourUtc: localHourToUtc(localHour, tzOffset),
      recipients,
      subject: subject.trim(),
      message,
      isPoc,
      clientName: clientName.trim() || null,
      clientLogo: clientLogo || null,
      enabled,
      accountId: accountId.trim() || null,
      ...(apiToken ? { apiToken: apiToken.trim() } : {}),
      ...(removeToken && !apiToken ? { apiToken: null } : {}),
    };

    setSaving(true);
    try {
      const saved = initial ? await updateSchedule(initial.id, input) : await createSchedule(input);
      await onSaved(saved);
    } catch (err) {
      setFormError(err instanceof Error ? err.message : "Failed to save schedule.");
    } finally {
      setSaving(false);
    }
  }

  const hours = Array.from({ length: 24 }, (_, i) => i);

  return (
    <form onSubmit={handleSubmit} style={{ backgroundColor: "#ffffff", border: "1px solid #e2e2e2", borderTop: "3px solid #ba0816", padding: 28 }}>

      <div className="flex items-center gap-3 mb-6">
        <div style={{ width: 40, height: 2, backgroundColor: "#ba0816" }} />
        <span style={{ fontSize: 11, letterSpacing: "0.09375rem", textTransform: "uppercase", color: "#5d5e65" }}>
          {initial ? "Edit Schedule" : "New Schedule"}
        </span>
      </div>

      {formError && (
        <div className="flex items-start gap-3 mb-6 p-4" style={{ backgroundColor: "#fef2f2", border: "1px solid #fecaca" }}>
          <AlertCircle size={14} style={{ color: "#d51121", flexShrink: 0, marginTop: 1 }} />
          <p style={{ fontSize: 12, color: "#7f1d1d" }}>{formError}</p>
        </div>
      )}

      <div className="grid grid-cols-1 gap-6">

        {/* Name */}
        <div>
          <label className="ar-input-label"><Clock size={10} style={{ display: "inline", marginRight: 4 }} /> Schedule Name</label>
          <input type="text" value={name} onChange={(e) => setName(e.target.value)}
            placeholder="e.g. Weekly AppSec digest — example.com" className="ar-input" maxLength={120} />
        </div>

        {/* Report type */}
        <div>
          <label className="ar-input-label"><Shield size={10} style={{ display: "inline", marginRight: 4 }} /> Report Type</label>
          <div style={{ display: "flex", gap: 0, flexWrap: "wrap" }}>
            {(["appsec", "zero-trust", "magic-transit", "custom-dashboard"] as const).map((p) => (
              <button key={p} type="button" onClick={() => setReportType(p)}
                style={{
                  padding: "14px 28px 12px", flex: 1,
                  fontSize: 11, fontWeight: 400, letterSpacing: "0.09375rem",
                  textTransform: "uppercase" as const, cursor: "pointer",
                  border: "1px solid",
                  borderColor: reportType === p ? "#ba0816" : "#c4c4c4",
                  backgroundColor: reportType === p ? "#ba0816" : "transparent",
                  color: reportType === p ? "#ffffff" : "#5d5e65",
                  transition: "all 0.15s", marginRight: -1,
                }}>
                {p === "custom-dashboard" ? "Custom Dashboard" : p === "appsec" ? "App Security" : p === "magic-transit" ? "Magic Transit" : "Cloudflare One"}
              </button>
            ))}
          </div>
        </div>

        {/* Per-schedule customer credentials (multi-customer) */}
        {reportType === "custom-dashboard" && <p className="text-xs mb-4">Use an Analytics Read token with access to this zone; add Zone Read to list zones. Each run fetches fresh analytics and attaches PDF + HTML. The Worker needs a Browser Rendering binding or operator PDF API credentials.</p>}
        {reportType === "magic-transit" && <p className="text-xs text-cf-gray-500">Magic Transit uses account-scoped credentials with Account Analytics Read. Add Magic Transit Read for tunnel/route configuration and product-specific read permissions for policy sections. The full visual report is attached as HTML; dates use this schedule's timezone.</p>}
        <div style={{ backgroundColor: "#fafafa", border: "1px solid #e2e2e2", padding: 16, marginBottom: 16 }}>
          <div className="flex items-center gap-2 mb-1">
            <KeyRound size={11} style={{ color: "#5d5e65" }} />
            <span style={{ fontSize: 11, letterSpacing: "0.09375rem", textTransform: "uppercase", color: "#5d5e65" }}>
              Customer Cloudflare Credentials (optional)
            </span>
          </div>
          <p style={{ fontSize: 11, color: "#5d5e65", lineHeight: 1.5, marginBottom: 12 }}>
            Use this schedule for a different Cloudflare customer than the backend account: paste their API token
            (and Account ID for Zero Trust reports). Falls back to the backend credentials in Settings when blank.
          </p>

          {initial?.apiTokenSet && !removeToken && (
            <p style={{ fontSize: 11, color: "#5d5e65", marginBottom: 12, display: "flex", alignItems: "center", gap: 6 }}>
              <CheckCircle size={11} style={{ color: "#16a34a", flexShrink: 0 }} />
              A customer token is stored ({initial.apiTokenHint}). Leave blank to keep it.
            </p>
          )}

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-3">
            <div>
              <label className="ar-input-label"><KeyRound size={10} style={{ display: "inline", marginRight: 4 }} /> API Token</label>
              <input
                type="password" value={apiToken} autoComplete="new-password" disabled={removeToken}
                onChange={(e) => { setApiToken(e.target.value); setCredNote(null); }}
                placeholder={removeToken ? "Will be removed on save" : "Customer's Cloudflare API token"}
                className="ar-input" maxLength={500} style={removeToken ? { opacity: 0.5, cursor: "not-allowed" } : undefined}
              />
            </div>
            <div>
              <label className="ar-input-label"><User size={10} style={{ display: "inline", marginRight: 4 }} /> Account ID (optional)</label>
              <input
                type="text" value={accountId}
                onChange={(e) => { setAccountId(e.target.value); setCredNote(null); }}
                placeholder="Customer's Account ID — defaults to the backend account"
                className="ar-input" maxLength={64}
              />
            </div>
          </div>

          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
            <button type="button" disabled={!apiToken.trim() || credBusy !== ""}
              onClick={async () => {
                setCredBusy("test"); setCredNote(null);
                try {
                  const r = await testCredentials(apiToken.trim(), accountId.trim() || null);
                  setCredNote({
                    kind: "ok",
                    text: r.accountName
                      ? `Token valid — account "${r.accountName}", ${r.zonesVisible ?? "?"} zones visible.`
                      : `Token valid.${r.accountSkipped ? " " + r.accountSkipped : ""}`,
                  });
                } catch (e) {
                  setCredNote({ kind: "err", text: e instanceof Error ? e.message : "Credential test failed." });
                } finally { setCredBusy(""); }
              }}
              className="ar-btn-ghost" style={{ padding: "7px 12px 5px", fontSize: 10 }}>
              {credBusy === "test" ? <Loader2 size={10} style={{ animation: "spin 1s linear infinite" }} /> : <CheckCircle size={10} />} Test credentials
            </button>
            <button type="button" disabled={!apiToken.trim() || credBusy !== ""}
              onClick={async () => {
                setCredBusy("zones"); setCredNote(null);
                try {
                  const z = await fetchScheduleZonesWithCredentials(apiToken.trim(), accountId.trim() || null);
                  setCustZones(z);
                  setCredNote({ kind: "ok", text: `Listed ${z.length} zone${z.length === 1 ? "" : "s"} with the customer's token — the picker below now shows them.` });
                } catch (e) {
                  setCredNote({ kind: "err", text: e instanceof Error ? e.message : "Failed to list zones." });
                } finally { setCredBusy(""); }
              }}
              className="ar-btn-ghost" style={{ padding: "7px 12px 5px", fontSize: 10 }}>
              {credBusy === "zones" ? <Loader2 size={10} style={{ animation: "spin 1s linear infinite" }} /> : <Globe size={10} />} Load their zones
            </button>
            {initial?.apiTokenSet && (
              <button type="button" disabled={credBusy !== "" || !!apiToken}
                onClick={() => { setRemoveToken(!removeToken); setCredNote(null); }}
                className="ar-btn-ghost" style={{ padding: "7px 12px 5px", fontSize: 10, color: removeToken ? "#16a34a" : undefined }}>
                <X size={10} /> {removeToken ? "Keep stored token" : "Remove stored token"}
              </button>
            )}
            {credNote && (
              <p style={{
                fontSize: 11, flexBasis: "100%",
                color: credNote.kind === "ok" ? "#166534" : "#d51121",
                display: "flex", alignItems: "center", gap: 6, marginBottom: 0,
              }}>
                {credNote.kind === "ok" ? <CheckCircle size={11} /> : <AlertCircle size={11} />} {credNote.text}
              </p>
            )}
          </div>
        </div>

        {/* Zone picker (appsec) */}
        {(reportType === "appsec" || reportType === "custom-dashboard") && (
          <div>
            <label className="ar-input-label">
              <Globe size={10} style={{ display: "inline", marginRight: 4 }} /> Select Zone
            </label>
            {loadingZones && !custZones ? (
              <div style={{ padding: "12px 0", color: "#5d5e65", fontSize: 12, display: "flex", alignItems: "center", gap: 8 }}>
                <Loader2 size={12} style={{ animation: "spin 1s linear infinite" }} /> Loading zones (backend token)…
              </div>
            ) : zonesError && !custZones ? (
              <div className="p-4" style={{ backgroundColor: "#fef2f2", border: "1px solid #fecaca" }}>
                <p style={{ fontSize: 12, color: "#7f1d1d", marginBottom: 8 }}>{zonesError}</p>
                <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
                  <p style={{ fontSize: 11, color: "#5d5e65", display: "flex", alignItems: "center", gap: 6 }}>
                    <KeyRound size={11} /> Backend credentials aren't configured or valid — set them in Scheduled Reports → Settings (the gear above), or, for a customer schedule, paste their API token in the Customer Credentials block and click “Load their zones”.
                  </p>
                  <button type="button" onClick={onRetryZones} className="ar-btn-ghost" style={{ padding: "7px 12px 5px", fontSize: 10 }}>
                    <Loader2 size={10} /> Retry
                  </button>
                </div>
              </div>
            ) : (
              <select value={zoneId} onChange={(e) => setZoneId(e.target.value)} className="ar-input" style={{ cursor: "pointer" }}>
                <option value="">— Select a zone —</option>
                {(custZones ?? zones ?? []).map((z) => (
                  <option key={z.id} value={z.id}>{z.name} ({z.plan})</option>
                ))}
                {/* Keep a previously saved zone selectable even if not in the current list */}
                {zoneId && !(custZones ?? zones ?? []).some((z) => z.id === zoneId) && (
                  <option value={zoneId}>{zoneName || zoneId} (saved)</option>
                )}
              </select>
            )}
          </div>
        )}

        {reportType === "custom-dashboard" && <div className="cd-fields">
          <label>Dashboard zone ID (manual)<input className="ar-input" value={zoneId} maxLength={32} onChange={e => setZoneId(e.target.value)} /></label>
          <label>Dashboard zone label<input className="ar-input" value={zoneName} maxLength={200} placeholder="example.com" onChange={e => setZoneName(e.target.value)} /></label>
        </div>}
        {reportType === "custom-dashboard" && <div><SavedDashboardSelector credentials={{ apiToken: removeToken ? null : apiToken.trim() || undefined, accountId: accountId.trim() || undefined, scheduleId: initial?.id }} zoneId={zoneId} value={dashboardTemplate} onChange={setDashboardTemplate} onBlockedChange={setDashboardBlocked} /><DashboardTemplateEditor value={dashboardTemplate} onChange={setDashboardTemplate} /></div>}

        {/* Timeframe */}
        <div>
          <label className="ar-input-label"><Calendar size={10} style={{ display: "inline", marginRight: 4 }} /> Report Timeframe</label>
          <div style={{ display: "flex", gap: 0 }}>
            {TIMEFRAME_OPTIONS.map((d) => (
              <button key={d} type="button" onClick={() => { setDays(d); setRangeMode("rolling"); }}
                style={{
                  flex: 1, padding: "13px 6px 11px",
                  fontSize: 11, fontWeight: 400, letterSpacing: "0.09375rem",
                  textTransform: "uppercase" as const, cursor: "pointer",
                  border: "1px solid",
                  borderColor: rangeMode === "rolling" && days === d ? "#ba0816" : "#c4c4c4",
                  backgroundColor: rangeMode === "rolling" && days === d ? "#ba0816" : "transparent",
                  color: rangeMode === "rolling" && days === d ? "#ffffff" : "#5d5e65",
                  marginRight: -1, transition: "all 0.15s", textAlign: "center" as const,
                }}>
                {d === 1 ? "1 Day" : `${d} Days`}
              </button>
            ))}
            <button type="button" onClick={() => setRangeMode("calendar_month")}
              style={{
                flex: 1, padding: "13px 6px 11px",
                fontSize: 11, fontWeight: 400, letterSpacing: "0.09375rem",
                textTransform: "uppercase" as const, cursor: "pointer",
                border: "1px solid",
                borderColor: rangeMode === "calendar_month" ? "#ba0816" : "#c4c4c4",
                backgroundColor: rangeMode === "calendar_month" ? "#ba0816" : "transparent",
                color: rangeMode === "calendar_month" ? "#ffffff" : "#5d5e65",
                transition: "all 0.15s", textAlign: "center" as const,
              }}>
              Month
            </button>
            <button type="button" onClick={() => setRangeMode("period")}
              style={{
                flex: 1, padding: "13px 6px 11px",
                fontSize: 11, fontWeight: 400, letterSpacing: "0.09375rem",
                textTransform: "uppercase" as const, cursor: "pointer",
                border: "1px solid",
                borderColor: rangeMode === "period" ? "#ba0816" : "#c4c4c4",
                backgroundColor: rangeMode === "period" ? "#ba0816" : "transparent",
                color: rangeMode === "period" ? "#ffffff" : "#5d5e65",
                transition: "all 0.15s", textAlign: "center" as const,
              }}>
              Period
            </button>
            <button type="button" onClick={() => setRangeMode("custom")}
              style={{
                flex: 1, padding: "13px 6px 11px",
                fontSize: 11, fontWeight: 400, letterSpacing: "0.09375rem",
                textTransform: "uppercase" as const, cursor: "pointer",
                border: "1px solid",
                borderColor: rangeMode === "custom" ? "#ba0816" : "#c4c4c4",
                backgroundColor: rangeMode === "custom" ? "#ba0816" : "transparent",
                color: rangeMode === "custom" ? "#ffffff" : "#5d5e65",
                transition: "all 0.15s", textAlign: "center" as const,
              }}>
              Custom
            </button>
          </div>
          {rangeMode === "period" && (
            <>
            <div style={{ marginTop: 8, display: "flex", gap: 0 }}>
              {([
                { value: "yesterday", label: "Daily — yesterday" },
                { value: "last_week", label: "Weekly — last Mon–Sun" },
                { value: "last_month", label: "Monthly — last month" },
              ] as const).map((opt) => (
                <button key={opt.value} type="button" onClick={() => setPeriod(opt.value)}
                  style={{
                    flex: 1, padding: "10px 6px 8px",
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
            <p style={{ marginTop: 8, fontSize: 11, color: "#5d5e65", lineHeight: 1.5 }}>
              Reports the last COMPLETE period in the schedule's timezone ({tzLabel(tzOffset)}) — Daily covers
              yesterday 00:00:00–23:59:59, Weekly the previous Monday–Sunday, Monthly the previous calendar month
              (real 28–31 days). The window is computed at send time, so "yesterday" is always the day before the
              report fires — pair a Daily period with an early-morning send hour for a true "yesterday report".
            </p>
            </>
          )}
          {rangeMode === "calendar_month" && (
            <div style={{ marginTop: 8, display: "flex", gap: 8, alignItems: "center" }}>
              <select
                value={monthsAgo}
                onChange={(e) => setMonthsAgo(Number(e.target.value))}
                className="ar-input"
                style={{ appearance: "none", paddingRight: 36, cursor: "pointer", flex: 1 }}
              >
                {monthOptionsBack().map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}{o.value === 1 ? " (last month)" : ""}
                  </option>
                ))}
              </select>
              <p style={{ fontSize: 11, color: "#5d5e65", margin: 0, flex: 1.6, lineHeight: 1.5 }}>
                Full calendar month (28–31 days) — recommended for monthly-frequency schedules.
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
              <p style={{ fontSize: 11, color: "#5d5e65", marginTop: 6, marginBottom: 0 }}>
                Exact period in the schedule's timezone ({tzLabel(tzOffset)}); times are optional (default 00:00 → 23:59, end inclusive). Request-level breakdowns (TLS/PQC, WAF, bots, AI crawlers, DNS analytics, countries, browsers, status codes, content types, top IPs/ASNs…) follow the exact window — sampled like Cloudflare's own dashboard; only the daily overview + error charts cover whole days. Fine-grained data only reaches ~30 days back.
              </p>
            </div>
          )}
          {rangeMode === "rolling" && frequency === "monthly" ? (
            <p style={{ fontSize: 11, color: "#b45309", marginTop: 6 }}>
              A fixed {days}-day window won't line up with every calendar month (28-31 days) — consider "Month" above for a true month-to-month report.
            </p>
          ) : null}
        </div>

        {/* Frequency */}
        <div>
          <label className="ar-input-label"><Clock size={10} style={{ display: "inline", marginRight: 4 }} /> Schedule</label>
          <div style={{ display: "flex", gap: 0, marginBottom: 12 }}>
            {(["daily", "weekly", "monthly"] as const).map((f) => (
              <button key={f} type="button" onClick={() => setFrequency(f)}
                style={{
                  flex: 1, padding: "13px 8px 11px",
                  fontSize: 11, fontWeight: 400, letterSpacing: "0.09375rem",
                  textTransform: "uppercase" as const, cursor: "pointer",
                  border: "1px solid",
                  borderColor: frequency === f ? "#ba0816" : "#c4c4c4",
                  backgroundColor: frequency === f ? "#ba0816" : "transparent",
                  color: frequency === f ? "#ffffff" : "#5d5e65",
                  marginRight: -1, transition: "all 0.15s", textAlign: "center" as const,
                }}>
                {f}
              </button>
            ))}
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            {frequency === "weekly" && (
              <select value={dayOfWeek} onChange={(e) => setDayOfWeek(Number(e.target.value))} className="ar-input" style={{ cursor: "pointer" }}>
                {WEEKDAYS.map((d, i) => <option key={d} value={i}>{d}</option>)}
              </select>
            )}
            {frequency === "monthly" && (
              <select value={dayOfMonth} onChange={(e) => setDayOfMonth(Number(e.target.value))} className="ar-input" style={{ cursor: "pointer" }}>
                {MONTH_DAYS.map((d) => <option key={d} value={d}>Day {d} of the month</option>)}
              </select>
            )}
            <select value={localHour} onChange={(e) => setLocalHour(Number(e.target.value))} className="ar-input" style={{ cursor: "pointer" }}>
              {hours.map((h) => (
                <option key={h} value={h}>
                  {String(h).padStart(2, "0")}:00 schedule time ({tzLabel(tzOffset)})
                </option>
              ))}
            </select>
          </div>
        </div>

        {/* Recipients */}
        <div>
          <label className="ar-input-label"><Mail size={10} style={{ display: "inline", marginRight: 4 }} /> Recipients</label>
          <div style={{ display: "flex", gap: 0 }}>
            <input
              type="email" value={recipientInput}
              onChange={(e) => setRecipientInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === ",") { e.preventDefault(); addRecipient(recipientInput); }
              }}
              placeholder="name@company.com" className="ar-input" style={{ flex: 1 }}
            />
            <button type="button" onClick={() => addRecipient(recipientInput)} className="ar-btn" style={{ borderLeft: "none", flexShrink: 0 }}>
              Add
            </button>
          </div>
          {recipients.length > 0 && (
            <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginTop: 10 }}>
              {recipients.map((r) => (
                <span key={r} style={{
                  display: "inline-flex", alignItems: "center", gap: 6,
                  padding: "5px 8px 5px 10px", fontSize: 12,
                  backgroundColor: "#1c1f2a", color: "#f4f4f4",
                }}>
                  {r}
                  <button type="button" onClick={() => setRecipients((list) => list.filter((x) => x !== r))}
                    style={{ background: "none", border: "none", cursor: "pointer", color: "rgba(244,244,244,0.6)", display: "flex", padding: 0 }}>
                    <X size={11} />
                  </button>
                </span>
              ))}
            </div>
          )}
          <p style={{ fontSize: 11, color: "#5d5e65", marginTop: 6 }}>
            Press Enter to add — or paste multiple addresses (comma/semicolon separated) to add them all. Max 50.
          </p>
        </div>

        {/* Subject */}
        <div>
          <label className="ar-input-label"><Mail size={10} style={{ display: "inline", marginRight: 4 }} /> Email Subject</label>
          <input type="text" value={subject} onChange={(e) => setSubject(e.target.value)}
            placeholder="e.g. Weekly AppSec Report — {{zone}} ({{date}})" className="ar-input" maxLength={200} />
          <p style={{ fontSize: 11, color: "#5d5e65", marginTop: 4 }}>
            Tokens: <code style={{ fontFamily: "monospace" }}>{"{{zone}}"}</code>, <code style={{ fontFamily: "monospace" }}>{"{{account}}"}</code>, <code style={{ fontFamily: "monospace" }}>{"{{date}}"}</code>
          </p>
        </div>

        {/* Message */}
        <div>
          <label className="ar-input-label"><Mail size={10} style={{ display: "inline", marginRight: 4 }} /> Message (included at the top of the email)</label>
          <textarea value={message} onChange={(e) => setMessage(e.target.value)}
            placeholder="Optional note for the recipients — rendered above the executive summary…"
            className="ar-input" maxLength={5000}
            style={{ minHeight: 96, resize: "vertical", fontFamily: "inherit" }} />
        </div>

        {/* POC framing */}
        {reportType !== "custom-dashboard" && <label style={{
          display: "flex", alignItems: "flex-start", gap: 12,
          padding: "14px 16px", cursor: "pointer",
          border: "1px solid #c4c4c4", backgroundColor: "#fafafa",
        }}>
          <input type="checkbox" checked={isPoc} onChange={(e) => setIsPoc(e.target.checked)}
            style={{ marginTop: 2, width: 16, height: 16, accentColor: "#ba0816", cursor: "pointer", flexShrink: 0 }} />
          <div>
            <span style={{ fontSize: 12, fontWeight: 600, color: "#292b35", display: "block", marginBottom: 2 }}>
              This is a POC (Proof-of-Concept) report
            </span>
            <span style={{ fontSize: 11, color: "#5d5e65", lineHeight: 1.5 }}>
              POC framing for the AI executive summary and recommendations. Uncheck for a neutral assessment tone.
            </span>
          </div>
        </label>}

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          {reportType !== "custom-dashboard" && <div>
            <label className="ar-input-label"><User size={10} style={{ display: "inline", marginRight: 4 }} /> Client Name (optional)</label>
            <input type="text" value={clientName} onChange={(e) => setClientName(e.target.value)}
              placeholder="e.g. Acme Corp" className="ar-input" maxLength={200} />
            <div style={{ marginTop: 8 }}>
              <input ref={logoInputRef} type="file"
                accept="image/png,image/jpeg,image/svg+xml,image/webp"
                onChange={handleLogoUpload} style={{ display: "none" }} />
              <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                <button type="button" onClick={() => logoInputRef.current?.click()}
                  className="ar-btn-ghost" style={{ padding: "8px 12px 6px", fontSize: 10 }}>
                  <Upload size={11} /> {clientLogo ? "Change Logo" : "Upload Logo"}
                </button>
                {clientLogo && (
                  <>
                    <img src={clientLogo} alt="Logo" style={{ height: 28, width: 28, objectFit: "contain" }} />
                    <span style={{ fontSize: 11, color: "#5d5e65" }}>{logoFileName}</span>
                    <button type="button" onClick={() => { setClientLogo(""); setLogoFileName(""); }}
                      style={{ fontSize: 11, color: "#d51121", background: "none", border: "none", cursor: "pointer" }}>
                      Remove
                    </button>
                  </>
                )}
              </div>
              <p style={{ fontSize: 10, color: "#5d5e65", margin: "6px 0 0" }}>
                Shown on the email cover and the attached report (PNG/JPG/SVG/WebP, under 2MB).
              </p>
            </div>
          </div>}
          {initial && (
            <div>
              <label className="ar-input-label"><Clock size={10} style={{ display: "inline", marginRight: 4 }} /> Status</label>
              <label style={{
                display: "flex", alignItems: "center", gap: 12,
                padding: "13px 16px", cursor: "pointer",
                border: "1px solid #c4c4c4", backgroundColor: "#fafafa",
              }}>
                <input type="checkbox" checked={enabled} onChange={(e) => setEnabled(e.target.checked)}
                  style={{ width: 16, height: 16, accentColor: "#ba0816", cursor: "pointer" }} />
                <span style={{ fontSize: 12, color: "#292b35" }}>Enabled — send on schedule</span>
              </label>
            </div>
          )}
        </div>

        {/* Actions */}
        <div style={{ display: "flex", gap: 10, paddingTop: 6 }}>
          <button type="submit" disabled={saving} className="ar-btn" style={{ flex: 1, padding: "15px 24px 13px" }}>
            {saving
              ? <><Loader2 size={13} style={{ animation: "spin 1s linear infinite" }} /> Saving…</>
              : <><CheckCircle size={13} /> {initial ? "Save Changes" : "Create Schedule"}</>}
          </button>
          <button type="button" onClick={onCancel} className="ar-btn-ghost" style={{ padding: "15px 24px 13px" }}>
            Cancel
          </button>
        </div>
      </div>
    </form>
  );
}

// ─── History drawer ─────────────────────────────────────────────────────────────

function HistoryDrawer({ schedule, onClose }: { schedule: ScheduleConfig; onClose: () => void }) {
  const [history, setHistory] = useState<ScheduleHistoryEntry[] | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;
    fetchScheduleHistory(schedule.id)
      .then((h) => { if (!cancelled) setHistory(h); })
      .catch((e) => { if (!cancelled) setError(e instanceof Error ? e.message : "Failed to load history."); });
    return () => { cancelled = true; };
  }, [schedule.id]);

  return (
    <div
      onClick={onClose}
      style={{
        position: "fixed", inset: 0, zIndex: 100,
        backgroundColor: "rgba(28,31,42,0.6)",
        display: "flex", justifyContent: "flex-end",
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          width: "min(440px, 100vw)", height: "100%", overflowY: "auto",
          backgroundColor: "#ffffff", borderLeft: "3px solid #ba0816",
          padding: "28px 26px",
        }}
      >
        <div className="flex items-start justify-between gap-4" style={{ marginBottom: 20 }}>
          <div>
            <div style={{ fontSize: 11, letterSpacing: "0.09375rem", textTransform: "uppercase", color: "#5d5e65", marginBottom: 6 }}>
              Run History
            </div>
            <h3 style={{ margin: 0, fontSize: 16, fontWeight: 700, color: "#292b35" }}>{schedule.name}</h3>
          </div>
          <button onClick={onClose} style={{ background: "none", border: "none", cursor: "pointer", color: "#5d5e65" }}>
            <X size={16} />
          </button>
        </div>

        {error && (
          <div className="p-4 mb-4" style={{ backgroundColor: "#fef2f2", border: "1px solid #fecaca" }}>
            <p style={{ fontSize: 12, color: "#7f1d1d" }}>{error}</p>
          </div>
        )}

        {history === null && !error && (
          <div style={{ padding: "2rem 0", textAlign: "center", color: "#5d5e65" }}>
            <Loader2 size={16} style={{ animation: "spin 1s linear infinite" }} />
          </div>
        )}

        {history?.length === 0 && (
          <p style={{ fontSize: 12, color: "#5d5e65", padding: "1rem 0" }}>
            No runs recorded yet — use “Send test now” or wait for the next scheduled run.
          </p>
        )}

        {history?.map((h) => (
          <div key={h.id} style={{ padding: "12px 0", borderBottom: "1px solid #f0f0f0" }}>
            <div className="flex items-center gap-2">
              {h.status === "success"
                ? <CheckCircle size={12} style={{ color: "#15803d", flexShrink: 0 }} />
                : <AlertCircle size={12} style={{ color: "#d51121", flexShrink: 0 }} />}
              <span style={{ fontSize: 12, fontWeight: 600, color: "#292b35" }}>{h.status}</span>
              <span style={{
                fontSize: 10, textTransform: "uppercase", letterSpacing: "0.05em",
                color: "#ffffff", backgroundColor: h.trigger === "manual" ? "#5d5e65" : "#ba0816",
                padding: "2px 6px", marginLeft: "auto",
              }}>
                {h.trigger}
              </span>
            </div>
            <p style={{ margin: "6px 0 0", fontSize: 11, color: "#5d5e65" }}>
              {new Date(h.startedAt).toLocaleString()}
              {h.messageId ? ` · ${h.messageId.slice(0, 14)}…` : ""}
            </p>
            {h.error && (
              <p style={{ margin: "6px 0 0", fontSize: 11, color: "#d51121", wordBreak: "break-word" }}>{h.error}</p>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
