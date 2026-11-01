// Copyright (C) 2026 Juan Jose Perez Sanchez — 2J Fitness Center
// SPDX-License-Identifier: AGPL-3.0-or-later
import { useEffect, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { t } from '../lib/i18n.js'
import { verifyBunkerLaunch } from '../lib/bunker-api.js'
import Icon from '../components/Icon.jsx'

const PAIR_KEY = 'gym_bunker_screen'

// /bunker/launch?token=ROOM_KEY — the one-time link a trainer sends to (or opens on) the
// gym-floor TV/tablet itself. A valid token just marks this browser as the room screen in its
// own localStorage (survives a reload or the TV losing power — see the module doc comment on
// why /bunker itself needs no further gate: it was already designed to run with no login of
// its own) and drops straight into kiosk mode; an invalid or missing one sends the device to
// the normal login instead, per the spec's own "redirige al login administrativo habitual".
export default function BunkerLaunch() {
  const nav = useNavigate()
  const [params] = useSearchParams()
  const [state, setState] = useState('checking')   // 'checking' | 'failed'

  useEffect(() => {
    const token = params.get('token')
    if (!token) { setState('failed'); return }
    verifyBunkerLaunch(token).then(ok => {
      if (!ok) { setState('failed'); return }
      try { localStorage.setItem(PAIR_KEY, JSON.stringify({ label: t('Bunker Screen 1'), pairedAt: Date.now() })) } catch { /* private mode — kiosk still works, just without the badge */ }
      nav('/bunker', { replace: true })
    }).catch(() => setState('failed'))
  }, [])

  useEffect(() => {
    if (state !== 'failed') return
    const id = setTimeout(() => nav('/home', { replace: true }), 2500)
    return () => clearTimeout(id)
  }, [state])

  return <div className="bunker" style={{ alignItems: 'center', justifyContent: 'center', display: 'flex' }}>
    <div style={{ textAlign: 'center', color: '#8a8a8e' }}>
      {state === 'checking' ? <>
        <Icon name="dumbbell" style={{ fontSize: 32, marginBottom: 10 }} />
        <div>{t('Pairing this screen…')}</div>
      </> : <>
        <Icon name="xmark" style={{ fontSize: 32, marginBottom: 10, color: '#ff453a' }} />
        <div>{t('Invalid or expired launch link.')}</div>
      </>}
    </div>
  </div>
}
