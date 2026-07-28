import assert from 'node:assert/strict';
import test from 'node:test';

import { arcanaDefinitions, arcanaStages, resolvePermanentStage, stageFor } from './arcana.js';

test('Arcana release contains the selected fifteen-card collection', () => {
  assert.equal(arcanaDefinitions.length, 15);
  assert.deepEqual(arcanaDefinitions.map((card) => card.id), [
    'fool', 'magician', 'emperor', 'chariot', 'strength', 'hermit', 'justice',
    'hanged-man', 'death', 'temperance', 'tower', 'star', 'sun', 'judgement', 'world',
  ]);
  assert.deepEqual(arcanaStages, ['unrevealed', 'revealed', 'refined', 'illuminated', 'mastered']);
});

test('an earned Arcana stage never regresses when current eligibility changes', () => {
  assert.equal(resolvePermanentStage(3, 1), 3);
  assert.equal(resolvePermanentStage(4, 0), 4);
  assert.equal(resolvePermanentStage(1, 2), 2);
});

test('later thresholds cannot skip an earlier Arcana stage', () => {
  assert.equal(stageFor([true, false, true, true]), 1);
  assert.equal(stageFor([true, true, true, true]), 4);
});
