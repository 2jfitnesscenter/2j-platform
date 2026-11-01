// Copyright (C) 2026 Juan Jose Perez Sanchez — 2J Fitness Center
// SPDX-License-Identifier: AGPL-3.0-or-later
// Pre-workout check-in — how the member says they arrive today. Declared data, never a
// diagnosis: three 1-5 scales, "any discomfort? no/yes + where", an optional short note. It lives
// in S.checkins (one entry per day, the last one that day wins) and travels with the rest of the
// profile through the normal Sync V2 save — no queue or endpoint of its own, so it works offline.
//
// It can add context next to Intelligent Progression, never replace it: a tiring day may suggest
// keeping the load, a discomfort flags the exercises that load that area — the member (or their
// trainer) decides. Nothing here changes a load, an exercise, a set or a routine.
import { musclesOf } from './muscles.js'
import { todayISO } from './format.js'

export const SCALES = ['energy', 'sleep', 'fatigue']
// Everyday body areas, not anatomy; each maps to the muscle slugs an exercise can load, so a
// declared discomfort can be pointed out on the exercises that work that area.
export const PAIN_ZONES = [
  { key: 'neck', label: 'Neck', muscles: ['trapezius'] },
  { key: 'shoulder', label: 'Shoulder', muscles: ['deltoids'] },
  { key: 'upperBack', label: 'Upper back', muscles: ['upper-back', 'trapezius'] },
  { key: 'arm', label: 'Arm', muscles: ['biceps', 'triceps'] },
  { key: 'elbow', label: 'Elbow', muscles: ['biceps', 'triceps', 'forearm'] },
  { key: 'wrist', label: 'Wrist', muscles: ['forearm'] },
  { key: 'lowerBack', label: 'Lower back', muscles: ['lower-back'] },
  { key: 'hip', label: 'Hip', muscles: ['gluteal', 'hip-flexors', 'adductors'] },
  { key: 'knee', label: 'Knee', muscles: ['quadriceps', 'hamstring'] },
  { key: 'ankle', label: 'Ankle', muscles: ['calves', 'tibialis'] },
]
export const PAIN_ZONE = Object.fromEntries(PAIN_ZONES.map(z => [z.key, z]))
export const CHECKIN_MODES = ['ask', 'sometimes', 'off']
const MAX_KEPT = 730          // two years of daily check-ins, then the oldest go
const SOMETIMES_DAYS = 3

const clampScale = v => (Number.isInteger(v) && v >= 1 && v <= 5) ? v : null

export function sanitizeCheckin(x, iso = todayISO(), now = Date.now()) {
  const zones = [...new Set((x.zones || []).filter(z => PAIN_ZONE[z]))]
  const pain = !!x.pain && zones.length > 0
  const out = { d: iso, t: now, energy: clampScale(x.energy), sleep: clampScale(x.sleep), fatigue: clampScale(x.fatigue), pain }
  if (pain) out.zones = zones
  const note = String(x.note || '').trim().slice(0, 140)
  if (note) out.note = note
  return out
}

// Inside update(): upsert today's entry.
export function saveCheckin(s, x, iso = todayISO(), now = Date.now()) {
  const entry = sanitizeCheckin(x, iso, now)
  const list = (s.checkins || []).filter(c => c.d !== iso)
  list.push(entry)
  list.sort((a, b) => (a.d < b.d ? -1 : 1))
  s.checkins = list.slice(-MAX_KEPT)
  if (s.checkinSkipped === iso) delete s.checkinSkipped
  return entry
}
export function skipCheckin(s, iso = todayISO()) { s.checkinSkipped = iso }
export const checkinOn = (S, iso = todayISO()) => (S.checkins || []).find(c => c.d === iso) || null

const daysBetween = (a, b) => Math.round((new Date(b + 'T12:00:00') - new Date(a + 'T12:00:00')) / 86400000)

/** Whether to offer the check-in now. Never for a backdated log; never twice a day; never after
 *  a skip today. 'sometimes' asks when the last one is at least three days old. */
export function shouldAskCheckin(S, { past = false } = {}, iso = todayISO()) {
  const mode = CHECKIN_MODES.includes(S.checkinMode) ? S.checkinMode : 'sometimes'
  if (past || mode === 'off') return false
  if (checkinOn(S, iso) || S.checkinSkipped === iso) return false
  if (mode === 'ask') return true
  const last = (S.checkins || [])[S.checkins?.length - 1]
  return !last || daysBetween(last.d, iso) >= SOMETIMES_DAYS
}

/**
 * Context for one exercise from today's check-in: a tiring day (fatigue 4-5 with rest 1-2) and
 * any declared discomfort in an area this exercise loads. Returns null when there is nothing to
 * say. Words, never actions.
 */
export function checkinAdvice(checkin, ex) {
  if (!checkin) return null
  const tired = checkin.fatigue >= 4 && checkin.sleep != null && checkin.sleep <= 2
  const m = ex ? (musclesOf(ex) || {}) : {}
  const zones = (checkin.zones || []).filter(z => PAIN_ZONE[z].muscles.some(slug => m[slug] >= 1))
  return tired || zones.length ? { tired, zones } : null
}

/* ----------------------------------------------------- trainer-facing facts --- */

// Deterministic facts only — "said high fatigue in 3 recent check-ins", never a label.
export function checkinFacts(S, iso = todayISO(), recent = 5, painDays = 14) {
  const list = S.checkins || []
  const last = list.slice(-recent)
  const highFatigue = last.filter(c => c.fatigue >= 4).length
  const since = list.filter(c => daysBetween(c.d, iso) <= painDays && c.pain)
  const zoneCount = {}
  since.forEach(c => (c.zones || []).forEach(z => { zoneCount[z] = (zoneCount[z] || 0) + 1 }))
  const repeatedPain = Object.entries(zoneCount).filter(([, n]) => n >= 2).map(([zone, n]) => ({ zone, n }))
  const avg = k => { const v = last.map(c => c[k]).filter(x => x != null); return v.length ? Math.round(v.reduce((a, b) => a + b, 0) / v.length * 10) / 10 : null }
  return { count: last.length, highFatigue, repeatedPain, avg: { energy: avg('energy'), sleep: avg('sleep'), fatigue: avg('fatigue') } }
}
