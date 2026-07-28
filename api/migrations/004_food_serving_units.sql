-- Preserve the labeled serving unit for scanned foods. `serving_size_g` is
-- retained as the numeric reference amount so existing meal rows continue to
-- calculate correctly; the unit explains whether that amount is g, mL, a
-- bottle, a piece, or another label unit.

ALTER TABLE foods
  ADD COLUMN IF NOT EXISTS serving_size_text text;

ALTER TABLE foods
  ADD COLUMN IF NOT EXISTS serving_size_unit text NOT NULL DEFAULT 'g';

UPDATE foods
SET serving_size_unit = 'g'
WHERE serving_size_unit IS NULL OR btrim(serving_size_unit) = '';
