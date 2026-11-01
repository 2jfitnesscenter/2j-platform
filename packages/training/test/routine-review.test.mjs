import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as RR from '../dist/routine-review.js';

// One logged session of routine r1 with a single bench exercise.
const session = (d, { w = 100, r = 5, feel, deload = false, excludeFromProgression = false } = {}) => ({
  d, start: 1, routineId: 'r1', excludeFromProgression,
  entries: [{ id: 'bench', ...(deload ? { target: { deload: true } } : {}), sets: [1, 2].map(() => ({ done: true, w, r, ...(feel ? { feel } : {}) })) }],
});
const base = { routines: [{ id: 'r1', name: 'Push' }] };

test('cycleStart: a manual start beats the derived one; a review restarts; the first workout starts a new routine', () => {
  const workouts = [session('2026-01-05')];
  assert.deepEqual(RR.cycleStart({ ...base, workouts }, { id: 'r1' }), { start: '2026-01-05', source: 'first', exclusive: false });
  assert.deepEqual(RR.cycleStart({ ...base, workouts, routineReviews: { r1: { reviewedAt: '2026-01-20' } } }, { id: 'r1' }),
    { start: '2026-01-20', source: 'reviewed', exclusive: true });
  assert.equal(RR.cycleStart({ ...base, workouts, routineReviews: { r1: { startOverride: '2026-01-10', reviewedAt: '2026-01-20' } } }, { id: 'r1' }).source, 'manual');
  assert.equal(RR.cycleStart({ routines: [{ id: 'r1' }], workouts: [] }, { id: 'r1' }), null);
});

test('cycleSessions: the deload week and excluded workouts are not evidence; the cycle start is exclusive once reviewed', () => {
  const S = { ...base, workouts: [
    session('2026-01-05'),
    session('2026-01-12', { deload: true }),
    session('2026-01-19', { excludeFromProgression: true }),
    session('2026-01-26'),
    session('2026-03-01'),
  ] };
  const cycle = { start: '2026-01-05', source: 'first', exclusive: false };
  assert.deepEqual(RR.cycleSessions(S, { id: 'r1' }, cycle, '2026-02-01').map(w => w.d), ['2026-01-05', '2026-01-26']);
  const reviewed = { start: '2026-01-05', source: 'reviewed', exclusive: true };
  assert.deepEqual(RR.cycleSessions(S, { id: 'r1' }, reviewed, '2026-02-01').map(w => w.d), ['2026-01-26']);
  assert.deepEqual(RR.cycleSessions(S, { id: 'r1' }, null, '2026-02-01'), []);
});

test('plateau: one stalled exercise alone is not a clear plateau; a second signal makes it clear', () => {
  const same = ['2026-01-05', '2026-01-12', '2026-01-19', '2026-01-26'].map(d => session(d));
  const stalled = RR.plateau(same);
  assert.deepEqual(stalled.stalled, ['bench']);
  assert.equal(stalled.clear, false);
  const hard = ['2026-01-05', '2026-01-12', '2026-01-19', '2026-01-26'].map(d => session(d, { feel: 'hard' }));
  const clear = RR.plateau(hard);
  assert.equal(clear.clear, true);
  assert.deepEqual(clear.reasons.map(r => r.code), ['stalled', 'hard']);
});

test('plateau: an exercise that keeps progressing is never stalled', () => {
  const rising = [100, 105, 110, 115].map((w, i) => session(`2026-01-${String(5 + 7 * i).padStart(2, '0')}`, { w }));
  assert.deepEqual(RR.plateau(rising).stalled, []);
  assert.equal(RR.plateau(rising).clear, false);
});

test('routineReviews: too few sessions is idle; week 5 is due; week 4 with a clear plateau is early', () => {
  const two = [session('2026-01-05'), session('2026-01-12')];
  assert.equal(RR.routineReviews({ ...base, workouts: two }, '2026-01-20')[0].status, 'idle');
  const three = [session('2026-01-05'), session('2026-01-12'), session('2026-01-19')];
  const due = RR.routineReviews({ ...base, workouts: three }, '2026-02-02')[0];
  assert.equal(due.status, 'due');
  assert.equal(due.week, 5);
  assert.deepEqual(due.reasons[0], { code: 'week', week: 5 });
  const four = ['2026-01-05', '2026-01-12', '2026-01-19', '2026-01-26'].map(d => session(d, { feel: 'hard' }));
  const early = RR.routineReviews({ ...base, workouts: four }, '2026-01-29')[0];
  assert.equal(early.week, 4);
  assert.equal(early.status, 'early');
  assert.equal(RR.pendingReviews({ ...base, workouts: four }, '2026-01-29').length, 1);
});

test('markReviewed and markProgramReviewed write only review records and reject unknown targets', () => {
  const S = { ...base, programs: [{ id: 'p1', status: 'active' }], activeProgramId: 'p1' };
  assert.equal(RR.markReviewed(S, 'nope', '2026-02-01', 'staff'), false);
  assert.equal(RR.markReviewed(S, 'r1', '2026-02-01', 'staff'), true);
  assert.deepEqual(S.routineReviews.r1, { reviewedAt: '2026-02-01', by: 'staff', n: 1 });
  assert.equal(RR.markProgramReviewed(S, 'p1', '2026-02-01', 'staff'), true);
  assert.equal(S.programReviews.p1.nextReviewAt, '2026-03-01');
  assert.equal(RR.markProgramReviewed(S, 'p1', 'bad-date', 'staff'), false);
});

test('setCycleDates: invalid dates and a review before the start are refused; null goes back to automatic', () => {
  const S = { ...base, workouts: [session('2026-01-05')] };
  assert.equal(RR.setCycleDates(S, 'r1', { start: 'soon' }, 'staff'), false);
  assert.equal(RR.setCycleDates(S, 'r1', { start: '2026-01-10', due: '2026-01-09' }, 'staff'), false);
  assert.equal(RR.setCycleDates(S, 'r1', { start: '2026-01-10' }, 'staff'), true);
  assert.equal(S.routineReviews.r1.manualBy, 'staff');
  assert.equal(RR.setCycleDates(S, 'r1', { start: null }, 'staff'), true);
  assert.equal(S.routineReviews, undefined);
});

test('setProgramCycleDates refuses a program that is not the active one', () => {
  const S = { programs: [{ id: 'p1', status: 'paused' }], activeProgramId: 'p1' };
  assert.equal(RR.setProgramCycleDates(S, 'p1', { due: '2026-03-01' }, 'staff'), false);
});
