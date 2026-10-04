-- Immutable, token-addressable routine prescriptions.  These snapshots never
-- include workout sessions, sets, goals, or account preferences.
CREATE TABLE IF NOT EXISTS routine_share_snapshots (
  id uuid PRIMARY KEY,
  token text NOT NULL UNIQUE,
  owner_user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  routine_id uuid NOT NULL,
  routine_day_id uuid NOT NULL,
  snapshot jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  revoked_at timestamptz
);

CREATE INDEX IF NOT EXISTS routine_share_snapshots_owner_day_idx
  ON routine_share_snapshots (owner_user_id, routine_day_id, created_at DESC);

CREATE INDEX IF NOT EXISTS routine_share_snapshots_token_active_idx
  ON routine_share_snapshots (token)
  WHERE revoked_at IS NULL;

-- Keep the imported routine's source attribution even after the publisher
-- edits their source routine.  Share rows are revoked, never deleted by the
-- normal flow, so history can continue to name its provenance.
ALTER TABLE routine_days
  ADD COLUMN IF NOT EXISTS imported_from_share_id uuid
  REFERENCES routine_share_snapshots(id);
