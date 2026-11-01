// Copyright (C) 2026 Juan Jose Perez Sanchez — 2J Fitness Center
// SPDX-License-Identifier: AGPL-3.0-or-later
import { useEffect, useState } from 'react'
import { t } from '../lib/i18n.js'
import { todayISO, uid, exCount } from '../lib/format.js'
import { buildRoutineEntries } from '../lib/progression.js'
import { imgSrc, gifSrc } from '../lib/exercises.js'
import { supersetLabel } from '../lib/superset-colors.js'
import { glyphOf } from '../lib/glyphs.js'
import { guidedBlocksOf } from '../lib/guided.js'
import { bunkerOutline, bunkerUnit, stepTargets, upNext, compactCols } from '../lib/bunker-nav.js'
import Icon from '../components/Icon.jsx'

/* The pieces of ONE Bunker training panel that show and move through the routine. They are presentational: everything comes in as props
 * from that panel's own session, so several panels side by side (different members) can never read or change each other's state. */

// A brand-new session for `routine`, built with the exact same shared helper the phone app's beginWorkout() uses
// (lib/progression.js's buildRoutineEntries) — hidden exercises, supersets, progression and buildSets() behave identically here.
export function buildBunkerActive(S, routine) {
  return {
    id: uid(), d: todayISO(), start: Date.now(), routineId: routine.id,
    name: routine.name, bw: null, cur: 0,
    entries: buildRoutineEntries(S, routine),
    ...(guidedBlocksOf(routine).length ? { guidedBlocks: guidedBlocksOf(routine) } : {}),
  }
}

/** "What do you want to train today?" — only when nothing is scheduled or running. Picking writes S.active and nothing else. */
export function BunkerTodayPicker({ routines, sessionS, onPickRoutine, onFreeTraining }) {
  const usable = (routines || []).filter(r => buildRoutineEntries(sessionS(), r).length > 0)
  return <div className="bk-picker">
    <div className="bk-picker-title">{t('What do you want to train today?')}</div>
    <div className="bk-picker-list">
      {usable.map(r => (
        <button key={r.id} className="bk-tool-exrow" onClick={() => onPickRoutine(r)}>
          <span className="bk-picker-routine-icon"><Icon name={glyphOf(r.emoji)} /></span>
          <span className="bk-tool-exname">{r.name}</span>
          <span className="bk-tool-exmeta">{exCount(r.ex.length)}</span>
        </button>
      ))}
      {!usable.length && <div className="bk-tool-empty">{t('No saved routines yet.')}</div>}
    </div>
    <button className="bk-join" onClick={onFreeTraining}><Icon name="shuffle" />{t('Freestyle workout (pick as you go)')}</button>
  </div>
}

/** The whole session as a strip: every exercise, where it stands (done / current / next), its superset letter and its set count. */
export function BunkerOutline({ entries, cur, ssInfo = [], nameOf, onGo, children }) {
  if (!entries?.length) return null
  const rows = bunkerOutline(entries, cur)
  return <div className="bk-exlist" role="list" aria-label={t('Exercises')}>
    {rows.map(r => <button key={r.index} role="listitem" data-state={r.state} aria-current={r.state === 'current' ? 'step' : undefined}
      className={'bk-extab' + (r.state === 'current' ? ' on' : '') + (r.done === r.total && r.total > 0 ? ' done' : '') + (r.state === 'next' ? ' next' : '')}
      onClick={() => onGo(r.index)}>
      <span className="bk-extab-title">
        <b className="bk-extab-code">{ssInfo[r.index] ? supersetLabel(ssInfo[r.index]) : r.index + 1}</b>
        <span className="bk-extab-name">{nameOf(entries[r.index].id)}</span>
      </span>
      <span className="bk-extab-n">{r.state === 'next' && <i className="bk-extab-tag">{t('Next')}</i>}{r.done}/{r.total}</span>
    </button>)}
    {children}
  </div>
}

/** Previous / next buttons (always available, they only move the cursor) and a plain "up next" line. */
export function BunkerStepper({ entries, cur, nameOf, onGo, disabled = false }) {
  if (!entries?.length) return null
  const { prev, next } = stepTargets(entries, cur)
  const nxt = upNext(entries, cur)
  return <div className="bk-stepper">
    <button className="bk-step" disabled={disabled || prev === null} onClick={() => onGo(prev)} aria-label={t('Previous exercise')}><Icon name="chevronLeft" /></button>
    <div className="bk-step-mid" aria-live="polite">
      <span className="bk-step-pos">{t('Exercise {0} of {1}', cur + 1, entries.length)}</span>
      <span className="bk-step-next">{nxt === null ? t('All exercises done') : t('Up next: {0}', nameOf(entries[nxt].id))}</span>
    </div>
    <button className="bk-step" disabled={disabled || next === null} onClick={() => onGo(next)} aria-label={t('Next exercise')}><Icon name="chevronRight" /></button>
  </div>
}

/** A / B (/ C) chips for a superset: switches which partner is on screen. Nothing is written; each partner keeps its own sets. */
export function BunkerSupersetSwitch({ entries, cur, ssInfo = [], nameOf, onGo }) {
  const unit = bunkerUnit(entries, cur)
  if (unit.length < 2) return null
  return <div className="bk-ab" role="group" aria-label={t('Superset')}>
    <Icon name="link" />
    {unit.map(i => {
      const done = entries[i].sets.filter(s => s.done).length
      return <button key={i} className={'bk-ab-chip' + (i === cur ? ' on' : '')} aria-pressed={i === cur} onClick={() => onGo(i)}>
        <b>{supersetLabel(ssInfo[i])}</b><span>{nameOf(entries[i].id)}</span><i>{done}/{entries[i].sets.length}</i>
      </button>
    })}
  </div>
}

/** The exercise image from the current library (gif first, else still). A clean placeholder when there is none or it fails to load. */
export function BunkerExerciseMedia({ ex, name }) {
  const [broken, setBroken] = useState(false)
  const src = ex?.gif ? gifSrc(ex) : ex?.img ? imgSrc(ex) : null
  if (!src || broken) return <div className="bk-exmedia bk-exmedia-fallback" role="img" aria-label={t('No image available')}>
    <Icon name="dumbbell" /><span>{name}</span>
  </div>
  return <img className="bk-exmedia" src={src} alt={name} loading="lazy" decoding="async" onError={() => setBroken(true)} />
}

/** One member in the compact grid: who, what they are doing now, where they are in the routine, the target, the effort, the rest timer, the superset letter and what comes next. Tap to open the full panel. */
export function BunkerCompactCard({ name, routineName, facts, exName, nextName, ssLabel, partner, progress, rest, warn, hidden, onOpen }) {
  const open = e => { if (e.type === 'click' || e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onOpen() } }
  const tg = facts?.target
  return <div className="bk-ccard" role="button" tabIndex={0} style={hidden ? { display: 'none' } : undefined} onClick={open} onKeyDown={open} aria-label={t('Open {0}', name)}>
    <div className="bk-cc-top"><b className="bk-cc-name">{name}</b>{rest}</div>
    {warn && <div className="bk-cc-warn">{warn}</div>}
    {facts ? <>
      <div className="bk-cc-ex">{ssLabel && <span className="bk-ssbadge">{ssLabel}</span>}{exName}{partner && <small className="bk-cc-partner"> ⇄ {partner}</small>}</div>
      <div className="bk-cc-meta">
        <span>{t('Set {0} of {1}', facts.setNo, facts.setTotal)}</span>
        {tg && (tg.mode === 'cardio' ? <span>{tg.min ? tg.min + ' ' + t('min') : ''}</span> : <span>{tg.sets} × {tg.reps ?? '—'}{tg.mode === 'time' ? 's' : ''}</span>)}
        {facts.rpe && <span className="bk-cc-rpe">{facts.rpe.kind.toUpperCase()} {facts.rpe.value}</span>}
      </div>
      <div className="bk-cc-pos">{t('Exercise {0} of {1}', facts.position, facts.total)}{routineName ? ' · ' + routineName : ''}</div>
      <div className="bk-cc-next">{nextName ? t('Up next: {0}', nextName) : t('All exercises done')}</div>
    </> : <div className="bk-cc-ex dim">{routineName || t('Getting ready…')}</div>}
    {progress && <div className="bk-live-progress-track" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={progress.percent}><span style={{ width: progress.percent + '%' }} /></div>}
  </div>
}

/** Window size, for the compact grid's density. */
function useViewport() {
  const read = () => (typeof window === 'undefined' ? [1920, 1080] : [window.innerWidth, window.innerHeight])
  const [size, setSize] = useState(read)
  useEffect(() => { const on = () => setSize(read()); window.addEventListener('resize', on); return () => window.removeEventListener('resize', on) }, [])
  return size
}

/** The open panels, side by side. One panel per member credential, keyed by uid: nothing is shared between them. Hidden ones stay mounted. */
export function BunkerPanelGrid({ credentials, activeUids, renderPanel, compact = false, focusUid = null }) {
  const open = activeUids.filter(uid => credentials[uid])
  const [w, h] = useViewport()
  const grid = compact && !focusUid           // the compact grid; with a focused member the one full panel is shown instead
  const cols = compactCols(open.length, w, h)
  const rows = Math.ceil(open.length / cols)
  const dense = (h - 170) / rows < 250 || w / cols < 300   // density follows the real card size, not just the head-count
  return <div className={grid ? `bk-multi-grid compact${dense ? ' dense' : ''}` : `bk-multi-grid users-${Math.min(compact && focusUid ? 1 : open.length, 3)}${!compact && open.length > 3 ? ' overflow-panels' : ''}`}
    style={grid ? { '--cols': cols, '--rows': rows } : undefined} data-layout={grid ? 'compact' : 'normal'}>
    {Object.entries(credentials).map(([uid, c]) => renderPanel(uid, c, !activeUids.includes(uid) || (compact && !!focusUid && uid !== focusUid), { compact: compact && uid !== focusUid, focused: compact && focusUid === uid }))}
  </div>
}
