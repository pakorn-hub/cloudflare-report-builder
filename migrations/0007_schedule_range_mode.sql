-- Adds a "calendar month" report-range option alongside the existing
-- fixed-day rolling windows (1/3/5/7/14/30). A rolling "30 days" window
-- doesn't line up with any real calendar month (28/29/30/31 days), so a
-- monthly-frequency schedule using days=30 silently drifts and never
-- reports exactly "last month" — e.g. it would include a few days of the
-- month before, or miss the last day or two of a 31-day month.
--
-- range_mode = 'rolling'        -> existing behavior: `days` back from now.
-- range_mode = 'calendar_month' -> the previous full calendar month,
--                                   computed at generation time from the
--                                   schedule's tz_offset (`days` is stored
--                                   but ignored for the actual date-range
--                                   math in this mode).

ALTER TABLE schedules ADD COLUMN range_mode TEXT NOT NULL DEFAULT 'rolling'
  CHECK (range_mode IN ('rolling', 'calendar_month'));
