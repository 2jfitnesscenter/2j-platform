// Copyright (C) 2026 Juan Jose Perez Sanchez — 2J Fitness Center
// SPDX-License-Identifier: AGPL-3.0-or-later
import { useState } from 'react'
import { useStore } from '../store/useStore.js'
import { useUI } from '../store/useUI.js'
import { exOr } from '../lib/exercises.js'
import { EFFORT, feelFor, effortColor, EFFORT_COLOR_VAR, lastEntryFor } from '../lib/history.js'
import { fieldsFor, stepField, parseField, keypadInput, canComplete, platesApply, isBodyweightEq } from '../lib/set-entry.js'
import { workoutPrefs } from '../lib/workout-prefs.js'
import { fmtNum } from '../lib/format.js'
import { t, nameFor } from '../lib/i18n.js'
import Icon from './Icon.jsx'
import { Button } from './ui.jsx'

// The 2J set-entry pad: one set, its fields in order (KG → REPS → RPE), a big readable value,
// the gym's real −/+ increment, a keypad of our own (no system keyboard sliding over the field)
// and a way to complete the set. Every key press is written straight to the session through
// `onField` — the same store update the old inline steppers used — so the pad holds no data of
// its own: close it, lock the phone or kill the app mid-entry and the value is already in
// gym_state_v1, exactly like before. `onComplete`/`onPlates` come from the workout view so the
// completion path (rest timer, superset logic, finish prompt) is the one that already exists.
const KEYS = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '.', '0', 'back']
const RPE_CHIPS = [6, 6.5, 7, 7.5, 8, 8.5, 9, 9.5, 10]
const RIR_CHIPS = [5, 4, 3, 2.5, 2, 1.5, 1, 0.5, 0]

export function openSetPad(opts) {
  return useUI.getState().openSheet(close => <SetPad {...opts} close={close} />)
}

export function SetPad({ entryIdx, setIdx, field: startField, actions, close }) {
  const S = useStore(s => s.S)
  const entry = S.active?.entries[entryIdx]
  const [fi, setFi] = useState(() => {
    const fields = entry ? fieldsFor(entry, S) : []
    return Math.max(0, fields.findIndex(f => f.f === startField))
  })
  const [buf, setBuf] = useState(null)
  const [fresh, setFresh] = useState(true)
  const [missing, setMissing] = useState(false)
  if (!entry || !entry.sets[setIdx]) return null

  const ex = exOr(entry.id)
  const prefs = workoutPrefs(S)
  const fields = fieldsFor(entry, S)
  const field = fields[Math.min(fi, fields.length - 1)]
  const set = entry.sets[setIdx]
  const value = set[field.f]
  const shown = buf != null ? buf : (value == null ? '' : String(value))
  const last = S.showPreviousResults !== false ? lastEntryFor(S, entry.id) : null
  const workPos = entry.sets.slice(0, setIdx).filter(s => s.type !== 'warmup').length
  const prevSet = last && set.type !== 'warmup' ? (last.sets[workPos] || null) : null
  const lastField = fi >= fields.length - 1

  const write = v => { actions.onField(entryIdx, setIdx, field.f, v); setMissing(false) }
  const go = i => { setFi(i); setBuf(null); setFresh(true) }
  const press = key => {
    const next = keypadInput(shown, key, { dec: field.dec, fresh })
    setBuf(next); setFresh(false)
    write(parseField(field, next))
  }
  const step = dir => {
    write(stepField(S, ex.eq, field, value, dir))
    setBuf(null); setFresh(true)
  }
  const current = () => useStore.getState().S.active?.entries[entryIdx]?.sets[setIdx]
  const complete = () => {
    const s = current()
    if (s && !s.done) actions.onToggle(entryIdx, setIdx)
    close()
  }
  const finish = () => {
    if (!prefs.autoComplete) { close(); return }
    if (!canComplete(entry, current(), ex.eq)) { setMissing(true); return }
    complete()
  }
  const next = () => lastField ? finish() : go(fi + 1)

  const setNo = set.type === 'warmup' ? t('Warmup') : t('Set {0}', workPos + 1)
  const effortScale = field.effort ? EFFORT[field.effort] : null
  const feel = field.effort && value != null ? feelFor(field.effort, value) : null

  return <div className="setpad" data-nodrag>
    <div className="sp-head">
      <div className="sp-title">
        <span className={'sp-setno' + (set.type === 'warmup' ? ' warm' : '')}>{setNo}</span>
        <span className="sp-ex">{nameFor(ex)}</span>
      </div>
      <button className="iconbtn" aria-label={t('Close')} onClick={close}><Icon name="xmark" /></button>
    </div>

    <div className="sp-tabs" role="tablist">
      {fields.map((f, i) => {
        const v = set[f.f]
        return <button key={f.f} role="tab" aria-selected={i === fi} className={'sp-tab' + (i === fi ? ' on' : '')} onClick={() => go(i)}>
          <span className="sp-tab-l">{f.label}</span>
          <span className="sp-tab-v">{v == null ? '—' : fmtNum(v)}</span>
        </button>
      })}
    </div>

    <div className="sp-value" aria-live="polite">
      {!field.effort && <button className="sp-pm" aria-label={t('Decrease')} onClick={() => step(-1)}><Icon name="minus" /></button>}
      <div className="sp-read">
        <span className={'sp-num' + (fresh && buf == null ? ' fresh' : '')}>{shown === '' ? (field.opt ? '—' : '0') : shown.replace('.', ',')}</span>
        <span className="sp-unit">{field.short}</span>
      </div>
      {!field.effort && <button className="sp-pm" aria-label={t('Increase')} onClick={() => step(1)}><Icon name="plus" /></button>}
    </div>
    <div className="sp-hint">
      {prevSet && prevSet[field.f] != null
        ? <button className="sp-prev" onClick={() => { write(prevSet[field.f]); setBuf(null); setFresh(true) }}>
          <Icon name="history" />{t('Last time: {0}', fmtNum(prevSet[field.f]) + (field.effort ? '' : ' ' + field.short))}
        </button>
        : field.weight && isBodyweightEq(ex.eq) ? <span className="dim">{t('Bodyweight — add only extra load')}</span> : <span />}
      {field.weight && platesApply(S, ex.eq, entry, set) && value > 0 && <button className="sp-plates" onClick={() => actions.onPlates(entryIdx, setIdx)}>
        <Icon name="barbell" />{t('Plates')}
      </button>}
    </div>

    {field.effort
      ? <div className="sp-effort">
        {(field.effort === 'rpe' ? RPE_CHIPS : RIR_CHIPS).map(v => {
          const f = feelFor(field.effort, v)
          const c = effortColor(field.effort === 'rpe' ? 10 - v : v)
          return <button key={v} className={'sp-chip' + (value === v ? ' on' : '')} style={{ '--ec': EFFORT_COLOR_VAR[c] }}
            aria-label={effortScale.hd + ' ' + fmtNum(v) + ' — ' + t(f.label)}
            onClick={() => { write(v); setBuf(null); setFresh(true) }}>
            <span className="em" aria-hidden="true">{f.emoji}</span>{fmtNum(v)}
          </button>
        })}
        <div className="sp-feel">{feel ? t(feel.label) : t('Optional — how hard was this set?')}</div>
        {value != null && <button className="sp-clear" onClick={() => write(null)}>{t('Clear')}</button>}
      </div>
      : <div className="sp-keys">
        {KEYS.map(k => <button key={k} className="sp-key" disabled={k === '.' && !field.dec}
          aria-label={k === 'back' ? t('Delete') : k === '.' ? t('Decimal point') : k}
          onClick={() => press(k)}>{k === 'back' ? <Icon name="chevronLeft" /> : k === '.' ? ',' : k}</button>)}
      </div>}

    {missing && <div className="sp-missing" role="alert"><Icon name="info" />{t('Enter the reps (and the weight) before completing this set.')}</div>}

    <div className="sp-foot">
      <Button className="sp-back" disabled={fi === 0} icon="chevronLeft" onClick={() => go(fi - 1)}>{t('Back')}</Button>
      {lastField
        ? (prefs.autoComplete && !set.done
          ? <Button variant="primary" icon="check" onClick={finish}>{t('Complete set')}</Button>
          : <Button variant="primary" onClick={close}>{t('Done')}</Button>)
        : <Button variant="primary" trailingIcon="chevronRight" onClick={next}>{t('Next')}</Button>}
    </div>
    {!prefs.autoComplete && !set.done && <button className="sp-complete" onClick={complete}><Icon name="checkCircle" />{t('Complete set')}</button>}
  </div>
}
