/**
 * Alert investigation register — read + operator update.
 *
 *   GET   /api/alert-register?accountId=  — tracked alert history for an account
 *   PATCH /api/alert-register/:id         — update investigation status / owner / due date
 *
 * Alerts are only ingested as a side effect of report generation (see
 * services/zt-alert-tracking.ts + fetch-zerotrust.ts) — this route never
 * invents an alert, only lets an operator annotate one Cloudflare's own
 * alerting history API already reported.
 */

import type { Context } from "hono";
import type { Env, AlertTrackingStatus } from "../types";
import { getAlertRegister, updateAlertItem } from "../services/zt-alert-tracking";

const VALID_STATUSES: AlertTrackingStatus[] = ["new", "acknowledged", "investigating", "resolved"];

export async function handleGetAlertRegister(c: Context<{ Bindings: Env }>) {
  const accountId = c.req.query("accountId") ?? "";
  if (!/^[a-f0-9]{32}$/i.test(accountId)) {
    return c.json({ error: "Missing or invalid accountId (32-char hex)" }, 400);
  }
  const items = await getAlertRegister(c.env.DB, accountId);
  return c.json({ ok: true, items });
}

export async function handlePatchAlertRegister(c: Context<{ Bindings: Env }>) {
  const id = c.req.param("id") ?? "";
  if (!id) return c.json({ error: "Missing id" }, 400);

  let body: unknown;
  try { body = await c.req.json(); } catch { return c.json({ error: "Invalid JSON body" }, 400); }
  const b = body as Record<string, unknown>;

  const update: { status?: AlertTrackingStatus; ownerEmail?: string | null; dueDate?: string | null } = {};

  if (b.status !== undefined) {
    if (typeof b.status !== "string" || !VALID_STATUSES.includes(b.status as AlertTrackingStatus)) {
      return c.json({ error: `status must be one of ${VALID_STATUSES.join(", ")}` }, 400);
    }
    update.status = b.status as AlertTrackingStatus;
  }

  if (b.ownerEmail !== undefined) {
    if (b.ownerEmail === null) {
      update.ownerEmail = null;
    } else if (typeof b.ownerEmail === "string") {
      const trimmed = b.ownerEmail.trim();
      if (trimmed.length > 255) return c.json({ error: "ownerEmail too long" }, 400);
      if (trimmed && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmed)) {
        return c.json({ error: "ownerEmail must be a valid email address" }, 400);
      }
      update.ownerEmail = trimmed || null;
    } else {
      return c.json({ error: "ownerEmail must be a string or null" }, 400);
    }
  }

  if (b.dueDate !== undefined) {
    if (b.dueDate === null) {
      update.dueDate = null;
    } else if (typeof b.dueDate === "string") {
      if (b.dueDate && isNaN(new Date(b.dueDate).getTime())) return c.json({ error: "dueDate must be a valid date" }, 400);
      update.dueDate = b.dueDate || null;
    } else {
      return c.json({ error: "dueDate must be a string or null" }, 400);
    }
  }

  if (Object.keys(update).length === 0) return c.json({ error: "No fields to update" }, 400);

  const item = await updateAlertItem(c.env.DB, id, update);
  if (!item) return c.json({ error: "Alert not found" }, 404);
  return c.json({ ok: true, item });
}
