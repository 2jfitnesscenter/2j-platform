// Copyright (C) 2026 Juan Jose Perez Sanchez — 2J Fitness Center
// SPDX-License-Identifier: AGPL-3.0-or-later
// The guided executor (Constructor V2.1): circuit, intervals, HIIT/Tabata and mobility blocks run
// inside the live workout, on the same session — see lib/guided.js for the model. This file is
// only the screen: the clock is recomputed from the stored end time on every tick, and the store
// is written on phase changes only (never per second).
import { useEffect, useMemo, useRef, useState } from 'react'
import { useStore } from '../store/useStore.js'
import { useUI } from '../store/useUI.js'
import { t, nameFor } from '../lib/i18n.js'
import { exOr, imgSrc, gifSrc } from '../lib/exercises.js'
import { beep, vibrate } from '../lib/sound.js'
import { fmtClock } from '../lib/clock.js'
import { useWakeLock } from '../lib/wakelock.js'
import { workoutPrefs } from '../lib/workout-prefs.js'
import { TYPE_LABEL } from '../lib/protocol/index.js'
import { buildSteps, roundsOf, advance, pause, resume, adjustTime, catchUp, summarize, entriesOf, startRun, timingLine } from '../lib/guided.js'
import { confirmSheet } from '../sheets.jsx'
import { Thumb } from './Media.jsx'
import Icon from './Icon.jsx'

export const guidedLabel = b => b.timing?.preset === 'tabata' ? 'Tabata' : TYPE_LABEL[b.type] || b.type
const PHASE = { prep: 'Get ready', work: 'Work', rest: 'Rest', roundRest: 'Round rest' }

/** Write a step change (and the sets it completes) into the session in one update. */
export function commitGuided(update, block, out, now = Date.now()) {
  update(s => {
    const A = s.active
    if (!A) return
    for (const m of out.marks) {
      const set = A.entries[m.e]?.sets[m.s]
      if (!set) continue
      set.done = true
      if (m.sec) set.sec = m.sec
    }
    if (out.finished) closeRun(A, block, out.run, now)
    else A.guided = out.run
  })
}
/** End the run: its summary joins the session's guided log; the workout moves past the block. */
export function closeRun(A, block, run, now = Date.now()) {
  const steps = buildSteps(A, block)
  A.guidedLog = [...(A.guidedLog || []).filter(g => g.iid !== block.iid), summarize(A, block, run, steps, now)]
  A.guided = null
  const idx = entriesOf(A, block.iid)
  const after = idx.length ? idx[idx.length - 1] + 1 : -1
  if (after > 0 && after < A.entries.length) A.cur = after
}

/** The block's card in the workout before it is run: what it is and one tap to start it. */
export function GuidedLaunch({ block }) {
  const S = useStore(s => s.S)
  const update = useStore(s => s.update)
  const toast = useUI(s => s.toast)
  const A = S.active
  const idx = entriesOf(A, block.iid)
  const steps = useMemo(() => buildSteps(A, block), [A.entries, block])
  const works = steps.filter(s => s.k === 'work')
  const doneN = works.filter(s => A.entries[s.e].sets[s.s].done).length
  const secs = steps.reduce((a, s) => a + (s.sec || 40), 0)
  const start = () => {
    const prefs = workoutPrefs(S)
    const run = startRun(A, block, { sound: prefs.sound, vibrate: prefs.vibrate })
    if (!run) { toast(t('Every bout of this block is already done')); return }
    useUI.getState().stopRest()
    update(s => { s.active.guided = run })
  }
  const ranBefore = (A.guidedLog || []).some(g => g.iid === block.iid)
  return <section className="gx-launch">
    <div className="gx-launch-h">
      <span className="gx-type"><Icon name={block.type === 'mobility' ? 'stretch' : block.type === 'circuit' ? 'intervals' : block.type === 'hiit' ? 'bolt' : 'timer'} />{t(guidedLabel(block))}</span>
      <span className="gx-launch-min num">~{Math.max(1, Math.round(secs / 60))} min</span>
    </div>
    <h3 className="gx-launch-t">{block.name || t(guidedLabel(block))}</h3>
    <div className="gx-launch-tm num">{timingLine(block.timing)}</div>
    <ol className="gx-launch-list">
      {idx.map(i => { const ex = exOr(A.entries[i].id); return <li key={i}><Thumb ex={ex} /><span className="capitalize">{nameFor(ex)}</span></li> })}
    </ol>
    {doneN === works.length && works.length > 0
      ? <div className="gx-launch-done"><Icon name="checkCircle" />{ranBefore ? t('Guided block completed') : t('Every bout of this block is already done')}</div>
      : <button className="btn primary gx-launch-go" onClick={start}><Icon name="play" />
        {doneN > 0 ? t('Resume guided block') : t('Start guided block')}</button>}
    <p className="gx-launch-note dim small">{doneN > 0 ? t('{0} of {1} bouts done.', doneN, works.length) + ' ' : ''}{t('You can also log its sets by hand below.')}</p>
  </section>
}

function Ring({ frac, children, phase }) {
  const r = 46, c = 2 * Math.PI * r
  return <div className={'gx-ring ' + phase}>
    <svg viewBox="0 0 100 100" aria-hidden="true">
      <circle cx="50" cy="50" r={r} className="gx-ring-track" />
      <circle cx="50" cy="50" r={r} className="gx-ring-fill" strokeDasharray={c} strokeDashoffset={c * (1 - Math.max(0, Math.min(1, frac)))} transform="rotate(-90 50 50)" />
    </svg>
    <div className="gx-ring-c">{children}</div>
  </div>
}

export default function GuidedRunner({ block }) {
  const S = useStore(s => s.S)
  const update = useStore(s => s.update)
  const toast = useUI(s => s.toast)
  const A = S.active
  const run = A.guided
  const prefs = workoutPrefs(S)
  const steps = useMemo(() => buildSteps(A, block), [A.entries, block])
  const [now, setNow] = useState(Date.now())
  const lastWhole = useRef(null)
  const committing = useRef(null)
  useWakeLock(true)

  useEffect(() => {
    const tick = () => setNow(Date.now())
    const iv = setInterval(tick, 250)
    document.addEventListener('visibilitychange', tick)
    return () => { clearInterval(iv); document.removeEventListener('visibilitychange', tick) }
  }, [])

  const step = steps[run.i]
  const nextWork = steps.slice(run.i + (step?.k === 'work' ? 1 : 0)).find(s => s.k === 'work')
  const cue = kind => {
    if (kind === 'work') { beep(run.sound, 1320, 0.25); if (run.vibrate) vibrate([200, 100, 200]) }
    else if (kind === 'end') { beep(run.sound, 880, 0.15); beep(run.sound, 1100, 0.15, 0.18); beep(run.sound, 1320, 0.3, 0.36); if (run.vibrate) vibrate([200, 100, 200, 100, 300]) }
    else { beep(run.sound, 660, 0.2); if (run.vibrate) vibrate(120) }
  }

  // The step ran out (on screen, or while the phone was locked/backgrounded): catch up in order.
  useEffect(() => {
    if (!run || run.paused || run.endsAt == null || run.endsAt > now) return
    const key = run.i + ':' + run.endsAt
    if (committing.current === key) return
    committing.current = key
    const out = catchUp(run, steps, now)
    if (out.run.i === run.i && !out.finished) return
    commitGuided(update, block, out, now)
    const n = (out.run.bg || 0) - (run.bg || 0)
    if (document.visibilityState === 'visible' && n > 1) toast(t('{0} intervals completed while the app was in the background', n))
    cue(out.finished ? 'end' : steps[out.run.i]?.k === 'work' ? 'work' : 'rest')
  }, [now, run, steps])

  // 3-2-1 before the end of any timed step.
  const left = run.paused ? run.left : run.endsAt != null ? Math.max(0, Math.ceil((run.endsAt - now) / 1000)) : null
  useEffect(() => {
    if (left == null || run.paused) return
    if (left === lastWhole.current) return
    lastWhole.current = left
    if (left > 0 && left <= 3) beep(run.sound, 660, 0.1)
  }, [left])

  if (!step) return null
  const ex = step.k === 'work' ? exOr(A.entries[step.e].id) : nextWork ? exOr(A.entries[nextWork.e].id) : null
  const e = step.k === 'work' ? A.entries[step.e] : null
  const total = step.sec || 0
  const frac = total ? (left ?? total) / total : 1
  const works = steps.filter(s => s.k === 'work')
  const doneN = works.filter(s => A.entries[s.e].sets[s.s].done).length
  const rounds = roundsOf(steps)
  const round = step.round || (nextWork?.round ?? 1)
  const phase = step.k

  const set = next => update(s => { if (s.active) s.active.guided = next })
  const doAdvance = done => {
    const out = advance(run, steps, { done, now: Date.now() })
    commitGuided(update, block, out)
    cue(out.finished ? 'end' : steps[out.run.i]?.k === 'work' ? 'work' : 'rest')
  }
  const finishEarly = () => confirmSheet({
    title: t('Finish this block now?'),
    message: t('What you have completed is kept; the rest stays unchecked and can still be logged by hand.'),
    confirmText: t('Finish block'),
    onConfirm: () => update(s => { if (s.active) closeRun(s.active, block, s.active.guided) }),
  })
  const toggle = k => set({ ...run, [k]: !run[k] })

  return <section className={'gx ' + phase} aria-label={t('Guided block')}>
    <header className="gx-top">
      <span className="gx-type"><Icon name={block.type === 'mobility' ? 'stretch' : block.type === 'circuit' ? 'intervals' : block.type === 'hiit' ? 'bolt' : 'timer'} />{t(guidedLabel(block))}</span>
      <div className="gx-title">{block.name || t(guidedLabel(block))}</div>
      <div className="gx-toggles">
        <button className={'gx-tg' + (run.sound ? ' on' : '')} aria-pressed={run.sound} onClick={() => toggle('sound')}><Icon name={run.sound ? 'bell' : 'bellSlash'} />{t('Sound')}</button>
        <button className={'gx-tg' + (run.vibrate ? ' on' : '')} aria-pressed={run.vibrate} onClick={() => toggle('vibrate')}>{t('Vibration')}</button>
      </div>
    </header>

    <div className="gx-prog" role="progressbar" aria-valuemin={0} aria-valuemax={works.length} aria-valuenow={doneN} aria-label={t('Guided block progress')}>
      {works.map((w, k) => <i key={k} className={(A.entries[w.e].sets[w.s].done ? 'on' : '') + (w === step ? ' cur' : '')} />)}
    </div>
    <div className="gx-meta num">
      <span>{rounds > 1 ? t('Round {0} of {1}', round, rounds) : t('One round')}</span>
      <span>{t('{0} of {1} done', doneN, works.length)}</span>
    </div>

    <div className="gx-stage">
      <div className="gx-phase" aria-live="polite">{t(PHASE[phase])}</div>
      <Ring frac={step.sec ? frac : 1} phase={phase}>
        {step.sec
          ? <><b className="gx-time num">{fmtClock(left ?? total)}</b>{run.paused && <span className="gx-paused">{t('Paused')}</span>}</>
          : <><b className="gx-time num">{e?.sets[step.s]?.r || e?.target?.reps || '—'}</b><span className="gx-unit">{t('reps')}</span></>}
      </Ring>
      {ex && <div className="gx-ex">
        <div className="gx-media">{(step.k === 'work' && prefs.images && ex.gif ? gifSrc(ex) : imgSrc(ex)) ? <img decoding="async" alt="" src={step.k === 'work' && prefs.images && ex.gif ? gifSrc(ex) : imgSrc(ex)} /> : <Thumb ex={ex} />}</div>
        <div className="gx-ex-t">
          <span className="gx-ex-l">{step.k === 'work' ? t('Now') : t('Up next')}</span>
          <b className="capitalize">{nameFor(ex)}</b>
        </div>
      </div>}
      {step.k === 'work' && nextWork && <div className="gx-next"><Icon name="chevronRight" />{t('Then')}: <span className="capitalize">{nameFor(exOr(A.entries[nextWork.e].id))}</span></div>}
    </div>

    <div className="gx-ctrl">
      {step.sec ? <>
        <button className="gx-btn" onClick={() => set(adjustTime(run, -10))} aria-label={t('10 seconds less')}>−10 s</button>
        <button className="gx-btn main" onClick={() => set(run.paused ? resume(run) : pause(run))} aria-label={run.paused ? t('Resume') : t('Pause')}>
          <Icon name={run.paused ? 'play' : 'pause'} /></button>
        <button className="gx-btn" onClick={() => set(adjustTime(run, 10))} aria-label={t('10 seconds more')}>+10 s</button>
      </> : <button className="gx-btn main wide" onClick={() => doAdvance(true)}><Icon name="check" />{t('Done')}</button>}
    </div>
    <div className="gx-foot">
      <button className="gx-link" onClick={() => doAdvance(step.k !== 'work')}><Icon name="chevronRight" />{step.k === 'work' ? t('Skip exercise') : step.k === 'prep' ? t('Skip countdown') : t('Skip rest')}</button>
      <button className="gx-link danger" onClick={finishEarly}><Icon name="flag" />{t('Finish block')}</button>
    </div>
  </section>
}
