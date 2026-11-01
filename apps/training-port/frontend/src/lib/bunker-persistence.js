// Copyright (C) 2026 Juan Jose Perez Sanchez — 2J Fitness Center
// SPDX-License-Identifier: AGPL-3.0-or-later
// Drain the existing per-token queue. Failed snapshots (including a 409) remain recoverable;
// only an explicit choice in the panel may discard a conflicting local draft.
export async function drainPendingActive({ queue, revision, persist, send }) {
  while (queue.length) {
    const item = queue[0]
    if (item.expectedActiveRevision === undefined) {
      item.expectedActiveRevision = revision
      persist()
    }
    try {
      const result = await send(item)
      revision = result.activeRevision
      queue.shift()
      persist()
    } catch (error) {
      return { ok: false, revision, error }
    }
  }
  return { ok: true, revision }
}

export function loadPendingFinish(storage, key) {
  try {
    const value = JSON.parse(storage.getItem(key) || 'null')
    return value && value.id && Array.isArray(value.entries) ? value : null
  } catch {
    return null
  }
}

export function stagePendingFinish(storage, key, workout) {
  try { storage.setItem(key, JSON.stringify(workout)) } catch { /* caller retains it in memory */ }
  return workout
}

// Finish is idempotent server-side by workout id. Keep the exact payload until the response is
// confirmed, so a lost request or response can be retried without rebuilding or duplicating it.
export async function retryPendingFinish({ storage, key, workout: inMemory, drainActive, send }) {
  const workout = inMemory || loadPendingFinish(storage, key)
  if (await drainActive() === false) return { pending: true, completed: false }
  if (!workout) return { pending: false, completed: false }
  try {
    await send(workout)
    try { storage.removeItem(key) } catch { /* already confirmed server-side */ }
    return { pending: false, completed: true }
  } catch (error) {
    return { pending: true, completed: false, ...(error.status === 409 ? { error } : {}) }
  }
}
