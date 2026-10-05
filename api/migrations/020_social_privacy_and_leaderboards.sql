-- Migration 020: Social privacy preferences, activity events, and invitations

-- 1. Extend user_preferences with social and league opt-in flags
ALTER TABLE user_preferences 
  ADD COLUMN IF NOT EXISTS social_activity_opt_in boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS league_opt_in boolean NOT NULL DEFAULT false;

-- 2. Friend invitations (links / tokens that can be shared or revoked)
CREATE TABLE IF NOT EXISTS friend_invitations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token text NOT NULL UNIQUE,
  is_active boolean NOT NULL DEFAULT true,
  revoked_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS friend_invitations_token_idx ON friend_invitations (token) WHERE is_active;
CREATE INDEX IF NOT EXISTS friend_invitations_user_idx ON friend_invitations (user_id);

