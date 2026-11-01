// Which muscles an exercise trains, and how hard — the data behind every muscle map.
//
// The exercise dataset names muscles in free text and is not consistent about it:
// "shoulders", "deltoids" and "delts" are the same thing, so are "quads" and
// "quadriceps", "lats" and "latissimus dorsi", "core" and "abdominals". Nineteen
// primary and forty secondary spellings collapse onto the eighteen muscles the body
// map can actually draw, via ALIAS below. Anything genuinely undrawable (hands,
// ankles, "cardiovascular system") maps to null and is dropped rather than guessed at.

import { EXIDX } from './exercises.js'
import { countsForProgression } from './workout-policy.js'

// The muscles a map can shade, in head-to-toe order — also the order of any list
// built from them, so "what am I neglecting" reads top-down like a body.
export const MUSCLES = [
  'trapezius', 'deltoids', 'chest', 'upper-back', 'serratus',
  'biceps', 'triceps', 'forearm',
  'abs', 'obliques', 'lower-back',
  'gluteal', 'quadriceps', 'hamstring', 'adductors', 'hip-flexors',
  'calves', 'tibialis',
]

// Drawn as the silhouette, never shaded: they carry no training load.
export const INERT = ['head', 'hair', 'neck', 'hands', 'feet', 'knees', 'ankles']

// Browsing categories for the exercise library's "by muscle" screen — coarser than the
// 18 map slugs above on purpose. Several of those slugs are the same region on the
// illustrated chips (public/muscles/chip_img_<photo>[_female].webp — upper vs lower
// back, adductors vs hip flexors vs glutes, calves vs tibialis, serratus/obliques vs
// abs) and nobody browses "serratus exercises" as its own category anyway, so each
// group here covers every slug its one photo actually shows. Filtering an exercise
// checks all of a group's slugs, so this only merges *tiles*, not what matches.
export const MUSCLE_GROUPS = [
  { key: 'trapezius', name: 'Traps', photo: 'neck', slugs: ['trapezius'] },
  { key: 'deltoids', name: 'Shoulders', photo: 'shoulders', slugs: ['deltoids'] },
  { key: 'chest', name: 'Chest', photo: 'chest', slugs: ['chest'] },
  { key: 'back', name: 'Back muscles', photo: 'back', slugs: ['upper-back', 'lower-back'] },
  { key: 'biceps', name: 'Biceps', photo: 'biceps', slugs: ['biceps'] },
  { key: 'triceps', name: 'Triceps', photo: 'triceps', slugs: ['triceps'] },
  { key: 'forearm', name: 'Forearms', photo: 'forearms', slugs: ['forearm'] },
  { key: 'abs', name: 'Abs', photo: 'abs', slugs: ['abs', 'obliques', 'serratus'] },
  { key: 'gluteal', name: 'Glutes', photo: 'hips', slugs: ['gluteal', 'adductors', 'hip-flexors'] },
  { key: 'quadriceps', name: 'Quads', photo: 'quadriceps', slugs: ['quadriceps'] },
  { key: 'hamstring', name: 'Hamstrings', photo: 'hamstrings', slugs: ['hamstring'] },
  { key: 'calves', name: 'Calves', photo: 'calves', slugs: ['calves', 'tibialis'] },
]
export const musclePhotoUrl = (photo, body) =>
  `/muscles/chip_img_${photo}${body === 'female' ? '_female' : ''}.webp`

// A custom exercise (sheets.jsx's CustomExForm) now picks one of the 12 groups above
// directly, instead of one of the 10 coarser body parts — but `bp` itself is still
// load-bearing elsewhere (isCardio, lib/progression.js's heavy-lift detection, and every
// exercise card's `tg || bp` subtitle fallback), so a chosen group is mapped back to its
// own body part here rather than dropping `bp` for customs. Every group maps to exactly
// one body part; the reverse (BY_BODYPART below) can span several groups, since a body
// part is coarser than a muscle group.
export const GROUP_TO_BODYPART = {
  trapezius: 'neck', deltoids: 'shoulders', chest: 'chest', back: 'back',
  biceps: 'upper arms', triceps: 'upper arms', forearm: 'lower arms',
  abs: 'waist', gluteal: 'upper legs', quadriceps: 'upper legs', hamstring: 'upper legs',
  calves: 'lower legs',
}

// Whether exercise `e`'s resolved primary target lands in muscle group `groupKey` — the one
// filter predicate every exercise picker in the app should share (add-to-routine, the by-muscle
// browser, and the admin exercise-visibility list), so they all agree on what counts as e.g. "a
// back exercise" instead of three separately-tuned definitions. Primary target only (weight >=
// 1), not "any secondary mention" — a basic crunch lists hip flexors and lower back as
// stabilizers, which shouldn't also count as a glute/back exercise here.
export function isInMuscleGroup(e, groupKey, opts) {
  const g = MUSCLE_GROUPS.find(x => x.key === groupKey)
  if (!g) return false
  const m = musclesOf(e, opts)
  return g.slugs.some(s => (m[s] || 0) >= 1)
}

// English display names; these strings are the i18n keys (see lib/i18n.js).
export const MUSCLE_NAME = {
  trapezius: 'Traps', deltoids: 'Shoulders', chest: 'Chest', 'upper-back': 'Upper back',
  serratus: 'Serratus', biceps: 'Biceps', triceps: 'Triceps', forearm: 'Forearms',
  abs: 'Abs', obliques: 'Obliques', 'lower-back': 'Lower back', gluteal: 'Glutes',
  quadriceps: 'Quads', hamstring: 'Hamstrings', adductors: 'Adductors',
  'hip-flexors': 'Hip flexors', calves: 'Calves', tibialis: 'Shins',
}

// Every spelling that occurs in the dataset's `tg` and `sm` fields. null = not drawable.
const ALIAS = {
  // primaries
  abs: 'abs', pectorals: 'chest', biceps: 'biceps', glutes: 'gluteal', delts: 'deltoids',
  triceps: 'triceps', 'upper back': 'upper-back', lats: 'upper-back', calves: 'calves',
  quads: 'quadriceps', forearms: 'forearm', hamstrings: 'hamstring', spine: 'lower-back',
  traps: 'trapezius', adductors: 'adductors', 'serratus anterior': 'serratus',
  abductors: 'gluteal', 'levator scapulae': 'trapezius', 'cardiovascular system': null,
  // secondaries
  shoulders: 'deltoids', deltoids: 'deltoids', 'rear deltoids': 'deltoids',
  'rotator cuff': 'deltoids', quadriceps: 'quadriceps', core: 'abs', abdominals: 'abs',
  'lower abs': 'abs', chest: 'chest', 'upper chest': 'chest', 'hip flexors': 'hip-flexors',
  obliques: 'obliques', 'lower back': 'lower-back', rhomboids: 'upper-back',
  trapezius: 'trapezius', back: 'upper-back', 'latissimus dorsi': 'upper-back',
  brachialis: 'biceps', soleus: 'calves', shins: 'tibialis', wrists: 'forearm',
  'wrist flexors': 'forearm', 'wrist extensors': 'forearm', 'grip muscles': 'forearm',
  groin: 'adductors', 'inner thighs': 'adductors',
  ankles: null, feet: null, hands: null, 'ankle stabilizers': null,
  sternocleidomastoid: null,
}

// Custom exercises carry only a body part, so they fall back to it. Weights inside a
// group sum to 1 — "upper legs" spreads over three muscles rather than counting triple.
const BY_BODYPART = {
  chest: { chest: 1 },
  back: { 'upper-back': 0.75, 'lower-back': 0.25 },
  shoulders: { deltoids: 1 },
  'upper arms': { biceps: 0.5, triceps: 0.5 },
  'lower arms': { forearm: 1 },
  waist: { abs: 0.7, obliques: 0.3 },
  'upper legs': { quadriceps: 0.4, hamstring: 0.35, gluteal: 0.25 },
  'lower legs': { calves: 0.8, tibialis: 0.2 },
  neck: { trapezius: 1 },
  cardio: {},
}

// Default weight a supporting muscle counts against a primary. Overridable per call (Settings
// → Statistics → "Secondary muscle factor") — see musclesOf's `opts`.
const SECONDARY = 0.4
export const SECONDARY_FACTORS = [0.25, 0.33, 0.5, 0.75]
export const DEFAULT_SECONDARY_FACTOR = 0.5
// Settings → Statistics's two knobs, read off the profile — the one place every caller that
// has `S` in scope builds musclesOf/loadOf's `opts` from, so the two settings can't drift out
// of sync between the muscle map, the stats screen and muscle recovery.
export const muscleOptsOf = S => ({ countSecondary: S.countSecondaryMuscles !== false, secondaryFactor: S.secondaryMuscleFactor })

/**
 * Muscles one exercise trains: { slug: 0…1 }.
 * `opts.countSecondary` (default true) and `opts.secondaryFactor` (default SECONDARY, 0.4) —
 * Settings → Statistics's two knobs on how much a supporting muscle counts. Every caller below
 * (loadOf and friends) threads the same opts through, so a member who turns secondaries off
 * gets that reflected consistently in the muscle map, the stats screen and muscle recovery,
 * not just one of them.
 */
export function musclesOf(ex, opts) {
  if (!ex) return {}
  const countSecondary = !opts || opts.countSecondary !== false
  const secondaryFactor = opts && opts.secondaryFactor > 0 ? opts.secondaryFactor : SECONDARY
  const out = {}
  const add = (name, w) => {
    const slug = ALIAS[String(name || '').toLowerCase().trim()]
    if (slug) out[slug] = Math.max(out[slug] || 0, w)
  }
  add(ex.tg, 1)
  if (countSecondary) (ex.sm || []).forEach(m => add(m, secondaryFactor))
  if (!Object.keys(out).length) {
    // A custom exercise made with the muscle-group picker (`mgKey`) gets full weight on
    // every slug that group covers — there's no split to guess, unlike a body part which
    // can span several muscles. Only older customs (made before mgKey existed) or anything
    // else unrecognised falls back to the guessed body-part distribution.
    const g = ex.mgKey && MUSCLE_GROUPS.find(x => x.key === ex.mgKey)
    if (g) g.slugs.forEach(s => { out[s] = 1 })
    else Object.assign(out, BY_BODYPART[ex.bp] || {})
  }
  return out
}

/**
 * Training load per muscle, in "effective sets".
 * `items` is [{ id, sets }] — sets being a count, so a 4×8 bench press weighs four
 * times a single set. Volume in kg is deliberately not used: 100 kg of leg press
 * against 12 kg of lateral raise says nothing about which muscle worked harder.
 */
export function loadOf(items, opts) {
  const load = {}
  items.forEach(({ id, sets }) => {
    if (!sets) return
    const m = musclesOf(EXIDX[id], opts)
    for (const slug in m) load[slug] = (load[slug] || 0) + m[slug] * sets
  })
  return load
}

/**
 * Load for finished workouts (only sets actually ticked off count, and a warmup never did count
 * as training load). `pick` narrows that further — the map can then answer "where did the
 * *hard* sets go", which is a different question from where the sets went: a muscle can lead on
 * volume and still never be trained near failure. `opts` is musclesOf's secondary-muscle knobs.
 */
export const loadOfWorkouts = (workouts, pick, opts) =>
  loadOf((workouts || []).flatMap(w =>
    !countsForProgression(w) ? [] :
    (w.entries || []).map(e => ({ id: e.id, sets: (e.sets || []).filter(s => s.done && s.type !== 'warmup' && (!pick || pick(s))).length }))), opts)

/** Load a routine *would* produce, from its planned set counts. */
export const loadOfRoutine = (routine, opts) =>
  loadOf((routine?.ex || []).map(c => ({ id: c.id, sets: c.sets || 1 })), opts)

/** Load for a workout still in progress — the sets ticked so far. */
export const loadOfActive = (active, opts) =>
  loadOf((active?.entries || []).map(e => ({ id: e.id, sets: (e.sets || []).filter(s => s.done).length })), opts)

/**
 * Shade buckets 0–4 per muscle, relative to the hardest-worked muscle in the same
 * window. Relative rather than absolute on purpose: the map answers "is my training
 * balanced", which only means anything as a comparison within one period.
 */
export function levelsOf(load) {
  const max = Math.max(0, ...MUSCLES.map(m => load[m] || 0))
  const lv = {}
  MUSCLES.forEach(m => {
    const v = load[m] || 0
    lv[m] = !v ? 0 : max <= 0 ? 0 : Math.max(1, Math.min(4, Math.ceil(v / max * 4)))
  })
  return lv
}

/** Muscles sorted hardest-worked first; untrained ones last, in body order. */
export function rankOf(load) {
  const worked = MUSCLES.filter(m => (load[m] || 0) > 0).sort((a, b) => load[b] - load[a])
  const missed = MUSCLES.filter(m => !(load[m] > 0))
  return { worked, missed }
}

/**
 * Each worked muscle's share of the total load, rounded to a whole percent — "44% of
 * this routine is triceps". Rounded independently per muscle rather than forced to sum
 * to 100, so one routine's numbers stay stable as you add exercises elsewhere.
 */
export function pctOf(load) {
  const total = MUSCLES.reduce((s, m) => s + (load[m] || 0), 0)
  const pct = {}
  MUSCLES.forEach(m => { if (load[m] > 0) pct[m] = Math.round(load[m] / total * 100) })
  return pct
}
