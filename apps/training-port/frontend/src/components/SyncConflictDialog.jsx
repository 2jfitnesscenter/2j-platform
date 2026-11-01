// Copyright (C) 2026 Juan Jose Perez Sanchez — 2J Fitness Center
// SPDX-License-Identifier: AGPL-3.0-or-later
import { useMemo, useState } from 'react'
import { useStore } from '../store/useStore.js'
import { t } from '../lib/i18n.js'

const LABELS = {
  workouts: 'Workouts', routines: 'Routines', programs: 'Programs', bodyweight: 'Body weight',
  measurements: 'Measurements', dayPlan: 'Daily plan', active: 'Active workout', week: 'Weekly plan',
}

function valueCount(value) {
  if (Array.isArray(value)) return value.length
  if (value && typeof value === 'object') return Object.keys(value).length
  return value == null || value === false || value === '' ? 0 : 1
}

export function syncDifferences(local = {}, server = {}) {
  const keys = [...new Set([...Object.keys(local), ...Object.keys(server)])]
    .filter(key => key !== '_ts' && key !== '_sync' && JSON.stringify(local[key]) !== JSON.stringify(server[key]))
  return keys.map(key => ({ key, label: t(LABELS[key] || key), local: valueCount(local[key]), server: valueCount(server[key]) }))
}

export default function SyncConflictDialog() {
  const conflict = useStore(s => s.syncConflict)
  const resolving = useStore(s => s.syncResolving)
  const resolve = useStore(s => s.resolveSyncConflict)
  const [showDiff, setShowDiff] = useState(false)
  const [error, setError] = useState('')
  const differences = useMemo(() => syncDifferences(conflict?.local, conflict?.server), [conflict])
  if (!conflict) return null

  const choose = async choice => {
    setError('')
    try { await resolve(choice) }
    catch { setError(t('Could not resolve the conflict. Check your connection and try again.')) }
  }
  return <div id="sync-conflict" role="dialog" aria-modal="true" aria-labelledby="sync-conflict-title">
    <div className="sync-conflict-backdrop" />
    <div className="sync-conflict-card">
      <h2 id="sync-conflict-title">{t('Choose which changes to keep')}</h2>
      <p>{t('This device and the server both have changes. Both copies are saved while you decide.')}</p>
      <button className="btn tinted" onClick={() => setShowDiff(v => !v)}>
        {showDiff ? t('Hide differences') : t('View differences')}
      </button>
      {showDiff && <div className="sync-conflict-diff">
        {differences.length ? differences.map(item => <div key={item.key} className="sync-conflict-row">
          <strong>{item.label}</strong>
          <span>{t('This device')}: {item.local}</span>
          <span>{t('Server')}: {item.server}</span>
        </div>) : <p>{t('No visible data differences were found.')}</p>}
        {!!conflict.pending?.length && <p>{t('{0} pending change(s) on this device.', conflict.pending.length)}</p>}
      </div>}
      <div className="sync-conflict-actions">
        <button className="btn primary" disabled={resolving} onClick={() => choose('local')}>{t('Keep my changes')}</button>
        <button className="btn" disabled={resolving} onClick={() => choose('server')}>{t('Use server version')}</button>
      </div>
      <small>{t('A recovery copy stays on this device. Deleted workouts cannot be restored by an older device.')}</small>
      {error && <p role="alert" className="danger-text">{error}</p>}
    </div>
  </div>
}
