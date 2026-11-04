-- Dashboard-managed backend settings (Settings page in the scheduled
-- reports dashboard). Values here override the Worker's env secret/var
-- fallbacks (CF_API_TOKEN / CF_ACCOUNT_ID / EMAIL_FROM).
--
-- NOTE: the API token is stored here in plaintext. The dashboard is normally
-- behind Cloudflare Access, but the Worker's workers.dev hostname is
-- publicly reachable — protect the settings routes if that matters to you.

CREATE TABLE IF NOT EXISTS settings (
  key        TEXT PRIMARY KEY,   -- 'cf_api_token' | 'cf_account_id' | 'email_from'
  value      TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
