/**
 * Cloudflare Report Builder — API Worker (Hono)
 * Read-only Cloudflare data aggregation for AppSec/Zero Trust POC or
 * assessment reports + scheduled email delivery (cron → Email Sending binding).
 *
 * Routes:
 *   POST /api/zones     — list zones for an account (lightweight, no rate limit)
 *   POST /api/appsec    — fetch all AppSec analytics (30 days)
 *   POST /api/summary   — generate AI executive summary via Workers AI
 *   GET  /health        — liveness check
 *   /api/schedules/*    — scheduled report configuration (D1-backed)
 *   GET|POST /api/schedule/zones — zone picker: GET uses backend credentials,
 *                                 POST accepts { apiToken, accountId } (customer-scoped)
 *
 * Scheduled: hourly cron — generates due reports and emails them via
 * Cloudflare Email Sending (see src/scheduler.ts).
 */

import { Hono } from "hono";
import { cors } from "hono/cors";
import type { Context } from "hono";
import type { Env } from "./types";
import { handleFetchAppsec } from "./routes/fetch-appsec";
import { handleAiSummary } from "./routes/ai-summary";
import { handleListZones } from "./routes/list-zones";
import { handleAuditSave, handleAuditList, handleAuditGet } from "./routes/audit";
import { handleFetchZeroTrust } from "./routes/fetch-zerotrust";
import { handleZTSummary } from "./routes/ai-zt-summary";
import { handleFetchMagicTransit } from "./routes/fetch-magic-transit";
import { handleMtSummary } from "./routes/ai-magic-transit-summary";
import { handleFetchCustomDashboard } from "./routes/fetch-custom-dashboard";
import { handleListSavedDashboards } from "./routes/list-saved-dashboards";
import { bodyLimit } from "hono/body-limit";
import {
  handleListSchedules,
  handleCreateSchedule,
  handleUpdateSchedule,
  handleDeleteSchedule,
  handleSendNow,
  handleScheduleHistory,
} from "./routes/schedules";
import { handleScheduleZones } from "./routes/schedule-options";
import { handleGetSettings, handleUpdateSettings, handleTestSettings } from "./routes/settings";
import { handleGetRemediation, handlePatchRemediation } from "./routes/remediation";
import { handleGetCasbFindings, handlePatchCasbFinding } from "./routes/casb-findings";
import { handleGetAlertRegister, handlePatchAlertRegister } from "./routes/alert-register";
import { scheduled } from "./scheduler";

const app = new Hono<{ Bindings: Env }>();

// ─── CORS ─────────────────────────────────────────────────────────────────────
// Same-origin deployments (the default — this Worker serves both the API and
// the built frontend via [assets] in wrangler.toml) never hit cross-origin
// requests at all. CORS only matters if you run the frontend on a separate
// origin (e.g. a Pages project instead of this Worker's [assets]) — set
// ALLOWED_ORIGIN (comma-separated) to that origin in wrangler.toml/dashboard.
app.use("*", async (c, next) => {
  const configuredOrigins = (c.env.ALLOWED_ORIGIN ?? "")
    .split(",")
    .map((o) => o.trim())
    .filter(Boolean);
  const devOrigins = ["http://localhost:5173", "http://localhost:4173"];
  const allowedOrigins = [...configuredOrigins, ...devOrigins];

  const origin = c.req.header("Origin") ?? "";
  const isAllowed =
    allowedOrigins.includes(origin) ||
    origin.endsWith(".pages.dev") ||
    c.env.ENVIRONMENT !== "production";

  return cors({
    origin: isAllowed ? origin : (allowedOrigins[0] ?? ""),
    allowMethods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    allowHeaders: ["Content-Type"],
    maxAge: 86400,
  })(c, next);
});

// ─── Caller gate (fail-closed) ────────────────────────────────────────────────
// SECURITY: every /api/* route requires a verified caller before its handler
// runs — a signature-verified Cloudflare Access JWT (when CF_ACCESS_TEAM_DOMAIN
// + CF_ACCESS_AUD are configured) or a timing-safe Bearer MANAGE_SECRET. When
// neither gate is configured the API fails closed with 503; anonymous access
// is never permitted, so security no longer depends solely on an edge claim.
// /health stays open for liveness probes (it is not under /api/*).
import { requireCaller } from "./middleware/auth";
app.use("/api/*", requireCaller);

// ─── Rate limiting ────────────────────────────────────────────────────────────
// Only applied to expensive /api/appsec and /api/summary routes.
// /api/zones and /health are exempt (lightweight calls).
const rateLimitMap = new Map<string, { count: number; resetAt: number }>();
const RATE_LIMIT = 50;       // requests per window
const RATE_WINDOW_MS = 5 * 60 * 1000;

function applyRateLimit(c: Context, next: () => Promise<Response | void>): Promise<Response | void> {
  const ip =
    c.req.header("CF-Connecting-IP") ??
    c.req.header("X-Forwarded-For") ??
    "unknown";

  const now = Date.now();
  const entry = rateLimitMap.get(ip);

  if (!entry || entry.resetAt < now) {
    rateLimitMap.set(ip, { count: 1, resetAt: now + RATE_WINDOW_MS });
  } else {
    entry.count++;
    if (entry.count > RATE_LIMIT) {
      return Promise.resolve(
        c.json({ error: "Rate limit exceeded. Maximum 50 requests per 5 minutes." }, 429)
      );
    }
  }

  return next();
}

// ─── Routes ───────────────────────────────────────────────────────────────────

app.get("/health", (c) =>
  c.json({ ok: true, version: "1.0.0", env: c.env.ENVIRONMENT })
);

// Return the authenticated user's email injected by Cloudflare Access.
// Returns null when running locally or when this Worker isn't behind an
// Access application (no Access = no identity to report).
//
// Access JWT sources checked, in priority order:
//   1. Cf-Access-Authenticated-User-Email header — set for identity policies
//   2. CF_Authorization cookie   — JWT set by Access on auth (device/Warp policies)
//   3. Cf-Access-Jwt-Assertion header — same JWT, header form
// The JWT payload's "email" claim covers both identity and Warp/Gateway
// device policies. We decode the payload only (no signature verification —
// Cloudflare already validated it to get this far past the Access policy).
app.get("/api/me", (c) => {
  const directEmail =
    c.req.header("Cf-Access-Authenticated-User-Email") ??
    c.req.header("cf-access-authenticated-user-email");
  if (directEmail) return c.json({ ok: true, email: directEmail });

  const cookieJwt = parseCfAuthCookie(c.req.header("cookie") ?? null);
  const headerJwt = c.req.header("Cf-Access-Jwt-Assertion") ?? null;
  const email = emailFromJwt(cookieJwt) ?? emailFromJwt(headerJwt);
  return c.json({ ok: true, email });
});

function parseCfAuthCookie(cookieHeader: string | null): string | null {
  if (!cookieHeader) return null;
  for (const part of cookieHeader.split(";")) {
    const [name, ...rest] = part.trim().split("=");
    if (name.trim() === "CF_Authorization") return rest.join("=").trim();
  }
  return null;
}

function emailFromJwt(token: string | null): string | null {
  if (!token) return null;
  try {
    const parts = token.split(".");
    if (parts.length < 2) return null;
    const payload = parts[1].replace(/-/g, "+").replace(/_/g, "/");
    const json = atob(payload);
    const claims = JSON.parse(json) as Record<string, unknown>;
    return typeof claims["email"] === "string" ? claims["email"] : null;
  } catch {
    return null;
  }
}

// Lightweight zone list — no rate limit
app.post("/api/zones", handleListZones);
app.post("/api/custom-dashboard/dashboards", (c, next) => applyRateLimit(c, next), bodyLimit({ maxSize: 16 * 1024 }), handleListSavedDashboards);

// Expensive routes — rate limited
app.post("/api/appsec", (c, next) => applyRateLimit(c, next), handleFetchAppsec);
app.post("/api/summary", (c, next) => applyRateLimit(c, next), handleAiSummary);

// Audit routes — R2 storage
app.post("/api/audit",      handleAuditSave);
app.get ("/api/audit",      handleAuditList);
app.get ("/api/audit/*",   handleAuditGet);   // wildcard — nested scheduled/<id>/<ts>.html keys work too

// Cloudflare One (Zero Trust) routes
app.post("/api/zerotrust",  (c, next) => applyRateLimit(c, next), handleFetchZeroTrust);
app.post("/api/zt-summary", (c, next) => applyRateLimit(c, next), handleZTSummary);
app.post("/api/magic-transit", (c, next) => applyRateLimit(c, next), handleFetchMagicTransit);
app.post("/api/mt-summary", (c, next) => applyRateLimit(c, next), handleMtSummary);
app.post("/api/custom-dashboard", (c, next) => applyRateLimit(c, next), handleFetchCustomDashboard);

// Remediation register — lifecycle tracking of Zero Trust findings (D1)
app.get  ("/api/remediation",     handleGetRemediation);
app.patch("/api/remediation/:id", handlePatchRemediation);

// CASB / Data Security Posture finding register — lifecycle tracking (D1)
app.get  ("/api/casb-findings",     handleGetCasbFindings);
app.patch("/api/casb-findings/:id", handlePatchCasbFinding);

// Alert investigation register — Cloudflare native alerting history (D1)
app.get  ("/api/alert-register",     handleGetAlertRegister);
app.patch("/api/alert-register/:id", handlePatchAlertRegister);

// ─── Scheduled report emails — configuration dashboard (D1) ──────────────────
app.get ("/api/schedule/zones",       handleScheduleZones);          // zone picker (backend credentials)
app.post("/api/schedule/zones",       handleScheduleZones);          // zone picker (body credentials — multi-customer)
app.get ("/api/schedules",            handleListSchedules);
app.post("/api/schedules",            handleCreateSchedule);
app.put ("/api/schedules/:id",        handleUpdateSchedule);
app.delete("/api/schedules/:id",       handleDeleteSchedule);
app.post("/api/schedules/:id/send",   (c, next) => applyRateLimit(c, next), handleSendNow); // heavy: full report generation
app.get ("/api/schedules/:id/history", handleScheduleHistory);

// ─── Backend settings (dashboard-managed, override env secret/vars) ──────────
app.get ("/api/settings",      handleGetSettings);                          // masked state
app.put ("/api/settings",      handleUpdateSettings);
app.post("/api/settings/test", (c, next) => applyRateLimit(c, next), handleTestSettings); // real CF API calls

// ─── Fallbacks ────────────────────────────────────────────────────────────────
app.notFound((c) => c.json({ error: `${c.req.method} ${c.req.path} not found` }, 404));
app.onError((err, c) => {
  console.error("Unhandled error:", err);
  return c.json({ error: "Internal server error" }, 500);
});

export default {
  fetch: app.fetch,
  scheduled,
} satisfies ExportedHandler<Env>;
