// Ported from 2jfitnessapp frontend/src/lib/bodyweight.js (commit b7d8e68). The one reader of body weight.
import type { BodyWeightRecord, TrainingState } from './training-state.js';

const ISO = /^\d{4}-\d{2}-\d{2}$/;
const valid = (e: unknown): e is BodyWeightRecord => !!e && typeof e === 'object' && ISO.test((e as BodyWeightRecord).d || '') && Number((e as BodyWeightRecord).w) > 0;
const stamp = (e: BodyWeightRecord) => (Number.isFinite(e.t) ? (e.t as number) : 0);

/** Valid readings, oldest first. Stored entries are returned as-is (never copied). */
export function orderedBodyWeightSeries(S: Pick<TrainingState, 'bodyweight'> | null | undefined): BodyWeightRecord[] {
  const list = Array.isArray(S?.bodyweight) ? S!.bodyweight!.filter(valid) : [];
  return list.map((e, i) => [e, i] as const)
    .sort(([a, i], [b, j]) => (a.d < b.d ? -1 : a.d > b.d ? 1 : stamp(a) - stamp(b) || i - j))
    .map(([e]) => e);
}

export function latestBodyWeight(S: Pick<TrainingState, 'bodyweight'> | null | undefined): BodyWeightRecord | null {
  const s = orderedBodyWeightSeries(S);
  return s.length ? s[s.length - 1]! : null;
}

/** The latest reading from an earlier day than the latest one. */
export function previousBodyWeight(S: Pick<TrainingState, 'bodyweight'> | null | undefined): BodyWeightRecord | null {
  const s = orderedBodyWeightSeries(S);
  if (s.length < 2) return null;
  const last = s[s.length - 1]!;
  for (let i = s.length - 2; i >= 0; i--) if (s[i]!.d < last.d) return s[i]!;
  return null;
}
