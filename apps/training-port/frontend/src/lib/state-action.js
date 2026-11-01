// Copyright (C) 2026 Juan Jose Perez Sanchez — 2J Fitness Center
// SPDX-License-Identifier: AGPL-3.0-or-later
import { api } from './api.js'

// Durable idempotency for server-scoped state writers (admin/trainer actions). These
// operations edit the current server state rather than uploading the caller's snapshot,
// but still need a revision precondition and a stable ID when a response is lost.
export async function stateAction(path, payload, sync) {
  const actor = JSON.parse(localStorage.getItem('gym_user') || 'null')?.id || 'unknown'
  const target = payload.id || payload.memberId || 'unknown'
  const clean = { ...payload }; delete clean.sync
  const key = 'gym_state_action:' + actor + ':' + target + ':' + path + ':' + JSON.stringify(clean)
  const saved = JSON.parse(localStorage.getItem(key) || 'null')
  const body = saved?.body || saved || { ...clean, sync, operationId: crypto.randomUUID() }
  localStorage.setItem(key, JSON.stringify({ path, body }))
  const result = await api(path, { method: 'POST', body: JSON.stringify(body) })
  localStorage.removeItem(key)
  return result
}

export async function retryStateActions() {
  const actor = JSON.parse(localStorage.getItem('gym_user') || 'null')?.id
  if (!actor) return
  const prefix = 'gym_state_action:' + actor + ':'
  const keys = []
  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i)
    if (key?.startsWith(prefix)) keys.push(key)
  }
  for (const key of keys) {
    const saved = JSON.parse(localStorage.getItem(key) || 'null')
    if (!saved?.path || !saved?.body) continue
    try {
      await api(saved.path, { method: 'POST', body: JSON.stringify(saved.body) })
      localStorage.removeItem(key)
    } catch (e) {
      // Network failures and conflicts both keep the exact intent for review/retry.
    }
  }
}
