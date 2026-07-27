-- Optional target durations for active and completed fasts.
-- Existing rows remain valid open-ended fasts.

ALTER TABLE active_fasts
  ADD COLUMN IF NOT EXISTS target_minutes integer;

ALTER TABLE fasting_logs
  ADD COLUMN IF NOT EXISTS target_minutes integer;

CREATE INDEX IF NOT EXISTS fasting_logs_user_ended_at_idx
  ON fasting_logs (user_id, ended_at DESC);
