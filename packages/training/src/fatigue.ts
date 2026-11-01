// Ported from 2jfitnessapp frontend/src/lib/fatigue.js (commit b7d8e68). Behaviour unchanged.
// Readiness, accumulated fatigue and proposed deload. Pure and deterministic. A deload is only proposed; accepting it is a temporary, reversible record.
import { plateau } from './routine-review.js';
import { countsForProgression } from './progression-policy.js';
/* eslint-disable @typescript-eslint/no-explicit-any */
type Obj = Record<string, any>;

export const HIGH_POINTS = 6;
export const ELEVATED_POINTS = 3;
export const DELOAD_DAYS = 7;
export const DELOAD_VOLUME_CUT = 0.35;
export const DELOAD_LOAD_CUT = 0.075;
export const DELOAD_RIR = 3;
export const DELOAD_COOLDOWN_DAYS = 14;

const ISO = /^\d{4}-\d{2}-\d{2}$/;
const DAY = 86400000;
const day = (iso: string) => Date.parse(iso + 'T12:00:00Z');
const daysBetween = (a: string, b: string) => Math.round((day(b) - day(a)) / DAY);
const addDays = (iso: string, n: number) => new Date(day(iso) + n * DAY).toISOString().slice(0, 10);
const num = (x: unknown): number | null => (typeof x === 'number' && Number.isFinite(x) ? x : null);
const isWork = (s: Obj | null | undefined): boolean => !!s && !!s.done && s.type !== 'warmup';
/** One effort scale: RPE = 10 − RIR. */
const effortOf = (s: Obj | null | undefined): number | null => (num(s?.rpe) != null ? s!.rpe : num(s?.rir) != null ? 10 - s!.rir : null);
const mean = (a: number[]): number | null => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : null);

/** Sessions of the last `days` days, oldest first, without deload-week entries. */
export function recentSessions(S: Obj, today: string, days = 28): Obj[] {
  const from = addDays(today, -(days - 1));
  return ((S?.workouts as Obj[]) || [])
    .filter((w: Obj) => countsForProgression(w) && ISO.test(w.d || '') && w.d >= from && w.d <= today)
    .map((w: Obj): Obj => ({ ...w, entries: (Array.isArray(w.entries) ? w.entries : []).filter((e: Obj) => e && typeof e === 'object' && !e.target?.deload) }))
    .filter((w: Obj) => w.entries.length)
    .sort((a: Obj, b: Obj) => (a.d < b.d ? -1 : a.d > b.d ? 1 : (a.start || 0) - (b.start || 0)));
}

/** Average sleep over the last 7 days in hours; null with fewer than 3 nights. */
export function sleepHours(S: Obj, today: string): number | null {
  const from = addDays(today, -6);
  const nights = ((S?.sleep as Obj[]) || []).filter(x => x && ISO.test(x.d || '') && x.d >= from && x.d <= today && (num(x.v) ?? 0) > 0);
  return nights.length >= 3 ? (mean(nights.map(x => x.v as number)) as number) / 60 : null;
}

export interface FatigueSignal { code: string; points: number; family: string; n?: number | undefined; hours?: number | undefined; pct?: number | undefined; mrv?: boolean | undefined }
export interface FatigueState { level: 'normal' | 'elevated' | 'high'; points: number; families: string[]; signals: FatigueSignal[]; sessions: number; enough: boolean }

export function fatigueState(S: Obj, today: string, ctx: Obj = {}): FatigueState {
  const sessions = recentSessions(S, today);
  const signals: FatigueSignal[] = [];
  const add = (code: string, points: number, family: string, extra: Partial<FatigueSignal> = {}) => signals.push({ code, points, family, ...extra });
  if (sessions.length >= 3) {
    const p = plateau(sessions);
    const r = (code: string) => p.reasons.find(x => x.code === code);
    const effortUp = r('effort_up'), hard = r('hard'), misses = r('misses'), incomplete = r('incomplete');
    if (effortUp) add('effort_up', 2 + ((effortUp.n ?? 0) >= 2 ? 1 : 0), 'effort', { n: effortUp.n });
    if (hard) add('hard', (hard.n ?? 0) >= 3 ? 3 : 2, 'effort', { n: hard.n });
    if (misses) add('misses', (misses.n ?? 0) >= 2 ? 3 : 2, 'failures', { n: misses.n });
    if (incomplete) add('incomplete', 1, 'failures', { n: incomplete.n });
  }
  if (ctx.checkins !== false) {
    const from = addDays(today, -13);
    const n = ((S?.checkins as Obj[]) || []).filter(c => c && ISO.test(c.d || '') && c.d >= from && c.d <= today && (num(c.fatigue) ?? 0) >= 4).length;
    if (n >= 3) add('checkins', 2, 'wellbeing', { n });
  }
  const sleep = sleepHours(S, today);
  if (sleep != null && sleep < 6.5) add('sleep', sleep < 6 ? 2 : 1, 'sleep', { hours: Math.round(sleep * 10) / 10 });
  if (num(ctx.recovery) != null && ctx.recovery < 60) add('recovery', ctx.recovery < 40 ? 2 : 1, 'recovery', { pct: Math.round(ctx.recovery) });
  if (ctx.volume) {
    if (ctx.volume.over >= 1) add('volume', 2, 'load', { n: ctx.volume.over, mrv: true });
    else if (ctx.volume.high >= 2) add('volume', 1, 'load', { n: ctx.volume.high });
  }
  const points = signals.reduce((n, s) => n + s.points, 0);
  const families = [...new Set(signals.map(s => s.family))];
  const level = points >= HIGH_POINTS && families.length >= 2 ? 'high' : points >= ELEVATED_POINTS ? 'elevated' : 'normal';
  return { level, points, families, signals, sessions: sessions.length, enough: sessions.length >= 3 };
}

export interface DeloadRecord { from: string; until: string; volumeCut?: number; loadCut?: number; rir?: number; days?: number; signals?: FatigueSignal[]; points?: number }

/** Is a deload adjustment running on `today`? */
export function activeDeload(S: Obj, today: string): DeloadRecord | null {
  const d = S?.deload as DeloadRecord | undefined;
  return d && ISO.test(d.from || '') && ISO.test(d.until || '') && d.from <= today && today < d.until ? d : null;
}

/** A proposal only when fatigue is HIGH, nothing is running and nothing was just ended or dismissed. Never applied by itself. */
export function deloadProposal(S: Obj, today: string, ctx: Obj = {}): DeloadRecord | null {
  if (activeDeload(S, today)) return null;
  const quiet = [S?.deloadDismissed, S?.deload?.until].filter((d: unknown): d is string => typeof d === 'string' && ISO.test(d));
  if (quiet.some(d => daysBetween(d, today) < DELOAD_COOLDOWN_DAYS && daysBetween(d, today) >= 0)) return null;
  const f = fatigueState(S, today, ctx);
  if (f.level !== 'high') return null;
  return { from: today, until: addDays(today, DELOAD_DAYS), days: DELOAD_DAYS, volumeCut: DELOAD_VOLUME_CUT, loadCut: DELOAD_LOAD_CUT, rir: DELOAD_RIR, signals: f.signals, points: f.points };
}

/** The member accepts: a temporary 1-week adjustment record. Routines and programs are not touched. */
export function applyDeload(S: Obj, today: string, proposal: DeloadRecord | null, by = 'member'): boolean {
  if (!ISO.test(today || '') || !proposal) return false;
  S.deload = { from: today, until: addDays(today, proposal.days || DELOAD_DAYS), volumeCut: proposal.volumeCut ?? DELOAD_VOLUME_CUT, loadCut: proposal.loadCut ?? DELOAD_LOAD_CUT,
    rir: proposal.rir ?? DELOAD_RIR, why: (proposal.signals || []).map(s => s.code), by };
  return true;
}
/** "Keep my plan": no deload now, and no new proposal for DELOAD_COOLDOWN_DAYS. */
export function keepPlan(S: Obj, today: string): boolean { if (!ISO.test(today || '')) return false; S.deloadDismissed = today; return true; }
/** Back to the normal plan before the week is over. */
export function cancelDeload(S: Obj, today: string): boolean { if (!S?.deload) return false; delete S.deload; S.deloadDismissed = today; return true; }

export interface ReadinessReason { code: string; impact: number; signal?: string | undefined; n?: number | undefined; hours?: number | undefined; pct?: number | undefined; points?: number | undefined }
export interface Readiness { state: 'push' | 'maintain' | 'adjust' | 'recover'; score: number; level: string; reasons: ReadinessReason[] }

/** Today's readiness, or null when there is nothing real to base it on. */
export function readiness(S: Obj, today: string, ctx: Obj = {}): Readiness | null {
  const f = fatigueState(S, today, ctx);
  const sessions = recentSessions(S, today);
  const rated = sessions.some(w => w.entries.some((e: Obj) => (e.sets || []).some((s: Obj) => isWork(s) && effortOf(s) != null)));
  const sleep = sleepHours(S, today);
  const recovery = num(ctx.recovery);
  const today1: Obj | null = (Array.isArray(S?.checkins) && ctx.checkins !== false) ? (S.checkins as Obj[]).find(c => c && c.d === today) || null : null;
  if (!rated && sleep == null && recovery == null && !today1) return null;
  const parts: (ReadinessReason)[] = [];
  const add = (code: string, impact: number, extra: Partial<ReadinessReason> = {}) => { if (impact) parts.push({ code, impact, ...extra }); };
  if (sleep != null) add(sleep >= 7.5 ? 'sleep_good' : sleep >= 6.5 ? 'sleep_ok' : 'sleep_low', sleep >= 7.5 ? 8 : sleep >= 6.5 ? 0 : sleep >= 6 ? -8 : -18, { hours: Math.round(sleep * 10) / 10 });
  if (recovery != null) add(recovery >= 80 ? 'recovery_good' : recovery >= 60 ? 'recovery_ok' : 'recovery_low', recovery >= 80 ? 10 : recovery >= 60 ? 0 : recovery >= 40 ? -10 : -20, { pct: Math.round(recovery) });
  if (today1) {
    if ((num(today1.energy) ?? -1) >= 4) add('checkin_good', 5);
    else if ((num(today1.energy) ?? 99) <= 2) add('checkin_low', -8);
    if ((num(today1.fatigue) ?? 0) >= 4) add('checkin_tired', -8);
  }
  const easy = easyStreak(sessions);
  if (easy) add('headroom', 5, { n: easy });
  const trainingPoints = f.signals.filter(s => s.family === 'effort' || s.family === 'failures').reduce((n, s) => n + s.points, 0);
  if (trainingPoints >= HIGH_POINTS) add('fatigue_high', -35, { points: f.points });
  else if (trainingPoints >= ELEVATED_POINTS) add('fatigue_elevated', -15, { points: f.points });
  const score = Math.max(0, Math.min(100, Math.round(75 + parts.reduce((n, p) => n + p.impact, 0))));
  const state = f.level === 'high' || score < 40 ? 'recover' : f.level === 'elevated' || score < 60 ? 'adjust' : score >= 80 && f.level === 'normal' ? 'push' : 'maintain';
  const sig: ReadinessReason[] = f.level === 'normal' ? [] : f.signals.slice(0, 2).map(x => ({ code: 'signal', signal: x.code, impact: 0, n: x.n, hours: x.hours, pct: x.pct }));
  const main = parts.filter(p => !(f.level !== 'normal' && p.code.startsWith('fatigue_'))).sort((a, b) => Math.abs(b.impact) - Math.abs(a.impact));
  const reasons = [...sig, ...main].slice(0, 3);
  return { state, score, level: f.level, reasons };
}

// The last 3 sessions all had rated working sets at RPE ≤ 7: repeated clearly easy effort means room to push.
function easyStreak(sessions: Obj[]): number {
  const last = sessions.slice(-3);
  if (last.length < 3) return 0;
  const avg = (w: Obj) => mean(w.entries.flatMap((e: Obj) => (e.sets || []).filter(isWork).map(effortOf).filter((x: number | null): x is number => x != null)));
  const a = last.map(avg);
  return a.every(x => x != null && x <= 7) ? 3 : 0;
}
