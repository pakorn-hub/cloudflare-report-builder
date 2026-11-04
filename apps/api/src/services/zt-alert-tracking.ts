/**
 * Cloudflare native security alert investigation tracking.
 *
 * REST /accounts/{id}/alerting/v3/history returns real, account-wide
 * security/operational alerts (DDoS, Advanced Security Events, etc.) — this
 * data was already being fetched into `recentAlerts` but never rendered
 * anywhere in the report, a dead dataset. This gives it an investigation
 * workflow: each alert history entry is ingested once (keyed by
 * Cloudflare's own alert id) and can be assigned an owner and moved through
 * new -> acknowledged -> investigating -> resolved.
 *
 * Unlike zt-remediation.ts / zt-casb-tracking.ts, there is no auto-resolve
 * here: alert history entries are immutable, already-happened point-in-time
 * events, not an ongoing condition that can "clear" on its own. Status is
 * purely an operator-driven investigation workflow.
 *
 * Fails soft: any D1 error is caught/logged, never blocks report
 * generation. No `DB` binding → every function is a safe no-op.
 */

import type { AlertTrackingItem, AlertTrackingStatus } from "../types";

export interface AlertInput {
  id: string;
  name: string;
  alertType: string;
  sentAt: string;
  silenced: boolean;
}

interface AlertTrackingRow {
  id: string;
  account_id: string;
  alert_id: string;
  name: string;
  alert_type: string;
  sent_at: string;
  silenced: number;
  status: string;
  owner_email: string | null;
  due_date: string | null;
  first_seen_at: string;
  updated_at: string;
}

function uuid(): string {
  return crypto.randomUUID();
}

function rowToItem(row: AlertTrackingRow): AlertTrackingItem {
  const startTs = new Date(row.first_seen_at).getTime();
  const ageDays = Number.isFinite(startTs) ? Math.max(0, Math.round((Date.now() - startTs) / 86_400_000)) : 0;
  const validStatuses: AlertTrackingStatus[] = ["new", "acknowledged", "investigating", "resolved"];
  return {
    id: row.id,
    accountId: row.account_id,
    alertId: row.alert_id,
    name: row.name,
    alertType: row.alert_type,
    sentAt: row.sent_at,
    silenced: row.silenced === 1,
    status: (validStatuses.includes(row.status as AlertTrackingStatus) ? row.status : "new") as AlertTrackingStatus,
    ownerEmail: row.owner_email,
    dueDate: row.due_date,
    firstSeenAt: row.first_seen_at,
    ageDays,
  };
}

/** Ingests any alert history entries not already tracked. Never overwrites
 *  an existing row's investigation status/owner. Call once per report
 *  generation. */
export async function syncAlerts(
  db: D1Database | undefined,
  accountId: string,
  generatedAt: string,
  alerts: AlertInput[]
): Promise<void> {
  if (!db || alerts.length === 0) return;
  try {
    const { results } = await db
      .prepare(`SELECT alert_id FROM zt_alert_tracking WHERE account_id = ?`)
      .bind(accountId)
      .all<{ alert_id: string }>();
    const known = new Set((results ?? []).map((r) => r.alert_id));

    for (const a of alerts) {
      if (known.has(a.id)) continue;
      await db
        .prepare(
          `INSERT INTO zt_alert_tracking
             (id, account_id, alert_id, name, alert_type, sent_at, silenced,
              status, owner_email, due_date, first_seen_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, 'new', NULL, NULL, ?, ?)`
        )
        .bind(uuid(), accountId, a.id, a.name, a.alertType, a.sentAt, a.silenced ? 1 : 0, generatedAt, generatedAt)
        .run();
      known.add(a.id);
    }
  } catch (e) {
    console.warn("[zt-alert-tracking] syncAlerts failed:", String(e));
  }
}

/** Returns the tracked alert register for an account, most recent first. */
export async function getAlertRegister(
  db: D1Database | undefined,
  accountId: string,
  limit = 50
): Promise<AlertTrackingItem[]> {
  if (!db) return [];
  try {
    const { results } = await db
      .prepare(
        `SELECT * FROM zt_alert_tracking WHERE account_id = ? ORDER BY sent_at DESC LIMIT ?`
      )
      .bind(accountId, limit)
      .all<AlertTrackingRow>();
    return (results ?? []).map(rowToItem);
  } catch (e) {
    console.warn("[zt-alert-tracking] getAlertRegister failed:", String(e));
    return [];
  }
}

/** Updates operator-controlled fields on a single tracked alert. */
export async function updateAlertItem(
  db: D1Database,
  id: string,
  update: { status?: AlertTrackingStatus; ownerEmail?: string | null; dueDate?: string | null }
): Promise<AlertTrackingItem | null> {
  const now = new Date().toISOString();
  const sets: string[] = ["updated_at = ?"];
  const binds: unknown[] = [now];

  if (update.status !== undefined) {
    sets.push("status = ?");
    binds.push(update.status);
  }
  if (update.ownerEmail !== undefined) {
    sets.push("owner_email = ?");
    binds.push(update.ownerEmail);
  }
  if (update.dueDate !== undefined) {
    sets.push("due_date = ?");
    binds.push(update.dueDate);
  }

  binds.push(id);
  await db.prepare(`UPDATE zt_alert_tracking SET ${sets.join(", ")} WHERE id = ?`).bind(...binds).run();

  const row = await db.prepare("SELECT * FROM zt_alert_tracking WHERE id = ?").bind(id).first<AlertTrackingRow>();
  return row ? rowToItem(row) : null;
}
