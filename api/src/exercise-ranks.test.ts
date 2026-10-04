import assert from 'node:assert/strict';
import test from 'node:test';

import { scoreExerciseRank } from './exercise-ranks.js';

test('exercise rank thresholds and progress are stable', () => {
  assert.deepEqual(scoreExerciseRank(100, 100), {
    ratio: 1,
    tier: 'Bronze',
    subdivision: 1,
    progress: 0,
    next: 105,
  });
  assert.equal(scoreExerciseRank(100, 115).tier, 'Gold');
  assert.equal(scoreExerciseRank(100, 150).tier, 'Transmuted');
  assert.equal(scoreExerciseRank(100, 150).progress, 100);
});
