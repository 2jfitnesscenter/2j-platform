// Copyright (C) 2026 Juan Jose Perez Sanchez — 2J Fitness Center
// SPDX-License-Identifier: AGPL-3.0-or-later
// Blocks: reusable, versioned templates of a few prescribed exercises. A master block is never
// referenced live by a routine — inserting one copies its entries into the day (a snapshot)
// tagged with an instance id, so editing the day never touches the library and deleting a
// block never breaks a routine. Pure helpers shared by the builder, the server and the seed.
import { PROTOCOL_VERSION, GUIDED_TYPES } from './rules.js'
import { classify } from './classify.js'
import { estimateSeconds, roundMinutes, restDemand, REST_DEFAULTS, modeOfEntry, workSeconds } from './prescribe.js'

export const FOCUS = ['glutes', 'quads', 'hamstrings', 'calves', 'chest', 'back', 'shoulders', 'biceps', 'triceps', 'arms',
  'abs', 'posterior', 'lower', 'upper', 'push', 'pull', 'fullbody', 'cardio']
// Labels are English source strings rendered through t() (Spanish in locales/es.js).
export const FOCUS_LABEL = {
  glutes: 'Glutes', quads: 'Quads', hamstrings: 'Hamstrings', calves: 'Calves', chest: 'Chest', back: 'Back muscles',
  shoulders: 'Shoulders', biceps: 'Biceps', triceps: 'Triceps', arms: 'Arms', abs: 'Core', posterior: 'Posterior chain',
  lower: 'Lower body', upper: 'Upper body', push: 'Push', pull: 'Pull', fullbody: 'Full body', cardio: 'Cardio',
}
export const GOAL_LABEL = { hypertrophy: 'Hypertrophy', strength: 'Strength', general: 'General', endurance: 'Muscular endurance', power: 'Power', beginner: 'Start / return' }
export const LEVEL_LABEL = { beginner: 'Novice', intermediate: 'Intermediate', advanced: 'Advanced' }
export const TYPE_LABEL = { strength: 'Straight sets', superset: 'Superset', circuit: 'Circuit', cardio: 'Cardio', interval: 'Intervals', hiit: 'HIIT', mobility: 'Mobility' }
export const STYLE_LABEL = {
  stable: 'Stable', mixed: 'Mixed', unilateral: 'Unilateral', tension: 'Tension', free: 'Free weights', machine: 'Machines',
  isolation: 'Isolation', density: 'Density', heavy: 'Heavy', volume: 'Volume', foundation: 'Foundation', athletic: 'Athletic',
  pairs: 'Pairs', steady: 'Steady', 'unilateral-isolation': 'Unilateral + isolation', lengthened: 'Long position', 'upper-focus': 'Upper chest',
  vertical: 'Vertical pull', horizontal: 'Horizontal pull', 'hip-dominant': 'Hip dominant', 'knee-dominant': 'Knee dominant', 'low-impact': 'Low impact',
  circuit: 'Circuit', intervals: 'Intervals', tabata: 'Tabata', flow: 'Mobility flow', warmup: 'Warm-up', cooldown: 'Cool-down',
}

// ── guided (timed) blocks — Constructor V2.1 ──────────────────────────────────────────────
// A guided block keeps the one training model: its entries are ordinary routine entries (a
// round = one set of each), and `timing` only says how the executor paces them. Timing is UX,
// not methodology — the protocol still judges the entries (2J-HEU-INTERVAL-ROUNDS for rounds).
//   prep       countdown before the first exercise (s)
//   work       default work time for timed entries (s) — copied into each timed entry's `sec`
//   rest       rest after each work bout (s, 0 = straight on to the next one)
//   rounds     rounds of the whole block (= sets of every entry)
//   roundRest  a longer rest between rounds (s); 0 = the normal `rest` applies there too
//   preset     'tabata' only records where the numbers came from; they stay editable
export const isGuided = type => GUIDED_TYPES.includes(type)
export const TIMING_LIMITS = { prep: [0, 60], work: [5, 600], rest: [0, 300], rounds: [1, 10], roundRest: [0, 600] }
const DEFAULT_TIMING = {
  circuit: { prep: 10, work: 40, rest: 20, rounds: 3, roundRest: 60 },
  interval: { prep: 10, work: 60, rest: 60, rounds: 5, roundRest: 0 },
  hiit: { prep: 10, work: 30, rest: 30, rounds: 6, roundRest: 0 },
  mobility: { prep: 5, work: 40, rest: 5, rounds: 1, roundRest: 0 },
}
// The classic 20 s on / 10 s off × 8 — a starting point, never the only option.
export const TIMING_PRESETS = { tabata: { work: 20, rest: 10, rounds: 8, roundRest: 0 } }
export const defaultTiming = type => isGuided(type) ? { ...DEFAULT_TIMING[type] } : null

/** Whitelist + clamp a block's timing; null for a type that has none. */
export function sanitizeTiming(t, type) {
  if (!isGuided(type)) return null
  const src = t && typeof t === 'object' ? t : {}
  const out = {}
  for (const [k, [lo, hi]] of Object.entries(TIMING_LIMITS)) {
    const n = Math.round(Number(src[k]))
    out[k] = Number.isFinite(n) && src[k] !== null && src[k] !== '' ? Math.min(hi, Math.max(lo, n)) : DEFAULT_TIMING[type][k]
  }
  if (src.preset === 'tabata') out.preset = 'tabata'
  return out
}

/**
 * Shape a guided block's entries to its timing: every entry gets `rounds` sets; interval/HIIT/
 * mobility entries become timed bouts of `work` seconds; a circuit keeps each entry's own mode
 * (timed entries take `work`, rep entries keep their reps). Rest between sets is the timing's,
 * so per-entry `rest` is dropped; a planned RPE array follows the new set count.
 */
export function applyTiming(ex, type, timing) {
  const tm = sanitizeTiming(timing, type)
  if (!tm) return (ex || []).map(e => ({ ...e }))
  return (ex || []).map(e => {
    const out = { ...e, sets: tm.rounds }
    delete out.rest
    const toTime = type !== 'circuit' || modeOfEntry(e) === 'time'
    if (toTime) {
      out.mode = 'time'; out.sec = tm.work; out.weight = out.weight || 0
      for (const k of ['reps', 'targetRepsMin', 'targetRepsMax', 'repsMin', 'min', 'speed']) delete out[k]
    }
    if (Array.isArray(out.rpe) && out.rpe.length) {
      if (type === 'hiit' || type === 'interval' || type === 'mobility') delete out.rpe
      else out.rpe = Array.from({ length: tm.rounds }, (_, i) => e.rpe[i] ?? e.rpe[e.rpe.length - 1])
    }
    return out
  })
}

/** Honest duration of a guided block: prep + every bout and rest the executor will run. */
export function guidedSeconds(ex, timing, type) {
  const tm = sanitizeTiming(timing, type)
  if (!tm || !(ex || []).length) return 0
  const bout = e => modeOfEntry(e) === 'time' ? (Number(e.sec) || tm.work) : workSeconds(e)
  const perRound = ex.reduce((a, e) => a + bout(e), 0) + (ex.length - 1) * tm.rest
  return tm.prep + tm.rounds * perRound + (tm.rounds - 1) * (tm.roundRest > 0 ? tm.roundRest : tm.rest)
}

/** "Glúteo · Hipertrofia · Intermedio B" — built from metadata so it follows the UI language. */
export function blockTitle(b, t = s => s) {
  if (b.name) return b.name
  const parts = [t(FOCUS_LABEL[b.focus] || b.focus), t(GOAL_LABEL[b.goal] || b.goal)]
  if (b.level) parts.push(t(LEVEL_LABEL[b.level] || b.level) + (b.variant ? ' ' + b.variant : ''))
  return parts.join(' · ')
}
export const blockSubtitle = (b, t = s => s) => b.style ? t(STYLE_LABEL[b.style] || b.style) : ''

/** Metadata computed from the entries, never trusted from input. */
export function deriveBlockMeta(b, lookup) {
  const ex = b.ex || []
  const groups = {}, equipment = new Set()
  ex.forEach(e => {
    const c = classify(e.id, lookup)
    if (c.group && !c.cardio) groups[c.group] = (groups[c.group] || 0) + (Number(e.sets) || 1)
    if (c.eq) equipment.add(c.eq)
  })
  const muscles = Object.entries(groups).sort((a, b) => b[1] - a[1]).map(([g]) => g)
  const seconds = isGuided(b.type) ? guidedSeconds(ex, b.timing, b.type)
    : estimateSeconds(ex, e => e.rest ?? REST_DEFAULTS[restDemand(classify(e.id, lookup), b.goal, e.role)])
  return { muscles, equipment: [...equipment].sort(), exerciseCount: ex.length, estimatedMinutes: roundMinutes(seconds) }
}

const rid = () => Math.random().toString(36).slice(2, 10)

/**
 * Copy a master block into a routine: fresh instance id on every entry, fresh superset ids
 * (so two inserts of the same block never merge their pairs), metadata snapshot for the day.
 */
export function instantiateBlock(b, t = s => s, newId = rid) {
  const iid = 'k' + newId()
  const sgMap = {}
  const ex = (b.ex || []).map(e => {
    const out = { ...JSON.parse(JSON.stringify(e)), blk: iid }
    if (e.sg) out.sg = sgMap[e.sg] || (sgMap[e.sg] = 'sg' + newId())
    delete out.why
    return out
  })
  const meta = {
    iid, src: b.id || null, name: blockTitle(b, t), type: b.type || 'strength', goal: b.goal || null, level: b.level || null,
    focus: b.focus || null, variant: b.variant || null, style: b.style || null, v: b.protocolVersion || PROTOCOL_VERSION,
  }
  const timing = sanitizeTiming(b.timing, meta.type)
  if (timing) meta.timing = timing
  return { meta, ex }
}

/** { instance id: type } for a day's block labels — what the validator needs to judge a day. */
export const blockTypesOf = blocks => Object.fromEntries((blocks || []).filter(x => x && x.iid).map(x => [x.iid, x.type || 'strength']))

/** Drop block metadata that no longer has entries (after deletes/moves). */
export function pruneBlocks(routine) {
  const used = new Set((routine.ex || []).map(e => e.blk).filter(Boolean))
  return (routine.blocks || []).filter(b => used.has(b.iid))
}

/** Contiguous runs of entries by block instance, in order — what the builder draws. */
export function segmentsOf(routine) {
  const out = []
  ;(routine.ex || []).forEach((e, i) => {
    const key = e.blk || null
    const last = out[out.length - 1]
    if (last && last.blk === key) last.idx.push(i)
    else out.push({ blk: key, idx: [i] })
  })
  const meta = Object.fromEntries((routine.blocks || []).map(b => [b.iid, b]))
  return out.map(s => ({ ...s, meta: s.blk ? meta[s.blk] || null : null }))
}

// ---- search / filter ---------------------------------------------------------------------
const norm = s => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')

/**
 * Filters: { q, goal, level, focus, type, maxMinutes, minMinutes, equipment, source ('official'|'mine'),
 * favorites (Set), onlyFavorites, uid }. Text search matches the translated title, subtitle,
 * focus/goal/level words and "N min" against the estimate.
 */
export function filterBlocks(list, f = {}, t = s => s) {
  const words = norm(f.q).split(/\s+/).filter(Boolean)
  return list.filter(b => {
    if (b.active === false && !f.includeInactive) return false
    if (f.goal && b.goal !== f.goal) return false
    if (f.level && b.level !== f.level) return false
    if (f.focus && b.focus !== f.focus && !(b.muscles || []).includes(f.focus)) return false
    if (f.type && b.type !== f.type) return false
    if (f.maxMinutes && (b.estimatedMinutes || 0) > f.maxMinutes) return false
    if (f.minMinutes && (b.estimatedMinutes || 0) < f.minMinutes) return false
    if (f.equipment && !(b.equipment || []).every(eq => f.equipment.includes(eq))) return false
    if (f.source === 'official' && !b.official) return false
    if (f.source === 'mine' && (b.official || (f.uid && b.createdBy !== f.uid))) return false
    if (f.onlyFavorites && !(f.favorites && f.favorites.has(b.id))) return false
    if (words.length) {
      const hay = norm([blockTitle(b, t), blockSubtitle(b, t), t(FOCUS_LABEL[b.focus] || ''), t(GOAL_LABEL[b.goal] || ''),
        t(LEVEL_LABEL[b.level] || ''), t(TYPE_LABEL[b.type] || ''), b.focus, b.goal, b.level, b.type, b.style, b.description,
        ...(b.muscles || []).map(m => t(FOCUS_LABEL[m] || m)), `${b.estimatedMinutes} min`].join(' '))
      for (const w of words) {
        const mins = w.match(/^(\d+)(min)?$/)
        if (mins) { if (Math.abs((b.estimatedMinutes || 0) - Number(mins[1])) > 7) return false; continue }
        if (w === 'min') continue
        if (!hay.includes(w)) return false
      }
    }
    return true
  })
}
