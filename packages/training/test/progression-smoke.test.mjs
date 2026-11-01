import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as P from '../dist/progression.js';
import * as F from '../dist/fatigue.js';
import * as R from '../dist/routine-review.js';

test('progression: first session returns a baseline, no crash on empty state', () => {
  const p = P.nextPrescription({ workouts: [], unit: 'kg' }, { id: 'sq', reps: 5, weight: 60, sets: 3, mode: 'reps' }, null);
  assert.equal(p.kind, 'first');
});

test('fatigue and review are quiet on empty state', () => {
  assert.equal(F.fatigueState({ workouts: [] }, '2026-11-01').level, 'normal');
  assert.deepEqual(R.routineReviews({ routines: [], workouts: [] }, '2026-11-01'), []);
  assert.equal(F.readiness({ workouts: [] }, '2026-11-01'), null);
});
