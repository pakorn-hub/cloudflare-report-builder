-- Zero Trust report snapshots — normalized, non-sensitive KPI summary
-- persisted after every report generation (interactive + scheduled), used
-- to compute period-over-period deltas ("vs previous report") without
-- storing any raw customer data (no emails, IPs, domains, tokens).

CREATE TABLE IF NOT EXISTS zt_report_snapshots (
  id            TEXT PRIMARY KEY,   -- UUID
  account_id    TEXT NOT NULL,      -- 32-char hex Cloudflare account ID
  generated_at  TEXT NOT NULL,      -- ISO timestamp, matches meta.generatedAt
  since         TEXT NOT NULL,
  until         TEXT NOT NULL,
  days          INTEGER NOT NULL,
  summary_json  TEXT NOT NULL       -- JSON-serialized subset of ZeroTrustData.summary
);

CREATE INDEX IF NOT EXISTS idx_zt_snapshots_account
  ON zt_report_snapshots (account_id, generated_at DESC);
