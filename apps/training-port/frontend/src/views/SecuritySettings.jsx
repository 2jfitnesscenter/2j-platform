// Copyright (C) 2026 Juan Jose Perez Sanchez — 2J Fitness Center
// SPDX-License-Identifier: AGPL-3.0-or-later
// Settings → Security: the person's own passkeys, devices and recent security activity. One screen, one account: the server scopes every call
// to the signed-in person, asks for a fresh passkey confirmation (step-up) before adding or removing a passkey, and never removes the last one.
import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import Icon from '../components/Icon.jsx'
import { Button, Section, Row } from '../components/ui.jsx'
import { useStore } from '../store/useStore.js'
import { useUI } from '../store/useUI.js'
import { t, dateLocale } from '../lib/i18n.js'
import { confirmSheet } from '../sheets.jsx'
import { webauthnOK } from '../lib/api.js'
import { listPasskeys, addPasskey, renamePasskey, revokePasskey, listSessions, revokeSession, fetchSecurityEvents, EVENT_LABEL } from '../lib/security-api.js'

export const when = iso => {
  const d = iso ? new Date(iso) : null
  return d && !Number.isNaN(+d) ? d.toLocaleString(dateLocale(), { dateStyle: 'medium', timeStyle: 'short' }) : null
}
const cancelled = e => e && (e.name === 'NotAllowedError' || e.name === 'AbortError')

export function PasskeyRow({ p, index, only, onChanged }) {
  const toast = useUI(s => s.toast)
  const [editing, setEditing] = useState(false)
  const [name, setName] = useState(p.name || '')
  const [busy, setBusy] = useState(false)
  const label = p.name || t('Passkey {0}', index + 1)
  const details = [p.createdAt ? t('Added {0}', when(p.createdAt)) : t('Added before dates were recorded'),
    p.lastUsedAt ? t('Last used {0}', when(p.lastUsedAt)) : t('No sign-in recorded yet')].join(' · ')
  const save = async () => {
    setBusy(true)
    try { await renamePasskey(p.id, name); setEditing(false); await onChanged() } catch (e) { toast(e.message || t('Could not rename this passkey')) } finally { setBusy(false) }
  }
  const remove = () => confirmSheet({
    title: t('Remove this passkey?'), message: t('Whoever holds it will no longer be able to sign in with it. You will confirm with another passkey first.'),
    confirmText: t('Remove'), danger: true,
    onConfirm: async () => {
      try { await revokePasskey(p.id); toast(t('Passkey removed')); await onChanged() }
      catch (e) { if (!cancelled(e)) toast(e.data?.code === 'last_passkey' ? t('This is your only passkey — add another before removing it.') : e.message || t('Could not remove this passkey')) }
    },
  })
  return <div className="lrow sec-pk" data-passkey={p.id}>
    <span className="lrow-i" style={{ '--tint': 'var(--acc)' }}><Icon name="key" /></span>
    <span className="lrow-m">
      {editing
        ? <span className="row" style={{ gap: 6 }}>
          <input className="input" id={'pk-name-' + p.id} aria-label={t('Passkey name')} value={name} maxLength={40} onChange={e => setName(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') save() }} />
          <Button variant="primary" size="sm" disabled={busy || !name.trim()} onClick={save}>{t('Save')}</Button>
        </span>
        : <span className="lrow-t">{label}{p.legacy && <i className="set-pill" title={t('Made before names and dates were recorded')}>{t('Earlier')}</i>}</span>}
      <span className="lrow-s">{details}</span>
    </span>
    {!editing && <span className="sec-acts">
      <button className="iconbtn" aria-label={t('Rename {0}', label)} onClick={() => { setName(p.name || ''); setEditing(true) }}><Icon name="pencil" /></button>
      <button className="iconbtn" aria-label={t('Remove {0}', label)} disabled={only} title={only ? t('This is your only passkey — add another before removing it.') : undefined} onClick={remove}><Icon name="trash" /></button>
    </span>}
  </div>
}

export function PasskeysSection() {
  const toast = useUI(s => s.toast)
  const [list, setList] = useState(null)
  const [max, setMax] = useState(10)
  const [busy, setBusy] = useState(false)
  const load = async () => { try { const r = await listPasskeys(); setList(r.passkeys || []); setMax(r.max || 10) } catch (e) { setList([]); toast(e.message || t('Could not load your passkeys')) } }
  useEffect(() => { load() }, [])
  const add = async () => {
    setBusy(true)
    try { await addPasskey(); toast(t('Passkey added')); await load() }
    catch (e) { if (!cancelled(e)) toast(e.data?.code === 'passkey_limit' ? t('You have reached the maximum number of passkeys.') : e.message || t('Could not add a passkey')) }
    finally { setBusy(false) }
  }
  return <Section title={t('Your passkeys')} footer={t('A passkey is how you sign in. Keep one on each device you use — and at least two, so losing a device never locks you out.')}>
    {list === null && <div className="card muted small">{t('Loading…')}</div>}
    {list && list.map((p, i) => <PasskeyRow key={p.id} p={p} index={i} only={list.length <= 1} onChanged={load} />)}
    {list && <div style={{ padding: '10px 14px' }}>
      <Button variant="primary" icon="plus" disabled={busy || list.length >= max || !webauthnOK()} onClick={add}>{busy ? t('Waiting for your device…') : t('Add a passkey')}</Button>
      {list.length >= max && <div className="muted small" style={{ marginTop: 6 }}>{t('You have reached the maximum number of passkeys.')}</div>}
    </div>}
  </Section>
}

const VIA_LABEL = { qr: 'Linked with a QR code', recovery: 'Started by a recovery' }

export function SessionRow({ s, onEnd }) {
  const subtitle = [t('Signed in {0}', when(s.createdAt)), t('Last used {0}', when(s.lastUsedAt)), s.via && VIA_LABEL[s.via] ? t(VIA_LABEL[s.via]) : null].filter(Boolean).join(' · ')
  return <div className="lrow sec-pk" data-session={s.id}>
    <span className="lrow-i" style={{ '--tint': 'var(--blue)' }}><Icon name="globe" /></span>
    <span className="lrow-m">
      <span className="lrow-t">{s.platform}{s.current && <i className="set-pill">{t('This device')}</i>}</span>
      <span className="lrow-s">{subtitle}</span>
    </span>
    {!s.current && <span className="sec-acts"><button className="btn plain" onClick={() => onEnd(s)}>{t('Sign out')}</button></span>}
  </div>
}

export function DevicesSection() {
  const toast = useUI(s => s.toast)
  const signOutAll = useStore(s => s.signOutAll)
  const nav = useNavigate()
  const [data, setData] = useState(null)
  const load = async () => { try { setData(await listSessions()) } catch { setData({ sessions: [], thisSessionListed: true }) } }
  useEffect(() => { load() }, [])
  const end = s => confirmSheet({
    title: t('Sign out this device?'), message: t('{0} will be signed out. Your passkeys keep working — it can sign in again with one.', s.platform),
    confirmText: t('Sign out'), danger: true,
    onConfirm: async () => { try { await revokeSession(s.id); toast(t('Device signed out')); await load() } catch (e) { toast(e.message || t('Could not sign out this device')) } },
  })
  const everywhere = () => confirmSheet({
    title: t('Sign out everywhere?'), message: t('Signs this profile out on every device, including this one. Your passkeys keep working — sign in with them again anytime.'),
    confirmText: t('Sign out everywhere'), danger: true,
    onConfirm: async () => { try { await signOutAll(); nav('/home'); toast(t('Signed out on all devices')) } catch { toast(t('Could not sign out everywhere — you are still signed in.')) } },
  })
  return <Section title={t('Your devices')} footer={data && !data.thisSessionListed ? t('This session was started before devices were listed, so it cannot be ended on its own. Signing out everywhere ends it too.') : t('Each browser or app you are signed in on. Only a coarse platform is kept — never an address or a location.')}>
    {data === null && <div className="card muted small">{t('Loading…')}</div>}
    {data && !data.sessions.length && <div className="card muted small">{t('No other sessions to show.')}</div>}
    {data && data.sessions.map(s => <SessionRow key={s.id} s={s} onEnd={end} />)}
    {data && <Row icon="signOut" iconTint="var(--red)" title={t('Sign out everywhere')} subtitle={t('Ends this profile’s sessions on all your devices.')} danger onClick={everywhere} />}
  </Section>
}

export function LinkDeviceSection() {
  const nav = useNavigate()
  const [id, setId] = useState('')
  return <Section title={t('Link another device')} footer={t('On the device you want to sign in, choose “Sign in with a QR code”, then scan it with this phone. If scanning is not possible, type the link code shown there.')}>
    <div style={{ padding: '10px 14px', display: 'grid', gap: 8 }}>
      <label className="muted small" htmlFor="link-id">{t('Link code')}</label>
      <input className="input" id="link-id" autoCapitalize="characters" autoComplete="off" maxLength={10} value={id} onChange={e => setId(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 10))} placeholder="ABCDE23456" />
      <Button icon="key" disabled={id.length !== 10} onClick={() => nav('/link/' + id)}>{t('Continue')}</Button>
    </div>
  </Section>
}

export function ActivitySection() {
  const [events, setEvents] = useState(null)
  useEffect(() => { fetchSecurityEvents().then(setEvents).catch(() => setEvents([])) }, [])
  return <Section title={t('Recent security activity')} footer={t('Only what happened to your account: no passwords, keys or locations are recorded.')}>
    {events === null && <div className="card muted small">{t('Loading…')}</div>}
    {events && !events.length && <div className="card muted small">{t('Nothing to show yet.')}</div>}
    {events && events.slice(0, 12).map(e => <Row key={e.id} icon="shield" title={t(EVENT_LABEL[e.event] || e.event)}
      subtitle={[when(e.at), e.byOther ? t('by staff') : null, e.meta?.platform, e.event === 'login_ok' && e.meta?.uv === false ? t('without device verification') : null].filter(Boolean).join(' · ')} />)}
  </Section>
}

export default function SecuritySettings() {
  const nav = useNavigate(), user = useStore(s => s.user)
  if (!user) return <div className="narrow"><div className="card">{t('Sign in to manage your security.')}</div></div>
  if (user.authLevel === 'pin' || user.authLevel === 'sso') return <div className="narrow"><div className="card">{t('Passkeys and devices are managed after signing in with a passkey.')}</div></div>
  return <div className="narrow">
    <div className="hdr"><button className="back" onClick={() => nav('/settings')} aria-label={t('Back')}><Icon name="chevronLeft" /></button><h1>{t('Security')}</h1></div>
    <PasskeysSection />
    <DevicesSection />
    <LinkDeviceSection />
    <ActivitySection />
  </div>
}
