// Copyright (C) 2026 Juan Jose Perez Sanchez — 2J Fitness Center
// SPDX-License-Identifier: AGPL-3.0-or-later
// Exercise Library V2 in the app: search by name / alias / movement / muscle / equipment,
// movement families, favourites and recents, and the scopes the pickers use
// (Recommended 2J first, the master library one tap away). Deterministic — exact/prefix first,
// with one bounded name/alias typo as fallback; deprecated duplicates never offered for
// a new selection. Built on core.js; the only additions here are translations and the store.
import { t, nameFor, getLang } from '../i18n.js'
import { EXIDX, isUnavailable } from '../exercises.js'
import { MOVEMENTS, MOVEMENT_BY_ID, EQUIPMENT_BY_ID } from '../protocol/movements.js'
import { facetsOf, norm, aliasesOf, aliasIndexOf, isRecommended, isDeprecated, preferredOf, similarVariants, REASONS, RECOMMENDED } from './core.js'
import { scoreTypoFallback } from './fuzzy.js'

export { facetsOf, isRecommended, isDeprecated, preferredOf, similarVariants, REASONS, RECOMMENDED, MOVEMENTS, MOVEMENT_BY_ID, EQUIPMENT_BY_ID }

const lookup = id => EXIDX[id] || null
export const facets = ex => facetsOf(ex, lookup)

// Muscle groups (protocol classify keys) → the label keys the app already translates.
const GROUP_LABEL = { chest: 'Chest', back: 'Back muscles', shoulders: 'Shoulders', biceps: 'Biceps', triceps: 'Triceps',
  abs: 'Abs', forearms: 'Forearms', glutes: 'Glutes', quads: 'Quads', hamstrings: 'Hamstrings', calves: 'Calves', adductors: 'Adductors' }
export const groupLabel = g => GROUP_LABEL[g] || null
export const movementLabel = id => MOVEMENT_BY_ID[id]?.label || null
export const equipmentLabel = id => (id === 'custom' ? 'Custom' : EQUIPMENT_BY_ID[id]?.label || null)

// Everyday words that carry no meaning for a search ("remo EN máquina", "press DE banca").
const STOP = new Set(['de', 'del', 'la', 'el', 'los', 'las', 'en', 'con', 'y', 'a', 'al', 'para', 'the', 'with', 'on', 'and', 'of', 'for'])
const tokens = s => norm(s).split(' ').filter(w => w && !STOP.has(w))

// One haystack per exercise and language, built lazily and cached (the whole library is ~1300
// short records — a few ms once, then every keystroke is a scan over plain arrays).
let hayLang = null
const hay = new Map()
function haystack(ex) {
  const lang = getLang() // the cache is rebuilt if the language changes
  if (hayLang !== lang) { hay.clear(); hayLang = lang }
  if (!ex.custom && hay.has(ex.id)) return hay.get(ex.id)
  const f = facets(ex)
  const name = new Set([...tokens(nameFor(ex)), ...tokens(ex.n)])
  const alias = aliasesOf(ex.id).map(norm)
  const words = new Set(name)
  for (const a of alias) for (const w of tokens(a)) words.add(w)
  const labels = [
    f?.movement && movementLabel(f.movement), f?.equipment && equipmentLabel(f.equipment), f?.group && groupLabel(f.group),
    ex.eq, ex.tg, ex.bp,
  ].filter(Boolean)
  for (const l of labels) { for (const w of tokens(l)) words.add(w); for (const w of tokens(t(l))) words.add(w) }
  if (f?.movement) for (const w of tokens(f.movement.replace(/_/g, ' '))) words.add(w)
  const h = { name, words: [...words], alias, aliasWords: new Set(alias.flatMap(a => tokens(a))), full: norm(nameFor(ex)) }
  if (!ex.custom) hay.set(ex.id, h)
  return h
}

// A query word matches a haystack word exactly, as a prefix ("mancuer" → mancuerna), or the
// haystack word is its stem ("mancuernas" → mancuerna, "gluteos" → gluteo). Nothing looser.
function wordScore(q, words) {
  let best = 0
  for (const w of words) {
    if (w === q) return 3
    if (q.length >= 3 && w.startsWith(q)) best = Math.max(best, 2)
    else if (w.length >= 4 && q.startsWith(w) && q.length - w.length <= 3) best = Math.max(best, 2)
  }
  return best
}

/**
 * Rank `list` against a free-text query. Every query word must match (AND). An alias typed in
 * full wins outright; then name words, Recommended 2J and live (non-deprecated) exercises first.
 * @returns the matching exercises, best first ([] for no match; the list itself for no query)
 */
export function searchExercises(list, query) {
  const q = tokens(query)
  if (!q.length) return list
  const nq = norm(query)
  const aliasHit = aliasIndexOf().get(nq)
  const out = []
  for (const ex of list) {
    const h = haystack(ex)
    let score = 0, ok = true
    for (const w of q) {
      const s = wordScore(w, h.words)
      if (!s) { ok = false; break }
      score += s + (wordScore(w, [...h.name]) ? 1 : 0)
    }
    if (!ok) continue
    if (aliasHit === ex.id || h.alias.includes(nq)) score += 50
    if (h.full === nq) score += 40
    if (isRecommended(ex.id)) score += 3
    if (isDeprecated(ex.id)) score -= 20
    out.push([score, ex])
  }
  out.sort((a, b) => b[0] - a[0] || (nameFor(a[1]) < nameFor(b[1]) ? -1 : 1))
  if (out.length) return out.map(x => x[1])

  // Keep established matching/ranking untouched. Typo matching is a fallback over names and
  // aliases only; movement, muscle and equipment metadata cannot create fuzzy false positives.
  const fuzzy = []
  for (const ex of list) {
    const h = haystack(ex)
    const match = scoreTypoFallback(q, h.name, h.aliasWords)
    if (!match) continue
    let score = match.score
    if (isRecommended(ex.id)) score += 3
    if (isDeprecated(ex.id)) score -= 20
    fuzzy.push([score, ex])
  }
  fuzzy.sort((a, b) => {
    const an = nameFor(a[1]), bn = nameFor(b[1])
    return b[0] - a[0] || (an < bn ? -1 : an > bn ? 1 : String(a[1].id).localeCompare(String(b[1].id)))
  })
  return fuzzy.map(x => x[1])
}

/** Short label for how this variant differs inside its family: equipment · angle · one side. */
export function variantLabel(ex) {
  const f = facets(ex)
  if (!f) return ''
  return [f.equipment && t(equipmentLabel(f.equipment)), f.angle === 'incline' ? t('Incline') : f.angle === 'decline' ? t('Decline') : null,
    f.uni ? t('One side') : null].filter(Boolean).join(' · ')
}

/**
 * Movement families over `list`: [{ movement, label, recommended: ex[], more: ex[] }], in the
 * MOVEMENTS order, deprecated duplicates left out. `recommended` first is what a member sees.
 */
export function familiesOf(list) {
  const by = new Map()
  for (const ex of list) {
    const f = facets(ex)
    if (!f?.movement || f.deprecated) continue
    if (!by.has(f.movement)) by.set(f.movement, { recommended: [], more: [] })
    by.get(f.movement)[f.recommended ? 'recommended' : 'more'].push(ex)
  }
  const byName = (a, b) => (nameFor(a) < nameFor(b) ? -1 : 1)
  return MOVEMENTS.filter(m => by.has(m.id)).map(m => ({
    movement: m.id, label: m.label, region: m.region,
    recommended: by.get(m.id).recommended.sort(byName), more: by.get(m.id).more.sort(byName),
  }))
}

// Favourites live in the member's own state (S.favEx), saved like S.excludedEx — no new sync.
export const favSetOf = S => new Set(S?.favEx || [])
export const toggleFav = (s, id) => {
  const list = s.favEx || []
  s.favEx = list.includes(id) ? list.filter(x => x !== id) : [...list, id]
}
/** Exercises done recently, newest first, from real workouts (no second list). */
export function recentIdsOf(S, max = 20) {
  const out = [], seen = new Set()
  const ws = [...(S?.workouts || [])].sort((a, b) => (b.end || b.start || 0) - (a.end || a.start || 0))
  for (const w of ws) for (const e of w.entries || []) {
    if (seen.has(e.id) || !lookup(e.id)) continue
    seen.add(e.id); out.push(e.id)
    if (out.length >= max) return out
  }
  return out
}

/**
 * Order for a picker: Recommended 2J, then available equipment, then favourites/recents, then
 * the rest; deprecated duplicates last (master scope only). Pure: returns a new array.
 */
export function prioritize(list, S) {
  const fav = favSetOf(S), recent = new Set(recentIdsOf(S, 40))
  const rank = ex => (isDeprecated(ex.id) ? 1000 : 0) + (isRecommended(ex.id) ? 0 : 100) + (isUnavailable(ex) ? 50 : 0)
    + (fav.has(ex.id) ? 0 : 10) + (recent.has(ex.id) ? 0 : 5)
  return list.map(ex => [rank(ex), ex]).sort((a, b) => a[0] - b[0] || (nameFor(a[1]) < nameFor(b[1]) ? -1 : 1)).map(x => x[1])
}

/** Library scopes: '2j' = Recommended 2J (plus the member's own customs), 'all' = master. */
export function scopeList(list, scope) {
  if (scope === 'all') return list
  return list.filter(ex => ex.custom || isRecommended(ex.id))
}

/** Similar variants for a swap, translated reasons included; unavailable ones left out. */
export function variantsFor(ref, candidates, limit = 12, exclude = isUnavailable) {
  return similarVariants(ref, candidates, { lookup, exclude, limit })
    .map(v => ({ ...v, reasonLabels: v.reasons.map(r => t(REASONS[r])) }))
}
