// Copyright (C) 2026 Juan Jose Perez Sanchez — 2J Fitness Center
// SPDX-License-Identifier: AGPL-3.0-or-later
// Sign in on THIS device by scanning a QR with a phone that is already signed in. The QR holds only a public id; the secret stays here, the
// person approves on the phone with the four-digit code shown below and a passkey. See api/lib/device-link.js for what makes that safe.
import { useEffect, useRef, useState } from 'react'
import { Button } from './ui.jsx'
import { useStore } from '../store/useStore.js'
import { useUI } from '../store/useUI.js'
import { t } from '../lib/i18n.js'
import { linkStart, linkUrl, waitForLink } from '../lib/security-api.js'

export default function LinkLoginSheet({ close }) {
  const { setUser, pullState } = useStore()
  const toast = useUI(s => s.toast)
  const [link, setLink] = useState(null)
  const [qr, setQr] = useState(null)
  const [left, setLeft] = useState(0)
  const [ended, setEnded] = useState(null)
  const alive = useRef(true)
  const begin = async () => {
    setEnded(null); setLink(null); setQr(null)
    try {
      const l = await linkStart()
      if (!alive.current) return
      setLink(l); setLeft(Math.ceil((l.expiresAt - Date.now()) / 1000))
      try { const { default: QRCode } = await import('qrcode'); if (alive.current) setQr(await QRCode.toDataURL(linkUrl(l.id), { margin: 1, width: 220 })) } catch { /* the id below still works by hand */ }
      const out = await waitForLink({ ...l, cancelled: () => !alive.current, onTick: s => alive.current && setLeft(s) })
      if (!alive.current) return
      if (out.user) { setUser(out.user); await pullState(); toast(t('Welcome back, {0}', out.user.name)); close() }
      else setEnded(out.ended)
    } catch (e) { if (alive.current) { setEnded('error'); toast(e.message || t('Could not start the link')) } }
  }
  useEffect(() => { alive.current = true; begin(); return () => { alive.current = false } }, [])
  return <div style={{ textAlign: 'center' }}>
    <h3>{t('Sign in with a QR code')}</h3>
    <p className="muted small" style={{ lineHeight: 1.5 }}>{t('On a phone where you are already signed in, scan this code and approve it. Only do this with your own phone, and only while you are looking at this screen.')}</p>
    {link && !ended && <>
      {qr ? <img src={qr} alt={t('QR code to link this device')} width={220} height={220} style={{ borderRadius: 10, background: '#fff', padding: 8 }} /> : <div className="muted small">{t('Preparing the code…')}</div>}
      <div className="muted small" style={{ marginTop: 10 }}>{t('Confirm this code on your phone')}</div>
      <div className="num" style={{ fontSize: '2rem', letterSpacing: '.35em', fontWeight: 700 }} aria-label={t('Confirmation code')}>{link.code}</div>
      <div className="dim small" style={{ marginTop: 6 }}>{t('Link code {0} · expires in {1} s', link.id, left)}</div>
    </>}
    {!link && !ended && <div className="muted small">{t('Preparing the code…')}</div>}
    {ended && <>
      <div className="card small muted" role="status" style={{ margin: '12px 0' }}>{ended === 'denied' ? t('Too many wrong codes. Start again.') : t('This code expired. Start again to get a new one.')}</div>
      <Button variant="primary" onClick={begin}>{t('Get a new code')}</Button>
    </>}
    <div style={{ height: 8 }} />
    <Button onClick={close}>{t('Cancel')}</Button>
  </div>
}
