-- Zero Trust remediation register — lifecycle tracking for security findings
-- across report generations. Findings are derived from the same evidence-
-- based conditions already used for `recommendations` (e.g. "no MFA enforced",
-- "no DNS blocking policies"), keyed by a stable `finding_key` so the same
-- underlying issue is tracked (not re-created) across report runs — this is
-- what turns a point-in-time recommendation into an auditable QBR-style
-- remediation item with age, ownership, and status.
--
-- Non-sensitive: only counts/labels derived from already-aggregated summary
-- data, plus an operator-entered owner email/due date (not customer PII from
-- Cloudflare logs).

CREATE TABLE IF NOT EXISTS zt_remediation_items (
  id            TEXT PRIMARY KEY,        -- UUID
  account_id    TEXT NOT NULL,           -- 32-char hex Cloudflare account ID
  finding_key   TEXT NOT NULL,           -- stable identifier, e.g. "mfa-coverage"
  title         TEXT NOT NULL,
  description   TEXT NOT NULL,
  benefit       TEXT NOT NULL,
  severity      TEXT NOT NULL,           -- 'high' | 'medium' | 'low'
  status        TEXT NOT NULL DEFAULT 'open', -- 'open' | 'in_progress' | 'accepted_risk' | 'resolved'
  owner_email   TEXT,
  due_date      TEXT,
  evidence      TEXT NOT NULL,           -- latest evidence string (counts only)
  first_seen_at TEXT NOT NULL,           -- report generatedAt when first detected
  last_seen_at  TEXT NOT NULL,           -- report generatedAt when most recently still true
  resolved_at   TEXT,
  occurrences   INTEGER NOT NULL DEFAULT 1,
  updated_at    TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_zt_remediation_account
  ON zt_remediation_items (account_id, status, last_seen_at DESC);

CREATE INDEX IF NOT EXISTS idx_zt_remediation_lookup
  ON zt_remediation_items (account_id, finding_key, status);
