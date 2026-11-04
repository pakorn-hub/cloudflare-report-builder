/**
 * Audit routes — store and retrieve POC report HTML in R2.
 *
 * POST /api/audit        — save an HTML report snapshot
 * GET  /api/audit        — list all saved reports (metadata only)
 * GET  /api/audit/:key   — retrieve a specific saved report as HTML
 *
 * R2 key format: {sanitised-email}_{sanitised-hostname}_{ISO-timestamp}.html
 * Example:       jane-example.com_example.com_2026-03-26T10-39-00Z.html
 *
 * R2 custom metadata stored per object:
 *   email, hostname, zoneName, days, generatedAt, userEmail
 */

import type { Context } from "hono";
import type { Env } from "../types";

function sanitise(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9._-]/g, "_").replace(/_+/g, "_").replace(/^_|_$/g, "");
}

function buildKey(email: string, hostname: string, ts: string): string {
  const e = sanitise(email || "anonymous");
  const h = sanitise(hostname || "unknown");
  // ts is ISO like "2026-03-26T10:39:00.000Z" — make it filename-safe
  const t = ts.replace(/[:.]/g, "-").replace("Z", "Z");
  return `${e}_${h}_${t}.html`;
}

// ── POST /api/audit ──────────────────────────────────────────────────────────
// Body (multipart or JSON):
//   { email, hostname, zoneName, days, generatedAt, html }
// The `html` field is the full serialised report HTML (from saveToHtml).

export async function handleAuditSave(c: Context<{ Bindings: Env }>) {
  const bucket = c.env.AUDIT_BUCKET;
  if (!bucket) return c.json({ error: "Audit storage not configured" }, 500);

  let body: Record<string, string>;
  try {
    body = await c.req.json() as Record<string, string>;
  } catch {
    return c.json({ error: "Invalid JSON body" }, 400);
  }

  const { email = "anonymous", hostname = "unknown", zoneName = "", days = "", generatedAt, html } = body;

  if (!html || html.length < 100) {
    return c.json({ error: "Missing or empty html field" }, 400);
  }

  const ts = generatedAt || new Date().toISOString();
  const key = buildKey(email, hostname, ts);

  await bucket.put(key, html, {
    httpMetadata: { contentType: "text/html; charset=utf-8" },
    customMetadata: {
      email,
      hostname,
      zoneName,
      days,
      generatedAt: ts,
    },
  });

  return c.json({ ok: true, key });
}

// ── GET /api/audit ────────────────────────────────────────────────────────────
// Returns a list of all saved reports sorted newest-first.

export async function handleAuditList(c: Context<{ Bindings: Env }>) {
  const bucket = c.env.AUDIT_BUCKET;
  if (!bucket) return c.json({ error: "Audit storage not configured" }, 500);

  const listed = await bucket.list({ limit: 500, include: ["customMetadata"] });

  const reports = listed.objects
    .map((obj) => ({
      key:         obj.key,
      size:        obj.size,
      uploaded:    obj.uploaded?.toISOString() ?? "",
      email:       obj.customMetadata?.["email"]       ?? "",
      hostname:    obj.customMetadata?.["hostname"]    ?? "",
      zoneName:    obj.customMetadata?.["zoneName"]    ?? "",
      days:        obj.customMetadata?.["days"]        ?? "",
      generatedAt: obj.customMetadata?.["generatedAt"] ?? "",
    }))
    .sort((a, b) => b.uploaded.localeCompare(a.uploaded));

  return c.json({ ok: true, reports, truncated: listed.truncated });
}

// ── GET /api/audit/:key ───────────────────────────────────────────────────────
// Returns the saved HTML or a scheduled dashboard's already-rendered PDF.

export async function handleAuditGet(c: Context<{ Bindings: Env }>) {
  const bucket = c.env.AUDIT_BUCKET;
  if (!bucket) return c.json({ error: "Audit storage not configured" }, 500);

  // Scheduled snapshots live under nested keys ("scheduled/<id>/<ts>-full.html"),
  // so read the raw path tail rather than a single :key segment (Hono params
  // don't match "/") and decode it.
  const prefix = "/api/audit/";
  const key = decodeURIComponent(c.req.path.slice(prefix.length));
  if (!key) return c.json({ error: "Missing key" }, 400);

  const obj = await bucket.get(key);
  if (!obj) return c.json({ error: "Report not found" }, 404);

  return new Response(obj.body, {
    headers: {
      "Content-Type":        key.endsWith(".pdf") && obj.httpMetadata?.contentType === "application/pdf" ? "application/pdf" : "text/html; charset=utf-8",
      "Content-Disposition": `inline; filename="${key}"`,
      "Cache-Control":       "private, max-age=3600",
    },
  });
}
