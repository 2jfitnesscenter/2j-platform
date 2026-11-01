// Copyright (C) 2026 Juan Jose Perez Sanchez — 2J Fitness Center
// SPDX-License-Identifier: AGPL-3.0-or-later
// A routine or program a friend sent privately. The server keeps a cleaned SNAPSHOT of the plan content (api/lib/share-snapshot.js); this is the
// other half: building what is sent from the member's own plan, and turning what arrives into an independent copy of the receiver's.
// The copy remembers where it came from (`fromShare`) and nothing else: no live link, no later sync, no versions.
import { EXIDX } from './exercises.js'
import { extractCustomDefs, mergeCustomDefs } from './exercises.js'
import { gymRoutineCompatibility } from './gym-profiles.js'
import { facets, equipmentLabel } from './library/index.js'

const defaultId = () => `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`
const clone = x => JSON.parse(JSON.stringify(x))

const routinePayload = (S, r) => ({ name: r.name, emoji: r.emoji, ...(r.prog ? { prog: r.prog } : {}), ex: clone(r.ex || []), customExDefs: clone(extractCustomDefs(r, S)) })

/** What the sender's screen posts: the routine as the plan holds it. The server cleans it again; it never trusts this. */
export function routineShare(S, r) {
  if (!r?.ex?.length) return null
  return { kind: 'routine', snapshot: routinePayload(S, r), meta: { origin: r.from2j ? '2j' : r.fromShare ? 'community' : 'plan' } }
}
export function programShare(S, program) {
  const routines = (program?.routineIds || []).map(id => (S.routines || []).find(r => r.id === id)).filter(r => r?.ex?.length)
  if (!routines.length) return null
  return { kind: 'program', snapshot: { name: program.name, emoji: program.emoji, routines: routines.map(r => routinePayload(S, r)) }, meta: { origin: 'plan' } }
}

const fromShareOf = item => ({ shareId: item.id, senderId: item.authorId, senderLabel: item.content?.meta?.senderLabel || item.authorName || '', createdAt: item.createdAt })

/** The receiver's own copy of that share, if they already saved it (routine or program). */
export const savedShare = (S, item) => (item.kind === 'program' ? S.programs : S.routines || [])?.find(x => x.fromShare?.shareId === item.id) || null

/**
 * Save a received routine: an independent copy in S.routines with a fresh id, marked `fromShare`. Saving twice returns the first copy.
 * Mutates S (call it inside the store's update()).
 */
export function saveSharedRoutine(S, item, { makeId = defaultId } = {}) {
  const snap = item?.content?.snapshot
  if (item?.kind !== 'routine' || !snap?.ex?.length) return { ok: false, reason: 'invalid-share' }
  const existing = savedShare(S, item)
  if (existing) return { ok: false, reason: 'already-saved', routine: existing }
  const routine = { id: makeId(), name: snap.name, emoji: snap.emoji, ...(snap.prog ? { prog: snap.prog } : {}), ex: clone(snap.ex), fromShare: fromShareOf(item) }
  S.routines = [...(S.routines || []), routine]
  S.customEx = mergeCustomDefs(snap.customExDefs, S.customEx)
  return { ok: true, routine }
}

/** A received program: its routines land in S.routines with fresh ids and one program groups them, all marked `fromShare`. */
export function saveSharedProgram(S, item, { makeId = defaultId } = {}) {
  const snap = item?.content?.snapshot
  if (item?.kind !== 'program' || !snap?.routines?.length) return { ok: false, reason: 'invalid-share' }
  const existing = savedShare(S, item)
  if (existing) return { ok: false, reason: 'already-saved', program: existing }
  const from = fromShareOf(item)
  const routineIds = []
  for (const r of snap.routines) {
    const routine = { id: makeId(), name: r.name, emoji: r.emoji, ...(r.prog ? { prog: r.prog } : {}), ex: clone(r.ex), fromShare: from }
    S.routines = [...(S.routines || []), routine]
    S.customEx = mergeCustomDefs(r.customExDefs, S.customEx)
    routineIds.push(routine.id)
  }
  const program = { id: makeId(), name: snap.name, emoji: snap.emoji, routineIds, fromShare: from }
  S.programs = [...(S.programs || []), program]
  return { ok: true, program }
}

/**
 * "Start" on a received share: use the copy the person already saved, or save one first, and say what to start. Starting always runs from the receiver's own
 * copy (so the session and its history are an ordinary one), never from anything the sender can still change. Mutates S like the save functions.
 * Returns { ok, id, kind, created } — id is the routine to start, or the program to open.
 */
export function resolveStart(S, item, opts) {
  const program = item?.kind === 'program'
  let copy = savedShare(S, item), created = false
  if (!copy) {
    const r = program ? saveSharedProgram(S, item, opts) : saveSharedRoutine(S, item, opts)
    if (!r.ok) return { ok: false, reason: r.reason }
    copy = program ? r.program : r.routine; created = true
  }
  return { ok: true, id: copy.id, kind: program ? 'program' : 'routine', created }
}

/** A rough duration for a routine that carries none: working time plus a fixed rest between sets. It says "about", never more. */
export function estimateMinutes(routine, restSec = 75) {
  const seconds = (routine?.ex || []).reduce((n, e) => {
    const sets = Math.max(1, Number(e.sets) || 1)
    if (e.mode === 'cardio') return n + (Number(e.min) || 10) * 60
    const work = e.mode === 'time' ? Number(e.sec) || 40 : 40
    return n + sets * (work + restSec)
  }, 0)
  return Math.max(1, Math.round(seconds / 60))
}

/**
 * Does it work where this person trains? The same helper every other screen uses. A custom exercise of the sender has no entry in the library of the
 * receiver, so it is neither counted as missing nor as fine: it is left out of the check.
 */
export function sharedFit(S, routines) {
  const entries = routines.flatMap(r => (r.ex || []).filter(e => !String(e.id).startsWith('c')))
  if (!entries.length) return { compatible: true, missing: 0, total: 0, level: 'compatible', missingIds: [], equipment: [] }
  const fit = gymRoutineCompatibility(S, { ex: entries })
  const equipment = [...new Set(fit.missingIds.map(id => equipmentLabel(facets(EXIDX[id])?.equipment)).filter(Boolean))]
  return { ...fit, equipment }
}
