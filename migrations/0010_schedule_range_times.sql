-- 0010: intra-day bounds for custom-range schedules
--
-- Custom ranges (0008/0009) are whole days. This adds optional HH:MM
-- bounds so a schedule can cover e.g. "Sep 1 09:00 → Sep 3 17:30" local.
-- NULL = whole-day semantics (00:00 → 23:59), which keeps every existing
-- row's meaning unchanged.

ALTER TABLE schedules ADD COLUMN since_time TEXT;
ALTER TABLE schedules ADD COLUMN until_time TEXT;
