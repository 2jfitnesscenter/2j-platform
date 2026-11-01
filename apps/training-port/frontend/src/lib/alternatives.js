// Copyright (C) 2026 Juan Jose Perez Sanchez — 2J Fitness Center
// SPDX-License-Identifier: AGPL-3.0-or-later
// Exercise alternatives — "Swap exercise" ranks the catalogue against one reference exercise
// instead of just browsing everything (see sheets.jsx's ExercisePicker, the plain add-exercise
// browser this reuses for its list styling but not its logic).
//
// No `movementPattern`/`targetMuscleGroup` field exists on the exercise dataset (it's a large
// scraped catalogue — hand-tagging every entry isn't realistic), and no TypeScript in this
// project either. Ranking instead reuses two fields the catalogue already has for certain:
//   tg  — primary target muscle (exact match is the strongest signal a swap is a genuine
//         like-for-like — same prime mover almost always means the same movement pattern too)
//   sm  — secondary muscles, compared via lib/muscles.js's musclesOf() so the overlap already
//         accounts for the app's own muscle-alias table instead of a second one
// `eq` (equipment) never gates a result out — a exercise on different equipment for the same
// muscle is exactly the "alternative with dumbbells" case the brief asks for — but it does
// break score ties and label the match.
import { EXIDX, allExercises } from './exercises.js'
import { musclesOf, muscleOptsOf } from './muscles.js'
import { variantsFor, isDeprecated, facets } from './library/index.js'
import { compatibleWithGym, unavailableAtGym } from './gym-profiles.js'

// "Same equipment" is the Library's canonical equipment (band = resistance band, barbell = olympic barbell), not the
// dataset's raw `eq` string. A record the Library cannot classify (no canonical id) falls back to comparing the raw strings,
// so legacy and custom exercises behave as they always did.
const equipmentOfEx = ex => { const id = ex ? facets(ex)?.equipment : null; return id && id !== 'custom' ? id : null }
export const sameEquipment = (a, b) => { const x = equipmentOfEx(a), y = equipmentOfEx(b); return x && y ? x === y : !!a && !!b && a.eq === b.eq }

// 'variant' — Exercise Library V2: same canonical movement (lib/library/core.js similarVariants),
//             shown first with the reasons that matched ("Same movement · Same equipment")
// 'exact' — same primary muscle AND same equipment (a true drop-in replacement)
// 'sameMuscle' — same primary muscle, different equipment (the common case: "I don't have a
//                barbell today, what else hits chest the same way")
// 'related' — no shared primary muscle, but real secondary-muscle overlap with the reference
export const MATCH_KEYS = ['variant', 'exact', 'sameMuscle', 'related']

/**
 * Ranked alternatives for `exerciseId`, best match first. Excludes the exercise itself and
 * anything unavailable right now — gym-wide hidden by admin, or needing equipment currently
 * marked unavailable (lib/exercises.js's isUnavailable — a Smith-machine block must not offer
 * another Smith-machine exercise as the "fix"). Each result is
 * `{ ex, matchKey, sameEquipment }` — matchKey is one of MATCH_KEYS, sameEquipment tells the UI
 * whether to phrase a 'sameMuscle' result as "alternative with {equipment}".
 */
export function getExerciseAlternatives(S, exerciseId) {
  const ref = EXIDX[exerciseId]
  if (!ref) return []
  const muscleOpts = muscleOptsOf(S)
  const refMuscles = musclesOf(ref, muscleOpts)
  const results = []
  allExercises(S).forEach(e => {
    if (e.id === exerciseId || unavailableAtGym(S, e)) return
    const sameTarget = !!ref.tg && e.tg === ref.tg
    const sameEquip = sameEquipment(e, ref)
    let overlap = 0
    const m = musclesOf(e, muscleOpts)
    for (const slug in refMuscles) if (m[slug]) overlap += Math.min(refMuscles[slug], m[slug])
    if (!sameTarget && overlap <= 0) return   // not a real alternative for this exercise
    const score = (sameTarget ? 100 : 0) + overlap * 20 + (sameEquip ? 5 : 0)
    const matchKey = sameTarget ? (sameEquip ? 'exact' : 'sameMuscle') : 'related'
    results.push({ ex: e, matchKey, sameEquipment: sameEquip, score })
  })
  results.sort((a, b) => b.score - a.score)
  return results.map(({ ex, matchKey, sameEquipment }) => ({ ex, matchKey, sameEquipment }))
}

/** The three user-facing levels in Change exercise V2. The complete catalogue is always the
 * same allExercises() source used everywhere else; relatedIds lets the UI warn discreetly when
 * someone deliberately chooses a movement outside the biomechanical suggestions. */
export function getReplacementGroups(S, exerciseId) {
  // Deprecated duplicates are never offered as a replacement (their preferred twin is).
  const alternatives = getExerciseAlternatives(S, exerciseId).filter(a => !isDeprecated(a.ex.id))
  const ref = EXIDX[exerciseId]
  const pool = allExercises(S).filter(ex => ex.id !== exerciseId && !isDeprecated(ex.id))
  const variants = ref ? variantsFor(ref, pool, pool.length, ex => unavailableAtGym(S, ex)).map(v => ({ ex: v.ex, matchKey: 'variant', reasons: v.reasonLabels, sameEquipment: sameEquipment(v.ex, ref) })) : []
  const variantIds = new Set(variants.map(v => v.ex.id))
  const relatedById = new Map([...alternatives, ...variants].map(a => [a.ex.id, a]))
  const relatedIds = new Set(relatedById.keys())
  const rank = list => [...list].sort((a, b) => Number(compatibleWithGym(S, b.ex)) - Number(compatibleWithGym(S, a.ex)))
  return {
    // Similar variants of the same movement first, then muscle-based alternatives to fill.
    recommended: rank([...variants, ...alternatives.filter(a => !variantIds.has(a.ex.id))]).slice(0, 8),
    variants: rank(variants).slice(0, 8),
    related: rank(alternatives),
    all: rank(pool
      .filter(ex => !unavailableAtGym(S, ex))
      .map(ex => ({ ex, matchKey: relatedById.get(ex.id)?.matchKey || 'unrelated' }))),
    relatedIds,
  }
}

// The four quick filter pills the brief asks for. 'same' is resolved against the reference exercise at call time
// (matchesQuickFilter); the other three are fixed buckets of the Library's canonical equipment — 'machine' covers a machine
// of any kind (plain, weight-stack, plate-loaded) and a Smith machine, the same exercises the raw "leverage machine" and
// "smith machine" strings used to select. `raw` is only the fallback for a record without a canonical equipment.
export const QUICK_FILTERS = [
  { key: 'same', label: 'Same equipment' },
  { key: 'dumbbell', label: 'Dumbbells', eq: ['dumbbell'], raw: ['dumbbell'] },
  { key: 'cable', label: 'Cables', eq: ['cable'], raw: ['cable'] },
  { key: 'machine', label: 'Machines', eq: ['machine', 'selectorized', 'plate_loaded', 'smith'], raw: ['leverage machine', 'smith machine'] },
]

/** Does `ex` pass the quick filter `key`? `ref` is the exercise being replaced (only 'same' needs it); an unknown key lets everything through. */
export function matchesQuickFilter(key, ex, ref) {
  if (key === 'same') return sameEquipment(ex, ref)
  const f = QUICK_FILTERS.find(x => x.key === key)
  if (!f?.eq) return true
  const id = equipmentOfEx(ex)
  return id ? f.eq.includes(id) : f.raw.includes(ex?.eq)
}
