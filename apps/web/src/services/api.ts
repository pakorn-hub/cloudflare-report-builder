import type {
  AppSecData, ZeroTrustData, ReportInput, ZoneOption,
  ScheduleConfig, ScheduleInput, ScheduleHistoryEntry,
  BackendSettingsState, BackendSettingsUpdate,
  RemediationItem, RemediationStatus,
  CasbFindingItem, CasbFindingStatus,
  AlertTrackingItem, AlertTrackingStatus,
} from "../types";

// In production, the Pages Function at /functions/api/[[path]].ts proxies
// all /api/* requests to the Worker — same origin, no CORS, no hardcoded URL.
// In dev, Vite's proxy (vite.config.ts) forwards /api → wrangler dev on :8787.
const API_BASE = import.meta.env.VITE_API_URL ?? "";

import { noteAccessRedirect, clearAccessReauthFlag } from "./access-reauth";
import type { MagicTransitData } from "../../../../shared/magic-transit";
import type { DashboardSnapshot } from "../../../../shared/custom-dashboard";
import type { DashboardTemplate } from "../../../../shared/custom-dashboard-template";
import type { SavedDashboard } from "../../../../shared/saved-dashboard";

export interface SavedDashboardCredentials { apiToken?: string | null; accountId?: string; scheduleId?: string }
export async function fetchSavedDashboards(input: SavedDashboardCredentials & { scope: "account" | "zone"; zoneId?: string }): Promise<SavedDashboard[]> {
  const result = await post<{ ok: boolean; dashboards: SavedDashboard[] }>("/api/custom-dashboard/dashboards", input);
  if (!result.ok || !Array.isArray(result.dashboards)) throw new Error("The API did not return a saved-dashboard list.");
  return result.dashboards;
}

export async function fetchCustomDashboard(input: { token: string; accountId: string; zoneId: string; zoneName: string; template: DashboardTemplate; days: number; tzOffset: number; rangeMode: "period"; period: "yesterday" | "last_week" | "last_month" }): Promise<DashboardSnapshot> {
  const result = await post<{ ok: boolean; dashboard: DashboardSnapshot }>("/api/custom-dashboard", input);
  return result.dashboard;
}

export async function fetchMagicTransitData(input: ReportInput): Promise<MagicTransitData> {
  const result = await post<{ ok: boolean; magicTransit: MagicTransitData }>("/api/magic-transit", {
    token: input.token, accountId: input.accountId, days: input.days, tzOffset: input.tzOffset,
    rangeMode: input.rangeMode, period: input.period, monthsAgo: input.monthsAgo,
    sinceDate: input.sinceDate, untilDate: input.untilDate, sinceTime: input.sinceTime, untilTime: input.untilTime,
  });
  return result.magicTransit;
}

export async function fetchMtSummary(magicTransit: MagicTransitData, isPoc: boolean): Promise<string> {
  const result = await post<{ summary: string }>("/api/mt-summary", { magicTransit, isPoc });
  return result.summary;
}

/**
 * Shared fetch for every API call in this file — and for any component-level
 * API fetch that lives outside this file (exported for exactly that purpose).
 *
 *
 * Uses redirect: "manual" so an edge-level redirect — in this deployment,
 * Cloudflare Access sending an unauthenticated request to its login page —
 * comes back as an observable opaque-redirect response instead of being
 * silently followed into a cross-origin CORS failure (the login page sends
 * no Access-Control-Allow-Origin header, so following the redirect makes
 * fetch() reject with a bare TypeError that reads as "network error").
 *
 * Neither the Worker nor the Pages proxy ever redirects an /api/* request,
 * so an opaque-redirect response here always means the Access session is
 * missing or expired. noteAccessRedirect() reloads the page once per tab to
 * re-authenticate (a top-level navigation is the only way to complete an
 * Access login) and, on repeated failure, returns an error telling the user
 * to log in manually instead.
 */
export async function apiFetch(path: string, init?: RequestInit): Promise<Response> {
  const res = await fetch(`${API_BASE}${path}`, { ...init, redirect: "manual" });
  if (res.type === "opaqueredirect") throw noteAccessRedirect();
  // Any non-redirected response — success OR an app-level 4xx/5xx — proves
  // the request passed the edge, i.e. the Access session is valid. Re-arm
  // the automatic re-login for the next expiry episode.
  clearAccessReauthFlag();
  return res;
}

async function post<T>(path: string, body: unknown): Promise<T> {
  const res = await apiFetch(path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: `HTTP ${res.status}` }));
    throw new Error((err as { error?: string }).error ?? `HTTP ${res.status}`);
  }

  return res.json() as Promise<T>;
}

async function request<T>(path: string, method: "GET" | "PUT" | "PATCH" | "DELETE", body?: unknown): Promise<T> {
  const res = await apiFetch(path, {
    method,
    headers: body !== undefined ? { "Content-Type": "application/json" } : undefined,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: `HTTP ${res.status}` }));
    throw new Error((err as { error?: string }).error ?? `HTTP ${res.status}`);
  }

  return res.json() as Promise<T>;
}

export async function fetchZones(token: string, accountId: string): Promise<ZoneOption[]> {
  const result = await post<{ ok: boolean; zones: ZoneOption[] }>("/api/zones", {
    token,
    accountId,
  });
  return result.zones;
}

export async function fetchAppsecData(input: ReportInput): Promise<AppSecData> {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { clientLogo: _logo, ...apiInput } = input;
  const result = await post<{ ok: boolean; appsec: AppSecData }>("/api/appsec", apiInput);
  return result.appsec;
}

export async function fetchZeroTrustData(input: ReportInput): Promise<ZeroTrustData> {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { clientLogo: _logo, zoneId: _zone, ...apiInput } = input;
  const result = await post<{ ok: boolean; zerotrust: ZeroTrustData }>("/api/zerotrust", apiInput);
  return result.zerotrust;
}

export async function fetchAiSummary(appsec: AppSecData, isPoc = true): Promise<string> {
  const result = await post<{ ok: boolean; summary: string }>("/api/summary", { appsec, isPoc });
  return result.summary;
}

/**
 * Returns the email of the logged-in user from Cloudflare Access.
 * The Pages Function reads the CF_Authorization JWT (Warp/Gateway policy)
 * or the Cf-Access-Authenticated-User-Email header (identity policy).
 */
export async function fetchUserEmail(): Promise<string | null> {
  try {
    const res = await apiFetch("/api/me");
    if (!res.ok) return null;
    const data = await res.json() as { ok: boolean; email: string | null };
    return data.email ?? null;
  } catch {
    // Errors are swallowed by design (attribution is optional), but if the
    // cause was an Access login redirect, noteAccessRedirect() inside
    // apiFetch has already scheduled the re-authentication reload.
    return null;
  }
}

/**
 * Save a rendered HTML report to the R2 audit bucket.
 * Key format: {email}_{hostname}_{timestamp}.html
 */
export interface AuditReportMeta {
  key: string;
  size: number;
  uploaded: string;
  email: string;
  hostname: string;
  zoneName: string;
  days: string;
  generatedAt: string;
}

/**
 * List all saved audit reports from R2.
 */
export async function fetchAuditList(): Promise<AuditReportMeta[]> {
  try {
    const res = await apiFetch("/api/audit");
    if (!res.ok) return [];
    const data = await res.json() as { ok: boolean; reports: AuditReportMeta[] };
    return data.reports ?? [];
  } catch {
    return [];
  }
}

export async function saveAuditReport(params: {
  email: string;
  hostname: string;
  zoneName: string;
  days: number;
  generatedAt: string;
  html: string;
}): Promise<{ key: string } | null> {
  try {
    const res = await apiFetch("/api/audit", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(params),
    });
    if (!res.ok) return null;
    const data = await res.json() as { ok: boolean; key: string };
    return { key: data.key };
  } catch {
    return null;
  }
}

// ─── Scheduled Reports ────────────────────────────────────────────────────────

/**
 * Zone list for the schedule dashboard's picker. Uses the backend-bound
 * CF_API_TOKEN + CF_ACCOUNT_ID — the client sends no credentials.
 */
export async function fetchScheduleZones(): Promise<ZoneOption[]> {
  const result = await request<{ ok: boolean; zones: ZoneOption[]; accountId: string }>(
    "/api/schedule/zones",
    "GET"
  );
  return result.zones;
}

/**
 * List a CUSTOMER's zones with their own token (multi-customer) — used by the
 * schedule form to populate the zone picker before the credentials are saved
 * on the schedule. Neither the token nor the result is persisted here.
 */
export async function fetchScheduleZonesWithCredentials(
  apiToken: string,
  accountId?: string | null
): Promise<ZoneOption[]> {
  const result = await post<{ ok: boolean; zones: ZoneOption[] }>(
    "/api/schedule/zones",
    { apiToken, ...(accountId ? { accountId } : {}) }
  );
  return result.zones;
}

/** Result of validating candidate credentials (per-schedule or backend). */
export interface CredentialsTestResult {
  tokenValid: boolean;
  accountName: string | null;
  zonesVisible: number | null;
  zonesWarning: string | null;
  accountSkipped?: string;
}

/**
 * Validate credentials against the real Cloudflare API without saving them.
 * With no arguments this tests the effective backend credentials; with a
 * token (± account) it tests those — e.g. a customer token typed into the
 * schedule form.
 */
export async function testCredentials(
  cfApiToken?: string,
  cfAccountId?: string | null
): Promise<CredentialsTestResult> {
  const result = await post<{ ok: boolean; result: CredentialsTestResult }>(
    "/api/settings/test",
    {
      ...(cfApiToken ? { cfApiToken } : {}),
      ...(cfApiToken && cfAccountId ? { cfAccountId } : {}),
    }
  );
  return result.result;
}

export async function listSchedules(): Promise<ScheduleConfig[]> {
  const result = await request<{ ok: boolean; schedules: ScheduleConfig[] }>("/api/schedules", "GET");
  return result.schedules;
}

export async function createSchedule(input: ScheduleInput): Promise<ScheduleConfig> {
  const result = await post<{ ok: boolean; schedule: ScheduleConfig }>("/api/schedules", input);
  return result.schedule;
}

export async function updateSchedule(id: string, input: ScheduleInput): Promise<ScheduleConfig> {
  const result = await request<{ ok: boolean; schedule: ScheduleConfig }>(
    `/api/schedules/${id}`,
    "PUT",
    input
  );
  return result.schedule;
}

export async function deleteSchedule(id: string): Promise<void> {
  await request<{ ok: boolean }>(`/api/schedules/${id}`, "DELETE");
}

/** Trigger an immediate generation + send (full report — heavy). */
export async function sendScheduleNow(id: string): Promise<void> {
  await post<{ ok: boolean }>(`/api/schedules/${id}/send`, {});
}

export async function fetchScheduleHistory(id: string): Promise<ScheduleHistoryEntry[]> {
  const result = await request<{ ok: boolean; history: ScheduleHistoryEntry[] }>(
    `/api/schedules/${id}/history`,
    "GET"
  );
  return result.history;
}

// ─── Backend Settings ─────────────────────────────────────────────────────────

/** Current backend config state — the token itself is never returned. */
export async function fetchBackendSettings(): Promise<BackendSettingsState> {
  const result = await request<{ ok: boolean; settings: BackendSettingsState }>("/api/settings", "GET");
  return result.settings;
}

/**
 * Update backend settings. Omitted fields are left unchanged; null clears a
 * value so the Worker's env secret/var becomes the active fallback again.
 */
export async function saveBackendSettings(
  update: BackendSettingsUpdate
): Promise<BackendSettingsState> {
  const result = await request<{ ok: boolean; settings: BackendSettingsState }>("/api/settings", "PUT", update);
  return result.settings;
}

export interface ConnectionTestResult {
  tokenValid: boolean;
  accountName?: string;
  zonesVisible?: number | null;
  zonesWarning?: string | null;
}

/** Validates the effective token + account against the Cloudflare API. */
export async function testBackendConnection(): Promise<ConnectionTestResult> {
  const result = await post<{ ok: boolean; result: ConnectionTestResult }>("/api/settings/test", {});
  return result.result;
}

// ─── Zero Trust Remediation Register ──────────────────────────────────────────

/** Re-fetches the current register for an account — used after a status/owner
 *  change so the report reflects the persisted state without a full re-run. */
export async function fetchRemediationRegister(accountId: string): Promise<RemediationItem[]> {
  const result = await request<{ ok: boolean; items: RemediationItem[] }>(
    `/api/remediation?accountId=${encodeURIComponent(accountId)}`,
    "GET"
  );
  return result.items;
}

export async function updateRemediationItem(
  id: string,
  update: { status?: RemediationStatus; ownerEmail?: string | null; dueDate?: string | null }
): Promise<RemediationItem> {
  const result = await request<{ ok: boolean; item: RemediationItem }>(
    `/api/remediation/${id}`,
    "PATCH",
    update
  );
  return result.item;
}

// ─── CASB Finding Register ─────────────────────────────────────────────────────

export async function fetchCasbFindingRegister(accountId: string): Promise<CasbFindingItem[]> {
  const result = await request<{ ok: boolean; items: CasbFindingItem[] }>(
    `/api/casb-findings?accountId=${encodeURIComponent(accountId)}`,
    "GET"
  );
  return result.items;
}

export async function updateCasbFindingItem(
  id: string,
  update: { status?: CasbFindingStatus; ownerEmail?: string | null; dueDate?: string | null }
): Promise<CasbFindingItem> {
  const result = await request<{ ok: boolean; item: CasbFindingItem }>(
    `/api/casb-findings/${id}`,
    "PATCH",
    update
  );
  return result.item;
}

// ─── Alert Investigation Register ──────────────────────────────────────────────

export async function fetchAlertRegister(accountId: string): Promise<AlertTrackingItem[]> {
  const result = await request<{ ok: boolean; items: AlertTrackingItem[] }>(
    `/api/alert-register?accountId=${encodeURIComponent(accountId)}`,
    "GET"
  );
  return result.items;
}

export async function updateAlertItem(
  id: string,
  update: { status?: AlertTrackingStatus; ownerEmail?: string | null; dueDate?: string | null }
): Promise<AlertTrackingItem> {
  const result = await request<{ ok: boolean; item: AlertTrackingItem }>(
    `/api/alert-register/${id}`,
    "PATCH",
    update
  );
  return result.item;
}
