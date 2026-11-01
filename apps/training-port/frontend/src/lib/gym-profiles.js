// Copyright (C) 2026 Juan Jose Perez Sanchez — 2J Fitness Center
// SPDX-License-Identifier: AGPL-3.0-or-later
export * from './gym-profile-model.js'
import { activeGymProfile, setOfficialGymEquipment as setModelOfficialEquipment } from './gym-profile-model.js'
import { facets } from './library/index.js'
import { isEquipmentUnavailable, isHidden, EXIDX } from './exercises.js'

const OFFICIAL_EQUIPMENT_KEY = 'gym_official_equipment_v1'
export function setCachedOfficialGymEquipment(value) {
  const equipment = setModelOfficialEquipment(value)
  try { localStorage.setItem(OFFICIAL_EQUIPMENT_KEY, JSON.stringify(equipment)) } catch { /* cache is best-effort; server remains authoritative */ }
  return equipment
}
// A separately keyed, gym-wide cache survives offline starts without entering user state/Sync V2.
try {
  const cached = JSON.parse(localStorage.getItem(OFFICIAL_EQUIPMENT_KEY) || 'null')
  if (Array.isArray(cached)) setModelOfficialEquipment(cached)
} catch { /* use the bundled fallback */ }

export const unavailableAtGym = (S, ex) => isHidden(ex.id) || (activeGymProfile(S).id === '2j' && isEquipmentUnavailable(ex.eq))
export function compatibleWithGym(S, ex) {
  if (!ex) return false
  const p = activeGymProfile(S)
  return p.availableEquipment.includes(facets(ex)?.equipment) && !unavailableAtGym(S, ex)
}
export function gymExerciseList(S, list, onlyAvailable = false) {
  return list.filter(ex => !onlyAvailable || compatibleWithGym(S, ex)).map((ex, i) => ({ ex, i, ok: compatibleWithGym(S, ex) }))
    .sort((a, b) => Number(b.ok) - Number(a.ok) || a.i - b.i).map(x => x.ex)
}
export const gymRoutineCompatibility = (S, routine) => {
  const entries = routine?.ex || []
  const missing = entries.filter(e => !compatibleWithGym(S, EXIDX[e.id]))
  const compatible = entries.length > 0 && missing.length === 0
  // Never hide a whole routine for one incompatible exercise: "partial" when most of it still works
  // (the missing ones can be swapped for alternatives), "requires" when most of it needs other material.
  const level = compatible ? 'compatible' : missing.length * 2 <= entries.length ? 'partial' : 'requires'
  return { compatible, missing: missing.length, total: entries.length, level, missingIds: [...new Set(missing.map(e => e.id))] }
}
