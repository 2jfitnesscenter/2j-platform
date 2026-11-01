// Copyright (C) 2026 Juan Jose Perez Sanchez — 2J Fitness Center
// SPDX-License-Identifier: AGPL-3.0-or-later
// Exercise Library admin overlay — the pure rules, shared by the app and the API (the API copy is
// generated: scripts/sync-library-overlay.mjs). No i18n, no store, no DOM, no I/O.
//
// What it is: the admin's corrections to the 2J layer (lib/library/overrides.js), kept as DATA on
// the server (DATA/library-admin.json) so a name, an alias, a movement, an equipment id, the
// Recommended flag or a duplicate decision can change without a release. It never touches an id,
// deletes a record or rewrites history: identity stays the dataset id, and a deprecated id keeps
// resolving everywhere.
//
// Shape (versioned, only what was changed is stored):
//   { v: 1, rev, entries: { [id]: { n?, es?, aliases?, movement?, equipment?, recommended?,
//                                   preferredId?, note? } }, variants: [[a, b], …] }
//   n / es         display names (English / Spanish)
//   aliases        EXTRA search/import words, added to the code's aliases
//   movement       a canonical movement id; '' = explicitly none
//   equipment      a canonical equipment id
//   recommended    true / false = explicit Recommended 2J; absent = the code's decision
//   preferredId    id → deprecated, pointing at this preferred id; false = explicitly NOT
//                  deprecated (lifts a code decision); absent = the code's decision
//   note           curatorial note, shown to admins only
//   variants       pairs an admin reviewed and decided to keep apart (not a duplicate)
//
// Every rule below also runs on the server before anything is written: nothing the UI allows can
// be bypassed by calling the API directly.

export const OVERLAY_VERSION = 1
export const LIMITS = { entries: 600, pairs: 300, aliases: 8, alias: 40, name: 80, note: 200 }
export const FIELDS = ['n', 'es', 'aliases', 'movement', 'equipment', 'recommended', 'preferredId', 'note']

/** Lower-case, accents off, punctuation to spaces — the one normal form for names and aliases. */
export const norm = s => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
  .replace(/[^a-z0-9]+/g, ' ').trim()

export const emptyOverlay = () => ({ v: OVERLAY_VERSION, rev: 0, entries: {}, variants: [] })
const clean = (v, n) => String(v == null ? '' : v).replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, n)
const pairKey = (a, b) => [a, b].sort().join('|')

/**
 * What the checks need to know about the library. Both sides provide it:
 *  has(id) · movements:Set · equipment:Set · baseMovement(id) · basePref(id)
 *  baseNames(): Map(norm → [ids]) of the exercises' own names (any language available)
 *  baseAliases(): Map(norm → id) of the code's aliases
 *  usedByOfficial(id): is it in an active official block/routine (server only; default false)
 */

/** Effective (code + overlay) views the checks and the apps read. */
export function effective(overlay, ctx) {
  const entries = overlay?.entries || {}
  return {
    pref: id => { const p = entries[id]?.preferredId; return p === false ? null : p !== undefined ? p : (ctx.basePref(id) || null) },
    movement: id => { const m = entries[id]?.movement; return m === '' ? null : m !== undefined ? m : (ctx.baseMovement(id) || null) },
  }
}

/** Errors (Spanish, shown to the admin) of an overlay against the library. Empty = valid. */
export function checkOverlay(overlay, ctx) {
  const errors = []
  const entries = overlay?.entries || {}
  const eff = effective(overlay, ctx)
  const ids = Object.keys(entries)
  if (ids.length > LIMITS.entries) errors.push(`demasiados ejercicios editados (máximo ${LIMITS.entries})`)
  // who points at whom, for the chain/cycle rules
  const targets = new Map()
  for (const id of ctx.allIds ? ctx.allIds() : ids) {
    const p = eff.pref(id)
    if (p) targets.set(p, [...(targets.get(p) || []), id])
  }
  const owners = new Map()      // norm name/alias → ids, after the overlay
  const add = (k, id) => { if (k) owners.set(k, [...new Set([...(owners.get(k) || []), id])]) }
  const live = id => !eff.pref(id)
  for (const [k, list] of ctx.baseNames()) for (const id of list) add(k, id)
  for (const [k, id] of ctx.baseAliases()) add('alias:' + k, id)
  for (const id of ids) {
    const e = entries[id]
    if (!ctx.has(id)) { errors.push(`${id}: ese ejercicio no existe`); continue }
    if (e.n) add(norm(e.n), id)
    if (e.es) add(norm(e.es), id)
    for (const a of e.aliases || []) add('alias:' + norm(a), id)
  }
  for (const id of ids) {
    const e = entries[id]
    if (!ctx.has(id)) continue
    if (e.movement && !ctx.movements.has(e.movement)) errors.push(`${id}: movimiento desconocido «${e.movement}»`)
    if (e.equipment && !ctx.equipment.has(e.equipment)) errors.push(`${id}: material desconocido «${e.equipment}»`)
    const pref = eff.pref(id)
    if (pref) {
      if (!ctx.has(pref)) errors.push(`${id}: el ejercicio preferido ${pref} no existe`)
      else {
        if (pref === id) errors.push(`${id}: no puede ser su propio ejercicio preferido`)
        if (eff.pref(pref)) errors.push(`${id}: ${pref} ya es un duplicado de ${eff.pref(pref)} (no se permiten cadenas)`)
        if ((eff.movement(id) || null) !== (eff.movement(pref) || null)) errors.push(`${id} y su preferido ${pref} tienen distinto movimiento`)
      }
      if (ctx.usedByOfficial?.(id)) errors.push(`${id}: lo usa contenido oficial activo; sustitúyelo allí antes de marcarlo como duplicado`)
      if ((targets.get(id) || []).length) errors.push(`${id}: es el ejercicio preferido de ${(targets.get(id) || []).join(', ')}; reasígnalos primero (no se permiten cadenas)`)
    }
    if (e.recommended === true) {
      if (pref) errors.push(`${id}: un duplicado no puede ser recomendado`)
      if (!eff.movement(id)) errors.push(`${id}: asigna un movimiento antes de recomendarlo`)
    }
    // Names and aliases must stay unambiguous between live exercises.
    for (const k of [e.n, e.es].filter(Boolean).map(norm)) {
      const clash = (owners.get(k) || []).filter(o => o !== id && live(o))
      if (clash.length && live(id)) errors.push(`${id}: el nombre «${k}» ya lo usa ${clash.join(', ')}`)
    }
    for (const a of e.aliases || []) {
      const k = norm(a)
      const sameName = (owners.get(k) || []).filter(o => o !== id && live(o))
      const sameAlias = (owners.get('alias:' + k) || []).filter(o => o !== id)
      if (sameName.length) errors.push(`${id}: el alias «${a}» es el nombre de ${sameName.join(', ')}`)
      if (sameAlias.length) errors.push(`${id}: el alias «${a}» ya lo usa ${sameAlias.join(', ')}`)
    }
  }
  const pairs = new Set()
  for (const pair of overlay?.variants || []) {
    if (!Array.isArray(pair) || pair.length !== 2 || pair[0] === pair[1] || !ctx.has(pair[0]) || !ctx.has(pair[1])) errors.push('pareja de variantes no válida')
    else if (pairs.has(pairKey(...pair))) errors.push(`pareja de variantes repetida ${pair.join(' / ')}`)
    else pairs.add(pairKey(...pair))
  }
  if ((overlay?.variants || []).length > LIMITS.pairs) errors.push('demasiadas parejas revisadas')
  return errors
}

/** Whitelist + clamp one entry (no cross-checks); returns null if nothing is left. */
export function cleanEntry(raw) {
  const e = raw && typeof raw === 'object' ? raw : {}
  const out = {}
  const n = clean(e.n, LIMITS.name); if (n) out.n = n
  const es = clean(e.es, LIMITS.name); if (es) out.es = es
  const aliases = [...new Set((Array.isArray(e.aliases) ? e.aliases : []).map(a => clean(a, LIMITS.alias)).filter(a => norm(a).length >= 2))].slice(0, LIMITS.aliases)
  if (aliases.length) out.aliases = aliases
  if (typeof e.movement === 'string') out.movement = clean(e.movement, 40)
  if (typeof e.equipment === 'string' && e.equipment) out.equipment = clean(e.equipment, 40)
  if (typeof e.recommended === 'boolean') out.recommended = e.recommended
  if (typeof e.preferredId === 'string' && e.preferredId) out.preferredId = clean(e.preferredId, 12)
  else if (e.preferredId === false) out.preferredId = false
  const note = clean(e.note, LIMITS.note); if (note) out.note = note
  return Object.keys(out).length ? out : null
}

/** Canonical overlay from untrusted input; entries for ids the library does not have are dropped. */
export function cleanOverlay(raw, ctx) {
  const src = raw && typeof raw === 'object' ? raw : {}
  const out = { v: OVERLAY_VERSION, rev: Math.max(0, Math.floor(Number(src.rev)) || 0), entries: {}, variants: [] }
  for (const [id, e] of Object.entries(src.entries && typeof src.entries === 'object' ? src.entries : {})) {
    if (!ctx.has(id)) continue
    const c = cleanEntry(e)
    if (c) out.entries[id] = c
    if (Object.keys(out.entries).length >= LIMITS.entries) break
  }
  const seen = new Set()
  for (const p of Array.isArray(src.variants) ? src.variants : []) {
    if (!Array.isArray(p) || p.length !== 2 || typeof p[0] !== 'string' || typeof p[1] !== 'string' || p[0] === p[1] || !ctx.has(p[0]) || !ctx.has(p[1])) continue
    const k = pairKey(p[0], p[1])
    if (!seen.has(k)) { seen.add(k); out.variants.push([p[0], p[1]].sort()) }
    if (out.variants.length >= LIMITS.pairs) break
  }
  return out
}

/**
 * The overlay minus whatever no longer holds against the library (a release can change the code's
 * decisions under a stored overlay): invalid entries are dropped one at a time, never the lot.
 */
export function sanitizeAgainstBase(overlay, ctx) {
  const out = cleanOverlay(overlay, ctx)
  for (let guard = 0; guard < 50; guard++) {
    const errors = checkOverlay(out, ctx)
    if (!errors.length) return out
    const bad = new Set(errors.map(e => (e.match(/^(\d{4}):/) || [])[1]).filter(Boolean))
    if (!bad.size) { out.variants = []; if (!checkOverlay(out, ctx).length) return out; return { ...emptyOverlay(), rev: out.rev } }
    for (const id of bad) delete out.entries[id]
  }
  return { ...emptyOverlay(), rev: out.rev }
}

/**
 * Apply one admin edit. `patch` maps a field to its new value; `null` removes that override (back
 * to the code's decision). Pair edits: { variant: [a, b], keep: true|false }.
 * @returns { ok: true, overlay } | { ok: false, error }
 */
export function applyEdit(overlay, edit, ctx) {
  const next = JSON.parse(JSON.stringify(overlay || emptyOverlay()))
  next.entries = next.entries || {}
  next.variants = next.variants || []
  if (edit?.variant) {
    const [a, b] = edit.variant
    if (!ctx.has(a) || !ctx.has(b) || a === b) return { ok: false, error: 'pareja de ejercicios no válida' }
    const k = pairKey(a, b)
    next.variants = next.variants.filter(p => pairKey(...p) !== k)
    if (edit.keep !== false) next.variants.push([a, b].sort())
  } else {
    const id = String(edit?.id || '')
    if (!ctx.has(id)) return { ok: false, error: 'ese ejercicio no existe' }
    const patch = edit.patch && typeof edit.patch === 'object' ? edit.patch : {}
    const cur = { ...(next.entries[id] || {}) }
    for (const f of FIELDS) {
      if (!(f in patch)) continue
      const v = patch[f]
      if (v === null) delete cur[f]
      else cur[f] = v
    }
    if (edit.reset) { delete next.entries[id] }
    else {
      const c = cleanEntry(cur)
      // cleanEntry drops an empty movement string; keep '' (explicit "none") when it was asked for
      if (c && cur.movement === '') c.movement = ''
      if (c) next.entries[id] = c; else delete next.entries[id]
    }
  }
  const errors = checkOverlay(next, ctx)
  if (errors.length) return { ok: false, error: errors[0], errors }
  next.rev = (Number(overlay?.rev) || 0) + 1
  return { ok: true, overlay: next }
}
