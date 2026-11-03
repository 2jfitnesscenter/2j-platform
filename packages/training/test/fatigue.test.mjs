import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as F from '../dist/fatigue.js';

const TODAY = '2026-02-03';
const session = (d, { feel, deload = false, excludeFromProgression = false } = {}) => ({
  d, start: 1, routineId: 'r1', excludeFromProgression,
  entries: [{ id: 'bench', ...(deload ? { target: { deload: true } } : {}), sets: [1, 2].map(() => ({ done: true, w: 100, r: 5, ...(feel ? { feel } : {}) })) }],
});
// Three nights of 5 h sleep, three check-ins with high fatigue and a 30 % recovery: three families of signals → HIGH.
const highFatigue = {
  sleep: [{ d: '2026-02-01', v: 300 }, { d: '2026-02-02', v: 300 }, { d: '2026-02-03', v: 300 }],
  checkins: [{ d: '2026-01-30', fatigue: 4 }, { d: '2026-01-31', fatigue: 5 }, { d: '2026-02-01', fatigue: 4 }],
};
const HIGH_CTX = { recovery: 30 };

test('recentSessions: the last 28 days, oldest first, without deload entries or excluded sessions', () => {
  const S = { workouts: [
    session('2025-12-01'),
    session('2026-01-20', { deload: true }),
    session('2026-01-25', { excludeFromProgression: true }),
    session('2026-01-28'),
    session('2026-01-10'),
  ] };
  assert.deepEqual(F.recentSessions(S, TODAY).map(w => w.d), ['2026-01-10', '2026-01-28']);
});

test('sleepHours: needs three nights in the last seven days and returns hours', () => {
  assert.equal(F.sleepHours({ sleep: [{ d: '2026-02-01', v: 420 }, { d: '2026-02-02', v: 420 }] }, TODAY), null);
  assert.equal(F.sleepHours({ sleep: [{ d: '2026-02-01', v: 420 }, { d: '2026-02-02', v: 420 }, { d: '2026-02-03', v: 420 }] }, TODAY), 7);
});

test('fatigueState: three families of repeated signals reach HIGH; a missing source is simply absent', () => {
  const f = F.fatigueState(highFatigue, TODAY, HIGH_CTX);
  assert.equal(f.level, 'high');
  assert.equal(f.points, 6);
  assert.deepEqual(f.families.sort(), ['recovery', 'sleep', 'wellbeing']);
  assert.equal(F.fatigueState(highFatigue, TODAY, { ...HIGH_CTX, checkins: false }).points, 4);
  assert.equal(F.fatigueState({}, TODAY).level, 'normal');
});

test('activeDeload: only inside [from, until)', () => {
  const S = { deload: { from: '2026-02-01', until: '2026-02-08' } };
  assert.ok(F.activeDeload(S, TODAY));
  assert.equal(F.activeDeload(S, '2026-02-08'), null);
  assert.equal(F.activeDeload({}, TODAY), null);
});

test('deloadProposal: only on HIGH fatigue, and not during the cooldown after a dismissal', () => {
  const p = F.deloadProposal(highFatigue, TODAY, HIGH_CTX);
  assert.equal(p.from, TODAY);
  assert.equal(p.until, '2026-02-10');
  assert.equal(p.rir, F.DELOAD_RIR);
  assert.equal(F.deloadProposal({}, TODAY), null);
  assert.equal(F.deloadProposal({ ...highFatigue, deloadDismissed: '2026-01-25' }, TODAY, HIGH_CTX), null);
  assert.ok(F.deloadProposal({ ...highFatigue, deloadDismissed: '2026-01-10' }, TODAY, HIGH_CTX));
});

test('applyDeload, keepPlan and cancelDeload write only the deload record', () => {
  const S = {};
  const proposal = F.deloadProposal(highFatigue, TODAY, HIGH_CTX);
  assert.equal(F.applyDeload(S, 'soon', proposal), false);
  assert.equal(F.applyDeload(S, TODAY, null), false);
  assert.equal(F.applyDeload(S, TODAY, proposal), true);
  assert.deepEqual(S.deload.why, proposal.signals.map(s => s.code));
  assert.equal(S.deload.until, '2026-02-10');
  assert.equal(F.cancelDeload(S, TODAY), true);
  assert.equal(S.deload, undefined);
  assert.equal(S.deloadDismissed, TODAY);
  assert.equal(F.cancelDeload(S, TODAY), false);
  assert.equal(F.keepPlan(S, 'soon'), false);
  assert.equal(F.keepPlan(S, '2026-02-04'), true);
  assert.equal(S.deloadDismissed, '2026-02-04');
});

test('readiness: nothing real means no reading; good sleep and recovery give push; high fatigue gives recover', () => {
  assert.equal(F.readiness({}, TODAY), null);
  const rested = { sleep: [{ d: '2026-02-01', v: 480 }, { d: '2026-02-02', v: 480 }, { d: '2026-02-03', v: 480 }] };
  const push = F.readiness(rested, TODAY, { recovery: 85 });
  assert.equal(push.state, 'push');
  assert.equal(push.score, 93);
  const recover = F.readiness(highFatigue, TODAY, HIGH_CTX);
  assert.equal(recover.state, 'recover');
  assert.equal(recover.level, 'high');
  assert.equal(recover.reasons[0].code, 'signal');
});
