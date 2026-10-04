-- Versioned, personal per-exercise strength projections. Values are canonical
-- kilograms, repetitions, or seconds; UI unit selection never changes them.
CREATE TABLE IF NOT EXISTS exercise_rank_snapshots (
  id uuid PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  exercise_id uuid NOT NULL REFERENCES exercises(id) ON DELETE CASCADE,
  tracking_mode text NOT NULL CHECK (tracking_mode IN ('reps', 'timed')),
  metric text NOT NULL CHECK (metric IN ('estimated_1rm_kg', 'max_reps', 'max_duration_seconds')),
  baseline_value numeric,
  best_value numeric,
  tier text,
  subdivision smallint,
  progress_points smallint,
  next_threshold numeric,
  evidence_session_ids uuid[] NOT NULL DEFAULT '{}',
  evidence_set_ids uuid[] NOT NULL DEFAULT '{}',
  rule_version integer NOT NULL,
  is_current boolean NOT NULL DEFAULT true,
  calculated_at timestamptz NOT NULL DEFAULT now(),
  superseded_at timestamptz
);

CREATE UNIQUE INDEX IF NOT EXISTS exercise_rank_snapshots_current_unique
  ON exercise_rank_snapshots (user_id, exercise_id, tracking_mode, metric)
  WHERE is_current;
CREATE INDEX IF NOT EXISTS exercise_rank_snapshots_user_current_idx
  ON exercise_rank_snapshots (user_id, is_current, calculated_at DESC);
CREATE INDEX IF NOT EXISTS workout_sessions_rank_completed_user_idx
  ON workout_sessions (user_id, ended_at DESC)
  WHERE status = 'completed';
CREATE INDEX IF NOT EXISTS workout_sets_rank_evidence_idx
  ON workout_sets (exercise_id, session_id)
  WHERE is_warmup = false;
