-- Arcana is an additive personal-progression layer. Existing workout, meal,
-- and routine data remains the source of truth; these tables hold planning,
-- reflection, and durable achievement evidence.

CREATE TABLE IF NOT EXISTS recovery_checkins (
  id uuid PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  checked_on date NOT NULL,
  sleep_duration_minutes integer,
  sleep_quality smallint CHECK (sleep_quality BETWEEN 1 AND 5),
  energy smallint CHECK (energy BETWEEN 1 AND 5),
  soreness smallint CHECK (soreness BETWEEN 1 AND 5),
  stress smallint CHECK (stress BETWEEN 1 AND 5),
  pain_or_injury boolean NOT NULL DEFAULT false,
  note text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, checked_on)
);

CREATE TABLE IF NOT EXISTS nutrition_adherence_targets (
  user_id uuid PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  meal_days_per_week smallint NOT NULL DEFAULT 4 CHECK (meal_days_per_week BETWEEN 1 AND 7),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS training_blocks (
  id uuid PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  routine_id uuid REFERENCES routines(id) ON DELETE SET NULL,
  title text NOT NULL,
  primary_goal text,
  baseline_metric text,
  start_date date NOT NULL,
  end_date date NOT NULL,
  weekly_target smallint NOT NULL DEFAULT 2 CHECK (weekly_target BETWEEN 1 AND 7),
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('draft', 'active', 'completed', 'archived')),
  ended_reason text,
  replacement_block_id uuid REFERENCES training_blocks(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (end_date >= start_date)
);

CREATE TABLE IF NOT EXISTS training_block_sessions (
  id uuid PRIMARY KEY,
  block_id uuid NOT NULL REFERENCES training_blocks(id) ON DELETE CASCADE,
  routine_day_id uuid REFERENCES routine_days(id) ON DELETE SET NULL,
  scheduled_on date NOT NULL,
  status text NOT NULL DEFAULT 'planned' CHECK (status IN ('planned', 'completed', 'rescheduled', 'skipped', 'recovery')),
  completed_session_id uuid REFERENCES workout_sessions(id) ON DELETE SET NULL,
  rescheduled_from_id uuid REFERENCES training_block_sessions(id) ON DELETE SET NULL,
  is_deload boolean NOT NULL DEFAULT false,
  is_recovery_session boolean NOT NULL DEFAULT false,
  skip_reason text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS weekly_reviews (
  id uuid PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  block_id uuid REFERENCES training_blocks(id) ON DELETE SET NULL,
  period_start date NOT NULL,
  period_end date NOT NULL,
  what_worked text NOT NULL,
  what_did_not text,
  decision text NOT NULL,
  decision_reason text,
  affected_routine_id uuid REFERENCES routines(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (period_end >= period_start)
);

CREATE TABLE IF NOT EXISTS goals (
  id uuid PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  block_id uuid REFERENCES training_blocks(id) ON DELETE SET NULL,
  domain text NOT NULL,
  metric_type text NOT NULL,
  baseline_value numeric NOT NULL,
  target_value numeric NOT NULL,
  measurement_method text NOT NULL,
  target_date date NOT NULL,
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'completed', 'archived')),
  created_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz
);

CREATE TABLE IF NOT EXISTS goal_assessments (
  id uuid PRIMARY KEY,
  goal_id uuid NOT NULL REFERENCES goals(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  assessed_on date NOT NULL,
  value numeric NOT NULL,
  decision text,
  decision_reason text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS progression_events (
  id uuid PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  event_type text NOT NULL,
  source_type text NOT NULL,
  source_id uuid,
  source_revision text NOT NULL DEFAULT '1',
  occurred_at timestamptz NOT NULL DEFAULT now(),
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, event_type, source_type, source_id, source_revision)
);

CREATE TABLE IF NOT EXISTS user_arcana_states (
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  card_id text NOT NULL,
  rule_version integer NOT NULL,
  highest_stage smallint NOT NULL DEFAULT 0 CHECK (highest_stage BETWEEN 0 AND 4),
  stage_evidence jsonb NOT NULL DEFAULT '{}'::jsonb,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, card_id)
);

CREATE TABLE IF NOT EXISTS user_arcana_pins (
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  slot text NOT NULL CHECK (slot IN ('past', 'present', 'becoming')),
  card_id text NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, slot)
);

CREATE INDEX IF NOT EXISTS recovery_checkins_user_date_idx ON recovery_checkins (user_id, checked_on DESC);
CREATE INDEX IF NOT EXISTS training_blocks_user_dates_idx ON training_blocks (user_id, start_date DESC);
CREATE INDEX IF NOT EXISTS training_block_sessions_block_date_idx ON training_block_sessions (block_id, scheduled_on);
CREATE INDEX IF NOT EXISTS weekly_reviews_user_date_idx ON weekly_reviews (user_id, period_end DESC);
CREATE INDEX IF NOT EXISTS goals_user_status_idx ON goals (user_id, status, target_date);
CREATE INDEX IF NOT EXISTS goal_assessments_goal_date_idx ON goal_assessments (goal_id, assessed_on DESC);
CREATE INDEX IF NOT EXISTS progression_events_user_time_idx ON progression_events (user_id, occurred_at DESC);
