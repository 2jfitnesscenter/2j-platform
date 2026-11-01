// Copyright (C) 2026 Juan Jose Perez Sanchez — 2J Fitness Center
// SPDX-License-Identifier: AGPL-3.0-or-later
import { useEffect, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { useStore } from '../store/useStore.js'
import { t } from '../lib/i18n.js'
import { uid, todayISO, ACCENTS } from '../lib/format.js'
import { useCountdown, useStopwatch, fmtClock } from '../lib/clock.js'
import { CLOCK_MODES } from './Clock.jsx'
import Icon from '../components/Icon.jsx'
import ClockCard from '../components/ClockCard.jsx'
import { Button, Stepper } from '../components/ui.jsx'

// Logs a finished Reloj session as a plain timed exercise entry ("held" for however long the
// session ran) under a custom exercise named after the mode — reuses the existing mode:'time'
// machinery end to end (History/Stats already know how to render it) instead of inventing a new
// shape. Opt-in only, per the owner's explicit ask: nothing here is saved unless tapped.
function saveClockSession(update, title, seconds) {
  update(s => {
    const key = title.toLowerCase()
    let ex = (s.customEx || []).find(e => e.n.toLowerCase() === key)
    if (!ex) { ex = { id: 'c' + uid(), n: title, bp: 'cardio', eq: 'custom', custom: true }; (s.customEx = s.customEx || []).push(ex) }
    const end = Date.now()
    s.workouts.push({
      id: uid(), d: todayISO(), start: end - Math.round(seconds) * 1000, end, routineId: null, name: title, bw: null, prs: [], vol: 0,
      entries: [{ id: ex.id, sets: [{ sec: Math.round(seconds), w: 0, done: true }], target: { mode: 'time' }, topW: null }]
    })
  })
}

function SaveAsCardio({ title, seconds }) {
  const update = useStore(s => s.update)
  const [saved, setSaved] = useState(false)
  if (!(seconds > 0)) return null
  return <div className="card" style={{ marginBottom: 14, textAlign: 'center' }}>
    {saved
      ? <div className="small dim"><Icon name="check" /> {t('Added to today as cardio.')}</div>
      : <Button icon="plus" onClick={() => { saveClockSession(update, title, seconds); setSaved(true) }}>{t('Add to today as cardio')}</Button>}
  </div>
}

export default function ClockRun() {
  const nav = useNavigate()
  const { mode } = useParams()
  const meta = CLOCK_MODES.find(m => m.id === mode)
  useEffect(() => { if (!meta) nav('/clock', { replace: true }) }, [!!meta])
  if (!meta) return null
  return <div className="narrow">
    <div className="hdr">
      <button className="iconbtn" onClick={() => nav('/clock')} aria-label={t('Back')}><Icon name="chevronLeft" /></button>
      <div style={{ flex: 1, margin: '0 12px' }}>
        <div style={{ fontWeight: 600, fontSize: 20, letterSpacing: '-.021em' }}>{t(meta.title)}</div>
      </div>
    </div>
    {mode === 'stopwatch' && <ModeStopwatch />}
    {mode === 'countdown' && <ModeCountdown />}
    {mode === 'tabata' && <ModeTabata />}
    {mode === 'fortime' && <ModeForTime />}
    {mode === 'amrap' && <ModeAmrap />}
    {mode === 'emom' && <ModeEmom />}
    <div style={{ height: 20 }} />
  </div>
}

/* ---------- Cronómetro ---------- */
function ModeStopwatch() {
  const sw = useStopwatch()
  return <>
    <ClockCard icon="timer" title={t('Clock')} subtitle={t('Free stopwatch for timing any block.')}
      big={fmtClock(sw.elapsed)} running={sw.running} resumable={sw.elapsed > 0}
      onStart={sw.start} onPauseResume={sw.running ? sw.pause : sw.resume} onReset={sw.reset} />
    <SaveAsCardio title={t('Clock')} seconds={sw.elapsed} />
  </>
}

/* ---------- Cuenta atrás ---------- */
function ModeCountdown() {
  const [min, setMin] = useState(5)
  const [sec, setSec] = useState(0)
  const total = min * 60 + sec
  const c = useCountdown(total)
  const untouched = !c.running && c.elapsed === 0
  return <>
    {untouched && <div className="card" style={{ marginBottom: 14 }}>
      <div className="row cfgrow">
        <Stepper label={t('Minutes')} value={min} step={1} decimal={false} onChange={setMin} />
        <Stepper label={t('Seconds')} value={sec} step={5} decimal={false} onChange={v => setSec(Math.max(0, Math.min(59, v)))} />
      </div>
    </div>}
    <ClockCard icon="clock" title={t('Countdown')} big={fmtClock(c.remaining)} running={c.running}
      resumable={c.elapsed > 0 && c.elapsed < total} onStart={c.start} onPauseResume={c.running ? c.pause : c.resume} onReset={c.reset} />
    <SaveAsCardio title={t('Countdown')} seconds={c.elapsed} />
  </>
}

/* ---------- Tabata ---------- */
function ModeTabata() {
  const [workSec, setWorkSec] = useState(20)
  const [restSec, setRestSec] = useState(10)
  const [rounds, setRounds] = useState(8)
  const [started, setStarted] = useState(false)
  const [finished, setFinished] = useState(false)
  const [phaseIdx, setPhaseIdx] = useState(0)
  const totalPhases = rounds * 2
  const phase = phaseIdx % 2 === 0 ? 'work' : 'rest'
  const round = Math.floor(phaseIdx / 2) + 1
  const c = useCountdown(phase === 'work' ? workSec : restSec, {
    onDone: () => { if (phaseIdx + 1 >= totalPhases) setFinished(true); else setPhaseIdx(i => i + 1) }
  })
  // A phase change (round advances, or work<->rest flips) always means a fresh countdown for
  // the NEW duration — c.start() resets to full and runs; a plain pause/resume (same phase)
  // goes through the card's own button instead and never touches phaseIdx.
  useEffect(() => { if (started && !finished) c.start() }, [phaseIdx])
  const start = () => { setFinished(false); setPhaseIdx(0); setStarted(true); c.start() }
  const stop = () => { setStarted(false); setFinished(false); setPhaseIdx(0); c.reset() }
  const totalSec = rounds * (workSec + restSec)
  return <>
    {!started && <div className="card" style={{ marginBottom: 14 }}>
      <div className="row cfgrow">
        <Stepper label={t('Work (s)')} value={workSec} step={5} decimal={false} onChange={setWorkSec} />
        <Stepper label={t('Rest (s)')} value={restSec} step={5} decimal={false} onChange={setRestSec} />
        <Stepper label={t('Rounds')} value={rounds} step={1} decimal={false} onChange={setRounds} />
      </div>
      <div style={{ height: 12 }} />
      <Button variant="primary" icon="play" onClick={start}>{t('Start')}</Button>
    </div>}
    {started && !finished && <ClockCard icon="intervals" title={phase === 'work' ? t('Work') : t('Rest')}
      subtitle={t('Round {0}/{1}', round, rounds)} big={fmtClock(c.remaining)} running={c.running}
      resumable={!c.running} onStart={c.resume} onPauseResume={c.running ? c.pause : c.resume} onReset={stop} />}
    {finished && <div className="progline"><Icon name="checkCircle" /><span>{t('Tabata finished.')}</span></div>}
    {(started || finished) && <SaveAsCardio title={t('Tabata')} seconds={finished ? totalSec : 0} />}
  </>
}

/* ---------- For time ---------- */
function ModeForTime() {
  const [capMin, setCapMin] = useState(20)
  const cap = capMin * 60
  const sw = useStopwatch()
  const [finished, setFinished] = useState(false)
  useEffect(() => { if (sw.running && sw.elapsed >= cap) { sw.pause(); setFinished(true) } }, [sw.elapsed, sw.running])
  const finish = () => { sw.pause(); setFinished(true) }
  const reset = () => { sw.reset(); setFinished(false) }
  return <>
    {sw.elapsed === 0 && !sw.running && <div className="card" style={{ marginBottom: 14 }}>
      <Stepper label={t('Cap (minutes)')} value={capMin} step={1} decimal={false} onChange={setCapMin} />
    </div>}
    <ClockCard icon="flag" title={t('For time')} subtitle={t('Cap: {0}', fmtClock(cap))} big={fmtClock(sw.elapsed)}
      running={sw.running} resumable={sw.elapsed > 0 && !finished} onStart={sw.start} onPauseResume={sw.running ? sw.pause : sw.resume} onReset={reset}>
      {sw.running && !finished && <div style={{ marginBottom: 8 }}><Button variant="primary" onClick={finish}>{t('Finish')}</Button></div>}
    </ClockCard>
    {finished && <div className="progline"><Icon name="trophy" /><span>{t('Finished in {0}.', fmtClock(sw.elapsed))}</span></div>}
    <SaveAsCardio title={t('For time')} seconds={sw.elapsed} />
  </>
}

/* ---------- AMRAP ---------- */
function ModeAmrap() {
  const [min, setMin] = useState(12)
  const [sec, setSec] = useState(0)
  const total = min * 60 + sec
  const [finished, setFinished] = useState(false)
  const c = useCountdown(total, { onDone: () => setFinished(true) })
  const [rounds, setRounds] = useState(0)
  const [extraReps, setExtraReps] = useState(0)
  const [logged, setLogged] = useState(false)
  const untouched = !c.running && c.elapsed === 0
  const reset = () => { c.reset(); setFinished(false); setLogged(false); setRounds(0); setExtraReps(0) }
  return <>
    {untouched && <div className="card" style={{ marginBottom: 14 }}>
      <div className="row cfgrow">
        <Stepper label={t('Minutes')} value={min} step={1} decimal={false} onChange={setMin} />
        <Stepper label={t('Seconds')} value={sec} step={5} decimal={false} onChange={v => setSec(Math.max(0, Math.min(59, v)))} />
      </div>
    </div>}
    <ClockCard icon="infinity" title={t('AMRAP')} big={fmtClock(c.remaining)} running={c.running}
      resumable={c.elapsed > 0 && c.elapsed < total} onStart={c.start} onPauseResume={c.running ? c.pause : c.resume} onReset={reset} />
    {finished && !logged && <div className="card" style={{ marginBottom: 14 }}>
      <h4 className="sec" style={{ margin: '0 0 8px' }}>{t('How many rounds did you complete?')}</h4>
      <div className="row cfgrow">
        <Stepper label={t('Rounds')} value={rounds} step={1} decimal={false} onChange={setRounds} />
        <Stepper label={t('Extra reps')} value={extraReps} step={1} decimal={false} onChange={setExtraReps} />
      </div>
      <div style={{ height: 10 }} />
      <Button variant="primary" onClick={() => setLogged(true)}>{t('Save result')}</Button>
    </div>}
    {logged && <div className="progline"><Icon name="trophy" /><span>{t('{0} rounds + {1} reps in {2}.', rounds, extraReps, fmtClock(total))}</span></div>}
    <SaveAsCardio title={t('AMRAP')} seconds={c.elapsed} />
  </>
}

/* ---------- EMOM ---------- */
const PIP_COLORS = { gray: '#8e8e93', ...ACCENTS }
function ModeEmom() {
  const [roundMin, setRoundMin] = useState(1)
  const [roundSecPart, setRoundSecPart] = useState(0)
  const [rounds, setRounds] = useState(10)
  const [colorA, setColorA] = useState('gray')
  const [colorB, setColorB] = useState('lime')
  const [started, setStarted] = useState(false)
  const [finished, setFinished] = useState(false)
  const [round, setRound] = useState(1)
  const roundSec = Math.max(1, roundMin * 60 + roundSecPart)
  const c = useCountdown(roundSec, { onDone: () => { if (round >= rounds) setFinished(true); else setRound(r => r + 1) } })
  useEffect(() => { if (started && !finished) c.start() }, [round])
  const start = () => { setFinished(false); setRound(1); setStarted(true); c.start() }
  const stop = () => { setStarted(false); setFinished(false); setRound(1); c.reset() }
  return <>
    {!started && <div className="card" style={{ marginBottom: 14 }}>
      <div className="row cfgrow" style={{ marginBottom: 14 }}>
        <Stepper label={t('Minutes per round')} value={roundMin} step={1} decimal={false} onChange={setRoundMin} />
        <Stepper label={t('Seconds')} value={roundSecPart} step={5} decimal={false} onChange={v => setRoundSecPart(Math.max(0, Math.min(59, v)))} />
        <Stepper label={t('Rounds')} value={rounds} step={1} decimal={false} onChange={setRounds} />
      </div>
      <div className="small dim" style={{ marginBottom: 8 }}>{t('Round colors (optional)')}</div>
      <div className="small dim" style={{ marginBottom: 4 }}>{t('Odd rounds')}</div>
      <ColorPicker value={colorA} onChange={setColorA} />
      <div style={{ height: 10 }} />
      <div className="small dim" style={{ marginBottom: 4 }}>{t('Even rounds')}</div>
      <ColorPicker value={colorB} onChange={setColorB} />
      <div style={{ height: 12 }} />
      <Button variant="primary" icon="play" onClick={start}>{t('Start')}</Button>
    </div>}
    {started && !finished && <ClockCard icon="emom" title={t('Round {0}/{1}', round, rounds)}
      big={fmtClock(c.remaining)} running={c.running} resumable={!c.running} onStart={c.resume} onPauseResume={c.running ? c.pause : c.resume} onReset={stop}>
      <div className="row" style={{ flexWrap: 'wrap', justifyContent: 'center', gap: 6, marginBottom: 14 }}>
        {Array.from({ length: rounds }, (_, i) => <span key={i} style={{
          width: 14, height: 14, borderRadius: '50%', flex: 'none',
          background: PIP_COLORS[i % 2 === 0 ? colorA : colorB],
          boxShadow: i + 1 === round ? '0 0 0 2.5px var(--label)' : 'none',
        }} />)}
      </div>
    </ClockCard>}
    {finished && <div className="progline"><Icon name="checkCircle" /><span>{t('EMOM finished.')}</span></div>}
    {(started || finished) && <SaveAsCardio title={t('EMOM')} seconds={finished ? roundSec * rounds : 0} />}
  </>
}
function ColorPicker({ value, onChange }) {
  return <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
    {Object.keys(PIP_COLORS).map(k => <button key={k} aria-label={k} onClick={() => onChange(k)} style={{
      width: 24, height: 24, borderRadius: '50%', background: PIP_COLORS[k], flex: 'none',
      boxShadow: value === k ? '0 0 0 2.5px var(--label)' : 'none',
    }} />)}
  </div>
}
