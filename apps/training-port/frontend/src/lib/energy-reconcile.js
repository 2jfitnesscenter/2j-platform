// Copyright (C) 2026 Juan Jose Perez Sanchez — 2J Fitness Center
// SPDX-License-Identifier: AGPL-3.0-or-later
// Energy reconciliation of a finished 2J workout with Health Connect / HealthKit. The policy:
//
//   · the workout is saved and exported at once; energy never waits for it and never blocks it
//   · active calories are NEVER written twice: if the store's own AGGREGATE for the workout's interval has ANY
//     external active energy above zero (no coverage threshold; individual records are never summed), or a
//     measured session is attached to the workout, 2J writes none
//   · otherwise wait a grace period (~15 min), look again, and only if the aggregate is still really zero write
//     2J's estimate — as an ESTIMATE, under an id that says so (client/sync id "2j:<workout id>:kcal-est")
//   · a platform that cannot tell "no data" from "read not allowed" (HealthKit) reports emptyConfirmed:false:
//     there 2J never writes an estimate (it stays visible inside 2J as ESTIMATED) and keeps watching for a source
//   · on later opens/syncs, if an external source has appeared for that interval, delete ONLY that
//     2J estimate (the store only lets an app delete what it created) and use the external figure locally
//   · if the app is never opened again the estimate may stay: accepted
//
// What is recorded where: the workout's own record (w.fitness — it already syncs with Sync V2) carries
// each figure with its energyKind: 'measured' (a wearable's session), 'aggregated' (the store's total
// over the interval, kept locally, never written back) or 'estimated' (source 'twoj'). Nothing here
// copies an external value into a 2J-authored sample. The device-local queue below is transitional: each
// entry is dropped once resolved or after WATCH_MS.
import { attachFitness, detachFitness, fitnessSources } from './fitness.js'
import { estimateWorkoutEnergy } from './energy.js'
import { bridgeState, writeState, getBridge, OWN_ID_PREFIX } from './health-bridge.js'

export const GRACE_MS = 15 * 60e3
export const WATCH_MS = 7 * 86400e3
export const ESTIMATE_SUFFIX = ':kcal-est'
export const estimateId = workoutId => OWN_ID_PREFIX + String(workoutId).slice(0, 120)

const QKEY = uid => 'health_energy_v1:' + (uid || 'anon')
const read = uid => { try { const v = JSON.parse(localStorage.getItem(QKEY(uid)) || 'null'); return v && typeof v === 'object' && !Array.isArray(v) ? v : {} } catch { return {} } }
const write = (uid, q) => { try { localStorage.setItem(QKEY(uid), JSON.stringify(q)); return true } catch { return false } }

/** A measured figure for this workout already exists (a wearable's own session, not an aggregate or an estimate). */
export const hasMeasured = w => fitnessSources(w).some(r => r.calories > 0 && r.source !== 'twoj' && r.energyKind !== 'aggregated' && r.energyKind !== 'estimated')
const twojEstimate = w => fitnessSources(w).find(r => r.source === 'twoj') || null

/**
 * The decision, pure. Inputs: the clock, the queue entry, whether the workout already has a measured
 * figure, what the store's aggregate reports for the interval ({ kcal } or null), whether 2J's own
 * estimate is already in the store, 2J's estimate, and whether the person allowed writing energy.
 * → { action: 'measured' | 'external' | 'keep' | 'wait' | 'write' | 'none', deleteOwn }
 */
export function decideEnergy({ now, entry, measured, external, ownEstimate, estimate, canWriteEnergy, emptyConfirmed = true }) {
  const hasOwn = !!ownEstimate || entry?.phase === 'estimated'
  if (measured) return { action: 'measured', deleteOwn: hasOwn }
  if (external && external.kcal > 0) return { action: 'external', deleteOwn: hasOwn }
  if (hasOwn) return { action: 'keep', deleteOwn: false }
  if (now < (entry?.at || 0) + GRACE_MS) return { action: 'wait', deleteOwn: false }
  if (!emptyConfirmed) return { action: 'unverified', deleteOwn: false }
  if (canWriteEnergy && estimate?.kcal > 0) return { action: 'write', deleteOwn: false }
  return { action: 'none', deleteOwn: false }
}

/** Put a just-exported/finished workout in the transitional queue (only when the person allowed reading or writing). */
export function scheduleEnergy({ uid, workout, now = Date.now() } = {}) {
  if (!uid || !workout?.id || !(workout.end > workout.start) || workout.imported || workout.src === 'import') return false
  if (!bridgeState(uid).enabled && !writeState(uid).enabled) return false
  const q = read(uid)
  if (q[workout.id]) return true
  q[workout.id] = { start: workout.start, end: workout.end, at: now, phase: 'waiting' }
  return write(uid, q)
}
export const energyQueue = uid => read(uid)

const platformSource = bridge => bridge?.platform === 'ios' ? 'healthkit' : 'healthconnect'
const bridgeCanEnergy = b => !!b && typeof b.readEnergy === 'function'

/**
 * Look at every queued workout once. Never throws; a native error leaves the entry for the next round.
 * Returns { changes, checked } — `changes` are applied to the workout records with applyEnergyChanges()
 * inside an update(), so what syncs is just the workout's own fitness field.
 */
export async function reconcileEnergy({ uid, workouts, S, bridge = getBridge(), now = Date.now(), isCurrentUid = () => true } = {}) {
  const out = { changes: [], checked: 0 }
  try {
    if (!uid || !bridgeCanEnergy(bridge)) return out
    const q = read(uid)
    const mayReadEnergy = () => {
      const state = bridgeState(uid)
      return state.enabled && state.granted.includes('activeCalories')
    }
    const mayWriteEnergy = () => mayReadEnergy() && writeState(uid).enabled && writeState(uid).energy && typeof bridge.writeEstimatedEnergy === 'function'
    for (const [id, entry] of Object.entries(q)) {
      const w = (workouts || []).find(x => x.id === id)
      if (!w || now - (entry.at || 0) > WATCH_MS) { delete q[id]; continue }
      out.checked++
      // A write-only grant cannot prove that a wearable has not already supplied energy. Leave
      // the transient entry queued until explicit read permission is present; never write blind.
      if (!mayReadEnergy()) { q[id] = { ...entry, checkedAt: now }; continue }
      let info = null
      try { info = await bridge.readEnergy({ start: w.start, end: w.end, id: estimateId(w.id) }) } catch { continue }     // try again next time
      if (!isCurrentUid(uid) || !mayReadEnergy()) { q[id] = { ...entry, checkedAt: now }; break }
      const estimate = estimateWorkoutEnergy(w, S)
      const d = decideEnergy({ now, entry, measured: hasMeasured(w), external: info?.external || null, ownEstimate: info?.ownEstimate === true, emptyConfirmed: info?.emptyConfirmed === true, estimate, canWriteEnergy: mayWriteEnergy() })
      if (d.deleteOwn && typeof bridge.deleteEstimatedEnergy === 'function') {
        if (!isCurrentUid(uid) || !writeState(uid).enabled || !writeState(uid).energy) { q[id] = { ...entry, checkedAt: now }; break }
        try { await bridge.deleteEstimatedEnergy({ id: estimateId(w.id) }); out.changes.push({ workoutId: w.id, op: 'detach', source: 'twoj', externalId: 'est:' + w.id }) }
        catch { continue }
        if (!isCurrentUid(uid)) break
      }
      if (d.action === 'measured') delete q[id]
      else if (d.action === 'external') {
        out.changes.push({ workoutId: w.id, op: 'attach', rec: { source: platformSource(bridge), kind: 'imported', energyKind: 'aggregated', externalId: 'agg:' + w.id,
          origin: Array.isArray(info.external.origins) && info.external.origins.length ? info.external.origins.join(', ').slice(0, 120) : null,
          start: w.start, end: w.end, calories: Math.round(info.external.kcal), importedAt: now } })
        delete q[id]
      } else if (d.action === 'write') {
        if (!isCurrentUid(uid) || !mayWriteEnergy()) { q[id] = { ...entry, checkedAt: now }; break }
        try {
          const r = await bridge.writeEstimatedEnergy({ id: estimateId(w.id), version: 1, start: w.start, end: w.end, kcal: estimate.kcal })
          if (r?.written !== true) throw new Error('not written')
          q[id] = { ...entry, phase: 'estimated', kcal: estimate.kcal, checkedAt: now }
          out.changes.push({ workoutId: w.id, op: 'attach', rec: { source: 'twoj', kind: 'estimated', energyKind: 'estimated', externalId: 'est:' + w.id,
            start: w.start, end: w.end, calories: estimate.kcal, importedAt: now } })
        } catch { /* includes "external_available": the store gained energy meanwhile — decided again next round */ }
      } else if (d.action === 'none') delete q[id]
      else q[id] = { ...entry, checkedAt: now }
    }
    write(uid, q)
  } catch { /* reconciliation is best effort: it must never reach the workout */ }
  return out
}

/** Apply reconciliation outcomes to the member's workouts (inside an update()). */
export function applyEnergyChanges(S, changes) {
  let n = 0
  for (const c of changes || []) {
    const w = (S.workouts || []).find(x => x.id === c.workoutId)
    if (!w) continue
    if (c.op === 'attach') { attachFitness(w, c.rec); n++ }
    else if (c.op === 'detach' && twojEstimate(w)) { detachFitness(w, c.source, c.externalId); n++ }
  }
  return n
}

let running = false
/** Reconcile for the signed-in member with the live store (app open, sync, or the grace timer). Quiet. */
export async function runEnergyReconcile({ getState, update, bridge = getBridge(), now = Date.now() } = {}) {
  if (running) return { skipped: true }
  running = true
  try {
    const st = getState()
    const uid = st.user?.id
    const r = await reconcileEnergy({ uid, workouts: st.S.workouts, S: st.S, bridge, now, isCurrentUid: id => getState().user?.id === id })
    if (r.changes.length && getState().user?.id === uid) update(s => { applyEnergyChanges(s, r.changes) })
    return r
  } catch { return { changes: [], checked: 0 } } finally { running = false }
}
