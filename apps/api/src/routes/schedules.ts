/**
 * Scheduled report configuration — CRUD + manual test send + history.
 *
 *   GET    /api/schedules             — list all schedules
 *   POST   /api/schedules             — create a schedule
 *   PUT    /api/schedules/:id         — update a schedule (full replacement)
 *   DELETE /api/schedules/:id         — delete a schedule
 *   POST   /api/schedules/:id/send    — generate + send now (test)
 *   GET    /api/schedules/:id/history — recent runs
 *
 * Credentials: a schedule may carry its OWN Cloudflare API token + account ID
 * (multi-customer) — stored server-side, write-only through the API (masked to
 * a hint on read). When absent, the backend credentials apply (Settings → D1
 * → CF_API_TOKEN secret / CF_ACCOUNT_ID var). On update, apiToken: undefined
 * keeps the stored token, null clears it (back to backend credentials).
 */

import type { Context } from "hono";
import type { Env, ScheduleRow, ScheduleConfig, ScheduleReportType, ScheduleFrequency, ReportRangeMode } from "../types";
import { runSchedule } from "../scheduler";
import { customDateRange } from "../services/cf-graphql";
import { validateDashboardTemplate, type DashboardTemplate } from "../../../../shared/custom-dashboard-template";

const ALLOWED_DAYS = [1, 3, 5, 7, 14, 30];
const MAX_RECIPIENTS = 50; // Cloudflare Email Sending limit (to + cc + bcc)
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// ─── Row → API shape ──────────────────────────────────────────────────────────

function rowToConfig(row: ScheduleRow): ScheduleConfig {
  let recipients: string[] = [];
  try {
    const parsed = JSON.parse(row.recipients) as unknown;
    if (Array.isArray(parsed)) recipients = parsed.filter((r): r is string => typeof r === "string");
  } catch { /* keep [] */ }

  return {
    id: row.id,
    name: row.name,
    reportType: row.report_type,
    zoneId: row.zone_id,
    zoneName: row.zone_name,
    days: row.days,
    tzOffset: row.tz_offset,
    frequency: row.frequency,
    dayOfWeek: row.day_of_week,
    dayOfMonth: row.day_of_month,
    sendHourUtc: row.send_hour_utc,
    recipients,
    subject: row.subject,
    message: row.message,
    isPoc: row.is_poc === 1,
    clientName: row.client_name,
    enabled: row.enabled === 1,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    lastRunAt: row.last_run_at,
    lastStatus: row.last_status,
    lastError: row.last_error,
    rangeMode: row.range_mode ?? "rolling",
    sinceDate: row.since_date ?? null,
    untilDate: row.until_date ?? null,
    sinceTime: row.since_time ?? null,
    untilTime: row.until_time ?? null,
    monthsAgo: row.months_ago ?? null,
    period: row.period ?? null,
    clientLogo: row.client_logo ?? null,
    // Per-schedule credentials — the token VALUE never leaves the backend.
    apiTokenSet: !!row.api_token,
    apiTokenHint: row.api_token ? `••••••••${row.api_token.slice(-4)}` : null,
    accountId: row.account_id ?? null,
    dashboardTemplate: row.dashboard_template ? validateDashboardTemplate(JSON.parse(row.dashboard_template)) : null,
  };
}

// ─── Input validation (create + update) ────────────────────────────────────────

interface ValidatedSchedule {
  dashboardTemplate: DashboardTemplate | null;
  name: string;
  reportType: ScheduleReportType;
  zoneId: string | null;
  zoneName: string | null;
  days: number;
  tzOffset: number;
  frequency: ScheduleFrequency;
  dayOfWeek: number | null;
  dayOfMonth: number | null;
  sendHourUtc: number;
  recipients: string;
  subject: string;
  message: string;
  isPoc: number;
  clientName: string | null;
  enabled: number;
  rangeMode: ReportRangeMode;
  sinceDate: string | null;
  untilDate: string | null;
  sinceTime: string | null;
  untilTime: string | null;
  monthsAgo: number | null;
  period: string | null;
  clientLogo: string | null;
  /** undefined = keep existing on update (create: none); null = clear; string = set */
  apiToken: string | null | undefined;
  accountId: string | null;
}

function validateSchedule(body: unknown): { data?: ValidatedSchedule; error?: string } {
  if (!body || typeof body !== "object") return { error: "Missing request body" };
  const b = body as Record<string, unknown>;

  const name = typeof b.name === "string" ? b.name.trim() : "";
  if (!name || name.length > 120) return { error: "name is required (max 120 chars)" };

  const reportType = b.reportType;
  if (reportType !== "appsec" && reportType !== "zero-trust" && reportType !== "magic-transit" && reportType !== "custom-dashboard")
    return { error: "Unsupported reportType" };
  let dashboardTemplate: DashboardTemplate | null = null;
  if (reportType === "custom-dashboard") {
    try { dashboardTemplate = validateDashboardTemplate(b.dashboardTemplate); }
    catch (e) { return { error: e instanceof Error ? e.message : "Invalid dashboard template" }; }
  }

  let zoneId: string | null = null;
  let zoneName: string | null = null;
  if (reportType === "appsec" || reportType === "custom-dashboard") {
    if (typeof b.zoneId !== "string" || !/^[a-f0-9]{32}$/i.test(b.zoneId))
      return { error: "zoneId (32-char hex) is required for zone-scoped schedules" };
    zoneId = b.zoneId.toLowerCase();
    if (b.zoneName !== undefined && b.zoneName !== null) {
      if (typeof b.zoneName !== "string" || b.zoneName.length > 255)
        return { error: "zoneName must be a string (max 255 chars)" };
      zoneName = b.zoneName.trim() || null;
    }
  }

  // rangeMode "calendar_month" ignores `days` for the actual date-range math
  // (see lastCalendarMonth() in cf-graphql.ts) — a fixed 30-day rolling
  // window never lines up with a real month's 28-31 days. "custom" also
  // ignores `days` (the explicit sinceDate/untilDate drives the range).
  // `days` is still stored (a nominal 30) purely so existing UI/history
  // that displays it has something reasonable to show before a report is
  // actually generated.
  // Parse tzOffset FIRST — the custom-range validation below needs it to
  // interpret the dates in the schedule's local timezone.
  let tzOffset = 0;
  if (b.tzOffset !== undefined) {
    if (typeof b.tzOffset !== "number" || !isFinite(b.tzOffset)) return { error: "tzOffset must be a number" };
    tzOffset = Math.max(-840, Math.min(840, Math.round(b.tzOffset)));
  }

  const rangeMode: ReportRangeMode =
    b.rangeMode === "calendar_month" ? "calendar_month"
    : b.rangeMode === "custom" ? "custom"
    : b.rangeMode === "period" ? "period"
    : "rolling";

  let sinceDate: string | null = null;
  let untilDate: string | null = null;
  let sinceTime: string | null = null;
  let untilTime: string | null = null;
  let monthsAgo: number | null = null;
  let period: string | null = null;
  let days: number;
  if (rangeMode === "period") {
    if (b.period !== "yesterday" && b.period !== "last_week" && b.period !== "last_month")
      return { error: 'rangeMode "period" requires period: "yesterday", "last_week" or "last_month"' };
    period = b.period;
    days = 1; // display default — the real window is computed at run time
  } else if (rangeMode === "custom") {
    if (typeof b.sinceDate !== "string" || typeof b.untilDate !== "string")
      return { error: 'rangeMode "custom" requires sinceDate and untilDate (YYYY-MM-DD)' };
    if (typeof b.sinceTime === "string") sinceTime = b.sinceTime;
    if (typeof b.untilTime === "string") untilTime = b.untilTime;
    if (!customDateRange(b.sinceDate, b.untilDate, tzOffset, sinceTime ?? undefined, untilTime ?? undefined))
      return { error: "Invalid custom range: dates must exist (YYYY-MM-DD), times must be HH:MM, start ≤ end, end not in the future, span 1–366 days" };
    sinceDate = b.sinceDate;
    untilDate = b.untilDate;
    days = 30;
  } else if (rangeMode === "calendar_month") {
    const parsed = typeof b.monthsAgo === "number" ? Math.round(b.monthsAgo) : parseInt(String(b.monthsAgo ?? "1"), 10);
    if (isNaN(parsed) || parsed < 1 || parsed > 12)
      return { error: "monthsAgo must be an integer 1–12 for calendar_month schedules" };
    monthsAgo = parsed;
    days = 30;
  } else {
    if (typeof b.days !== "number" || !ALLOWED_DAYS.includes(b.days))
      return { error: `days must be one of ${ALLOWED_DAYS.join(", ")}` };
    days = b.days;
  }

  const frequency = b.frequency;
  if (frequency !== "daily" && frequency !== "weekly" && frequency !== "monthly")
    return { error: "frequency must be 'daily', 'weekly' or 'monthly'" };

  let dayOfWeek: number | null = null;
  let dayOfMonth: number | null = null;
  if (frequency === "weekly") {
    if (typeof b.dayOfWeek !== "number" || b.dayOfWeek < 0 || b.dayOfWeek > 6 || !Number.isInteger(b.dayOfWeek))
      return { error: "dayOfWeek (0-6, Sunday=0) is required for weekly schedules" };
    dayOfWeek = b.dayOfWeek;
  } else if (frequency === "monthly") {
    if (typeof b.dayOfMonth !== "number" || b.dayOfMonth < 1 || b.dayOfMonth > 28 || !Number.isInteger(b.dayOfMonth))
      return { error: "dayOfMonth (1-28) is required for monthly schedules" };
    dayOfMonth = b.dayOfMonth;
  }

  if (typeof b.sendHourUtc !== "number" || b.sendHourUtc < 0 || b.sendHourUtc > 23 || !Number.isInteger(b.sendHourUtc))
    return { error: "sendHourUtc must be an integer 0-23" };
  const sendHourUtc = b.sendHourUtc;

  if (!Array.isArray(b.recipients) || b.recipients.length === 0)
    return { error: "recipients must be a non-empty array" };
  if (b.recipients.length > MAX_RECIPIENTS)
    return { error: `maximum ${MAX_RECIPIENTS} recipients per schedule` };
  const seen = new Set<string>();
  for (const r of b.recipients) {
    if (typeof r !== "string") return { error: "recipients must be strings" };
    const email = r.trim().toLowerCase();
    if (!EMAIL_RE.test(email)) return { error: `invalid recipient address: ${r}` };
    seen.add(email);
  }
  const recipients = JSON.stringify(Array.from(seen));

  const subject = typeof b.subject === "string" ? b.subject.trim() : "";
  if (!subject || subject.length > 200) return { error: "subject is required (max 200 chars)" };

  const message = typeof b.message === "string" ? b.message : "";
  if (message.length > 5000) return { error: "message must be max 5000 chars" };

  let clientName: string | null = null;
  if (b.clientName !== undefined && b.clientName !== null) {
    if (typeof b.clientName !== "string" || b.clientName.length > 200)
      return { error: "clientName must be a string (max 200 chars)" };
    clientName = b.clientName.trim() || null;
  }

  // Per-schedule credentials (multi-customer). apiToken: undefined = keep the
  // stored token on update (the client never sees the value, so edits that
  // don't touch credentials must not wipe them); null = clear (fall back to
  // backend credentials); a string sets/replaces it. accountId is a normal
  // full-replacement field — the client always has it.
  let apiToken: string | null | undefined;
  if (b.apiToken === undefined) {
    apiToken = undefined;
  } else if (b.apiToken === null || b.apiToken === "") {
    apiToken = null;
  } else if (typeof b.apiToken === "string") {
    apiToken = b.apiToken.trim();
    if (apiToken.length < 10 || apiToken.length > 500)
      return { error: "apiToken looks too short to be valid (min 10 chars)" };
  } else {
    return { error: "apiToken must be a string or null" };
  }

  let accountId: string | null = null;
  if (b.accountId !== undefined && b.accountId !== null) {
    if (typeof b.accountId !== "string" || b.accountId.length > 64)
      return { error: "accountId must be a string (max 64 chars)" };
    accountId = b.accountId.trim() || null;
  }

  // Client branding: same rules as the on-demand form — a base64 data URI
  // (data:image/...) up to 2MB. Full replacement (null clears).
  let clientLogo: string | null = null;
  if (b.clientLogo !== undefined && b.clientLogo !== null && b.clientLogo !== "") {
    if (typeof b.clientLogo !== "string")
      return { error: "clientLogo must be a data-URI string or null" };
    if (clientLogoTooLargeOrNotAnImage(b.clientLogo))
      return { error: "clientLogo must be an image data URI (data:image/...) under 2MB" };
    clientLogo = b.clientLogo;
  }

  const isPoc = b.isPoc === undefined ? true : b.isPoc !== false;
  const enabled = b.enabled === undefined ? true : b.enabled !== false;

  return {
    data: {
      name, reportType, zoneId, zoneName, days, tzOffset, frequency,
      dayOfWeek, dayOfMonth, sendHourUtc, recipients, subject, message,
      isPoc: isPoc ? 1 : 0, clientName, enabled: enabled ? 1 : 0, rangeMode,
      sinceDate, untilDate, sinceTime, untilTime, monthsAgo,
      period, clientLogo, apiToken, accountId, dashboardTemplate,
    },
  };
}

// ≤2MB data URI starting with data:image/ (matches the on-demand form's rules).
function clientLogoTooLargeOrNotAnImage(logo: string): boolean {
  if (!logo.startsWith("data:image/")) return true;
  // data URIs are ~4/3 the raw bytes; 2MB raw ≈ 2.7M chars — allow headroom.
  return logo.length > 2_800_000;
}

// ─── GET /api/schedules ────────────────────────────────────────────────────────

export async function handleListSchedules(c: Context<{ Bindings: Env }>) {
  const { results } = await c.env.DB.prepare(
    "SELECT * FROM schedules ORDER BY created_at DESC"
  ).all<ScheduleRow>();

  const schedules = (results ?? []).map(rowToConfig);
  return c.json({ ok: true, schedules });
}

// ─── POST /api/schedules ───────────────────────────────────────────────────────

export async function handleCreateSchedule(c: Context<{ Bindings: Env }>) {
  let body: unknown;
  try { body = await c.req.json(); } catch { return c.json({ error: "Invalid JSON body" }, 400); }

  const { data, error } = validateSchedule(body);
  if (!data) return c.json({ error }, 400);

  const now = new Date().toISOString();
  const id = crypto.randomUUID();

  await c.env.DB.prepare(
    `INSERT INTO schedules
       (id, name, report_type, zone_id, zone_name, days, tz_offset, frequency,
        day_of_week, day_of_month, send_hour_utc, recipients, subject, message,
        is_poc, client_name, enabled, created_at, updated_at, range_mode,
        since_date, until_date, since_time, until_time, months_ago, period,
        client_logo, api_token, account_id, dashboard_template)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  )
    .bind(
      id, data.name, data.reportType, data.zoneId, data.zoneName, data.days,
      data.tzOffset, data.frequency, data.dayOfWeek, data.dayOfMonth,
      data.sendHourUtc, data.recipients, data.subject, data.message,
      data.isPoc, data.clientName, data.enabled, now, now, data.rangeMode,
      data.sinceDate, data.untilDate, data.sinceTime, data.untilTime, data.monthsAgo, data.period,
      data.clientLogo, data.apiToken ?? null, data.accountId, data.dashboardTemplate ? JSON.stringify(data.dashboardTemplate) : null
    )
    .run();

  const row = await getScheduleRow(c.env, id);
  if (!row) return c.json({ error: "Failed to create schedule" }, 500);
  return c.json({ ok: true, schedule: rowToConfig(row) }, 201);
}

// ─── PUT /api/schedules/:id ────────────────────────────────────────────────────

export async function handleUpdateSchedule(c: Context<{ Bindings: Env }>) {
  const id = c.req.param("id") ?? "";
  const existing = await getScheduleRow(c.env, id);
  if (!existing) return c.json({ error: "Schedule not found" }, 404);

  let body: unknown;
  try { body = await c.req.json(); } catch { return c.json({ error: "Invalid JSON body" }, 400); }

  const { data, error } = validateSchedule(body);
  if (!data) return c.json({ error }, 400);

  // undefined apiToken = keep the stored token (the dashboard never has the
  // value to resend); null = clear back to backend credentials.
  const apiToken = data.apiToken === undefined ? existing.api_token : data.apiToken;

  const now = new Date().toISOString();
  await c.env.DB.prepare(
    `UPDATE schedules SET
       name = ?, report_type = ?, zone_id = ?, zone_name = ?, days = ?, tz_offset = ?,
       frequency = ?, day_of_week = ?, day_of_month = ?, send_hour_utc = ?,
       recipients = ?, subject = ?, message = ?, is_poc = ?, client_name = ?,
       enabled = ?, updated_at = ?, range_mode = ?,
       since_date = ?, until_date = ?, since_time = ?, until_time = ?, months_ago = ?, period = ?,
       client_logo = ?, api_token = ?, account_id = ?, dashboard_template = ?
     WHERE id = ?`
  )
    .bind(
      data.name, data.reportType, data.zoneId, data.zoneName, data.days, data.tzOffset,
      data.frequency, data.dayOfWeek, data.dayOfMonth, data.sendHourUtc,
      data.recipients, data.subject, data.message, data.isPoc, data.clientName,
      data.enabled, now, data.rangeMode,
      data.sinceDate, data.untilDate, data.sinceTime, data.untilTime, data.monthsAgo, data.period,
      data.clientLogo, apiToken, data.accountId, data.dashboardTemplate ? JSON.stringify(data.dashboardTemplate) : null, id
    )
    .run();

  const row = await getScheduleRow(c.env, id);
  if (!row) return c.json({ error: "Schedule not found" }, 404);
  return c.json({ ok: true, schedule: rowToConfig(row) });
}

// ─── DELETE /api/schedules/:id ─────────────────────────────────────────────────

export async function handleDeleteSchedule(c: Context<{ Bindings: Env }>) {
  const id = c.req.param("id") ?? "";
  const res = await c.env.DB.prepare("DELETE FROM schedules WHERE id = ?").bind(id).run();
  if ((res.meta.changes ?? 0) === 0) return c.json({ error: "Schedule not found" }, 404);
  // Keep send_history rows as an audit trail; they reference schedule_id only.
  return c.json({ ok: true });
}

// ─── POST /api/schedules/:id/send — generate + send immediately ─────────────────

export async function handleSendNow(c: Context<{ Bindings: Env }>) {
  const id = c.req.param("id") ?? "";
  const row = await getScheduleRow(c.env, id);
  if (!row) return c.json({ error: "Schedule not found" }, 404);

  const result = await runSchedule(c.env, row, "manual");
  if (!result.ok) return c.json({ ok: false, error: result.error ?? "Send failed" }, 502);
  return c.json({ ok: true, messageId: result.messageId, finishedAt: result.finishedAt });
}

// ─── GET /api/schedules/:id/history ────────────────────────────────────────────

export async function handleScheduleHistory(c: Context<{ Bindings: Env }>) {
  const id = c.req.param("id") ?? "";
  const { results } = await c.env.DB.prepare(
    "SELECT * FROM send_history WHERE schedule_id = ? ORDER BY started_at DESC LIMIT 20"
  )
    .bind(id)
    .all();

  const history = (results ?? []).map((r) => ({
    id: r.id as string,
    scheduleId: r.schedule_id as string,
    startedAt: r.started_at as string,
    finishedAt: (r.finished_at ?? null) as string | null,
    status: r.status as string,
    trigger: r.trigger as string,
    error: (r.error ?? null) as string | null,
    messageId: (r.message_id ?? null) as string | null,
  }));

  return c.json({ ok: true, history });
}

// ─── Shared ────────────────────────────────────────────────────────────────────

async function getScheduleRow(env: Env, id: string): Promise<ScheduleRow | null> {
  const row = await env.DB.prepare("SELECT * FROM schedules WHERE id = ?")
    .bind(id)
    .first<ScheduleRow>();
  return row ?? null;
}
