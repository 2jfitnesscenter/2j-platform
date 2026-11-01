// Copyright (C) 2026 Juan Jose Perez Sanchez — 2J Fitness Center
// SPDX-License-Identifier: AGPL-3.0-or-later
import { useState } from 'react'
import { useStore } from '../store/useStore.js'
import { t } from '../lib/i18n.js'
import { PAIN_ZONES, saveCheckin, skipCheckin, checkinOn } from '../lib/checkin.js'
import Icon from './Icon.jsx'
import { Button } from './ui.jsx'

// The pre-workout check-in: three 1-5 taps, "any discomfort?", done. Skippable in one tap and
// never in the way — the workout underneath works whether or not this is answered. Saving is a
// normal profile update (durable offline, synced like everything else).
const SCALE_Q = {
  energy: { label: 'Energy', low: 'Low', high: 'High' },
  sleep: { label: 'Sleep / rest', low: 'Poor', high: 'Great' },
  fatigue: { label: 'Fatigue', low: 'Fresh', high: 'Very tired' },
}

export default function CheckInCard({ onDone, compact = false }) {
  const S = useStore(s => s.S)
  const update = useStore(s => s.update)
  const today = checkinOn(S)
  const [v, setV] = useState(() => ({ energy: today?.energy ?? null, sleep: today?.sleep ?? null, fatigue: today?.fatigue ?? null,
    pain: today?.pain ?? null, zones: today?.zones || [], note: today?.note || '' }))
  const [showNote, setShowNote] = useState(!!today?.note)
  const set = patch => setV(x => ({ ...x, ...patch }))
  const toggleZone = z => set({ zones: v.zones.includes(z) ? v.zones.filter(x => x !== z) : [...v.zones, z] })
  const answered = v.energy || v.sleep || v.fatigue || v.pain != null
  const save = () => { update(s => { saveCheckin(s, v) }); onDone?.('saved') }
  const skip = () => { update(s => { skipCheckin(s) }); onDone?.('skipped') }

  return <section className={'checkin card' + (compact ? ' compact' : '')} aria-label={t('How do you arrive today?')}>
    <div className="ci-hd">
      <div><div className="ci-t">{t('How do you arrive today?')}</div><div className="ci-s">{t('A few taps. Only you see this, unless you share check-ins with the gym staff in Settings.')}</div></div>
      <button className="iconbtn" aria-label={t('Skip')} onClick={skip}><Icon name="xmark" /></button>
    </div>
    {Object.entries(SCALE_Q).map(([k, q]) => <div key={k} className="ci-row" role="radiogroup" aria-label={t(q.label)}>
      <div className="ci-l"><span>{t(q.label)}</span><span className="ci-ends">{t(q.low)} · {t(q.high)}</span></div>
      <div className="ci-scale">{[1, 2, 3, 4, 5].map(n => <button key={n} role="radio" aria-checked={v[k] === n}
        aria-label={t(q.label) + ' ' + n} className={'ci-dot' + (v[k] === n ? ' on' : '')} onClick={() => set({ [k]: v[k] === n ? null : n })}>{n}</button>)}</div>
    </div>)}
    <div className="ci-row">
      <div className="ci-l"><span>{t('Any discomfort?')}</span></div>
      <div className="ci-yn">
        <button className={'chip' + (v.pain === false ? ' on' : '')} onClick={() => set({ pain: false, zones: [] })}>{t('No')}</button>
        <button className={'chip' + (v.pain === true ? ' on' : '')} onClick={() => set({ pain: true })}>{t('Yes')}</button>
      </div>
    </div>
    {v.pain && <div className="ci-zones" role="group" aria-label={t('Where?')}>
      {PAIN_ZONES.map(z => <button key={z.key} aria-pressed={v.zones.includes(z.key)} className={'chip' + (v.zones.includes(z.key) ? ' on' : '')} onClick={() => toggleZone(z.key)}>{t(z.label)}</button>)}
    </div>}
    {showNote
      ? <input className="field ci-note" maxLength={140} placeholder={t('Short note (optional)')} value={v.note} onChange={e => set({ note: e.target.value })} />
      : <button className="ci-addnote" onClick={() => setShowNote(true)}><Icon name="plus" />{t('Add a note')}</button>}
    <div className="ci-acts">
      <Button onClick={skip}>{t('Skip')}</Button>
      <Button variant="primary" disabled={!answered || (v.pain && !v.zones.length)} onClick={save}>{t('Save')}</Button>
    </div>
  </section>
}
