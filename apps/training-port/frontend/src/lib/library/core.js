// Copyright (C) 2026 Juan Jose Perez Sanchez — 2J Fitness Center
// SPDX-License-Identifier: AGPL-3.0-or-later
// Exercise Library V2 — the pure core: facets, Recommended 2J, deprecations, aliases, similar
// variants and the integrity check. No i18n, no store, no DOM: the app, the Node build scripts
// and the tests all use this same file.
//
// Identity never changes: an exercise is its dataset id. Everything here is metadata computed on
// top of it (movement/equipment from lib/protocol/movements.js, the 2J decisions in overrides.js).
import { EXDB } from '../exercises-data.js'
import { CATALOG } from '../protocol/catalog.js'
import { classify } from '../protocol/classify.js'
import { movementOfPattern, equipmentIdOf, MOVEMENT_BY_ID, EQUIPMENT_BY_ID, EQUIPMENT_OVERRIDE } from '../protocol/movements.js'
import { DEPRECATED, EXTRA_RECOMMENDED, MOVEMENT_OVERRIDE, ALIASES, REVIEWED_VARIANTS, NAME_OVERRIDE } from './overrides.js'
import { norm, sanitizeAgainstBase, emptyOverlay } from './overlay.js'

export { norm }
const DATA = new Map(EXDB.map(e => [e.id, e]))
const dataLookup = id => DATA.get(id) || null

// ── display names (English) ─────────────────────────────────────────────────────────────────
// Typos in the upstream names are corrected in this layer (NAME_OVERRIDE) and the "(male)/(female)"
// model label some upstream names end with is dropped wherever the shorter name stays unique.
// The record's id and its Spanish name never change. Applied once, when this module loads — it is
// imported by lib/exercises.js, so every reader of `ex.n` sees the same name.
const UPSTREAM_NAME = new Map(EXDB.map(e => [e.id, e.n]))
const MODEL_LABEL = /\s*\((male|female)\)\s*$/i
const BASE_NAME = (() => {
  const stripped = new Map(EXDB.map(e => [e.id, NAME_OVERRIDE[e.id]?.n || e.n.replace(MODEL_LABEL, '').trim() || e.n]))
  const count = new Map()
  for (const v of stripped.values()) count.set(norm(v), (count.get(norm(v)) || 0) + 1)
  // A name that would collide with another exercise's keeps its upstream label.
  return new Map(EXDB.map(e => [e.id, count.get(norm(stripped.get(e.id))) > 1 && !NAME_OVERRIDE[e.id]?.n ? e.n : stripped.get(e.id)]))
})()
for (const e of EXDB) e.n = BASE_NAME.get(e.id)
export const upstreamNameOf = id => UPSTREAM_NAME.get(id) || null

// ── decisions: the code's (overrides.js) plus the admin overlay (overlay.js) on top ─────────────
const BASE = {
  deprecated: { ...DEPRECATED },
  movement: { ...MOVEMENT_OVERRIDE },
  equipment: { ...EQUIPMENT_OVERRIDE },
  aliases: Object.fromEntries(Object.entries(ALIASES).map(([k, v]) => [k, [...v]])),
  variants: REVIEWED_VARIANTS.map(p => [...p]),
}
const NO_MOVEMENT = new Set()          // ids the admin explicitly left without a canonical movement
const ES_NAME = {}                     // admin-set Spanish display names, read by i18n nameFor
let overlay = emptyOverlay()
let overlayRevision = 0
export const libraryOverlay = () => overlay
/** Bumps on every applyLibraryOverlay — caches keyed on it (search haystacks) rebuild. */
export const overlayRevisionOf = () => overlayRevision
export const spanishNameOverrides = () => ES_NAME

const baseRecommended = () => new Set([...Object.keys(CATALOG), ...EXTRA_RECOMMENDED].filter(id => !BASE.deprecated[id]))
export const RECOMMENDED = baseRecommended()
export const isRecommended = id => RECOMMENDED.has(id)
export const isDeprecated = id => !!DEPRECATED[id]
/** The id new selections and imports should use for `id` (itself unless deprecated). */
export const preferredOf = id => DEPRECATED[id] || id

const facetCache = new Map()
/**
 * Movement, equipment and the few descriptors that make a variant a variant. Dataset records are
 * memoised; a member's custom exercise is computed on demand through `lookup`.
 */
export function facetsOf(ex, lookup = dataLookup) {
  if (!ex) return null
  const cached = !ex.custom && facetCache.get(ex.id)
  if (cached) return cached
  const c = classify(ex.id, id => (id === ex.id ? ex : lookup(id)))
  const equipment = equipmentIdOf(ex)
  const kind = equipment === 'custom' ? 'custom' : EQUIPMENT_BY_ID[equipment]?.kind || null
  let movement = NO_MOVEMENT.has(ex.id) ? null : MOVEMENT_OVERRIDE[ex.id] || movementOfPattern(c.pattern)
  // The dataset files burpees and jumping jacks under "cardio" too: without a cardio machine
  // that is conditioning, not a machine session.
  if (movement === 'cardio' && kind !== 'cardio') movement = 'conditioning'
  const name = String(ex.n || '').toLowerCase()
  const f = {
    id: ex.id, movement, pattern: c.pattern, variant: c.variant || '', equipment, kind,
    uni: !!c.uni, angle: /incline/.test(name) ? 'incline' : /decline/.test(name) ? 'decline' : null,
    group: c.group, curated: !!c.curated,
    recommended: RECOMMENDED.has(ex.id), deprecated: !!DEPRECATED[ex.id], preferredId: DEPRECATED[ex.id] || null,
  }
  if (!ex.custom) facetCache.set(ex.id, f)
  return f
}

/** Alias (normalised) → id, from overrides.js (+ the admin overlay). Rebuilt when an overlay is applied. */
let aliasIndex = null
export function aliasIndexOf() {
  if (aliasIndex) return aliasIndex
  aliasIndex = new Map()
  for (const [id, list] of Object.entries(ALIASES)) for (const a of list) aliasIndex.set(norm(a), id)
  return aliasIndex
}
export const aliasesOf = id => ALIASES[id] || []

// The code's own movement of every exercise, computed once while the live state is the code's.
let baseMovementMap = null
function ensureBaseMovement() {
  if (!baseMovementMap) baseMovementMap = new Map(EXDB.map(e => [e.id, facetsOf(e)?.movement || null]))
  return baseMovementMap
}

function restoreBase() {
  for (const k of Object.keys(DEPRECATED)) delete DEPRECATED[k]
  Object.assign(DEPRECATED, BASE.deprecated)
  for (const k of Object.keys(MOVEMENT_OVERRIDE)) delete MOVEMENT_OVERRIDE[k]
  Object.assign(MOVEMENT_OVERRIDE, BASE.movement)
  for (const k of Object.keys(EQUIPMENT_OVERRIDE)) delete EQUIPMENT_OVERRIDE[k]
  Object.assign(EQUIPMENT_OVERRIDE, BASE.equipment)
  for (const k of Object.keys(ALIASES)) delete ALIASES[k]
  for (const [k, v] of Object.entries(BASE.aliases)) ALIASES[k] = [...v]
  REVIEWED_VARIANTS.length = 0
  REVIEWED_VARIANTS.push(...BASE.variants.map(p => [...p]))
  NO_MOVEMENT.clear()
  for (const k of Object.keys(ES_NAME)) delete ES_NAME[k]
  for (const e of EXDB) e.n = BASE_NAME.get(e.id)
  RECOMMENDED.clear()
  for (const id of baseRecommended()) RECOMMENDED.add(id)
  facetCache.clear()
  aliasIndex = null
}

/** What the overlay checks need to know about the code's own (overlay-free) library. */
function baseContext() {
  const movements = ensureBaseMovement()
  return {
    has: id => DATA.has(id),
    allIds: () => EXDB.map(e => e.id),
    movements: new Set(Object.keys(MOVEMENT_BY_ID)),
    equipment: new Set(Object.keys(EQUIPMENT_BY_ID)),
    baseMovement: id => movements.get(id) || null,
    basePref: id => BASE.deprecated[id] || null,
    baseNames: () => { const m = new Map(); for (const e of EXDB) m.set(norm(e.n), [...(m.get(norm(e.n)) || []), e.id]); return m },
    baseAliases: () => { const m = new Map(); for (const [id, list] of Object.entries(BASE.aliases)) for (const a of list) m.set(norm(a), id); return m },
    usedByOfficial: () => false,
  }
}
/** The context the API-shared rules (overlay.js) run against — also used by the admin UI. */
export const libraryBaseContext = () => baseContext()

/**
 * Put the admin overlay on top of the code's decisions, in place: DEPRECATED, MOVEMENT_OVERRIDE,
 * EQUIPMENT_OVERRIDE, ALIASES, REVIEWED_VARIANTS, RECOMMENDED and the English display names are the
 * very objects the rest of the app reads, so nothing else has to know. Entries that no longer hold
 * against the code are skipped one by one (a release can change a decision under a stored overlay).
 * Calling it again replaces the previous overlay; applying nothing restores the code's library.
 */
export function applyLibraryOverlay(raw) {
  restoreBase()
  ensureBaseMovement()
  const clean = sanitizeAgainstBase(raw, baseContext())
  for (const [id, e] of Object.entries(clean.entries)) {
    if (e.preferredId === false) delete DEPRECATED[id]
    else if (e.preferredId) DEPRECATED[id] = e.preferredId
    if (e.movement === '') NO_MOVEMENT.add(id)
    else if (e.movement) MOVEMENT_OVERRIDE[id] = e.movement
    if (e.equipment) EQUIPMENT_OVERRIDE[id] = e.equipment
    if (e.aliases?.length) ALIASES[id] = [...new Set([...(ALIASES[id] || []), ...e.aliases])]
    if (e.n && DATA.has(id)) DATA.get(id).n = e.n
    if (e.es) ES_NAME[id] = e.es
  }
  RECOMMENDED.clear()
  for (const id of baseRecommended()) if (!DEPRECATED[id]) RECOMMENDED.add(id)
  for (const [id, e] of Object.entries(clean.entries)) {
    if (e.recommended === true && !DEPRECATED[id]) RECOMMENDED.add(id)
    if (e.recommended === false) RECOMMENDED.delete(id)
  }
  for (const id of Object.keys(DEPRECATED)) RECOMMENDED.delete(id)
  for (const p of clean.variants) REVIEWED_VARIANTS.push([...p])
  facetCache.clear()
  aliasIndex = null
  overlay = clean
  overlayRevision++
  return clean
}

// Why a candidate is offered as a similar variant. Keys are stable; the UI translates them.
export const REASONS = {
  sameMovement: 'Same movement',
  samePattern: 'Same pattern',
  sameEquipment: 'Same equipment',
  sameMachineType: 'Same machine type',
}

/**
 * Deterministic "similar variants" for a swap: only candidates with the same canonical movement,
 * ranked by pattern, equipment, laterality and angle, Recommended 2J first on ties. It never
 * claims biomechanical equivalence — the reasons say exactly what matched.
 * @returns {Array<{ ex, reasons: string[], score: number }>}
 */
export function similarVariants(ref, candidates, { lookup = dataLookup, exclude = () => false, limit = 12 } = {}) {
  const r = facetsOf(ref, lookup)
  if (!r || !r.movement) return []
  const out = []
  for (const ex of candidates) {
    if (!ex || ex.id === ref.id || DEPRECATED[ex.id] || exclude(ex)) continue
    const f = facetsOf(ex, lookup)
    if (!f || f.movement !== r.movement) continue
    const reasons = ['sameMovement']
    let score = 50
    if (f.pattern === r.pattern) { reasons.push('samePattern'); score += 20; if (f.variant && f.variant === r.variant) score += 5 }
    if (f.equipment && f.equipment === r.equipment) { reasons.push('sameEquipment'); score += 15 }
    else if (f.kind === 'machine' && r.kind === 'machine') { reasons.push('sameMachineType'); score += 8 }
    if (f.uni === r.uni) score += 5
    if (f.angle === r.angle) score += 3
    if (f.recommended) score += 10
    out.push({ ex, reasons, score })
  }
  out.sort((a, b) => b.score - a.score || (a.ex.id < b.ex.id ? -1 : 1))
  return out.slice(0, limit)
}

/**
 * The integrity check behind scripts/check-exercise-library.mjs and the tests. `errors` must be
 * empty for the build to pass; `warnings` are reported, not fatal.
 * @param {{ es?: Record<string,string>, officialIds?: Set<string> }} opts
 */
export function checkLibrary({ es = null, officialIds = null } = {}) {
  const errors = [], warnings = []
  const ids = EXDB.map(e => e.id)
  if (new Set(ids).size !== ids.length) errors.push('duplicate exercise id in the dataset')
  const exists = id => DATA.has(id)
  for (const e of EXDB) {
    const f = facetsOf(e)
    if (f.movement && !MOVEMENT_BY_ID[f.movement]) errors.push(`${e.id}: unknown movement ${f.movement}`)
    if (!f.equipment || !EQUIPMENT_BY_ID[f.equipment]) errors.push(`${e.id}: equipment "${e.eq}" has no canonical id`)
  }
  for (const [id, eq] of Object.entries(EQUIPMENT_OVERRIDE)) {
    if (!exists(id)) errors.push(`equipment override for missing id ${id}`)
    if (!EQUIPMENT_BY_ID[eq]) errors.push(`equipment override ${id} → unknown ${eq}`)
  }
  for (const [id, mv] of Object.entries(MOVEMENT_OVERRIDE)) {
    if (!exists(id)) errors.push(`movement override for missing id ${id}`)
    if (!MOVEMENT_BY_ID[mv]) errors.push(`movement override ${id} → unknown ${mv}`)
  }
  for (const [dep, pref] of Object.entries(DEPRECATED)) {
    if (!exists(dep)) errors.push(`deprecated id ${dep} does not exist`)
    if (!exists(pref)) errors.push(`preferred id ${pref} (for ${dep}) does not exist`)
    if (dep === pref) errors.push(`${dep} is its own preferred id`)
    if (DEPRECATED[pref]) errors.push(`deprecation chain/cycle: ${dep} → ${pref} → ${DEPRECATED[pref]}`)
    if (officialIds?.has(dep)) errors.push(`${dep} is deprecated but used by an official block or routine`)
    if (exists(dep) && exists(pref) && facetsOf(DATA.get(dep)).movement !== facetsOf(DATA.get(pref)).movement)
      errors.push(`${dep} and its preferred ${pref} have different movements`)
  }
  for (const id of RECOMMENDED) {
    const e = DATA.get(id)
    if (!e) { errors.push(`recommended id ${id} does not exist`); continue }
    const f = facetsOf(e)
    if (!f.movement) errors.push(`recommended ${id} (${e.n}) has no movement`)
    if (!f.equipment) errors.push(`recommended ${id} has no equipment`)
    if (!e.img) errors.push(`recommended ${id} has no image`)
    if (es && !es[id]) errors.push(`recommended ${id} has no Spanish name`)
  }
  for (const id of EXTRA_RECOMMENDED) if (DEPRECATED[id]) errors.push(`recommended ${id} is deprecated`)
  // Aliases: one id each, and never the exact name of a different exercise (that would silently
  // re-file someone's history under the wrong lift on import).
  const seen = new Map()
  const nameOwner = new Map()
  for (const e of EXDB) {
    nameOwner.set(norm(e.n), [...(nameOwner.get(norm(e.n)) || []), e.id])
    if (es?.[e.id]) nameOwner.set(norm(es[e.id]), [...(nameOwner.get(norm(es[e.id])) || []), e.id])
  }
  for (const [id, list] of Object.entries(ALIASES)) {
    if (!exists(id)) errors.push(`alias target ${id} does not exist`)
    if (DEPRECATED[id]) errors.push(`alias points at deprecated ${id}`)
    for (const a of list) {
      const k = norm(a)
      if (seen.has(k) && seen.get(k) !== id) errors.push(`ambiguous alias "${a}": ${seen.get(k)} and ${id}`)
      seen.set(k, id)
      const owners = (nameOwner.get(k) || []).filter(o => o !== id && !DEPRECATED[o])
      if (owners.length) errors.push(`alias "${a}" of ${id} is the name of ${owners.join(', ')}`)
    }
  }
  for (const pair of REVIEWED_VARIANTS) for (const id of pair) if (!exists(id)) errors.push(`reviewed variant ${id} does not exist`)
  // Two live (non-deprecated) exercises must never share a name — a member could not tell them apart.
  for (const [k, owners] of nameOwner) {
    const live = [...new Set(owners)].filter(o => !DEPRECATED[o])
    if (live.length > 1) errors.push(`name "${k}" shared by ${live.join(', ')}`)
  }
  const unclassified = EXDB.filter(e => !facetsOf(e).movement).length
  if (unclassified) warnings.push(`${unclassified} exercises without a canonical movement (master library only)`)
  return { errors, warnings }
}
