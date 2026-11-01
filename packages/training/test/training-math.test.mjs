import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as O from '../dist/onerm.js';
import * as R from '../dist/autoreg.js';
import * as B from '../dist/bodyweight.js';

test('estimate1RM: epley, single rep is the measurement, cap at 12 reps', () => {
  assert.equal(O.estimate1RM(100, 10), 133.3);
  assert.equal(O.estimate1RM(140, 1), 140);
  assert.equal(O.estimate1RM(100, 13), null);
  assert.equal(O.estimate1RM(0, 5), null);
  assert.equal(O.estimate1RM(100, 0), null);
});

test('best set and series ignore excluded workouts and unfinished sets', () => {
  const S = { workouts: [
    { start: 1, d: '2026-01-01', entries: [{ id: 'sq', sets: [{ done: true, w: 100, r: 5 }, { done: false, w: 200, r: 1 }] }] },
    { start: 2, d: '2026-01-08', excludeFromProgression: true, entries: [{ id: 'sq', sets: [{ done: true, w: 300, r: 1 }] }] },
  ] };
  assert.equal(O.best1RM(S, 'sq').est, 116.7);
  assert.equal(O.e1rmSeries(S, 'sq').length, 1);
});

test('bestKnownOneRM prefers the higher of workout estimate and tested max', () => {
  const S = { workouts: [], tests: [{ type: '1rm', exId: 'sq', d: '2026-02-01', est1RM: 150 }] };
  assert.equal(O.bestKnownOneRM(S, 'sq'), 150);
  assert.equal(O.bestKnownOneRM({ workouts: [], tests: [] }, 'sq'), null);
});

test('pctForReps interpolates the table and folds RIR into effective reps', () => {
  assert.equal(O.pctForReps(1), 1);
  assert.equal(O.pctForReps(12), 0.7);
  assert.equal(O.pctForReps(8, 0), 0.8);
  assert.ok(Math.abs(O.pctForReps(8, 1) - 0.77) < 1e-9);
});

test('effortSignal: three easy sessions go easy, two grinds go grind, mixed gives nothing', () => {
  const ok = (effort) => ({ ok: true, effort, rated: 2 });
  assert.equal(R.effortSignal([ok(6), ok(7), ok(6)]).kind, 'easy');
  assert.equal(R.effortSignal([ok(9), ok(9.5)]).kind, 'grind');
  assert.equal(R.effortSignal([ok(6), ok(9), ok(6)]).kind, null);
  assert.equal(R.effortSignal([{ ok: true, effort: 6, rated: 1 }, ok(6), ok(6)]).kind, null);
});

test('effortStats skips warm-ups and drops and converts RIR to RPE', () => {
  const s = R.effortStats([{ done: true, type: 'work', rir: 2 }, { done: true, type: 'warmup', rir: 8 }, { done: true, rpe: 8 }, { done: false, rpe: 10 }]);
  assert.deepEqual(s, { effort: 8, rated: 2 });
});

test('body weight: latest by day then timestamp, invalid entries ignored, previous from an earlier day', () => {
  const S = { bodyweight: [
    { d: '2026-03-02', w: 80, t: 5 }, { d: '2026-03-01', w: 81 }, { d: 'bad', w: 70 }, { d: '2026-03-02', w: 79.5, t: 9 }, { d: '2026-03-03', w: 0 },
  ] };
  assert.equal(B.latestBodyWeight(S).w, 79.5);
  assert.equal(B.previousBodyWeight(S).d, '2026-03-01');
  assert.equal(B.latestBodyWeight({}), null);
});
