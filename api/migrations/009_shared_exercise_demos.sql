-- Shared Calistree demonstrations are catalog defaults. Per-user overrides
-- remain authoritative and are resolved first by the API read models.
CREATE TABLE IF NOT EXISTS exercise_demo_defaults (
  exercise_id uuid PRIMARY KEY REFERENCES exercises(id) ON DELETE CASCADE,
  demo_url text NOT NULL,
  source_name text NOT NULL DEFAULT 'Calistree',
  source_url text,
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- Promote only the Calistree demos already chosen for Garou Cut. Do not copy
-- other users' arbitrary exercise overrides into the shared catalog.
INSERT INTO exercise_demo_defaults (exercise_id, demo_url, source_name, source_url, updated_at)
SELECT DISTINCT ON (e.id)
  e.id,
  ego.gif_url,
  'Calistree',
  CASE
    WHEN ego.source_name LIKE '{%' THEN (ego.source_name::jsonb ->> 'sourceUrl')
    ELSE NULL
  END,
  now()
FROM routines r
JOIN routine_days rd ON rd.routine_id = r.id
JOIN routine_day_exercises rde ON rde.routine_day_id = rd.id
JOIN exercises e ON e.id = rde.exercise_id
JOIN exercise_gif_overrides ego ON ego.exercise_id = e.id AND ego.user_id = r.user_id
WHERE lower(r.name) = lower('Garou Cut')
  AND (ego.source_name = 'Exercise catalog' OR ego.source_name LIKE '%calistree.app%')
ORDER BY e.id, ego.updated_at DESC
ON CONFLICT (exercise_id) DO NOTHING;

-- The exercise records are shared catalog entries. Arms is the library's
-- canonical selectable muscle group and includes the forearm region.
INSERT INTO exercises (id, name, category, muscle_group, created_by_user_id, created_at)
SELECT gen_random_uuid(), seed.name, 'strength', 'Arms', NULL, now()
FROM (VALUES ('Barbell Wrist Curl'), ('Barbell Reverse Curl')) AS seed(name)
WHERE NOT EXISTS (
  SELECT 1 FROM exercises existing WHERE lower(existing.name) = lower(seed.name)
);

-- Confirmed public demos for the four previously missing/non-Calistree
-- demonstrations, three corrected variants, and Barbell Wrist Curl.
INSERT INTO exercise_demo_defaults (exercise_id, demo_url, source_name, source_url, updated_at)
SELECT exercise.id, seed.demo_url, seed.source_name, seed.source_url, now()
FROM (VALUES
  ('Barbell Back Squat', 'https://firebasestorage.googleapis.com/v0/b/calistree.appspot.com/o/exerciseVideos%2Fe0h0%2Fe0h0-264.mp4?alt=media&token=17244462-88bf-432b-a455-7b6c7fc94784', 'Calistree', 'https://calistree.app/datasheet/back-squat-e0h0'),
  ('Dumbbell One-Arm Rows', 'https://firebasestorage.googleapis.com/v0/b/calistree.appspot.com/o/exerciseVideos%2Fe0dy%2Fe0dy-264.mp4?alt=media&token=3db100ae-d220-4cd8-ab49-9d4a1e7857e5', 'Calistree', 'https://calistree.app/datasheet/one-arm-bent-over-row-e0dy'),
  ('Dumbbell Rear Delt Flies', 'https://firebasestorage.googleapis.com/v0/b/calistree.appspot.com/o/exerciseVideos%2Fe153%2Fe153-264.mp4?alt=media&token=b81a1ffd-8c5e-40ff-9335-114ac7a2312d', 'Calistree', 'https://calistree.app/datasheet/seated-bent-over-dumbbell-rear-delt-fly-e153'),
  ('Reverse Crunch', 'https://firebasestorage.googleapis.com/v0/b/calistree.appspot.com/o/exerciseVideos%2Fe0ip%2Fe0ip-264.mp4?alt=media&token=bd64dae2-db3d-40ef-8700-0b652f810dac', 'Calistree', 'https://calistree.app/datasheet/tuck-reverse-crunch-e0ip'),
  ('Overhead Triceps Extension', 'https://firebasestorage.googleapis.com/v0/b/calistree.appspot.com/o/exerciseVideos%2Fe143%2Fe143-264.mp4?alt=media&token=e8ca63e9-8960-4771-b715-7558f80f9a9d', 'Calistree', 'https://calistree.app/datasheet/dumbbell-overhead-triceps-extension-e143'),
  ('EZ Bar Decline Close Grip Skull Crusher', 'https://firebasestorage.googleapis.com/v0/b/calistree.appspot.com/o/exerciseVideos%2Fe13m%2Fe13m-264.mp4?alt=media&token=db8baf72-454e-498d-9d82-847c259d1469', 'Calistree', 'https://calistree.app/datasheet/barbell-lying-triceps-extension-e13m'),
  ('Dumbbell Alternating Bicep Curl', 'https://firebasestorage.googleapis.com/v0/b/calistree.appspot.com/o/exerciseVideos%2Fe135%2Fe135-264.mp4?alt=media&token=b5ad3ced-9515-4275-89e2-36ee3e52190a', 'Calistree', 'https://calistree.app/datasheet/dumbbell-alternate-hammer-curl-e135'),
  ('Barbell Wrist Curl', 'https://firebasestorage.googleapis.com/v0/b/calistree.appspot.com/o/exerciseVideos%2Fe0j0%2Fe0j0-264.mp4?alt=media&token=c619bfa5-b273-4a81-9705-c4d6553cf78e', 'Calistree', 'https://calistree.app/datasheet/weighted-wrist-flexion-e0j0')
) AS seed(exercise_name, demo_url, source_name, source_url)
JOIN exercises exercise ON lower(exercise.name) = lower(seed.exercise_name)
ON CONFLICT (exercise_id) DO UPDATE SET
  demo_url = EXCLUDED.demo_url,
  source_name = EXCLUDED.source_name,
  source_url = EXCLUDED.source_url,
  updated_at = now();

-- Replace the same seven stale personal demos for the Garou Cut owner, since
-- personal overrides intentionally take precedence over catalog defaults.
INSERT INTO exercise_gif_overrides (id, user_id, exercise_id, gif_url, source_name, created_at, updated_at)
SELECT DISTINCT ON (routine.user_id, exercise.id)
  gen_random_uuid(), routine.user_id, exercise.id, seed.demo_url, 'Calistree', now(), now()
FROM routines routine
JOIN routine_days day ON day.routine_id = routine.id
JOIN routine_day_exercises entry ON entry.routine_day_id = day.id
JOIN exercises exercise ON exercise.id = entry.exercise_id
JOIN (VALUES
  ('Barbell Back Squat', 'https://firebasestorage.googleapis.com/v0/b/calistree.appspot.com/o/exerciseVideos%2Fe0h0%2Fe0h0-264.mp4?alt=media&token=17244462-88bf-432b-a455-7b6c7fc94784'),
  ('Dumbbell One-Arm Rows', 'https://firebasestorage.googleapis.com/v0/b/calistree.appspot.com/o/exerciseVideos%2Fe0dy%2Fe0dy-264.mp4?alt=media&token=3db100ae-d220-4cd8-ab49-9d4a1e7857e5'),
  ('Dumbbell Rear Delt Flies', 'https://firebasestorage.googleapis.com/v0/b/calistree.appspot.com/o/exerciseVideos%2Fe153%2Fe153-264.mp4?alt=media&token=b81a1ffd-8c5e-40ff-9335-114ac7a2312d'),
  ('Reverse Crunch', 'https://firebasestorage.googleapis.com/v0/b/calistree.appspot.com/o/exerciseVideos%2Fe0ip%2Fe0ip-264.mp4?alt=media&token=bd64dae2-db3d-40ef-8700-0b652f810dac'),
  ('Overhead Triceps Extension', 'https://firebasestorage.googleapis.com/v0/b/calistree.appspot.com/o/exerciseVideos%2Fe143%2Fe143-264.mp4?alt=media&token=e8ca63e9-8960-4771-b715-7558f80f9a9d'),
  ('EZ Bar Decline Close Grip Skull Crusher', 'https://firebasestorage.googleapis.com/v0/b/calistree.appspot.com/o/exerciseVideos%2Fe13m%2Fe13m-264.mp4?alt=media&token=db8baf72-454e-498d-9d82-847c259d1469'),
  ('Dumbbell Alternating Bicep Curl', 'https://firebasestorage.googleapis.com/v0/b/calistree.appspot.com/o/exerciseVideos%2Fe135%2Fe135-264.mp4?alt=media&token=b5ad3ced-9515-4275-89e2-36ee3e52190a')
) AS seed(exercise_name, demo_url) ON lower(exercise.name) = lower(seed.exercise_name)
WHERE lower(routine.name) = lower('Garou Cut')
ORDER BY routine.user_id, exercise.id
ON CONFLICT (user_id, exercise_id) DO UPDATE SET
  gif_url = EXCLUDED.gif_url,
  source_name = EXCLUDED.source_name,
  updated_at = now();
