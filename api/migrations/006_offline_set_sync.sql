-- Client-generated operation IDs make a retried set command idempotent within
-- its workout session. This protects a reconnecting mobile client from a
-- duplicate set when a response was lost after the original insert committed.

ALTER TABLE workout_sets
  ADD COLUMN IF NOT EXISTS client_operation_id uuid;

CREATE UNIQUE INDEX IF NOT EXISTS workout_sets_session_client_operation_unique
  ON workout_sets (session_id, client_operation_id)
  WHERE client_operation_id IS NOT NULL;
