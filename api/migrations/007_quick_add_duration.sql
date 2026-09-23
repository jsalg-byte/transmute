-- Quick-add cardio entries keep their duration separately from reps/weight.
ALTER TABLE workout_sets
  ADD COLUMN IF NOT EXISTS duration_seconds integer;

ALTER TABLE workout_sets
  DROP CONSTRAINT IF EXISTS workout_sets_duration_seconds_check;

ALTER TABLE workout_sets
  ADD CONSTRAINT workout_sets_duration_seconds_check
  CHECK (duration_seconds IS NULL OR duration_seconds > 0);
