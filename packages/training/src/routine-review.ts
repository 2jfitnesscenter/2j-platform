// Ported from 2jfitnessapp frontend/src/lib/routine-review.js (commit b7d8e68). Behaviour unchanged.
// Pure and deterministic: no AI, no I/O. It never edits a routine, a load or a program; it only says "worth a look", and why.
import { countsForProgression } from './progression-policy.js';
/* eslint-disable @typescript-eslint/no-explicit-any */
type Obj = Record<string, any>;

export const REVIEW_WEEK = 5;
export const EARLY_WEEK = 4;
export const MIN_SESSIONS = 3;
export const LATE_DAYS = 14;
export const PROGRAM_REVIEW_DAYS = 28;

const ISO = /^\d{4}-\d{2}-\d{2}$/;
const DAY = 86400000;
const day = (iso: string) => Date.parse(iso + 'T12:00:00Z');
const daysBetween = (a: string, b: string) => Math.round((day(b) - day(a)) / DAY);
const addDays = (iso: string, n: number) => new Date(day(iso) + n * DAY).toISOString().slice(0, 10);
const isoOfMs = (ms: number) => new Date(ms).toISOString().slice(0, 10);
const num = (x: unknown): number | null => (typeof x === 'number' && Number.isFinite(x) ? x : null);

const isWork = (s: Obj | null | undefined): boolean => !!s && !!s.done && s.type !== 'warmup';
const effortOf = (s: Obj | null | undefined): number | null => (num(s?.rpe) != null ? s!.rpe : num(s?.rir) != null ? 10 - s!.rir : null);
const score = (s: Obj): number | null => { const w = num(s.w), r = num(s.r); return r != null && r > 0 ? (w != null && w > 0 ? w * (1 + r / 30) : r) : null; };
const repFloor = (entry: Obj | null | undefined): number | null => {
  const tg: Obj = entry?.target || {};
  const top = num(Number(tg.targetRepsMax || tg.reps)) || null;
  if (!top) return null;
  return Math.min(num(Number(tg.targetRepsMin || tg.repsMin)) || top, top);
};
const entriesOf = (w: Obj | null | undefined): Obj[] => (Array.isArray(w?.entries) ? w!.entries : []).filter((e: unknown) => e && typeof e === 'object');
const mean = (a: number[]): number | null => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : null);
const isDate = (x: unknown): x is string => typeof x === 'string' && ISO.test(x) && new Date(day(x)).toISOString().slice(0, 10) === x && x >= '2000-01-01' && x <= '2100-12-31';

function getProgramRoutineIds(program: Obj | null | undefined): string[] {
  if (!program) return [];
  const ids = [
    ...(Array.isArray(program.routineIds) ? program.routineIds : []),
    ...(Array.isArray(program.weeks) ? program.weeks.flatMap((w: Obj) => (Array.isArray(w?.sessions) ? w.sessions.map((s: Obj) => s?.routineId) : [])) : []),
    ...(program.routineSnapshots && typeof program.routineSnapshots === 'object' ? Object.keys(program.routineSnapshots) : []),
    ...(program.routines && !Array.isArray(program.routines) && typeof program.routines === 'object' ? Object.keys(program.routines) : []),
    ...(Array.isArray(program.routines) ? program.routines.map((r: Obj) => r?.routineId || r?.id) : []),
  ];
  return [...new Set(ids.filter((id: unknown): id is string => typeof id === 'string' && id !== ''))];
}

export interface CycleStart { start: string; source: 'manual' | 'reviewed' | 'version' | 'first'; exclusive: boolean }

/** Start of the current cycle of routine r, or null when it has not started. */
export function cycleStart(S: Obj, r: Obj): CycleStart | null {
  const id = r?.id;
  if (!id) return null;
  if (isDate(S?.routineReviews?.[id]?.startOverride)) return { start: S.routineReviews[id].startOverride, source: 'manual', exclusive: false };
  const reviewed = S?.routineReviews?.[id]?.reviewedAt;
  const versions: Obj[] = Array.isArray(S?.routineVersions?.[id]) ? S.routineVersions[id] : [];
  const lastVersion = versions.reduce((m: number, v: Obj) => (num(v?.versionedAt) && v.versionedAt > m ? v.versionedAt : m), 0);
  const candidates: CycleStart[] = [];
  if (typeof reviewed === 'string' && ISO.test(reviewed)) candidates.push({ start: reviewed, source: 'reviewed', exclusive: true });
  if (lastVersion) candidates.push({ start: isoOfMs(lastVersion), source: 'version', exclusive: true });
  if (candidates.length) return candidates.reduce((a, b) => (b.start >= a.start ? b : a));
  let first: string | null = null;
  for (const w of (S?.workouts as Obj[]) || []) if (countsForProgression(w) && w?.routineId === id && ISO.test(w.d || '') && (!first || w.d < first)) first = w.d;
  return first ? { start: first, source: 'first', exclusive: false } : null;
}

/** The routine's logged sessions inside the cycle, oldest first. */
export function cycleSessions(S: Obj, r: Obj, cycle: CycleStart | null, today: string): Obj[] {
  if (!cycle) return [];
  return ((S?.workouts as Obj[]) || [])
    .filter(w => countsForProgression(w) && w?.routineId === r.id && ISO.test(w.d || '') && (cycle.exclusive ? w.d > cycle.start : w.d >= cycle.start) && w.d <= today)
    .filter(w => !(Array.isArray(w.entries) && w.entries.some((e: Obj) => e?.target?.deload)))
    .sort((a, b) => (a.d < b.d ? -1 : a.d > b.d ? 1 : (a.start || 0) - (b.start || 0)));
}

function exposures(sessions: Obj[]): Map<string, { d: string; entry: Obj; sets: Obj[] }[]> {
  const by = new Map<string, { d: string; entry: Obj; sets: Obj[] }[]>();
  for (const w of sessions) {
    for (const e of entriesOf(w)) {
      if (!e.id || e.target?.deload) continue;
      const sets = (Array.isArray(e.sets) ? e.sets : []).filter(isWork);
      if (!sets.length) continue;
      if (!by.has(e.id)) by.set(e.id, []);
      by.get(e.id)!.push({ d: w.d, entry: e, sets });
    }
  }
  return by;
}

export interface PlateauReason { code: string; n?: number; of?: number }
export interface Plateau { clear: boolean; evaluable: number; stalled: string[]; reasons: PlateauReason[] }

/** Plateau signals of one routine's cycle. A single bad session can never trigger any of them. */
export function plateau(sessions: Obj[]): Plateau {
  const by = exposures(sessions);
  let evaluable = 0;
  const stalled: string[] = [], misses: string[] = [], effortUp: string[] = [];
  for (const [id, list] of by) {
    const best = (ex: { sets: Obj[] }) => Math.max(0, ...ex.sets.map(score).filter((x): x is number => x != null));
    if (list.length >= 4) {
      evaluable++;
      const recent = list.slice(-3), earlier = list.slice(0, -3);
      const base = Math.max(...earlier.map(best)), now = Math.max(...recent.map(best));
      if (base > 0 && now < base * 1.02) stalled.push(id);
    }
    const last3 = list.slice(-3);
    const missed = (ex: { sets: Obj[]; entry: Obj }) => {
      const floor = repFloor(ex.entry);
      return ex.sets.some(s => s.feel === 'fail') || (floor != null && ex.sets.filter(s => num(s.r) != null && s.r < floor).length >= 2);
    };
    if (last3.length === 3 && last3.filter(missed).length >= 2) misses.push(id);
    const withEffort = list.filter(ex => ex.sets.some(s => effortOf(s) != null));
    if (withEffort.length >= 4) {
      const avg = (ex: { sets: Obj[] }) => mean(ex.sets.map(effortOf).filter((x): x is number => x != null)) as number;
      const load = (ex: { sets: Obj[] }) => mean(ex.sets.map(s => num(s.w)).filter((x): x is number => x != null && x > 0));
      const a = withEffort.slice(0, 2), b = withEffort.slice(-2);
      const la = mean(a.map(load).filter((x): x is number => x != null)), lb = mean(b.map(load).filter((x): x is number => x != null));
      const similar = la == null || lb == null ? la === lb : Math.abs((lb as number) - (la as number)) / (la as number) <= 0.05;
      const base = mean(a.map(avg)) as number;
      if (similar && (mean(b.map(avg)) as number) - base >= 1 && b.every(x => avg(x) - base >= 0.5)) effortUp.push(id);
    }
  }
  const last3 = sessions.slice(-3);
  const rated = (w: Obj) => entriesOf(w).flatMap(e => (Array.isArray(e.sets) ? e.sets : []).filter(s => isWork(s) && s.feel));
  const hardSession = (w: Obj) => { const r = rated(w); return r.length >= 2 && r.filter(s => s.feel === 'hard' || s.feel === 'fail').length / r.length >= 0.5; };
  const hard = last3.length === 3 ? last3.filter(hardSession).length : 0;
  const planned = (w: Obj) => entriesOf(w).reduce((n, e) => n + (num(e?.target?.sets) || 0), 0);
  const doneSets = (w: Obj) => entriesOf(w).reduce((n, e) => n + (Array.isArray(e.sets) ? e.sets : []).filter(isWork).length, 0);
  const incomplete = last3.length === 3 ? last3.filter(w => planned(w) >= 3 && doneSets(w) < planned(w) * 0.7).length : 0;
  const supporting = { misses: misses.length, effortUp: effortUp.length, hard: hard >= 2 ? hard : 0, incomplete: incomplete >= 2 ? incomplete : 0 };
  const others = Object.values(supporting).some(n => n > 0);
  const clear = (stalled.length >= 2 && stalled.length * 2 >= evaluable) || (stalled.length >= 1 && others);
  const reasons: PlateauReason[] = [];
  if (stalled.length) reasons.push({ code: 'stalled', n: stalled.length, of: evaluable });
  if (supporting.misses) reasons.push({ code: 'misses', n: supporting.misses });
  if (supporting.effortUp) reasons.push({ code: 'effort_up', n: supporting.effortUp });
  if (supporting.hard) reasons.push({ code: 'hard', n: supporting.hard });
  if (supporting.incomplete) reasons.push({ code: 'incomplete', n: supporting.incomplete });
  return { clear, evaluable, stalled, reasons };
}

function progressionSummary(sessions: Obj[]) {
  const by = exposures(sessions);
  let evaluable = 0, improved = 0;
  for (const list of by.values()) {
    if (list.length < 3) continue;
    const value = (x: { sets: Obj[] }) => Math.max(0, ...x.sets.map(score).filter((v): v is number => v != null));
    const early = Math.max(...list.slice(0, Math.max(1, Math.floor(list.length / 2))).map(value));
    const recent = Math.max(...list.slice(-2).map(value));
    if (!early || !recent) continue;
    evaluable++;
    if (recent >= early * 1.02) improved++;
  }
  return { status: evaluable < 2 ? 'insufficient' : improved ? 'improving' : 'stable', improved, evaluated: evaluable };
}

/** Review state of every routine the member has started. */
export function routineReviews(S: Obj, today: string): Obj[] {
  const out: Obj[] = [];
  const activeProgram = ((S?.programs as Obj[]) || []).find(p => p?.id === S?.activeProgramId && !['paused', 'abandoned', 'completed'].includes(p?.status));
  const programRoutineIds = new Set(getProgramRoutineIds(activeProgram));
  if (activeProgram) {
    const saved: Obj = S?.programReviews?.[activeProgram.id] || {};
    const started = num(activeProgram.startedAt);
    const firstProgramWorkout = ((S?.workouts as Obj[]) || [])
      .filter(w => countsForProgression(w) && ISO.test(w?.d || '') && w.d <= today && (w?.src2j?.program?.programId === activeProgram.id || (!w?.src2j?.program?.programId && programRoutineIds.has(w?.routineId))))
      .reduce((first: string | null, w: Obj) => (!first || w.d < first ? w.d : first), null);
    const start: string | null = isDate(saved.startOverride) ? saved.startOverride : started ? isoOfMs(started) : firstProgramWorkout;
    if (start) {
      const manualDue = isDate(saved.nextReviewOverride) && saved.nextReviewOverride >= start ? saved.nextReviewOverride : null;
      const dueDate: string = manualDue || (isDate(saved.nextReviewAt) && saved.nextReviewAt >= start ? saved.nextReviewAt : addDays(start, PROGRAM_REVIEW_DAYS));
      const workouts = ((S?.workouts as Obj[]) || [])
        .filter(w => countsForProgression(w) && ISO.test(w?.d || '') && w.d >= start && w.d <= today
          && (w?.src2j?.program?.programId === activeProgram.id || (!w?.src2j?.program?.programId && programRoutineIds.has(w?.routineId)))
          && !(Array.isArray(w.entries) && w.entries.some((e: Obj) => e?.target?.deload)))
        .sort((a, b) => a.d.localeCompare(b.d) || (a.start || 0) - (b.start || 0));
      const p = plateau(workouts);
      const days = Math.max(0, daysBetween(start, today));
      const week = Math.floor(days / 7) + 1;
      const weeks: Obj[] = activeProgram.weeks || [];
      const elapsedWeeks = Math.min(weeks.length, Math.floor(days / 7));
      const scheduled = weeks.slice(0, elapsedWeeks).flatMap((w, wi) => (w.sessions || []).map((s: Obj, si: number) => `${wi + 1}:${s.day}:${si}`));
      const done = new Set(((S?.workouts as Obj[]) || []).filter(w => ISO.test(w?.d || '') && w.d <= today && w?.src2j?.program?.programId === activeProgram.id)
        .map(w => w.src2j.program.sessionId).filter(Boolean));
      const total = scheduled.length;
      const completed = total ? scheduled.filter(id => done.has(id)).length : null;
      const left = daysBetween(today, dueDate);
      const reviewedInCurrentCycle = isDate(saved.lastReviewAt) && today < dueDate;
      const status = left <= 0 ? (left <= -LATE_DAYS ? 'overdue' : 'due')
        : !reviewedInCurrentCycle && days >= (EARLY_WEEK - 1) * 7 && p.clear && workouts.length >= MIN_SESSIONS ? 'early'
        : left <= 7 ? 'soon' : 'upcoming';
      out.push({ kind: 'program', programId: activeProgram.id, routineIds: [...programRoutineIds], name: activeProgram.name || 'Program', start,
        startManual: isDate(saved.startOverride), dueDate, nextReviewAt: dueDate, dueManual: !!manualDue, lastReviewAt: saved.lastReviewAt || null,
        reviewed: !!saved.lastReviewAt && today < dueDate, status, week, days, sessions: workouts.length, early: status === 'early', late: status === 'overdue',
        reasons: [...(status === 'early' ? [{ code: 'plateau' }] : []), ...(status === 'due' || status === 'overdue' ? [{ code: 'week', week }] : []), ...p.reasons],
        plateau: p, progression: progressionSummary(workouts),
        adherence: total && completed != null ? { completed, total, percent: Math.round(completed * 100 / total) } : null });
    }
  }
  for (const r of (S?.routines as Obj[]) || []) {
    if (programRoutineIds.has(r?.id)) continue;
    const cycle = cycleStart(S, r);
    if (!cycle) continue;
    const sessions = cycleSessions(S, r, cycle, today);
    const days = Math.max(0, daysBetween(cycle.start, today));
    const week = Math.floor(days / 7) + 1;
    const manualDue = S?.routineReviews?.[r.id]?.dueOverride;
    const dueManual = isDate(manualDue) && manualDue >= cycle.start ? manualDue : null;
    const dueDate: string = dueManual || addDays(cycle.start, (REVIEW_WEEK - 1) * 7);
    const reviewedInCurrentCycle = isDate(S?.routineReviews?.[r.id]?.reviewedAt) && today < dueDate;
    const base = { routineId: r.id, name: r.name || '', start: cycle.start, source: cycle.source, startManual: cycle.source === 'manual', dueDate, nextReviewAt: dueDate,
      dueManual: !!dueManual, reviewed: reviewedInCurrentCycle, lastReviewAt: S?.routineReviews?.[r.id]?.reviewedAt || null, week, days, sessions: sessions.length };
    if (dueManual) {
      const p0 = plateau(sessions);
      const left = daysBetween(today, dueManual);
      if (left <= 0) out.push({ ...base, status: 'due', early: false, late: -left >= LATE_DAYS, reasons: [{ code: 'date', due: dueManual }, ...p0.reasons] });
      else out.push({ ...base, status: left <= 7 ? 'soon' : 'ok', early: false, late: false, reasons: p0.reasons });
      continue;
    }
    if (sessions.length < MIN_SESSIONS) { out.push({ ...base, status: 'idle', reasons: [] }); continue; }
    const p = plateau(sessions);
    if (week >= REVIEW_WEEK) out.push({ ...base, status: 'due', early: false, late: daysBetween(dueDate, today) >= LATE_DAYS, reasons: [{ code: 'week', week }, ...p.reasons] });
    else if (!reviewedInCurrentCycle && week >= EARLY_WEEK && p.clear) out.push({ ...base, status: 'early', early: true, late: false, reasons: p.reasons });
    else if (week >= EARLY_WEEK) out.push({ ...base, status: 'soon', early: false, late: false, reasons: p.reasons });
    else out.push({ ...base, status: 'ok', reasons: p.reasons });
  }
  return out;
}

/** Reviews that need a notice now, most overdue first. */
export const pendingReviews = (S: Obj, today: string): Obj[] =>
  routineReviews(S, today).filter(r => r.status === 'due' || r.status === 'overdue' || r.status === 'early').sort((a, b) => b.days - a.days);

/** Close the active program review without rewriting any routine or workout. */
export function markProgramReviewed(S: Obj, programId: string, today: string, by?: string): boolean {
  const program = ((S?.programs as Obj[]) || []).find(p => p?.id === programId && p.id === S?.activeProgramId && !['paused', 'abandoned', 'completed'].includes(p?.status));
  if (!program || !isDate(today)) return false;
  S.programReviews = S.programReviews || {};
  const prev: Obj = S.programReviews[programId] || {};
  const next: Obj = { ...prev, lastReviewAt: today, nextReviewAt: addDays(today, PROGRAM_REVIEW_DAYS), by: by || 'staff', n: (prev.n || 0) + 1 };
  delete next.nextReviewOverride;
  S.programReviews[programId] = next;
  return true;
}

export function setProgramCycleDates(S: Obj, programId: string, patch: Obj, by?: string): boolean {
  const program = ((S?.programs as Obj[]) || []).find(p => p?.id === programId && p.id === S?.activeProgramId && !['paused', 'abandoned', 'completed'].includes(p?.status));
  if (!program || !patch || typeof patch !== 'object') return false;
  const current: Obj = { ...(S.programReviews?.[programId] || {}) };
  for (const [key, field] of [['start', 'startOverride'], ['due', 'nextReviewOverride']] as const) {
    if (!Object.prototype.hasOwnProperty.call(patch, key)) continue;
    const value = patch[key];
    if (value === null || value === '') delete current[field];
    else if (isDate(value)) current[field] = value;
    else return false;
  }
  const start = current.startOverride || (num(program.startedAt) ? isoOfMs(program.startedAt) : null);
  if (current.nextReviewOverride && start && current.nextReviewOverride < start) return false;
  if (current.startOverride || current.nextReviewOverride) current.manualBy = by || 'staff'; else delete current.manualBy;
  S.programReviews = S.programReviews || {};
  if (Object.keys(current).length) S.programReviews[programId] = current;
  else { delete S.programReviews[programId]; if (!Object.keys(S.programReviews).length) delete S.programReviews; }
  return true;
}

/** "Rutina revisada": closes the notice and restarts the cycle from today. Writes only S.routineReviews. */
export function markReviewed(S: Obj, routineId: string, today: string, by?: string): boolean {
  if (!((S?.routines as Obj[]) || []).some(r => r.id === routineId) || !isDate(today)) return false;
  S.routineReviews = S.routineReviews || {};
  const prev: Obj | undefined = S.routineReviews[routineId];
  S.routineReviews[routineId] = { reviewedAt: today, by: by || 'staff', n: (prev?.n || 0) + 1 };
  return true;
}

/** Manual control of the cycle (staff). patch = { start?, due? }: a date sets it, null / '' goes back to automatic, undefined leaves it. */
export function setCycleDates(S: Obj, routineId: string, patch: Obj, by?: string): boolean {
  const r = ((S?.routines as Obj[]) || []).find(x => x.id === routineId);
  if (!r || !patch || typeof patch !== 'object') return false;
  const cur: Obj = { ...(S.routineReviews?.[routineId] || {}) };
  for (const [k, field] of [['start', 'startOverride'], ['due', 'dueOverride']] as const) {
    const v = patch[k];
    if (v === undefined) continue;
    if (v === null || v === '') delete cur[field];
    else if (isDate(v)) cur[field] = v;
    else return false;
  }
  const probe = { ...S, routineReviews: { ...(S.routineReviews || {}), [routineId]: cur } };
  const start = cycleStart(probe, r)?.start;
  if (cur.dueOverride && start && cur.dueOverride < start) return false;
  if (cur.startOverride || cur.dueOverride) cur.manualBy = by || 'staff'; else delete cur.manualBy;
  S.routineReviews = S.routineReviews || {};
  if (Object.keys(cur).length) S.routineReviews[routineId] = cur; else delete S.routineReviews[routineId];
  if (!Object.keys(S.routineReviews).length) delete S.routineReviews;
  return true;
}
