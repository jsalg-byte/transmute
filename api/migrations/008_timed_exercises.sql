-- Plans and active-session projections need to distinguish rep targets from
-- duration targets. Logged durations reuse workout_sets.duration_seconds from
-- migration 007; reps=1 remains the required database sentinel for timed sets.
ALTER TABLE routine_day_exercises
  ADD COLUMN IF NOT EXISTS tracking_mode text NOT NULL DEFAULT 'reps',
  ADD COLUMN IF NOT EXISTS target_duration_seconds integer;

ALTER TABLE routine_day_exercises
  DROP CONSTRAINT IF EXISTS routine_day_exercises_tracking_mode_check,
  DROP CONSTRAINT IF EXISTS routine_day_exercises_target_duration_seconds_check;

ALTER TABLE routine_day_exercises
  ADD CONSTRAINT routine_day_exercises_tracking_mode_check
    CHECK (tracking_mode IN ('reps', 'timed')),
  ADD CONSTRAINT routine_day_exercises_target_duration_seconds_check
    CHECK (target_duration_seconds IS NULL OR target_duration_seconds BETWEEN 1 AND 86400);

ALTER TABLE session_exercises
  ADD COLUMN IF NOT EXISTS tracking_mode text NOT NULL DEFAULT 'reps',
  ADD COLUMN IF NOT EXISTS target_duration_seconds integer;

ALTER TABLE session_exercises
  DROP CONSTRAINT IF EXISTS session_exercises_tracking_mode_check,
  DROP CONSTRAINT IF EXISTS session_exercises_target_duration_seconds_check;

ALTER TABLE session_exercises
  ADD CONSTRAINT session_exercises_tracking_mode_check
    CHECK (tracking_mode IN ('reps', 'timed')),
  ADD CONSTRAINT session_exercises_target_duration_seconds_check
    CHECK (target_duration_seconds IS NULL OR target_duration_seconds BETWEEN 1 AND 86400);
