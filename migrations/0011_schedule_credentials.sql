-- 0011: per-schedule Cloudflare credentials (multi-customer operation)
--
-- A schedule may carry its own API token + account ID so one deployment can
-- report on many customers, each with credentials scoped to their account.
-- NULL = fall back to the backend settings (D1 `settings` → Worker env).
-- The token is write-only through the API (masked to a hint on read) and
-- is resolved at send time in the scheduler.

ALTER TABLE schedules ADD COLUMN api_token TEXT;
ALTER TABLE schedules ADD COLUMN account_id TEXT;
