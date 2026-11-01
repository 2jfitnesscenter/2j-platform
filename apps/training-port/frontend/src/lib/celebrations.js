// Copyright (C) 2026 Juan Jose Perez Sanchez — 2J Fitness Center
// SPDX-License-Identifier: AGPL-3.0-or-later
// "Did the member see what this workout earned?" — the only state the post-workout
// celebration keeps, and it keeps as little as possible: the finished workout's id and the ids
// of the badges that unlocked with it. Everything shown is re-derived from S by
// lib/mi2j.js's postWorkoutEvents, so nothing here can drift from the real history.
//
// Device-local on purpose (localStorage, per account), never part of S:
//   · Sync V2 is untouched — no new synced field, no extra journal operation, no queue;
//   · the device that finished the workout is the one that celebrates it; another device
//     pulling the same workout never replays it, and a reconnect never re-announces it;
//   · a finish while offline works exactly the same, since nothing here needs the network.
// `seen` keeps the last few workout ids so a pending marker written twice (or restored) can
// never celebrate the same workout again.
const SEEN_MAX = 60
const keyOf = (uid, kind) => `gym_mi2j_${kind}:${uid || 'guest'}`
const read = (storage, key, fallback) => {
  try { const raw = storage.getItem(key); return raw ? JSON.parse(raw) : fallback } catch { return fallback }
}
const write = (storage, key, value) => { try { storage.setItem(key, JSON.stringify(value)) } catch { /* storage full/blocked — nothing to celebrate later, no harm */ } }

export const isSeen = (storage, uid, workoutId) => read(storage, keyOf(uid, 'seen'), []).includes(workoutId)

export function markPending(storage, uid, workoutId, badgeIds = []) {
  if (!workoutId || isSeen(storage, uid, workoutId)) return
  write(storage, keyOf(uid, 'pending'), { workoutId, badgeIds })
}

export function pendingCelebration(storage, uid) {
  const p = read(storage, keyOf(uid, 'pending'), null)
  if (!p?.workoutId || isSeen(storage, uid, p.workoutId)) return null
  return { workoutId: p.workoutId, badgeIds: Array.isArray(p.badgeIds) ? p.badgeIds : [] }
}

export function markSeen(storage, uid, workoutId) {
  if (!workoutId) return
  const seen = read(storage, keyOf(uid, 'seen'), []).filter(id => id !== workoutId)
  write(storage, keyOf(uid, 'seen'), [...seen, workoutId].slice(-SEEN_MAX))
  const p = read(storage, keyOf(uid, 'pending'), null)
  if (p?.workoutId === workoutId) { try { storage.removeItem(keyOf(uid, 'pending')) } catch { /* */ } }
}
