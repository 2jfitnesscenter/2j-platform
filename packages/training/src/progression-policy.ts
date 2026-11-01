// Ported from 2jfitnessapp frontend/src/lib/workout-policy.js and day-plan.js (commit b7d8e68).
export interface WorkoutLike { excludeFromProgression?: boolean }

/** A workout stays in history and attendance counts while being excluded from performance-derived guidance. */
export function countsForProgression(workout: WorkoutLike | null | undefined): boolean {
  return workout != null && workout.excludeFromProgression !== true;
}

export function progressionWorkouts<T extends WorkoutLike>(workouts: readonly T[] | null | undefined): T[] {
  return (Array.isArray(workouts) ? workouts : []).filter(countsForProgression);
}

export const movedDayValue = (target: string, routineId: string): string => `moved:${target}:${routineId}`;

export interface MovedDay { to: string; routineId: string }

export function parseMovedDay(value: unknown): MovedDay | null {
  const match = /^moved:(\d{4}-\d{2}-\d{2}):(.+)$/.exec(String(value || ''));
  return match ? { to: match[1]!, routineId: match[2]! } : null;
}

export function dayPlanRoutineId(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  return parseMovedDay(value)?.routineId || (value === 'rest' ? null : value || null);
}

export const isMovedDayPlan = (value: unknown): boolean => parseMovedDay(value) !== null;
