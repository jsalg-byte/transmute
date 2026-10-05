-- Migration 018: Daily Nutrition Targets
-- Adds user-configurable daily calorie and macro target history with effective dates

CREATE TABLE IF NOT EXISTS daily_nutrition_targets (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  calories_target INTEGER NOT NULL CHECK (calories_target > 0 AND calories_target <= 20000),
  protein_g_target NUMERIC(8,2) NOT NULL DEFAULT 0 CHECK (protein_g_target >= 0 AND protein_g_target <= 1000),
  carbs_g_target NUMERIC(8,2) NOT NULL DEFAULT 0 CHECK (carbs_g_target >= 0 AND carbs_g_target <= 2000),
  fat_g_target NUMERIC(8,2) NOT NULL DEFAULT 0 CHECK (fat_g_target >= 0 AND fat_g_target <= 1000),
  effective_date DATE NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT uq_user_effective_date UNIQUE (user_id, effective_date)
);

CREATE INDEX IF NOT EXISTS idx_nutrition_targets_user_date ON daily_nutrition_targets(user_id, effective_date DESC);
