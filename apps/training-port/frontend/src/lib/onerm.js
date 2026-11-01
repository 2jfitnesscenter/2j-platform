// Estimated one-rep max (issue #18).
//
// Deliberately knows nothing about the exercise database: an estimate needs a weight AND a
// rep count, and only reps-mode sets carry both. Cardio sets ({min, speed}) and timed sets
// ({sec, w}) therefore drop out of every scan here on their own — there is no exercise-type
// check to keep in sync.
//
// Formulas are the usual submaximal-load estimators. Epley is the default because it is the
// one most lifters have seen; all of them agree closely at low reps and diverge as reps rise,
// which is exactly why REP_CAP exists.
import { countsForProgression } from './workout-policy.js'

// Above this many reps an estimate says more about work capacity than about maximal strength,
// and the formulas disagree by double digits. Refusing to guess beats printing a fantasy.
export const REP_CAP = 12

export const FORMULAS = {
  // Epley 1985 — w · (1 + r/30)
  epley: (w, r) => w * (1 + r / 30),
  // Brzycki 1993 — w · 36/(37 − r); undefined at r ≥ 37, but REP_CAP is far below that
  brzycki: (w, r) => w * 36 / (37 - r),
  // Lombardi 1989 — w · r^0.10
  lombardi: (w, r) => w * Math.pow(r, 0.1)
}
export const DEFAULT_FORMULA = 'epley'

// Estimate a 1RM from one set. Returns null for anything it cannot honestly answer:
// missing/zero/negative load, no reps, non-finite input, or more reps than REP_CAP.
// A single rep is not an estimate — it is the measurement — and comes back unchanged.
export function estimate1RM(w, r, formula = DEFAULT_FORMULA) {
  const weight = Number(w)
  const reps = Number(r)
  if (!isFinite(weight) || !isFinite(reps)) return null
  if (weight <= 0 || reps < 1) return null
  if (reps > REP_CAP) return null
  const fn = FORMULAS[formula] || FORMULAS[DEFAULT_FORMULA]
  const est = reps === 1 ? weight : fn(weight, Math.round(reps))
  if (!isFinite(est) || est <= 0) return null
  return Math.round(est * 10) / 10
}

// Best estimate out of one workout entry's completed sets.
// `topW` is ignored on purpose: it records the working weight a user confirmed after the
// exercise, with no rep count attached, so it cannot produce an estimate.
export function bestSetOf(entry, formula = DEFAULT_FORMULA) {
  let best = null
  ;(entry?.sets || []).forEach(s => {
    if (!s.done) return
    const est = estimate1RM(s.w, s.r, formula)
    if (est !== null && (!best || est > best.est)) best = { est, w: Number(s.w), r: Math.round(Number(s.r)) }
  })
  return best
}

// One point per workout in which the exercise produced an estimate — feeds the trend chart.
// Chronological, matching the order workouts are appended in.
export function e1rmSeries(S, exId, formula = DEFAULT_FORMULA) {
  const pts = []
  ;(S.workouts || []).forEach(w => {
    if (!countsForProgression(w)) return
    const entry = (w.entries || []).find(e => e.id === exId)
    if (!entry) return
    const best = bestSetOf(entry, formula)
    if (best) pts.push({ t: w.start, d: w.d, y: best.est, w: best.w, r: best.r })
  })
  return pts
}

// All-time best estimate for an exercise, with the set and date it came from — the source
// matters, because "142.5 kg est. from 100×10" is a very different claim from "from 140×1".
export function best1RM(S, exId, formula = DEFAULT_FORMULA) {
  let best = null
  e1rmSeries(S, exId, formula).forEach(p => { if (!best || p.y > best.est) best = { est: p.y, w: p.w, r: p.r, d: p.d, t: p.t } })
  return best
}

// Did this workout beat every estimate that came before it? Used for the finish summary,
// so it compares against history that does not yet contain `w`.
export function is1RMRecord(S, exId, entry, formula = DEFAULT_FORMULA) {
  const now = bestSetOf(entry, formula)
  if (!now) return null
  const prev = best1RM(S, exId, formula)
  return !prev || now.est > prev.est ? { ...now, prev: prev ? prev.est : 0 } : null
}

// ---- standalone tests (Actions → "Start a test session"), separate from anything logged in a
// workout — see store/useStore.js's `S.tests` for the flat array all three test types share.

// Every 1RM test on file for one exercise, most recent first — the "history" shown inside
// ExerciseDetail.
export function oneRMTests(S, exId) {
  return (S.tests || [])
    .filter(x => x.type === '1rm' && x.exId === exId)
    .sort((a, b) => (a.d < b.d ? 1 : a.d > b.d ? -1 : 0))
}
// The number a routine's 'pct1rm' progression policy (lib/progression.js) actually reads: the
// highest estimate on record for this exercise from a deliberate test, not from a workout set —
// a tested max is a claim worth trusting more than what happened to come up mid-session.
export function bestTestedOneRM(S, exId) {
  const tests = oneRMTests(S, exId)
  return tests.length ? tests.reduce((a, b) => (b.est1RM > a.est1RM ? b : a)) : null
}

// Either kind of known best represents a genuine ability — a workout set is real
// performance, a dedicated test is a deliberate attempt — so a consumer that just wants
// "the best this person has ever shown for this exercise" (lib/rank.js) wants whichever
// is higher, not one source picked over the other.
export function bestKnownOneRM(S, exId, formula = DEFAULT_FORMULA) {
  const a = best1RM(S, exId, formula)
  const b = bestTestedOneRM(S, exId)
  const av = a ? a.est : -Infinity
  const bv = b ? b.est1RM : -Infinity
  if (av === -Infinity && bv === -Infinity) return null
  return av >= bv ? a.est : b.est1RM
}

// %1RM by effective rep count — the standard submaximal-load table (1 rep=100% down to 12=70%),
// linearly interpolated between the known points. RIR folds in as extra effective reps (each RIR
// is roughly one more rep of room, the same logic the RIR/RPE scale itself is built on — see
// EFFORT/stepEffort in lib/history.js) rather than a second table to keep in sync with this one.
const PCT_1RM_TABLE = [[1, 1], [2, .95], [3, .92], [4, .89], [5, .87], [6, .85], [7, .83], [8, .8], [9, .77], [10, .75], [11, .72], [12, .7]]
export function pctForReps(reps, rir = 0) {
  // Not rounded to a whole rep — RIR is routinely logged in halves (see EFFORT in
  // lib/history.js), and losing that precision here would round two adjacent RIR values onto
  // the exact same percentage.
  const effective = Math.max(1, Math.min(20, Number(reps) + Number(rir)))
  if (effective >= PCT_1RM_TABLE[PCT_1RM_TABLE.length - 1][0]) return PCT_1RM_TABLE[PCT_1RM_TABLE.length - 1][1]
  for (let i = 0; i < PCT_1RM_TABLE.length - 1; i++) {
    const [r0, p0] = PCT_1RM_TABLE[i], [r1, p1] = PCT_1RM_TABLE[i + 1]
    if (effective >= r0 && effective <= r1) return p0 + (p1 - p0) * (effective - r0) / (r1 - r0)
  }
  return PCT_1RM_TABLE[0][1]
}
