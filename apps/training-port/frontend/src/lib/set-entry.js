// Copyright (C) 2026 Juan Jose Perez Sanchez — 2J Fitness Center
// SPDX-License-Identifier: AGPL-3.0-or-later
// Pure rules behind the live set-entry pad (components/SetPad.jsx) and both workout views.
// No state lives here: every value the pad shows is read from S.active and every change is
// written straight back through the store's update() — the same durable path the old inline
// steppers used — so closing the app mid-entry loses nothing the stepper wouldn't have.
import { modeOf, EFFORT, stepEffort, capEffort, effortOf } from './history.js'
import { stepWeight, BARBELL_LIKE_EQ } from './equipment.js'
import { t } from './i18n.js'

// The fields one set asks for, in entry order — the pad walks them KG → REPS → RPE. `need`
// marks what a set must have before it may be completed automatically; effort is never
// required (an unrated set is a normal, valid set).
export function fieldsFor(entry, S) {
  const mode = modeOf({ ...(entry.target || {}), id: entry.id })
  const unit = S.unit || 'kg'
  if (mode === 'cardio') return [
    { f: 'min', label: t('Minutes'), short: 'min', dec: false, step: 1, need: true },
    { f: 'speed', label: t('Speed'), short: 'km/h', dec: true, step: 0.5 },
  ]
  if (mode === 'time') return [
    { f: 'sec', label: t('Seconds'), short: 's', dec: false, step: 5, need: true },
    { f: 'w', label: t('Weight'), short: unit, dec: true, weight: true },
  ]
  const kind = effortOf(S)
  const out = [
    { f: 'w', label: t('Weight'), short: unit, dec: true, weight: true },
    { f: 'r', label: t('Reps'), short: t('reps'), dec: false, step: 1, need: true },
  ]
  if (EFFORT[kind]) out.push({ f: kind, label: EFFORT[kind].hd, short: EFFORT[kind].hd, dec: true, effort: kind, opt: true })
  return out
}

export const isBodyweightEq = eq => eq === 'body weight' || eq === 'bodyweight'

// One −/+ tap on a field: weight walks the real rack/plates (lib/equipment.js), effort walks
// its own scale (empty stays empty on −, like the old effort stepper), everything else a flat
// step floored at 0.
export function stepField(S, eq, field, cur, dir) {
  if (field.weight) return stepWeight(S, eq, cur || 0, dir)
  if (field.effort) return stepEffort(field.effort, cur ?? null, dir)
  return Math.max(0, Math.round(((cur || 0) + dir * (field.step || 1)) * 100) / 100)
}

// A typed value is stored as a number; an emptied optional field (effort) is null, which the
// caller stores by dropping the key. Effort is capped at its scale's top, never floored while
// typing (same rule as capEffort everywhere else).
export function parseField(field, str) {
  if (str === '' || str == null) return field.opt ? null : 0
  const n = Number(String(str).replace(',', '.'))
  if (!Number.isFinite(n) || n < 0) return field.opt ? null : 0
  return field.effort ? capEffort(field.effort, n) : n
}

// Keypad editing on the string being typed. `fresh` means the field has just been focused:
// the first key replaces the shown value instead of appending to it.
export function keypadInput(str, key, { dec = true, fresh = false, max = 6 } = {}) {
  const cur = fresh ? '' : String(str ?? '')
  if (key === 'back') return fresh ? '' : cur.slice(0, -1)
  if (key === '.') {
    if (!dec || cur.includes('.')) return cur
    return (cur || '0') + '.'
  }
  if (!/^\d$/.test(key)) return cur
  if (cur.replace('.', '').length >= max) return cur
  if (cur === '0') return key
  const [, frac] = cur.split('.')
  if (frac != null && frac.length >= 2) return cur
  return cur + key
}

// Whether a set carries everything it needs to count — gates auto-complete only (a member can
// still tick a set off by hand exactly as before). Reps need a rep count and, unless the
// exercise is a bodyweight one, a load; a hold needs its seconds; cardio its minutes.
export function canComplete(entry, set, eq) {
  if (!set) return false
  const mode = modeOf({ ...(entry.target || {}), id: entry.id })
  if (mode === 'cardio') return set.min > 0
  if (mode === 'time') return set.sec > 0
  if (!(set.r > 0)) return false
  return isBodyweightEq(eq) || set.w > 0
}

// The set the simple view puts in front of you: the first one not done yet, else the last.
export const currentSetIdx = entry => {
  const i = entry.sets.findIndex(s => !s.done)
  return i >= 0 ? i : entry.sets.length - 1
}

// Inside a superset the exercises alternate set by set (A1, A2, A1, A2 …): the one to do next
// is whichever has the fewest sets done, first in routine order on a tie. A finished unit
// stays on its first exercise.
export function nextInUnit(entries, unit) {
  let best = unit[0], bestDone = Infinity
  for (const idx of unit) {
    const e = entries[idx]
    if (!e || !e.sets.some(s => !s.done)) continue
    const done = e.sets.filter(s => s.done).length
    if (done < bestDone) { best = idx; bestDone = done }
  }
  return best
}

// Contextual plate calculator: only where a loaded bar makes sense — never cardio/holds, never
// a warmup set, and the member can turn the shortcut off (S.enablePlateCalculator).
export const platesApply = (S, eq, entry, set) =>
  S.enablePlateCalculator !== false && BARBELL_LIKE_EQ.includes(eq) && !!set && set.type !== 'warmup' &&
  modeOf({ ...(entry.target || {}), id: entry.id }) === 'reps'

// Which bar to open the calculator with: the one this member last picked for this exercise,
// else the bar the equipment itself names. A trap bar's weight varies too much to guess, so it
// falls back to the calculator's own default and its bar picker stays one tap away.
const BAR_OF_EQ = { 'ez barbell': 'zBar', 'smith machine': 'smith', barbell: 'olympic', 'olympic barbell': 'olympic' }
export const barFor = (S, ex) => (S.barByExercise || {})[ex.id] || BAR_OF_EQ[ex.eq] || undefined

// "80 × 10 · RPE 8" — the previous-performance hint shared by both views and the pad.
export function prevLabel(field, set, fmt) {
  if (!set) return null
  const v = set[field.f]
  return v == null || v === '' ? null : fmt(v)
}
