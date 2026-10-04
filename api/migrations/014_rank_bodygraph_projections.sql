-- Curated canonical exercise contributions and versioned personal rank
-- projections. A contribution is intentionally an exercise ID, never a
-- guessed muscle-group string supplied by a client.
CREATE TABLE IF NOT EXISTS exercise_muscle_contributions (
  exercise_id uuid NOT NULL REFERENCES exercises(id) ON DELETE CASCADE,
  muscle_group text NOT NULL,
  region_id text NOT NULL,
  body_side text NOT NULL CHECK (body_side IN ('front', 'back')),
  contribution_weight numeric NOT NULL CHECK (contribution_weight > 0 AND contribution_weight <= 1),
  PRIMARY KEY (exercise_id, muscle_group)
);

CREATE TABLE IF NOT EXISTS muscle_rank_snapshots (
  id uuid PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  muscle_group text NOT NULL,
  region_id text NOT NULL,
  body_side text NOT NULL CHECK (body_side IN ('front', 'back')),
  eligible_exercise_count integer NOT NULL,
  score numeric,
  tier text,
  previous_value numeric,
  delta_value numeric,
  evidence_exercise_ids uuid[] NOT NULL DEFAULT '{}',
  rule_version integer NOT NULL,
  is_current boolean NOT NULL DEFAULT true,
  calculated_at timestamptz NOT NULL DEFAULT now(),
  superseded_at timestamptz
);
CREATE UNIQUE INDEX IF NOT EXISTS muscle_rank_snapshots_current_unique
  ON muscle_rank_snapshots (user_id, muscle_group) WHERE is_current;
CREATE INDEX IF NOT EXISTS muscle_rank_snapshots_user_current_idx
  ON muscle_rank_snapshots (user_id, is_current, calculated_at DESC);

CREATE TABLE IF NOT EXISTS overall_rank_snapshots (
  id uuid PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  eligible_exercise_count integer NOT NULL,
  mapped_group_count integer NOT NULL,
  placement_eligible boolean NOT NULL,
  score numeric,
  tier text,
  previous_value numeric,
  delta_value numeric,
  evidence_exercise_ids uuid[] NOT NULL DEFAULT '{}',
  rule_version integer NOT NULL,
  is_current boolean NOT NULL DEFAULT true,
  calculated_at timestamptz NOT NULL DEFAULT now(),
  superseded_at timestamptz
);
CREATE UNIQUE INDEX IF NOT EXISTS overall_rank_snapshots_current_unique
  ON overall_rank_snapshots (user_id) WHERE is_current;
CREATE INDEX IF NOT EXISTS overall_rank_snapshots_user_history_idx
  ON overall_rank_snapshots (user_id, calculated_at DESC);
