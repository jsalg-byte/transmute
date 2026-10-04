-- Distinguish an active freeform workout from the historical single-record
-- Quick Add path. Apply after 010 and inspect duplicate active rows first.
ALTER TABLE workout_sessions ADD COLUMN IF NOT EXISTS origin text;

UPDATE workout_sessions
SET origin = CASE
  WHEN routine_day_id IS NULL THEN 'quick_add'
  ELSE 'plan_day'
END
WHERE origin IS NULL;

ALTER TABLE workout_sessions ALTER COLUMN origin SET DEFAULT 'plan_day';
ALTER TABLE workout_sessions ALTER COLUMN origin SET NOT NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'workout_sessions_origin_check'
  ) THEN
    ALTER TABLE workout_sessions ADD CONSTRAINT workout_sessions_origin_check
      CHECK (origin IN ('plan_day', 'freeform', 'quick_add'));
  END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS workout_sessions_one_active_per_user_idx
  ON workout_sessions (user_id) WHERE status = 'active';
