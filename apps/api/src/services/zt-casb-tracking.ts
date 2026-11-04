/**
 * CASB / Data Security Posture finding lifecycle tracking.
 *
 * The same pattern as zt-remediation.ts, applied to individual findings from
 * REST /data-security/posture/findings instead of a fixed set of boolean
 * conditions: each finding is keyed by Cloudflare's own finding `id` (or a
 * stable severity+type+resource composite when no id is returned), so the
 * SAME real finding is tracked (age, owner, investigation status) across
 * report runs instead of appearing as an anonymous row in a fresh list every
 * time — the DLP/CASB equivalent of a "remediation register" / SaaS Risk
 * Assessment tracking sheet.
 *
 * Lifecycle:
 *  - A finding Cloudflare reports this period with no existing non-cleared
 *    tracking row → INSERT a new 'open' row.
 *  - A finding Cloudflare reports this period with an existing row →
 *    UPDATE last_seen_at/occurrences (status/owner are operator-controlled
 *    via PATCH, left untouched here).
 *  - A finding Cloudflare no longer reports (fixed/removed upstream) that
 *    still has an open/investigating row → auto-set cleared_at and, unless
 *    the operator already classified it as 'false_positive' or
 *    'accepted_risk', flip status to 'remediated' (Cloudflare no longer
 *    seeing it most likely means the underlying issue was fixed).
 *
 * Fails soft: any D1 error is caught/logged, never blocks report
 * generation. No `DB` binding → every function is a safe no-op.
 */

import type { CasbFindingItem, CasbFindingStatus } from "../types";

export interface CasbFindingInput {
  id?: string;
  severity: string;
  type: string;
  resourceName: string;
  integrationId?: string;
}

interface CasbFindingRow {
  id: string;
  account_id: string;
  finding_id: string;
  severity: string;
  finding_type: string;
  resource_name: string;
  integration_id: string | null;
  status: string;
  owner_email: string | null;
  due_date: string | null;
  first_seen_at: string;
  last_seen_at: string;
  cleared_at: string | null;
  occurrences: number;
  updated_at: string;
}

function uuid(): string {
  return crypto.randomUUID();
}

/** Stable identity for a finding — prefers Cloudflare's own id, falls back
 *  to a composite of fields that together identify "the same" exposure. */
function findingKey(f: CasbFindingInput): string {
  if (f.id) return f.id;
  return `${f.severity}::${f.type}::${f.resourceName}`.toLowerCase();
}

function rowToItem(row: CasbFindingRow): CasbFindingItem {
  const endTs = row.cleared_at ? new Date(row.cleared_at).getTime() : Date.now();
  const startTs = new Date(row.first_seen_at).getTime();
  const ageDays = Number.isFinite(startTs) ? Math.max(0, Math.round((endTs - startTs) / 86_400_000)) : 0;
  const validStatuses: CasbFindingStatus[] = ["open", "investigating", "remediated", "false_positive", "accepted_risk"];
  return {
    id: row.id,
    accountId: row.account_id,
    findingId: row.finding_id,
    severity: row.severity,
    type: row.finding_type,
    resourceName: row.resource_name,
    integrationId: row.integration_id,
    status: (validStatuses.includes(row.status as CasbFindingStatus) ? row.status : "open") as CasbFindingStatus,
    ownerEmail: row.owner_email,
    dueDate: row.due_date,
    firstSeenAt: row.first_seen_at,
    lastSeenAt: row.last_seen_at,
    clearedAt: row.cleared_at,
    occurrences: row.occurrences,
    ageDays,
  };
}

/** Upserts this period's CASB findings and auto-clears any tracked finding
 *  Cloudflare no longer reports. Call once per report generation. */
export async function syncCasbFindings(
  db: D1Database | undefined,
  accountId: string,
  generatedAt: string,
  findings: CasbFindingInput[]
): Promise<void> {
  if (!db) return;
  try {
    const currentKeys = new Set(findings.map(findingKey));

    const { results } = await db
      .prepare(
        `SELECT id, finding_id FROM zt_casb_findings
         WHERE account_id = ? AND cleared_at IS NULL`
      )
      .bind(accountId)
      .all<{ id: string; finding_id: string }>();
    const openByKey = new Map<string, string>();
    for (const r of results ?? []) openByKey.set(r.finding_id, r.id);

    for (const f of findings) {
      const key = findingKey(f);
      const existingId = openByKey.get(key);
      if (existingId) {
        await db
          .prepare(
            `UPDATE zt_casb_findings
             SET severity = ?, finding_type = ?, resource_name = ?, integration_id = ?,
                 last_seen_at = ?, occurrences = occurrences + 1, updated_at = ?
             WHERE id = ?`
          )
          .bind(f.severity, f.type, f.resourceName, f.integrationId ?? null, generatedAt, generatedAt, existingId)
          .run();
      } else {
        await db
          .prepare(
            `INSERT INTO zt_casb_findings
               (id, account_id, finding_id, severity, finding_type, resource_name, integration_id,
                status, owner_email, due_date, first_seen_at, last_seen_at, cleared_at, occurrences, updated_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, 'open', NULL, NULL, ?, ?, NULL, 1, ?)`
          )
          .bind(uuid(), accountId, key, f.severity, f.type, f.resourceName, f.integrationId ?? null, generatedAt, generatedAt, generatedAt)
          .run();
      }
    }

    // Auto-clear: tracked findings Cloudflare no longer reports this period.
    const staleKeys = Array.from(openByKey.keys()).filter((k) => !currentKeys.has(k));
    for (const key of staleKeys) {
      await db
        .prepare(
          `UPDATE zt_casb_findings
           SET cleared_at = ?, updated_at = ?,
               status = CASE WHEN status IN ('false_positive', 'accepted_risk') THEN status ELSE 'remediated' END
           WHERE account_id = ? AND finding_id = ? AND cleared_at IS NULL`
        )
        .bind(generatedAt, generatedAt, accountId, key)
        .run();
    }
  } catch (e) {
    console.warn("[zt-casb-tracking] syncCasbFindings failed:", String(e));
  }
}

/** Returns the register for an account: all non-cleared rows plus the 25
 *  most recently cleared (bounded history). */
export async function getCasbFindingRegister(
  db: D1Database | undefined,
  accountId: string
): Promise<CasbFindingItem[]> {
  if (!db) return [];
  try {
    const { results: active } = await db
      .prepare(
        `SELECT * FROM zt_casb_findings
         WHERE account_id = ? AND cleared_at IS NULL
         ORDER BY CASE severity WHEN 'critical' THEN 0 WHEN 'high' THEN 1 WHEN 'medium' THEN 2 WHEN 'low' THEN 3 ELSE 4 END, first_seen_at ASC`
      )
      .bind(accountId)
      .all<CasbFindingRow>();

    const { results: cleared } = await db
      .prepare(
        `SELECT * FROM zt_casb_findings
         WHERE account_id = ? AND cleared_at IS NOT NULL
         ORDER BY cleared_at DESC LIMIT 25`
      )
      .bind(accountId)
      .all<CasbFindingRow>();

    return [...(active ?? []), ...(cleared ?? [])].map(rowToItem);
  } catch (e) {
    console.warn("[zt-casb-tracking] getCasbFindingRegister failed:", String(e));
    return [];
  }
}

/** Updates operator-controlled fields on a single tracked finding. */
export async function updateCasbFindingItem(
  db: D1Database,
  id: string,
  update: { status?: CasbFindingStatus; ownerEmail?: string | null; dueDate?: string | null }
): Promise<CasbFindingItem | null> {
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
  await db.prepare(`UPDATE zt_casb_findings SET ${sets.join(", ")} WHERE id = ?`).bind(...binds).run();

  const row = await db.prepare("SELECT * FROM zt_casb_findings WHERE id = ?").bind(id).first<CasbFindingRow>();
  return row ? rowToItem(row) : null;
}
