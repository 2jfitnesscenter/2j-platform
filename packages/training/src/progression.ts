// Ported from 2jfitnessapp frontend/src/lib/progression.js (commit b7d8e68). Behaviour unchanged.
// Automatic progression: a pure function of the workout history. Nothing writes back into a finished workout.
// Catalogue lookups (body part, equipment, availability) come from ports.ts.
import { modeOf, workingSets, workingLoadEvidence, buildSets, cleanupSg, defaultConfig, type ExerciseMode } from './history.js';
import { ports } from './ports.js';
import { bestTestedOneRM, pctForReps } from './onerm.js';
import { realizableToward, stepWeight } from './equipment.js';
import { effortStats, effortSignal } from './autoreg.js';
import { activeDeload } from './fatigue.js';
import { todayISO } from './format.js';
import { countsForProgression } from './progression-policy.js';
/* eslint-disable @typescript-eslint/no-explicit-any */
type Obj = Record<string, any>;

export const POLICIES = ['off', 'linear', 'greyskull', 'double', 'pct1rm', 'time'] as const;
export type Policy = typeof POLICIES[number] | 'cardio';

export const POLICIES_FOR: Record<ExerciseMode, Policy[]> = {
  reps: ['off', 'linear', 'greyskull', 'double', 'pct1rm'],
  time: ['off', 'time'],
  cardio: ['off', 'cardio'],
};

export const POLICY_NAME: Record<Policy, string> = {
  off: 'No automatic progression', linear: 'Linear progression', greyskull: 'Greyskull LP', double: 'Double progression',
  pct1rm: '% of your tested 1RM', time: 'Add time', cardio: 'Cardio progression',
};

export const DELOAD_AFTER: Partial<Record<Policy, number>> = { linear: 3, greyskull: 1, double: 3, time: 3 };
const DELOAD_FACTOR = 0.9;
const HEAVY_BP = ['upper legs', 'lower legs', 'back', 'hips', 'glutes'];

/** Default load step. Lower-body lifts take the bigger jump. */
export function defaultIncrement(exId: string, unit: string): number {
  const ex = ports().exercise(exId);
  const heavy = !!ex && HEAVY_BP.includes(ex.bp ?? '');
  if (unit === 'lb') return heavy ? 10 : 5;
  return heavy ? 5 : 2.5;
}
export const DEFAULT_SEC_INCREMENT = 5;

/** The policy in force for one exercise: its override, else the routine's default, else the mode's default. */
export function policyFor(cfg: Obj | null | undefined, routine: Obj | null | undefined, mode?: ExerciseMode): Policy {
  const m: ExerciseMode = mode || modeOf(cfg || {});
  const allowed = POLICIES_FOR[m] || ['off'];
  const pick = cfg?.prog || (routine && (allowed as string[]).includes(routine.prog) ? routine.prog : undefined) || (m === 'reps' ? 'linear' : m === 'cardio' ? 'cardio' : 'off');
  return (allowed as string[]).includes(pick) ? pick : 'off';
}

const round1 = (v: number) => Math.round(v * 10) / 10;
function snap(v: number, step: number): number {
  if (!(step > 0)) return round1(v);
  return round1(Math.round(v / step) * step);
}

/** Loads from the equipment rules: a step up lands on the next realizable load at or above the target, a deload on the one at or below. */
function loadable(S: Obj, cfg: Obj, from: number | null, target: number): number {
  const eq = ports().exercise(cfg.id)?.eq;
  if (from == null) {
    const up = realizableToward(S, eq as string, 0, target);
    if (up == null) return target;
    const down = stepWeight(S, eq as string, up, -1);
    return down < up && target - down < up - target ? down : up;
  }
  const r = realizableToward(S, eq as string, from, target);
  if (r != null) return r;
  return stepWeight(S, eq as string, from, target > from ? 1 : -1) === from ? from : target;
}
const topOfRange = (policy: Policy, w: number, reps?: number): Prescription => ({ policy, kind: 'hold', weight: w, reps,
  why: ['Heaviest load this equipment offers — same weight, work the reps.'] });
const delta = (a: number, b: number) => Math.round((a - b) * 100) / 100;

function deloadTo(cur: number, step: number): number {
  let next = snap(cur * DELOAD_FACTOR, step);
  if (next >= cur) next = snap(cur - step, step);
  return Math.max(step, next);
}

export interface SessionRead {
  d?: string; mode: ExerciseMode; goal: number; ok: boolean; weight?: number; reps?: number[]; low?: number; amrap?: number;
  weights?: number[]; safeToIncrease?: boolean; effort?: number | null; rated?: number;
  sec?: number; held?: number[]; best?: number; min?: number; goalSpeed?: number; mins?: number[]; speeds?: (number | null)[]; hasSpeed?: boolean; durationOk?: boolean; speedOk?: boolean;
  [k: string]: any;
}

/** Reduce one finished workout entry to what a policy needs to judge it. Entries without a target fall back to the current plan. */
export function readSession(entry: Obj | null | undefined, fallback?: Obj | null): SessionRead {
  const target: Obj = (entry && entry.target) || fallback || {};
  const mode = modeOf({ ...target, id: entry?.id });
  const sets = workingSets(entry?.sets || []);
  const planned = target.sets || sets.length;
  const enough = sets.length >= planned;

  if (mode === 'time') {
    const goal = target.sec || 0;
    const held = sets.map(s => (s.done ? (s.sec || 0) : 0));
    return { mode, goal, held, weight: Math.max(0, ...sets.filter(s => s.done).map(s => s.w || 0)), best: Math.max(0, ...held),
      ok: goal > 0 && enough && held.length > 0 && held.every(h => h >= goal) };
  }
  if (mode === 'cardio') {
    const goal = Math.max(0, Number(target.min) || 0);
    const goalSpeed = Math.max(0, Number(target.speed) || 0);
    const mins = sets.map(s => (s.done ? Math.max(0, Number(s.min) || 0) : 0));
    const speeds = sets.map(s => (s.done && s.speed != null && Number.isFinite(Number(s.speed)) ? Math.max(0, Number(s.speed)) : null));
    const hasSpeed = speeds.some(v => v != null);
    const durationOk = goal > 0 && enough && mins.length > 0 && mins.every(m => m >= goal);
    const speedOk = !goalSpeed || speeds.every(v => v == null || v >= goalSpeed);
    return { mode, goal, goalSpeed, mins, speeds, hasSpeed, durationOk, speedOk, best: Math.max(0, ...mins), ok: durationOk && speedOk };
  }
  const goal = target.reps || 0;
  const reps = sets.map(s => (s.done ? (s.r || 0) : 0));
  return {
    mode, goal, reps,
    ...workingLoadEvidence(sets),
    ...effortStats(sets as any),
    low: reps.length ? Math.min(...reps) : 0,
    amrap: reps.length ? reps[reps.length - 1] : 0,
    ok: goal > 0 && enough && reps.length > 0 && reps.every(r => r >= goal),
  } as SessionRead;
}

/** Every past session for one exercise, oldest first. */
export function sessionsFor(S: Obj, exId: string, fallback?: Obj | null): (SessionRead & { d: string })[] {
  const out: (SessionRead & { d: string })[] = [];
  ((S.workouts as Obj[]) || []).forEach(w => {
    if (!countsForProgression(w)) return;
    const entry = (w.entries || []).find((e: Obj) => e.id === exId);
    if (entry && !entry.target?.deload && entry.sets.some((s: Obj) => s.done)) out.push({ d: w.d, ...readSession(entry, fallback) });
  });
  return out;
}

/** How many sessions in a row ended in a miss, counting back from the most recent. */
export function stallCount(sessions: SessionRead[]): number {
  let n = 0;
  for (let i = sessions.length - 1; i >= 0; i--) {
    if (sessions[i]!.ok) break;
    n++;
  }
  return n;
}

export interface Prescription { policy: Policy; kind: 'first' | 'up' | 'hold' | 'deload' | 'off'; weight?: number | undefined; reps?: number | undefined; sec?: number | undefined; min?: number | undefined; speed?: number | undefined; weights?: number[] | undefined; why?: unknown[] | undefined; auto?: 'slower' | 'faster' | 'deload' | undefined }

function policyPrescription(S: Obj, cfg: Obj, routine: Obj | null | undefined): Prescription {
  const mode = modeOf(cfg);
  const policy = policyFor(cfg, routine, mode);
  const unit: string = S.unit || 'kg';
  const inc = cfg.inc > 0 ? cfg.inc : (mode === 'time' ? DEFAULT_SEC_INCREMENT : defaultIncrement(cfg.id, unit));
  if (policy === 'off') return { policy, kind: 'off' };

  if (policy === 'pct1rm') {
    const best = bestTestedOneRM(S, cfg.id) as Obj | null;
    if (!best) return { policy, kind: 'off', why: ['No tested 1RM on file for this exercise yet — run one first (Actions → Start a test session).'] };
    const reps = cfg.reps || 5;
    const rir = cfg.targetRIR != null ? cfg.targetRIR : 2;
    const pct = pctForReps(reps, rir);
    const weight = loadable(S, cfg, null, snap(best.est1RM * pct, inc));
    return { policy, kind: 'hold', weight, reps, why: ['{0}% of your tested 1RM ({1} {2}) for {3} reps at RIR {4}.', Math.round(pct * 100), best.est1RM, unit, reps, rir] };
  }

  const sessions = sessionsFor(S, cfg.id, cfg).filter(s => s.mode === mode);
  const last = sessions[sessions.length - 1];
  if (!last) return { policy, kind: 'first', why: ['Nothing logged yet — this session sets the baseline.'] };

  const stalls = stallCount(sessions);
  const deloadAt = DELOAD_AFTER[policy] || 3;

  if (mode === 'time') {
    if (last.ok) {
      const sec = (last.goal || cfg.sec || 0) + inc;
      return { policy, kind: 'up', sec, why: ['Held every set for the full time — target up by {0}s.', inc] };
    }
    if (stalls >= deloadAt) {
      const sec = deloadTo(last.goal || cfg.sec || 0, 5);
      return { policy, kind: 'deload', sec, why: ['Short {0} sessions in a row — back off to {1}s and build up again.', stalls, sec] };
    }
    return { policy, kind: 'hold', sec: last.goal || cfg.sec, why: ['Last time came up short — same target again.'] };
  }

  if (mode === 'cardio') {
    const goal = Math.max(1, Number(last.goal) || Number(cfg.min) || 20);
    const speed = Math.max(0, Number(last.goalSpeed) || Number(cfg.speed) || 0);
    const durationCeiling = Math.max(30, Number(cfg.min) || 0);
    const repeatedMisses = stalls >= 2;
    if (!last.ok) {
      if (!repeatedMisses) return { policy, kind: 'hold', min: goal, speed: speed || undefined, why: ['Cardio target not completed — keep the same goal and build back up.'] };
      if (last.durationOk && !last.speedOk && speed > 0.5) {
        const nextSpeed = Math.max(0.5, round1(speed - 0.5));
        return { policy, kind: 'deload', min: goal, speed: nextSpeed, why: ['Two cardio sessions came up short — keep the time and ease the pace to {0} km/h.', nextSpeed] };
      }
      const nextMin = Math.max(5, goal - 1);
      return { policy, kind: 'deload', min: nextMin, speed: speed || undefined, why: ['Two cardio sessions came up short — reduce the time to {0} min, then build again.', nextMin] };
    }
    if (goal < durationCeiling) {
      const nextMin = Math.min(durationCeiling, goal + 1);
      return { policy, kind: 'up', min: nextMin, speed: speed || undefined, why: ['You completed the cardio time — add 1 minute, then build toward {0} min before increasing pace.', durationCeiling] };
    }
    if (!last.hasSpeed || !speed) return { policy, kind: 'hold', min: goal, why: ['Cardio time is at its ceiling. Log a speed so the next pace target can progress safely.'] };
    const nextSpeed = round1(speed + 0.5);
    return { policy, kind: 'up', min: goal, speed: nextSpeed, why: ['You reached {0} min — keep the time and increase pace by {1} km/h.', goal, nextSpeed - speed] };
  }

  const w = last.weight as number;
  if (w <= 0) {
    const goal = last.goal || cfg.reps || 0;
    if (last.ok && goal > 0) return { policy, kind: 'up', weight: 0, reps: goal + 1, why: ['Bodyweight — every rep last time, so go for {0} this time.', goal + 1] };
    return { policy, kind: 'hold', weight: 0, reps: goal || undefined, why: ['Bodyweight — same target again until every set is clean.'] };
  }
  const previous = sessions[sessions.length - 2];
  if (last.ok && (!last.safeToIncrease || (policy === 'double' && (!previous?.ok || !previous.safeToIncrease || previous.weight !== w)))) {
    return { policy, kind: 'hold', weight: w, why: ['Repeat the first working load until two sessions support a safe increase.'] };
  }
  if (policy === 'double') {
    const top = cfg.reps || last.goal || 10;
    const bottom = Math.min(cfg.repsMin || Math.max(1, top - 2), top);
    if (last.ok) {
      const up = loadable(S, cfg, w, snap(w + inc, inc));
      if (up <= w) return topOfRange(policy, w, bottom);
      return { policy, kind: 'up', weight: up, reps: bottom, why: ['Top of the rep range in every set — {0} {1} more, back to {2} reps.', delta(up, w), unit, bottom] };
    }
    if (stalls >= deloadAt) {
      const dw = loadable(S, cfg, w, deloadTo(w, inc));
      return { policy, kind: 'deload', weight: dw, reps: bottom, why: ['Stalled {0} sessions — deload to {1} {2}.', stalls, dw, unit] };
    }
    const aim = Math.min(top, Math.max(bottom, (last.low ?? 0) + 1));
    return { policy, kind: 'hold', weight: w, reps: aim, why: ['Same weight — aim for {0} reps this time.', aim] };
  }

  if (last.ok) {
    const dbl = policy === 'greyskull' && last.goal > 0 && (last.amrap ?? 0) >= last.goal * 2;
    const up = loadable(S, cfg, w, snap(w + (dbl ? inc * 2 : inc), inc));
    if (up <= w) return topOfRange(policy, w);
    return { policy, kind: 'up', weight: up,
      why: dbl ? ['Last set hit {0} reps — twice the target, so take a double jump of {1} {2}.', last.amrap, delta(up, w), unit]
        : ['Every rep last time — {0} {1} more.', delta(up, w), unit] };
  }
  if (stalls >= deloadAt) {
    const dw = loadable(S, cfg, w, deloadTo(w, inc));
    return { policy, kind: 'deload', weight: dw,
      why: stalls > 1 ? ['Missed reps {0} sessions running — reset to {1} {2} and work back up.', stalls, dw, unit]
        : ['Missed reps — reset to {0} {1} and work back up.', dw, unit] };
  }
  return { policy, kind: 'hold', weight: w, why: ['Missed reps last time — same weight again ({0} of {1} to go).', deloadAt - stalls, deloadAt] };
}

const GRIND_RPE = 9;

/** Autoregulation as a small layer over linear/double increases: grind holds the load, clearly easy sessions allow a bigger step. */
function regulate(S: Obj, cfg: Obj, routine: Obj | null | undefined, p: Prescription): Prescription {
  if (S.autoreg === false || (p.kind !== 'up' && p.kind !== 'hold') || !(p.weight != null && p.weight > 0) || modeOf(cfg) !== 'reps' || (p.policy !== 'linear' && p.policy !== 'double')) return p;
  const sessions = sessionsFor(S, cfg.id, cfg).filter(x => x.mode === 'reps');
  const last = sessions[sessions.length - 1];
  if (!last || !((last.weight ?? 0) > 0)) return p;
  const sig = effortSignal(sessions as any);
  const unit: string = S.unit || 'kg';
  const w = last.weight as number;
  if (sig.kind === 'grind' && (p.weight as number) >= w) {
    return { ...p, kind: 'hold', weight: w, reps: p.policy === 'double' ? (last.goal || cfg.reps || p.reps) : undefined, auto: 'slower',
      why: ['Completed twice, but at RPE {0} or higher (RIR 1 or less) — keep {1} {2} until it feels easier.', GRIND_RPE, w, unit] };
  }
  if (sig.kind === 'easy' && p.kind === 'up') {
    const inc = cfg.inc > 0 ? cfg.inc : defaultIncrement(cfg.id, unit);
    const bigger = loadable(S, cfg, p.weight as number, snap((p.weight as number) + ((p.weight as number) - w), inc));
    if (bigger > (p.weight as number) && (bigger - w) / w <= 0.15) return { ...p, weight: bigger, auto: 'faster', why: ['Every rep, and clearly easy (RPE 7 or lower) three sessions running — {0} {1} more.', delta(bigger, w), unit] };
  }
  return p;
}

/** The next prescription for one exercise. */
export function nextPrescription(S: Obj, cfg: Obj, routine?: Obj | null): Prescription {
  const p = regulate(S, cfg, routine, policyPrescription(S, cfg, routine));
  if (p.weight == null || p.policy === 'pct1rm' || modeOf(cfg) !== 'reps') return p;
  const latest = sessionsFor(S, cfg.id, cfg).filter(s => s.mode === 'reps').at(-1);
  if (!latest?.weights?.length || latest.weights.every(w => w === latest.weight)) return p;
  const offset = (p.weight as number) - (latest.weight as number);
  const eq = ports().exercise(cfg.id)?.eq as string;
  return { ...p, weights: latest.weights.map(w => (offset === 0 ? w : (realizableToward(S, eq, w, Math.max(0, w + offset)) ?? w))) };
}

/** Apply a prescription to freshly built sets. Only decided fields change, and only on sets not yet logged. */
export function applyPrescription(sets: Obj[], p: Prescription | null | undefined): Obj[] {
  if (!p || p.kind === 'off' || p.kind === 'first') return sets;
  let workIndex = 0;
  return sets.map(s => {
    if (s.done || s.type === 'warmup' || s.type === 'drop') return s;
    const out = { ...s };
    if (p.weight != null) out.w = p.weights?.[workIndex] ?? p.weights?.at(-1) ?? p.weight;
    workIndex++;
    if (p.reps != null) out.r = p.reps;
    if (p.sec != null) out.sec = p.sec;
    if (p.min != null) out.min = p.min;
    if (p.speed != null) out.speed = p.speed;
    return out;
  });
}

/** Cardio's effective target belongs to this workout entry, not the saved routine. */
export function targetForPrescription(cfg: Obj, plan: Prescription | null | undefined): Obj {
  if (modeOf(cfg) !== 'cardio' || !plan || plan.kind === 'off' || plan.kind === 'first') return { ...cfg };
  return { ...cfg, ...(plan.min != null ? { min: plan.min } : {}), ...(plan.speed != null ? { speed: plan.speed } : {}) };
}

/** Turns a routine into the entries a live session drives. */
export function buildRoutineEntries(S: Obj, routine: Obj): Obj[] {
  const usable = ((routine ? routine.ex : []) as Obj[]).filter(cfg => !ports().isUnavailable(cfg.id)).map(cfg => ({ ...cfg }));
  cleanupSg(usable as any);
  return usable.map(cfg => {
    const plan = nextPrescription(S, cfg, routine);
    return withDeload(S, { id: cfg.id, sg: cfg.sg, target: targetForPrescription(cfg, plan), plan, sets: applyPrescription(buildSets(S as any, cfg as any), plan) });
  });
}

/** The 1-week deload the member accepted: fewer working sets, loads a little lighter, RIR target. Routines and history are untouched. */
export function withDeload(S: Obj, entry: Obj, today: string = todayISO()): Obj {
  const d = activeDeload(S, today);
  if (!d) return entry;
  const work = (entry.sets || []).filter((s: Obj) => !s.done && s.type !== 'warmup' && s.type !== 'drop');
  const keep = Math.max(1, Math.round(work.length * (1 - (d.volumeCut ?? 0))));
  const eq = ports().exercise(entry.id)?.eq as string;
  let seen = 0;
  const sets = (entry.sets || []).flatMap((s: Obj) => {
    if (s.done || s.type === 'warmup' || s.type === 'drop') return [s];
    if (++seen > keep) return [];
    const out = { ...s };
    if (out.w > 0) {
      const lighter = realizableToward(S as any, eq, out.w, out.w * (1 - (d.loadCut ?? 0)));
      out.w = lighter != null && lighter < out.w ? lighter : out.w;
    }
    return [out];
  });
  return {
    ...entry, sets,
    target: { ...entry.target, targetRIR: d.rir, deload: { from: d.from, until: d.until, rir: d.rir } },
    plan: { ...(entry.plan || {}), deload: true, auto: 'deload',
      why: ['Deload week: about {0} % fewer sets, a little lighter, aim for RIR {1}. Your normal plan comes back afterwards.', Math.round((d.volumeCut ?? 0) * 100), d.rir] },
  };
}

/** One exercise picked ad hoc, starting from defaultConfig(). */
export function buildFreeEntry(S: Obj, exId: string, routine?: Obj | null): Obj {
  const cfg = { ...defaultConfig(exId) };
  const plan = nextPrescription(S, cfg, routine || null);
  return { id: cfg.id, target: targetForPrescription(cfg, plan), plan, sets: applyPrescription(buildSets(S as any, cfg as any), plan) };
}
