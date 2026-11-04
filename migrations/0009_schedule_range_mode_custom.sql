-- 0009: allow range_mode = 'custom' in the schedules table
--
-- SQLite cannot ALTER a CHECK constraint in place (no DROP CONSTRAINT), so
-- the column from 0007 must be rebuilt the standard SQLite way: create a
-- new table with the full desired schema, copy the rows across, swap names.
-- 0008's since_date/until_date/months_ago columns are folded in here so the
-- rebuilt table matches the live schema exactly.

CREATE TABLE schedules_new (
  id            TEXT PRIMARY KEY,
  name          TEXT NOT NULL,
  report_type   TEXT NOT NULL CHECK (report_type IN ('appsec', 'zero-trust')),
  zone_id       TEXT,
  zone_name     TEXT,
  days          INTEGER NOT NULL DEFAULT 30,
  tz_offset     INTEGER NOT NULL DEFAULT 0,
  frequency     TEXT NOT NULL CHECK (frequency IN ('daily', 'weekly', 'monthly')),
  day_of_week   INTEGER,
  day_of_month  INTEGER,
  send_hour_utc INTEGER NOT NULL DEFAULT 0 CHECK (send_hour_utc BETWEEN 0 AND 23),
  recipients    TEXT NOT NULL,
  subject       TEXT NOT NULL,
  message       TEXT NOT NULL DEFAULT '',
  is_poc        INTEGER NOT NULL DEFAULT 1,
  client_name   TEXT,
  enabled       INTEGER NOT NULL DEFAULT 1,
  created_at    TEXT NOT NULL,
  updated_at    TEXT NOT NULL,
  last_run_at   TEXT,
  last_status   TEXT,
  last_error    TEXT,
  range_mode    TEXT NOT NULL DEFAULT 'rolling'
                CHECK (range_mode IN ('rolling', 'calendar_month', 'custom')),
  since_date    TEXT,                          -- custom mode: first local day
  until_date    TEXT,                           -- custom mode: last local day
  months_ago    INTEGER                        -- calendar_month mode: 1..12
);

INSERT INTO schedules_new (
  id, name, report_type, zone_id, zone_name, days, tz_offset, frequency,
  day_of_week, day_of_month, send_hour_utc, recipients, subject, message,
  is_poc, client_name, enabled, created_at, updated_at, last_run_at,
  last_status, last_error, range_mode, since_date, until_date, months_ago
)
SELECT
  id, name, report_type, zone_id, zone_name, days, tz_offset, frequency,
  day_of_week, day_of_month, send_hour_utc, recipients, subject, message,
  is_poc, client_name, enabled, created_at, updated_at, last_run_at,
  last_status, last_error, range_mode, since_date, until_date, months_ago
FROM schedules;

DROP TABLE schedules;
ALTER TABLE schedules_new RENAME TO schedules;
