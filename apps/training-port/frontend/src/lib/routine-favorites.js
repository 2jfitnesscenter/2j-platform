// Copyright (C) 2026 Juan Jose Perez Sanchez — 2J Fitness Center
// SPDX-License-Identifier: AGPL-3.0-or-later
// Favourite 2J routines live in the member's own synced state (S.favRoutines, a list of official routine ids) — saved exactly like
// S.favEx for exercises, so Sync V2 carries them between devices and nothing else is added. Until V2 they were a per-device
// localStorage list; migrateLegacyFavorites() folds that list in once.
export const FAV_LIMIT = 300

export const favRoutinesOf = S => new Set(Array.isArray(S?.favRoutines) ? S.favRoutines : [])

/** Flips one id inside an update() callback. Returns whether it is now a favourite. */
export function toggleRoutineFav(s, id) {
  const list = Array.isArray(s.favRoutines) ? s.favRoutines : []
  const on = !list.includes(id)
  s.favRoutines = on ? [...list, id].slice(-FAV_LIMIT) : list.filter(x => x !== id)
  return on
}

/** Union without duplicates, keeping the existing order first. Returns true when something was added. */
export function mergeFavorites(s, ids) {
  const list = Array.isArray(s.favRoutines) ? s.favRoutines : []
  const have = new Set(list)
  const add = [...new Set((Array.isArray(ids) ? ids : []).filter(x => typeof x === 'string' && x && x.length <= 80))].filter(x => !have.has(x))
  if (!add.length) return false
  s.favRoutines = [...list, ...add].slice(-FAV_LIMIT)
  return true
}

const LEGACY = uid => 'g2j_favs:' + (uid || 'anon')
const DONE = uid => 'g2j_favs_migrated:' + (uid || 'anon')
const readJSON = k => { try { return JSON.parse(localStorage.getItem(k) || 'null') } catch { return null } }

/**
 * One-time move of the old per-device list into the synced state. The union is idempotent, and the old key is only removed once the
 * synced list holds every one of its ids AND the state has been confirmed with the server (or there is no server to confirm with), so a
 * pull that lands after the first merge can never cost anyone a favourite.
 * @param ctx { uid, getState: () => ({ S, user, syncStatus }), update }
 * @returns 'none' | 'merged' | 'done'
 */
export function migrateLegacyFavorites({ uid, getState, update }) {
  if (localStorage.getItem(DONE(uid)) === '1') return 'none'
  const legacy = readJSON(LEGACY(uid))
  if (!Array.isArray(legacy)) return 'none'
  const before = getState().S
  const missing = legacy.filter(id => typeof id === 'string' && id && !(before.favRoutines || []).includes(id))
  if (missing.length) update(s => { mergeFavorites(s, legacy) })
  const st = getState()
  const confirmed = st.syncStatus === 'synced' || !st.user
  const holdsAll = legacy.every(id => typeof id !== 'string' || !id || (st.S.favRoutines || []).includes(id))
  if (confirmed && holdsAll) {
    try { localStorage.removeItem(LEGACY(uid)); localStorage.setItem(DONE(uid), '1') } catch { /* private mode */ }
    return 'done'
  }
  return 'merged'
}
