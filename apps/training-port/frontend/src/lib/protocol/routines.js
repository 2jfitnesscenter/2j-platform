// Copyright (C) 2026 Juan Jose Perez Sanchez — 2J Fitness Center
// SPDX-License-Identifier: AGPL-3.0-or-later
// Guided routines ("Entrena con 2J") — pure facts about a complete workout made of blocks.
// Shared by the official build, the server store and the app, so a routine's duration, equipment
// and tags are computed the same way everywhere and never typed by hand. A guided routine is an
// ordinary routine (flat `ex` + `blocks` labels, entries tagged with `blk`) plus catalogue
// metadata — never a second training model.
import { classify } from './classify.js'
import { estimateSeconds, roundMinutes, restDemand, REST_DEFAULTS } from './prescribe.js'
import { isGuided, guidedSeconds, segmentsOf } from './blocks.js'

export const ROUTINE_CATEGORIES = ['tabata', 'hiit', 'circuit', 'interval', 'mobility', 'core', 'mixed', 'strength']
// Labels are English source strings rendered through t() (Spanish in locales/es.js).
export const CATEGORY_LABEL = { tabata: 'Tabata', hiit: 'HIIT', circuit: 'Circuit', interval: 'Cardio intervals', mobility: 'Mobility', core: 'Core', mixed: 'Strength + cardio', strength: 'Strength training' }
export const PART_ROLES = ['warmup', 'main', 'cooldown']
export const ROUTINE_TAGS = ['no-jumps', 'no-equipment', 'no-floor', 'low-impact', 'express']
export const TAG_LABEL = { 'no-jumps': 'No jumps', 'no-equipment': 'No equipment', 'no-floor': 'No floor work', 'low-impact': 'Low impact', express: 'Express' }
export const BADGES = ['new', 'featured', 'express', 'no-equipment', 'no-jumps']
// A curated tag an admin may set that the facts must support (the build and the store verify it).
export const CURATED_TAGS = ['low-impact']

/**
 * Duration, equipment, tags and parts of a routine, from its entries and block labels.
 * @param r        { ex, blocks, goal }
 * @param lookup   id → library record
 * @param curated  curated tags to keep when the facts allow them (e.g. ['low-impact'])
 */
export function routineFacts(r, lookup, curated = []) {
  const ex = r.ex || []
  const restOf = e => e.rest ?? REST_DEFAULTS[restDemand(classify(e.id, lookup), r.goal, e.role)]
  const parts = segmentsOf({ ex, blocks: r.blocks || [] }).map(s => {
    const entries = s.idx.map(i => ex[i])
    const m = s.meta
    const seconds = m && isGuided(m.type) ? guidedSeconds(entries, m.timing, m.type) : estimateSeconds(entries, restOf)
    return { iid: s.blk, role: m?.role || 'main', type: m?.type || (entries.some(e => e.sg) ? 'superset' : 'strength'), src: m?.src || null,
      seconds, minutes: Math.max(1, Math.round(seconds / 60)), exercises: entries.length, ...(m?.timing ? { timing: m.timing } : {}) }
  })
  const seconds = parts.reduce((a, p) => a + p.seconds, 0)
  const cls = ex.map(e => classify(e.id, lookup))
  const noJumps = cls.every(c => !c.flags.includes('jump'))
  const running = cls.some(c => c.pattern === 'cond-run')
  const equipment = [...new Set(ex.map(e => lookup(e.id)?.eq).filter(Boolean))].sort()
  const minutes = roundMinutes(seconds)
  const tags = [
    ...(noJumps ? ['no-jumps'] : []),
    ...(equipment.every(q => q === 'body weight') ? ['no-equipment'] : []),
    ...(cls.every(c => !c.flags.includes('floor')) ? ['no-floor'] : []),
    ...(curated.includes('low-impact') && noJumps && !running ? ['low-impact'] : []),
    ...(minutes <= 10 ? ['express'] : []),
  ]
  return { seconds, minutes, equipment, tags, parts: parts.map(({ seconds: _s, ...p }) => p) }
}

/** Material a person needs, without "body weight" (that is not equipment). */
export const gearOf = r => (r.equipment || []).filter(q => q !== 'body weight')
