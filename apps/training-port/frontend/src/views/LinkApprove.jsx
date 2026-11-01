// Copyright (C) 2026 Juan Jose Perez Sanchez — 2J Fitness Center
// SPDX-License-Identifier: AGPL-3.0-or-later
// The phone side of QR linking: shows which device is asking, asks for the code that device displays, and approves with a passkey.
import { useEffect, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import Icon from '../components/Icon.jsx'
import { Button } from '../components/ui.jsx'
import { useStore } from '../store/useStore.js'
import { useUI } from '../store/useUI.js'
import { t } from '../lib/i18n.js'
import { linkInfo, approveLink } from '../lib/security-api.js'

export default function LinkApprove() {
  const nav = useNavigate(), { id } = useParams(), user = useStore(s => s.user), toast = useUI(s => s.toast)
  const [info, setInfo] = useState(null), [gone, setGone] = useState(false), [code, setCode] = useState(''), [busy, setBusy] = useState(false), [error, setError] = useState('')
  useEffect(() => { if (user && user.authLevel !== 'pin' && user.authLevel !== 'sso') linkInfo(id).then(setInfo).catch(() => setGone(true)) }, [id, user?.id])
  if (!user || user.authLevel === 'pin' || user.authLevel === 'sso') return <div className="narrow"><div className="card">{t('Sign in with a passkey on this device to approve another device.')}</div></div>
  const approve = async () => {
    setBusy(true); setError('')
    try { await approveLink(id, code); toast(t('Device linked')); nav('/settings/security') }
    catch (e) {
      if (e.name === 'NotAllowedError' || e.name === 'AbortError') setError('')
      else if (e.data?.code === 'wrong_code') setError(t('That code does not match. {0} tries left.', e.data.triesLeft))
      else if (['denied', 'expired', 'not_found', 'taken'].includes(e.data?.code)) { setGone(true) }
      else setError(e.message || t('Could not approve this device'))
    } finally { setBusy(false) }
  }
  return <div className="narrow">
    <div className="hdr"><button className="back" onClick={() => nav('/settings/security')} aria-label={t('Back')}><Icon name="chevronLeft" /></button><h1>{t('Link a device')}</h1></div>
    {gone && <div className="card" role="alert">{t('This link has expired or was already used. Start again on the other device.')}</div>}
    {!gone && !info && <div className="card muted small">{t('Loading…')}</div>}
    {!gone && info && <div className="card" style={{ display: 'grid', gap: 12 }}>
      <b>{t('Sign in {0} as {1}?', info.platform || t('another device'), user.name)}</b>
      <div className="muted small" style={{ lineHeight: 1.5 }}>{t('Only approve if you are looking at that device right now and it is yours. Anyone who gets approved can use your account until you sign that device out.')}</div>
      <label className="muted small" htmlFor="link-code">{t('Type the 4-digit code shown on that device')}</label>
      <input className="input" id="link-code" inputMode="numeric" autoComplete="one-time-code" maxLength={4} value={code} onChange={e => setCode(e.target.value.replace(/\D/g, '').slice(0, 4))} placeholder="0000" />
      {error && <div role="alert" className="small" style={{ color: 'var(--red)' }}>{error}</div>}
      <Button variant="primary" icon="key" disabled={busy || code.length !== 4} onClick={approve}>{busy ? t('Waiting for your passkey…') : t('Approve with passkey')}</Button>
    </div>}
  </div>
}
