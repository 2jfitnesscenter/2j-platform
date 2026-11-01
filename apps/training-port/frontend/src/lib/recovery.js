// Copyright (C) 2026 Juan Jose Perez Sanchez — 2J Fitness Center
// SPDX-License-Identifier: AGPL-3.0-or-later
// Muscle recovery — a 0-100% "how ready is this muscle" estimate per muscles.js slug, shown on
// Home, Stats and the /recovery detail screen. This is a documented estimate, not a
// physiological model (same caveat the reference this was modeled on states about itself).
//
// Method: walk the last WINDOW_DAYS of S.workouts. Every DONE, reps-mode set (time/cardio sets
// are left out entirely, same as the reference this follows) contributes
//   musclesOf(ex)[slug] * (reps / STANDARD_REPS) * intensityOf(set)
// to that muscle's fatigue — reusing muscles.js's existing primary(1)/secondary(0.4, configurable
// in Settings) weighting, reps/STANDARD_REPS standing in for time-under-tension, and
// intensityOf() scaling a set up or down by how hard it was actually taken (RIR/RPE) — a set
// logged at RIR 0 fatigues more than the same reps at RIR 5, an unrated set (most imported
// history) stays neutral. Each contribution then decays exponentially from the moment that
// workout ended, at a half-life that depends on the *muscle's own size* — big, slow-recovering
// muscles (back, quads, hamstrings, glutes) get a longer half-life than smaller ones (chest,
// shoulders, arms, calves, core), so the same fatigue level clears faster on a bicep than on a
// hamstring. Recovery% = 100 × (1 − fatigue/MAX_FATIGUE), clamped 0-100.
import { EXIDX } from './exercises.js'
import { musclesOf, muscleOptsOf, MUSCLES, MUSCLE_NAME } from './muscles.js'
import { modeOf } from './history.js'
import { rirOf } from './effort.js'
import { countsForProgression } from './workout-policy.js'

const WINDOW_DAYS = 10   // comfortably covers even the slowest (72h) window's decay tail
const STANDARD_REPS = 10
// How much fresh fatigue (in reps-weighted effective sets) drops a muscle to 0% recovered.
// Tunable — there's no "correct" value, just a reasonable feel: ~4 sets of 10 on a muscle's
// primary mover today reads as fully fatigued, recovering back up over the following hours.
const MAX_FATIGUE = 6

// The two recovery windows the brief asks for — "hours until a fully-fatigued muscle reads as
// recovered" (see RECOVER_AT below for what "recovered" means numerically). Only the muscles
// explicitly called out as "big" (Espalda, Cuádriceps, Isquios, Glúteos) get the slow window;
// every other slug — including small stabilizers the brief never named (forearms, tibialis,
// serratus...) — defaults to the fast one, same as the brief's own "medianos/pequeños" bucket.
const BIG_MUSCLES = new Set(['upper-back', 'lower-back', 'quadriceps', 'hamstring', 'gluteal'])
const WINDOW_HOURS = { big: 72, small: 48 }
const sizeOf = slug => BIG_MUSCLES.has(slug) ? 'big' : 'small'

// A muscle "reaches 100%" once it's recovered enough to round to 100 in the UI (99.5%), and
// counts as "ready for max load" once it crosses READY_THRESHOLD (the brief's own 80% line —
// see recoveryColor below). Deriving both from one exponential decay keeps the curve genuinely
// continuous (never a hard jump) while still landing on the brief's literal windows: solving
// 100×(1−0.5^(hours/halfLife)) = 99.5 for a fully-fatigued muscle at hours = WINDOW_HOURS gives
// the half-life below, and every other point on the curve — including "hours until ready" —
// falls out of that same, single half-life per muscle size.
const RECOVERED_AT = 99.5
const K = Math.log2(1 / (1 - RECOVERED_AT / 100))   // ≈ 7.64
const halfLifeHoursFor = size => WINDOW_HOURS[size] / K

// A set's relative intensity from its logged RIR/RPE — a set taken closer to failure fatigues
// the muscle more than the same reps well short of it. Unrated sets (most of this app's
// history, and every imported CSV/Health file) stay neutral at 1×, rather than being silently
// discounted for data the profile never logged in the first place.
function intensityOf(s) {
  const rir = rirOf(s)
  if (rir == null) return 1
  return Math.max(0.7, Math.min(1.3, 1.3 - (Math.min(5, Math.max(0, rir)) / 5) * 0.6))
}

const hourMs = 60 * 60 * 1000
const dayMs = 24 * hourMs

/** { slug: 0-100 } recovery for every muscle in MUSCLES, from the member's own workout log. */
export function recoveryOf(S) {
  const now = Date.now()
  const cutoff = now - WINDOW_DAYS * dayMs
  const fatigue = {}
  const muscleOpts = muscleOptsOf(S)
  ;(S.workouts || []).forEach(w => {
    if (!countsForProgression(w)) return
    const at = w.start || new Date(w.d + 'T12:00:00').getTime()
    if (at < cutoff) return
    const hoursAgo = Math.max(0, (now - at) / hourMs)
    ;(w.entries || []).forEach(e => {
      const ex = EXIDX[e.id]
      if (!ex) return
      const mode = modeOf({ ...(e.target || {}), id: e.id })
      if (mode !== 'reps') return   // time/cardio work isn't counted, same as the reference
      const m = musclesOf(ex, muscleOpts)
      ;(e.sets || []).forEach(s => {
        if (!s.done || !s.r || s.type === 'warmup') return
        const contribution = (s.r / STANDARD_REPS) * intensityOf(s)
        for (const slug in m) {
          const halfLife = halfLifeHoursFor(sizeOf(slug))
          const weight = Math.pow(0.5, hoursAgo / halfLife)
          fatigue[slug] = (fatigue[slug] || 0) + m[slug] * contribution * weight
        }
      })
    })
  })
  const recovery = {}
  MUSCLES.forEach(slug => {
    const f = fatigue[slug] || 0
    recovery[slug] = Math.round(100 * Math.max(0, Math.min(1, 1 - f / MAX_FATIGUE)))
  })
  return recovery
}

/** Simple average across every muscle — the one number for a Home-card ring. */
export const overallRecovery = recovery =>
  Math.round(MUSCLES.reduce((s, m) => s + (recovery[m] ?? 100), 0) / MUSCLES.length)

// The brief's own 3-tier read: 0-39% fatigued, 40-79% recovering, 80-100% ready for max load.
export const RECOVERY_READY = 80
export const RECOVERY_MID = 40
export function recoveryColor(v) {
  if (v == null) return 'var(--green)'
  if (v >= RECOVERY_READY) return 'var(--green)'
  if (v >= RECOVERY_MID) return 'var(--yellow)'
  return 'var(--red)'
}

/**
 * Estimated hours remaining until `slug` crosses into the "ready" (80%+) band, read off the
 * exact same decay curve recoveryOf() used to get its current %. 0 once already there. Only
 * meaningful for a muscle actually decaying from real fatigue — pass the `recovery` map
 * recoveryOf() returned, not a raw percentage from anywhere else.
 */
export function hoursToReady(recovery, slug) {
  const v = recovery[slug]
  if (v == null || v >= RECOVERY_READY) return 0
  const halfLife = halfLifeHoursFor(sizeOf(slug))
  const ratio = (100 - v) / (100 - RECOVERY_READY)
  return Math.max(0, Math.round(halfLife * Math.log2(ratio)))
}

// Four movement-pattern groups for the detail screen, matching common push/pull/legs framing
// plus a core bucket for abs/obliques (which fit neither push nor pull).
export const GROUPS = ['push', 'pull', 'legs', 'core']
export const GROUP_LABEL = { push: 'Push muscles', pull: 'Pull muscles', legs: 'Leg muscles', core: 'Core' }
export const GROUP_MUSCLES = {
  push: ['chest', 'deltoids', 'triceps'],
  pull: ['trapezius', 'upper-back', 'serratus', 'biceps', 'forearm', 'lower-back'],
  legs: ['quadriceps', 'hamstring', 'gluteal', 'adductors', 'hip-flexors', 'calves', 'tibialis'],
  core: ['abs', 'obliques']
}

export { MUSCLE_NAME }
