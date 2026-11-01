// Ported from 2jfitnessapp frontend/src/lib/autoreg.js (commit b7d8e68). Behaviour unchanged.
export const EASY_RPE = 7;
export const GRIND_RPE = 9;
export const MIN_RATED = 2;

const num = (x: unknown): number | null => (typeof x === 'number' && Number.isFinite(x) ? x : null);

export interface EffortSet { done?: boolean; type?: string; rpe?: number; rir?: number }

/** RPE-scale effort of one set, or null when none was logged. RPE = 10 − RIR. */
export const setEffort = (s: EffortSet | null | undefined): number | null =>
  (num(s?.rpe) != null ? (s!.rpe as number) : num(s?.rir) != null ? 10 - (s!.rir as number) : null);

export function effortStats(sets: EffortSet[] | null | undefined): { effort: number | null; rated: number } {
  const e = (sets || []).filter(s => s && s.done && s.type !== 'warmup' && s.type !== 'drop').map(setEffort).filter((x): x is number => x != null);
  return { effort: e.length ? e.reduce((a, b) => a + b, 0) / e.length : null, rated: e.length };
}

export interface SessionSignal { ok: boolean; effort: number | null; rated: number }
export type EffortSignal = { kind: 'easy' | 'grind'; effort: number } | { kind: null; effort: null };

/** sessions: oldest first. Never decided by one session; mixed signals give no change. */
export function effortSignal(sessions: readonly SessionSignal[] | null | undefined): EffortSignal {
  const usable = (s: SessionSignal | undefined) => !!s && s.ok && s.rated >= MIN_RATED && s.effort != null;
  const last3 = (sessions || []).slice(-3);
  if (last3.length === 3 && last3.every(s => usable(s) && (s.effort as number) <= EASY_RPE)) return { kind: 'easy', effort: Math.max(...last3.map(s => s.effort as number)) };
  const last2 = (sessions || []).slice(-2);
  if (last2.length === 2 && last2.every(s => usable(s) && (s.effort as number) >= GRIND_RPE)) return { kind: 'grind', effort: Math.min(...last2.map(s => s.effort as number)) };
  return { kind: null, effort: null };
}
