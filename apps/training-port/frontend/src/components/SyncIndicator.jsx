// Copyright (C) 2026 Juan Jose Perez Sanchez — 2J Fitness Center
// SPDX-License-Identifier: AGPL-3.0-or-later
import { useEffect, useState } from 'react'
import { useStore } from '../store/useStore.js'
import { syncBadge } from '../lib/sync-indicator.js'
import { MOBILE } from '../lib/mobile.js'
import { DEMO } from '../lib/demo.js'
import { t } from '../lib/i18n.js'

// Signed-in web build only: the mobile/demo builds have no server to be offline from.
export default function SyncIndicator() {
  const user = useStore(s => s.user)
  const status = useStore(s => s.syncStatus)
  const [online, setOnline] = useState(() => typeof navigator === 'undefined' || navigator.onLine !== false)
  const [reconnecting, setReconnecting] = useState(false)
  const [recovering, setRecovering] = useState(false)

  useEffect(() => {
    const up = () => { setOnline(true); setReconnecting(true) }
    const down = () => { setOnline(false); setReconnecting(false) }
    window.addEventListener('online', up)
    window.addEventListener('offline', down)
    return () => { window.removeEventListener('online', up); window.removeEventListener('offline', down) }
  }, [])
  useEffect(() => { setReconnecting(false) }, [status])

  const badge = syncBadge({ online, status, reconnecting, recovering })
  useEffect(() => {
    if (badge === 'offline') setRecovering(true)
    if (badge !== 'synced') return
    const tm = setTimeout(() => setRecovering(false), 2500)
    return () => clearTimeout(tm)
  }, [badge])

  if (!user || MOBILE || DEMO || !badge) return null
  const label = badge === 'offline' ? t('Offline · Saving on this device') : badge === 'syncing' ? t('Syncing…') : t('All synced ✓')
  return <div className={'sync-pill ' + badge} role="status" aria-live="polite">{label}</div>
}
