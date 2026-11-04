/**
 * Cloudflare Zone Analytics GraphQL client.
 * Core helpers ported from zt-soc-investigator/src/index.ts (gql, timeRange).
 * All queries scoped to a single zone over the past 30 days (GraphQL limit).
 *
 * Important limits:
 *  - httpRequests1dGroups: max 365 days, returns daily buckets
 *  - httpRequests1hGroups: max 48 hours sliding window
 *  - firewallEventsAdaptiveGroups: max 30 days
 *  - All datasets return up to 10,000 rows per query
 */

import { AI_BOT_REFERENCE, AI_REFERRAL_DOMAINS, findBotByUserAgent, findOperatorByRefererHost } from "./ai-bot-reference";

const CF_GRAPHQL = "https://api.cloudflare.com/client/v4/graphql";

// ─── Core GQL Helper ─────────────────────────────────────────────────────────

async function gql<T = unknown>(
  token: string,
  query: string,
  variables: Record<string, unknown>
): Promise<T> {
  const res = await fetch(CF_GRAPHQL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ query, variables }),
  });

  if (!res.ok) throw new Error(`GraphQL HTTP ${res.status}`);

  const j = (await res.json()) as {
    data?: { viewer?: { zones?: T[] } };
    errors?: { message: string }[];
  };

  if (j.errors?.length) {
    throw new Error(j.errors.map((e) => e.message).join("; "));
  }

  // Return the first zone's data
  return (j.data?.viewer?.zones?.[0] ?? {}) as T;
}

/**
 * Returns the appropriate date filter for a GraphQL query.
 * If since looks like an ISO timestamp (contains "T"), use datetime_geq/datetime_leq.
 * If since is a date string (YYYY-MM-DD), use date_geq/date_lt.
 * This lets us pass exact UTC timestamps for adaptive groups (matches dashboard)
 * while keeping date strings for 1d groups (only support date_geq).
 */
export function buildDateFilter(since: string, until: string): Record<string, string> {
  const isTimestamp = since.includes("T");
  if (isTimestamp) {
    // ISO timestamp — use datetime_geq/datetime_leq (exact window, matches dashboard)
    return { datetime_geq: since, datetime_leq: until };
  }
  // Date string — use date_geq/date_lt (daily granularity, inclusive/exclusive)
  return { date_geq: since, date_lt: until };
}

/**
 * Like buildDateFilter(), but returns the inline GraphQL filter TEXT for
 * embedding directly into a query template literal:
 *   filter: { ${rangeFilterClause(since)}, ...otherConditions }
 *
 * Adaptive datasets (httpRequestsAdaptiveGroups, firewallEventsAdaptiveGroups,
 * dnsAnalyticsAdaptiveGroups, …) accept BOTH filter families, and the field
 * must match the value format — Cloudflare rejects date-only strings in
 * datetime filters ("not an iso8601 time"). Callers that know the exact
 * window pass sinceTs/untilTs and get the real range (timezone-shifted local
 * days and intra-day bounds included); callers that only know the day keep
 * passing YYYY-MM-DD and get the original UTC-day semantics.
 */
export function rangeFilterClause(since: string): string {
  return since.includes("T")
    ? "datetime_geq: $since, datetime_leq: $until"
    : "date_geq: $since, date_lt: $until";
}

/** Like gql() but extracts from data.viewer.accounts[0] (account-level datasets). */
async function gqlAccount<T = unknown>(
  token: string,
  query: string,
  variables: Record<string, unknown>
): Promise<T> {
  const res = await fetch(CF_GRAPHQL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ query, variables }),
  });

  if (!res.ok) throw new Error(`GraphQL HTTP ${res.status}`);

  const j = (await res.json()) as {
    data?: { viewer?: { accounts?: T[] } };
    errors?: { message: string }[];
  };

  if (j.errors?.length) {
    throw new Error(j.errors.map((e) => e.message).join("; "));
  }

  return (j.data?.viewer?.accounts?.[0] ?? {}) as T;
}

// ─── Time Range ───────────────────────────────────────────────────────────────

/**
 * Returns { since, until } for the last N days, accounting for browser timezone.
 *
 * @param days     — number of days to look back (1, 3, 5, 7, 14, 30)
 * @param tzOffset — browser's getTimezoneOffset() value in minutes.
 *                   Positive = behind UTC (e.g. GMT-5 = 300),
 *                   Negative = ahead of UTC (e.g. GMT+7 = -420).
 *                   Default 0 = UTC.
 *
 * Key fixes:
 *   1. "Today" is computed in the USER'S local timezone, not UTC.
 *   2. `until` is set to TOMORROW in local time because Cloudflare's
 *      `date_lt` filter is EXCLUSIVE — data up to but not including
 *      the `until` date. Setting until = tomorrow means today is included.
 *   3. `since` is the start of N days ago in local time.
 */
export function last30Days(days = 30, tzOffset = 0): {
  since: string;        // YYYY-MM-DD — display "from" date (local)
  until: string;        // YYYY-MM-DD — display "to" date = TODAY (local)
  untilQuery: string;   // YYYY-MM-DD — for date_lt queries (daily granularity) = tomorrow
  sinceTs: string;      // ISO timestamp — for datetime_geq (hourly granularity) = exact "now - N days"
  untilTs: string;      // ISO timestamp — for datetime_leq (hourly granularity) = exact "now"
  days: number;         // the rolling window length (same field name as the
                        // other range helpers so pipelines can be mode-agnostic)
  periodLabel: string;  // e.g. "7-Day" — lowercase "n-day" handled by the AI prompts
} {
  // UTC "now" — used as the exact end timestamp for hourly queries
  const utcNow = Date.now();
  const nowTs = new Date(utcNow).toISOString(); // e.g. "2026-03-26T02:53:37.000Z"

  // "N days ago" — exact timestamp for hourly queries (matches dashboard behaviour)
  const nDaysAgoTs = new Date(utcNow - days * 24 * 60 * 60 * 1000).toISOString();

  // Local "today" and "N days ago" for display and daily (date_geq) queries
  // tzOffset = new Date().getTimezoneOffset() in minutes
  const localNow = new Date(utcNow - tzOffset * 60 * 1000);
  const localToday = localNow.toISOString().split("T")[0];
  const localTomorrow = new Date(localNow.getTime() + 24 * 60 * 60 * 1000)
    .toISOString().split("T")[0];
  // Display "since" date: N days ago in local time
  const localSince = new Date(localNow.getTime() - days * 24 * 60 * 60 * 1000)
    .toISOString().split("T")[0];

  return {
    since: localSince,
    until: localToday,
    untilQuery: localTomorrow,  // date_lt (exclusive) for daily datasets
    sinceTs: nDaysAgoTs,        // datetime_geq for hourly/adaptive datasets
    untilTs: nowTs,             // datetime_leq for hourly/adaptive datasets
    days,
    periodLabel: days === 1 ? "1-Day" : `${days}-Day`,
  };
}

const MONTH_NAMES = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

/**
 * Returns { since, until, ... } for a full CALENDAR month, unlike
 * `last30Days()` which is always a fixed-length rolling window. A rolling
 * "30 days" window never lines up with an actual month (28/29/30/31 days) —
 * a monthly-frequency scheduled report using days=30 silently drifts,
 * either including part of the month before or missing the last day or two
 * of a 31-day month. This computes the exact boundaries of the target
 * month (defaults to the PREVIOUS month relative to "now") in the caller's
 * local timezone, so "last month" always means the real last calendar
 * month regardless of how many days it had.
 *
 * @param tzOffset  — same convention as last30Days(): browser
 *                    getTimezoneOffset() in minutes.
 * @param monthsAgo — how many whole months back from the current local
 *                    month to target. 1 (default) = last month, 0 = the
 *                    current month-to-date is NOT what this returns (use
 *                    last30Days for partial/rolling ranges) — 0 here means
 *                    the current calendar month's already-elapsed portion
 *                    is NOT bounded specially, so callers needing "last
 *                    month" should always pass the default.
 */
export function lastCalendarMonth(tzOffset = 0, monthsAgo = 1, nowMs = Date.now()): {
  since: string;        // YYYY-MM-DD — first day of the target month (local)
  until: string;        // YYYY-MM-DD — last day of the target month (local)
  untilQuery: string;   // YYYY-MM-DD — for date_lt queries = first day of the FOLLOWING month
  sinceTs: string;      // ISO timestamp — exact UTC instant of the target month's start (local)
  untilTs: string;      // ISO timestamp — exact UTC instant 1ms before the following month starts (local)
  days: number;         // real day count for this specific month (28-31)
  periodLabel: string;  // e.g. "August 2026"
} {
  // Same "local-wall-clock-as-UTC" trick as last30Days(): shifting by
  // -tzOffset minutes lets getUTC*() read out local wall-clock components.
  const localNow = new Date(nowMs - tzOffset * 60 * 1000);
  const localYear  = localNow.getUTCFullYear();
  const localMonth = localNow.getUTCMonth(); // 0-11

  const targetIndex = localMonth - monthsAgo;
  const targetYear  = localYear + Math.floor(targetIndex / 12);
  const targetMonth = ((targetIndex % 12) + 12) % 12;

  // Target month's local start/end-exclusive, expressed as "local wall
  // clock stored as UTC ms" (mirrors localNow's representation above).
  const localMonthStartMs = Date.UTC(targetYear, targetMonth, 1, 0, 0, 0, 0);
  const localMonthEndExclusiveMs = Date.UTC(targetYear, targetMonth + 1, 1, 0, 0, 0, 0);
  const days = Math.round((localMonthEndExclusiveMs - localMonthStartMs) / (24 * 60 * 60 * 1000));

  // Convert back to real UTC instants — inverse of localNow's shift above
  // (last30Days: localNow = utcNow - tzOffset*60000, so utcNow = localNow + tzOffset*60000).
  const realStartUtcMs = localMonthStartMs + tzOffset * 60 * 1000;
  const realEndExclusiveUtcMs = localMonthEndExclusiveMs + tzOffset * 60 * 1000;

  return {
    since: new Date(localMonthStartMs).toISOString().split("T")[0],
    until: new Date(localMonthEndExclusiveMs - 24 * 60 * 60 * 1000).toISOString().split("T")[0],
    untilQuery: new Date(localMonthEndExclusiveMs).toISOString().split("T")[0],
    sinceTs: new Date(realStartUtcMs).toISOString(),
    untilTs: new Date(realEndExclusiveUtcMs - 1).toISOString(),
    days,
    periodLabel: `${MONTH_NAMES[targetMonth]} ${targetYear}`,
  };
}

// ─── Period mode: the last COMPLETE period, computed at run time ──────────────
/**
 * Period mode windows. Unlike rolling windows these are not anchored to
 * "now minus N days", and unlike custom ranges the bounds aren't frozen at
 * save time — "yesterday" always means the day before the run, so a daily
 * schedule keeps reporting full 00:00–23:59:59 local days forever. All
 * boundaries are in the caller's (the schedule's) timezone:
 *
 *   yesterday   — the previous local calendar day, 00:00:00–23:59:59.999
 *   last_week   — the previous Monday–Sunday, both boundaries local midnight
 *   last_month  — the previous local calendar month (real 28–31 days);
 *                 identical math to lastCalendarMonth(tzOffset, 1)
 */
export type ReportPeriod = "yesterday" | "last_week" | "last_month";

const DAY_MS = 24 * 60 * 60 * 1000;

export function lastPeriodRange(
  period: ReportPeriod,
  tzOffset = 0,
  nowMs = Date.now()
): {
  since: string;
  until: string;
  untilQuery: string;
  sinceTs: string;
  untilTs: string;
  days: number;
  periodLabel: string;
} {
  if (period === "last_month") {
    const m = lastCalendarMonth(tzOffset, 1, nowMs);
    return { ...m, periodLabel: `Last month (${m.periodLabel})` };
  }

  // Local wall clock, same "localNow-as-UTC" trick as lastCalendarMonth().
  const localNow = new Date(nowMs - tzOffset * 60 * 1000);
  const todayStartLocalMs = Date.UTC(localNow.getUTCFullYear(), localNow.getUTCMonth(), localNow.getUTCDate());

  let startLocalMs: number;
  let days: number;
  if (period === "yesterday") {
    startLocalMs = todayStartLocalMs - DAY_MS;
    days = 1;
  } else {
    // last_week: Monday–Sunday. (w - 1 + 7) % 7 maps Mon→0 … Sun→6, so this
    // week's Monday is found even mid-week, and "today is Monday" correctly
    // yields the FULL week that ended yesterday.
    const w = localNow.getUTCDay();
    const daysSinceMonday = (w - 1 + 7) % 7;
    const thisMonday = todayStartLocalMs - daysSinceMonday * DAY_MS;
    startLocalMs = thisMonday - 7 * DAY_MS;
    days = 7;
  }

  const endExclusiveLocalMs = startLocalMs + days * DAY_MS;
  // Real UTC instants — same inverse shift as lastCalendarMonth().
  const sinceTsMs = startLocalMs + tzOffset * 60 * 1000;
  const endExclusiveTsMs = endExclusiveLocalMs + tzOffset * 60 * 1000;

  // Date labels reuse customDateRange's formatting rules.
  const s = new Date(startLocalMs);
  const e = new Date(endExclusiveLocalMs - DAY_MS);
  const d = (n: number) => String(n);
  let windowLabel: string;
  if (days === 1) {
    windowLabel = `${MONTH_ABBR[s.getUTCMonth()]} ${d(s.getUTCDate())}, ${s.getUTCFullYear()}`;
  } else if (s.getUTCFullYear() === e.getUTCFullYear() && s.getUTCMonth() === e.getUTCMonth()) {
    windowLabel = `${MONTH_ABBR[s.getUTCMonth()]} ${d(s.getUTCDate())}–${d(e.getUTCDate())}, ${s.getUTCFullYear()}`;
  } else if (s.getUTCFullYear() === e.getUTCFullYear()) {
    windowLabel = `${MONTH_ABBR[s.getUTCMonth()]} ${d(s.getUTCDate())} – ${MONTH_ABBR[e.getUTCMonth()]} ${d(e.getUTCDate())}, ${s.getUTCFullYear()}`;
  } else {
    windowLabel = `${MONTH_ABBR[s.getUTCMonth()]} ${d(s.getUTCDate())}, ${s.getUTCFullYear()} – ${MONTH_ABBR[e.getUTCMonth()]} ${d(e.getUTCDate())}, ${e.getUTCFullYear()}`;
  }
  const periodLabel =
    period === "yesterday" ? `Yesterday (${windowLabel})` : `Last week (${windowLabel})`;

  return {
    since: new Date(startLocalMs).toISOString().split("T")[0],
    until: new Date(endExclusiveLocalMs - DAY_MS).toISOString().split("T")[0],
    untilQuery: new Date(endExclusiveLocalMs).toISOString().split("T")[0],
    sinceTs: new Date(sinceTsMs).toISOString(),
    untilTs: new Date(endExclusiveTsMs - 1).toISOString(),
    days,
    periodLabel,
  };
}

// ─── Custom explicit date range ───────────────────────────────────────────────
/**
 * customDateRange: an explicit user-selected range — the "time selector" for
 * interactive reports and schedules. Dates are YYYY-MM-DD local to the
 * caller's timezone; optional times (HH:MM, or HH:MM:SS) further bound the
 * start/end within those days. Defaults: sinceTime 00:00, untilTime 23:59
 * (i.e. whole days). Returns the same shape as last30Days()/lastCalendarMonth()
 * so all range modes are interchangeable downstream.
 *
 * Validation (returns null on any failure):
 *   - both dates must be strict YYYY-MM-DD that exist (2026-02-31 rejected)
 *   - times, when given, must be valid HH:MM[:SS] in 24h form
 *   - since ≤ until (date+time), and the end must not be in the future
 *     (local "now" is the latest allowed end instant)
 *   - date span 1..366 days (inclusive of both endpoint dates)
 */
const MONTH_ABBR = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

const TIME_RE = /^([01]\d|2[0-3]):([0-5]\d)(?::([0-5]\d))?$/;

function parseTimeParts(s: string | undefined, fallbackH: number, fallbackM: number): { h: number; m: number } | null {
  if (!s) return { h: fallbackH, m: fallbackM };
  const m = TIME_RE.exec(s);
  if (!m) return null;
  return { h: +m[1], m: +m[2] };
}

export function customDateRange(
  sinceDate: string,
  untilDate: string,
  tzOffset = 0,
  sinceTime?: string,
  untilTime?: string,
): {
  since: string;
  until: string;
  untilQuery: string;
  sinceTs: string;
  untilTs: string;
  days: number;
  periodLabel: string;
} | null {
  const DAY_MS = 24 * 60 * 60 * 1000;
  const parse = (s: string) => {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s ?? "");
    if (!m) return null;
    const y = +m[1], mo = +m[2] - 1, d = +m[3];
    // Reject rolled-over dates (e.g. Feb 31 → Mar 3)
    const ms = Date.UTC(y, mo, d);
    const dt = new Date(ms);
    if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== mo || dt.getUTCDate() !== d) return null;
    return { ms, y, mo, d };
  };
  const start = parse(sinceDate);
  const end = parse(untilDate);
  if (!start || !end) return null;

  // Times: default to a whole-day range — 00:00 start, 23:59 end (inclusive
  // through 23:59:59.999).
  const st = parseTimeParts(sinceTime, 0, 0);
  const et = parseTimeParts(untilTime, 23, 59);
  if (!st || !et) return null;

  const startLocalMs = start.ms + st.h * 60 * 60 * 1000 + st.m * 60 * 1000;
  const endMinuteLocalMs = end.ms + et.h * 60 * 60 * 1000 + et.m * 60 * 1000;
  // End is inclusive to the last ms of the chosen minute.
  const endExclusiveLocalMs = endMinuteLocalMs + 60 * 1000;

  // The end instant must not be before the start instant — dates can be
  // ordered correctly while times are reversed (e.g. same day 18:00 → 09:00).
  if (endMinuteLocalMs < startLocalMs) return null;

  // Calendar days covered (inclusive of both endpoint dates) — used for the
  // span cap and meta.days; intra-day times don't change it.
  const days = Math.round((end.ms - start.ms) / DAY_MS) + 1;
  if (days < 1 || days > 366) return null;

  // The end instant must not be in the future in the caller's local
  // timezone. Same local-wall-clock trick as last30Days()/lastCalendarMonth().
  const localNowMs = Date.now() - tzOffset * 60 * 1000;
  if (endMinuteLocalMs > localNowMs) return null;

  // Real UTC instants: local wall clock → UTC via the inverse tz shift.
  const sinceTsMs = startLocalMs + tzOffset * 60 * 1000;
  const endExclusiveTsMs = endExclusiveLocalMs + tzOffset * 60 * 1000;

  // Human label for meta/AI summaries: "Sep 1–15, 2026" / "Aug 30 – Sep 3,
  // 2026" / "Dec 28, 2025 – Jan 3, 2026" / single day: "Sep 3, 2026".
  // Intra-day bounds append as ", HH:MM–HH:MM" when non-default.
  const d = (n: number) => String(n);
  const hh = (t: { h: number; m: number }) => `${String(t.h).padStart(2, "0")}:${String(t.m).padStart(2, "0")}`;
  let periodLabel: string;
  if (days === 1) {
    periodLabel = `${MONTH_ABBR[start.mo]} ${d(start.d)}, ${start.y}`;
  } else if (start.y === end.y && start.mo === end.mo) {
    periodLabel = `${MONTH_ABBR[start.mo]} ${d(start.d)}–${d(end.d)}, ${start.y}`;
  } else if (start.y === end.y) {
    periodLabel = `${MONTH_ABBR[start.mo]} ${d(start.d)} – ${MONTH_ABBR[end.mo]} ${d(end.d)}, ${start.y}`;
  } else {
    periodLabel = `${MONTH_ABBR[start.mo]} ${d(start.d)}, ${start.y} – ${MONTH_ABBR[end.mo]} ${d(end.d)}, ${end.y}`;
  }
  const defaultTimes = st.h === 0 && st.m === 0 && et.h === 23 && et.m === 59;
  if (!defaultTimes) periodLabel += `, ${hh(st)}–${hh(et)}`;

  return {
    since: sinceDate,
    until: untilDate,
    untilQuery: new Date(end.ms + DAY_MS).toISOString().split("T")[0],
    sinceTs: new Date(sinceTsMs).toISOString(),
    untilTs: new Date(endExclusiveTsMs - 1).toISOString(),
    days,
    periodLabel,
  };
}

// ─── 1. HTTP Requests — Daily Time Series ─────────────────────────────────────
/**
 * httpRequests1dGroups: total requests, cached, uncached, bytes, errors per day.
 */
export interface HttpDaySeries {
  date: string;
  requests: number;
  cachedRequests: number;
  uncachedRequests: number;
  bytes: number;
  cachedBytes: number;
  threats: number;
  pageViews: number;
  unique: number;
}

export async function fetchHttpRequestsTimeSeries(
  token: string,
  zoneId: string,
  since: string,
  until: string
): Promise<HttpDaySeries[]> {
  const query = `
    query HttpTimeSeries($zoneTag: string!, $since: string!, $until: string!) {
      viewer {
        zones(filter: { zoneTag: $zoneTag }) {
          httpRequests1dGroups(
            limit: 31
            filter: { date_geq: $since, date_lt: $until }
            orderBy: [date_ASC]
          ) {
            dimensions { date }
            sum {
              requests cachedRequests
              bytes cachedBytes threats pageViews
            }
          }
        }
      }
    }
  `;

  const data = await gql<{
    httpRequests1dGroups: Array<{
      dimensions: { date: string };
      sum: {
        requests: number;
        cachedRequests: number;
        bytes: number;
        cachedBytes: number;
        threats: number;
        pageViews: number;
      };
    }>;
  }>(token, query, { zoneTag: zoneId, since, until });

  return (data.httpRequests1dGroups ?? []).map((d) => ({
    date: d.dimensions.date,
    requests: d.sum.requests,
    cachedRequests: d.sum.cachedRequests,
    uncachedRequests: d.sum.requests - d.sum.cachedRequests,
    bytes: d.sum.bytes,
    cachedBytes: d.sum.cachedBytes,
    threats: d.sum.threats,
    pageViews: d.sum.pageViews,
    unique: 0, // not available in httpRequests1dGroups
  }));
}

// ─── 1b. HTTP Requests — Hourly Time Series (for short windows ≤ 2 days) ─────
/**
 * httpRequests1hGroups: hourly buckets for short time windows.
 * Matches the CF dashboard when time-window < 48 hours.
 * Max range: 48 hours sliding window.
 */
export async function fetchHttpRequestsHourly(
  token: string,
  zoneId: string,
  since: string,  // ISO timestamp e.g. "2026-03-25T03:00:00Z"
  until: string   // ISO timestamp e.g. "2026-03-26T03:00:00Z"
): Promise<HttpDaySeries[]> {
  const query = `
    query HttpHourly($zoneTag: string!, $since: string!, $until: string!) {
      viewer {
        zones(filter: { zoneTag: $zoneTag }) {
          httpRequests1hGroups(
            limit: 10000
            filter: { datetime_geq: $since, datetime_lt: $until }
            orderBy: [datetime_ASC]
          ) {
            dimensions { timeslot: datetime }
            uniq { uniques }
            sum {
              requests cachedRequests
              bytes cachedBytes threats pageViews
            }
          }
        }
      }
    }
  `;

  const data = await gql<{
    httpRequests1hGroups: Array<{
      dimensions: { timeslot: string };
      uniq: { uniques: number };
      sum: {
        requests: number;
        cachedRequests: number;
        bytes: number;
        cachedBytes: number;
        threats: number;
        pageViews: number;
      };
    }>;
  }>(token, query, { zoneTag: zoneId, since, until });

  return (data.httpRequests1hGroups ?? []).map((d) => ({
    date: d.dimensions.timeslot,  // ISO datetime for hourly (not just date)
    requests: d.sum.requests,
    cachedRequests: d.sum.cachedRequests,
    uncachedRequests: d.sum.requests - d.sum.cachedRequests,
    bytes: d.sum.bytes,
    cachedBytes: d.sum.cachedBytes,
    threats: d.sum.threats,
    pageViews: d.sum.pageViews,
    unique: d.uniq?.uniques ?? 0,
  }));
}

// ─── 2. HTTP Status Codes — Daily Error Breakdown ────────────────────────────
/**
 * Breakdown of 2xx/3xx/4xx/5xx response codes per day.
 */
export interface ErrorDaySeries {
  date: string;
  e2xx: number;
  e3xx: number;
  e4xx: number;
  e5xx: number;
}

export async function fetchHttpErrorTimeSeries(
  token: string,
  zoneId: string,
  since: string,
  until: string
): Promise<ErrorDaySeries[]> {
  const query = `
    query HttpErrors($zoneTag: string!, $since: string!, $until: string!) {
      viewer {
        zones(filter: { zoneTag: $zoneTag }) {
          httpRequests1dGroups(
            limit: 31
            filter: { date_geq: $since, date_lt: $until }
            orderBy: [date_ASC]
          ) {
            dimensions { date }
            sum {
              responseStatusMap {
                edgeResponseStatus
                requests
              }
            }
          }
        }
      }
    }
  `;

  const data = await gql<{
    httpRequests1dGroups: Array<{
      dimensions: { date: string };
      sum: {
        responseStatusMap: Array<{
          edgeResponseStatus: number;
          requests: number;
        }>;
      };
    }>;
  }>(token, query, { zoneTag: zoneId, since, until });

  return (data.httpRequests1dGroups ?? []).map((d) => {
    const byCode: Record<string, number> = { "1": 0, "2": 0, "3": 0, "4": 0, "5": 0 };
    for (const s of d.sum.responseStatusMap ?? []) {
      const prefix = String(Math.floor(s.edgeResponseStatus / 100));
      byCode[prefix] = (byCode[prefix] ?? 0) + s.requests;
    }
    return {
      date: d.dimensions.date,
      e1xx: byCode["1"] ?? 0,
      e2xx: byCode["2"] ?? 0,
      e3xx: byCode["3"] ?? 0,
      e4xx: byCode["4"] ?? 0,
      e5xx: byCode["5"] ?? 0,
    };
  });
}

// ─── 3. Firewall / WAF Events — Daily Time Series ─────────────────────────────
/**
 * firewallEventsAdaptiveGroups: blocked/challenged/logged events per day.
 * Limit: 30 days.
 */
export interface WafDaySeries {
  date: string;
  block: number;
  challenge: number;
  managed_challenge: number;
  log: number;
  skip: number;
}

export async function fetchWafTimeSeries(
  token: string,
  zoneId: string,
  since: string,
  until: string
): Promise<WafDaySeries[]> {
  // 30 days × up to 5 action types = ~150 rows max needed
  const query = `
    query WafTimeSeries($zoneTag: string!, $since: Date!, $until: Date!) {
      viewer {
        zones(filter: { zoneTag: $zoneTag }) {
          firewallEventsAdaptiveGroups(
            limit: 200
            filter: { ${rangeFilterClause(since)} }
            orderBy: [date_ASC]
          ) {
            dimensions { date action }
            count
          }
        }
      }
    }
  `;

  const data = await gql<{
    firewallEventsAdaptiveGroups: Array<{
      dimensions: { date: string; action: string };
      count: number;
    }>;
  }>(token, query, { zoneTag: zoneId, since, until });

  // Group by date, pivot action columns
  const byDate = new Map<string, WafDaySeries>();
  for (const row of data.firewallEventsAdaptiveGroups ?? []) {
    const { date, action } = row.dimensions;
    if (!byDate.has(date)) {
      byDate.set(date, { date, block: 0, challenge: 0, managed_challenge: 0, log: 0, skip: 0 });
    }
    const entry = byDate.get(date)!;
    const key = action.toLowerCase().replace(/-/g, "_") as keyof WafDaySeries;
    if (key in entry && key !== "date") {
      (entry[key] as number) += row.count;
    }
  }

  return Array.from(byDate.values()).sort((a, b) => a.date.localeCompare(b.date));
}

// ─── 4. WAF Top Rules (bar chart) ─────────────────────────────────────────────

export interface WafTopRuleRow {
  ruleId: string;
  source: string;
  action: string;
  description: string;
  rulesetId: string;
  kind: string;
  count: number;
}

export async function fetchWafTopRules(
  token: string,
  zoneId: string,
  since: string,
  until: string,
  limit = 10
): Promise<WafTopRuleRow[]> {
  const query = `
    query WafTopRules($zoneTag: string!, $since: Date!, $until: Date!, $limit: int!) {
      viewer {
        zones(filter: { zoneTag: $zoneTag }) {
          firewallEventsAdaptiveGroups(
            limit: $limit
            filter: { ${rangeFilterClause(since)}, action_neq: "allow" }
            orderBy: [count_DESC]
          ) {
            dimensions { ruleId source action description rulesetId kind }
            count
          }
        }
      }
    }
  `;

  const data = await gql<{
    firewallEventsAdaptiveGroups: Array<{
      dimensions: {
        ruleId: string; source: string; action: string;
        description: string; rulesetId: string; kind: string;
      };
      count: number;
    }>;
  }>(token, query, { zoneTag: zoneId, since, until, limit });

  return (data.firewallEventsAdaptiveGroups ?? []).map((r) => ({
    ruleId: r.dimensions.ruleId || "unknown",
    source: r.dimensions.source || "unknown",
    action: r.dimensions.action,
    description: r.dimensions.description || "",
    rulesetId: r.dimensions.rulesetId || "",
    kind: r.dimensions.kind || "",
    count: r.count,
  }));
}

// ─── 4b. WAF Attack Score Breakdown ───────────────────────────────────────────
/**
 * Events triggered by WAF Attack Score (ML-based detection).
 * Groups by wafAttackScoreClass and action to show how many requests
 * fell into each score class (attack/likely_attack/likely_clean/clean).
 */
export interface WafAttackScoreRow {
  scoreClass: string;   // "attack", "likely_attack", "likely_clean", "clean"
  action: string;
  count: number;
}

export async function fetchWafAttackScoreBreakdown(
  token: string,
  zoneId: string,
  since: string,
  until: string,
  limit = 20
): Promise<WafAttackScoreRow[]> {
  const query = `
    query WafAttackScore($zoneTag: string!, $since: Date!, $until: Date!, $limit: int!) {
      viewer {
        zones(filter: { zoneTag: $zoneTag }) {
          firewallEventsAdaptiveGroups(
            limit: $limit
            filter: {
              ${rangeFilterClause(since)},
              wafAttackScoreClass_neq: "clean"
            }
            orderBy: [count_DESC]
          ) {
            dimensions { wafAttackScoreClass action }
            count
          }
        }
      }
    }
  `;

  const data = await gql<{
    firewallEventsAdaptiveGroups: Array<{
      dimensions: { wafAttackScoreClass: string; action: string };
      count: number;
    }>;
  }>(token, query, { zoneTag: zoneId, since, until, limit });

  return (data.firewallEventsAdaptiveGroups ?? []).map((r) => ({
    scoreClass: r.dimensions.wafAttackScoreClass || "unknown",
    action: r.dimensions.action,
    count: r.count,
  }));
}

// ─── 5. WAF Top Countries ─────────────────────────────────────────────────────

export interface WafTopCountryRow {
  country: string;
  action: string;
  count: number;
}

export async function fetchWafTopCountries(
  token: string,
  zoneId: string,
  since: string,
  until: string,
  limit = 10
): Promise<WafTopCountryRow[]> {
  const query = `
    query WafTopCountries($zoneTag: string!, $since: Date!, $until: Date!, $limit: int!) {
      viewer {
        zones(filter: { zoneTag: $zoneTag }) {
          firewallEventsAdaptiveGroups(
            limit: $limit
            filter: { ${rangeFilterClause(since)}, action_neq: "allow" }
            orderBy: [count_DESC]
          ) {
            dimensions { clientCountryName action }
            count
          }
        }
      }
    }
  `;

  const data = await gql<{
    firewallEventsAdaptiveGroups: Array<{
      dimensions: { clientCountryName: string; action: string };
      count: number;
    }>;
  }>(token, query, { zoneTag: zoneId, since, until, limit });

  return (data.firewallEventsAdaptiveGroups ?? []).map((r) => ({
    country: r.dimensions.clientCountryName || "Unknown",
    action: r.dimensions.action,
    count: r.count,
  }));
}

// ─── 6. WAF Top Paths ─────────────────────────────────────────────────────────

export interface WafTopPathRow {
  host: string;
  path: string;
  url: string;   // host + path combined for display
  action: string;
  count: number;
}

export async function fetchWafTopPaths(
  token: string,
  zoneId: string,
  since: string,
  until: string,
  limit = 10
): Promise<WafTopPathRow[]> {
  const query = `
    query WafTopPaths($zoneTag: string!, $since: Date!, $until: Date!, $limit: int!) {
      viewer {
        zones(filter: { zoneTag: $zoneTag }) {
          firewallEventsAdaptiveGroups(
            limit: $limit
            filter: { ${rangeFilterClause(since)}, action_neq: "allow" }
            orderBy: [count_DESC]
          ) {
            dimensions { clientRequestHTTPHost clientRequestPath action }
            count
          }
        }
      }
    }
  `;

  const data = await gql<{
    firewallEventsAdaptiveGroups: Array<{
      dimensions: { clientRequestHTTPHost: string; clientRequestPath: string; action: string };
      count: number;
    }>;
  }>(token, query, { zoneTag: zoneId, since, until, limit });

  return (data.firewallEventsAdaptiveGroups ?? []).map((r) => {
    const host = r.dimensions.clientRequestHTTPHost || "";
    const path = r.dimensions.clientRequestPath || "/";
    return {
      host,
      path,
      url: host ? `${host}${path}` : path,
      action: r.dimensions.action,
      count: r.count,
    };
  });
}

// ─── 7. Bot Management — Daily Time Series ────────────────────────────────────
/**
 * Official Cloudflare bot score buckets:
 *   0     = Not computed (Bot Management not active / request not scored)
 *   1     = Automated (definitely a bot)
 *   2–29  = Likely automated
 *   30–99 = Likely human
 */
export interface BotDaySeries {
  date: string;
  botRequests: number;       // score 1      (Automated)
  likelyBotRequests: number; // score 2–29   (Likely automated)
  humanRequests: number;     // score 30–99  (Likely human)
  // Note: score 0 = Not computed (Bot Management not active)
}

export async function fetchBotTimeSeries(
  token: string,
  zoneId: string,
  since: string,
  until: string
): Promise<BotDaySeries[]> {
  // Official Cloudflare bot score groupings:
  //   0     = Not computed (Bot Management not active / request not scored)
  //   1     = Automated
  //   2-29  = Likely automated
  //   30-99 = Likely human
  const botQuery = (scoreGte: number, scoreLte: number) => `
    query BotBand($zoneTag: string!, $since: string!, $until: string!) {
      viewer {
        zones(filter: { zoneTag: $zoneTag }) {
          httpRequestsAdaptiveGroups(
            limit: 31
            filter: {
              ${rangeFilterClause(since)},
              requestSource: "eyeball",
              botScore_geq: ${scoreGte}, botScore_leq: ${scoreLte}
            }
          ) {
            dimensions { date }
            count
          }
        }
      }
    }
  `;

  const vars = { zoneTag: zoneId, since, until };

  const [automatedR, likelyAutomatedR, likelyHumanR] = await Promise.allSettled([
    gql<{ httpRequestsAdaptiveGroups: Array<{ dimensions: { date: string }; count: number }> }>(token, botQuery(1, 1), vars),    // Automated (score 1)
    gql<{ httpRequestsAdaptiveGroups: Array<{ dimensions: { date: string }; count: number }> }>(token, botQuery(2, 29), vars),   // Likely automated (score 2–29)
    gql<{ httpRequestsAdaptiveGroups: Array<{ dimensions: { date: string }; count: number }> }>(token, botQuery(30, 99), vars),  // Likely human (score 30–99)
  ]);

  const toMap = (r: PromiseSettledResult<{ httpRequestsAdaptiveGroups?: Array<{ dimensions: { date: string }; count: number }> }>): Map<string, number> => {
    const m = new Map<string, number>();
    if (r.status === "fulfilled") {
      for (const d of r.value.httpRequestsAdaptiveGroups ?? []) {
        m.set(d.dimensions.date, d.count);
      }
    }
    return m;
  };

  const automatedMap      = toMap(automatedR);
  const likelyAutomatedMap = toMap(likelyAutomatedR);
  const likelyHumanMap    = toMap(likelyHumanR);

  // Union all dates
  const allDates = new Set([
    ...automatedMap.keys(),
    ...likelyAutomatedMap.keys(),
    ...likelyHumanMap.keys(),
  ]);
  return Array.from(allDates)
    .sort()
    .map((date) => ({
      date,
      botRequests:       automatedMap.get(date) ?? 0,        // score 1     Automated
      likelyBotRequests: likelyAutomatedMap.get(date) ?? 0, // score 2–29  Likely automated
      humanRequests:     likelyHumanMap.get(date) ?? 0,     // score 30–99 Likely human
    }));
}

// ─── 8. Cache Status Breakdown (pie chart) ───────────────────────────────────

export interface CacheStatusRow {
  cacheStatus: string;
  requests: number;
  bytes: number;
}

export async function fetchCacheStatusBreakdown(
  token: string,
  zoneId: string,
  since: string,
  until: string
): Promise<CacheStatusRow[]> {
  const query = `
    query CacheBreakdown($zoneTag: string!, $since: string!, $until: string!) {
      viewer {
        zones(filter: { zoneTag: $zoneTag }) {
          httpRequestsAdaptiveGroups(
            limit: 20
            filter: { ${rangeFilterClause(since)}, requestSource: "eyeball" }
            orderBy: [count_DESC]
          ) {
            dimensions { cacheStatus }
            sum { edgeResponseBytes }
            avg { sampleInterval }
            count
          }
        }
      }
    }
  `;

  const data = await gql<{
    httpRequestsAdaptiveGroups: Array<{
      dimensions: { cacheStatus: string };
      sum: { edgeResponseBytes: number };
      avg: { sampleInterval: number };
      count: number;
    }>;
  }>(token, query, { zoneTag: zoneId, since, until });

  return (data.httpRequestsAdaptiveGroups ?? []).map((r) => ({
    cacheStatus: r.dimensions.cacheStatus || "unknown",
    requests: r.count,
    bytes: r.sum.edgeResponseBytes,
  }));
}

// ─── 9. TLS Version Breakdown (pie chart) ────────────────────────────────────

export interface TlsVersionRow {
  tlsVersion: string;
  requests: number;
}

export async function fetchTlsVersionBreakdown(
  token: string,
  zoneId: string,
  since: string,
  until: string
): Promise<TlsVersionRow[]> {
  const query = `
    query TlsBreakdown($zoneTag: string!, $since: string!, $until: string!) {
      viewer {
        zones(filter: { zoneTag: $zoneTag }) {
          httpRequestsAdaptiveGroups(
            limit: 10
            filter: { ${rangeFilterClause(since)}, requestSource: "eyeball" }
            orderBy: [count_DESC]
          ) {
            dimensions { clientSSLProtocol }
            avg { sampleInterval }
            count
          }
        }
      }
    }
  `;

  const data = await gql<{
    httpRequestsAdaptiveGroups: Array<{
      dimensions: { clientSSLProtocol: string };
      avg: { sampleInterval: number };
      count: number;
    }>;
  }>(token, query, { zoneTag: zoneId, since, until });

  return (data.httpRequestsAdaptiveGroups ?? []).map((r) => ({
    tlsVersion: r.dimensions.clientSSLProtocol || "unknown",
    requests: r.count,
  }));
}

// ─── 9b. TLS Key Exchange Group Breakdown (Post-Quantum Cryptography) ────────
/**
 * Breaks down TLS handshakes by key exchange group (clientTLSKeyExchangeGroup).
 * Hybrid post-quantum groups combine a classical ECDH exchange with a
 * quantum-resistant KEM. Cloudflare's edge has enabled these by default —
 * adoption depends on client (browser) support:
 *   X25519MLKEM768        — current standardized hybrid PQC group (ML-KEM-768, FIPS 203)
 *   X25519Kyber768Draft00 — earlier draft name for the same hybrid group
 */
export interface TlsKeyExchangeRow {
  group: string;
  requests: number;
}

export const PQC_KEY_EXCHANGE_GROUPS = ["X25519MLKEM768", "X25519Kyber768Draft00"];

export function isPqcKeyExchangeGroup(group: string | null | undefined): boolean {
  const g = (group ?? "");
  return PQC_KEY_EXCHANGE_GROUPS.some((pqc) => g.includes(pqc));
}

/**
 * Cloudflare returns the literal value "UNK" (and occasionally an empty
 * string) for `clientTLSKeyExchangeGroup` whenever no key exchange group was
 * negotiated — plaintext HTTP requests, TLS 1.2 connections using static/
 * non-ephemeral ciphers, or resumed sessions. This is real data, not missing
 * data, but it is NOT applicable to PQC adoption and should be excluded from
 * that rate calculation (and labeled clearly rather than shown as a mystery
 * "UNK" bucket) to avoid diluting/confusing the metric.
 */
export function isUnknownKeyExchangeGroup(group: string | null | undefined): boolean {
  const g = (group ?? "").trim().toUpperCase();
  return g === "" || g === "UNK" || g === "UNKNOWN" || g === "NONE";
}

export async function fetchTlsKeyExchangeBreakdown(
  token: string,
  zoneId: string,
  since: string,
  until: string
): Promise<TlsKeyExchangeRow[]> {
  const query = `
    query TlsKeyExchangeBreakdown($zoneTag: string!, $since: string!, $until: string!) {
      viewer {
        zones(filter: { zoneTag: $zoneTag }) {
          httpRequestsAdaptiveGroups(
            limit: 20
            filter: { ${rangeFilterClause(since)}, requestSource: "eyeball" }
            orderBy: [count_DESC]
          ) {
            dimensions { clientTLSKeyExchangeGroup }
            avg { sampleInterval }
            count
          }
        }
      }
    }
  `;

  try {
    const data = await gql<{
      httpRequestsAdaptiveGroups: Array<{
        dimensions: { clientTLSKeyExchangeGroup: string };
        avg: { sampleInterval: number };
        count: number;
      }>;
    }>(token, query, { zoneTag: zoneId, since, until });

    return (data.httpRequestsAdaptiveGroups ?? []).map((r) => ({
      group: r.dimensions.clientTLSKeyExchangeGroup || "unknown",
      requests: r.count,
    }));
  } catch {
    return [];
  }
}

// ─── 10. HTTP Protocol Breakdown ──────────────────────────────────────────────

export interface HttpProtocolRow {
  protocol: string;   // HTTP/1.1, HTTP/2, HTTP/3
  requests: number;
}

export async function fetchHttpProtocolBreakdown(
  token: string,
  zoneId: string,
  since: string,
  until: string
): Promise<HttpProtocolRow[]> {
  const query = `
    query ProtocolBreakdown($zoneTag: string!, $since: string!, $until: string!) {
      viewer {
        zones(filter: { zoneTag: $zoneTag }) {
          httpRequestsAdaptiveGroups(
            limit: 10
            filter: { ${rangeFilterClause(since)}, requestSource: "eyeball" }
            orderBy: [count_DESC]
          ) {
            dimensions { clientRequestHTTPProtocol }
            avg { sampleInterval }
            count
          }
        }
      }
    }
  `;

  const data = await gql<{
    httpRequestsAdaptiveGroups: Array<{
      dimensions: { clientRequestHTTPProtocol: string };
      avg: { sampleInterval: number };
      count: number;
    }>;
  }>(token, query, { zoneTag: zoneId, since, until });

  return (data.httpRequestsAdaptiveGroups ?? []).map((r) => ({
    protocol: r.dimensions.clientRequestHTTPProtocol || "unknown",
    requests: r.count,
  }));
}

// ─── 11. DDoS — Mitigated Requests Time Series ───────────────────────────────
/**
 * firewallEventsAdaptiveGroups filtered by source="l7ddos" gives L7 DDoS
 * mitigation events. NOTE: the correct value is "l7ddos", NOT "ddos" — "ddos"
 * matches zero rows on every zone (silently, since `source` is an
 * unvalidated string field, not a real enum — Cloudflare's API returns an
 * empty 200 OK instead of erroring on an unknown value). This previously
 * caused "DDoS Mitigated: 0" on every report regardless of actual attack
 * traffic. The correct "l7ddos" value is already used correctly elsewhere in
 * this codebase (classifyWafEvent, SecurityScoreSection.tsx, ai-summary.ts).
 */
export interface DDoSDaySeries {
  date: string;
  mitigated: number;
}

export async function fetchDdosTimeSeries(
  token: string,
  zoneId: string,
  since: string,
  until: string
): Promise<DDoSDaySeries[]> {
  const query = `
    query DDoSSeries($zoneTag: string!, $since: Date!, $until: Date!) {
      viewer {
        zones(filter: { zoneTag: $zoneTag }) {
          firewallEventsAdaptiveGroups(
            limit: 31
            filter: {
              ${rangeFilterClause(since)},
              source: "l7ddos"
            }
            orderBy: [date_ASC]
          ) {
            dimensions { date }
            count
          }
        }
      }
    }
  `;

  const data = await gql<{
    firewallEventsAdaptiveGroups: Array<{
      dimensions: { date: string };
      count: number;
    }>;
  }>(token, query, { zoneTag: zoneId, since, until });

  return (data.firewallEventsAdaptiveGroups ?? []).map((r) => ({
    date: r.dimensions.date,
    mitigated: r.count,
  }));
}

// ─── 12. DDoS Attack Vectors (bar chart) ─────────────────────────────────────

export interface DDoSVectorRow {
  vector: string;   // ruleId maps to vector type in DDoS context
  action: string;
  count: number;
}

export async function fetchDdosVectors(
  token: string,
  zoneId: string,
  since: string,
  until: string,
  limit = 10
): Promise<DDoSVectorRow[]> {
  const query = `
    query DDoSVectors($zoneTag: string!, $since: Date!, $until: Date!, $limit: int!) {
      viewer {
        zones(filter: { zoneTag: $zoneTag }) {
          firewallEventsAdaptiveGroups(
            limit: $limit
            filter: {
              ${rangeFilterClause(since)},
              source: "l7ddos"
            }
            orderBy: [count_DESC]
          ) {
            dimensions { ruleId action }
            count
          }
        }
      }
    }
  `;

  const data = await gql<{
    firewallEventsAdaptiveGroups: Array<{
      dimensions: { ruleId: string; action: string };
      count: number;
    }>;
  }>(token, query, { zoneTag: zoneId, since, until, limit });

  return (data.firewallEventsAdaptiveGroups ?? []).map((r) => ({
    vector: r.dimensions.ruleId || "unknown",
    action: r.dimensions.action,
    count: r.count,
  }));
}

// ═══════════════════════════════════════════════════════════════════════════════
// PHASE 1 — Web Analytics & Geographic
// ═══════════════════════════════════════════════════════════════════════════════

// ─── 13. Country Distribution (world map + top 20 table) ──────────────────────
/**
 * httpRequests1dGroups with countryMap: requests + bytes + threats per country.
 * Returns aggregated totals across the full date range, sorted by requests desc.
 */
export interface CountryRow {
  clientCountryName: string;   // Full country name (e.g. "United States")
  requests: number;
  bytes: number;
  threats: number;
}

export async function fetchCountryDistribution(
  token: string,
  zoneId: string,
  since: string,
  until: string,
  limit = 20
): Promise<CountryRow[]> {
  // httpRequestsAdaptiveGroups has no per-country `threats` aggregate (the
  // 1dGroups countryMap did), so compose the exact-window view from two
  // adaptive queries in parallel:
  //   1. requests + bytes per country  (http adaptive, `count`/`sum`)
  //   2. threats per country           (firewall events, action ≠ allow —
  //      the same proxy fetchWafTopCountries uses; sampled like the rest of
  //      the adaptive family, but scoped to the exact window)
  const reqQuery = `
    query CountryDistribution($zoneTag: string!, $since: string!, $until: string!) {
      viewer {
        zones(filter: { zoneTag: $zoneTag }) {
          httpRequestsAdaptiveGroups(
            limit: 200
            filter: { ${rangeFilterClause(since)} }
            orderBy: [count_DESC]
          ) {
            dimensions { clientCountryName }
            count
            sum { edgeResponseBytes }
            avg { sampleInterval }
          }
        }
      }
    }
  `;
  const threatQuery = `
    query CountryThreats($zoneTag: string!, $since: string!, $until: string!) {
      viewer {
        zones(filter: { zoneTag: $zoneTag }) {
          firewallEventsAdaptiveGroups(
            limit: 200
            filter: { ${rangeFilterClause(since)}, action_neq: "allow" }
            orderBy: [count_DESC]
          ) {
            dimensions { clientCountryName }
            count
            avg { sampleInterval }
          }
        }
      }
    }
  `;

  const [reqData, threatData] = await Promise.all([
    gql<{
      httpRequestsAdaptiveGroups: Array<{
        dimensions: { clientCountryName: string };
        count: number;
        sum: { edgeResponseBytes: number };
      }>;
    }>(token, reqQuery, { zoneTag: zoneId, since, until }),
    gql<{
      firewallEventsAdaptiveGroups: Array<{
        dimensions: { clientCountryName: string };
        count: number;
      }>;
    }>(token, threatQuery, { zoneTag: zoneId, since, until }),
  ]);

  const totals = new Map<string, CountryRow>();
  for (const r of reqData.httpRequestsAdaptiveGroups ?? []) {
    const name = r.dimensions.clientCountryName || "Unknown";
    totals.set(name, {
      clientCountryName: name,
      requests: r.count,
      bytes: r.sum?.edgeResponseBytes ?? 0,
      threats: 0,
    });
  }
  for (const t of threatData.firewallEventsAdaptiveGroups ?? []) {
    const name = t.dimensions.clientCountryName || "Unknown";
    const row = totals.get(name);
    if (row) row.threats += t.count;
    else totals.set(name, { clientCountryName: name, requests: 0, bytes: 0, threats: t.count });
  }

  return Array.from(totals.values())
    .sort((a, b) => b.requests - a.requests)
    .slice(0, limit);
}

// ─── 14. Browser Breakdown (pie chart) ────────────────────────────────────────
/**
 * httpRequests1dGroups with browserMap: requests per browser family.
 */
export interface BrowserRow {
  uaBrowserFamily: string;   // e.g. "Chrome", "Firefox", "Safari", "Edge"
  requests: number;
}

export async function fetchBrowserBreakdown(
  token: string,
  zoneId: string,
  since: string,
  until: string,
  limit = 10
): Promise<BrowserRow[]> {
  // userAgentBrowser is the httpRequestsAdaptiveGroups browser dimension
  // (same field fetchSourceBrowsers uses in production). The old 1dGroups
  // browserMap only exposed pageViews; this counts actual requests over the
  // exact window, which matches the section's "requests" label.
  const query = `
    query BrowserBreakdown($zoneTag: string!, $since: string!, $until: string!) {
      viewer {
        zones(filter: { zoneTag: $zoneTag }) {
          httpRequestsAdaptiveGroups(
            limit: $limit
            filter: { ${rangeFilterClause(since)} }
            orderBy: [count_DESC]
          ) {
            dimensions { userAgentBrowser }
            count
            avg { sampleInterval }
          }
        }
      }
    }
  `;

  const data = await gql<{
    httpRequestsAdaptiveGroups: Array<{
      dimensions: { userAgentBrowser: string };
      count: number;
    }>;
  }>(token, query, { zoneTag: zoneId, since, until, limit });

  return (data.httpRequestsAdaptiveGroups ?? [])
    .map((r) => ({ uaBrowserFamily: r.dimensions.userAgentBrowser || "Unknown", requests: r.count }))
    .sort((a, b) => b.requests - a.requests)
    .slice(0, limit);
}

// ─── 15. Device Type Breakdown (pie chart) ────────────────────────────────────
/**
 * httpRequestsAdaptiveGroups grouped by clientDeviceType.
 */
export interface DeviceRow {
  clientDeviceType: string;   // "desktop", "mobile", "tablet"
  requests: number;
}

export async function fetchDeviceBreakdown(
  token: string,
  zoneId: string,
  since: string,
  until: string
): Promise<DeviceRow[]> {
  // Use httpRequests1dGroups with deviceTypeMap for accurate counts (not sampled).
  // deviceTypeMap returns { deviceType, requests } per day aggregated across the period.
  const query = `
    query DeviceBreakdown($zoneTag: string!, $since: string!, $until: string!) {
      viewer {
        zones(filter: { zoneTag: $zoneTag }) {
          httpRequests1dGroups(
            limit: 31
            filter: { date_geq: $since, date_lt: $until }
          ) {
            sum {
              clientHTTPVersionMap {
                clientHTTPProtocol
                requests
              }
            }
          }
        }
      }
    }
  `;

  // Note: httpRequests1dGroups does NOT have a deviceTypeMap.
  // Device types are only available via httpRequestsAdaptiveGroups (sampled).
  // Use adaptive groups with requestSource: "eyeball" to match dashboard.
  const adaptiveQuery = `
    query DeviceBreakdown($zoneTag: string!, $since: string!, $until: string!) {
      viewer {
        zones(filter: { zoneTag: $zoneTag }) {
          httpRequestsAdaptiveGroups(
            limit: 5
            filter: { ${rangeFilterClause(since)}, requestSource: "eyeball" }
            orderBy: [count_DESC]
          ) {
            dimensions { clientDeviceType }
            avg { sampleInterval }
            count
          }
        }
      }
    }
  `;

  const data = await gql<{
    httpRequestsAdaptiveGroups: Array<{
      dimensions: { clientDeviceType: string };
      avg: { sampleInterval: number };
      count: number;
    }>;
  }>(token, adaptiveQuery, { zoneTag: zoneId, since, until });

  return (data.httpRequestsAdaptiveGroups ?? []).map((r) => ({
    clientDeviceType: r.dimensions.clientDeviceType || "unknown",
    requests: r.count,
  }));
}

// ─── 16. HTTP Method Breakdown (bar chart) ────────────────────────────────────
/**
 * httpRequestsAdaptiveGroups grouped by clientRequestHTTPMethodName.
 */
export interface HttpMethodRow {
  method: string;   // GET, POST, PUT, DELETE, HEAD, OPTIONS, …
  requests: number;
}

export async function fetchHttpMethodBreakdown(
  token: string,
  zoneId: string,
  since: string,
  until: string,
  limit = 10
): Promise<HttpMethodRow[]> {
  const query = `
    query HttpMethodBreakdown($zoneTag: string!, $since: string!, $until: string!, $limit: int!) {
      viewer {
        zones(filter: { zoneTag: $zoneTag }) {
          httpRequestsAdaptiveGroups(
            limit: $limit
            filter: { ${rangeFilterClause(since)}, requestSource: "eyeball" }
            orderBy: [count_DESC]
          ) {
            dimensions { clientRequestHTTPMethodName }
            avg { sampleInterval }
            count
          }
        }
      }
    }
  `;

  const data = await gql<{
    httpRequestsAdaptiveGroups: Array<{
      dimensions: { clientRequestHTTPMethodName: string };
      avg: { sampleInterval: number };
      count: number;
    }>;
  }>(token, query, { zoneTag: zoneId, since, until, limit });

  return (data.httpRequestsAdaptiveGroups ?? [])
    .map((r) => ({
      method: r.dimensions.clientRequestHTTPMethodName || "unknown",
      requests: r.count,
    }))
    .sort((a, b) => b.requests - a.requests);
}

// ─── 17. HTTP Status Code Distribution (bar chart) ────────────────────────────
/**
 * Aggregate total requests per HTTP status code class (2xx/3xx/4xx/5xx)
 * across the full period. Derived from httpRequests1dGroups.responseStatusMap.
 */
export interface HttpStatusSummary {
  e2xx: number;
  e3xx: number;
  e4xx: number;
  e5xx: number;
  e1xx: number;
  total: number;
}

export async function fetchHttpStatusSummary(
  token: string,
  zoneId: string,
  since: string,
  until: string
): Promise<HttpStatusSummary> {
  // edgeResponseStatus is a first-class dimension on httpRequestsAdaptiveGroups
  // (fetchApiStatusBreakdown uses it in production) — grouped here for the
  // 1xx–5xx totals over the exact window.
  const query = `
    query HttpStatusSummary($zoneTag: string!, $since: string!, $until: string!) {
      viewer {
        zones(filter: { zoneTag: $zoneTag }) {
          httpRequestsAdaptiveGroups(
            limit: 25
            filter: { ${rangeFilterClause(since)} }
            orderBy: [count_DESC]
          ) {
            dimensions { edgeResponseStatus }
            count
            avg { sampleInterval }
          }
        }
      }
    }
  `;

  const data = await gql<{
    httpRequestsAdaptiveGroups: Array<{
      dimensions: { edgeResponseStatus: number };
      count: number;
    }>;
  }>(token, query, { zoneTag: zoneId, since, until });

  const totals: Record<string, number> = { "1": 0, "2": 0, "3": 0, "4": 0, "5": 0 };
  for (const s of data.httpRequestsAdaptiveGroups ?? []) {
    const prefix = String(Math.floor((s.dimensions.edgeResponseStatus ?? 0) / 100));
    totals[prefix] = (totals[prefix] ?? 0) + s.count;
  }

  const e1xx = totals["1"] ?? 0;
  const e2xx = totals["2"] ?? 0;
  const e3xx = totals["3"] ?? 0;
  const e4xx = totals["4"] ?? 0;
  const e5xx = totals["5"] ?? 0;

  return { e1xx, e2xx, e3xx, e4xx, e5xx, total: e1xx + e2xx + e3xx + e4xx + e5xx };
}

// ═══════════════════════════════════════════════════════════════════════════════
// PHASE 2 — Performance Metrics
// ═══════════════════════════════════════════════════════════════════════════════

// ─── 18. TTFB Average Time Series ────────────────────────────────────────────
/**
 * Cloudflare zone-level analytics does not expose per-zone TTFB percentiles.
 * The closest available data is httpRequestsAdaptiveGroups:
 *   sum.edgeTimeToFirstByteMs / count  →  avg TTFB per day.
 *
 * We return avg in all three "percentile" slots so the frontend chart still works;
 * the UI label is updated to show "Avg TTFB" instead of p50/p75/p99.
 */
export interface TtfbDaySeries {
  date: string;
  avg: number;    // ms — average edge TTFB for the day
  p50: number;    // ms — same as avg (true percentiles not available at zone level)
  p75: number;    // ms — same as avg
  p99: number;    // ms — same as avg
}

export async function fetchTtfbTimeSeries(
  token: string,
  zoneId: string,
  since: string,
  until: string
): Promise<TtfbDaySeries[]> {
  const query = `
    query TtfbSeries($zoneTag: string!, $since: string!, $until: string!) {
      viewer {
        zones(filter: { zoneTag: $zoneTag }) {
          httpRequestsAdaptiveGroups(
            limit: 31
            filter: { ${rangeFilterClause(since)}, requestSource: "eyeball" }
            orderBy: [date_ASC]
          ) {
            dimensions { date }
            sum { edgeTimeToFirstByteMs }
            avg { sampleInterval }
            count
          }
        }
      }
    }
  `;

  const data = await gql<{
    httpRequestsAdaptiveGroups: Array<{
      dimensions: { date: string };
      sum: { edgeTimeToFirstByteMs: number };
      avg: { sampleInterval: number };
      count: number;
    }>;
  }>(token, query, { zoneTag: zoneId, since, until });

  return (data.httpRequestsAdaptiveGroups ?? []).map((d) => {
    const avg = d.count > 0 ? Math.round(d.sum.edgeTimeToFirstByteMs / d.count) : 0;
    return {
      date: d.dimensions.date,
      avg,
      p50: avg,   // alias — zone-level data only has avg, not true percentiles
      p75: avg,
      p99: avg,
    };
  });
}

// ─── 19. Data Center / Edge Location Distribution (bar chart) ─────────────────
/**
 * httpRequestsAdaptiveGroups grouped by coloCode: requests + bytes per PoP.
 * Returns top N Cloudflare data centers sorted by bandwidth (bytes) desc,
 * since visits is sampled and often under-counts — bytes is more reliable.
 */
export interface EdgeColoRow {
  coloCode: string;   // 3-letter IATA code, e.g. "SJC", "FRA", "SIN"
  requests: number;
  bytes: number;
}

export async function fetchEdgeColoDistribution(
  token: string,
  zoneId: string,
  since: string,
  until: string,
  limit = 15
): Promise<EdgeColoRow[]> {
  const query = `
    query EdgeColoDistribution($zoneTag: string!, $since: string!, $until: string!, $limit: int!) {
      viewer {
        zones(filter: { zoneTag: $zoneTag }) {
          httpRequestsAdaptiveGroups(
            limit: $limit
            filter: { ${rangeFilterClause(since)}, requestSource: "eyeball" }
            orderBy: [sum_edgeResponseBytes_DESC]
          ) {
            dimensions { coloCode }
            sum { edgeResponseBytes }
            avg { sampleInterval }
            count
          }
        }
      }
    }
  `;

  const data = await gql<{
    httpRequestsAdaptiveGroups: Array<{
      dimensions: { coloCode: string };
      sum: { edgeResponseBytes: number };
      avg: { sampleInterval: number };
      count: number;
    }>;
  }>(token, query, { zoneTag: zoneId, since, until, limit });

  return (data.httpRequestsAdaptiveGroups ?? []).map((r) => ({
    coloCode: r.dimensions.coloCode || "unknown",
    requests: r.count,   // count = sampled request count
    bytes: r.sum.edgeResponseBytes,
  }));
}

// ═══════════════════════════════════════════════════════════════════════════════
// PHASE 3 — Security Intelligence
// ═══════════════════════════════════════════════════════════════════════════════

// ─── 20. Top Threat IPs (table) ───────────────────────────────────────────────
/**
 * firewallEventsAdaptiveGroups: top attacking IPs (action != allow).
 */
export interface ThreatIpRow {
  ip: string;
  country: string;
  action: string;
  count: number;
}

export async function fetchTopThreatIps(
  token: string,
  zoneId: string,
  since: string,
  until: string,
  limit = 20
): Promise<ThreatIpRow[]> {
  const query = `
    query TopThreatIps($zoneTag: string!, $since: Date!, $until: Date!, $limit: int!) {
      viewer {
        zones(filter: { zoneTag: $zoneTag }) {
          firewallEventsAdaptiveGroups(
            limit: $limit
            filter: { ${rangeFilterClause(since)}, action_neq: "allow" }
            orderBy: [count_DESC]
          ) {
            dimensions { clientIP clientCountryName action }
            count
          }
        }
      }
    }
  `;

  const data = await gql<{
    firewallEventsAdaptiveGroups: Array<{
      dimensions: { clientIP: string; clientCountryName: string; action: string };
      count: number;
    }>;
  }>(token, query, { zoneTag: zoneId, since, until, limit });

  return (data.firewallEventsAdaptiveGroups ?? []).map((r) => ({
    ip: r.dimensions.clientIP || "unknown",
    country: r.dimensions.clientCountryName || "Unknown",
    action: r.dimensions.action,
    count: r.count,
  }));
}

// ─── 21. Top Threat ASNs (bar chart) ──────────────────────────────────────────
/**
 * firewallEventsAdaptiveGroups: top attacking ASNs.
 */
export interface ThreatAsnRow {
  asn: number;
  asnName: string;
  count: number;
}

export async function fetchTopThreatAsns(
  token: string,
  zoneId: string,
  since: string,
  until: string,
  limit = 10
): Promise<ThreatAsnRow[]> {
  const query = `
    query TopThreatAsns($zoneTag: string!, $since: Date!, $until: Date!, $limit: int!) {
      viewer {
        zones(filter: { zoneTag: $zoneTag }) {
          firewallEventsAdaptiveGroups(
            limit: $limit
            filter: { ${rangeFilterClause(since)}, action_neq: "allow" }
            orderBy: [count_DESC]
          ) {
            dimensions { clientAsn clientASNDescription }
            count
          }
        }
      }
    }
  `;

  const data = await gql<{
    firewallEventsAdaptiveGroups: Array<{
      dimensions: { clientAsn: number; clientASNDescription: string };
      count: number;
    }>;
  }>(token, query, { zoneTag: zoneId, since, until, limit });

  return (data.firewallEventsAdaptiveGroups ?? []).map((r) => ({
    asn: r.dimensions.clientAsn,
    asnName: r.dimensions.clientASNDescription || `AS${r.dimensions.clientAsn}`,
    count: r.count,
  }));
}

// ─── 22. User Agent Analysis (breakdown table) ────────────────────────────────
/**
 * firewallEventsAdaptiveGroups: top user agents by blocked request count.
 * Useful for identifying scrapers, CVE-scanning tools, etc.
 */
export interface UserAgentRow {
  userAgent: string;
  count: number;
  category: "browser" | "bot" | "scanner" | "unknown";
}

const BOT_PATTERNS = [/bot/i, /crawler/i, /spider/i, /slurp/i, /facebookexternalhit/i, /googlebot/i];
const SCANNER_PATTERNS = [/sqlmap/i, /nmap/i, /nikto/i, /masscan/i, /zgrab/i, /nuclei/i, /curl/i, /python-requests/i, /go-http-client/i];

function categorizeUserAgent(ua: string): UserAgentRow["category"] {
  if (SCANNER_PATTERNS.some((p) => p.test(ua))) return "scanner";
  if (BOT_PATTERNS.some((p) => p.test(ua))) return "bot";
  if (/Mozilla|Chrome|Safari|Firefox|Edge/i.test(ua)) return "browser";
  return "unknown";
}

export async function fetchTopUserAgents(
  token: string,
  zoneId: string,
  since: string,
  until: string,
  limit = 15
): Promise<UserAgentRow[]> {
  const query = `
    query TopUserAgents($zoneTag: string!, $since: Date!, $until: Date!, $limit: int!) {
      viewer {
        zones(filter: { zoneTag: $zoneTag }) {
          firewallEventsAdaptiveGroups(
            limit: $limit
            filter: { ${rangeFilterClause(since)}, action_neq: "allow" }
            orderBy: [count_DESC]
          ) {
            dimensions { userAgent }
            count
          }
        }
      }
    }
  `;

  const data = await gql<{
    firewallEventsAdaptiveGroups: Array<{
      dimensions: { userAgent: string };
      count: number;
    }>;
  }>(token, query, { zoneTag: zoneId, since, until, limit });

  return (data.firewallEventsAdaptiveGroups ?? []).map((r) => {
    const ua = r.dimensions.userAgent || "unknown";
    return {
      userAgent: ua,
      count: r.count,
      category: categorizeUserAgent(ua),
    };
  });
}

// ═══════════════════════════════════════════════════════════════════════════════
// PHASE 4 — Content Analysis
// ═══════════════════════════════════════════════════════════════════════════════

// ─── 23. Content Type Breakdown (cache performance per MIME type) ─────────────
/**
 * httpRequests1dGroups with contentTypeMap: requests + cached bytes per MIME type.
 */
export interface ContentTypeRow {
  edgeResponseContentTypeName: string;  // "html", "jpeg", "css", "javascript", "json", …
  requests: number;
  bytes: number;
  cachedBytes: number;
  cacheHitPct: number;
}

// Content-type dimension on httpRequestsAdaptiveGroups: the schema isn't
// documented field-by-field and this pipeline has no production example to
// confirm the name, so probe the two likely candidates once per isolate and
// memoize: a string = the validated dimension, null = none validated (fall
// back to the whole-day 1dGroups contentTypeMap permanently).
let adaptiveContentTypeDim: string | null | undefined;

export async function fetchContentTypeBreakdown(
  token: string,
  zoneId: string,
  since: string,
  until: string,
  limit = 15
): Promise<ContentTypeRow[]> {
  const candidates =
    adaptiveContentTypeDim !== undefined
      ? [adaptiveContentTypeDim]
      : ["clientResponseContentType", "edgeResponseContentTypeName"];

  const isSchemaError = (e: unknown) =>
    /cannot query field|unknown field|not support|not defined/i.test(String((e as Error)?.message ?? e));

  type AdaptiveCtRow = {
    dimensions: Record<string, string>;
    count: number;
    sum: { edgeResponseBytes: number };
  };
  let adaptiveData: AdaptiveCtRow[] | null = null;

  for (const dim of candidates) {
    if (!dim) break;
    const query = `
      query ContentTypeBreakdown($zoneTag: string!, $since: string!, $until: string!, $limit: int!) {
        viewer {
          zones(filter: { zoneTag: $zoneTag }) {
            httpRequestsAdaptiveGroups(
              limit: $limit
              filter: { ${rangeFilterClause(since)} }
              orderBy: [count_DESC]
            ) {
              dimensions { ${dim} }
              count
              sum { edgeResponseBytes }
              avg { sampleInterval }
            }
          }
        }
      }
    `;
    try {
      const data = await gql<{ httpRequestsAdaptiveGroups: AdaptiveCtRow[] }>(
        token,
        query,
        { zoneTag: zoneId, since, until, limit }
      );
      adaptiveData = data.httpRequestsAdaptiveGroups ?? [];
      if (adaptiveContentTypeDim === undefined) {
        adaptiveContentTypeDim = dim;
        console.log(`fetchContentTypeBreakdown: using adaptive dimension "${dim}"`);
      }
      break;
    } catch (e) {
      if (!isSchemaError(e)) throw e;
      console.warn(
        `httpRequestsAdaptiveGroups rejected content-type dimension "${dim}" (${String((e as Error)?.message).slice(0, 120)})`
      );
    }
  }

  if (adaptiveContentTypeDim === undefined) {
    // Both candidates rejected — memoize the negative so future reports go
    // straight to the 1dGroups fallback below.
    adaptiveContentTypeDim = null;
  }

  if (adaptiveData && adaptiveContentTypeDim) {
    return adaptiveData
      .map((r) => ({
        edgeResponseContentTypeName: r.dimensions[adaptiveContentTypeDim as string] || "unknown",
        requests: r.count,
        bytes: r.sum?.edgeResponseBytes ?? 0,
        cachedBytes: 0,
        cacheHitPct: 0,
      }))
      .sort((a, b) => b.requests - a.requests)
      .slice(0, limit);
  }

  // Whole-day fallback (whole UTC days — 1dGroups can't resolve finer).
  // Timestamps in → day bounds out, same conversion the DNS guard uses.
  const sinceDay = since.includes("T") ? since.slice(0, 10) : since;
  const untilDay = until.includes("T")
    ? new Date(Date.parse(until) + 24 * 60 * 60 * 1000).toISOString().slice(0, 10)
    : until;
  const query = `
    query ContentTypeBreakdown($zoneTag: string!, $since: string!, $until: string!) {
      viewer {
        zones(filter: { zoneTag: $zoneTag }) {
          httpRequests1dGroups(
            limit: 31
            filter: { date_geq: $since, date_lt: $until }
          ) {
            sum {
              contentTypeMap {
                edgeResponseContentTypeName
                requests
                bytes
              }
            }
          }
        }
      }
    }
  `;

  const data = await gql<{
    httpRequests1dGroups: Array<{
      sum: {
        contentTypeMap: Array<{
          edgeResponseContentTypeName: string;
          requests: number;
          bytes: number;
        }>;
      };
    }>;
  }>(token, query, { zoneTag: zoneId, since: sinceDay, until: untilDay });

  // Aggregate across all daily buckets
  const totals = new Map<string, { requests: number; bytes: number }>();
  for (const day of data.httpRequests1dGroups ?? []) {
    for (const ct of day.sum?.contentTypeMap ?? []) {
      const name = ct.edgeResponseContentTypeName || "unknown";
      const existing = totals.get(name);
      if (existing) {
        existing.requests += ct.requests;
        existing.bytes += ct.bytes;
      } else {
        totals.set(name, { requests: ct.requests, bytes: ct.bytes });
      }
    }
  }

  return Array.from(totals.entries())
    .map(([edgeResponseContentTypeName, { requests, bytes }]) => ({
      edgeResponseContentTypeName,
      requests,
      bytes,
      // contentTypeMap doesn't provide cached bytes directly; use 0 as placeholder
      cachedBytes: 0,
      cacheHitPct: 0,
    }))
    .sort((a, b) => b.requests - a.requests)
    .slice(0, limit);
}

// ═══════════════════════════════════════════════════════════════════════════════
// PHASE 5 — Traffic Sources
// ═══════════════════════════════════════════════════════════════════════════════

// ─── 24. Top Referrers (traffic source analysis) ──────────────────────────────
/**
 * httpRequestsAdaptiveGroups grouped by clientRefererHost.
 * Categorizes traffic as direct, search, social, or referral.
 */
export interface ReferrerRow {
  refererHost: string;
  requests: number;
  category: "direct" | "search" | "social" | "referral";
}

export interface ReferrerCategoryTotals {
  direct: number;
  search: number;
  social: number;
  referral: number;
}

export interface TopReferrersResult {
  /** Compact top-N individual hosts, for table display only. */
  topHosts: ReferrerRow[];
  /** Accurate category totals computed across a much larger sample — see
   *  the note on AGGREGATE_LIMIT below for why this must NOT be derived
   *  from `topHosts` alone. */
  categoryTotals: ReferrerCategoryTotals;
}

const SEARCH_ENGINES = ["google", "bing", "yahoo", "duckduckgo", "baidu", "yandex", "ecosia"];
const SOCIAL_NETWORKS = ["facebook", "twitter", "instagram", "linkedin", "tiktok", "reddit", "youtube", "pinterest", "snapchat"];

function categorizeReferrer(host: string): ReferrerRow["category"] {
  if (!host || host === "" || host === "-") return "direct";
  const lower = host.toLowerCase();
  if (SEARCH_ENGINES.some((s) => lower.includes(s))) return "search";
  if (SOCIAL_NETWORKS.some((s) => lower.includes(s))) return "social";
  return "referral";
}

/**
 * How many DISTINCT hostnames to pull before summing into category totals.
 * IMPORTANT: category totals must be computed over a large sample, not over
 * the small top-N list used for the "top referrers" table. A zone can easily
 * have hundreds of small/long-tail referral hosts that individually rank
 * below google.com/facebook.com in raw per-host count but collectively fill
 * every slot of a small top-N cutoff — silently excluding search/social
 * traffic from the category totals entirely (confirmed real-world symptom:
 * "Search Engines: 0%" / "Social Media: 0%" on a zone with billions of
 * requests, while "Referral Sites" absorbed everything). 3000 is comfortably
 * within Cloudflare's per-query row cap (10,000) and captures effectively
 * all distinct referrer hosts for the vast majority of zones.
 */
const REFERRER_AGGREGATE_LIMIT = 3000;

export async function fetchTopReferrers(
  token: string,
  zoneId: string,
  since: string,
  until: string,
  topN = 20
): Promise<TopReferrersResult> {
  const query = `
    query TopReferrers($zoneTag: string!, $since: string!, $until: string!, $limit: int!) {
      viewer {
        zones(filter: { zoneTag: $zoneTag }) {
          httpRequestsAdaptiveGroups(
            limit: $limit
            filter: { ${rangeFilterClause(since)}, requestSource: "eyeball" }
            orderBy: [count_DESC]
          ) {
            dimensions { clientRefererHost }
            avg { sampleInterval }
            count
          }
        }
      }
    }
  `;

  const data = await gql<{
    httpRequestsAdaptiveGroups: Array<{
      dimensions: { clientRefererHost: string };
      avg: { sampleInterval: number };
      count: number;
    }>;
  }>(token, query, { zoneTag: zoneId, since, until, limit: REFERRER_AGGREGATE_LIMIT });

  const rows: ReferrerRow[] = (data.httpRequestsAdaptiveGroups ?? []).map((r) => {
    const host = r.dimensions.clientRefererHost || "";
    return {
      refererHost: host || "(direct)",
      requests: r.count,
      category: categorizeReferrer(host),
    };
  });

  const categoryTotals: ReferrerCategoryTotals = { direct: 0, search: 0, social: 0, referral: 0 };
  for (const r of rows) categoryTotals[r.category] += r.requests;

  // Rows already arrive sorted by count_DESC from GraphQL — top N is just a slice.
  return { topHosts: rows.slice(0, topN), categoryTotals };
}

// =============================================================================
// DNS Analytics (account-level) + DNS Records (REST)
// =============================================================================

// -- 25. DNS Records Inventory (REST API) ------------------------------------

export interface DnsRecordSummary {
  totalRecords: number;
  proxiedCount: number;
  dnsOnlyCount: number;
  byType: { type: string; count: number }[];
}

export async function fetchDnsRecordSummary(
  token: string,
  zoneId: string
): Promise<DnsRecordSummary> {
  const res = await fetch(
    `https://api.cloudflare.com/client/v4/zones/${zoneId}/dns_records?per_page=500`,
    { headers: { Authorization: `Bearer ${token}` } }
  );
  if (!res.ok) throw new Error(`DNS records HTTP ${res.status}`);

  const j = (await res.json()) as {
    result: Array<{ type: string; proxied?: boolean }>;
    result_info?: { total_count: number };
  };

  const records = j.result ?? [];
  const totalRecords = j.result_info?.total_count ?? records.length;
  const proxiedCount = records.filter((r) => r.proxied).length;
  const dnsOnlyCount = records.filter((r) => !r.proxied).length;

  // Count by type
  const typeMap = new Map<string, number>();
  for (const r of records) {
    typeMap.set(r.type, (typeMap.get(r.type) ?? 0) + 1);
  }
  const byType = Array.from(typeMap.entries())
    .map(([type, count]) => ({ type, count }))
    .sort((a, b) => b.count - a.count);

  return { totalRecords, proxiedCount, dnsOnlyCount, byType };
}

// -- 26. DNS Query Analytics (GraphQL, account-level) ------------------------

export interface DnsQueryTypeRow {
  queryType: string;
  responseCode: string;
  count: number;
  p50Us: number;
  p95Us: number;
  p99Us: number;
}

/**
 * dnsAnalyticsAdaptiveGroups follows the Analytics TimeFilter convention
 * (its schema has a `datetime` field, so datetime_geq/leq should be legal),
 * but it is the one adaptive dataset in this pipeline without a production
 * datetime-filter example to prove it. Guard the exact-window path: if the
 * datetime-filtered query is rejected with a schema/validation error, retry
 * once with UTC-day bounds derived from the exact window (date fields reject
 * full timestamps) and warn — visible in wrangler tail — instead of losing
 * the section. Any other error (auth, HTTP, rate limit) propagates as-is.
 */
async function gqlDnsExact<T>(
  run: (query: string, vars: Record<string, unknown>) => Promise<T>,
  buildQuery: (timeFilter: string) => string,
  vars: Record<string, unknown>,
  since: string
): Promise<T> {
  try {
    return await run(buildQuery(rangeFilterClause(since)), vars);
  } catch (e) {
    const msg = String((e as Error)?.message ?? e);
    if (since.includes("T") && /iso8601|cannot query|unknown|not support/i.test(msg)) {
      console.warn(
        `dnsAnalyticsAdaptiveGroups rejected datetime filters (${msg.slice(0, 160)}) — retrying with day bounds`
      );
      const dayVars = {
        ...vars,
        since: since.slice(0, 10),
        until: new Date(Date.parse(vars.until as string) + 24 * 60 * 60 * 1000).toISOString().slice(0, 10),
      };
      return await run(buildQuery("date_geq: $since, date_lt: $until"), dayVars);
    }
    throw e;
  }
}

export async function fetchDnsQueryTypeBreakdown(
  token: string,
  accountId: string,
  zoneId: string,
  since: string,
  until: string,
  limit = 15
): Promise<DnsQueryTypeRow[]> {
  const buildQuery = (timeFilter: string) => `
    query DnsQueryTypes($accountTag: string!, $since: string!, $until: string!, $zoneTag: string!, $limit: int!) {
      viewer {
        accounts(filter: { accountTag: $accountTag }) {
          dnsAnalyticsAdaptiveGroups(
            limit: $limit
            filter: { ${timeFilter}, zoneTag: $zoneTag }
            orderBy: [count_DESC]
          ) {
            dimensions { queryType responseCode }
            quantiles { processingTimeUsP50 processingTimeUsP95 processingTimeUsP99 }
            count
          }
        }
      }
    }
  `;

  const data = await gqlDnsExact<{
    dnsAnalyticsAdaptiveGroups: Array<{
      dimensions: { queryType: string; responseCode: string };
      quantiles: { processingTimeUsP50: number; processingTimeUsP95: number; processingTimeUsP99: number };
      count: number;
    }>;
  }>((query: string, vars: Record<string, unknown>) => gqlAccount(token, query, vars), buildQuery, { accountTag: accountId, since, until, zoneTag: zoneId, limit }, since);

  return (data.dnsAnalyticsAdaptiveGroups ?? []).map((r) => ({
    queryType: r.dimensions.queryType,
    responseCode: r.dimensions.responseCode,
    count: r.count,
    p50Us: r.quantiles?.processingTimeUsP50 ?? 0,
    p95Us: r.quantiles?.processingTimeUsP95 ?? 0,
    p99Us: r.quantiles?.processingTimeUsP99 ?? 0,
  }));
}

// -- 27. DNS Query Volume Time Series (daily) --------------------------------

export interface DnsQueryDaySeries {
  date: string;
  count: number;
  p50Us: number;
  p95Us: number;
}

export async function fetchDnsQueryTimeSeries(
  token: string,
  accountId: string,
  zoneId: string,
  since: string,
  until: string
): Promise<DnsQueryDaySeries[]> {
  const buildQuery = (timeFilter: string) => `
    query DnsQueryTimeSeries($accountTag: string!, $since: string!, $until: string!, $zoneTag: string!) {
      viewer {
        accounts(filter: { accountTag: $accountTag }) {
          dnsAnalyticsAdaptiveGroups(
            limit: 31
            filter: { ${timeFilter}, zoneTag: $zoneTag }
            orderBy: [date_ASC]
          ) {
            dimensions { date }
            quantiles { processingTimeUsP50 processingTimeUsP95 }
            count
          }
        }
      }
    }
  `;

  const data = await gqlDnsExact<{
    dnsAnalyticsAdaptiveGroups: Array<{
      dimensions: { date: string };
      quantiles: { processingTimeUsP50: number; processingTimeUsP95: number };
      count: number;
    }>;
  }>((query: string, vars: Record<string, unknown>) => gqlAccount(token, query, vars), buildQuery, { accountTag: accountId, since, until, zoneTag: zoneId }, since);

  return (data.dnsAnalyticsAdaptiveGroups ?? []).map((r) => ({
    date: r.dimensions.date,
    count: r.count,
    p50Us: r.quantiles?.processingTimeUsP50 ?? 0,
    p95Us: r.quantiles?.processingTimeUsP95 ?? 0,
  }));
}

// -- 27b. Top Hostnames by HTTP Request Count --------------------------------
/**
 * httpRequestsAdaptiveGroups grouped by clientRequestHTTPHost.
 * Returns top N hostnames by actual HTTP request count — more reliable than
 * DNS query counts since every zone has HTTP analytics regardless of plan.
 */
export interface TopHttpHostnameRow {
  hostname: string;
  requests: number;
  bytes: number;
}

export async function fetchTopHttpHostnames(
  token: string,
  zoneId: string,
  since: string,
  until: string,
  limit = 20
): Promise<TopHttpHostnameRow[]> {
  // httpRequestsAdaptiveGroups is sampled — use avg.sampleInterval to de-sample counts.
  // count × avg.sampleInterval ≈ actual requests (closer to dashboard exact counts).
  const query = `
    query TopHttpHostnames($zoneTag: string!, $since: string!, $until: string!, $limit: int!) {
      viewer {
        zones(filter: { zoneTag: $zoneTag }) {
          httpRequestsAdaptiveGroups(
            limit: $limit
            filter: { ${rangeFilterClause(since)}, requestSource: "eyeball" }
            orderBy: [count_DESC]
          ) {
            dimensions { clientRequestHTTPHost }
            sum { edgeResponseBytes visits }
            avg { sampleInterval }
            count
          }
        }
      }
    }
  `;

  const data = await gql<{
    httpRequestsAdaptiveGroups: Array<{
      dimensions: { clientRequestHTTPHost: string };
      sum: { edgeResponseBytes: number; visits: number };
      avg: { sampleInterval: number };
      count: number;
    }>;
  }>(token, query, { zoneTag: zoneId, since, until, limit });

  // NOTE: Do NOT multiply by sampleInterval — the dashboard shows raw sampled
  // counts per hostname, not de-sampled. De-sampling causes per-hostname counts
  // to sum to far more than totalRequests (each row has its own sampleInterval).
  // The dashboard "Hosts" widget uses the same raw count from adaptive groups.
  return (data.httpRequestsAdaptiveGroups ?? [])
    .filter((r) => r.dimensions.clientRequestHTTPHost)
    .map((r) => ({
      hostname: r.dimensions.clientRequestHTTPHost.toLowerCase(),
      requests: r.count,   // raw sampled count — consistent with dashboard display
      bytes: r.sum?.edgeResponseBytes ?? 0,
    }))
    .sort((a, b) => b.requests - a.requests);
}

// -- 28. Top DNS Hostnames by Query Volume -----------------------------------
/**
 * Uses dnsAnalyticsAdaptiveGroups with queryName dimension to find the
 * top N hostnames by actual DNS query count. This is used to select
 * which DNS records to display in the force graph.
 */
export interface DnsTopHostnameRow {
  hostname: string;  // e.g. "www.example.com" or "example.com"
  queryType: string; // A, AAAA, MX, CNAME…
  count: number;
}

export async function fetchTopDnsHostnames(
  token: string,
  accountId: string,
  zoneId: string,
  since: string,
  until: string,
  limit = 30  // fetch 30 and let caller pick top 10 after dedup
): Promise<DnsTopHostnameRow[]> {
  const buildQuery = (timeFilter: string) => `
    query TopDnsHostnames($accountTag: string!, $since: string!, $until: string!, $zoneTag: string!, $limit: int!) {
      viewer {
        accounts(filter: { accountTag: $accountTag }) {
          dnsAnalyticsAdaptiveGroups(
            limit: $limit
            filter: { ${timeFilter}, zoneTag: $zoneTag }
            orderBy: [count_DESC]
          ) {
            dimensions { queryName queryType }
            count
          }
        }
      }
    }
  `;

  try {
    const data = await gqlDnsExact<{
      dnsAnalyticsAdaptiveGroups: Array<{
        dimensions: { queryName: string; queryType: string };
        count: number;
      }>;
    }>((query: string, vars: Record<string, unknown>) => gqlAccount(token, query, vars), buildQuery, { accountTag: accountId, since, until, zoneTag: zoneId, limit }, since);

    return (data.dnsAnalyticsAdaptiveGroups ?? []).map((r) => ({
      hostname: (r.dimensions.queryName ?? "").replace(/\.$/, "").toLowerCase(),
      queryType: r.dimensions.queryType,
      count: r.count,
    })).filter((r) => r.hostname.length > 0);
  } catch {
    // If queryName dimension not available, return empty (will fall back to record order)
    return [];
  }
}

// =============================================================================
// Enterprise POC — Additional Intelligence Queries
// =============================================================================

// -- 28. WAF Attack Score on ALL traffic (not just triggered events) ----------
/**
 * httpRequestsAdaptiveGroups grouped by wafAttackScoreClass.
 * Shows the ML attack score distribution across ALL incoming requests —
 * the "iceberg below the waterline" including traffic Cloudflare flagged
 * but didn't necessarily block via explicit rules.
 */
export interface WafScoreAllTrafficRow {
  scoreClass: string;   // "attack" | "likely_attack" | "likely_clean" | "clean"
  count: number;
}

export async function fetchWafScoreAllTraffic(
  token: string,
  zoneId: string,
  since: string,
  until: string
): Promise<WafScoreAllTrafficRow[]> {
  const query = `
    query WafScoreAllTraffic($zoneTag: string!, $since: string!, $until: string!) {
      viewer {
        zones(filter: { zoneTag: $zoneTag }) {
          httpRequestsAdaptiveGroups(
            limit: 10
            filter: { ${rangeFilterClause(since)}, requestSource: "eyeball" }
            orderBy: [count_DESC]
          ) {
            dimensions { wafAttackScoreClass }
            avg { sampleInterval }
            count
          }
        }
      }
    }
  `;

  const data = await gql<{
    httpRequestsAdaptiveGroups: Array<{
      dimensions: { wafAttackScoreClass: string };
      avg: { sampleInterval: number };
      count: number;
    }>;
  }>(token, query, { zoneTag: zoneId, since, until });

  // Filter out null/empty scoreClass (unscored requests)
  return (data.httpRequestsAdaptiveGroups ?? [])
    .filter((r) => r.dimensions.wafAttackScoreClass)
    .map((r) => ({
      scoreClass: r.dimensions.wafAttackScoreClass,
      count: r.count,
    }));
}



// -- 30. Security Events by Service (product source breakdown) ---------------
/**
 * firewallEventsAdaptiveGroups grouped by source + action.
 * Shows which Cloudflare product (WAF, DDoS, Bot, Rate Limit, etc.)
 * is generating security events and what action was taken.
 */
export interface SecurityEventByServiceRow {
  source: string;
  action: string;
  count: number;
}

export async function fetchSecurityEventsByService(
  token: string,
  zoneId: string,
  since: string,
  until: string,
  limit = 30
): Promise<SecurityEventByServiceRow[]> {
  const query = `
    query SecurityEventsByService($zoneTag: string!, $since: Date!, $until: Date!, $limit: int!) {
      viewer {
        zones(filter: { zoneTag: $zoneTag }) {
          firewallEventsAdaptiveGroups(
            limit: $limit
            filter: { ${rangeFilterClause(since)} }
            orderBy: [count_DESC]
          ) {
            dimensions { source action }
            count
          }
        }
      }
    }
  `;

  const data = await gql<{
    firewallEventsAdaptiveGroups: Array<{
      dimensions: { source: string; action: string };
      count: number;
    }>;
  }>(token, query, { zoneTag: zoneId, since, until, limit });

  // Filter out non-zone security sources:
  //   "dlp"         — Cloudflare One / Zero Trust Data Loss Prevention, not zone WAF
  //   "sanitycheck" — Cloudflare internal health-check traffic, not real threat events
  //   "unknown"     — noise, no actionable meaning
  const EXCLUDED_SOURCES = new Set(["dlp", "sanitycheck", "unknown"]);

  return (data.firewallEventsAdaptiveGroups ?? [])
    .filter((r) => r.dimensions.source && !EXCLUDED_SOURCES.has(r.dimensions.source))
    .map((r) => ({
      source: r.dimensions.source,
      action: r.dimensions.action || "unknown",
      count: r.count,
    }));
}

// -- 31. Verified Bot Categories ---------------------------------------------
/**
 * httpRequestsAdaptiveGroups grouped by verifiedBotCategory.
 * Enterprise Bot Management feature — shows verified bot traffic by purpose:
 * "google", "monitoring", "advertising", "seo", etc.
 */
export interface VerifiedBotCategoryRow {
  category: string;
  count: number;
}

export async function fetchVerifiedBotCategories(
  token: string,
  zoneId: string,
  since: string,
  until: string,
  limit = 20
): Promise<VerifiedBotCategoryRow[]> {
  const query = `
    query VerifiedBotCategories($zoneTag: string!, $since: string!, $until: string!, $limit: int!) {
      viewer {
        zones(filter: { zoneTag: $zoneTag }) {
          httpRequestsAdaptiveGroups(
            limit: $limit
            filter: { ${rangeFilterClause(since)}, requestSource: "eyeball" }
            orderBy: [count_DESC]
          ) {
            dimensions { verifiedBotCategory }
            avg { sampleInterval }
            count
          }
        }
      }
    }
  `;

  const data = await gql<{
    httpRequestsAdaptiveGroups: Array<{
      dimensions: { verifiedBotCategory: string };
      avg: { sampleInterval: number };
      count: number;
    }>;
  }>(token, query, { zoneTag: zoneId, since, until, limit });

  return (data.httpRequestsAdaptiveGroups ?? [])
    .filter((r) => r.dimensions.verifiedBotCategory)
    .map((r) => ({
      category: r.dimensions.verifiedBotCategory,
      count: r.count,
    }));
}

// =============================================================================
// Dashboard Analytics Parity — Source Browsers, OS, HTTP Versions, JA3/JA4
// =============================================================================

// -- Source Browsers (by request count, not page views) ----------------------
// httpRequestsAdaptiveGroups grouped by clientRequestUserAgentBrowser
// This matches the dashboard "Source browsers" widget (Chrome, Firefox, Curl, Unknown)
export interface SourceBrowserRow {
  browser: string;  // "Chrome", "Firefox", "Curl", "Unknown", etc.
  requests: number;
}

export async function fetchSourceBrowsers(
  token: string, zoneId: string, since: string, until: string, limit = 10
): Promise<SourceBrowserRow[]> {
  const query = `
    query SourceBrowsers($zoneTag: string!, $since: string!, $until: string!, $limit: int!) {
      viewer {
        zones(filter: { zoneTag: $zoneTag }) {
          httpRequestsAdaptiveGroups(
            limit: $limit
            filter: { ${rangeFilterClause(since)}, requestSource: "eyeball" }
            orderBy: [count_DESC]
          ) {
            dimensions { userAgentBrowser }
            avg { sampleInterval }
            count
          }
        }
      }
    }
  `;
  try {
    const data = await gql<{
      httpRequestsAdaptiveGroups: Array<{
        dimensions: { userAgentBrowser: string };
        avg: { sampleInterval: number };
        count: number;
      }>;
    }>(token, query, { zoneTag: zoneId, since, until, limit });
    return (data.httpRequestsAdaptiveGroups ?? []).map((r) => ({
      browser: r.dimensions.userAgentBrowser || "Unknown",
      requests: r.count,
    }));
  } catch {
    return [];
  }
}

// -- Source Operating Systems -------------------------------------------------
export interface SourceOsRow {
  os: string;  // "Windows", "iOS", "MacOSX", "Android", "Unknown"
  requests: number;
}

export async function fetchSourceOs(
  token: string, zoneId: string, since: string, until: string, limit = 10
): Promise<SourceOsRow[]> {
  const query = `
    query SourceOs($zoneTag: string!, $since: string!, $until: string!, $limit: int!) {
      viewer {
        zones(filter: { zoneTag: $zoneTag }) {
          httpRequestsAdaptiveGroups(
            limit: $limit
            filter: { ${rangeFilterClause(since)}, requestSource: "eyeball" }
            orderBy: [count_DESC]
          ) {
            dimensions { userAgentOS }
            avg { sampleInterval }
            count
          }
        }
      }
    }
  `;
  try {
    const data = await gql<{
      httpRequestsAdaptiveGroups: Array<{
        dimensions: { userAgentOS: string };
        avg: { sampleInterval: number };
        count: number;
      }>;
    }>(token, query, { zoneTag: zoneId, since, until, limit });
    return (data.httpRequestsAdaptiveGroups ?? []).map((r) => ({
      os: r.dimensions.userAgentOS || "Unknown",
      requests: r.count,
    }));
  } catch {
    return [];
  }
}

// -- Source JA3 Fingerprints --------------------------------------------------
export interface Ja3Row {
  hash: string;
  requests: number;
}

export async function fetchJa3Fingerprints(
  token: string, zoneId: string, since: string, until: string, limit = 10
): Promise<Ja3Row[]> {
  const query = `
    query Ja3($zoneTag: string!, $since: string!, $until: string!, $limit: int!) {
      viewer {
        zones(filter: { zoneTag: $zoneTag }) {
          httpRequestsAdaptiveGroups(
            limit: $limit
            filter: { ${rangeFilterClause(since)}, requestSource: "eyeball" }
            orderBy: [count_DESC]
          ) {
            dimensions { ja3Hash }
            avg { sampleInterval }
            count
          }
        }
      }
    }
  `;
  try {
    const data = await gql<{
      httpRequestsAdaptiveGroups: Array<{
        dimensions: { ja3Hash: string };
        avg: { sampleInterval: number };
        count: number;
      }>;
    }>(token, query, { zoneTag: zoneId, since, until, limit });
    return (data.httpRequestsAdaptiveGroups ?? []).map((r) => ({
      hash: r.dimensions.ja3Hash || "(Empty JA3 Fingerprint)",
      requests: r.count,
    }));
  } catch {
    return [];
  }
}

// -- Source JA4 Fingerprints --------------------------------------------------
export interface Ja4Row {
  hash: string;
  requests: number;
}

export async function fetchJa4Fingerprints(
  token: string, zoneId: string, since: string, until: string, limit = 10
): Promise<Ja4Row[]> {
  const query = `
    query Ja4($zoneTag: string!, $since: string!, $until: string!, $limit: int!) {
      viewer {
        zones(filter: { zoneTag: $zoneTag }) {
          httpRequestsAdaptiveGroups(
            limit: $limit
            filter: { ${rangeFilterClause(since)}, requestSource: "eyeball" }
            orderBy: [count_DESC]
          ) {
            dimensions { ja4 }
            avg { sampleInterval }
            count
          }
        }
      }
    }
  `;
  try {
    const data = await gql<{
      httpRequestsAdaptiveGroups: Array<{
        dimensions: { ja4: string };
        avg: { sampleInterval: number };
        count: number;
      }>;
    }>(token, query, { zoneTag: zoneId, since, until, limit });
    return (data.httpRequestsAdaptiveGroups ?? []).map((r) => ({
      hash: r.dimensions.ja4 || "(Empty JA4 Fingerprint)",
      requests: r.count,
    }));
  } catch {
    return [];
  }
}

// =============================================================================
// Dashboard Parity — Visits, Pageviews, Top Client IPs, X-Requested-With
// Matches the CF dashboard ZapSparkline + GetZoneTopNs queries exactly.
// =============================================================================

/**
 * Visits: eyeball requests that are HTML responses (200 status + html content type)
 * excluding self-referrers. Matches the CF dashboard "Visits" KPI definition.
 * Formula: edgeResponseStatus=200 AND edgeResponseContentTypeName="html"
 *          AND clientRefererHost NOT LIKE %.zone.domain%
 *          AND requestSource="eyeball"
 */
export interface DashVisitsRow {
  date: string;
  visits: number;
}

export async function fetchDashboardVisits(
  token: string,
  zoneId: string,
  zoneName: string,  // used to exclude self-referrers
  since: string,
  until: string
): Promise<DashVisitsRow[]> {
  const query = `
    query DashVisits($zoneTag: string!, $since: string!, $until: string!, $zoneName: string!) {
      viewer {
        zones(filter: { zoneTag: $zoneTag }) {
          httpRequestsAdaptiveGroups(
            limit: 5000
            filter: {
              AND: [
                { datetime_geq: $since, datetime_leq: $until },
                { requestSource: "eyeball" },
                { edgeResponseStatus: 200, edgeResponseContentTypeName: "html" },
                { clientRefererHost_neq: $zoneName },
                { clientRefererHost_notlike: "%.${zoneName.replace(/\./g, ".")}%" }
              ]
            }
          ) {
            sum { visits }
            dimensions { ts: datetimeHour }
          }
        }
      }
    }
  `;

  try {
    const data = await gql<{
      httpRequestsAdaptiveGroups: Array<{
        sum: { visits: number };
        dimensions: { ts: string };
      }>;
    }>(token, query, { zoneTag: zoneId, since, until, zoneName });

    return (data.httpRequestsAdaptiveGroups ?? []).map((r) => ({
      date: r.dimensions.ts?.split("T")[0] ?? "",
      visits: r.sum.visits,
    }));
  } catch {
    return [];
  }
}

/**
 * Pageviews: eyeball HTML responses (200 + html content type).
 * Matches the CF dashboard "Pageviews" KPI definition.
 * Uses count of matching rows (each row = 1 pageview group after sampling).
 */
export interface DashPageviewsResult {
  totalPageviews: number;
  totalVisits: number;  // also computed for KPI consistency
}

export async function fetchDashboardPageviewsKpi(
  token: string,
  zoneId: string,
  zoneName: string,
  since: string,
  until: string
): Promise<DashPageviewsResult> {
  const query = `
    query DashPageviews($zoneTag: string!, $since: string!, $until: string!) {
      viewer {
        zones(filter: { zoneTag: $zoneTag }) {
          pageviews: httpRequestsAdaptiveGroups(
            limit: 1
            filter: {
              AND: [
                { datetime_geq: $since, datetime_leq: $until },
                { requestSource: "eyeball" },
                { edgeResponseStatus: 200, edgeResponseContentTypeName: "html" }
              ]
            }
          ) {
            count
            avg { sampleInterval }
          }
          visits: httpRequestsAdaptiveGroups(
            limit: 1
            filter: {
              AND: [
                { datetime_geq: $since, datetime_leq: $until },
                { requestSource: "eyeball" },
                { edgeResponseStatus: 200, edgeResponseContentTypeName: "html" }
              ]
            }
          ) {
            sum { visits }
          }
        }
      }
    }
  `;

  try {
    const data = await gql<{
      pageviews: Array<{ count: number; avg: { sampleInterval: number } }>;
      visits: Array<{ sum: { visits: number } }>;
    }>(token, query, { zoneTag: zoneId, since, until });

    const pvRow = data.pageviews?.[0];
    const visitsRow = data.visits?.[0];
    return {
      totalPageviews: pvRow ? pvRow.count * (pvRow.avg?.sampleInterval ?? 1) : 0,
      totalVisits: visitsRow?.sum?.visits ?? 0,
    };
  } catch {
    return { totalPageviews: 0, totalVisits: 0 };
  }
}

/**
 * Top Client IPs — matches dashboard's topClientIPs widget.
 * httpRequestsAdaptiveGroups grouped by clientIP.
 */
export interface TopClientIpRow {
  ip: string;
  requests: number;
  bytes: number;
}

export async function fetchTopClientIps(
  token: string,
  zoneId: string,
  since: string,
  until: string,
  limit = 25
): Promise<TopClientIpRow[]> {
  const query = `
    query TopClientIPs($zoneTag: string!, $since: string!, $until: string!, $limit: int!) {
      viewer {
        zones(filter: { zoneTag: $zoneTag }) {
          httpRequestsAdaptiveGroups(
            limit: $limit
            filter: { ${rangeFilterClause(since)}, requestSource: "eyeball" }
            orderBy: [count_DESC]
          ) {
            dimensions { clientIP }
            sum { edgeResponseBytes }
            avg { sampleInterval }
            count
          }
        }
      }
    }
  `;

  try {
    const data = await gql<{
      httpRequestsAdaptiveGroups: Array<{
        dimensions: { clientIP: string };
        sum: { edgeResponseBytes: number };
        avg: { sampleInterval: number };
        count: number;
      }>;
    }>(token, query, { zoneTag: zoneId, since, until, limit });

    return (data.httpRequestsAdaptiveGroups ?? [])
      .filter((r) => r.dimensions.clientIP)
      .map((r) => ({
        ip: r.dimensions.clientIP,
        requests: r.count,
        bytes: r.sum?.edgeResponseBytes ?? 0,
      }));
  } catch {
    return [];
  }
}

/**
 * X-Requested-With header breakdown — matches dashboard's topXRequestedWith.
 * Distinguishes AJAX requests from non-AJAX (browser, API clients, etc.)
 */
export interface XRequestedWithRow {
  header: string;  // e.g. "XMLHttpRequest", "(empty)", etc.
  requests: number;
}

export async function fetchTopXRequestedWith(
  token: string,
  zoneId: string,
  since: string,
  until: string,
  limit = 10
): Promise<XRequestedWithRow[]> {
  const query = `
    query TopXRequestedWith($zoneTag: string!, $since: string!, $until: string!, $limit: int!) {
      viewer {
        zones(filter: { zoneTag: $zoneTag }) {
          httpRequestsAdaptiveGroups(
            limit: $limit
            filter: { ${rangeFilterClause(since)}, requestSource: "eyeball" }
            orderBy: [count_DESC]
          ) {
            dimensions { xRequestedWith }
            avg { sampleInterval }
            count
          }
        }
      }
    }
  `;

  try {
    const data = await gql<{
      httpRequestsAdaptiveGroups: Array<{
        dimensions: { xRequestedWith: string };
        avg: { sampleInterval: number };
        count: number;
      }>;
    }>(token, query, { zoneTag: zoneId, since, until, limit });

    return (data.httpRequestsAdaptiveGroups ?? []).map((r) => ({
      header: r.dimensions.xRequestedWith || "(empty)",
      requests: r.count,
    }));
  } catch {
    return [];
  }
}

/**
 * Dashboard-parity sparklines: requests + visits + pageviews + API requests,
 * all grouped by datetimeHour (same as ZapSparklineBydatetimeHour in the dashboard).
 * Returns hourly time-series for the selected window.
 */
export interface DashSparklineRow {
  ts: string;       // ISO datetime (hour granularity)
  requests: number;
  bytes: number;
  visits: number;
}

export async function fetchDashboardSparklines(
  token: string,
  zoneId: string,
  since: string,
  until: string
): Promise<DashSparklineRow[]> {
  const query = `
    query DashSparklines($zoneTag: string!, $since: string!, $until: string!) {
      viewer {
        zones(filter: { zoneTag: $zoneTag }) {
          series: httpRequestsAdaptiveGroups(
            limit: 5000
            filter: {
              AND: [
                { datetime_geq: $since, datetime_leq: $until },
                { requestSource: "eyeball" }
              ]
            }
          ) {
            count
            avg { sampleInterval }
            sum { edgeResponseBytes visits }
            dimensions { ts: datetimeHour }
          }
        }
      }
    }
  `;

  try {
    const data = await gql<{
      series: Array<{
        count: number;
        avg: { sampleInterval: number };
        sum: { edgeResponseBytes: number; visits: number };
        dimensions: { ts: string };
      }>;
    }>(token, query, { zoneTag: zoneId, since, until });

    return (data.series ?? []).map((r) => ({
      ts: r.dimensions.ts,
      requests: r.count,
      bytes: r.sum?.edgeResponseBytes ?? 0,
      visits: r.sum?.visits ?? 0,
    }));
  } catch {
    return [];
  }
}

// -- Source ASNs (top by requests, not just threat IPs) ----------------------
export interface SourceAsnRow {
  asn: number;
  asnName: string;
  requests: number;
}

export async function fetchSourceAsns(
  token: string, zoneId: string, since: string, until: string, limit = 10
): Promise<SourceAsnRow[]> {
  const query = `
    query SourceAsns($zoneTag: string!, $since: string!, $until: string!, $limit: int!) {
      viewer {
        zones(filter: { zoneTag: $zoneTag }) {
          httpRequestsAdaptiveGroups(
            limit: $limit
            filter: { ${rangeFilterClause(since)}, requestSource: "eyeball" }
            orderBy: [count_DESC]
          ) {
            dimensions { clientAsn clientAsnDescription }
            avg { sampleInterval }
            count
          }
        }
      }
    }
  `;
  try {
    const data = await gql<{
      httpRequestsAdaptiveGroups: Array<{
        dimensions: { clientAsn: number; clientAsnDescription: string };
        avg: { sampleInterval: number };
        count: number;
      }>;
    }>(token, query, { zoneTag: zoneId, since, until, limit });
    return (data.httpRequestsAdaptiveGroups ?? []).map((r) => ({
      asn: r.dimensions.clientAsn,
      asnName: r.dimensions.clientAsnDescription || `AS${r.dimensions.clientAsn}`,
      requests: r.count,
    }));
  } catch {
    return [];
  }
}

// =============================================================================
// API Traffic Analytics
// Matches the CF dashboard ZapSparklineBydatetimeHour apiFilter query:
//   edgeResponseContentTypeName in [json, xml, grpc, grpcweb]
// =============================================================================

export interface ApiTrafficDay {
  date: string;
  requests: number;
  bytes: number;
}

export async function fetchApiTrafficTimeSeries(
  token: string,
  zoneId: string,
  since: string,
  until: string
): Promise<ApiTrafficDay[]> {
  const query = `
    query ApiTraffic($zoneTag: string!, $since: string!, $until: string!) {
      viewer {
        zones(filter: { zoneTag: $zoneTag }) {
          httpRequestsAdaptiveGroups(
            limit: 31
            filter: {
              AND: [
                { ${rangeFilterClause(since)} },
                { requestSource: "eyeball" },
                { OR: [
                  { edgeResponseContentTypeName: "json" },
                  { edgeResponseContentTypeName: "xml" },
                  { edgeResponseContentTypeName: "grpc" },
                  { edgeResponseContentTypeName: "grpcweb" }
                ]}
              ]
            }
            orderBy: [date_ASC]
          ) {
            dimensions { date }
            count
            sum { edgeResponseBytes }
            avg { sampleInterval }
          }
        }
      }
    }
  `;
  try {
    const data = await gql<{
      httpRequestsAdaptiveGroups: Array<{
        dimensions: { date: string };
        count: number;
        sum: { edgeResponseBytes: number };
        avg: { sampleInterval: number };
      }>;
    }>(token, query, { zoneTag: zoneId, since, until });
    return (data.httpRequestsAdaptiveGroups ?? []).map((r) => ({
      date: r.dimensions.date, requests: r.count, bytes: r.sum?.edgeResponseBytes ?? 0,
    }));
  } catch { return []; }
}

export interface ApiTopPath { host: string; path: string; requests: number; bytes: number; }

export async function fetchApiTopPaths(
  token: string, zoneId: string, since: string, until: string, limit = 15
): Promise<ApiTopPath[]> {
  const query = `
    query ApiTopPaths($zoneTag: string!, $since: string!, $until: string!, $limit: int!) {
      viewer {
        zones(filter: { zoneTag: $zoneTag }) {
          httpRequestsAdaptiveGroups(
            limit: $limit
            filter: {
              AND: [
                { ${rangeFilterClause(since)} },
                { requestSource: "eyeball" },
                { OR: [
                  { edgeResponseContentTypeName: "json" },
                  { edgeResponseContentTypeName: "xml" },
                  { edgeResponseContentTypeName: "grpc" },
                  { edgeResponseContentTypeName: "grpcweb" }
                ]}
              ]
            }
            orderBy: [count_DESC]
          ) {
            dimensions { clientRequestHTTPHost clientRequestPath }
            count
            sum { edgeResponseBytes }
            avg { sampleInterval }
          }
        }
      }
    }
  `;
  try {
    const data = await gql<{
      httpRequestsAdaptiveGroups: Array<{
        dimensions: { clientRequestHTTPHost: string; clientRequestPath: string };
        count: number;
        sum: { edgeResponseBytes: number };
        avg: { sampleInterval: number };
      }>;
    }>(token, query, { zoneTag: zoneId, since, until, limit });
    return (data.httpRequestsAdaptiveGroups ?? []).map((r) => ({
      host:     r.dimensions.clientRequestHTTPHost || "",
      path:     r.dimensions.clientRequestPath || "/",
      requests: r.count,
      bytes:    r.sum?.edgeResponseBytes ?? 0,
    }));
  } catch { return []; }
}

export interface ApiMethodRow { method: string; requests: number; }

export async function fetchApiMethodBreakdown(
  token: string, zoneId: string, since: string, until: string
): Promise<ApiMethodRow[]> {
  const query = `
    query ApiMethods($zoneTag: string!, $since: string!, $until: string!) {
      viewer {
        zones(filter: { zoneTag: $zoneTag }) {
          httpRequestsAdaptiveGroups(
            limit: 10
            filter: {
              AND: [
                { ${rangeFilterClause(since)} },
                { requestSource: "eyeball" },
                { OR: [
                  { edgeResponseContentTypeName: "json" },
                  { edgeResponseContentTypeName: "xml" },
                  { edgeResponseContentTypeName: "grpc" },
                  { edgeResponseContentTypeName: "grpcweb" }
                ]}
              ]
            }
            orderBy: [count_DESC]
          ) {
            dimensions { clientRequestHTTPMethodName }
            count
            avg { sampleInterval }
          }
        }
      }
    }
  `;
  try {
    const data = await gql<{
      httpRequestsAdaptiveGroups: Array<{
        dimensions: { clientRequestHTTPMethodName: string };
        count: number;
        avg: { sampleInterval: number };
      }>;
    }>(token, query, { zoneTag: zoneId, since, until });
    return (data.httpRequestsAdaptiveGroups ?? []).map((r) => ({
      method: r.dimensions.clientRequestHTTPMethodName || "UNKNOWN", requests: r.count,
    }));
  } catch { return []; }
}

// ─── WAF Attack Classification ────────────────────────────────────────────────
/**
 * Classifies WAF block events into attack categories (SQL Injection, XSS, CVE, etc.).
 * PRIMARY signal: Cloudflare's own rule `categories` (dashboard calls these
 * "tags") resolved from the deployed managed ruleset bodies via `ruleId` —
 * this is Cloudflare's authoritative classification, not a guess.
 * FALLBACK (when `ruleId` has no known category — custom rules, DDoS,
 * rate-limit, bot-management sources, etc.): a hand-written regex heuristic
 * over the event `description`, inspired by cf-reporting's security.ts
 * fetchAttackClassification().
 */
export interface WafAttackCategory {
  category: string;
  count: number;
  sources: string[];
  /** "cloudflare-tag" = resolved from real managed-ruleset categories; "heuristic" = regex guess. */
  classifiedBy: "cloudflare-tag" | "heuristic";
}

const WAF_ATTACK_PATTERNS: Array<{ category: string; patterns: RegExp[] }> = [
  { category: "SQL Injection",          patterns: [/sql/i, /sqli/i] },
  { category: "Cross-Site Scripting",   patterns: [/xss/i, /cross.?site/i, /html injection/i] },
  { category: "Path Traversal",         patterns: [/traversal/i, /directory/i, /relative path/i, /multiple slash/i] },
  { category: "CVE Exploits",           patterns: [/cve[:-]/i] },
  { category: "Vulnerability Scanning", patterns: [/scanner/i, /probe/i, /vulnerability/i] },
  { category: "Fake Bot",               patterns: [/fake.*bot/i, /fake.*google/i, /fake.*bing/i] },
  { category: "Header Anomaly",         patterns: [/anomaly:header/i, /missing or empty/i, /header/i] },
  { category: "File Inclusion",         patterns: [/file inclusion/i, /dangerous file/i] },
  { category: "Command Injection",      patterns: [/command injection/i, /rce/i, /code injection/i] },
  { category: "API Protection",         patterns: [/schema validation/i, /api shield/i] },
];

/** Human-readable labels for known Cloudflare managed-ruleset category tags. */
const CATEGORY_TAG_LABELS: Record<string, string> = {
  sqli: "SQL Injection",
  xss: "Cross-Site Scripting",
  rce: "Remote Code Execution",
  "rce-decoded": "Remote Code Execution",
  "file-inclusion": "File Inclusion",
  "directory-traversal": "Path Traversal",
  wordpress: "WordPress",
  joomla: "Joomla",
  drupal: "Drupal",
  magento: "Magento",
  sharepoint: "SharePoint",
  php: "PHP",
  "http-anomaly": "HTTP Anomaly",
  cve: "CVE Exploit",
  "known-cves": "CVE Exploit",
  generic: "Generic Attack",
  "info-leakage": "Information Leakage",
  "session-fixation": "Session Fixation",
  "protocol-attack": "Protocol Attack",
};

function formatCategoryTag(tag: string): string {
  return CATEGORY_TAG_LABELS[tag] ?? tag.split("-").map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(" ");
}

function classifyWafEvent(
  description: string,
  source: string,
  ruleId: string | undefined,
  categoriesMap: Map<string, string[]> | undefined
): { category: string; classifiedBy: "cloudflare-tag" | "heuristic" } {
  if (source === "l7ddos") return { category: "L7 DDoS", classifiedBy: "heuristic" };
  if (source === "ratelimit") return { category: "Rate Limiting", classifiedBy: "heuristic" };
  if (source === "bic") return { category: "Browser Integrity Check", classifiedBy: "heuristic" };
  if (source === "apiShieldSchemaValidation") return { category: "API Protection", classifiedBy: "heuristic" };

  if (ruleId && categoriesMap) {
    const cats = categoriesMap.get(ruleId);
    if (cats && cats.length > 0) {
      return { category: formatCategoryTag(cats[0]), classifiedBy: "cloudflare-tag" };
    }
  }
  for (const { category, patterns } of WAF_ATTACK_PATTERNS) {
    if (patterns.some((p) => p.test(description))) return { category, classifiedBy: "heuristic" };
  }
  return { category: "Other", classifiedBy: "heuristic" };
}

export async function fetchWafAttackClassification(
  token: string, zoneId: string, since: string, until: string,
  categoriesMap?: Map<string, string[]>
): Promise<WafAttackCategory[]> {
  const query = `
    query WafAttackClassif($zoneTag: string!, $since: Date!, $until: Date!) {
      viewer {
        zones(filter: { zoneTag: $zoneTag }) {
          firewallEventsAdaptiveGroups(
            limit: 200
            filter: { ${rangeFilterClause(since)}, action: "block" }
            orderBy: [count_DESC]
          ) {
            count
            dimensions { description source ruleId }
          }
        }
      }
    }
  `;
  try {
    const data = await gql<{
      firewallEventsAdaptiveGroups: Array<{
        count: number;
        dimensions: { description: string; source: string; ruleId: string };
      }>;
    }>(token, query, { zoneTag: zoneId, since, until });

    const catMap = new Map<string, { count: number; sources: Set<string>; classifiedBy: "cloudflare-tag" | "heuristic" }>();
    for (const r of data.firewallEventsAdaptiveGroups ?? []) {
      const { category: cat, classifiedBy } = classifyWafEvent(
        r.dimensions.description || "", r.dimensions.source || "", r.dimensions.ruleId, categoriesMap
      );
      const existing = catMap.get(cat) ?? { count: 0, sources: new Set<string>(), classifiedBy };
      existing.count += r.count;
      if (r.dimensions.source) existing.sources.add(r.dimensions.source);
      // A real Cloudflare tag classification always wins the label over a heuristic one.
      if (classifiedBy === "cloudflare-tag") existing.classifiedBy = "cloudflare-tag";
      catMap.set(cat, existing);
    }
    return Array.from(catMap.entries())
      .map(([category, { count, sources, classifiedBy }]) => ({
        category,
        count,
        sources: Array.from(sources),
        classifiedBy,
      }))
      .sort((a, b) => b.count - a.count);
  } catch { return []; }
}

// ─── Suspicious Activity — Account Takeover ───────────────────────────────────
/**
 * Cloudflare's Security Analytics "Account Takeover" panel is powered by Bot
 * Management detection IDs 201326592 (login failure), 201326593 (login
 * attempt), 201326598 (dynamic anomaly threshold) — see
 * https://developers.cloudflare.com/bots/additional-configurations/detection-ids/account-takeover-detections/
 * The GraphQL exposure of detection IDs (`botDetectionIds` /
 * `botDetectionIds_hasany`) is officially documented at
 * https://developers.cloudflare.com/ai-crawl-control/reference/graphql-api/ —
 * confirmed working filter syntax, reused here for a different detection-ID set.
 * Requires an active Bot Management subscription; returns empty otherwise.
 */
export const ACCOUNT_TAKEOVER_DETECTION_IDS = [201326592, 201326593, 201326598] as const;

export interface AccountTakeoverSummary {
  totalRequests: number;
  topPaths: Array<{ host: string; path: string; requests: number }>;
}

export async function fetchAccountTakeoverActivity(
  token: string, zoneId: string, since: string, until: string, limit = 15
): Promise<AccountTakeoverSummary> {
  const query = `
    query AccountTakeover($zoneTag: string!, $since: string!, $until: string!, $limit: int!) {
      viewer {
        zones(filter: { zoneTag: $zoneTag }) {
          httpRequestsAdaptiveGroups(
            limit: $limit
            filter: {
              datetime_geq: $since, datetime_leq: $until,
              requestSource: "eyeball",
              botDetectionIds_hasany: [201326592, 201326593, 201326598]
            }
            orderBy: [count_DESC]
          ) {
            count
            dimensions { clientRequestHTTPHost clientRequestPath }
          }
        }
      }
    }
  `;
  const data = await gql<{
    httpRequestsAdaptiveGroups: Array<{
      count: number;
      dimensions: { clientRequestHTTPHost: string; clientRequestPath: string };
    }>;
  }>(token, query, { zoneTag: zoneId, since, until, limit });

  const rows = data.httpRequestsAdaptiveGroups ?? [];
  return {
    totalRequests: rows.reduce((s, r) => s + r.count, 0),
    topPaths: rows
      .map((r) => ({ host: r.dimensions.clientRequestHTTPHost || "", path: r.dimensions.clientRequestPath || "/", requests: r.count }))
      .sort((a, b) => b.requests - a.requests),
  };
}

// ─── Suspicious Activity — Per-Vector WAF Attack Score ────────────────────────
/**
 * CONFIRMED via live GraphQL introspection against a real Cloudflare account
 * (2026-09-01): `wafSqliAttackScore`, `wafXssAttackScore`, `wafRceAttackScore`,
 * and `wafPathTraversalAttackScore` all exist as real fields on
 * `ZoneHttpRequestsAdaptiveGroupsDimensions` — i.e. they are DIMENSION
 * (group-by) fields, NOT fields of an `avg { }` aggregate object (no such
 * "Avg" type exposes them — confirmed absent from the introspection result).
 * The original implementation of this function incorrectly queried them
 * under `avg { }`, which is why it failed with "unknown field
 * wafSqliAttackScore" — the field name was right, the query shape was wrong.
 * Since these are per-request integer scores (1-99) exposed only as
 * groupable dimensions, we group by them (capped at a generous row limit)
 * and compute a request-count-weighted average ourselves.
 */
export interface WafPerVectorScoreSummary {
  scoredCount: number;
  avgSqliScore: number | null;
  avgXssScore: number | null;
  avgRceScore: number | null;
  avgPathTraversalScore: number | null;
}

export async function fetchWafPerVectorAttackScore(
  token: string, zoneId: string, since: string, until: string
): Promise<WafPerVectorScoreSummary> {
  const query = `
    query WafPerVectorScore($zoneTag: string!, $since: string!, $until: string!) {
      viewer {
        zones(filter: { zoneTag: $zoneTag }) {
          httpRequestsAdaptiveGroups(
            limit: 3000
            filter: {
              datetime_geq: $since, datetime_leq: $until,
              requestSource: "eyeball",
              wafAttackScoreClass_neq: "clean"
            }
            orderBy: [count_DESC]
          ) {
            count
            dimensions { wafSqliAttackScore wafXssAttackScore wafRceAttackScore wafPathTraversalAttackScore }
          }
        }
      }
    }
  `;
  const data = await gql<{
    httpRequestsAdaptiveGroups: Array<{
      count: number;
      dimensions: { wafSqliAttackScore: number; wafXssAttackScore: number; wafRceAttackScore: number; wafPathTraversalAttackScore: number };
    }>;
  }>(token, query, { zoneTag: zoneId, since, until });

  const rows = data.httpRequestsAdaptiveGroups ?? [];
  const scoredCount = rows.reduce((s, r) => s + r.count, 0);
  if (scoredCount === 0) return { scoredCount: 0, avgSqliScore: null, avgXssScore: null, avgRceScore: null, avgPathTraversalScore: null };

  const weightedAvg = (pick: (d: typeof rows[number]["dimensions"]) => number) =>
    Math.round((rows.reduce((s, r) => s + pick(r.dimensions) * r.count, 0) / scoredCount) * 10) / 10;

  return {
    scoredCount,
    avgSqliScore: weightedAvg((d) => d.wafSqliAttackScore),
    avgXssScore: weightedAvg((d) => d.wafXssAttackScore),
    avgRceScore: weightedAvg((d) => d.wafRceAttackScore),
    avgPathTraversalScore: weightedAvg((d) => d.wafPathTraversalAttackScore),
  };
}

// ─── Suspicious Activity — AI Security for Apps detections ───────────────────
/**
 * CONFIRMED via live GraphQL introspection: the real field names are
 * `firewallForAiAnyPiiCategory` (bool), `firewallForAiPiiCategories`
 * (array), `firewallForAiUnsafeTopicCategories` (array), and
 * `firewallForAiInjectionScore` (int, 1-99) on
 * `ZoneHttpRequestsAdaptiveGroupsDimensions` — NOT `llmPrompt*` as the
 * Ruleset Engine field names (`cf.llm.prompt.*`) might suggest. GraphQL
 * kept the product's older "Firewall for AI" name even though the product
 * itself was renamed to "AI Security for Apps".
 * Scoped to cf-llm labeled traffic since that's the only traffic this
 * feature ever scans.
 */
export interface AiSecurityDetectionSummary {
  scannedCount: number;
  piiDetectedCount: number;
  piiCategoryBreakdown: Array<{ category: string; count: number }>;
  unsafeTopicDetectedCount: number;
  unsafeTopicCategoryBreakdown: Array<{ category: string; count: number }>;
  injectionScoreBands: { high: number; moderate: number; low: number };
  avgInjectionScore: number | null;
}

export async function fetchAiSecurityDetections(
  token: string, zoneId: string, since: string, until: string
): Promise<AiSecurityDetectionSummary> {
  const query = `
    query AiSecurityDetections($zoneTag: string!, $since: string!, $until: string!) {
      viewer {
        zones(filter: { zoneTag: $zoneTag }) {
          httpRequestsAdaptiveGroups(
            limit: 3000
            filter: {
              datetime_geq: $since, datetime_leq: $until,
              requestSource: "eyeball",
              webAssetsLabelsManaged_hasany: ["cf-llm"]
            }
            orderBy: [count_DESC]
          ) {
            count
            dimensions {
              firewallForAiAnyPiiCategory
              firewallForAiPiiCategories
              firewallForAiUnsafeTopicCategories
              firewallForAiInjectionScore
            }
          }
        }
      }
    }
  `;
  const data = await gql<{
    httpRequestsAdaptiveGroups: Array<{
      count: number;
      dimensions: {
        firewallForAiAnyPiiCategory: boolean | null;
        firewallForAiPiiCategories: string[] | null;
        firewallForAiUnsafeTopicCategories: string[] | null;
        firewallForAiInjectionScore: number | null;
      };
    }>;
  }>(token, query, { zoneTag: zoneId, since, until });

  const rows = data.httpRequestsAdaptiveGroups ?? [];
  let scannedCount = 0, piiDetectedCount = 0, unsafeTopicDetectedCount = 0;
  let injectionScoreWeighted = 0, injectionScoreCount = 0;
  const piiCatMap = new Map<string, number>();
  const unsafeCatMap = new Map<string, number>();
  const bands = { high: 0, moderate: 0, low: 0 };

  for (const r of rows) {
    scannedCount += r.count;
    if (r.dimensions.firewallForAiAnyPiiCategory) piiDetectedCount += r.count;
    for (const cat of r.dimensions.firewallForAiPiiCategories ?? []) {
      piiCatMap.set(cat, (piiCatMap.get(cat) ?? 0) + r.count);
    }
    const unsafeCats = r.dimensions.firewallForAiUnsafeTopicCategories ?? [];
    if (unsafeCats.length > 0) unsafeTopicDetectedCount += r.count;
    for (const cat of unsafeCats) {
      unsafeCatMap.set(cat, (unsafeCatMap.get(cat) ?? 0) + r.count);
    }
    const score = r.dimensions.firewallForAiInjectionScore;
    if (score != null) {
      injectionScoreWeighted += score * r.count;
      injectionScoreCount += r.count;
      if (score <= 19) bands.high += r.count;
      else if (score <= 49) bands.moderate += r.count;
      else bands.low += r.count;
    }
  }

  return {
    scannedCount,
    piiDetectedCount,
    piiCategoryBreakdown: Array.from(piiCatMap.entries()).map(([category, count]) => ({ category, count })).sort((a, b) => b.count - a.count),
    unsafeTopicDetectedCount,
    unsafeTopicCategoryBreakdown: Array.from(unsafeCatMap.entries()).map(([category, count]) => ({ category, count })).sort((a, b) => b.count - a.count),
    injectionScoreBands: bands,
    avgInjectionScore: injectionScoreCount > 0 ? Math.round((injectionScoreWeighted / injectionScoreCount) * 10) / 10 : null,
  };
}

// ─── Suspicious Activity — Leaked Credential Check results ───────────────────
/**
 * CONFIRMED via live GraphQL introspection: `leakedCredentialCheckResult` is
 * a real field on `ZoneHttpRequestsAdaptiveGroupsDimensions`. Documented
 * possible values: password_leaked | username_and_password_leaked |
 * username_password_similar | username_leaked | clean.
 * https://developers.cloudflare.com/logs/logpush/logpush-job/datasets/zone/http_requests/#leakedcredentialcheckresult
 */
export interface LeakedCredentialCheckResults {
  totalChecked: number;
  byResult: Array<{ result: string; count: number }>;
  breachedCount: number; // any non-"clean" result
}

export async function fetchLeakedCredentialCheckResults(
  token: string, zoneId: string, since: string, until: string
): Promise<LeakedCredentialCheckResults> {
  const query = `
    query LeakedCredResults($zoneTag: string!, $since: string!, $until: string!) {
      viewer {
        zones(filter: { zoneTag: $zoneTag }) {
          httpRequestsAdaptiveGroups(
            limit: 10
            filter: {
              datetime_geq: $since, datetime_leq: $until,
              requestSource: "eyeball",
              leakedCredentialCheckResult_neq: ""
            }
            orderBy: [count_DESC]
          ) {
            count
            dimensions { leakedCredentialCheckResult }
          }
        }
      }
    }
  `;
  const data = await gql<{
    httpRequestsAdaptiveGroups: Array<{
      count: number;
      dimensions: { leakedCredentialCheckResult: string };
    }>;
  }>(token, query, { zoneTag: zoneId, since, until });

  const rows = data.httpRequestsAdaptiveGroups ?? [];
  const byResult = rows
    .map((r) => ({ result: r.dimensions.leakedCredentialCheckResult, count: r.count }))
    .filter((r) => r.result)
    .sort((a, b) => b.count - a.count);

  return {
    totalChecked: byResult.reduce((s, r) => s + r.count, 0),
    byResult,
    breachedCount: byResult.filter((r) => r.result !== "clean").reduce((s, r) => s + r.count, 0),
  };
}

// ─── Suspicious Activity — Malicious Uploads (Content Scanning) results ──────
/**
 * CONFIRMED via live GraphQL introspection: `contentScanNumMaliciousObj`,
 * `contentScanNumObj`, `contentScanHasFailed`, and `contentScanObjResults`
 * are real fields on `ZoneHttpRequestsAdaptiveGroupsDimensions`.
 */
export interface ContentScanResults {
  totalScannedRequests: number;
  requestsWithMaliciousObject: number;
  scanFailedCount: number;
  objResultsBreakdown: Array<{ result: string; count: number }>;
}

export async function fetchContentScanResults(
  token: string, zoneId: string, since: string, until: string
): Promise<ContentScanResults> {
  const query = `
    query ContentScanResults($zoneTag: string!, $since: string!, $until: string!) {
      viewer {
        zones(filter: { zoneTag: $zoneTag }) {
          httpRequestsAdaptiveGroups(
            limit: 3000
            filter: {
              datetime_geq: $since, datetime_leq: $until,
              requestSource: "eyeball",
              contentScanNumObj_gt: 0
            }
            orderBy: [count_DESC]
          ) {
            count
            dimensions { contentScanNumMaliciousObj contentScanHasFailed contentScanObjResults }
          }
        }
      }
    }
  `;
  const data = await gql<{
    httpRequestsAdaptiveGroups: Array<{
      count: number;
      dimensions: { contentScanNumMaliciousObj: number; contentScanHasFailed: boolean; contentScanObjResults: string[] };
    }>;
  }>(token, query, { zoneTag: zoneId, since, until });

  const rows = data.httpRequestsAdaptiveGroups ?? [];
  let totalScannedRequests = 0, requestsWithMaliciousObject = 0, scanFailedCount = 0;
  const resultMap = new Map<string, number>();

  for (const r of rows) {
    totalScannedRequests += r.count;
    if (r.dimensions.contentScanNumMaliciousObj > 0) requestsWithMaliciousObject += r.count;
    if (r.dimensions.contentScanHasFailed) scanFailedCount += r.count;
    for (const res of r.dimensions.contentScanObjResults ?? []) {
      resultMap.set(res, (resultMap.get(res) ?? 0) + r.count);
    }
  }

  return {
    totalScannedRequests,
    requestsWithMaliciousObject,
    scanFailedCount,
    objResultsBreakdown: Array.from(resultMap.entries()).map(([result, count]) => ({ result, count })).sort((a, b) => b.count - a.count),
  };
}

// ─── WAF Rule Effectiveness ───────────────────────────────────────────────────
/**
 * Per-rule block rate across all actions (block, challenge, log, skip).
 * Inspired by cf-reporting's security.ts fetchRuleEffectiveness().
 */
export interface WafRuleEffectiveness {
  ruleId: string;
  description: string;
  totalHits: number;
  blocks: number;
  challenges: number;
  logs: number;
  blockRate: number;  // 0-100 %
}

export async function fetchWafRuleEffectiveness(
  token: string, zoneId: string, since: string, until: string, limit = 15
): Promise<WafRuleEffectiveness[]> {
  const query = `
    query WafRuleEffective($zoneTag: string!, $since: Date!, $until: Date!) {
      viewer {
        zones(filter: { zoneTag: $zoneTag }) {
          firewallEventsAdaptiveGroups(
            limit: 500
            filter: { ${rangeFilterClause(since)} }
            orderBy: [count_DESC]
          ) {
            count
            dimensions { ruleId description action }
          }
        }
      }
    }
  `;
  try {
    const data = await gql<{
      firewallEventsAdaptiveGroups: Array<{
        count: number;
        dimensions: { ruleId: string; description: string; action: string };
      }>;
    }>(token, query, { zoneTag: zoneId, since, until });

    const ruleMap = new Map<string, {
      description: string;
      blocks: number; challenges: number; logs: number; total: number;
    }>();
    for (const r of data.firewallEventsAdaptiveGroups ?? []) {
      const id = r.dimensions.ruleId || "unknown";
      const existing = ruleMap.get(id) ?? {
        description: r.dimensions.description || "",
        blocks: 0, challenges: 0, logs: 0, total: 0,
      };
      existing.total += r.count;
      const action = r.dimensions.action;
      if (action === "block") existing.blocks += r.count;
      else if (action === "challenge" || action === "managed_challenge" || action === "js_challenge") {
        existing.challenges += r.count;
      } else if (action === "log") existing.logs += r.count;
      ruleMap.set(id, existing);
    }
    return Array.from(ruleMap.entries())
      .filter(([, v]) => v.blocks + v.challenges > 0)
      .map(([ruleId, v]) => ({
        ruleId,
        description: v.description,
        totalHits: v.total,
        blocks: v.blocks,
        challenges: v.challenges,
        logs: v.logs,
        blockRate: v.total > 0 ? Math.round((v.blocks / v.total) * 100) : 0,
      }))
      .sort((a, b) => b.totalHits - a.totalHits)
      .slice(0, limit);
  } catch { return []; }
}

// ─── DNS NXDOMAIN Hotspots ────────────────────────────────────────────────────
/**
 * Top DNS queries returning NXDOMAIN — indicates missing records or misconfigurations.
 * Inspired by cf-reporting's dns.ts fetchDnsAggregates() nxdomains query.
 */
export interface NxdomainHotspot {
  name: string;
  count: number;
}

export async function fetchNxdomainHotspots(
  token: string, accountId: string, zoneId: string, since: string, until: string, limit = 15
): Promise<NxdomainHotspot[]> {
  // dnsAnalyticsAdaptiveGroups requires both accountId (for account filter) and zoneTag.
  // `string` variables coerce to Date for date filters and to Time for
  // datetime filters — matches the declaration style of the other adaptive queries.
  const buildQuery = (timeFilter: string) => `
    query NxdomainHotspots($zoneTag: string!, $since: string!, $until: string!, $limit: int!) {
      viewer {
        zones(filter: { zoneTag: $zoneTag }) {
          dnsAnalyticsAdaptiveGroups(
            limit: $limit
            filter: {
              ${timeFilter}
              responseCode: "NXDOMAIN"
            }
            orderBy: [count_DESC]
          ) {
            count
            dimensions { queryName }
          }
        }
      }
    }
  `;
  try {
    const data = await gqlDnsExact<{
      dnsAnalyticsAdaptiveGroups: Array<{
        count: number;
        dimensions: { queryName: string };
      }>;
    }>((query: string, vars: Record<string, unknown>) => gql(token, query, vars), buildQuery, { zoneTag: zoneId, since, until, limit }, since);

    return (data.dnsAnalyticsAdaptiveGroups ?? [])
      .filter((r) => r.dimensions.queryName)
      .map((r) => ({ name: r.dimensions.queryName, count: r.count }));
  } catch { return []; }
}

export interface ApiStatusRow { status: number; requests: number; }

export async function fetchApiStatusBreakdown(
  token: string, zoneId: string, since: string, until: string
): Promise<ApiStatusRow[]> {
  const query = `
    query ApiStatus($zoneTag: string!, $since: string!, $until: string!) {
      viewer {
        zones(filter: { zoneTag: $zoneTag }) {
          httpRequestsAdaptiveGroups(
            limit: 20
            filter: {
              AND: [
                { ${rangeFilterClause(since)} },
                { requestSource: "eyeball" },
                { OR: [
                  { edgeResponseContentTypeName: "json" },
                  { edgeResponseContentTypeName: "xml" },
                  { edgeResponseContentTypeName: "grpc" },
                  { edgeResponseContentTypeName: "grpcweb" }
                ]}
              ]
            }
            orderBy: [count_DESC]
          ) {
            dimensions { edgeResponseStatus }
            count
            avg { sampleInterval }
          }
        }
      }
    }
  `;
  try {
    const data = await gql<{
      httpRequestsAdaptiveGroups: Array<{
        dimensions: { edgeResponseStatus: number };
        count: number;
        avg: { sampleInterval: number };
      }>;
    }>(token, query, { zoneTag: zoneId, since, until });
    return (data.httpRequestsAdaptiveGroups ?? []).map((r) => ({
      status: r.dimensions.edgeResponseStatus, requests: r.count,
    }));
  } catch { return []; }
}

// ═══════════════════════════════════════════════════════════════════════════════
// AI CRAWL CONTROL ANALYTICS — Generative AI bot/crawler traffic visibility
// Mirrors https://developers.cloudflare.com/ai-crawl-control/reference/graphql-api/
// ═══════════════════════════════════════════════════════════════════════════════
/**
 * IMPORTANT: Cloudflare's own AI Crawl Control product (and its documented
 * GraphQL API) identifies AI crawlers via `userAgent_like` matching against
 * known bot user-agent strings. This works on ALL plans without a Bot
 * Management subscription. A `verifiedBotCategory`/`verifiedBotName`
 * dimension-based approach requires Bot Management to be active and returns
 * nothing otherwise — that is NOT how Cloudflare's own dashboard queries this
 * data, so we follow their documented pattern here instead.
 *
 * GraphQL `OR` filters in this codebase are inlined as literal syntax in the
 * query string (see fetchApiTrafficTimeSeries above) rather than passed as
 * typed variables, since the Analytics API's filter input types are not
 * separately nameable. We follow the same convention here.
 */

// Escape a string for safe inclusion inside a double-quoted GraphQL string literal.
function gqlStringLiteral(s: string): string {
  return JSON.stringify(s);
}

function aiUserAgentOrFilterLiteral(): string {
  return `[${AI_BOT_REFERENCE.map((b) => `{ userAgent_like: ${gqlStringLiteral(`%${b.userAgent}%`)} }`).join(", ")}]`;
}

function aiRefererOrFilterLiteral(): string {
  const domains = Array.from(new Set(Object.values(AI_REFERRAL_DOMAINS).flat()));
  return `[${domains.map((d) => `{ clientRefererHost_like: ${gqlStringLiteral(`%${d}%`)} }`).join(", ")}]`;
}

// ─── AI Crawler — Daily Time Series ───────────────────────────────────────────

export interface AiCrawlerDaySeries {
  date: string;
  requests: number;
}

export async function fetchAiCrawlerTimeSeries(
  token: string,
  zoneId: string,
  since: string,
  until: string
): Promise<AiCrawlerDaySeries[]> {
  const query = `
    query AiCrawlerSeries($zoneTag: string!, $since: string!, $until: string!) {
      viewer {
        zones(filter: { zoneTag: $zoneTag }) {
          httpRequestsAdaptiveGroups(
            limit: 5000
            filter: {
              ${rangeFilterClause(since)},
              requestSource: "eyeball",
              OR: ${aiUserAgentOrFilterLiteral()}
            }
            orderBy: [date_ASC]
          ) {
            dimensions { date }
            count
          }
        }
      }
    }
  `;

  try {
    const data = await gql<{
      httpRequestsAdaptiveGroups: Array<{ dimensions: { date: string }; count: number }>;
    }>(token, query, { zoneTag: zoneId, since, until });

    const byDate = new Map<string, number>();
    for (const r of data.httpRequestsAdaptiveGroups ?? []) {
      byDate.set(r.dimensions.date, (byDate.get(r.dimensions.date) ?? 0) + r.count);
    }
    return Array.from(byDate.entries())
      .map(([date, requests]) => ({ date, requests }))
      .sort((a, b) => a.date.localeCompare(b.date));
  } catch {
    return [];
  }
}

// ─── AI Crawler — Named Bot Breakdown (with bandwidth) ────────────────────────
/**
 * Breaks down AI crawler traffic by specific bot name via user-agent
 * matching (GPTBot, ChatGPT-User, ClaudeBot, PerplexityBot, Bytespider,
 * CCBot, Amazonbot, Applebot, meta-externalagent, etc.), including
 * bandwidth consumed (`edgeResponseBytes`) — matches the "Data transfer"
 * column in the AI Crawl Control dashboard's Crawlers tab.
 */
export interface AiCrawlerBotRow {
  botName: string;
  operator: string;
  category: string;
  requests: number;
  bytes: number;
}

export async function fetchAiCrawlerBots(
  token: string,
  zoneId: string,
  since: string,
  until: string,
  limit = 100
): Promise<AiCrawlerBotRow[]> {
  const query = `
    query AiCrawlerBots($zoneTag: string!, $since: string!, $until: string!, $limit: int!) {
      viewer {
        zones(filter: { zoneTag: $zoneTag }) {
          httpRequestsAdaptiveGroups(
            limit: $limit
            filter: {
              ${rangeFilterClause(since)},
              requestSource: "eyeball",
              OR: ${aiUserAgentOrFilterLiteral()}
            }
            orderBy: [count_DESC]
          ) {
            dimensions { userAgent }
            sum { edgeResponseBytes }
            count
          }
        }
      }
    }
  `;

  try {
    const data = await gql<{
      httpRequestsAdaptiveGroups: Array<{
        dimensions: { userAgent: string };
        sum: { edgeResponseBytes: number };
        count: number;
      }>;
    }>(token, query, { zoneTag: zoneId, since, until, limit });

    // Group raw userAgent rows onto their reference bot (multiple exact UA
    // strings from the same bot family can appear — merge them).
    const byBot = new Map<string, AiCrawlerBotRow>();
    for (const r of data.httpRequestsAdaptiveGroups ?? []) {
      const ref = findBotByUserAgent(r.dimensions.userAgent);
      if (!ref) continue; // shouldn't happen given the OR filter, but be safe
      const existing = byBot.get(ref.name);
      if (existing) {
        existing.requests += r.count;
        existing.bytes += r.sum?.edgeResponseBytes ?? 0;
      } else {
        byBot.set(ref.name, {
          botName: ref.name,
          operator: ref.operator,
          category: ref.category,
          requests: r.count,
          bytes: r.sum?.edgeResponseBytes ?? 0,
        });
      }
    }

    return Array.from(byBot.values()).sort((a, b) => b.requests - a.requests);
  } catch {
    return [];
  }
}

// ─── AI Crawler — Status Code Breakdown (allowed vs blocked) ──────────────────
/**
 * Mirrors the "Status code distribution" chart: 2xx (allowed), 402 (payment
 * required), 403 (blocked), other 4xx, 5xx.
 */
export interface AiCrawlerStatusRow {
  status: number;
  requests: number;
}

export async function fetchAiCrawlerStatusBreakdown(
  token: string,
  zoneId: string,
  since: string,
  until: string
): Promise<AiCrawlerStatusRow[]> {
  const query = `
    query AiCrawlerStatus($zoneTag: string!, $since: string!, $until: string!) {
      viewer {
        zones(filter: { zoneTag: $zoneTag }) {
          httpRequestsAdaptiveGroups(
            limit: 100
            filter: {
              ${rangeFilterClause(since)},
              requestSource: "eyeball",
              OR: ${aiUserAgentOrFilterLiteral()}
            }
            orderBy: [count_DESC]
          ) {
            dimensions { edgeResponseStatus }
            count
          }
        }
      }
    }
  `;

  try {
    const data = await gql<{
      httpRequestsAdaptiveGroups: Array<{ dimensions: { edgeResponseStatus: number }; count: number }>;
    }>(token, query, { zoneTag: zoneId, since, until });

    return (data.httpRequestsAdaptiveGroups ?? []).map((r) => ({
      status: r.dimensions.edgeResponseStatus,
      requests: r.count,
    }));
  } catch {
    return [];
  }
}

// ─── AI Crawler — Top Paths ────────────────────────────────────────────────────
/** Mirrors the "Most popular paths" table — pages most requested by AI crawlers. */
export interface AiCrawlerPathRow {
  host: string;
  path: string;
  requests: number;
}

export async function fetchAiCrawlerTopPaths(
  token: string,
  zoneId: string,
  since: string,
  until: string,
  limit = 15
): Promise<AiCrawlerPathRow[]> {
  const query = `
    query AiCrawlerPaths($zoneTag: string!, $since: string!, $until: string!, $limit: int!) {
      viewer {
        zones(filter: { zoneTag: $zoneTag }) {
          httpRequestsAdaptiveGroups(
            limit: $limit
            filter: {
              ${rangeFilterClause(since)},
              requestSource: "eyeball",
              OR: ${aiUserAgentOrFilterLiteral()}
            }
            orderBy: [count_DESC]
          ) {
            dimensions { clientRequestHTTPHost clientRequestPath }
            count
          }
        }
      }
    }
  `;

  try {
    const data = await gql<{
      httpRequestsAdaptiveGroups: Array<{
        dimensions: { clientRequestHTTPHost: string; clientRequestPath: string };
        count: number;
      }>;
    }>(token, query, { zoneTag: zoneId, since, until, limit });

    return (data.httpRequestsAdaptiveGroups ?? []).map((r) => ({
      host: r.dimensions.clientRequestHTTPHost || "",
      path: r.dimensions.clientRequestPath || "/",
      requests: r.count,
    }));
  } catch {
    return [];
  }
}

// ─── AI Referral Traffic ───────────────────────────────────────────────────────
/**
 * Humans arriving at the site FROM an AI platform (chatgpt.com, claude.ai,
 * perplexity.ai, etc.) — a completely different signal from crawler traffic.
 * Per Cloudflare docs, referrer analytics are a paid-plan feature; this
 * gracefully returns an empty array on plans/zones without the data.
 */
export interface AiReferralRow {
  date: string;
  operator: string;
  requests: number;
}

export async function fetchAiReferralTraffic(
  token: string,
  zoneId: string,
  since: string,
  until: string
): Promise<AiReferralRow[]> {
  const query = `
    query AiReferralTraffic($zoneTag: string!, $since: string!, $until: string!) {
      viewer {
        zones(filter: { zoneTag: $zoneTag }) {
          httpRequestsAdaptiveGroups(
            limit: 5000
            filter: {
              ${rangeFilterClause(since)},
              requestSource: "eyeball",
              OR: ${aiRefererOrFilterLiteral()}
            }
            orderBy: [date_ASC]
          ) {
            dimensions { date clientRefererHost }
            count
          }
        }
      }
    }
  `;

  try {
    const data = await gql<{
      httpRequestsAdaptiveGroups: Array<{
        dimensions: { date: string; clientRefererHost: string };
        count: number;
      }>;
    }>(token, query, { zoneTag: zoneId, since, until });

    const byKey = new Map<string, AiReferralRow>();
    for (const r of data.httpRequestsAdaptiveGroups ?? []) {
      const operator = findOperatorByRefererHost(r.dimensions.clientRefererHost) ?? "Other";
      const key = `${r.dimensions.date}|${operator}`;
      const existing = byKey.get(key);
      if (existing) existing.requests += r.count;
      else byKey.set(key, { date: r.dimensions.date, operator, requests: r.count });
    }
    return Array.from(byKey.values()).sort((a, b) => a.date.localeCompare(b.date));
  } catch {
    return [];
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// API SHIELD — Endpoint Labeling Service (Web Assets)
// Mirrors https://developers.cloudflare.com/api-shield/management-and-monitoring/endpoint-labels/
// ═══════════════════════════════════════════════════════════════════════════════
/**
 * Cloudflare's Endpoint Labeling Service exposes `webAssetsOperationId` and
 * `webAssetsLabelsManaged` directly on httpRequestsAdaptiveGroups (confirmed
 * via Cloudflare's own documented GraphQL example query). Two label families:
 *
 *  - Risk labels (auto-applied by Cloudflare's daily risk scans):
 *      cf-risk-zombie          — saved endpoint with no traffic in 32+ days
 *      cf-risk-missing-auth    — all successful requests lack a session identifier
 *      cf-risk-mixed-auth      — some successful requests lack a session identifier
 *      cf-risk-sensitive       — response matched Sensitive Data Detection
 *      cf-risk-bola-enumeration / cf-risk-bola-pollution — BOLA attack signals
 *      cf-risk-errors-anomaly / cf-risk-latency-anomaly / cf-risk-size-anomaly
 *
 *  - Managed/use-case labels (customer-applied, identify business function):
 *      cf-log-in, cf-sign-up, cf-content, cf-purchase, cf-password-reset,
 *      cf-add-cart, cf-add-payment, cf-check-value, cf-add-post,
 *      cf-account-update, cf-llm, cf-mcp, cf-rss-feed, cf-web-page, cf-contains-ads
 *
 * Requires an active Enterprise API Shield subscription with Endpoint
 * Management (saved/promoted operations) — will return empty for zones
 * without it, which is expected and handled gracefully.
 */

/**
 * These lists are kept only as a reference/seed set for documentation and
 * are NOT used to classify labels anymore — a hardcoded allowlist is
 * fragile by construction: it silently drops any label Cloudflare adds or
 * renames later (confirmed live on a real zone: the actual returned label
 * is "cf-risk-errors-anomaly", not "cf-risk-error-anomaly" as originally
 * listed here, and "cf-api-endpoint" — a very common, high-volume label —
 * was missing entirely). Classification below is done dynamically by
 * prefix ("cf-risk-*" = risk label, any other "cf-*" = use-case/managed
 * label) so it automatically picks up every label Cloudflare actually
 * returns, present or future, without needing this list kept in sync.
 */
export const API_RISK_LABELS = [
  "cf-risk-zombie", "cf-risk-missing-auth", "cf-risk-mixed-auth", "cf-risk-sensitive",
  "cf-risk-bola-enumeration", "cf-risk-bola-pollution",
  "cf-risk-errors-anomaly", "cf-risk-latency-anomaly", "cf-risk-size-anomaly",
] as const;

export const API_USE_CASE_LABELS = [
  "cf-log-in", "cf-sign-up", "cf-content", "cf-purchase", "cf-password-reset",
  "cf-add-cart", "cf-add-payment", "cf-check-value", "cf-add-post",
  "cf-account-update", "cf-llm", "cf-mcp", "cf-rss-feed", "cf-web-page", "cf-contains-ads",
  "cf-api-endpoint",
] as const;

export interface WebAssetLabelRow {
  label: string;
  operationIds: string[];
  requests: number;
}

export interface WebAssetLabelsResult {
  riskLabels: WebAssetLabelRow[];
  useCaseLabels: WebAssetLabelRow[];
  /** operationId → labels carrying it (any risk label) */
  riskyOperationLabels: Record<string, string[]>;
  zombieOperationIds: string[];
}

export async function fetchWebAssetLabels(
  token: string, zoneId: string, since: string, until: string
): Promise<WebAssetLabelsResult> {
  const query = `
    query WebAssetLabels($zoneTag: string!, $since: string!, $until: string!) {
      viewer {
        zones(filter: { zoneTag: $zoneTag }) {
          httpRequestsAdaptiveGroups(
            filter: { datetime_geq: $since, datetime_leq: $until, requestSource: "eyeball" }
            limit: 5000
            orderBy: [count_DESC]
          ) {
            count
            dimensions { webAssetsOperationId webAssetsLabelsManaged }
          }
        }
      }
    }
  `;

  // NOTE: deliberately no internal try/catch — a genuine failure (bad token,
  // insufficient plan, GraphQL error) should THROW so Promise.allSettled +
  // safeGet at the call site (fetch-appsec.ts) capture the real reason into
  // the report's data-availability diagnostics, instead of this function
  // silently returning an empty result that's indistinguishable from "zone
  // genuinely has no labeled traffic this period". Note this GraphQL result
  // only reflects labels seen on TRAFFIC within the queried date range — the
  // authoritative, traffic-window-independent label counts (matching the
  // dashboard's Web Assets numbers) come from `getApiShieldLabels()`
  // (REST `/api_gateway/labels?with_mapped_resource_counts=true`) instead.
  const data = await gql<{
    httpRequestsAdaptiveGroups: Array<{
      count: number;
      dimensions: { webAssetsOperationId: string | null; webAssetsLabelsManaged: string[] | null };
    }>;
  }>(token, query, { zoneTag: zoneId, since, until });

  const riskAgg    = new Map<string, { ids: Set<string>; requests: number }>();
  const useCaseAgg = new Map<string, { ids: Set<string>; requests: number }>();
  const riskyOps    = new Map<string, Set<string>>();
  const zombieOps   = new Set<string>();

  // Dynamic classification by prefix (see API_RISK_LABELS/API_USE_CASE_LABELS
  // comment above) — any "cf-risk-*" label is a risk label, any other
  // "cf-*" managed label is a use-case/classification label. Non-"cf-"
  // prefixed labels are user-defined custom labels and are ignored here.
  const isRiskLabel = (label: string) => label.startsWith("cf-risk-");
  const isManagedLabel = (label: string) => label.startsWith("cf-");

  for (const r of data.httpRequestsAdaptiveGroups ?? []) {
    const opId = r.dimensions.webAssetsOperationId;
    const labels = r.dimensions.webAssetsLabelsManaged ?? [];
    if (!opId || labels.length === 0) continue;

    for (const label of labels) {
      if (isRiskLabel(label)) {
        const agg = riskAgg.get(label) ?? { ids: new Set(), requests: 0 };
        agg.ids.add(opId);
        agg.requests += r.count;
        riskAgg.set(label, agg);

        if (!riskyOps.has(opId)) riskyOps.set(opId, new Set());
        riskyOps.get(opId)!.add(label);
        if (label === "cf-risk-zombie") zombieOps.add(opId);
      } else if (isManagedLabel(label)) {
        const agg = useCaseAgg.get(label) ?? { ids: new Set(), requests: 0 };
        agg.ids.add(opId);
        agg.requests += r.count;
        useCaseAgg.set(label, agg);
      }
    }
  }

  const toRows = (m: Map<string, { ids: Set<string>; requests: number }>): WebAssetLabelRow[] =>
    Array.from(m.entries())
      .map(([label, { ids, requests }]) => ({ label, operationIds: Array.from(ids), requests }))
      .sort((a, b) => b.requests - a.requests);

  return {
    riskLabels: toRows(riskAgg),
    useCaseLabels: toRows(useCaseAgg),
    riskyOperationLabels: Object.fromEntries(
      Array.from(riskyOps.entries()).map(([id, labels]) => [id, Array.from(labels)])
    ),
    zombieOperationIds: Array.from(zombieOps),
  };
}
