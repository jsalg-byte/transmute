CREATE TABLE IF NOT EXISTS bodyweight_measurements (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  measured_at date NOT NULL,
  weight_kg numeric(6, 2) NOT NULL CHECK (weight_kg > 0 AND weight_kg < 1000),
  notes text,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT bodyweight_measurements_user_date_unique UNIQUE (user_id, measured_at)
);

CREATE INDEX IF NOT EXISTS bodyweight_measurements_user_idx
  ON bodyweight_measurements(user_id, measured_at DESC);

-- Extend goals table for exercise and tracking mode linkage
ALTER TABLE goals
  ADD COLUMN IF NOT EXISTS exercise_id uuid REFERENCES exercises(id) ON DELETE CASCADE,
  ADD COLUMN IF NOT EXISTS tracking_mode text CHECK (tracking_mode IS NULL OR tracking_mode IN ('reps', 'timed'));
