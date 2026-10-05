-- Migration 016: Progression ledger, user level snapshots, and reward claims

CREATE TABLE IF NOT EXISTS xp_ledger (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  source_type text NOT NULL, -- 'workout_session', 'workout_set', 'personal_record', 'tier_promotion', 'manual_adjustment'
  source_id uuid,
  rule_version integer NOT NULL DEFAULT 1,
  event_date date NOT NULL, -- training date in user timezone or UTC
  xp_amount integer NOT NULL, -- can be positive or negative for reversals
  reason text NOT NULL,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT xp_ledger_unique_source UNIQUE (user_id, source_type, source_id, rule_version)
);

CREATE INDEX IF NOT EXISTS xp_ledger_user_date_idx ON xp_ledger (user_id, event_date);
CREATE INDEX IF NOT EXISTS xp_ledger_user_created_idx ON xp_ledger (user_id, created_at DESC);

CREATE TABLE IF NOT EXISTS user_level_snapshots (
  user_id uuid PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  lifetime_xp integer NOT NULL DEFAULT 0,
  current_level integer NOT NULL DEFAULT 1,
  current_level_xp integer NOT NULL DEFAULT 0,
  next_level_threshold integer NOT NULL DEFAULT 100,
  xp_to_next_level integer NOT NULL DEFAULT 100,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS reward_claims (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  reward_id text NOT NULL, -- e.g. 'emblem_initiate', 'emblem_alchemist'
  claimed_at timestamptz NOT NULL DEFAULT now(),
  level_at_claim integer NOT NULL,
  CONSTRAINT reward_claims_user_reward_unique UNIQUE (user_id, reward_id)
);

CREATE INDEX IF NOT EXISTS reward_claims_user_idx ON reward_claims (user_id, claimed_at DESC);
