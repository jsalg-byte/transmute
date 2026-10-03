import assert from 'node:assert/strict';
import test from 'node:test';

import { planDayExerciseUpdateSchema, workoutSetSchema } from './workout-tracking.js';

const exerciseId = '11111111-1111-4111-8111-111111111111';

test('set payload accepts reps or duration but never both or neither', () => {
  assert.equal(workoutSetSchema.safeParse({ exerciseId, reps: 8, weight: 20 }).success, true);
  assert.equal(workoutSetSchema.safeParse({ exerciseId, durationSeconds: 45 }).success, true);
  assert.equal(workoutSetSchema.safeParse({ exerciseId, reps: 8, durationSeconds: 45 }).success, false);
  assert.equal(workoutSetSchema.safeParse({ exerciseId }).success, false);
});

test('timed set durations and plan targets are constrained to a positive day-length range', () => {
  assert.equal(workoutSetSchema.safeParse({ exerciseId, durationSeconds: 0 }).success, false);
  assert.equal(workoutSetSchema.safeParse({ exerciseId, durationSeconds: 86_401 }).success, false);
  const base = { targetSets: 3, targetReps: 10, targetWeight: null };
  assert.equal(planDayExerciseUpdateSchema.safeParse({ ...base, trackingMode: 'timed', targetDurationSeconds: 60 }).success, true);
  assert.equal(planDayExerciseUpdateSchema.safeParse({ ...base, trackingMode: 'timed' }).success, false);
});
