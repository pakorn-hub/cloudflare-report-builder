-- Scheduled report emails — configuration + run history.
-- Apply with: npx wrangler d1 migrations apply poc-report-schedules

CREATE TABLE IF NOT EXISTS schedules (
  id            TEXT PRIMARY KEY,               -- UUID
  name          TEXT NOT NULL,                 -- human label shown in the dashboard
  report_type   TEXT NOT NULL CHECK (report_type IN ('appsec', 'zero-trust')),
  zone_id       TEXT,                          -- 32-char hex; appsec only
  zone_name     TEXT,                          -- display name captured from the picker
  days          INTEGER NOT NULL DEFAULT 30,   -- report timeframe (1/3/5/7/14/30)
  tz_offset     INTEGER NOT NULL DEFAULT 0,    -- minutes, same convention as the UI form
  frequency     TEXT NOT NULL CHECK (frequency IN ('daily', 'weekly', 'monthly')),
  day_of_week   INTEGER,                       -- 0-6 (Sun-Sat); weekly only
  day_of_month  INTEGER,                       -- 1-28; monthly only (clamped to month end)
  send_hour_utc INTEGER NOT NULL DEFAULT 0 CHECK (send_hour_utc BETWEEN 0 AND 23),
  recipients    TEXT NOT NULL,                 -- JSON array of email addresses (max 50)
  subject       TEXT NOT NULL,
  message       TEXT NOT NULL DEFAULT '',      -- custom message rendered at the top of the email
  is_poc        INTEGER NOT NULL DEFAULT 1,
  client_name   TEXT,
  enabled       INTEGER NOT NULL DEFAULT 1,
  created_at    TEXT NOT NULL,
  updated_at    TEXT NOT NULL,
  last_run_at   TEXT,                          -- last scheduled (not manual) run
  last_status   TEXT,                          -- 'sending' | 'success' | 'error'
  last_error    TEXT
);

CREATE TABLE IF NOT EXISTS send_history (
  id           TEXT PRIMARY KEY,
  schedule_id  TEXT NOT NULL,
  started_at   TEXT NOT NULL,
  finished_at  TEXT,
  status       TEXT NOT NULL,                  -- 'success' | 'error'
  trigger      TEXT NOT NULL DEFAULT 'cron',  -- 'cron' | 'manual'
  error        TEXT,
  recipients   TEXT NOT NULL,                  -- JSON array
  message_id   TEXT                            -- Email Sending message id on success
);

CREATE INDEX IF NOT EXISTS idx_send_history_schedule
  ON send_history (schedule_id, started_at DESC);
