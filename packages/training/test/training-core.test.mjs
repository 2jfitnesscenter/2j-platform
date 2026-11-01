import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as A from '../dist/workout-activity.js';
import * as P from '../dist/progression-policy.js';

const base = { id: 'w1', start: 1_000_000, entries: [{ id: 'e1', sets: [{ done: true, type: 'work', w: 50, r: 5 }, { done: false, w: 60, r: 5 }] }] };

test('inactivity fires only after one hour without edits', () => {
  const active = { ...base, lastActivityAt: 1_000_000 };
  assert.equal(A.workoutInactive(active, 1_000_000 + A.WORKOUT_INACTIVITY_MS - 1), false);
  assert.equal(A.workoutInactive(active, 1_000_000 + A.WORKOUT_INACTIVITY_MS), true);
  assert.equal(A.workoutInactive({ ...active, past: true }, 9e12), false);
});

test('stamping changes activity only when the editable state changes', () => {
  const before = { ...base, lastActivityAt: 5 };
  const same = A.stampWorkoutActivity(before, { ...base }, 99);
  assert.equal(same.lastActivityAt, 5);
  const changed = A.stampWorkoutActivity(before, { ...base, cur: 2 }, 99);
  assert.equal(changed.lastActivityAt, 99);
});

test('finish metadata caps the end at the last activity and keeps legacy sessions on now', () => {
  assert.equal(A.inactivityFinishMetadata({ ...base, lastActivityAt: 1_500_000 }, 9_000_000).end, 1_500_000);
  assert.equal(A.inactivityFinishMetadata(base, 9_000_000).end, 9_000_000);
  assert.equal(A.inactivityFinishMetadata(base, 9_000_000).finishReason, 'inactivity_timeout');
});

test('finished payload keeps only done sets and excludes warmups from volume', () => {
  const active = { ...base, entries: [{ id: 'e1', sets: [{ done: true, type: 'warmup', w: 20, r: 10 }, { done: true, type: 'work', w: 50, r: 5 }] }, { id: 'e2', sets: [{ done: false, w: 1, r: 1 }] }] };
  const w = A.buildFinishedWorkout(active, 2_000_000);
  assert.equal(w.entries.length, 1);
  assert.equal(w.vol, 250);
  assert.equal(w.end, 2_000_000);
});

test('progression excludes flagged workouts but keeps history', () => {
  const list = [{ id: 1 }, { id: 2, excludeFromProgression: true }, null];
  assert.deepEqual(P.progressionWorkouts(list), [{ id: 1 }]);
  assert.deepEqual(P.progressionWorkouts(undefined), []);
});

test('moved-day markers round-trip', () => {
  const v = P.movedDayValue('2026-11-05', 'r-42');
  assert.deepEqual(P.parseMovedDay(v), { to: '2026-11-05', routineId: 'r-42' });
  assert.equal(P.dayPlanRoutineId(v), 'r-42');
  assert.equal(P.dayPlanRoutineId('rest'), null);
  assert.equal(P.isMovedDayPlan('r-42'), false);
});
