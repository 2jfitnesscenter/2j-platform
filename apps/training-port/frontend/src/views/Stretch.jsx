// Copyright (C) 2026 Juan Jose Perez Sanchez — 2J Fitness Center
// SPDX-License-Identifier: AGPL-3.0-or-later
import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { t } from '../lib/i18n.js'
import { useUI } from '../store/useUI.js'
import { beep, vibrate } from '../lib/sound.js'
import { useStore } from '../store/useStore.js'
import { STRETCHES, AREAS, AREA_LABEL, GOALS, LEVELS, stretchOr, autoSession } from '../lib/stretches.js'
import Icon from '../components/Icon.jsx'
import { Button, Check } from '../components/ui.jsx'

/* Stretching — a separate, self-contained flow from the strength side of the app: no weight,
   no reps, no rank/PR machinery, nothing written to S.workouts. Either the wizard picks a
   session for you (goal + level → autoSession in lib/stretches.js), or you build your own from
   the stretch-only list. Both paths land on the same preview → player → done sequence. State is
   local to this screen on purpose — a stretch session is a few minutes you either finish or
   don't, not something worth persisting across a reload the way a real workout is. */

const fmtDur = sec => { const m = Math.floor(sec / 60), s = sec % 60; return m ? `${m} min${s ? ' ' + s + ' seg.' : ''}` : `${s} seg.` }

function StretchImage({ src, style }) {
  const [failed, setFailed] = useState(false)
  useEffect(() => setFailed(false), [src])
  if (failed || !src) return <div role="img" aria-label={t('No image available')} style={{ display: 'grid', placeItems: 'center', color: 'var(--dim)', background: 'var(--surface-2)', borderRadius: 14, ...style }}><Icon name="figureStrength" /></div>
  return <img src={src} alt="" onError={() => setFailed(true)} style={style} />
}

export function StretchCard({ s, onClick, right }) {
  return <div className="item" onClick={onClick}>
    <StretchImage src={s.img} style={{ width: 44, height: 44, borderRadius: 12, objectFit: 'cover', flex: 'none', background: 'var(--surface-2)' }} />
    <div className="grow">
      <div className="tt">{s.n}</div>
      <div className="ss">{s.area.map(a => AREA_LABEL[a]).join(' · ')}{s.dur ? ' · ' + fmtDur(s.dur) : ''}</div>
    </div>
    {right}
  </div>
}

/* ---------- exercise detail (steps + caution) ---------- */
export function StretchDetail({ s, onClose }) {
  return <>
    <div className="row between" style={{ marginBottom: 10 }}>
      <h3 style={{ margin: 0 }}>{s.n}</h3>
      {onClose && <button className="iconbtn" onClick={onClose} aria-label={t('Close')}><Icon name="xmark" /></button>}
    </div>
    <StretchImage src={s.img} style={{ width: '100%', aspectRatio: '4/3', objectFit: 'contain', background: 'var(--surface-2)', borderRadius: 14, marginBottom: 12 }} />
    <div className="row" style={{ gap: 6, flexWrap: 'wrap', marginBottom: 12 }}>
      <span className="tag acc"><Icon name={s.type === 'dynamic' ? 'figureRun' : 'timer'} />{s.type === 'dynamic' ? 'Dinámico' : 'Mantenido'}</span>
      {s.area.map(a => <span key={a} className="tag">{AREA_LABEL[a]}</span>)}
    </div>
    <h4 className="sec" style={{ marginTop: 0 }}>Cómo hacerlo</h4>
    <div className="list" style={{ marginBottom: s.caution ? 14 : 0 }}>
      {s.steps.map((step, i) => <div key={i} className="row" style={{ gap: 10, padding: '10px 12px', alignItems: 'flex-start' }}>
        <span className="lrow-i" style={{ width: 22, height: 22, fontSize: 12, flex: 'none', marginTop: 1 }}>{i + 1}</span>
        <span className="small" style={{ lineHeight: 1.5 }}>{step}</span>
      </div>)}
    </div>
    {s.caution && <div className="card" style={{ background: 'color-mix(in srgb, var(--orange) 10%, var(--surface))' }}>
      <div className="row" style={{ gap: 8, alignItems: 'flex-start' }}>
        <Icon name="info" style={{ color: 'var(--orange)', flex: 'none', marginTop: 2 }} />
        <span className="small" style={{ lineHeight: 1.5 }}>{s.caution}</span>
      </div>
    </div>}
  </>
}

/* ---------- manual picker: choose your own stretches ---------- */
function ManualPicker({ onDone, onCancel }) {
  const [area, setArea] = useState('')
  const [picked, setPicked] = useState(() => new Set())
  const [detail, setDetail] = useState(null)
  const toggle = id => setPicked(p => { const n = new Set(p); n.has(id) ? n.delete(id) : n.add(id); return n })
  const shown = STRETCHES.filter(s => !area || s.area.includes(area))

  if (detail) return <div className="narrow">
    <div className="hdr"><button className="iconbtn" onClick={() => setDetail(null)} aria-label={t('Back')}><Icon name="chevronLeft" /></button></div>
    <StretchDetail s={detail} />
    <div style={{ height: 12 }} />
    <Button variant={picked.has(detail.id) ? 'danger' : 'primary'} onClick={() => { toggle(detail.id); setDetail(null) }}>
      {picked.has(detail.id) ? 'Quitar de la sesión' : 'Añadir a la sesión'}
    </Button>
    <div style={{ height: 20 }} />
  </div>

  return <div className="narrow">
    <div className="hdr">
      <button className="iconbtn" onClick={onCancel} aria-label={t('Back')}><Icon name="chevronLeft" /></button>
      <div style={{ flex: 1, marginLeft: 8 }}><h1>Elige tus estiramientos</h1><div className="sub">{picked.size} elegidos</div></div>
    </div>
    <div className="chips" style={{ marginBottom: 10 }}>
      <button className={'chip nocap' + (!area ? ' on' : '')} onClick={() => setArea('')}>{t('All')}</button>
      {AREAS.map(a => <button key={a} className={'chip' + (area === a ? ' on' : '')} onClick={() => setArea(a)}>{AREA_LABEL[a]}</button>)}
    </div>
    <div className="list" style={{ marginBottom: picked.size ? 74 : 14 }}>
      {shown.map(s => <StretchCard key={s.id} s={s} onClick={() => setDetail(s)}
        right={<Check checked={picked.has(s.id)} onChange={() => toggle(s.id)} />} />)}
    </div>
    {picked.size > 0 && <div className="wizard-footer">
      <Button variant="primary" icon="check" onClick={() => onDone([...picked])}>{`Continuar (${picked.size})`}</Button>
    </div>}
  </div>
}

/* ---------- auto wizard: goal then level ---------- */
function AutoWizard({ onDone, onCancel }) {
  const [step, setStep] = useState(0)
  const [goal, setGoal] = useState(null)
  const steps = ['goal', 'level']
  return <div className="narrow" style={{ paddingBottom: 86 }}>
    <div className="hdr">
      <button className="iconbtn" onClick={() => step ? setStep(0) : onCancel()} aria-label={t('Back')}><Icon name="chevronLeft" /></button>
      <div style={{ flex: 1, marginLeft: 8 }}><div className="sub">{t('Step {0} of {1}', step + 1, steps.length)}</div></div>
    </div>
    <div className="row" style={{ gap: 5, marginBottom: 18 }}>
      {steps.map((s, i) => <div key={s} style={{ height: 3, flex: 1, borderRadius: 2, background: i <= step ? 'var(--acc)' : 'var(--surface-3)' }} />)}
    </div>

    {step === 0 && <>
      <h2 style={{ marginTop: 0 }}>¿Qué es lo que más te importa ahora mismo?</h2>
      <div className="dim small" style={{ marginBottom: 14 }}>Adaptaremos la sesión a lo que elijas.</div>
      <div className="sect-b">
        {GOALS.map(g => <button key={g.value} className="lrow tap" onClick={() => { setGoal(g.value); setStep(1) }}>
          <span className="lrow-m"><span className="lrow-t">{g.label}</span><span className="lrow-s">{g.sub}</span></span>
        </button>)}
      </div>
    </>}

    {step === 1 && <>
      <h2 style={{ marginTop: 0 }}>¿Cuál es tu punto de partida?</h2>
      <div className="dim small" style={{ marginBottom: 14 }}>Sé sincero, los resultados llegan con constancia.</div>
      <div className="sect-b">
        {LEVELS.map(l => <button key={l.value} className="lrow tap" onClick={() => onDone(goal, l.value)}>
          <span className="lrow-m"><span className="lrow-t">{l.label}</span><span className="lrow-s">{l.sub}</span></span>
        </button>)}
      </div>
      <div className="dim small" style={{ marginTop: 20, lineHeight: 1.5, textAlign: 'center' }}>
        Si tienes un dolor fuerte o una lesión reciente, consulta a un profesional médico antes de empezar cualquier programa de estiramientos.
      </div>
    </>}
  </div>
}

/* ---------- preview: the generated/chosen session, before starting ---------- */
function Preview({ ids, title, onStart, onEdit, onBack }) {
  const [detail, setDetail] = useState(null)
  const list = ids.map(stretchOr)
  const total = list.reduce((n, s) => n + s.dur, 0)

  if (detail) return <div className="narrow">
    <div className="hdr"><button className="iconbtn" onClick={() => setDetail(null)} aria-label={t('Back')}><Icon name="chevronLeft" /></button></div>
    <StretchDetail s={detail} />
    <div style={{ height: 20 }} />
  </div>

  return <div className="narrow">
    <div className="hdr">
      <button className="iconbtn" onClick={onBack} aria-label={t('Back')}><Icon name="chevronLeft" /></button>
      <div style={{ flex: 1, marginLeft: 8 }} />
      {onEdit && <button className="iconbtn" onClick={onEdit} aria-label={t('Edit')} title={t('Edit')}><Icon name="pencil" /></button>}
    </div>
    <h1 style={{ marginBottom: 4 }}>{title}</h1>
    <div className="muted" style={{ marginBottom: 14 }}>{fmtDur(total)} · {list.length} estiramiento{list.length === 1 ? '' : 's'}</div>
    <div className="card" style={{ padding: 0, overflow: 'hidden', marginBottom: 14 }}>
      <div className="list" style={{ gap: 0 }}>
        {list.map(s => <StretchCard key={s.id} s={s} onClick={() => setDetail(s)} />)}
      </div>
    </div>
    <Button variant="primary" icon="play" onClick={onStart}>Empezar sesión</Button>
    <div style={{ height: 20 }} />
  </div>
}

/* ---------- player: sequential countdown through each stretch ---------- */
function Player({ ids, onFinish, onExit }) {
  const [i, setI] = useState(0)
  const s = stretchOr(ids[i])
  const [left, setLeft] = useState(s.dur)
  const [paused, setPaused] = useState(false)
  const soundOn = useStore(st => st.S.sound)
  const advancing = useRef(false)

  useEffect(() => { setLeft(stretchOr(ids[i]).dur); setPaused(false); advancing.current = false }, [i])

  useEffect(() => {
    if (paused) return undefined
    const iv = setInterval(() => setLeft(l => Math.max(0, l - 1)), 1000)
    return () => clearInterval(iv)
  }, [paused, i])

  const next = () => {
    if (advancing.current) return
    advancing.current = true
    if (i + 1 < ids.length) setI(i + 1)
    else onFinish()
  }

  useEffect(() => {
    if (left > 0) return
    beep(soundOn, 880, 0.15); beep(soundOn, 880, 0.15, 0.22); vibrate([150, 80, 150])
    const t = setTimeout(next, 500)
    return () => clearTimeout(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [left])

  const pct = ((s.dur - left) / s.dur) * 100

  return <div className="narrow">
    <div className="hdr">
      <button className="iconbtn" onClick={onExit} aria-label={t('Discard')}><Icon name="xmark" /></button>
      <div style={{ textAlign: 'center', flex: 1 }} className="sub">{`${i + 1} / ${ids.length}`}</div>
      <button className="iconbtn" style={{ visibility: 'hidden' }}><Icon name="xmark" /></button>
    </div>
    <StretchImage src={s.img} style={{ width: '100%', aspectRatio: '1/1', objectFit: 'contain', background: 'var(--surface-2)', borderRadius: 20, marginBottom: 14 }} />
    <h2 style={{ textAlign: 'center', marginBottom: 4 }}>{s.n}</h2>
    <div className="dim small" style={{ textAlign: 'center', marginBottom: 16 }}>{s.area.map(a => AREA_LABEL[a]).join(' · ')}</div>
    <div style={{ fontSize: 44, fontWeight: 700, textAlign: 'center', letterSpacing: '-.02em', marginBottom: 6 }}>{left}s</div>
    <div className="wprog" style={{ marginBottom: 18 }}><i style={{ width: pct + '%' }} /></div>
    <div className="row" style={{ gap: 10 }}>
      <Button icon={paused ? 'play' : 'pause'} onClick={() => setPaused(p => !p)}>{paused ? 'Reanudar' : 'Pausar'}</Button>
      <Button variant="tinted" trailingIcon="chevronRight" onClick={next}>{i + 1 < ids.length ? 'Siguiente' : 'Terminar'}</Button>
    </div>
    {s.steps?.length > 0 && <div className="dim small" style={{ marginTop: 20, lineHeight: 1.5, textAlign: 'center' }}>{s.steps[0]}</div>}
  </div>
}

function Done({ ids, onExit }) {
  const total = ids.reduce((n, id) => n + stretchOr(id).dur, 0)
  return <div className="narrow" style={{ display: 'flex', flexDirection: 'column', justifyContent: 'center', minHeight: '78vh', textAlign: 'center' }}>
    <div style={{ fontSize: 48, marginBottom: 10 }}>🧘</div>
    <h1 style={{ marginBottom: 6 }}>¡Sesión completada!</h1>
    <div className="muted" style={{ marginBottom: 26 }}>{fmtDur(total)} · {ids.length} estiramientos</div>
    <Button variant="primary" onClick={onExit}>{t('Nice!')}</Button>
  </div>
}

export default function Stretch() {
  const nav = useNavigate()
  const toast = useUI(s => s.toast)
  // 'home' | 'wizard' | 'picker' | 'preview' | 'player' | 'done'
  const [stage, setStage] = useState('home')
  const [ids, setIds] = useState([])
  const [title, setTitle] = useState('Sesión de estiramientos')
  const fromPicker = useRef(false)

  const startAuto = (goal, level) => {
    const picked = autoSession(goal, level)
    if (!picked.length) { toast('No encontré estiramientos para esa combinación.'); setStage('home'); return }
    fromPicker.current = false
    setIds(picked)
    setTitle(GOALS.find(g => g.value === goal)?.label === 'Levantar más peso' ? 'Calentamiento antes de entrenar'
      : GOALS.find(g => g.value === goal)?.label === 'Recuperarte del entreno' ? 'Estiramientos de recuperación'
        : 'Sesión de movilidad')
    setStage('preview')
  }
  const startManual = picked => {
    fromPicker.current = true
    setIds(picked)
    setTitle('Tu sesión de estiramientos')
    setStage('preview')
  }

  if (stage === 'wizard') return <AutoWizard onDone={startAuto} onCancel={() => setStage('home')} />
  if (stage === 'picker') return <ManualPicker onDone={startManual} onCancel={() => setStage('home')} />
  if (stage === 'preview') return <Preview ids={ids} title={title}
    onStart={() => setStage('player')}
    onEdit={() => setStage(fromPicker.current ? 'picker' : 'wizard')}
    onBack={() => setStage('home')} />
  if (stage === 'player') return <Player ids={ids} onFinish={() => setStage('done')} onExit={() => setStage('home')} />
  if (stage === 'done') return <Done ids={ids} onExit={() => nav('/home')} />

  return <div className="narrow">
    <div className="hdr">
      <button className="iconbtn" onClick={() => nav(-1)} aria-label={t('Back')}><Icon name="chevronLeft" /></button>
      <div style={{ flex: 1, marginLeft: 8 }}><h1>Estiramiento</h1></div>
    </div>
    <div className="dim small" style={{ marginBottom: 20, lineHeight: 1.5 }}>
      Deja que te preparemos una sesión, o elige tú mismo qué estirar.
    </div>
    <div className="card row between" style={{ cursor: 'pointer', marginBottom: 12 }} onClick={() => setStage('wizard')}>
      <div className="row" style={{ gap: 12 }}>
        <span className="lrow-i" style={{ width: 40, height: 40, fontSize: 20 }}><Icon name="sparkles" /></span>
        <div><div className="tt">Generar automáticamente</div><div className="ss">Dos preguntas y listo</div></div>
      </div>
      <Icon name="chevronRight" className="chev" />
    </div>
    <div className="card row between" style={{ cursor: 'pointer' }} onClick={() => setStage('picker')}>
      <div className="row" style={{ gap: 12 }}>
        <span className="lrow-i soft" style={{ width: 40, height: 40, fontSize: 20 }}><Icon name="list" /></span>
        <div><div className="tt">Elegir mis estiramientos</div><div className="ss">{STRETCHES.length} disponibles, filtra por zona</div></div>
      </div>
      <Icon name="chevronRight" className="chev" />
    </div>
  </div>
}
