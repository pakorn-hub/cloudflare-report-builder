-- CASB/Data-Security-Posture finding lifecycle tracking — the DLP/CASB
-- equivalent of zt_remediation_items, but keyed by Cloudflare's own finding
-- identity (REST /data-security/posture/findings `id`, or a stable
-- severity+type+resource composite when no id is returned) instead of a
-- fixed set of boolean conditions. Turns a point-in-time findings list into
-- an auditable register: age since first seen, investigation status, owner,
-- and whether Cloudflare itself still reports the finding as active.

CREATE TABLE IF NOT EXISTS zt_casb_findings (
  id             TEXT PRIMARY KEY,        -- UUID (internal tracking row id)
  account_id     TEXT NOT NULL,           -- 32-char hex Cloudflare account ID
  finding_id     TEXT NOT NULL,           -- Cloudflare finding id, or composite fallback key
  severity       TEXT NOT NULL,
  finding_type   TEXT NOT NULL,
  resource_name  TEXT NOT NULL,
  integration_id TEXT,
  status         TEXT NOT NULL DEFAULT 'open', -- 'open' | 'investigating' | 'remediated' | 'false_positive' | 'accepted_risk'
  owner_email    TEXT,
  due_date       TEXT,
  first_seen_at  TEXT NOT NULL,           -- report generatedAt when first detected
  last_seen_at   TEXT NOT NULL,           -- report generatedAt when Cloudflare most recently still reported it
  cleared_at     TEXT,                    -- set when Cloudflare stops reporting this finding (auto-detected)
  occurrences    INTEGER NOT NULL DEFAULT 1,
  updated_at     TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_zt_casb_findings_account
  ON zt_casb_findings (account_id, status, last_seen_at DESC);

CREATE INDEX IF NOT EXISTS idx_zt_casb_findings_lookup
  ON zt_casb_findings (account_id, finding_id);
