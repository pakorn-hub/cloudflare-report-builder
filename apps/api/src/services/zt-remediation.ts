/**
 * Zero Trust remediation register.
 *
 * Turns the existing evidence-based `recommendations` conditions (already
 * computed in fetch-zerotrust.ts, e.g. "no MFA enforced on any Access
 * policy") into a persisted, auditable D1-backed lifecycle: each finding is
 * keyed by a stable `findingKey`, so the SAME underlying issue is tracked
 * (age, owner, status) across report runs instead of appearing as a fresh,
 * un-auditable bullet point every time a report is generated — this is the
 * "remediation register" pattern used in Zscaler/Prisma/Netskope executive
 * and QBR reporting.
 *
 * Lifecycle:
 *  - A finding true this period with no existing open/in_progress/
 *    accepted_risk row for that key → INSERT a new 'open' row.
 *  - A finding true this period with an existing non-resolved row →
 *    UPDATE last_seen_at/evidence/occurrences (status and owner are left
 *    alone — those are operator-controlled via PATCH /api/remediation/:id).
 *  - A finding NOT true this period, but has a non-resolved row → the
 *    underlying condition cleared, so it is auto-resolved (status set to
 *    'resolved', resolved_at set to now). If the condition recurs later,
 *    a NEW row is created — the OLD resolved row remains as history
 *    (an honest "this came back" signal, not silently reopened).
 *
 * Fails soft everywhere: any D1 error is caught/logged and never blocks
 * report generation. If no `DB` binding is supplied, every function is a
 * safe no-op.
 */

import type { RemediationItem, RemediationStatus } from "../types";

export interface RemediationFinding {
  key: string;
  severity: "high" | "medium" | "low";
  title: string;
  description: string;
  benefit: string;
  evidence: string;
}

interface RemediationRow {
  id: string;
  account_id: string;
  finding_key: string;
  title: string;
  description: string;
  benefit: string;
  severity: string;
  status: string;
  owner_email: string | null;
  due_date: string | null;
  evidence: string;
  first_seen_at: string;
  last_seen_at: string;
  resolved_at: string | null;
  occurrences: number;
  updated_at: string;
}

function uuid(): string {
  return crypto.randomUUID();
}

function rowToItem(row: RemediationRow): RemediationItem {
  const endTs = row.resolved_at ? new Date(row.resolved_at).getTime() : Date.now();
  const startTs = new Date(row.first_seen_at).getTime();
  const ageDays = Number.isFinite(startTs) ? Math.max(0, Math.round((endTs - startTs) / 86_400_000)) : 0;
  return {
    id: row.id,
    accountId: row.account_id,
    findingKey: row.finding_key,
    title: row.title,
    description: row.description,
    benefit: row.benefit,
    severity: (["high", "medium", "low"].includes(row.severity) ? row.severity : "low") as RemediationItem["severity"],
    status: (["open", "in_progress", "accepted_risk", "resolved"].includes(row.status) ? row.status : "open") as RemediationStatus,
    ownerEmail: row.owner_email,
    dueDate: row.due_date,
    evidence: row.evidence,
    firstSeenAt: row.first_seen_at,
    lastSeenAt: row.last_seen_at,
    resolvedAt: row.resolved_at,
    occurrences: row.occurrences,
    ageDays,
  };
}

/**
 * Upserts this period's findings and auto-resolves any previously open
 * finding whose condition is no longer true. Call once per report
 * generation, after the underlying booleans are computed.
 */
export async function syncRemediationFindings(
  db: D1Database | undefined,
  accountId: string,
  generatedAt: string,
  findings: RemediationFinding[]
): Promise<void> {
  if (!db) return;
  try {
    const currentKeys = new Set(findings.map((f) => f.key));

    // Existing non-resolved rows for this account, to decide insert-vs-update
    // and to find rows that need auto-resolving.
    const { results } = await db
      .prepare(
        `SELECT id, finding_key FROM zt_remediation_items
         WHERE account_id = ? AND status != 'resolved'`
      )
      .bind(accountId)
      .all<{ id: string; finding_key: string }>();
    const openByKey = new Map<string, string>();
    for (const r of results ?? []) openByKey.set(r.finding_key, r.id);

    for (const f of findings) {
      const existingId = openByKey.get(f.key);
      if (existingId) {
        await db
          .prepare(
            `UPDATE zt_remediation_items
             SET title = ?, description = ?, benefit = ?, severity = ?,
                 evidence = ?, last_seen_at = ?, occurrences = occurrences + 1, updated_at = ?
             WHERE id = ?`
          )
          .bind(f.title, f.description, f.benefit, f.severity, f.evidence, generatedAt, generatedAt, existingId)
          .run();
      } else {
        await db
          .prepare(
            `INSERT INTO zt_remediation_items
               (id, account_id, finding_key, title, description, benefit, severity,
                status, owner_email, due_date, evidence, first_seen_at, last_seen_at,
                resolved_at, occurrences, updated_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, 'open', NULL, NULL, ?, ?, ?, NULL, 1, ?)`
          )
          .bind(uuid(), accountId, f.key, f.title, f.description, f.benefit, f.severity, f.evidence, generatedAt, generatedAt, generatedAt)
          .run();
      }
    }

    // Auto-resolve: any non-resolved row whose key is NOT in this period's findings.
    const staleKeys = Array.from(openByKey.keys()).filter((k) => !currentKeys.has(k));
    for (const key of staleKeys) {
      await db
        .prepare(
          `UPDATE zt_remediation_items
           SET status = 'resolved', resolved_at = ?, updated_at = ?
           WHERE account_id = ? AND finding_key = ? AND status != 'resolved'`
        )
        .bind(generatedAt, generatedAt, accountId, key)
        .run();
    }
  } catch (e) {
    console.warn("[zt-remediation] syncRemediationFindings failed:", String(e));
  }
}

/** Returns the register for an account: all open/in_progress/accepted_risk
 *  rows plus the 25 most recently resolved (bounded history), newest first
 *  within each status group. */
export async function getRemediationRegister(
  db: D1Database | undefined,
  accountId: string
): Promise<RemediationItem[]> {
  if (!db) return [];
  try {
    const { results: active } = await db
      .prepare(
        `SELECT * FROM zt_remediation_items
         WHERE account_id = ? AND status != 'resolved'
         ORDER BY CASE severity WHEN 'high' THEN 0 WHEN 'medium' THEN 1 ELSE 2 END, first_seen_at ASC`
      )
      .bind(accountId)
      .all<RemediationRow>();

    const { results: resolved } = await db
      .prepare(
        `SELECT * FROM zt_remediation_items
         WHERE account_id = ? AND status = 'resolved'
         ORDER BY resolved_at DESC LIMIT 25`
      )
      .bind(accountId)
      .all<RemediationRow>();

    return [...(active ?? []), ...(resolved ?? [])].map(rowToItem);
  } catch (e) {
    console.warn("[zt-remediation] getRemediationRegister failed:", String(e));
    return [];
  }
}

/** Updates operator-controlled fields on a single remediation item. */
export async function updateRemediationItem(
  db: D1Database,
  id: string,
  update: { status?: RemediationStatus; ownerEmail?: string | null; dueDate?: string | null }
): Promise<RemediationItem | null> {
  const now = new Date().toISOString();
  const sets: string[] = ["updated_at = ?"];
  const binds: unknown[] = [now];

  if (update.status !== undefined) {
    sets.push("status = ?");
    binds.push(update.status);
    if (update.status === "resolved") {
      sets.push("resolved_at = ?");
      binds.push(now);
    } else {
      sets.push("resolved_at = NULL");
    }
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
  await db.prepare(`UPDATE zt_remediation_items SET ${sets.join(", ")} WHERE id = ?`).bind(...binds).run();

  const row = await db.prepare("SELECT * FROM zt_remediation_items WHERE id = ?").bind(id).first<RemediationRow>();
  return row ? rowToItem(row) : null;
}
