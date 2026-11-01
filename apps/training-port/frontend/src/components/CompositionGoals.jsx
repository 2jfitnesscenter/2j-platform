// Copyright (C) 2026 Juan Jose Perez Sanchez — 2J Fitness Center
// SPDX-License-Identifier: AGPL-3.0-or-later
// Health V2 → "Composition goals": for weight, body fat and muscle mass, the current value, the trend, the member's own goal and where it stands, plus the documented
// reference band when there is one (lib/composition-goals.js says which and why). Optional, private to the member, and it never reads as a medical verdict: every state
// has a text label next to its colour, and a metric without a published range says so instead of inventing one.
import { useStore } from '../store/useStore.js'
import { useUI } from '../store/useUI.js'
import { t } from '../lib/i18n.js'
import { fmtNum, fmtDate } from '../lib/format.js'
import { GOAL_KEYS, goalStatus, goalOf, referenceRange, withGoal, validTarget } from '../lib/composition-goals.js'
import { metricDef } from '../lib/health.js'
import Icon from './Icon.jsx'
import { useState } from 'react'
import './composition-goals.css'

const TITLE = { weight: 'Weight', bodyFat: 'Body fat', muscleMass: 'Muscle mass' }
const STATE = {
  reached: { label: 'Goal reached', icon: 'checkCircle', tone: 'good' },
  toward: { label: 'Moving toward your goal', icon: 'arrowUp', tone: 'good' },
  away: { label: 'Moving away from your goal', icon: 'arrowDown', tone: 'warn' },
  flat: { label: 'Holding steady', icon: 'minus', tone: 'calm' },
  'few-data': { label: 'Not enough readings for a trend yet', icon: 'info', tone: 'calm' },
  'no-data': { label: 'No reading yet', icon: 'info', tone: 'calm' },
}
const NEEDS = { birthDate: 'Add your birth date in your profile to see reference ranges.', sex: 'Add your sex in your physical profile to see this reference range.', height: 'Add your height in your profile to see BMI.' }
const unitOf = (key, S) => (key === 'weight' ? S.unit || 'kg' : metricDef(key)?.unit || '')
const signed = v => (v > 0 ? '+' : v < 0 ? '−' : '±') + fmtNum(Math.abs(v))

function GoalSheet({ metric, S, close }) {
  const update = useStore(s => s.update)
  const toast = useUI(s => s.toast)
  const goal = goalOf(S, metric)
  const cur = goalStatus(S, metric)?.current
  const [v, setV] = useState(goal?.target ?? '')
  const unit = unitOf(metric, S)
  const save = () => {
    if (!validTarget(metric, v)) { toast(t('Enter a realistic value')); return }
    update(s => { if (metric === 'weight') s.targetW = Number(v); else s.compGoals = withGoal(s, metric, v) })
    toast(t('Goal saved')); close()
  }
  const remove = () => { update(s => { if (metric === 'weight') s.targetW = null; else s.compGoals = withGoal(s, metric, null) }); toast(t('Goal removed')); close() }
  return <div className="cg-sheet">
    <h3>{t(TITLE[metric])} · {t('Goal')}</h3>
    <p className="dim small">{cur ? t('Now: {0} {1}', fmtNum(cur.v), unit) : t('No reading yet — you can still set a goal.')}</p>
    <label className="cg-field"><span>{t('Goal')} ({unit})</span><input className="input" type="number" inputMode="decimal" step="0.1" value={v} onChange={e => setV(e.target.value)} /></label>
    <p className="dim small">{t('A personal goal, only visible to you. It is not a recommendation.')}</p>
    <button className="btn primary" onClick={save}>{t('Save')}</button>
    {goal && <><div style={{ height: 8 }} /><button className="btn danger" onClick={remove}>{t('Remove goal')}</button></>}
  </div>
}

function Range({ S, metric }) {
  const r = referenceRange(S, metric)
  if (r.kind === 'band') {
    return <div className="cg-range">
      <span className="cg-k">{t('Reference')}</span>
      <b>{r.unit === 'BMI' ? `BMI ${fmtNum(r.value)}` : `${fmtNum(r.value)} %`} · {t(r.band.label)} ({r.band.text})</b>
      <small className="dim">{t('Basis: {0}. A general reference, not a diagnosis.', r.basis)}{r.unit === 'BMI' ? ' ' + t('BMI does not tell muscle from fat.') : ''}{r.sex ? ' ' + t('Band for {0}; change your sex in your profile if this is not right.', t(r.sex === 'female' ? 'women' : 'men')) : ''}</small>
    </div>
  }
  if (r.kind === 'needs') return <div className="cg-range"><small className="dim">{t(NEEDS[r.need])}</small></div>
  if (r.why === 'muscle') return <div className="cg-range"><small className="dim">{t('There is no widely accepted reference range for muscle mass on a gym scale, so we show your trend and your goal only.')}</small></div>
  if (r.why === 'adult-only') return <div className="cg-range"><small className="dim">{t('Reference ranges are only shown for adults.')}</small></div>
  return null
}

export default function CompositionGoals({ S }) {
  const openSheet = useUI(s => s.openSheet)
  const rows = GOAL_KEYS.map(k => ({ k, st: goalStatus(S, k) })).filter(r => r.st || r.k === 'weight' || r.k === 'bodyFat' || r.k === 'muscleMass')
  const anything = rows.some(r => r.st)
  if (!anything) return null
  return <section className="cg" aria-label={t('Composition goals')}>
    <h4 className="sec">{t('Composition goals')}</h4>
    <p className="dim small cg-lead">{t('Optional. Set a goal for the measures you already track and see where you stand. Only you see this.')}</p>
    {rows.filter(r => r.st).map(({ k, st }) => {
      const unit = unitOf(k, S)
      const state = STATE[st.state]
      return <article key={k} className="card cg-card">
        <div className="cg-head"><b>{t(TITLE[k])}</b>
          <button className="btn plain cg-edit" onClick={() => openSheet(close => <GoalSheet metric={k} S={S} close={close} />)}>{st.target != null ? t('Edit goal') : t('Set a goal')}</button></div>
        <div className="cg-nums">
          <div><span className="cg-k">{t('Now')}</span><b className="cg-v">{st.current ? `${fmtNum(st.current.v)} ${unit}` : '—'}</b>{st.current && <small className="dim">{fmtDate(st.current.d)}</small>}</div>
          <div><span className="cg-k">{t('Trend (90 days)')}</span><b className="cg-v">{st.delta != null ? `${signed(st.delta)} ${unit === '%' ? t('pts') : unit}` : '—'}</b></div>
          <div><span className="cg-k">{t('Goal')}</span><b className="cg-v">{st.target != null ? `${fmtNum(st.target)} ${unit}` : '—'}</b>{st.remaining != null && st.state !== 'reached' && <small className="dim">{t('{0} to go', `${fmtNum(Math.abs(st.remaining))} ${unit === '%' ? t('pts') : unit}`)}</small>}</div>
        </div>
        {st.target != null && <>
          {st.progressPct != null && <div className="cg-bar" role="progressbar" aria-label={t('Progress toward your goal')} aria-valuemin="0" aria-valuemax="100" aria-valuenow={st.progressPct}><i style={{ width: st.progressPct + '%' }} /></div>}
          <div className={'cg-state ' + state.tone}><Icon name={state.icon} />{t(state.label)}</div>
        </>}
        <Range S={S} metric={k} />
      </article>
    })}
  </section>
}
