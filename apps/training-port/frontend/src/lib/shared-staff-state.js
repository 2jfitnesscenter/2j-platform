export const SHARED_STATE_OWNER_KEY = 'gym_state_owner'
const PENDING_KEYS = ['gym_dirty', 'gym_pending_active_clear', 'gym_pending_workout_delete']
const userKey = (kind, uid) => `gym_shared_${kind}:${uid}`

export function stashSharedUserLocal(storage, uid, state, { preserveActive = false } = {}) {
  if (!uid) return
  if (preserveActive && state?.active) {
    try { storage.setItem(userKey('active_state', uid), JSON.stringify(state.active)) } catch { /* storage may be full */ }
  }
  for (const key of PENDING_KEYS) {
    const value = storage.getItem(key)
    if (value !== null) {
      storage.setItem(userKey(key, uid), value)
      storage.removeItem(key)
    }
  }
}

export function restoreSharedUserLocal(storage, uid, defaultState) {
  let state = defaultState
  const snapshotKey = userKey('active_state', uid)
  try {
    const raw = storage.getItem(snapshotKey)
    if (raw) {
      const parsed = JSON.parse(raw)
      if (parsed && typeof parsed === 'object' && parsed.id) state = { ...defaultState, active: parsed }
    }
  } catch { /* malformed local snapshot is ignored */ }
  storage.removeItem(snapshotKey)
  for (const key of PENDING_KEYS) {
    const scoped = userKey(key, uid), value = storage.getItem(scoped)
    if (value !== null) { storage.setItem(key, value); storage.removeItem(scoped) }
  }
  return state
}

export function isolateSharedUser(storage, { currentUser, nextUser, state, defaultState, preserveActive = false }) {
  const owner = storage.getItem(SHARED_STATE_OWNER_KEY) || currentUser?.id || null
  const nextId = nextUser?.id || null
  const keepPreviousWorkout = preserveActive || currentUser?.authLevel === 'pin' && owner !== nextId
  if (owner && owner !== nextId) stashSharedUserLocal(storage, owner, state, { preserveActive: keepPreviousWorkout })

  if (!nextId) {
    storage.removeItem(SHARED_STATE_OWNER_KEY)
    return owner ? defaultState : state
  }

  if (owner && owner !== nextId) {
    storage.setItem(SHARED_STATE_OWNER_KEY, nextId)
    return restoreSharedUserLocal(storage, nextId, defaultState)
  }
  if (!owner && (nextUser.authLevel === 'pin' || storage.getItem(userKey('active_state', nextId)))) {
    // A PIN identity must never inherit guest/previous-account state. A same-user passkey
    // reauthentication may restore only that exact user's preserved active workout.
    storage.setItem(SHARED_STATE_OWNER_KEY, nextId)
    return restoreSharedUserLocal(storage, nextId, defaultState)
  }
  storage.setItem(SHARED_STATE_OWNER_KEY, nextId)
  return state
}
