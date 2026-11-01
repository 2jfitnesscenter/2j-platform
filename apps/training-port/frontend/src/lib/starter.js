// The Push/Pull/Legs starter plan. Shared by the "Load starter plan" action in Settings
// and by the demo build, which seeds a history on top of exactly these routines.
import { uid } from './format.js'
import { t } from './i18n.js'
import { EXIDX } from './exercises.js'

const SPEC = [
  ['Push Day', 'barbell', [['0025', 4, 8], ['0047', 3, 10], ['0426', 3, 10], ['0334', 3, 12], ['0241', 3, 12], ['0251', 3, 10]]],
  ['Pull Day', 'pullup', [['2330', 4, 10], ['0027', 4, 8], ['1323', 3, 10], ['0031', 3, 10], ['0313', 3, 12]]],
  ['Leg Day', 'legs', [['0043', 4, 8], ['0085', 3, 10], ['0739', 3, 12], ['0585', 3, 12], ['0586', 3, 12], ['0605', 4, 15]]]
]

// A second pass through the same 3 days, same body parts and slot order as SPEC (so
// GOAL_RULES' compound/accessory-by-index logic still applies identically), but different
// specific exercises — for 4-6 day plans, where the 3-routine pool has to run more than once
// a week. Reusing SPEC verbatim on a repeat day looked like a bug (same routine, same id,
// same exercises on two different weekdays) rather than a deliberate higher-frequency week.
const SPEC_B = [
  ['Push Day B', 'barbell', [['0289', 4, 8], ['0314', 3, 10], ['0405', 3, 10], ['0178', 3, 12], ['0060', 3, 12], ['0308', 3, 10]]],
  ['Pull Day B', 'pullup', [['0818', 4, 10], ['3017', 4, 8], ['0861', 3, 10], ['0070', 3, 10], ['0165', 3, 12]]],
  ['Leg Day B', 'legs', [['0046', 4, 8], ['1459', 3, 10], ['0760', 3, 12], ['0585', 3, 12], ['0599', 3, 12], ['0594', 4, 15]]]
]

// Fresh routine objects (new ids) — [push, pull, legs]. Used as-is by the demo build's seeded
// history (frontend/src/lib/demoSeed.js) — keep this zero-arg and general-purpose; goal/day
// customization lives in buildPlan below instead of changing this signature.
export const starterRoutines = () =>
  SPEC.map(([name, emoji, list]) => ({ id: uid(), name: t(name), emoji, ex: list.map(([id, sets, reps]) => ({ id, sets, reps, weight: 0 })) }))

/* ---------------------------------------------------------------------------------------
 * Goal-aware plan builder — the same Push/Pull/Legs exercise selection, but the rep range,
 * set count and how many days a week it runs are chosen from what was actually asked for
 * instead of the fixed 3-days/general-fitness defaults above.
 *
 * The 6 goals and their rep/set/RIR ranges come from Juanjo's own reference table (exact
 * source, not an approximation) and are deliberately mirrored in api/coach/prompts/create.md
 * — a quick plan and an AI Coach plan should mean the same thing by "hypertrophy" or "power".
 * The api/server.js admin endpoint (apply-starter-plan) duplicates this table too, for the
 * same reason payload.js duplicates other frontend logic: the two runtimes share no build step.
 *
 * The table gives one series/rep/RIR range per exercise, not a compound-vs-accessory split —
 * this app's routines put the main lift first and accessories after, so the compound side
 * below uses the lower-reps/higher-sets end of each range (more work on the exercise that
 * matters most) and accessory uses the higher-reps/lower-sets end. RIR/RPE has no field in the
 * plan schema (sets/reps/weight only) — it's carried in create.md as guidance for the AI Coach
 * to write into its own `why` text and pacing, not something this deterministic tool can set.
 * ------------------------------------------------------------------------------------- */
export const GOALS = ['hypertrophy', 'toning', 'fatloss', 'power', 'plyometrics', 'longevity']
// [reps, sets] for the routine's first (compound) exercise vs the rest (accessories).
export const GOAL_RULES = {
  hypertrophy: { compound: [8, 4], accessory: [12, 3], superset: false },
  toning: { compound: [10, 4], accessory: [15, 3], superset: false },
  fatloss: { compound: [8, 4], accessory: [12, 3], superset: true },
  power: { compound: [3, 5], accessory: [5, 3], superset: false },
  // Juanjo's framing: plyometrics here means loaded strength patterns done explosively,
  // combining strength with power — not bodyweight jump-contact training — so it uses the
  // same barbell/dumbbell pool as every other goal rather than needing its own exercise set.
  plyometrics: { compound: [5, 4], accessory: [5, 3], superset: false },
  longevity: { compound: [10, 3], accessory: [12, 2], superset: false }
}

// How many exercises a session length keeps, anchored at ~5 for a 30-min session up to the
// slot's own full curated count by ~90 min (never padded past what's actually curated for that
// slot — see buildPlan's own doc comment on why this doesn't try to reach further than that).
const exerciseCountFor = (sessionMin, poolSize) => {
  if (!sessionMin) return poolSize
  const target = Math.round(5 + (sessionMin - 30) * 7 / 90)
  return Math.max(3, Math.min(poolSize, target))
}

/* ---------------------------------------------------------------------------------------
 * Exercise-variant picking — SPEC and SPEC_B are two full, hand-curated exercise sets with the
 * same shape (same slot, same position, same body part/target muscle at each position), so a
 * routine no longer has to commit to "all A" or "all B": each position independently picks its
 * SPEC id or its SPEC_B id, which is what actually makes two plans for the same goal/day count
 * look different from each other, and what makes a regenerate ("Crear mi plan" again) worth
 * doing. See starter.js's own module comment above GOAL_RULES for why goal-driven bias only
 * applies to positions where the two picks genuinely differ in character.
 * ------------------------------------------------------------------------------------- */
const FREE_EQ = new Set(['barbell', 'dumbbell', 'ez barbell', 'olympic barbell', 'kettlebell', 'trap bar'])
const MACHINE_EQ = new Set(['cable', 'leverage machine', 'sled machine', 'smith machine'])
const styleOf = id => { const eq = EXIDX[id]?.eq; return FREE_EQ.has(eq) ? 'free' : MACHINE_EQ.has(eq) ? 'machine' : null }
// Mirrors create.md's own wording for each goal's equipment character (explosive free-weight
// compounds for power/plyometrics; controlled, joint-friendly machine work for toning/fatloss/
// longevity). hypertrophy has no entry — its own goal note calls for exercise variety instead of
// a specific equipment feel, so it's a coin flip like every position with no style difference.
const GOAL_STYLE = { power: 'free', plyometrics: 'free', toning: 'machine', fatloss: 'machine', longevity: 'machine' }

// Picks 'A' (SPEC) or 'B' (SPEC_B) for one position. `exclude` forces the other letter — used
// when this slot already ran once this week and can't repeat the same exercise.
function pickVariant(idA, idB, goal, exclude) {
  if (exclude === 'A') return 'B'
  if (exclude === 'B') return 'A'
  const style = GOAL_STYLE[goal]
  if (style) {
    const aFits = styleOf(idA) === style, bFits = styleOf(idB) === style
    if (aFits && !bFits) return 'A'
    if (bFits && !aFits) return 'B'
  }
  return Math.random() < 0.5 ? 'A' : 'B'
}

// Builds one routine, blending SPEC and SPEC_B position by position (see above). Returns the
// letters actually used alongside the routine, so buildPlan can forbid reusing them if this same
// slot comes around again later in the week.
function makeRoutine(slot, rules, sessionMin, goal, excludeLetters) {
  const [name, emoji, fullListA] = SPEC[slot]
  const [, , fullListB] = SPEC_B[slot]
  const count = exerciseCountFor(sessionMin, fullListA.length)
  const letters = []
  const ex = []
  for (let i = 0; i < count; i++) {
    const [idA] = fullListA[i]
    const [idB] = fullListB[i]
    const letter = pickVariant(idA, idB, goal, excludeLetters && excludeLetters[i])
    letters.push(letter)
    const [reps, sets] = i === 0 ? rules.compound : rules.accessory
    ex.push({ id: letter === 'A' ? idA : idB, sets, reps, weight: 0 })
  }
  // Density over rest for fat loss, or whenever the session itself is short — pair up
  // consecutive accessories (skipping the compound at index 0) as supersets, two at a time.
  if (rules.superset || (sessionMin && sessionMin <= 45)) {
    for (let i = 1; i + 1 < ex.length; i += 2) { const tag = 'a' + i; ex[i].sg = tag; ex[i + 1].sg = tag }
  }
  return { routine: { id: uid(), name: t(name), emoji, ex }, letters }
}

// Which of the 3 SPEC slots (0=Push, 1=Pull, 2=Legs) each muscle-priority pick (see
// frontend/src/lib/muscle-priority.js) actually trains here. `abs` isn't covered by any of the 3
// PPL days, so it can't move which day gets picked — it only ever matters to the AI Coach,
// which builds exercise-by-exercise instead of picking between 3 fixed templates.
const MUSCLE_ROUTINE = {
  chest: 0, shoulders: 0, triceps: 0,
  back: 1, biceps: 1,
  quads: 2, glutes: 2, hamstrings: 2, calves: 2
}

// Ranks the 3 routine slots by how much the member's priorities point at them — primary picks
// count double a secondary one. Ties keep the natural Push→Pull→Legs order, so with no
// priorities set this is just [0, 1, 2] and every plan behaves exactly as before.
function routineOrder(primary, secondary) {
  const score = [0, 0, 0]
  ;(primary || []).forEach(m => { const s = MUSCLE_ROUTINE[m]; if (s !== undefined) score[s] += 2 })
  ;(secondary || []).forEach(m => { const s = MUSCLE_ROUTINE[m]; if (s !== undefined) score[s] += 1 })
  return [0, 1, 2].sort((a, b) => score[b] - score[a] || a - b)
}

/**
 * @param {string} goal one of GOALS — falls back to 'longevity' if unrecognised
 * @param {number[]} days weekday numbers (0=Sunday..6=Saturday) to schedule, in order.
 * @param {string[]} [primary] muscle slugs (muscles.js) the member most wants to prioritize.
 * @param {string[]} [secondary] muscle slugs they want a smaller bump to.
 * @param {number} [sessionMin] minutes per session — trims each routine's exercise count down
 *   from its full curated list for a shorter session (never grows past it — see makeRoutine's
 *   exerciseCountFor) and turns supersets on for sessions of 45 minutes or less.
 *
 * With no priorities, the 3 routines run in the natural Push→Pull→Legs order: 2 or 3 days
 * picks that many of the 3, 4-6 days cycles back through them (see makeRoutine above for how a
 * repeat day avoids literally reusing the same exercises). With priorities set, the routine(s)
 * that train the prioritized muscles are the ones kept when the day count is under 3, and the
 * ones repeated first when it's over 3 — so "quads/glutes" at 4 days a week gets Push, Pull,
 * Legs, Legs again instead of a second Push day, and at 2 days a week gets Push+Legs instead of
 * dropping Legs entirely.
 *
 * Every call reshuffles which SPEC/SPEC_B exercise wins at each position (goal-biased where the
 * two differ in equipment character, a coin flip otherwise — see makeRoutine/pickVariant), so
 * generating a plan for the same goal and day count twice in a row won't produce an identical
 * result. Reopening "Cargar plan inicial" and building again is the reroll.
 */
export function buildPlan(goal, days, primary, secondary, sessionMin) {
  const rules = GOAL_RULES[goal] || GOAL_RULES.longevity
  const order = routineOrder(primary, secondary)
  const n = (days || []).length
  let slots
  if (n <= 3) {
    const chosen = new Set(order.slice(0, n))
    slots = [0, 1, 2].filter(s => chosen.has(s))
  } else {
    slots = [0, 1, 2]
    for (let extra = 0; slots.length < n; extra++) slots.push(order[extra % 3])
  }
  const routines = []
  const week = {}
  const usedByLap0 = {}   // slot -> letters[] picked on that slot's first occurrence this week
  ;(days || []).forEach((d, i) => {
    const slot = slots[i]
    const lap = slots.slice(0, i).filter(s => s === slot).length
    const { routine, letters } = makeRoutine(slot, rules, sessionMin, goal, lap === 0 ? null : usedByLap0[slot])
    if (lap === 0) usedByLap0[slot] = letters
    routines.push(routine)
    week[d] = routine.id
  })
  return { routines, week }
}
