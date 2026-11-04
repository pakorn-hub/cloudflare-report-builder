-- Cloudflare native security alert investigation tracking (REST
-- /accounts/{id}/alerting/v3/history). This data was previously fetched
-- into ZeroTrustData.recentAlerts but never rendered anywhere in the report
-- — a dead dataset. Unlike zt_remediation_items / zt_casb_findings, alert
-- history entries are immutable point-in-time events (they don't "clear"
-- when re-fetched), so there is no auto-resolve here — status is purely an
-- operator-driven investigation workflow (new -> acknowledged ->
-- investigating -> resolved).

CREATE TABLE IF NOT EXISTS zt_alert_tracking (
  id            TEXT PRIMARY KEY,        -- UUID (internal tracking row id)
  account_id    TEXT NOT NULL,           -- 32-char hex Cloudflare account ID
  alert_id      TEXT NOT NULL,           -- Cloudflare's own alert history entry id
  name          TEXT NOT NULL,
  alert_type    TEXT NOT NULL,
  sent_at       TEXT NOT NULL,
  silenced      INTEGER NOT NULL DEFAULT 0,
  status        TEXT NOT NULL DEFAULT 'new', -- 'new' | 'acknowledged' | 'investigating' | 'resolved'
  owner_email   TEXT,
  due_date      TEXT,
  first_seen_at TEXT NOT NULL,           -- report generatedAt when first ingested
  updated_at    TEXT NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_zt_alert_tracking_alert_id
  ON zt_alert_tracking (account_id, alert_id);

CREATE INDEX IF NOT EXISTS idx_zt_alert_tracking_account
  ON zt_alert_tracking (account_id, sent_at DESC);
