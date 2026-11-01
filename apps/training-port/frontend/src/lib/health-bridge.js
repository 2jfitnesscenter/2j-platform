// Copyright (C) 2026 Juan Jose Perez Sanchez — 2J Fitness Center
// SPDX-License-Identifier: AGPL-3.0-or-later
// Health native bridge, web side (docs/HEALTH_NATIVE_BRIDGE.md). A native shell (Android Health
// Connect / iOS HealthKit) exposes a READ-ONLY feature-detected object; everything here works
// without one and does nothing in a normal browser or the installed PWA.
//
//   window.TwoJNative.health = {
//     platform?: 'android' | 'ios',
//     isAvailable(): Promise<{ available, reason? }>,
//     requestPermissions(): Promise<{ granted: string[] }>      // 'workouts' | 'activeCalories' | 'heartRate'
//     readWorkouts({ start, end }): Promise<Session[]>          // per-workout aggregates, never raw samples
//   }
//   (a Capacitor plugin named TwoJHealth with the same three methods is accepted too)
//
// Privacy by construction: off by default; the person turns it on and can turn it off; consent and
// last-sync live on THIS device only (the OS permission belongs to the device) — no server endpoint,
// no token, no new sync queue. What is read goes through the existing mappers into `w.fitness` and
// then travels exactly like any other workout field (Sync V2). Everything the shell hands over is
// re-validated and whitelisted here: a bad or oversized answer is dropped, never stored.
import { mapHealthConnectSession, mapHealthKitWorkout, matchAll, attachFitness } from './fitness.js'

// V2 (same contract on Android and iOS; only the native API underneath differs):
//   requestWritePermissions(): Promise<{ granted: ('writeWorkouts')[] }>        separate consent from reading
//   writeWorkout(payload): Promise<{ written, duplicate? }>                     idempotent by payload.id
//   readEnergy({ start, end, id }): Promise<{ external: { kcal, origins[] } | null, ownEstimate, emptyConfirmed }>   the store's AGGREGATE of OTHER apps' energy; emptyConfirmed=false where "no data" cannot be told from "not allowed" (iOS)
//   writeEstimatedEnergy({ id, version, start, end, kcal }): Promise<{ written }>    the 2J estimate, under "<id>:kcal-est"; refused if the aggregate has any energy
//   deleteEstimatedEnergy({ id }): Promise<{ deleted }>                         only what 2J itself wrote (the store enforces it)
//   readActivity({ start, end }): Promise<{ steps?, activeCaloriesKcal? }>      the store's own de-duplicated aggregate
// 2J writes the SESSION (type, start, end) at once and, only if the store's aggregate still has no external energy for that interval after
// a grace period (lib/energy-reconcile.js), its own ESTIMATE under an id that says so. It never writes calories as
// if measured, never copies an external value into a 2J sample, never edits or deletes anything it did not create,
// and a failed export or reconciliation never affects the workout in 2J.

export const DEFAULT_DAYS = 30
export const MAX_DAYS = 90
export const MAX_SESSIONS = 500
const MAX_SESSION_MS = 24 * 3600e3
const FUTURE_SLACK_MS = 5 * 60e3
export const PERMISSIONS = ['workouts', 'activeCalories', 'heartRate', 'steps']
export const WRITE_PERMISSIONS = ['writeWorkouts', 'writeActiveCalories']   // the second is only used for a labelled 2J ESTIMATE, after a grace period
// What 2J itself writes carries this prefix as its client/sync id; reading it back must never count it again.
export const OWN_ID_PREFIX = '2j:'
export const OWN_APP_IDS = ['com.twojfitnesscenter.app']

const KEY = uid => 'health_bridge_v1:' + (uid || 'anon')
const read = k => { try { return JSON.parse(localStorage.getItem(k) || 'null') } catch { return null } }
const write = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); return true } catch { return false } }

/* ------------------------------------------------------------------ detection --- */

const isBridge = b => !!b && ['isAvailable', 'requestPermissions', 'readWorkouts'].every(m => typeof b[m] === 'function')
/** The native health bridge of this shell, or null (browser, installed PWA, a shell without health). */
export function getBridge(root = globalThis) {
  const native = root?.TwoJNative?.health
  if (isBridge(native)) return native
  return capacitorBridge(root?.Capacitor)
}

/**
 * The Android Capacitor plugin (TwoJHealth, android/app/src/main/java/.../health): a Capacitor call can
 * only resolve with an object, so readWorkouts answers { sessions } and is unwrapped here to the contract's
 * array. Works in the bundled app and in a shell that loads the 2J PWA by URL (the bridge is injected
 * either way): through Capacitor.Plugins when present, otherwise through nativePromise.
 */
function capacitorBridge(cap) {
  if (!cap || (typeof cap.isNativePlatform === 'function' && !cap.isNativePlatform())) return null
  const plugin = cap.Plugins?.TwoJHealth
  let call = null
  if (isBridge(plugin)) call = (m, o) => plugin[m](o)
  else if (typeof cap.nativePromise === 'function' && typeof cap.isPluginAvailable === 'function' && cap.isPluginAvailable('TwoJHealth')) call = (m, o) => cap.nativePromise('TwoJHealth', m, o || {})
  if (!call) return null
  return {
    platform: typeof cap.getPlatform === 'function' && cap.getPlatform() === 'ios' ? 'ios' : 'android',
    isAvailable: () => call('isAvailable'),
    requestPermissions: () => call('requestPermissions'),
    checkPermissions: () => call('checkPermissions'),   // what is already granted, WITHOUT prompting (Health Native Onboarding)
    readWorkouts: async q => { const r = await call('readWorkouts', q); return Array.isArray(r) ? r : r?.sessions },
    requestWritePermissions: () => call('requestWritePermissions'),
    writeWorkout: payload => call('writeWorkout', payload),
    readActivity: q => call('readActivity', q),
    readEnergy: q => call('readEnergy', q),
    writeEstimatedEnergy: p => call('writeEstimatedEnergy', p),
    deleteEstimatedEnergy: p => call('deleteEstimatedEnergy', p),
  }
}
export const platformLabel = bridge => bridge?.platform === 'ios' ? 'Apple Health' : bridge?.platform === 'android' ? 'Health Connect' : 'Health'
/** Android may stop showing its permission sheet after denial; guide the person to system settings. */
export const shouldShowManualHealthConnectHelp = (bridge, status) => bridge?.platform === 'android' && status === 'denied'

/* -------------------------------------------------------------------- consent --- */

export const bridgeState = uid => {
  if (!uid) return { enabled: false, at: null, lastSync: null, granted: [] }
  const s = read(KEY(uid))
  const granted = Array.isArray(s?.granted) ? s.granted.filter(g => PERMISSIONS.includes(g)) : []
  return s?.enabled === true && granted.includes('workouts')
    ? { enabled: true, at: +s.at || null, lastSync: +s.lastSync || null, granted }
    : { enabled: false, at: null, lastSync: null, granted: [] }
}
/** Turning it off forgets this device's consent; data already linked to workouts stays (the person's own). */
export const disconnectBridge = uid => { if (uid) { try { localStorage.removeItem(KEY(uid)) } catch { /* private mode */ } } }

/* ------------------------------------------------------------------ validation --- */

const num = (v, lo, hi) => { const n = Number(v); return Number.isFinite(n) && n >= lo && n <= hi ? n : null }
const text = (v, n = 120) => typeof v === 'string' && v.trim() ? v.trim().slice(0, n) : null
const ms = v => { const t = typeof v === 'number' ? v : Date.parse(v); return Number.isFinite(t) ? t : null }

/**
 * One session from the shell → the exact input a mapper takes, with only the fields the contract
 * names and sane bounds; anything else (raw heart-rate arrays, sample lists, extra metadata) is
 * dropped. Returns null for a session that is not a real, finished, plausible workout.
 */
export function sanitizeSession(x, now = Date.now()) {
  if (!x || typeof x !== 'object') return null
  const android = x.startTime != null, ios = x.startDate != null
  if (android === ios) return null
  const start = ms(android ? x.startTime : x.startDate), end = ms(android ? x.endTime : x.endDate)
  if (start == null || end == null || !(end > start) || end - start > MAX_SESSION_MS || end > now + FUTURE_SLACK_MS || start < 946684800000) return null
  if (android) {
    const a = x.aggregates && typeof x.aggregates === 'object' ? x.aggregates : {}
    const id = text(x.metadata?.id, 200)
    if (!id) return null
    const clean = { startTime: start, endTime: end, exerciseType: num(x.exerciseType, 0, 1000) ?? text(x.exerciseType, 60),
      metadata: { id, clientRecordId: text(x.metadata?.clientRecordId, 200), dataOrigin: { packageName: text(x.metadata?.dataOrigin?.packageName, 160) } },
      aggregates: { activeCaloriesKcal: num(a.activeCaloriesKcal, 0, 20000), totalCaloriesKcal: num(a.totalCaloriesKcal, 0, 20000), hrAvg: num(a.hrAvg, 20, 260), hrMax: num(a.hrMax, 20, 260) } }
    return clean
  }
  const uuid = text(x.uuid, 200)
  if (!uuid) return null
  return { uuid, startDate: start, endDate: end, workoutActivityType: num(x.workoutActivityType, 0, 1000) ?? text(x.workoutActivityType, 60),
    syncIdentifier: text(x.syncIdentifier, 200),
    sourceRevision: { source: { name: text(x.sourceRevision?.source?.name, 120), bundleIdentifier: text(x.sourceRevision?.source?.bundleIdentifier, 160) } },
    activeEnergyKcal: num(x.activeEnergyKcal, 0, 20000), hrAvg: num(x.hrAvg, 20, 260), hrMax: num(x.hrMax, 20, 260) }
}

/** A session 2J itself exported: its client/sync id starts with "2j:" or the app that wrote it is this one. */
export function isOwnSession(s) {
  const id = s?.metadata?.clientRecordId || s?.syncIdentifier || ''
  const app = s?.metadata?.dataOrigin?.packageName || s?.sourceRevision?.source?.bundleIdentifier || ''
  return String(id).startsWith(OWN_ID_PREFIX) || OWN_APP_IDS.includes(app)
}

/** Sessions → records (mapper output), de-duplicated by source + externalId, capped. 2J's own exports are dropped. */
export function recordsFrom(sessions, now = Date.now(), range = null) {
  const list = Array.isArray(sessions) ? sessions.slice(0, MAX_SESSIONS) : []
  const seen = new Set(), records = []
  let rejected = Math.max(0, (Array.isArray(sessions) ? sessions.length : 0) - list.length), own = 0
  for (const raw of list) {
    const s = sanitizeSession(raw, now)
    const start = s?.startTime ?? s?.startDate
    const end = s?.endTime ?? s?.endDate
    if (s && range && (start < range.start || end > range.end)) { rejected++; continue }
    if (s && isOwnSession(s)) { own++; continue }
    const rec = s ? (s.startTime != null ? mapHealthConnectSession(s, now) : mapHealthKitWorkout(s, now)) : null
    if (!rec || !rec.externalId) { rejected++; continue }
    const k = rec.source + '|' + rec.externalId
    if (seen.has(k)) continue
    seen.add(k); records.push(rec)
  }
  return { records, rejected, own }
}

/* ------------------------------------------------------------------- the flow --- */

/** Ask the OS for read access. Only called from an explicit tap; nothing is read here. */
export async function connectBridge({ uid, bridge = getBridge(), now = Date.now() } = {}) {
  if (!uid) return { status: 'unavailable', reason: 'user_required' }
  if (!bridge) return { status: 'unavailable' }
  let avail
  try { avail = await bridge.isAvailable() } catch { return { status: 'unavailable' } }
  if (!avail?.available) return { status: 'unavailable', reason: avail?.reason || null }
  let res
  try { res = await bridge.requestPermissions() } catch { return { status: 'denied' } }
  const granted = (Array.isArray(res?.granted) ? res.granted : []).filter(g => PERMISSIONS.includes(g))
  if (!granted.includes('workouts')) return { status: 'denied' }
  if (!enableBridge({ uid, granted, now })) return { status: 'error' }
  return { status: 'connected', granted }
}

/** 2J's own consent on this device, for access the OS already granted (no permission sheet involved). Needs the workout permission. */
export function enableBridge({ uid, granted, now = Date.now() } = {}) {
  const g = (Array.isArray(granted) ? granted : []).filter(x => PERMISSIONS.includes(x))
  if (!uid || !g.includes('workouts')) return false
  return write(KEY(uid), { enabled: true, at: now, lastSync: null, granted: g })
}

/**
 * Read the last `days` days and match them to the member's workouts (pure: nothing is stored).
 * Without the person's consent nothing is even requested from the shell.
 * Result: { status, match, ambiguous, none, linked, rejected }.
 */
export async function readBridge({ uid, workouts, bridge = getBridge(), days = DEFAULT_DAYS, now = Date.now() } = {}) {
  if (!uid) return { status: 'off' }
  if (!bridge) return { status: 'unavailable' }
  if (!bridgeState(uid).enabled) return { status: 'off' }
  const span = Math.min(MAX_DAYS, Math.max(1, Math.round(Number(days) || DEFAULT_DAYS)))
  let sessions
  try { sessions = await bridge.readWorkouts({ start: new Date(now - span * 86400e3).toISOString(), end: new Date(now).toISOString() }) }
  catch (e) { return { status: e?.code === 'permission_denied' ? 'denied' : 'error' } }   // access revoked since connecting
  if (!Array.isArray(sessions)) return { status: 'error' }
  // Consent can be revoked while the native read is in flight. Discard the result and do not
  // recreate the local consent record if that happened.
  const consent = bridgeState(uid)
  if (!consent.enabled) return { status: 'off' }
  const { records: mapped, rejected, own } = recordsFrom(sessions, now, { start: now - span * 86400e3, end: now })
  // Native permission grants may be partial. Never retain an optional metric merely because a
  // shell accidentally returned it: the OS grant list is the authority for what may be attached.
  const records = mapped.map(rec => ({
    ...rec,
    calories: consent.granted.includes('activeCalories') ? rec.calories : null,
    caloriesKind: consent.granted.includes('activeCalories') ? rec.caloriesKind : null,
    avgHr: consent.granted.includes('heartRate') ? rec.avgHr : null,
    maxHr: consent.granted.includes('heartRate') ? rec.maxHr : null,
  }))
  const res = matchAll(workouts || [], records)
  const prev = read(KEY(uid)) || {}
  write(KEY(uid), { ...prev, enabled: true, lastSync: now })
  return { status: 'ok', ...res, rejected, own, read: records.length }
}

/** Attach the unambiguous matches inside an update(); ambiguous ones are left for the person to choose. */
export function applyMatches(S, res) {
  let attached = 0
  for (const { rec, workoutId } of res?.match || []) {
    const w = (S.workouts || []).find(x => x.id === workoutId)
    if (w) { attachFitness(w, rec); attached++ }
  }
  return attached
}

/* ============================================================= 2J → Health (write) === */

const WKEY = uid => 'health_bridge_write_v1:' + (uid || 'anon')
const PKEY = uid => 'health_bridge_pending_v1:' + (uid || 'anon')
export const MAX_EXPORT_AGE_MS = 7 * 86400e3
const canWrite = b => !!b && typeof b.writeWorkout === 'function' && typeof b.requestWritePermissions === 'function'
export const bridgeCanWrite = canWrite

/** Writing is its own consent, independent of reading, and off by default. */
export const writeState = uid => {
  if (!uid) return { enabled: false, at: null, granted: [], energy: false }
  const s = read(WKEY(uid))
  const granted = Array.isArray(s?.granted) ? s.granted.filter(g => WRITE_PERMISSIONS.includes(g)) : []
  return s?.enabled === true && granted.includes('writeWorkouts') ? { enabled: true, at: +s.at || null, granted, energy: granted.includes('writeActiveCalories') } : { enabled: false, at: null, granted: [], energy: false }
}
export const disconnectWrite = uid => { if (uid) { try { localStorage.removeItem(WKEY(uid)); localStorage.removeItem(PKEY(uid)) } catch { /* private mode */ } } }

export async function connectWrite({ uid, bridge = getBridge(), now = Date.now() } = {}) {
  if (!uid) return { status: 'unavailable', reason: 'user_required' }
  if (!canWrite(bridge)) return { status: 'unavailable' }
  let avail
  try { avail = await bridge.isAvailable() } catch { return { status: 'unavailable' } }
  if (!avail?.available) return { status: 'unavailable', reason: avail?.reason || null }
  let res
  try { res = await bridge.requestWritePermissions() } catch { return { status: 'denied' } }
  const granted = (Array.isArray(res?.granted) ? res.granted : []).filter(g => WRITE_PERMISSIONS.includes(g))
  if (!granted.includes('writeWorkouts')) return { status: 'denied' }
  return write(WKEY(uid), { enabled: true, at: now, granted }) ? { status: 'connected', granted } : { status: 'error' }
}

// How 2J's own sessions are typed for the health store (the native side maps the word to its enum).
export function exportType(w) {
  const g = Array.isArray(w?.guided) ? w.guided.map(b => String(b?.type || '').toLowerCase()) : []
  if (g.some(x => /hiit|tabata/.test(x))) return 'hiit'
  if (g.length && g.every(x => /mobility|stretch/.test(x))) return 'mobility'
  return 'strength'
}

/**
 * What 2J hands to the health store for one finished workout, at once: the session and nothing else. Energy is
 * reconciled later (lib/energy-reconcile.js) and is never part of this payload.
 * Returns null for a workout that must not be exported (too short, too old, absurd, imported).
 */
export function exportPayload(w, S, now = Date.now()) {
  if (!w || !w.id || w.imported || w.src === 'import') return null
  const start = Number(w.start), end = Number(w.end)
  if (!(start > 946684800000) || !(end > start) || end - start < 60e3 || end - start > MAX_SESSION_MS || end > now + FUTURE_SLACK_MS || now - end > MAX_EXPORT_AGE_MS) return null
  const payload = { id: OWN_ID_PREFIX + String(w.id).slice(0, 120), version: 1, start, end, type: exportType(w), title: String(w.name || '2J workout').slice(0, 80) }
  return payload
}

const pending = uid => { const v = read(PKEY(uid)); return Array.isArray(v) ? v.filter(x => typeof x === 'string').slice(0, 50) : [] }
const setPending = (uid, list) => write(PKEY(uid), [...new Set(list)].slice(-50))

/**
 * Export one finished workout. Never throws and never blocks the workout: any problem is a status.
 * Idempotent: the native side upserts by payload.id, and a done id is remembered on this device.
 */
export async function exportWorkout({ uid, workout, S, bridge = getBridge(), now = Date.now() } = {}) {
  try {
    if (!uid || !workout) return { status: 'skipped' }
    if (!canWrite(bridge) || !writeState(uid).enabled) return { status: 'off' }
    const payload = exportPayload(workout, S, now)
    if (!payload) return { status: 'skipped' }
    const res = await bridge.writeWorkout(payload)
    if (!res || res.written !== true) throw new Error('not written')
    setPending(uid, pending(uid).filter(id => id !== workout.id))
    return { status: 'ok', duplicate: res.duplicate === true }
  } catch (e) {
    if (uid && workout?.id && e?.code !== 'permission_denied') setPending(uid, [...pending(uid), workout.id])
    return { status: e?.code === 'permission_denied' ? 'denied' : 'error' }
  }
}

/** Retry what failed earlier (offline, Health closed…), from the member's own workouts. */
export async function retryPendingExports({ uid, workouts, S, bridge = getBridge(), now = Date.now() } = {}) {
  const ids = uid ? pending(uid) : []
  let ok = 0
  for (const id of ids) {
    const w = (workouts || []).find(x => x.id === id)
    if (!w) { setPending(uid, pending(uid).filter(x => x !== id)); continue }
    const r = await exportWorkout({ uid, workout: w, S, bridge, now })
    if (r.status === 'ok') ok++
    else if (r.status === 'skipped') setPending(uid, pending(uid).filter(x => x !== id))
  }
  return { retried: ids.length, ok }
}

/* ================================================= daily activity (read-only context) === */

const DKEY = uid => 'health_bridge_daily_v1:' + (uid || 'anon')
const dayStart = now => { const d = new Date(now); d.setHours(0, 0, 0, 0); return d.getTime() }
const localDay = now => { const d = new Date(now); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0') }

/**
 * Steps and ACTIVE calories so far today, as the health store aggregates them (it de-duplicates its
 * own sources). Context only: it is never added to a workout's energy and is not total expenditure.
 * Needs read consent; each number appears only if its permission was granted.
 */
export async function readDailyActivity({ uid, bridge = getBridge(), now = Date.now() } = {}) {
  if (!uid || !bridge || typeof bridge.readActivity !== 'function') return { status: 'unavailable' }
  const st = bridgeState(uid)
  if (!st.enabled) return { status: 'off' }
  let r
  try { r = await bridge.readActivity({ start: new Date(dayStart(now)).toISOString(), end: new Date(now).toISOString() }) }
  catch (e) { return { status: e?.code === 'permission_denied' ? 'denied' : 'error' } }
  if (!bridgeState(uid).enabled) return { status: 'off' }
  const steps = st.granted.includes('steps') ? num(r?.steps, 0, 200000) : null
  const kcal = st.granted.includes('activeCalories') ? num(r?.activeCaloriesKcal, 0, 20000) : null
  const out = { d: localDay(now), steps: steps == null ? null : Math.round(steps), activeKcal: kcal == null ? null : Math.round(kcal), at: now }
  write(DKEY(uid), out)
  return { status: 'ok', ...out }
}
/** The last daily reading of THIS day on this device (never an older day's number as today's). */
export const dailyActivity = (uid, now = Date.now()) => { const v = uid ? read(DKEY(uid)) : null; return v && v.d === localDay(now) ? v : null }
