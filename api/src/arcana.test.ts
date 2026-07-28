import assert from 'node:assert/strict';
import test from 'node:test';

import { arcanaDefinitions, arcanaStages, resolvePermanentStage } from './arcana.js';

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
