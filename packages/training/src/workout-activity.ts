// Ported from 2jfitnessapp frontend/src/lib/workout-activity.js (commit b7d8e68). Behaviour unchanged.
export const WORKOUT_INACTIVITY_MS = 60 * 60 * 1000;
export const INACTIVITY_FINISH_REASON = 'inactivity_timeout' as const;

export interface ActiveSetLike { done?: boolean; type?: string; w?: number; r?: number }
export interface ActiveEntryLike { id: string; sets: ActiveSetLike[]; target?: unknown; topW?: unknown }
export interface ActiveWorkout {
  id: string; d?: string; start: number; past?: boolean; routineId?: string; name?: string; bw?: number;
  entries: ActiveEntryLike[]; swaps?: unknown; cur?: unknown; guided?: unknown; guidedLog?: unknown;
  lastActivityAt?: number; src2j?: unknown; premium?: unknown;
}

/** Only workout edits and navigation count; clock ticks and polling do not. */
export function workoutActivityKey(active: ActiveWorkout | null | undefined): string | null {
  if (!active || active.past) return null;
  const { id, cur, entries, swaps, guided, guidedLog } = active;
  return JSON.stringify({ id, cur, entries, swaps, guided, guidedLog });
}

export function lastWorkoutActivity(active: ActiveWorkout | null | undefined): number | null {
  const value = active?.lastActivityAt ?? active?.start;
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : null;
}

export function workoutInactive(active: ActiveWorkout | null | undefined, now: number = Date.now()): boolean {
  const at = lastWorkoutActivity(active);
  return !!active && !active.past && at !== null && now - at >= WORKOUT_INACTIVITY_MS;
}

export function stampWorkoutActivity<T extends ActiveWorkout>(before: ActiveWorkout | null | undefined, after: T | null | undefined, now: number = Date.now()): T | null | undefined {
  if (!after || after.past) return after;
  if (workoutActivityKey(before) !== workoutActivityKey(after)) return { ...after, lastActivityAt: now };
  return { ...after, ...(before?.lastActivityAt ? { lastActivityAt: before.lastActivityAt } : {}) };
}

/** Legacy sessions have no reliable last-edit evidence and keep the normal end convention. */
export function inactivityFinishMetadata(active: ActiveWorkout, now: number = Date.now()) {
  const last = active.lastActivityAt;
  return {
    finishReason: INACTIVITY_FINISH_REASON, finishedAt: now,
    end: typeof last === 'number' && Number.isFinite(last) ? Math.max(active.start, Math.min(now, last)) : now,
  };
}

export interface FinishedWorkout {
  id: string; d?: string | undefined; start: number; end: number; routineId?: string | undefined; name?: string | undefined; bw?: number | undefined;
  entries: { id: string; sets: ActiveSetLike[]; target: unknown; topW: unknown }[];
  prs: never[]; src2j?: unknown; premium?: unknown; vol: number;
}

/** The existing Búnker finish payload, shared by kiosk and server sweep. */
export function buildFinishedWorkout(active: ActiveWorkout, end: number = Date.now()): FinishedWorkout {
  const entries = active.entries
    .map(e => ({ id: e.id, sets: e.sets, target: e.target, topW: e.topW || null }))
    .filter(e => e.sets.some(s => s.done));
  const vol = entries.reduce((n, e) => n + e.sets.reduce((v, s) => v + (s.done && s.type !== 'warmup' ? (s.w || 0) * (s.r || 0) : 0), 0), 0);
  return {
    id: active.id, d: active.d, start: active.start, end, routineId: active.routineId, name: active.name, bw: active.bw,
    entries, prs: [], vol,
    ...(active.src2j ? { src2j: active.src2j } : {}), ...(active.premium ? { premium: active.premium } : {}),
  };
}
