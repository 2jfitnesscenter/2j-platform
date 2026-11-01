// Ported from 2jfitnessapp frontend/src/lib/history.js (commit b7d8e68). Pure helpers over the training state.
// External dependencies (catalogue, feature flags, formatter) come from ports.ts. Behaviour unchanged.
import { todayISO, isoOf, weekKey } from './format.js';
import { latestBodyWeight } from './bodyweight.js';
import { ports } from './ports.js';
import { dayPlanRoutineId, isMovedDayPlan, countsForProgression } from './progression-policy.js';
import type { ExerciseConfig, SetRecord, TrainingState, WorkoutRecord, WorkoutEntryRecord } from './training-state.js';

export type ExerciseMode = 'reps' | 'time' | 'cardio';

export function modeOf(cfg: { id?: string | undefined; mode?: string | undefined } | null | undefined): ExerciseMode {
  const m = cfg?.mode;
  if (m === 'reps' || m === 'time' || m === 'cardio') return m;
  return ports().isCardio(cfg?.id) ? 'cardio' : 'reps';
}
export const isTimed = (cfg: { id?: string | undefined; mode?: string | undefined } | null | undefined): boolean => modeOf(cfg) === 'time';

const fmtNum = (n: unknown): string => {
  const f = ports().formatter;
  return Number.isFinite(Number(n)) ? (Math.round(Number(n) * 10) / 10).toLocaleString(f.locale) : '—';
};

/** mm:ss for a work duration. */
export function fmtSec(sec: unknown): string {
  const n = Math.max(0, Math.round(Number(sec) || 0));
  return Math.floor(n / 60) + ':' + String(n % 60).padStart(2, '0');
}

export type EffortKind = 'rir' | 'rpe';
export const EFFORT: Record<EffortKind, { f: EffortKind; hd: string; step: number; min: number; max: number }> = {
  rir: { f: 'rir', hd: 'RIR', step: 0.5, min: 0, max: 10 },
  rpe: { f: 'rpe', hd: 'RPE', step: 0.5, min: 6, max: 10 },
};

export const EFFORT_FEEL: ReadonlyArray<{ rpe: number; emoji: string; label: string }> = [
  { rpe: 6, emoji: '🙂', label: 'Warmup / very easy (4+ reps in reserve)' },
  { rpe: 6.5, emoji: '🙂', label: 'Easy (about 4 reps in reserve)' },
  { rpe: 7, emoji: '😐', label: 'Moderate (3 reps in reserve)' },
  { rpe: 7.5, emoji: '😐', label: 'Getting harder (2-3 reps in reserve)' },
  { rpe: 8, emoji: '😬', label: 'Demanding (2 reps in reserve)' },
  { rpe: 8.5, emoji: '😟', label: 'You could have done 1-2 more reps' },
  { rpe: 9, emoji: '😣', label: 'Very hard (1 rep in reserve)' },
  { rpe: 9.5, emoji: '😫', label: 'Right at the limit (maybe 1 more with a spot)' },
  { rpe: 10, emoji: '🥵', label: 'Complete muscular failure (0 reps in reserve)' },
];

export function feelFor(kind: EffortKind, value: number | null | undefined) {
  if (value == null) return null;
  const rpe = kind === 'rpe' ? value : Math.max(6, Math.min(10, 10 - value));
  let best = EFFORT_FEEL[0]!;
  for (const f of EFFORT_FEEL) if (Math.abs(f.rpe - rpe) < Math.abs(best.rpe - rpe)) best = f;
  return best;
}

export function effortColor(rir: number | null | undefined): 'green' | 'amber' | 'red' | null {
  if (rir == null) return null;
  if (rir >= 3.5) return 'green';
  if (rir >= 1.5) return 'amber';
  return 'red';
}
export const EFFORT_COLOR_VAR = { green: 'var(--green)', amber: 'var(--yellow)', red: 'var(--red)' } as const;

/** One tap of an effort stepper. An unlogged effort never becomes a number from one stray tap. */
export function stepEffort(kind: EffortKind, cur: number | null | undefined, dir: number): number | null {
  const e = EFFORT[kind];
  if (!e) return cur ?? null;
  if (cur == null) return dir < 0 ? null : e.min;
  const n = Math.round((cur + dir * e.step) * 100) / 100;
  if (dir < 0 && n < e.min) return null;
  return dir > 0 ? Math.min(e.max, n) : Math.max(e.min, n);
}

export const capEffort = (kind: EffortKind, v: number | null | undefined): number | null | undefined =>
  (v == null || !EFFORT[kind] ? v : Math.min(EFFORT[kind].max, v));

/** Which effort scale the profile logs. An explicit 'none' wins over the legacy showRir flag. */
export const effortOf = (S: TrainingState | null | undefined): 'rir' | 'rpe' | 'none' => {
  if (S && !ports().uxOn(S, 'effort')) return 'none';
  const e = S?.effort;
  return e === 'none' || e === 'rir' || e === 'rpe' ? e : (S?.showRir ? 'rir' : 'none');
};

const effortTail = (s: SetRecord): string => {
  const k: EffortKind | null = s.rir != null ? 'rir' : s.rpe != null ? 'rpe' : null;
  return k ? ` (${EFFORT[k].hd} ${fmtNum(s[k])})` : '';
};

export function setLabel(id: string, s: SetRecord, cfg?: { id?: string | undefined; mode?: string | undefined } | null): string {
  const mode = modeOf(cfg || { id });
  if (mode === 'cardio') return `${s.min || 0} min @ ${fmtNum(s.speed || 0)} km/h`;
  if (mode === 'time') return fmtSec(s.sec) + (s.w && s.w > 0 ? ` · ${fmtNum(s.w)}` : '');
  return `${fmtNum(s.w || 0)}×${s.r || 0}` + effortTail(s);
}

export function defaultConfig(id: string, mode?: ExerciseMode): ExerciseConfig {
  const m = mode || modeOf({ id });
  if (m === 'cardio') return { id, sets: 1, min: 20, speed: 8, mode: 'cardio' };
  if (m === 'time') return { id, sets: 3, sec: 45, weight: 0, mode: 'time' };
  return { id, sets: 3, reps: 10, weight: 0, mode: 'reps' };
}

export const repsLabel = (cfg: ExerciseConfig): string | number | undefined =>
  cfg.targetRepsMin != null && cfg.targetRepsMax != null ? `${cfg.targetRepsMin}-${cfg.targetRepsMax}` : cfg.reps;

export function exLine(cfg: ExerciseConfig, unit: string): string {
  const mode = modeOf(cfg);
  const n = cfg.sets || 1;
  const load = cfg.weight ? ' · ' + fmtNum(cfg.weight) + ' ' + unit : '';
  if (mode === 'cardio') return `${n} × ${cfg.min || 20} min @ ${fmtNum(cfg.speed || 8)} km/h`;
  if (mode === 'time') return `${n} × ${fmtSec(cfg.sec || 45)}${load}`;
  return `${n} × ${repsLabel(cfg)}${load}`;
}

/** Drop superset ids that no longer have an adjacent partner. */
export function cleanupSg(ex: { sg?: string }[]): void {
  ex.forEach((e, i) => {
    if (e.sg && !(ex[i - 1]?.sg === e.sg || ex[i + 1]?.sg === e.sg)) delete e.sg;
  });
}

/** Warm-ups and drop sets are not comparable working sets. Failure sets stay in. */
export const workingSets = (sets: SetRecord[] | null | undefined): SetRecord[] =>
  (sets || []).filter(s => s.type !== 'warmup' && s.type !== 'drop');

export function workingLoadEvidence(sets: SetRecord[] | null | undefined) {
  const done = workingSets(sets).filter(s => s.done);
  const first = done[0];
  const effort = (s: SetRecord | undefined): number | null => s?.rpe ?? (s?.rir != null ? 10 - s.rir : null);
  const highEffort = done.some(s => s.feel === 'hard' || s.feel === 'fail' || (effort(s) ?? -Infinity) > 8);
  const e1 = effort(first);
  const supported = !!first && (first.feel === 'easy' || first.feel === 'good' || (e1 != null && e1 <= 8));
  return {
    first, weights: done.map(s => Number(s.w) || 0), weight: Number(first?.w) || 0, rpe: e1,
    highEffort, safeToIncrease: supported && !highEffort,
  };
}

export interface RecentEntry { d: string; sets: SetRecord[]; target: unknown }

/** Up to n past appearances of one exercise, most recent first. Uses the exact exercise id on record. */
export function recentEntriesFor(S: TrainingState, exId: string, n = 3): RecentEntry[] {
  const out: RecentEntry[] = [];
  const workouts = S.workouts || [];
  for (let i = workouts.length - 1; i >= 0 && out.length < n; i--) {
    const workout = workouts[i]!;
    if (!countsForProgression(workout)) continue;
    const en: WorkoutEntryRecord | undefined = (workout.entries || []).find(e => e.id === exId);
    if (!en) continue;
    const sets = workingSets(en.sets).filter(s => s.done);
    if (sets.length) out.push({ d: workout.d, sets, target: en.target || null });
  }
  return out;
}

export const lastEntryFor = (S: TrainingState, exId: string): RecentEntry | null => recentEntriesFor(S, exId, 1)[0] || null;

/** Inserts a workout by date. A backdated log must not look like the most recent session. Ties land after same-day entries. */
export function insertWorkoutSorted(workouts: WorkoutRecord[], w: WorkoutRecord): WorkoutRecord[] {
  const out = [...workouts];
  let i = out.length;
  while (i > 0 && out[i - 1]!.d > w.d) i--;
  out.splice(i, 0, w);
  return out;
}

export function bestWeightFor(S: TrainingState, exId: string): number {
  let best = 0;
  (S.workouts || []).forEach(w => {
    if (!countsForProgression(w)) return;
    (w.entries || []).forEach(e => {
      if (e.id === exId) {
        e.sets.forEach(s => { if (s.done && (s.w ?? 0) > best) best = s.w as number; });
        if (e.topW && e.topW > best) best = e.topW;
      }
    });
  });
  return best;
}

/** A cached weight sourced from an excluded session never seeds future progression. */
export function trackedWeightFor(S: TrainingState, exId: string) {
  const cached = S?.exWeights?.[exId];
  if (!cached) return null;
  if (cached.sourceWorkoutId) {
    const source = (S.workouts || []).find(w => w?.id === cached.sourceWorkoutId);
    if (source?.excludeFromProgression === true) return null;
  } else if ((S.workouts || []).some(w => w?.excludeFromProgression === true && (w.entries || []).some(e => e.id === exId))) return null;
  return cached;
}

/** The week in effect: an active program is the whole picture for its week; otherwise the flat week. */
export function activeWeek(S: TrainingState): Record<number, string | null> {
  const p = S.activeProgramId && (S.programs || []).find(x => x.id === S.activeProgramId);
  return p ? (p.week || {}) : (S.week || {});
}

export function effectiveRoutineId(S: TrainingState, iso: string): string | null {
  const ov = S.dayPlan?.[iso];
  if (ov === 'rest' || isMovedDayPlan(ov)) return null;
  const overrideId = dayPlanRoutineId(ov);
  if (overrideId && (S.routines || []).some(r => r.id === overrideId)) return overrideId;
  const wd = new Date(iso + 'T12:00:00').getDay();
  return activeWeek(S)[wd] || null;
}

export function effectiveRoutine(S: TrainingState, iso: string) {
  const id = effectiveRoutineId(S, iso);
  return id ? (S.routines || []).find(r => r.id === id) || null : null;
}

const roundToPlate = (w: number, unit: 'kg' | 'lb' | undefined): number => {
  const step = unit === 'lb' ? 5 : 2.5;
  return Math.round(w / step) * step;
};

/** Two ramp-up sets ahead of the working weight: 50%×8 then 75%×5. */
export function warmupSets(workingWeight: number, unit: 'kg' | 'lb' | undefined): SetRecord[] {
  if (!(workingWeight > 0)) return [
    { w: 0, r: 8, done: false, type: 'warmup' },
    { w: 0, r: 5, done: false, type: 'warmup' },
  ];
  return [
    { w: roundToPlate(workingWeight * 0.5, unit), r: 8, done: false, type: 'warmup' },
    { w: roundToPlate(workingWeight * 0.75, unit), r: 5, done: false, type: 'warmup' },
  ];
}

export function buildSets(S: TrainingState, cfg: ExerciseConfig): SetRecord[] {
  const last = S.showPreviousResults !== false ? lastEntryFor(S, cfg.id) : null;
  const n = Math.max(1, cfg.sets || 1);
  const mode = modeOf(cfg);
  const sets: SetRecord[] = [];
  const prevAt = (i: number) => (last ? (last.sets[i] || last.sets[last.sets.length - 1]) : null);

  if (mode === 'cardio') {
    for (let i = 0; i < n; i++) {
      const prev = prevAt(i);
      sets.push({ min: prev ? prev.min : (cfg.min || 20), speed: prev ? prev.speed : (cfg.speed || 8), done: false });
    }
    return sets;
  }
  if (mode === 'time') {
    for (let i = 0; i < n; i++) {
      const prev = prevAt(i);
      const carried = prev && (prev.sec ?? 0) > 0 ? prev : null;
      sets.push({ sec: carried ? carried.sec : (cfg.sec || 45), w: carried ? (carried.w || 0) : (cfg.weight || 0), done: false });
    }
    return sets;
  }
  const conf = S.showPreviousResults !== false ? trackedWeightFor(S, cfg.id) : null;
  for (let i = 0; i < n; i++) {
    const prev = prevAt(i);
    const usable = prev && (prev.r ?? 0) > 0 ? prev : null;
    const w = usable ? usable.w : (conf && (conf.w ?? 0) > 0 ? conf.w : cfg.weight);
    sets.push({ w, r: usable ? usable.r : cfg.reps, done: false });
  }
  const lastSet = sets[sets.length - 1];
  if (cfg.dropset && lastSet && (lastSet.w ?? 0) > 0) {
    sets.push({ w: roundToPlate((lastSet.w as number) * 0.8, S.unit), r: lastSet.r, done: false, type: 'drop' });
  }
  return S.warmupEnabled !== false ? [...warmupSets(sets[0]!.w as number, S.unit), ...sets] : sets;
}

export function swapEntryExercise<T extends { id: string }>(entries: T[], idx: number, newId: string): T[] {
  return entries.map((e, i) => (i !== idx ? e : { ...e, id: newId }));
}

export function workoutVolume(w: WorkoutRecord): number {
  let v = 0;
  (w.entries || []).forEach(e => e.sets.forEach(s => { if (s.done && s.type !== 'warmup') v += (s.w || 0) * (s.r || 0); }));
  return v;
}

export function setsDone(w: WorkoutRecord): number {
  let n = 0;
  (w.entries || []).forEach(e => e.sets.forEach(s => { if (s.done) n++; }));
  return n;
}

export function setsDoneActive(A: { entries: WorkoutEntryRecord[] } | null | undefined): number {
  let n = 0;
  if (A) A.entries.forEach(e => e.sets.forEach(s => { if (s.done) n++; }));
  return n;
}

/** Kept as the name callers use; the rule lives in bodyweight.ts. */
export const lastBW = latestBodyWeight;

/** Has the profile weighed in recently enough that a check-in would just be nagging? */
export function hasRecentWeighIn(S: TrainingState, days = 15): boolean {
  const bw = lastBW(S);
  if (!bw) return false;
  const today = new Date(todayISO() + 'T12:00:00');
  const last = new Date(bw.d + 'T12:00:00');
  return Math.round((today.getTime() - last.getTime()) / 86400000) <= days;
}

/** Group consecutive items sharing a superset id into units of indices. */
export function supersetUnits(items: { sg?: string }[]): number[][] {
  const units: number[][] = [];
  items.forEach((e, i) => {
    const prev = items[i - 1];
    if (i > 0 && e.sg && prev && prev.sg && e.sg === prev.sg) units[units.length - 1]!.push(i);
    else units.push([i]);
  });
  return units;
}

export function unitOf(units: number[][], idx: number): number[] {
  return units.find(u => u.includes(idx)) || [idx];
}

export function streakWeeks(S: TrainingState): number {
  const workouts = S.workouts || [];
  if (!workouts.length) return 0;
  const weeks = new Set(workouts.map(w => weekKey(w.d)));
  let streak = 0;
  const cur = new Date();
  for (let i = 0; i < 520; i++) {
    const wk = weekKey(isoOf(cur));
    if (weeks.has(wk)) streak++;
    else if (i > 0) break;
    cur.setDate(cur.getDate() - 7);
  }
  return streak;
}
