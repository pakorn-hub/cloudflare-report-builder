/**
 * Zero Trust report baseline snapshots.
 *
 * Persists a small, non-sensitive subset of `ZeroTrustSummary` (counts only —
 * no emails, IPs, domains, or tokens) to D1 after every report generation
 * (interactive + scheduled), keyed by account ID. On the next generation for
 * the same account, the most recent prior snapshot is used to compute
 * period-over-period deltas ("vs previous report") — this is what turns a
 * point-in-time report into an operational trend signal.
 *
 * Fails soft: any D1 error is caught and logged, never blocks report
 * generation. If no `DB` binding is supplied (e.g. a caller that doesn't
 * have D1 access), both functions are no-ops.
 */

import type { ZeroTrustSummary } from "../types";

/** Numeric-only KPI fields worth tracking a baseline for — deliberately a
 *  subset of ZeroTrustSummary (excludes anything that isn't a plain count). */
const BASELINE_FIELDS = [
  "totalAuthEvents", "authSuccessRate", "uniqueUsers", "uniqueApps",
  "blockedAuthEvents", "gatewayDnsQueries", "gatewayDnsBlocked",
  "gatewayHttpRequests", "gatewayHttpBlocked", "httpRbiSessions",
  "httpQuarantinedRequests", "gatewayL4Sessions", "gatewayL4Blocked",
  "shadowItAppsDiscovered", "warpEnrolledDevices", "warpOnlineDevices",
  "warpOfflineDevices", "tunnelsHealthy", "tunnelsTotal", "seatsTotal",
  "seatsActiveInPeriod", "seatsNeverLoggedIn", "casbFindingsCount",
] as const satisfies readonly (keyof ZeroTrustSummary)[];

export interface BaselineDelta {
  previous: number;
  current: number;
  changePct: number | null;
}

export interface BaselineResult {
  previousGeneratedAt: string | null;
  previousDays: number | null;
  deltas: Record<string, BaselineDelta>;
}

function uuid(): string {
  return crypto.randomUUID();
}

/**
 * Fetches the most recent prior snapshot for this account (strictly before
 * `generatedAt`) and computes deltas against the current summary. Does NOT
 * persist anything — call `saveSnapshot` separately after this, so a report
 * never compares itself against itself if called twice for the same moment.
 */
export async function getBaseline(
  db: D1Database | undefined,
  accountId: string,
  generatedAt: string,
  current: ZeroTrustSummary
): Promise<BaselineResult> {
  const empty: BaselineResult = { previousGeneratedAt: null, previousDays: null, deltas: {} };
  if (!db) return empty;

  try {
    const row = await db
      .prepare(
        `SELECT generated_at, days, summary_json FROM zt_report_snapshots
         WHERE account_id = ? AND generated_at < ?
         ORDER BY generated_at DESC LIMIT 1`
      )
      .bind(accountId, generatedAt)
      .first<{ generated_at: string; days: number; summary_json: string }>();

    if (!row) return empty;

    const previous = JSON.parse(row.summary_json) as Partial<ZeroTrustSummary>;
    const deltas: Record<string, BaselineDelta> = {};
    for (const field of BASELINE_FIELDS) {
      const prevVal = previous[field];
      const curVal = current[field];
      if (typeof prevVal !== "number" || typeof curVal !== "number") continue;
      deltas[field] = {
        previous: prevVal,
        current: curVal,
        changePct: prevVal !== 0 ? Math.round(((curVal - prevVal) / prevVal) * 1000) / 10 : null,
      };
    }

    return { previousGeneratedAt: row.generated_at, previousDays: row.days, deltas };
  } catch (e) {
    console.warn("[zt-snapshots] getBaseline failed:", String(e));
    return empty;
  }
}

/** Persists the current summary as a new snapshot row. Fire-and-forget safe. */
export async function saveSnapshot(
  db: D1Database | undefined,
  accountId: string,
  generatedAt: string,
  since: string,
  until: string,
  days: number,
  summary: ZeroTrustSummary
): Promise<void> {
  if (!db) return;
  try {
    const subset: Partial<ZeroTrustSummary> = {};
    for (const field of BASELINE_FIELDS) subset[field] = summary[field];

    await db
      .prepare(
        `INSERT INTO zt_report_snapshots (id, account_id, generated_at, since, until, days, summary_json)
         VALUES (?, ?, ?, ?, ?, ?, ?)`
      )
      .bind(uuid(), accountId, generatedAt, since, until, days, JSON.stringify(subset))
      .run();

    // Housekeeping: keep at most the 50 most recent snapshots per account.
    await db
      .prepare(
        `DELETE FROM zt_report_snapshots WHERE account_id = ? AND id NOT IN (
           SELECT id FROM zt_report_snapshots WHERE account_id = ?
           ORDER BY generated_at DESC LIMIT 50
         )`
      )
      .bind(accountId, accountId)
      .run();
  } catch (e) {
    console.warn("[zt-snapshots] saveSnapshot failed:", String(e));
  }
}
