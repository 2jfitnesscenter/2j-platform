import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as H from '../dist/history.js';
import { configureTrainingPorts } from '../dist/ports.js';

configureTrainingPorts({ isCardio: id => id === 'bike', uxOn: (_S, f) => f !== 'effort' ? true : true, formatter: { t: s => s, locale: 'en-GB' } });

const S = {
  unit: 'kg', warmupEnabled: false, showPreviousResults: true,
  routines: [{ id: 'r1' }],
  workouts: [
    { id: 'a', d: '2026-01-05', start: 1, entries: [{ id: 'sq', sets: [{ done: true, w: 100, r: 5 }] }] },
    { id: 'b', d: '2026-01-12', start: 2, excludeFromProgression: true, entries: [{ id: 'sq', sets: [{ done: true, w: 140, r: 1 }] }] },
  ],
  exWeights: {},
};

test('mode: explicit mode wins, otherwise catalogue decides', () => {
  assert.equal(H.modeOf({ id: 'bike' }), 'cardio');
  assert.equal(H.modeOf({ id: 'sq', mode: 'time' }), 'time');
  assert.equal(H.modeOf({ id: 'sq' }), 'reps');
});

test('buildSets carries the last counted session, not the excluded one', () => {
  const sets = H.buildSets(S, { id: 'sq', sets: 2, reps: 8, weight: 0, mode: 'reps' });
  assert.deepEqual(sets.map(s => [s.w, s.r]), [[100, 5], [100, 5]]);
});

test('buildSets drop set lands at 80% and warm-ups are added when enabled', () => {
  const sets = H.buildSets({ ...S, warmupEnabled: true, showPreviousResults: false }, { id: 'sq', sets: 1, reps: 5, weight: 100, dropset: true, mode: 'reps' });
  assert.equal(sets.filter(s => s.type === 'warmup').length, 2);
  assert.equal(sets.at(-1).type, 'drop');
  assert.equal(sets.at(-1).w, 80);
});

test('recent entries skip excluded sessions and keep order', () => {
  const r = H.recentEntriesFor(S, 'sq', 3);
  assert.equal(r.length, 1);
  assert.equal(r[0].d, '2026-01-05');
});

test('effort stepper: empty stays empty on down, starts at the floor on up', () => {
  assert.equal(H.stepEffort('rpe', null, 1), 6);
  assert.equal(H.stepEffort('rpe', null, -1), null);
  assert.equal(H.stepEffort('rpe', 6, -1), null);
  assert.equal(H.stepEffort('rir', 10, 1), 10);
});

test('effort colour bands follow RIR boundaries', () => {
  assert.equal(H.effortColor(4), 'green');
  assert.equal(H.effortColor(2), 'amber');
  assert.equal(H.effortColor(0), 'red');
  assert.equal(H.effortColor(null), null);
});

test('superset units group adjacent items sharing an sg id', () => {
  assert.deepEqual(H.supersetUnits([{ sg: 'x' }, { sg: 'x' }, {}, { sg: 'y' }]), [[0, 1], [2], [3]]);
});

test('insertWorkoutSorted places a backdated workout by date', () => {
  const out = H.insertWorkoutSorted([{ d: '2026-01-01', start: 1, id: '1' }, { d: '2026-02-01', start: 2, id: '2' }], { d: '2026-01-15', start: 3, id: '3' });
  assert.deepEqual(out.map(w => w.id), ['1', '3', '2']);
});

test('workoutVolume and setsDone ignore warm-ups and unfinished sets', () => {
  const w = { d: '2026-01-01', start: 1, entries: [{ id: 'x', sets: [{ done: true, type: 'warmup', w: 20, r: 10 }, { done: true, w: 50, r: 5 }, { done: false, w: 60, r: 5 }] }] };
  assert.equal(H.workoutVolume(w), 250);
  assert.equal(H.setsDone(w), 2);
});

test('effective routine: rest and moved-day markers resolve as designed', () => {
  const T = { routines: [{ id: 'r1' }], week: { 1: 'r1' }, dayPlan: { '2026-11-02': 'rest', '2026-11-03': 'moved:2026-11-04:r1' } };
  assert.equal(H.effectiveRoutineId(T, '2026-11-02'), null);
  assert.equal(H.effectiveRoutineId(T, '2026-11-03'), null);
  assert.equal(H.effectiveRoutineId(T, '2026-11-09'), 'r1');
});
