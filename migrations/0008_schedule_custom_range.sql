-- 0008: custom date ranges + explicit month selection for schedules
--
-- range_mode gains a third value: "custom" — an explicit user-selected
-- period stored as local YYYY-MM-DD dates in since_date/until_date
-- (interpreted in the schedule's tz_offset at generation time).
-- calendar_month also becomes selectable further back via months_ago
-- (1 = last month, 2 = the month before, ... up to 12).

ALTER TABLE schedules ADD COLUMN since_date TEXT;
ALTER TABLE schedules ADD COLUMN until_date TEXT;
ALTER TABLE schedules ADD COLUMN months_ago INTEGER;
