import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseSetDraft } from '../src/training-module.tsx';

test('a set draft is accepted only with whole reps, a non-negative weight and an optional RIR within the API limits', () => {
  assert.deepEqual(parseSetDraft({ reps: '8', weight: '80,5', rir: '2' }), { reps: 8, weightKg: 80.5, rir: 2 });
  assert.deepEqual(parseSetDraft({ reps: '0', weight: '0', rir: '' }), { reps: 0, weightKg: 0, rir: null });
  assert.equal(parseSetDraft({ reps: '', weight: '80', rir: '' }), null);
  assert.equal(parseSetDraft({ reps: '8.5', weight: '80', rir: '' }), null);
  assert.equal(parseSetDraft({ reps: '101', weight: '80', rir: '' }), null);
  assert.equal(parseSetDraft({ reps: '8', weight: '-1', rir: '' }), null);
  assert.equal(parseSetDraft({ reps: '8', weight: '1001', rir: '' }), null);
  assert.equal(parseSetDraft({ reps: '8', weight: '80', rir: '11' }), null);
});

test('routine exercises: one per line, optional sets default to 3, invalid lines are rejected', async () => {
  const { parseRoutineExercises } = await import('../src/training-module.tsx');
  assert.deepEqual(parseRoutineExercises('Sentadilla\nPress banca | 4\n  Remo  |  2  '), [
    { exerciseName: 'Sentadilla', targetSets: 3 },
    { exerciseName: 'Press banca', targetSets: 4 },
    { exerciseName: 'Remo', targetSets: 2 },
  ]);
  assert.equal(parseRoutineExercises(''), null);
  assert.equal(parseRoutineExercises('Sentadilla | 0'), null);
  assert.equal(parseRoutineExercises('Sentadilla | 21'), null);
  assert.equal(parseRoutineExercises('Sentadilla | 2.5'), null);
  assert.equal(parseRoutineExercises(` | 3`), null);
});
