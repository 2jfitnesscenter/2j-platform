// Copyright (C) 2026 Juan Jose Perez Sanchez — 2J Fitness Center
// SPDX-License-Identifier: AGPL-3.0-or-later
// How the member likes to see Routines and Programs (cards in a grid, or thicker rows). A per-user, per-device preference: it lives in localStorage
// only — it is not part of the synced state (Sync V2) and never reaches the server.
export const VIEW_MODES = ['grid', 'rows']
const key = uid => '2j:plan-view:v1:' + (uid || 'local')
const norm = v => (VIEW_MODES.includes(v) ? v : 'grid')

export function readViewModes(uid) {
  try {
    const raw = JSON.parse(localStorage.getItem(key(uid)) || '{}')
    return { routines: norm(raw?.routines), programs: norm(raw?.programs) }
  } catch { return { routines: 'grid', programs: 'grid' } }
}
export function writeViewMode(uid, kind, mode) {
  const next = { ...readViewModes(uid), [kind]: norm(mode) }
  try { localStorage.setItem(key(uid), JSON.stringify(next)) } catch { /* private mode / full: the choice just lasts this session */ }
  return next
}
