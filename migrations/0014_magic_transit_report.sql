-- Extend the product CHECK without losing any existing schedule fields or history.
CREATE TABLE schedules_new (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  report_type TEXT NOT NULL CHECK (report_type IN ('appsec', 'zero-trust', 'magic-transit')),
  zone_id TEXT, zone_name TEXT,
  days INTEGER NOT NULL DEFAULT 30,
  tz_offset INTEGER NOT NULL DEFAULT 0,
  frequency TEXT NOT NULL CHECK (frequency IN ('daily', 'weekly', 'monthly')),
  day_of_week INTEGER, day_of_month INTEGER,
  send_hour_utc INTEGER NOT NULL DEFAULT 0 CHECK (send_hour_utc BETWEEN 0 AND 23),
  recipients TEXT NOT NULL, subject TEXT NOT NULL,
  message TEXT NOT NULL DEFAULT '',
  is_poc INTEGER NOT NULL DEFAULT 1,
  client_name TEXT, enabled INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
  last_run_at TEXT, last_status TEXT, last_error TEXT,
  range_mode TEXT NOT NULL DEFAULT 'rolling' CHECK (range_mode IN ('rolling', 'calendar_month', 'custom', 'period')),
  since_date TEXT, until_date TEXT, since_time TEXT, until_time TEXT,
  months_ago INTEGER,
  period TEXT CHECK (period IN ('yesterday', 'last_week', 'last_month')),
  api_token TEXT, account_id TEXT, client_logo TEXT
);
INSERT INTO schedules_new (
  id, name, report_type, zone_id, zone_name, days, tz_offset, frequency,
  day_of_week, day_of_month, send_hour_utc, recipients, subject, message,
  is_poc, client_name, enabled, created_at, updated_at, last_run_at,
  last_status, last_error, range_mode, since_date, until_date, since_time,
  until_time, months_ago, period, api_token, account_id, client_logo
)
SELECT id, name, report_type, zone_id, zone_name, days, tz_offset, frequency,
  day_of_week, day_of_month, send_hour_utc, recipients, subject, message,
  is_poc, client_name, enabled, created_at, updated_at, last_run_at,
  last_status, last_error, range_mode, since_date, until_date, since_time,
  until_time, months_ago, period, api_token, account_id, client_logo
FROM schedules;
DROP TABLE schedules;
ALTER TABLE schedules_new RENAME TO schedules;
