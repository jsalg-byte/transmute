-- Migration 017: Training calendar qualified days, streaks, and user timezone
ALTER TABLE user_preferences ADD COLUMN IF NOT EXISTS timezone text NOT NULL DEFAULT 'UTC';

CREATE TABLE IF NOT EXISTS qualified_training_days (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  training_date date NOT NULL,
  session_id uuid NOT NULL REFERENCES workout_sessions(id) ON DELETE CASCADE,
  timezone_at_completion text NOT NULL DEFAULT 'UTC',
  working_set_count integer NOT NULL,
  completed_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT qualified_training_days_user_date_unique UNIQUE (user_id, training_date)
);

CREATE INDEX IF NOT EXISTS qualified_training_days_user_date_idx ON qualified_training_days (user_id, training_date DESC);

CREATE TABLE IF NOT EXISTS user_streak_snapshots (
  user_id uuid PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  current_streak integer NOT NULL DEFAULT 0,
  best_streak integer NOT NULL DEFAULT 0,
  last_qualified_date date,
  updated_at timestamptz NOT NULL DEFAULT now()
);
