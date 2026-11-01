import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import * as P from '../dist/progression.js';
import { configureTrainingPorts } from '../dist/ports.js';

// Catalogue facts the progression rules read: body part (load step), equipment (realizable loads), cardio and availability.
const CATALOGUE = {
  sq: { bp: 'upper legs', eq: 'barbell' },
  bench: { bp: 'chest', eq: 'barbell' },
  pu: { bp: 'chest', eq: 'body weight' },
  run: { bp: 'cardio', eq: 'treadmill' },
};
before(() => {
  configureTrainingPorts({
    isCardio: id => id === 'run',
    exercise: id => (id ? CATALOGUE[id] : undefined),
    isUnavailable: id => id === 'gone',
  });
});

// One logged session of routine r1 with a single bench entry planned at 3 × 5 @ 100.
const sets = rows => rows.map(([w, r]) => ({ done: true, w, r }));
const session = (d, rows, { id = 'bench', target = { sets: 3, reps: 5, weight: 100 }, excludeFromProgression = false } = {}) => ({
  id: 'w' + d, d, start: 1, routineId: 'r1', excludeFromProgression,
  entries: [{ id, target, sets: sets(rows) }],
});
const OK = [[100, 5], [100, 5], [100, 5]];
const MISS = [[100, 3], [100, 3], [100, 2]];
const bench = { id: 'bench', sets: 3, reps: 5, weight: 100, mode: 'reps' };
const routine = { id: 'r1', name: 'Push', prog: 'linear', ex: [bench] };

test('defaultIncrement: lower-body lifts take the bigger step, in kg or lb', () => {
  assert.equal(P.defaultIncrement('sq', 'kg'), 5);
  assert.equal(P.defaultIncrement('sq', 'lb'), 10);
  assert.equal(P.defaultIncrement('bench', 'kg'), 2.5);
  assert.equal(P.defaultIncrement('unknown', 'lb'), 5);
});

test('policyFor: the exercise override wins, a routine policy only applies where it is allowed', () => {
  assert.equal(P.policyFor({ id: 'bench' }, { prog: 'double' }, 'reps'), 'double');
  assert.equal(P.policyFor({ id: 'bench', prog: 'time' }, { prog: 'linear' }, 'reps'), 'off');
  assert.equal(P.policyFor({ id: 'run' }, { prog: 'linear' }, 'cardio'), 'cardio');
  assert.equal(P.policyFor({ id: 'bench' }, { prog: 'linear' }, 'time'), 'off');
});

test('readSession: a set below its target reps is a miss; a session at target is a hit', () => {
  const miss = P.readSession(session('2026-01-05', MISS).entries[0], bench);
  assert.deepEqual(miss.reps, [3, 3, 2]);
  assert.equal(miss.low, 2);
  assert.equal(miss.ok, false);
  assert.equal(P.readSession(session('2026-01-05', OK).entries[0], bench).ok, true);
});

test('sessionsFor leaves out excluded workouts and deload-week entries', () => {
  const S = { workouts: [
    session('2026-01-05', OK),
    session('2026-01-12', OK, { excludeFromProgression: true }),
    session('2026-01-19', OK, { target: { sets: 3, reps: 5, deload: true } }),
  ] };
  assert.deepEqual(P.sessionsFor(S, 'bench', bench).map(s => s.d), ['2026-01-05']);
});

test('stallCount counts the misses in a row, back from the latest session', () => {
  assert.equal(P.stallCount([{ ok: true }, { ok: false }, { ok: false }]), 2);
  assert.equal(P.stallCount([{ ok: false }, { ok: true }]), 0);
});

test('nextPrescription: no history starts a baseline; one clean session is not yet a safe increase', () => {
  assert.equal(P.nextPrescription({ unit: 'kg', workouts: [] }, bench, routine).kind, 'first');
  const held = P.nextPrescription({ unit: 'kg', workouts: [session('2026-01-05', OK), session('2026-01-12', OK)] }, bench, routine);
  assert.equal(held.kind, 'hold');
  assert.equal(held.weight, 100);
});

test('nextPrescription: three misses in a row reset the load by a deload and say why', () => {
  const S = { unit: 'kg', workouts: ['2026-01-05', '2026-01-12', '2026-01-19'].map(d => session(d, MISS)) };
  const p = P.nextPrescription(S, bench, routine);
  assert.equal(p.kind, 'deload');
  assert.equal(p.weight, 90);
  assert.equal(p.why[0], 'Missed reps {0} sessions running — reset to {1} {2} and work back up.');
});

test('a percentage policy with no tested 1RM does not prescribe a load', () => {
  const p = P.nextPrescription({ unit: 'kg', workouts: [], tests: [] }, { ...bench, prog: 'pct1rm' }, routine);
  assert.equal(p.policy, 'pct1rm');
  assert.equal(p.kind, 'off');
});

test('cardio: the completed time goes up by a minute and the target is written on the entry', () => {
  const cardio = { id: 'run', mode: 'cardio', min: 20, speed: 8 };
  const done = { id: 'run', d: '2026-01-05', start: 1, routineId: 'r1', entries: [{ id: 'run', target: { min: 20, speed: 8 }, sets: [{ done: true, min: 20, speed: 8 }] }] };
  const p = P.nextPrescription({ unit: 'kg', workouts: [done] }, cardio, { id: 'r1', prog: 'cardio' });
  assert.equal(p.kind, 'up');
  assert.equal(p.min, 21);
  assert.deepEqual(P.targetForPrescription(cardio, p), { id: 'run', mode: 'cardio', min: 21, speed: 8 });
});

test('applyPrescription touches only unlogged working sets: warm-ups and done sets keep their values', () => {
  const out = P.applyPrescription([{ w: 50, r: 8, type: 'warmup' }, { w: 100, r: 5, done: true }, { w: 100, r: 5 }], { kind: 'hold', weight: 105, reps: 6 });
  assert.deepEqual(out, [{ w: 50, r: 8, type: 'warmup' }, { w: 100, r: 5, done: true }, { w: 105, r: 6 }]);
  const first = [{ w: 100, r: 5 }];
  assert.equal(P.applyPrescription(first, { kind: 'first' }), first);
});

test('buildRoutineEntries leaves out withdrawn exercises and prescribes the rest', () => {
  const entries = P.buildRoutineEntries({ unit: 'kg', workouts: [] }, { id: 'r1', ex: [bench, { id: 'gone', sets: 2, reps: 8, weight: 20, mode: 'reps' }] });
  assert.deepEqual(entries.map(e => e.id), ['bench']);
  assert.equal(entries[0].plan.kind, 'first');
  assert.equal(entries[0].sets.filter(s => s.type === 'warmup').length, 2);
});

test('buildFreeEntry starts from the default configuration of a freestyle exercise', () => {
  const entry = P.buildFreeEntry({ unit: 'kg', workouts: [] }, 'pu');
  assert.equal(entry.target.reps, 10);
  assert.equal(entry.plan.kind, 'first');
  assert.ok(entry.sets.filter(s => !s.done).every(s => s.w === 0));
});

test('withDeload: during an accepted deload week the entry has fewer, lighter sets and is flagged; outside it nothing changes', () => {
  const S = { unit: 'kg', deload: { from: '2026-02-01', until: '2026-02-08', volumeCut: 0.35, loadCut: 0.075, rir: 3 } };
  const entry = { id: 'bench', target: { reps: 5 }, sets: [1, 2, 3, 4].map(() => ({ w: 100, r: 5 })) };
  const during = P.withDeload(S, entry, '2026-02-03');
  assert.equal(during.sets.length, 3);
  assert.ok(during.sets.every(s => s.w === 90));
  assert.equal(during.target.deload.rir, 3);
  assert.equal(during.plan.deload, true);
  assert.deepEqual(P.withDeload(S, entry, '2026-02-09'), entry);
});
