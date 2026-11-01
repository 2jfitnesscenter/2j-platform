// Ported from 2jfitnessapp frontend/src/lib/onerm.js (commit b7d8e68). Behaviour unchanged.
import { countsForProgression } from './progression-policy.js';
import type { TrainingState, SetRecord, WorkoutRecord, TestRecord } from './training-state.js';

export const REP_CAP = 12;
export type Formula = 'epley' | 'brzycki' | 'lombardi';
export const FORMULAS: Record<Formula, (w: number, r: number) => number> = {
  epley: (w, r) => w * (1 + r / 30),
  brzycki: (w, r) => w * 36 / (37 - r),
  lombardi: (w, r) => w * Math.pow(r, 0.1),
};
export const DEFAULT_FORMULA: Formula = 'epley';

export function estimate1RM(w: unknown, r: unknown, formula: Formula = DEFAULT_FORMULA): number | null {
  const weight = Number(w);
  const reps = Number(r);
  if (!isFinite(weight) || !isFinite(reps)) return null;
  if (weight <= 0 || reps < 1) return null;
  if (reps > REP_CAP) return null;
  const fn = FORMULAS[formula] || FORMULAS[DEFAULT_FORMULA];
  const est = reps === 1 ? weight : fn(weight, Math.round(reps));
  if (!isFinite(est) || est <= 0) return null;
  return Math.round(est * 10) / 10;
}

export interface BestSet { est: number; w: number; r: number }

export function bestSetOf(entry: { sets?: SetRecord[] } | null | undefined, formula: Formula = DEFAULT_FORMULA): BestSet | null {
  let best: BestSet | null = null;
  (entry?.sets || []).forEach(s => {
    if (!s.done) return;
    const est = estimate1RM(s.w, s.r, formula);
    if (est !== null && (!best || est > best.est)) best = { est, w: Number(s.w), r: Math.round(Number(s.r)) };
  });
  return best;
}

export interface E1RMPoint { t: number; d?: string | undefined; y: number; w: number; r: number }

export function e1rmSeries(S: TrainingState, exId: string, formula: Formula = DEFAULT_FORMULA): E1RMPoint[] {
  const pts: E1RMPoint[] = [];
  (S.workouts || []).forEach((w: WorkoutRecord) => {
    if (!countsForProgression(w)) return;
    const entry = (w.entries || []).find(e => e.id === exId);
    if (!entry) return;
    const best = bestSetOf(entry, formula);
    if (best) pts.push({ t: w.start, d: w.d, y: best.est, w: best.w, r: best.r });
  });
  return pts;
}

export function best1RM(S: TrainingState, exId: string, formula: Formula = DEFAULT_FORMULA): (E1RMPoint & { est: number }) | null {
  let best: (E1RMPoint & { est: number }) | null = null;
  e1rmSeries(S, exId, formula).forEach(p => { if (!best || p.y > best.est) best = { est: p.y, w: p.w, r: p.r, d: p.d, t: p.t, y: p.y }; });
  return best;
}

export function is1RMRecord(S: TrainingState, exId: string, entry: { sets?: SetRecord[] }, formula: Formula = DEFAULT_FORMULA) {
  const now = bestSetOf(entry, formula);
  if (!now) return null;
  const prev = best1RM(S, exId, formula);
  return !prev || now.est > prev.est ? { ...now, prev: prev ? prev.est : 0 } : null;
}

export function oneRMTests(S: TrainingState, exId: string): TestRecord[] {
  return (S.tests || [])
    .filter(x => x.type === '1rm' && x.exId === exId)
    .sort((a, b) => ((a.d ?? '') < (b.d ?? '') ? 1 : (a.d ?? '') > (b.d ?? '') ? -1 : 0));
}

export function bestTestedOneRM(S: TrainingState, exId: string): TestRecord | null {
  const tests = oneRMTests(S, exId);
  return tests.length ? tests.reduce((a, b) => ((b.est1RM ?? -Infinity) > (a.est1RM ?? -Infinity) ? b : a)) : null;
}

export function bestKnownOneRM(S: TrainingState, exId: string, formula: Formula = DEFAULT_FORMULA): number | null {
  const a = best1RM(S, exId, formula);
  const b = bestTestedOneRM(S, exId);
  const av = a ? a.est : -Infinity;
  const bv = b?.est1RM ?? -Infinity;
  if (av === -Infinity && bv === -Infinity) return null;
  return av >= bv ? (a as { est: number }).est : (b as { est1RM: number }).est1RM;
}

const PCT_1RM_TABLE: ReadonlyArray<readonly [number, number]> = [[1, 1], [2, .95], [3, .92], [4, .89], [5, .87], [6, .85], [7, .83], [8, .8], [9, .77], [10, .75], [11, .72], [12, .7]];

export function pctForReps(reps: number, rir = 0): number {
  const effective = Math.max(1, Math.min(20, Number(reps) + Number(rir)));
  const last = PCT_1RM_TABLE[PCT_1RM_TABLE.length - 1]!;
  if (effective >= last[0]) return last[1];
  for (let i = 0; i < PCT_1RM_TABLE.length - 1; i++) {
    const [r0, p0] = PCT_1RM_TABLE[i]!, [r1, p1] = PCT_1RM_TABLE[i + 1]!;
    if (effective >= r0 && effective <= r1) return p0 + (p1 - p0) * (effective - r0) / (r1 - r0);
  }
  return PCT_1RM_TABLE[0]![1];
}
