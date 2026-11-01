// Copyright (C) 2026 Juan Jose Perez Sanchez — 2J Fitness Center
// SPDX-License-Identifier: AGPL-3.0-or-later
// What the discreet connection pill shows, derived from the store's existing Sync V2 status
// (lib/sync-client.js) plus the browser's online flag. Nothing here tracks data of its own.
// `recovering` is set once the pill has shown 'offline', so a routine online save never flashes
// "Syncing…"; `reconnecting` covers the moment between the browser's online event and the
// sync attempt it triggers, while the status still reads 'offline'. A conflict is left entirely
// to SyncConflictDialog.
export function syncBadge({ online, status, reconnecting = false, recovering = false }) {
  if (status === 'conflict') return null
  if (!online || (status === 'offline' && !reconnecting)) return 'offline'
  if (!recovering) return null
  return status === 'synced' ? 'synced' : 'syncing'
}
