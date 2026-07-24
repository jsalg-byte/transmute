-- Run once against the existing Coolify Postgres database before deploying the API.
-- This is additive: it does not alter the existing users table or web application data.

CREATE TABLE IF NOT EXISTS mobile_sessions (
  id uuid PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  refresh_token_hash text NOT NULL UNIQUE,
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  revoked_at timestamptz
);

CREATE INDEX IF NOT EXISTS mobile_sessions_active_user_idx
  ON mobile_sessions (user_id, expires_at)
  WHERE revoked_at IS NULL;
