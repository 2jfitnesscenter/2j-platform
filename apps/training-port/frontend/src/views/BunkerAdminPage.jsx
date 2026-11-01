// Copyright (C) 2026 Juan Jose Perez Sanchez — 2J Fitness Center
// SPDX-License-Identifier: AGPL-3.0-or-later
import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { t, nameFor } from '../lib/i18n.js'
import { fmtNum } from '../lib/format.js'
import { EXIDX } from '../lib/exercises.js'
import {
  fetchBunkerAdminSessions, closeBunkerSession, pauseBunkerSession,
  fetchBunkerAdminSession, postBunkerAdminEditSet,
  fetchBunkerSettings, saveBunkerSettings,
  fetchBunkerAdminCode, fetchBunkerLaunchLink, resetBunkerRoomKey,
  fetchBunkerMembers, resetBunkerMemberPin,
} from '../lib/bunker-api.js'
import Icon from '../components/Icon.jsx'
import { Avatar } from '../components/ui.jsx'

const elapsed = ms => { const m = Math.floor(ms / 60000); return (m >= 60 ? Math.floor(m / 60) + 'h ' : '') + (m % 60) + 'm' }
const clock = iso => new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })

/* ============================ live session card ============================ */
function SessionCard({ s, onPause, onClose, onAssist }) {
  const [now, setNow] = useState(Date.now())
  useEffect(() => { const id = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(id) }, [])
  const restLeft = s.restEndsAt ? Math.max(0, Math.round((s.restEndsAt - now) / 1000)) : 0
  return <div className={'bkadm-card' + (s.paused ? ' paused' : '')}>
    <div className="bkadm-card-hd">
      <Avatar name={s.name} size={42} />
      <div className="grow">
        <div className="bkadm-card-name">{s.name}</div>
        <div className="bkadm-card-meta">{t('Since {0}', clock(s.checkinAt))} · {elapsed(now - s.checkinAt)}</div>
      </div>
      {s.paused && <span className="bkadm-badge">{t('Paused')}</span>}
    </div>
    <div className="bkadm-card-body">
      {s.exName ? <>
        <div className="bkadm-card-ex">{s.exName}</div>
        <div className="bkadm-card-set">{t('Set {0} of {1}', Math.min(s.setIdx + 1, s.setsTotal || 1), s.setsTotal || 1)}</div>
      </> : <div className="bkadm-card-ex dim">{t('Getting ready…')}</div>}
      {restLeft > 0 && !s.paused && <div className="bkadm-rest">
        <Icon name="clock" /><span className="tabular">{restLeft}s</span>
      </div>}
    </div>
    <div className="bkadm-card-acts">
      <button className="bkadm-act" onClick={() => onPause(s.uid, !s.paused)}>
        <Icon name={s.paused ? 'play' : 'pause'} />{s.paused ? t('Resume') : t('Pause')}
      </button>
      <button className="bkadm-act" onClick={() => onAssist(s.uid)}>
        <Icon name="pencil" />{t('Assist')}
      </button>
      <button className="bkadm-act danger" onClick={() => onClose(s.uid)}>
        <Icon name="xmark" />{t('Force close')}
      </button>
    </div>
  </div>
}

/* ============================ assist / adjust load ============================ */
// The one place a trainer edits an athlete's in-progress workout live, from their own device,
// without ever touching the public dashboard — see api/bunker/routes.js's own admin/edit-set,
// which writes straight to that athlete's S.active the same way their own bunker token would.
function AssistPanel({ uid, onClose, onSaved }) {
  const [session, setSession] = useState(null)
  const [active, setActive] = useState(null)
  const [exIdx, setExIdx] = useState(0)
  const [busy, setBusy] = useState(false)

  useEffect(() => { fetchBunkerAdminSession(uid).then(s => { setSession(s); setActive(s.active) }).catch(() => onClose()) }, [uid])

  if (!session) return <div className="bkadm-overlay"><div className="bkadm-modal"><div className="bkadm-loading">{t('Loading…')}</div></div></div>
  if (!active || !active.entries?.length) return <div className="bkadm-overlay">
    <div className="bkadm-modal">
      <button className="bkadm-close" onClick={onClose} aria-label={t('Close')}><Icon name="xmark" /></button>
      <div className="bkadm-modal-title">{t('Assist {0}', session.name)}</div>
      <div className="dim small">{t('No in-progress workout to adjust yet.')}</div>
    </div>
  </div>

  const exName = exId => (session.customEx || []).find(x => x.id === exId)?.n || (EXIDX[exId] ? nameFor(EXIDX[exId]) : exId)
  const entry = active.entries[exIdx]
  const setField = (si, field, delta) => {
    setActive(a => ({ ...a, entries: a.entries.map((e, i) => i !== exIdx ? e : {
      ...e, sets: e.sets.map((s, j) => j !== si ? s : { ...s, [field]: Math.max(0, Math.round((s[field] + delta) * 10) / 10) }),
    }) }))
  }
  const toggleDone = si => {
    setActive(a => ({ ...a, entries: a.entries.map((e, i) => i !== exIdx ? e : {
      ...e, sets: e.sets.map((s, j) => j !== si ? s : { ...s, done: !s.done }),
    }) }))
  }
  const save = () => {
    setBusy(true)
    const doneN = entry.sets.filter(s => s.done).length
    postBunkerAdminEditSet({ uid, active, operationId: uid + ':' + Date.now(), expectedActiveRevision: session.activeRevision, exId: entry.id, exName: exName(entry.id), setIdx: doneN, setsTotal: entry.sets.length })
      .then(() => { onSaved(); onClose() }).finally(() => setBusy(false))
  }

  return <div className="bkadm-overlay">
    <div className="bkadm-modal">
      <button className="bkadm-close" onClick={onClose} aria-label={t('Close')}><Icon name="xmark" /></button>
      <div className="bkadm-modal-title">{t('Assist {0}', session.name)}</div>
      <div className="bkadm-extabs">
        {active.entries.map((e, i) => (
          <button key={i} className={'bkadm-extab' + (i === exIdx ? ' on' : '')} onClick={() => setExIdx(i)}>{exName(e.id)}</button>
        ))}
      </div>
      <div className="bkadm-sets">
        {entry.sets.map((s, si) => (
          <div key={si} className={'bkadm-setrow' + (s.done ? ' done' : '')}>
            <span className="bkadm-setn">{si + 1}</span>
            <div className="bkadm-stp">
              <button onClick={() => setField(si, 'w', -2.5)}>−</button>
              <span className="tabular">{fmtNum(s.w)}</span>
              <button onClick={() => setField(si, 'w', 2.5)}>+</button>
            </div>
            <div className="bkadm-stp">
              <button onClick={() => setField(si, 'r', -1)}>−</button>
              <span className="tabular">{fmtNum(s.r)}</span>
              <button onClick={() => setField(si, 'r', 1)}>+</button>
            </div>
            <button className={'bkadm-check' + (s.done ? ' on' : '')} onClick={() => toggleDone(si)}><Icon name="check" /></button>
          </div>
        ))}
      </div>
      <button className="bkadm-save" disabled={busy} onClick={save}>{t('Save correction')}</button>
    </div>
  </div>
}

/* ============================ credentials module (PIN / QR / launch link) ============================ */
function CredentialsCard() {
  const [adminCode, setAdminCode] = useState(null)
  const [launchKey, setLaunchKey] = useState(null)
  const [qr, setQr] = useState(null)
  const [members, setMembers] = useState(null)
  const [q, setQ] = useState('')
  const [copied, setCopied] = useState('')

  const launchUrl = launchKey ? `${location.origin}/#/bunker/launch?token=${launchKey}` : ''

  const drawQr = async url => {
    setQr(null)
    try { const { default: QRCode } = await import('qrcode'); setQr(await QRCode.toDataURL(url, { margin: 1, width: 220, color: { dark: '#0B0F12', light: '#ffffff' } })) }
    catch { /* link still works without the image */ }
  }

  useEffect(() => {
    fetchBunkerAdminCode().then(setAdminCode).catch(() => {})
    fetchBunkerLaunchLink().then(k => { setLaunchKey(k); drawQr(`${location.origin}/#/bunker/launch?token=${k}`) }).catch(() => {})
    fetchBunkerMembers().then(setMembers).catch(() => {})
  }, [])

  const copy = (text, label) => {
    navigator.clipboard?.writeText(text).then(() => { setCopied(label); setTimeout(() => setCopied(''), 2000) }).catch(() => {})
  }
  const regenLink = () => resetBunkerRoomKey().then(k => { setLaunchKey(k); drawQr(`${location.origin}/#/bunker/launch?token=${k}`) })
  const resetPin = m => resetBunkerMemberPin(m.id).then(pin => setMembers(list => list.map(x => x.id === m.id ? { ...x, pin } : x)))

  const filtered = (members || []).filter(m => m.name.toLowerCase().includes(q.trim().toLowerCase()))

  return <div className="bkadm-panel">
    <h2 className="bkadm-h2">{t('Room credentials')}</h2>

    <div className="bkadm-cred-grid">
      <div>
        <div className="bkadm-label">{t('Master launch QR')}</div>
        <div className="bkadm-qr">{qr ? <img src={qr} alt={t('Bunker launch QR')} width={180} height={180} /> : <div style={{ width: 180, height: 180 }} />}</div>
        <div className="dim small" style={{ marginTop: 8, wordBreak: 'break-all' }}>{launchUrl}</div>
        <div className="row" style={{ gap: 8, marginTop: 10 }}>
          <button className="bkadm-chip" onClick={() => copy(launchUrl, t('Launch link'))}><Icon name="link" /> {t('Copy launch link')}</button>
          <button className="bkadm-chip" onClick={regenLink}><Icon name="reset" /> {t('Regenerate')}</button>
        </div>
      </div>
      {adminCode && <div>
        <div className="bkadm-label">{t('Your fixed admin code')}</div>
        <div className="bkadm-code">{adminCode}</div>
        <div className="dim small">{t('Enter this on the Bunker screen itself to manage the room without unlocking your phone. It’s fixed — there’s no way to change it here.')}</div>
      </div>}
    </div>
    {copied && <div className="bkadm-toast">{t('{0} copied', copied)}</div>}

    <div className="bkadm-label" style={{ marginTop: 22 }}>{t('Member PINs')}</div>
    <input className="bkadm-search" placeholder={t('Search a member…')} value={q} onChange={e => setQ(e.target.value)} />
    <div className="bkadm-members">
      {(members === null) && <div className="dim small">{t('Loading…')}</div>}
      {filtered.map(m => (
        <div key={m.id} className="bkadm-member-row">
          <span className="capitalize">{m.name}</span>
          <span className="tabular bkadm-pin">{m.pin}</span>
          <button className="bkadm-chip sm" onClick={() => resetPin(m)}>{t('Reset')}</button>
        </div>
      ))}
    </div>
  </div>
}

/* ============================ room settings ============================ */
function SettingsCard({ settings, onPatch }) {
  return <div className="bkadm-panel">
    <h2 className="bkadm-h2">{t('Room screen settings')}</h2>
    <div className="bkadm-setting">
      <span>{t('Grid columns')}</span>
      <div className="row" style={{ gap: 6 }}>
        {['auto', 2, 3, 4, 6].map(n => (
          <button key={n} className={'bkadm-chip sm' + (settings.columns === n ? ' on' : '')} onClick={() => onPatch({ columns: n })}>{n === 'auto' ? t('Auto') : n}</button>
        ))}
      </div>
    </div>
    <div className="bkadm-setting">
      <span>{t('Rest-over sound alert')}</span>
      <button className={'bkadm-toggle' + (settings.enableRestEndBeep ? ' on' : '')} onClick={() => onPatch({ enableRestEndBeep: !settings.enableRestEndBeep })}><i /></button>
    </div>
    <div className="bkadm-setting">
      <span>{t('Pulsing highlight on finished rest')}</span>
      <button className={'bkadm-toggle' + (settings.highlightFinishedRest ? ' on' : '')} onClick={() => onPatch({ highlightFinishedRest: !settings.highlightFinishedRest })}><i /></button>
    </div>
    <div className="bkadm-setting">
      <span>{t('Hide exact weights on the public screen')}</span>
      <button className={'bkadm-toggle' + (settings.hideWeightsInPublicView ? ' on' : '')} onClick={() => onPatch({ hideWeightsInPublicView: !settings.hideWeightsInPublicView })}><i /></button>
    </div>
    <div className="bkadm-setting">
      <span>{t('Personal panel auto-lock')}</span>
      <div className="row" style={{ gap: 6 }}>
        {[15, 30, 45, 60].map(n => (
          <button key={n} className={'bkadm-chip sm' + (settings.autoLockSec === n ? ' on' : '')} onClick={() => onPatch({ autoLockSec: n })}>{n}s</button>
        ))}
      </div>
    </div>
  </div>
}

/* ============================ root page ============================ */
// /admin/bunker — AdminGuard is enforced one level up (App.jsx's own route gate: `user?.admin
// || user?.trainer`, the exact equivalent of the spec's role==='admin'|'trainer' check against
// this app's actual boolean flags — redirecting to /home otherwise), so by the time this
// component ever renders, access is already granted.
export default function BunkerAdminPage() {
  const nav = useNavigate()
  const [sessions, setSessions] = useState([])
  const [settings, setSettings] = useState(null)
  const [assistUid, setAssistUid] = useState(null)

  const load = () => {
    fetchBunkerAdminSessions().then(setSessions).catch(() => {})
    fetchBunkerSettings().then(setSettings).catch(() => {})
  }
  useEffect(() => { load(); const id = setInterval(load, 5000); return () => clearInterval(id) }, [])

  const pause = (uid, paused) => pauseBunkerSession(uid, paused).then(load)
  const close = uid => closeBunkerSession(uid).then(load)
  const patch = p => saveBunkerSettings(p).then(setSettings)

  return <div className="bkadm-root">
    <div className="bkadm-hd">
      <button className="bkadm-iconbtn" onClick={() => nav(-1)} aria-label={t('Back')}><Icon name="chevronLeft" /></button>
      <div className="grow">
        <div className="bkadm-title">{t('Bunker room admin')}</div>
        <div className="bkadm-sub">{t('{0} checked in now', sessions.length)}</div>
      </div>
      <button className="bkadm-iconbtn" onClick={() => window.open('#/bunker', '_blank')} aria-label={t('Open the room screen')}><Icon name="expand" /></button>
    </div>

    <div className="bkadm-body">
      <div className="bkadm-panel">
        <h2 className="bkadm-h2">{t('Active sessions')}</h2>
        {sessions.length === 0 ? (
          <div className="dim small" style={{ padding: '10px 2px' }}>{t('Nobody checked in yet — be the first.')}</div>
        ) : (
          <div className="bkadm-grid">
            {sessions.map(s => <SessionCard key={s.uid} s={s} onPause={pause} onClose={close} onAssist={setAssistUid} />)}
          </div>
        )}
      </div>

      {settings && <SettingsCard settings={settings} onPatch={patch} />}
      <CredentialsCard />
    </div>

    {assistUid && <AssistPanel uid={assistUid} onClose={() => setAssistUid(null)} onSaved={load} />}
  </div>
}
