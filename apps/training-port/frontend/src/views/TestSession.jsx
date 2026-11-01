// Copyright (C) 2026 Juan Jose Perez Sanchez — 2J Fitness Center
// SPDX-License-Identifier: AGPL-3.0-or-later
import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useStore } from '../store/useStore.js'
import { t, nameFor } from '../lib/i18n.js'
import { uid, todayISO, fmtDate, fmtNum } from '../lib/format.js'
import { estimate1RM } from '../lib/onerm.js'
import { exOr } from '../lib/exercises.js'
import { exercisePicker } from '../sheets.jsx'
import { useCountdown, useStopwatch, fmtClock } from '../lib/clock.js'
import Icon from '../components/Icon.jsx'
import ClockCard from '../components/ClockCard.jsx'
import { Thumb } from '../components/Media.jsx'
import { Button, ChipSelect, Stepper } from '../components/ui.jsx'

const TEST_TYPES = ['1rm', 'vam', 'erg']
const TEST_TYPE_LABEL = { '1rm': 'Test type: 1RM', vam: "Test type: VAM 6'", erg: 'Test type: Ergometer' }
const ERG_TYPES = ['row', 'bike', 'ski']
const ERG_LABEL = { row: 'Rowing ergometer', bike: 'Bike ergometer', ski: 'Ski ergometer' }

export default function TestSession() {
  const nav = useNavigate()
  const S = useStore(s => s.S)
  const update = useStore(s => s.update)
  const [type, setType] = useState('1rm')

  const addTest = entry => update(s => { (s.tests = s.tests || []).push({ id: uid(), d: todayISO(), ...entry }) })
  const today = (S.tests || []).filter(x => x.d === todayISO())

  return <div className="narrow">
    <div className="hdr">
      <button className="iconbtn" onClick={() => nav(-1)} aria-label={t('Back')}><Icon name="chevronLeft" /></button>
      <div style={{ flex: 1, margin: '0 12px' }}>
        <div style={{ fontWeight: 600, fontSize: 20, letterSpacing: '-.021em' }}>{t('Test session')}</div>
        <div className="sub">{t('Log tests without starting a full workout.')}</div>
      </div>
    </div>

    <div className="card" style={{ marginBottom: 14 }}>
      <h4 className="sec" style={{ margin: '0 0 6px' }}>{t('Test type')}</h4>
      <ChipSelect value={type} onChange={setType} sheetTitle={t('Test type')}
        options={TEST_TYPES.map(v => ({ value: v, label: t(TEST_TYPE_LABEL[v]) }))} />
    </div>

    {type === '1rm' ? <OneRMForm S={S} onSave={addTest} /> : type === 'vam' ? <VamForm onSave={addTest} /> : <ErgForm S={S} onSave={addTest} />}

    <h4 className="sec">{t('Session results')} <span className="tag" style={{ marginLeft: 6 }}>{today.length}</span></h4>
    {today.length ? <div className="list">{today.map(x => <TestRow key={x.id} test={x} />)}</div>
      : <div className="empty small dim" style={{ padding: '18px 0' }}>{t('No tests logged yet.')}</div>}
    <div style={{ height: 20 }} />
  </div>
}

function TestRow({ test }) {
  if (test.type === '1rm') {
    const ex = exOr(test.exId)
    return <div className="item">
      <Thumb ex={ex} />
      <div className="grow"><div className="tt capitalize">{nameFor(ex)}</div>
        <div className="ss">{t('{0} × {1} — est. 1RM {2} kg', fmtNum(test.w), test.r, fmtNum(test.est1RM))}</div></div>
    </div>
  }
  if (test.type === 'vam') {
    return <div className="item"><span className="lrow-i"><Icon name="figureRun" /></span>
      <div className="grow"><div className="tt">{t("VAM 6'")}</div>
        <div className="ss">{t('{0} m in {1}s — {2} km/h avg', fmtNum(test.distance), test.durationSec, fmtNum(test.avgSpeed))}</div></div>
    </div>
  }
  return <div className="item"><span className="lrow-i"><Icon name="bike" /></span>
    <div className="grow"><div className="tt">{t(ERG_LABEL[test.ergType])}</div>
      <div className="ss">{t('{0} m in {1} — {2} km/h avg', fmtNum(test.distance), fmtClock(test.durationSec), fmtNum(test.avgSpeed))}</div></div>
  </div>
}

/* ---------- 1RM ---------- */
function OneRMForm({ S, onSave }) {
  const [ex, setEx] = useState(null)
  const [w, setW] = useState(0)
  const [r, setR] = useState(1)
  const est = estimate1RM(w, r)
  const save = () => {
    if (!ex) return
    onSave({ type: '1rm', exId: ex.id, w, r, est1RM: est })
    setW(0); setR(1)
  }
  return <div className="card" style={{ marginBottom: 14 }}>
    {ex ? <div className="row" style={{ marginBottom: 12 }}>
      <Thumb ex={ex} /><div className="grow"><div className="tt capitalize">{nameFor(ex)}</div></div>
      <Button size="sm" onClick={() => exercisePicker(setEx)}>{t('Change')}</Button>
    </div> : <>
      <Button icon="magnifier" onClick={() => exercisePicker(setEx)}>{t('Pick an exercise')}</Button>
      <div className="small" style={{ color: 'var(--red)', marginTop: 8 }}>{t('Pick an exercise before you can save this test.')}</div>
    </>}
    <h4 className="sec">{t('Current attempt')}</h4>
    <div className="muted small" style={{ marginBottom: 10 }}>{t('Update this attempt any time you want to recalculate your real 1RM.')}</div>
    <div className="row cfgrow">
      <Stepper label={t('Weight ({0})', S.unit)} value={w} step={2.5} onChange={setW} />
      <Stepper label={t('Reps')} value={r} step={1} decimal={false} onChange={v => setR(Math.max(1, v))} />
    </div>
    {est != null && <div className="progline" style={{ marginTop: 10 }}><Icon name="trophy" /><span>{t('Estimated 1RM: {0} {1}', fmtNum(est), S.unit)}</span></div>}
    <div style={{ height: 12 }} />
    <Button variant="primary" disabled={!ex || !(w > 0)} onClick={save}>{t('Save 1RM')}</Button>
  </div>
}

/* ---------- VAM 6' ---------- */
const VAM_REF_SEC = 360
function VamForm({ onSave }) {
  const [distance, setDistance] = useState(0)
  const [durationSec, setDurationSec] = useState(VAM_REF_SEC)
  const c = useCountdown(VAM_REF_SEC, { onDone: () => setDurationSec(VAM_REF_SEC) })
  useEffect(() => { if (c.running) setDurationSec(Math.round(c.elapsed)) }, [c.elapsed, c.running])
  const avgSpeed = durationSec > 0 ? distance / durationSec * 3.6 : 0
  const save = () => {
    if (!(distance > 0) || !(durationSec > 0)) return
    onSave({ type: 'vam', distance, durationSec, avgSpeed: Math.round(avgSpeed * 10) / 10 })
    setDistance(0); c.reset(); setDurationSec(VAM_REF_SEC)
  }
  return <>
    <ClockCard icon="timer" title={t('6:00 timer')} subtitle={t('Use it as a reference — you can always edit the duration.')}
      big={fmtClock(c.remaining)} running={c.running} resumable={c.elapsed > 0 && c.elapsed < VAM_REF_SEC}
      onStart={c.start} onPauseResume={c.running ? c.pause : c.resume} onReset={c.reset} />
    <div className="card" style={{ marginBottom: 14 }}>
      <div className="row cfgrow">
        <Stepper label={t('Total distance (m)')} value={distance} step={10} decimal={false} onChange={setDistance} />
        <Stepper label={t('Duration (seconds)')} value={durationSec} step={5} decimal={false} onChange={setDurationSec} />
      </div>
      {avgSpeed > 0 && <div className="progline" style={{ marginTop: 10 }}><Icon name="bolt" /><span>{t('Average speed: {0} km/h', fmtNum(Math.round(avgSpeed * 10) / 10))}</span></div>}
      <div style={{ height: 12 }} />
      <Button variant="primary" disabled={!(distance > 0)} onClick={save}>{t('Save VAM')}</Button>
    </div>
  </>
}

/* ---------- ergometer ---------- */
function ErgForm({ S, onSave }) {
  const [ergType, setErgType] = useState('row')
  const [distance, setDistance] = useState(0)
  const [min, setMin] = useState(0)
  const [sec, setSec] = useState(0)
  const sw = useStopwatch()
  useEffect(() => { if (sw.running) { setMin(Math.floor(sw.elapsed / 60)); setSec(Math.round(sw.elapsed % 60)) } }, [sw.elapsed, sw.running])
  const durationSec = min * 60 + sec
  const avgSpeed = durationSec > 0 ? distance / durationSec * 3.6 : 0
  const best = (S.tests || []).filter(x => x.type === 'erg' && x.ergType === ergType)
    .reduce((a, b) => (!a || b.avgSpeed > a.avgSpeed ? b : a), null)
  const save = () => {
    if (!(distance > 0) || !(durationSec > 0)) return
    onSave({ type: 'erg', ergType, distance, durationSec, avgSpeed: Math.round(avgSpeed * 10) / 10 })
    setDistance(0); setMin(0); setSec(0); sw.reset()
  }
  return <>
    <div className="card" style={{ marginBottom: 14 }}>
      <h4 className="sec" style={{ margin: '0 0 6px' }}>{t('Ergometer type')}</h4>
      <ChipSelect value={ergType} onChange={setErgType} sheetTitle={t('Ergometer type')}
        options={ERG_TYPES.map(v => ({ value: v, label: t(ERG_LABEL[v]) }))} />
      <div className="small dim" style={{ marginTop: 8 }}>{t('Selected: {0} · {1}', t(ERG_LABEL[ergType]), best ? fmtNum(best.avgSpeed) + ' km/h' : '—')}</div>
    </div>
    <ClockCard icon="timer" title={t('Optional stopwatch')} subtitle={t('Use it during the test — the time feeds the form below.')}
      big={fmtClock(sw.elapsed)} running={sw.running} resumable={sw.elapsed > 0}
      onStart={sw.start} onPauseResume={sw.running ? sw.pause : sw.resume} onReset={sw.reset} />
    <div className="card" style={{ marginBottom: 14 }}>
      <Stepper label={t('Distance (m)')} value={distance} step={10} decimal={false} onChange={setDistance} />
      <div style={{ height: 10 }} />
      <div className="row cfgrow">
        <Stepper label={t('Minutes')} value={min} step={1} decimal={false} onChange={setMin} />
        <Stepper label={t('Seconds')} value={sec} step={5} decimal={false} onChange={v => setSec(Math.max(0, Math.min(59, v)))} />
      </div>
      {avgSpeed > 0 && <div className="progline" style={{ marginTop: 10 }}><Icon name="bolt" /><span>{t('Average speed: {0} km/h', fmtNum(Math.round(avgSpeed * 10) / 10))}</span></div>}
      <div style={{ height: 12 }} />
      <Button variant="primary" disabled={!(distance > 0) || !(durationSec > 0)} onClick={save}>{t('Save ergometer test')}</Button>
    </div>
  </>
}
