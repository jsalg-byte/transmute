-- The reverse-curl demo is bundled by Flutter so it does not depend on a
-- third-party media host allowing hotlinks. Flutter resolves `asset://` values
-- using its packaged asset bundle on web and native platforms.
INSERT INTO exercise_demo_defaults (exercise_id, demo_url, source_name, source_url, updated_at)
SELECT exercise.id, 'asset://assets/reverse_curl.webm', 'Transmute', NULL, now()
FROM exercises exercise
WHERE lower(exercise.name) = lower('Barbell Reverse Curl')
ON CONFLICT (exercise_id) DO UPDATE SET
  demo_url = EXCLUDED.demo_url,
  source_name = EXCLUDED.source_name,
  source_url = EXCLUDED.source_url,
  updated_at = now();
