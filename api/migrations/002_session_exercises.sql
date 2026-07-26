-- Add session-specific movements without changing the existing routine template.
-- This is additive and required by the active-session API endpoints.

CREATE TABLE IF NOT EXISTS session_exercises (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id uuid NOT NULL REFERENCES workout_sessions(id) ON DELETE CASCADE,
  exercise_id uuid NOT NULL REFERENCES exercises(id),
  sort_order integer NOT NULL DEFAULT 0,
  target_reps integer,
  target_weight numeric,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT session_exercises_session_exercise_unique UNIQUE (session_id, exercise_id)
);

CREATE INDEX IF NOT EXISTS session_exercises_session_order_idx
  ON session_exercises (session_id, sort_order);
