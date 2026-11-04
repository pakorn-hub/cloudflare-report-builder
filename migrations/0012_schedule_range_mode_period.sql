-- 0012: allow range_mode = 'period' in the schedules table
--
-- Period mode reports the most recent COMPLETE period in the schedule's
-- timezone, computed at run time: yesterday (Daily), the previous Monday–
-- Sunday week (Weekly), or the previous calendar month (Monthly). Unlike
-- rolling windows these aren't anchored to "now minus N days", and unlike
-- custom ranges the bounds aren't frozen at save time — "yesterday" always
-- means the day before the run.
--
-- SQLite cannot ALTER a CHECK constraint in place, so range_mode is rebuilt
-- the standard way (as in 0009): new table with the full live schema —
-- including 0010's since_time/until_time and 0011's api_token/account_id —
-- copy rows across, swap names. The new `period` column holds the choice.

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
                CHECK (range_mode IN ('rolling', 'calendar_month', 'custom', 'period')),
  since_date    TEXT,                           -- custom mode: first local day
  until_date    TEXT,                            -- custom mode: last local day
  since_time    TEXT,                            -- custom mode: optional HH:MM start
  until_time    TEXT,                            -- custom mode: optional HH:MM end
  months_ago    INTEGER,                          -- calendar_month mode: 1..12
  period        TEXT CHECK (period IN ('yesterday', 'last_week', 'last_month')),
  api_token     TEXT,                            -- per-schedule customer token (write-only)
  account_id    TEXT                             -- per-schedule customer account
);

INSERT INTO schedules_new (
  id, name, report_type, zone_id, zone_name, days, tz_offset, frequency,
  day_of_week, day_of_month, send_hour_utc, recipients, subject, message,
  is_poc, client_name, enabled, created_at, updated_at, last_run_at,
  last_status, last_error, range_mode, since_date, until_date, since_time,
  until_time, months_ago, period, api_token, account_id
)
SELECT
  id, name, report_type, zone_id, zone_name, days, tz_offset, frequency,
  day_of_week, day_of_month, send_hour_utc, recipients, subject, message,
  is_poc, client_name, enabled, created_at, updated_at, last_run_at,
  last_status, last_error, range_mode, since_date, until_date, since_time,
  until_time, months_ago, NULL, api_token, account_id
FROM schedules;

DROP TABLE schedules;
ALTER TABLE schedules_new RENAME TO schedules;
