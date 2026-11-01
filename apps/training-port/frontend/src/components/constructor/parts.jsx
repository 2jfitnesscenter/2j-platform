// Copyright (C) 2026 Juan Jose Perez Sanchez — 2J Fitness Center
// SPDX-License-Identifier: AGPL-3.0-or-later
// Small shared pieces of Constructor V2: block type identity, the compact prescription, and
// the protocol report. Styles: .cx-* in index.css.
import { useState } from 'react'
import { t } from '../../lib/i18n.js'
import { fmtSec } from '../../lib/history.js'
import { issueText, reasonText } from '../../lib/blocks-api.js'
import { TYPE_LABEL, repRange, modeOfEntry } from '../../lib/protocol/index.js'
import Icon from '../Icon.jsx'

export const TYPE_ICON = { strength: 'barbell', superset: 'link', circuit: 'intervals', cardio: 'figureRun', interval: 'timer', hiit: 'bolt', mobility: 'stretch' }

/** Type identity: icon + label, never color alone. */
export function TypeTag({ type, compact }) {
  return <span className={'cx-type cx-type-' + (type || 'strength')}>
    <Icon name={TYPE_ICON[type] || 'barbell'} />{!compact && t(TYPE_LABEL[type] || 'Straight sets')}
  </span>
}

export const OfficialTag = ({ official }) => official
  ? <span className="cx-src cx-src-off"><Icon name="shield" />{t('2J official')}</span>
  : <span className="cx-src"><Icon name="person" />{t('Mine')}</span>

/** "3 × 8–10" — the heart of the prescription, tabular and big enough to scan. */
export function schemeOf(e) {
  const mode = modeOfEntry(e)
  const sets = Math.max(1, Number(e.sets) || 1)
  if (mode === 'cardio') return `${sets > 1 ? sets + ' × ' : ''}${e.min || 20} min`
  if (mode === 'time') return `${sets} × ${fmtSec(e.sec || 45)}`
  const r = repRange(e)
  return `${sets} × ${r ? (r[0] === r[1] ? r[0] : `${r[0]}–${r[1]}`) : e.reps || 10}`
}
export const rpeOf = e => (Array.isArray(e.rpe) ? e.rpe : []).filter(v => [4, 6, 8, 10].includes(Number(v)))
export const restLabel = s => s >= 60 ? (s % 60 ? `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}` : `${s / 60} min`) : `${s} s`

/** Compact, readable prescription: 3 × 8–10 · RPE 8·8·10 · 90 s */
export function Prescription({ e, onClick }) {
  const rpe = rpeOf(e)
  const Tag = onClick ? 'button' : 'span'
  return <Tag className={'cx-rx' + (onClick ? ' tap' : '')} onClick={onClick} aria-label={onClick ? t('Edit prescription') : undefined}>
    <b className="cx-rx-scheme">{schemeOf(e)}</b>
    {rpe.length > 0 && <span className="cx-rx-rpe" title={t('Planned effort on the 2J scale')}>
      {t('RPE')} {rpe.every(v => v === rpe[0]) ? <i className={'r' + rpe[0]}>{rpe[0]}</i> : rpe.map((v, i) => <i key={i} className={'r' + v}>{v}</i>)}
    </span>}
    {e.rest > 0 && <span className="cx-rx-rest"><Icon name="timer" />{restLabel(e.rest)}</span>}
  </Tag>
}

const RESULT = {
  PASS: { cls: 'ok', icon: 'checkCircle', label: '2J Protocol · OK' },
  PASS_WITH_REASON: { cls: 'why', icon: 'info', label: '2J Protocol · with reasons' },
  FAIL: { cls: 'fail', icon: 'ban', label: '2J Protocol · does not fit' },
}
export function ProtocolPill({ v, onClick }) {
  // Nothing built yet is not a failure: no pill until there is something to judge.
  if (!v || (v.issues.length && v.issues.every(i => i.code === 'empty' || i.severity === 'note') && v.stats?.exercises === 0)) return null
  const r = RESULT[v.result]
  const Tag = onClick ? 'button' : 'span'
  return <Tag className={'cx-pill ' + r.cls} onClick={onClick}><Icon name={r.icon} />{t(r.label)}</Tag>
}

/** Issues grouped by severity; notes collapsed. Reasons are shown, never hidden. */
export function ProtocolReport({ v, dense }) {
  const [notes, setNotes] = useState(false)
  if (!v) return null
  const fails = v.issues.filter(i => i.severity === 'fail')
  const reasons = v.issues.filter(i => i.severity === 'reason')
  const infos = v.issues.filter(i => i.severity === 'note')
  // Judgements the validator could not make with confidence (exercise outside the curated
  // catalogue): stated honestly, never presented as a failure.
  const unver = v.issues.filter(i => i.severity === 'unverified')
  return <div className={'cx-report' + (dense ? ' dense' : '')}>
    <div className="cx-report-h"><ProtocolPill v={v} /><span className="cx-report-v">v{v.version}</span></div>
    {!v.issues.length && <div className="cx-report-ok">{t('Fits the 2J protocol for this goal and level.')}</div>}
    {fails.length > 0 && <ul className="cx-issues fail">{fails.map((i, k) => <li key={k}>{issueText(i)}</li>)}</ul>}
    {reasons.length > 0 && <ul className="cx-issues why">{reasons.map((i, k) => <li key={k}>{issueText(i)}{reasonText(i) && <em>{t('Reason')}: {reasonText(i)}</em>}</li>)}</ul>}
    {unver.length > 0 && <>
      <div className="cx-unver-h">{t('Could not be verified')}</div>
      <ul className="cx-issues unver">{unver.map((i, k) => <li key={k}>{issueText(i)}</li>)}</ul>
    </>}
    {infos.length > 0 && <>
      <button className="cx-linkbtn" onClick={() => setNotes(x => !x)}>{notes ? t('Hide notes') : t('{0} notes', infos.length)}</button>
      {notes && <ul className="cx-issues note">{infos.map((i, k) => <li key={k}>{issueText(i)}</li>)}</ul>}
    </>}
  </div>
}

/** The protocol verdict an AI proposal arrived with (api/coach/protocol-gate.js). */
export function AiProtocolNote({ protocol }) {
  if (!protocol) return null
  const v = { result: protocol.result, version: protocol.v, issues: (protocol.reasons || []).map(r => ({ ...r, severity: 'reason' })) }
  return <div className="cx-ainote"><ProtocolReport v={v} dense /></div>
}
