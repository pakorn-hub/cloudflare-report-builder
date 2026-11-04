-- 0013: per-schedule client logo (multi-customer branding)
--
-- The on-demand report renders the customer's logo on its cover from
-- ReportInput.clientLogo (a base64 data URI, ≤2MB, PNG/JPG/SVG/WebP).
-- Schedules had no logo, so scheduled emails/attachments lost the branding.
-- Stored as the same data URI; NULL = no logo.

ALTER TABLE schedules ADD COLUMN client_logo TEXT;
